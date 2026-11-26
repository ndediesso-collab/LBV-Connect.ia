"""Authenticated Web Push enrollment and test delivery for ORIA Assistant owners."""
from __future__ import annotations

import json
import logging
import os
from typing import Any

from fastapi import APIRouter, Depends, Header, HTTPException
from pydantic import BaseModel, Field

from app.core.supabase import supabase
from app.services.oria_assistant_push_service import worker_ready
from app.services.oria_collab_push_service import validate_subscription

logger = logging.getLogger("oria.assistant.push.api")
router = APIRouter(prefix="/assistant/push", tags=["ORIA Assistant - notifications Push"])


class SubscriptionKeys(BaseModel):
    p256dh: str = Field(min_length=40, max_length=300)
    auth: str = Field(min_length=10, max_length=300)


class SubscriptionPayload(BaseModel):
    endpoint: str = Field(min_length=20, max_length=2048)
    keys: SubscriptionKeys


class PushPreferencePayload(BaseModel):
    push_enabled: bool


def _owner_id(user_id: str | None, authorization: str | None) -> str:
    if not user_id or not authorization:
        raise HTTPException(401, "Authentification ORIA obligatoire.")
    token = authorization.strip()
    if token.lower().startswith("bearer "):
        token = token[7:].strip()
    if not token:
        raise HTTPException(401, "Session ORIA expirée.")
    try:
        response = supabase.auth.get_user(token)
        user = response.user
    except Exception as exc:
        raise HTTPException(401, "Session ORIA invalide ou expirée.") from exc
    if user is None or str(user.id) != str(user_id):
        raise HTTPException(403, "La session ne correspond pas au compte transmis.")
    return str(user.id)


def _owner(user_id: str | None = Header(default=None, alias="user-id"),
           authorization: str | None = Header(default=None, alias="authorization")) -> str:
    return _owner_id(user_id, authorization)


def _preferences(owner: str) -> dict[str, Any] | None:
    response = (supabase.table("oria_assistant_push_preferences")
                .select("owner_user_id,push_enabled")
                .eq("owner_user_id", owner).limit(1).execute())
    data = getattr(response, "data", None)
    return data[0] if isinstance(data, list) and data else data if isinstance(data, dict) else None


def _devices(owner: str) -> list[dict[str, Any]]:
    response = (supabase.table("oria_collab_push_devices_p16")
                .select("id,endpoint,p256dh,auth_key")
                .eq("user_id", owner).execute())
    data = getattr(response, "data", None)
    return [item for item in data if isinstance(item, dict)] if isinstance(data, list) else []


@router.get("/status")
def push_status(owner: str = Depends(_owner)):
    try:
        preference = _preferences(owner)
        devices = _devices(owner)
    except Exception as exc:
        logger.exception("ORIA Assistant Push status could not be read")
        raise HTTPException(503, "Impossible de lire les réglages Push. Vérifie la migration SQL ORIA Assistant Push.") from exc
    ready = bool(worker_ready())
    public_key = str(os.getenv("ORIA_COLLAB_VAPID_PUBLIC_KEY") or "").strip() if ready else ""
    return {
        "success": True,
        "ready": ready and bool(public_key),
        "push_enabled": bool((preference or {}).get("push_enabled")),
        "device_count": len(devices),
        "vapid_public_key": public_key,
    }


@router.post("/subscriptions")
def register_subscription(payload: SubscriptionPayload, owner: str = Depends(_owner)):
    if not worker_ready() or not os.getenv("ORIA_COLLAB_VAPID_PUBLIC_KEY"):
        raise HTTPException(503, "Le serveur Push ORIA n'est pas encore configuré sur Render.")
    subscription = validate_subscription(payload.endpoint, payload.keys.p256dh, payload.keys.auth)
    try:
        supabase.table("oria_collab_push_devices_p16").upsert(
            {"user_id": owner, **subscription}, on_conflict="endpoint",
        ).execute()
        supabase.table("oria_assistant_push_preferences").upsert(
            {"owner_user_id": owner, "push_enabled": True}, on_conflict="owner_user_id",
        ).execute()
    except Exception as exc:
        logger.exception("ORIA Assistant Push device registration failed")
        raise HTTPException(503, "Impossible d'enregistrer ce téléphone pour les notifications ORIA.") from exc
    return {"success": True, "push_enabled": True}


@router.patch("/preferences")
def update_push_preference(payload: PushPreferencePayload, owner: str = Depends(_owner)):
    if payload.push_enabled:
        devices = _devices(owner)
        if not devices:
            raise HTTPException(409, "Enregistre d'abord ce téléphone pour activer les notifications.")
    try:
        supabase.table("oria_assistant_push_preferences").upsert(
            {"owner_user_id": owner, "push_enabled": payload.push_enabled}, on_conflict="owner_user_id",
        ).execute()
    except Exception as exc:
        logger.exception("ORIA Assistant Push preference update failed")
        raise HTTPException(503, "Impossible d'enregistrer cette préférence Push.") from exc
    return {"success": True, "push_enabled": payload.push_enabled}


@router.post("/test")
def send_test_push(owner: str = Depends(_owner)):
    if not worker_ready():
        raise HTTPException(503, "Le worker Push n'est pas prêt. Vérifie les variables VAPID et les flags Push sur Render.")
    try:
        preference = _preferences(owner)
        devices = _devices(owner)
    except Exception as exc:
        logger.exception("ORIA Assistant Push test could not load devices")
        raise HTTPException(503, "Impossible de lire les appareils enregistrés.") from exc
    if not preference or not preference.get("push_enabled"):
        raise HTTPException(409, "Les notifications ORIA Assistant ne sont pas activées pour ce compte.")
    if not devices:
        raise HTTPException(409, "Aucun téléphone enregistré. Active les notifications depuis ton téléphone.")

    try:
        from pywebpush import WebPushException, webpush
        private_key = os.environ["ORIA_COLLAB_VAPID_PRIVATE_KEY"]
        subject = os.environ["ORIA_COLLAB_VAPID_SUBJECT"]
    except Exception as exc:
        logger.exception("ORIA Assistant Push test configuration incomplete")
        raise HTTPException(503, "Configuration VAPID incomplète sur Render.") from exc

    sent = 0
    failures = 0
    for device in devices:
        try:
            payload = {
                "title": "ORIA — Notifications activées",
                "body": "Ton téléphone est bien connecté. Tu recevras une alerte à chaque nouvelle demande client.",
                "url": "/assistant/demandes",
                "tag": "oria-assistant-push-test",
            }
            webpush(
                subscription_info={
                    "endpoint": device["endpoint"],
                    "keys": {"p256dh": device["p256dh"], "auth": device["auth_key"]},
                },
                data=json.dumps(payload, ensure_ascii=False),
                vapid_private_key=private_key,
                vapid_claims={"sub": subject},
                ttl=600,
            )
            sent += 1
        except WebPushException as exc:
            failures += 1
            status = getattr(getattr(exc, "response", None), "status_code", None)
            if status in (404, 410):
                try:
                    supabase.table("oria_collab_push_devices_p16").delete().eq("id", device["id"]).execute()
                except Exception:
                    logger.exception("ORIA Assistant expired Push device cleanup failed")
            logger.warning("ORIA Assistant Push test failed for one device (HTTP %s)", status)
        except Exception:
            failures += 1
            logger.exception("ORIA Assistant Push test failed for one device")
    if sent == 0:
        raise HTTPException(503, f"Aucune notification n'a pu être remise au service Push ({failures} échec(s)).")
    return {"success": True, "sent": sent, "failed": failures}
