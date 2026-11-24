"""ORIA Collaboratif P16 - préférences Web Push et livraison atomique (sans crédit IA).

Service-role only. Le middleware de pack et le JWT sont revérifiés ici.
La file SQL fournit une ligne par événement/appareil, avec lease anti-concurrence.
Les payloads push ne contiennent JAMAIS le texte d'une conversation.
"""
from __future__ import annotations

import json
import logging
import os
import re
from typing import Any
from urllib.parse import urlsplit
from uuid import UUID

from fastapi import HTTPException

from app.middleware.oria_collab_pack_gate import check_workspace

logger = logging.getLogger("oria.collab.push")
MODES = frozenset(("all", "important", "muted"))
WEBPUSH_HOSTS = frozenset((
    "fcm.googleapis.com", "updates.push.services.mozilla.com",
    "web.push.apple.com", "webpush.push.apple.com",
))


def enabled() -> bool:
    return os.getenv("ORIA_COLLAB_PUSH_P16_ENABLED", "0").strip() == "1"


def worker_ready() -> bool:
    return bool(enabled() and os.getenv("ORIA_COLLAB_PUSH_WORKER_ENABLED", "0") == "1"
                and os.getenv("ORIA_COLLAB_VAPID_PRIVATE_KEY")
                and os.getenv("ORIA_COLLAB_VAPID_PUBLIC_KEY")
                and os.getenv("ORIA_COLLAB_VAPID_SUBJECT"))


def identity(value: str) -> str:
    try:
        return str(UUID(str(value)))
    except (ValueError, TypeError, AttributeError) as exc:
        raise HTTPException(422, "Identifiant incorrect.") from exc


def mode(value: str) -> str:
    if value not in MODES:
        raise HTTPException(422, "Mode de notification invalide.")
    return value


def validate_subscription(endpoint: str, p256dh: str, auth: str) -> dict:
    """N'accepte que des endpoints officiels; interdit SSRF et liens privés."""
    if not isinstance(endpoint, str) or len(endpoint) > 2048:
        raise HTTPException(422, "Point de notification invalide.")
    try:
        parsed = urlsplit(endpoint)
    except ValueError as exc:
        raise HTTPException(422, "Point de notification invalide.") from exc
    try:
        hostname = (parsed.hostname or "").lower()
        port = parsed.port
    except ValueError as exc:
        raise HTTPException(422, "Adresse Push malformée.") from exc
    if parsed.scheme != "https" or parsed.username or parsed.password or port not in (None, 443):
        raise HTTPException(422, "Endpoint HTTPS obligatoire.")
    edge_push = hostname.endswith(".notify.windows.com") and len(hostname)<90
    if (hostname not in WEBPUSH_HOSTS and not edge_push) or not parsed.path or parsed.fragment:
        raise HTTPException(422, "Service Web Push non reconnu.")
    for secret in (p256dh, auth):
        if not isinstance(secret, str) or not 10 <= len(secret) <= 300:
            raise HTTPException(422, "Clé d'abonnement invalide.")
        if not re.fullmatch(r"[A-Za-z0-9_\-]+=*", secret):
            raise HTTPException(422, "Clé d'abonnement invalide.")
    if len(p256dh) < 40:
        raise HTTPException(422, "Clé publique d'appareil incomplète.")
    return {"endpoint": endpoint, "p256dh": p256dh, "auth_key": auth}


def _first(data: Any) -> dict | None:
    items = getattr(data, "data", None)
    return (items[0] if isinstance(items, list) and items else
            items if isinstance(items, dict) else None)


