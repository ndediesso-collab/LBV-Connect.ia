"""Scoped frontend entrypoint into existing mono-space AI routines.

AI SQL 4C/5B still assumes a unique workspace per user. The SQL identity RPC
fails closed as soon as that unique index is removed. This service therefore
cannot accidentally become a multi-workspace financial implementation.
"""
from __future__ import annotations

import os
from typing import Any
from uuid import UUID

from fastapi import HTTPException


def enabled() -> bool:
    return (os.getenv("ORIA_COLLAB_SCOPED_AI_ENABLED", "0") == "1"
            and os.getenv("ORIA_COLLABORATIF_ENABLED", "0") == "1"
            and os.getenv("ORIA_COLLAB_WORKSPACE_CONTEXT_ENABLED", "0") == "1")


def validated_uuid(value: str) -> str:
    try:
        return str(UUID(str(value)))
    except (TypeError, ValueError, AttributeError) as exc:
        raise HTTPException(422, "Identifiant d'espace invalide.") from exc


class ScopedAiWorkspaceService:
    def __init__(self, db: Any):
        self.db = db

    def authorize(self, actor: str, workspace: str, kind: str, target: str | None) -> dict:
        if not enabled():
            raise HTTPException(503, "L'IA contextualisée n'est pas encore activée.")
        actor_id, space_id = validated_uuid(actor), validated_uuid(workspace)
        if kind not in {"workspace", "private", "group"}:
            raise HTTPException(422, "Type d'opération invalide.")
        target_id = validated_uuid(target) if target else None
        if kind != "workspace" and not target_id:
            raise HTTPException(422, "Objet professionnel requis.")
        try:
            response = self.db.rpc("oria_collab_ai_workspace_identity_v7", {
                "p_actor_user_id": actor_id, "p_workspace_id": space_id,
                "p_target_id": target_id, "p_kind": kind,
            }).execute()
            data = getattr(response, "data", None)
            if isinstance(data, list) and len(data) == 1:
                data = data[0]
            if (not isinstance(data, dict) or data.get("success") is not True
                    or data.get("actor_user_id") != actor_id
                    or data.get("workspace_id") != space_id
                    or data.get("kind") != kind or data.get("target_id") != target_id):
                raise RuntimeError("collab015_scope_rpc_mismatch")
            return data
        except HTTPException:
            raise
        except Exception as exc:
            msg = str(exc).lower()
            if "collab015_multi_ai_not_ready" in msg:
                raise HTTPException(503, "L'IA multi-espaces n'est pas encore raccordée.") from exc
            if "collab015_" in msg and any(x in msg for x in ("forbidden", "inactive", "invalid")):
                raise HTTPException(404, "Objet inaccessible dans cet espace.") from exc
            raise HTTPException(503, "Vérification de l'espace impossible.") from exc

    def models(self, actor: str, space: str) -> dict:
        if not enabled():
            raise HTTPException(503,"Modèles IA professionnels désactivés.")
        actor_id, space_id = validated_uuid(actor), validated_uuid(space)
        try:
            data = getattr(self.db.rpc("oria_collab_scope_write_auth_v5", {
                "p_actor_user_id":actor_id,"p_workspace_id":space_id,
                "p_owner_only":False,
            }).execute(), "data", None)
            if isinstance(data,list) and len(data)==1:
                data = data[0]
            if (not isinstance(data,dict) or data.get("success") is not True
                or data.get("workspace_id") != space_id or data.get("member_user_id") != actor_id):
                raise RuntimeError("collab016_model_scope_invalid")
        except Exception as exc:
            raise HTTPException(404,"Accès aux modèles de cet espace refusé.") from exc
        from app.services.oria_collab_provider_adapter import models_for_collab_pack
        from app.services.oria_collab_group_ai_service import group_ai_enabled
        from app.services.oria_collab_private_chat_service import private_chat_enabled, mixed_billing_enabled
        catalog = models_for_collab_pack(str(data.get("pack_id")))
        return {"success":True,"workspace_id":space_id,**catalog,
                "group_ai_enabled":group_ai_enabled(),
                "private_ai_enabled":private_chat_enabled() and mixed_billing_enabled()}

    async def private_ask(self, actor: str, space: str, conversation: str,
                          request_id: str, model: str, message: str, reasoning_mode: str) -> dict:
        self.authorize(actor, space, "private", conversation)
        from app.services.oria_collab_private_chat_service import PrivateChatService
        answer = await PrivateChatService(self.db).chat(
            validated_uuid(actor), conversation_id=validated_uuid(conversation),
            request_id=validated_uuid(request_id), model=model, message=message,
            reasoning_mode=reasoning_mode, workspace_id=validated_uuid(space),
        )
        return {**answer, "workspace_id": validated_uuid(space)}

    async def group_ask(self, actor: str, space: str, group: str,
                        request_id: str, model: str, prompt: str, reasoning_mode: str) -> dict:
        self.authorize(actor, space, "group", group)
        from app.services.oria_collab_group_ai_service import GroupAiService
        answer = await GroupAiService(self.db).ask(
            validated_uuid(actor), group_id=validated_uuid(group),
            request_id=validated_uuid(request_id), model=model,
            prompt=prompt, reasoning_mode=reasoning_mode, workspace_id=validated_uuid(space),
        )
        return {**answer, "workspace_id": validated_uuid(space)}