class CollabPushService:
    def __init__(self, db: Any):
        self.db = db

    def auth(self, actor: str, space: str) -> tuple[str, str]:
        if not enabled():
            raise HTTPException(503, "Notifications P16 non activées.")
        actor, space = identity(actor), identity(space)
        try:
            decision = check_workspace(self.db, actor, space)
        except HTTPException:
            raise
        except Exception as exc:
            logger.exception("Authorization check P16 unavailable")
            raise HTTPException(503, "Vérification des accès indisponible.") from exc
        if not decision.allowed:
            raise HTTPException(decision.status, "Espace collaboratif inaccessible.")
        return actor, space

    def config(self) -> dict:
        return {"success": True, "enabled": enabled(),
                "vapid_public_key": os.getenv("ORIA_COLLAB_VAPID_PUBLIC_KEY", "") if enabled() else ""}

    def settings(self, actor: str, space: str) -> dict:
        actor, space = self.auth(actor, space)
        try:
            row = _first(self.db.table("oria_collab_push_preferences_p16")
                         .select("push_enabled,sound_enabled,mode")
                         .eq("workspace_id", space).eq("user_id", actor).limit(1).execute())
            rooms = (self.db.table("oria_collab_push_room_preferences_p16")
                     .select("group_id,mode").eq("workspace_id", space)
                     .eq("user_id", actor).execute().data or [])
            memberships = (self.db.table("oria_collab_group_participants")
                           .select("group_id").eq("member_user_id",actor).execute().data or [])
            group_ids = [p["group_id"] for p in memberships]
            groups = ((self.db.table("oria_collab_groups")
                       .select("id,title,workspace_id").eq("workspace_id",space)
                       .in_("id",group_ids).execute().data or []) if group_ids else [])
        except Exception as exc:
            logger.exception("P16 settings read failed")
            raise HTTPException(503, "Réglages indisponibles. Vérifiez la migration P16.") from exc
        visible_groups = []
        for g in groups:
            if str(g.get("workspace_id")) == space:
                visible_groups.append({"id":str(g["id"]),"title":str(g["title"])})
        return {"success": True, "workspace_id": space,
                "preferences": row or {"push_enabled": False,"sound_enabled":True,"mode":"all"},
                "rooms": rooms, "groups": visible_groups}

    def update(self, actor: str, space: str, *, push_enabled: bool,
               sound_enabled: bool, notification_mode: str) -> dict:
        actor, space = self.auth(actor, space)
        mode(notification_mode)
        try:
            self.db.table("oria_collab_push_preferences_p16").upsert({
                "workspace_id":space,"user_id":actor,"push_enabled":push_enabled,
                "sound_enabled":sound_enabled,"mode":notification_mode,
            }, on_conflict="workspace_id,user_id").execute()
        except Exception as exc:
            logger.exception("P16 settings save failed")
            raise HTTPException(503, "Enregistrement des préférences impossible.") from exc
        return {"success":True,"workspace_id":space,"preferences":{
            "push_enabled":push_enabled,"sound_enabled":sound_enabled,"mode":notification_mode}}

    def room_update(self, actor: str, space: str, group_id: str,
                    notification_mode: str) -> dict:
        actor, space = self.auth(actor, space)
        group_id, notification_mode = identity(group_id), mode(notification_mode)
        try:
            group = _first(self.db.table("oria_collab_groups").select("id")
                           .eq("id",group_id).eq("workspace_id",space).limit(1).execute())
            membership = _first(self.db.table("oria_collab_group_participants")
                                .select("group_id").eq("group_id",group_id)
                                .eq("member_user_id",actor).limit(1).execute())
            if not group or not membership:
                raise HTTPException(404, "Groupe inaccessible.")
            self.db.table("oria_collab_push_room_preferences_p16").upsert({
                "workspace_id":space,"group_id":group_id,"user_id":actor,
                "mode":notification_mode,
            },on_conflict="group_id,user_id").execute()
        except HTTPException:
            raise
        except Exception as exc:
            logger.exception("P16 room preference failed")
            raise HTTPException(503, "Réglage de groupe indisponible.") from exc
        return {"success":True,"workspace_id":space,"group_id":group_id,"mode":notification_mode}

    def subscribe(self, actor: str, space: str, endpoint: str, p256dh: str, auth: str) -> dict:
        actor, space = self.auth(actor, space)
        data = validate_subscription(endpoint,p256dh,auth)
        try:
            self.db.table("oria_collab_push_devices_p16").upsert({
                "user_id": actor, **data,
            },on_conflict="endpoint").execute()
        except Exception as exc:
            logger.exception("P16 subscribe failed")
            raise HTTPException(503, "Enregistrement de cet appareil impossible.") from exc
        return {"success":True,"workspace_id":space}

    def presence(self, actor: str, space: str, group_id: str | None, focused: bool) -> dict:
        actor, space = self.auth(actor, space)
        group_id = identity(group_id) if group_id else None
        if group_id:
            try:
                group = _first(self.db.table("oria_collab_groups").select("id")
                               .eq("id",group_id).eq("workspace_id",space).limit(1).execute())
                part = _first(self.db.table("oria_collab_group_participants")
                              .select("group_id").eq("group_id",group_id)
                              .eq("member_user_id",actor).limit(1).execute())
                if not group or not part:
                    raise HTTPException(404, "Groupe inaccessible.")
            except HTTPException:
                raise
            except Exception as exc:
                raise HTTPException(503,"Vérification du groupe indisponible.") from exc
        try:
            from datetime import datetime, timezone
            self.db.table("oria_collab_push_presence_p16").upsert({
                "workspace_id":space,"user_id":actor,"group_id":group_id,
                "focused":bool(focused),"updated_at":datetime.now(timezone.utc).isoformat(),
            },on_conflict="workspace_id,user_id").execute()
        except Exception as exc:
            logger.exception("P16 presence failed")
            raise HTTPException(503,"Synchronisation de présence indisponible.") from exc
        return {"success":True,"workspace_id":space}

    def unsubscribe(self, actor: str, space: str, endpoint: str) -> dict:
        actor, space = self.auth(actor, space)
        try:
            self.db.table("oria_collab_push_devices_p16").delete()\
                .eq("user_id",actor).eq("endpoint",endpoint).execute()
        except Exception as exc:
            logger.exception("P16 unsubscribe failed")
            raise HTTPException(503, "Suppression de l'appareil impossible.") from exc
        return {"success":True,"workspace_id":space}


def _rpc_data(db: Any, func: str, payload: dict) -> dict:
    result = db.rpc(func,payload).execute().data
    if isinstance(result,list) and len(result)==1:result=result[0]
    if not isinstance(result,dict) or result.get("success") is not True:
        raise RuntimeError(f"P16 unexpected SQL RPC response for {func}")
    return result


def _safe_push_url(space: str, group: str) -> str:
    return f"/collaboratif/espaces/{identity(space)}/chat?group={identity(group)}"


def dispatch_batch(db: Any, batch_size: int=24) -> dict:
    """Worker at-least-once; chaque ligne unique représente UN appareil."""
    if not worker_ready():
        return {"claimed": 0, "sent":0,"skipped":0,"errors":0,"disabled":True}
    from pywebpush import webpush, WebPushException
    items = _rpc_data(db,"oria_collab_push_claim_p16",{"p_limit":batch_size}).get("deliveries",[])
    outcome={"claimed":len(items),"sent":0,"skipped":0,"errors":0}
    for d in items:
        decision="retry"; error=""; dead_device=False
        try:
            if not d.get("allowed"):
                decision="cancelled"
            else:
                gate=check_workspace(db,str(d["recipient_user_id"]),str(d["workspace_id"]))
                if not gate.allowed:
                    decision="cancelled"
                elif d.get("endpoint") and d.get("p256dh") and d.get("auth"):
                    group=str(d["group_title"])[:90]
                    body=("ORIA a répondu dans « "+group+" »." if d.get("sender_kind")=="oria"
                          else "Nouveau message dans « "+group+" ».")
                    payload={"title":"ORIA Collaboratif", "body":body,
                             "url":_safe_push_url(str(d["workspace_id"]),str(d["group_id"])),
                             "tag":f"oria-collab-{d['workspace_id']}-{d['group_id']}",
                             "event_id":d["event_id"]}
                    webpush(subscription_info={"endpoint":d["endpoint"],
                         "keys":{"p256dh":d["p256dh"],"auth":d["auth"]}},
                         data=json.dumps(payload,ensure_ascii=False),
                         vapid_private_key=os.environ["ORIA_COLLAB_VAPID_PRIVATE_KEY"],
                         vapid_claims={"sub":os.environ["ORIA_COLLAB_VAPID_SUBJECT"]},
                         ttl=600)
                    decision="sent";outcome["sent"]+=1
                else:
                    decision="cancelled"
        except WebPushException as exc:
            response=getattr(exc,"response",None)
            status=getattr(response,"status_code",None)
            error=f"webpush_{status or 'failed'}"
            if status in (404,410):
                decision="failed"; dead_device=True
            elif status in (400,401,403):
                decision="failed"  # Invalid VAPID key, configuration or subscription.
            else:
                decision="retry"
            outcome["errors"]+=1
        except Exception as exc:
            error=type(exc).__name__
            logger.exception("P16 push delivery failed")
            outcome["errors"]+=1
        if decision=="cancelled":outcome["skipped"]+=1
        try:
            _rpc_data(db,"oria_collab_push_finish_p16",{
                "p_delivery_id":d["delivery_id"],"p_lease_token":d["lease_token"],
                "p_outcome":decision,"p_error":error[:180]})
        except Exception:
            logger.exception("P16 push finalization failed; lease will expire")
        if dead_device:
            try:
                db.table("oria_collab_push_devices_p16").delete()\
                    .eq("id",d["device_id"]).execute()
            except Exception:
                logger.exception("P16 expired device cleanup")
    return outcome


def prune_events(db: Any) -> dict:
    """Appel du worker seulement, et non depuis les requêtes des utilisateurs."""
    if not worker_ready():return {"success":False}
    return _rpc_data(db,"oria_collab_push_prune_p16",{})
