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
        preferences = None
        try:
            saved = (self.db.table('oria_collab_chat_preferences')
                     .select('provider,model,reasoning_mode')
                     .eq('workspace_id', space_id).eq('user_id', actor_id)
                     .limit(1).execute().data or [])
            if saved and saved[0].get('provider') == catalog['provider']:
                chosen = str(saved[0].get('model') or '')
                chosen_mode = str(saved[0].get('reasoning_mode') or '')
                offered = {x['id']: x for x in catalog['model_catalog']}
                if chosen in offered and chosen_mode in offered[chosen]['reasoning_modes']:
                    preferences = {'model': chosen, 'reasoning_mode': chosen_mode}
        except Exception:
            # Si la migration n'est pas encore installée, le catalogue IA reste accessible.
            pass
        return {"success":True,"workspace_id":space_id,**catalog,
                "preferences":preferences,
                "group_ai_enabled":group_ai_enabled(),
                "private_ai_enabled":private_chat_enabled() and mixed_billing_enabled()}

    def save_preferences(self, actor: str, space: str, model: str,
                         reasoning_mode: str) -> dict:
        # Revalide le membre, le pack et le fournisseur actif à chaque écriture.
        verified = self.models(actor, space)
        offered = {item['id']: item for item in verified['model_catalog']}
        if model not in offered:
            raise HTTPException(403, 'Modèle non autorisé pour ce pack/fournisseur.')
        if reasoning_mode not in offered[model]['reasoning_modes']:
            raise HTTPException(422, 'Niveau de raisonnement invalide.')
        values = {'workspace_id': validated_uuid(space),
                  'user_id': validated_uuid(actor),
                  'provider': verified['provider'], 'model': model,
                  'reasoning_mode': reasoning_mode}
        try:
            (self.db.table('oria_collab_chat_preferences')
             .upsert(values, on_conflict='workspace_id,user_id').execute())
        except Exception as exc:
            raise HTTPException(503, 'Préférences non enregistrées sur le serveur.') from exc
        return {'success': True, 'workspace_id': validated_uuid(space),
                'preferences': {'model': model, 'reasoning_mode': reasoning_mode}}

    def plan_artifacts(self, actor: str, space: str, kind: str, target: str,
                       message: str, artifact_type: str | None = None) -> dict:
        # La vérification d'appartenance PRECEDE toute lecture de catalogue.
        self.authorize(actor, space, kind, target)
        from app.services.oria_collab_shared_artifacts import (
            plan_shared_artifacts, shared_artifact_capabilities,
        )
        catalog = shared_artifact_capabilities()
        requests = plan_shared_artifacts(message, explicit_type=artifact_type)
        return {'success': True, 'workspace_id': validated_uuid(space),
                'target_id': validated_uuid(target), 'kind': kind,
                'requests': requests, **catalog, 'credits_reserved': False}

    async def private_ask(self, actor: str, space: str, conversation: str,
                          request_id: str, model: str, message: str, reasoning_mode: str,
                          web: bool = False) -> dict:
        self.authorize(actor, space, "private", conversation)
        # PrivateChatService does the document preflight BEFORE the reserve RPC,
        # keeping the identical principal-chat generator and its financial guard.
        from app.services.oria_collab_private_chat_service import PrivateChatService
        answer = await PrivateChatService(self.db).chat(
            validated_uuid(actor), conversation_id=validated_uuid(conversation),
            request_id=validated_uuid(request_id), model=model, message=message,
            reasoning_mode=reasoning_mode, workspace_id=validated_uuid(space), web=web,
        )
        return {**answer, "workspace_id": validated_uuid(space)}

    async def group_ask(self, actor: str, space: str, group: str,
                        request_id: str, model: str, prompt: str, reasoning_mode: str,
                        web: bool = False) -> dict:
        self.authorize(actor, space, "group", group)
        # P2: GroupAiService validates intent, feature flag and billing before
        # calling the SAME principal-chat artifact compiler.
        from app.services.oria_collab_group_ai_service import GroupAiService
        answer = await GroupAiService(self.db).ask(
            validated_uuid(actor), group_id=validated_uuid(group),
            request_id=validated_uuid(request_id), model=model,
            prompt=prompt, reasoning_mode=reasoning_mode, workspace_id=validated_uuid(space),web=web,
        )
        return {**answer, "workspace_id": validated_uuid(space)}

    def latest_group_delivery(self, actor: str, space: str, group: str) -> dict:
        """Authoritative newest unfinished group request; no provider calls/credit changes.

        Makes old uncertain jobs visible after browser navigation and on new devices.
        All reads require the existing group/workspace membership RPC first.
        """
        self.authorize(actor, space, "group", group)
        ws, room = validated_uuid(space), validated_uuid(group)
        try:
            response = (self.db.table("oria_collab_group_ai_jobs")
                        .select("id,state,created_at")
                        .eq("workspace_id", ws).eq("group_id", room)
                        .in_("state", ["reserved", "uncertain", "needs_review"])
                        .order("created_at", desc=True).limit(1).execute())
            rows = getattr(response, "data", None) or []
        except Exception as exc:
            raise HTTPException(503, "État des requêtes de groupe indisponible.") from exc
        if not rows:
            return {"success": True, "workspace_id": ws,
                    "group_id": room, "active": False}
        job = rows[0]
        state = str(job.get("state") or "")
        if state not in {"reserved", "uncertain", "needs_review"}:
            raise HTTPException(503, "État de génération incohérent.")
        return {"success": True, "workspace_id": ws, "group_id": room,
                "active": True, "request_id": str(job["id"]), "state": state}

    def delivery_status(self, actor: str, space: str, kind: str,
                        target: str, request_id: str) -> dict:
        """Read-only job status, scope authorized before service-role DB access.

        Never exposes other employees' balances, provider secrets or prompts.
        A failed/uncertain job is NOT a reason to debit or retry a provider.
        """
        if kind not in {"private", "group"}:
            raise HTTPException(422, "Type de conversation invalide.")
        ctx = self.authorize(actor, space, kind, target)
        ws, room, request = validated_uuid(space), validated_uuid(target), validated_uuid(request_id)
        table = ("oria_collab_group_ai_jobs" if kind == "group"
                 else "oria_collab_private_chat_jobs")
        column = "group_id" if kind == "group" else "conversation_id"
        try:
            result = (self.db.table(table).select("id,state,actual_credits")
                      .eq("id", request).eq("workspace_id", ws).eq(column, room)
                      .limit(1).execute())
            rows = getattr(result, "data", None) or []
        except Exception as exc:
            raise HTTPException(503, "Statut de la demande indisponible.") from exc
        if not rows:
            raise HTTPException(404, "Demande introuvable dans ce groupe ou chat.")
        state = str(rows[0].get("state") or "")
        if state not in {"reserved", "settled", "uncertain", "needs_review", "pending", "failed"}:
            raise HTTPException(503, "État de demande inconnu ; aucun nouvel appel.")
        return {"success": True, "workspace_id": ws, "kind": kind,
                "target_id": room, "request_id": request, "state": state,
                "actual_credits": rows[0].get("actual_credits") if state == "settled" else None}

    def private_artifacts(self, actor: str, space: str, conversation: str) -> dict:
        self.authorize(actor,space,'private',conversation)
        from app.services.oria_collab_private_generated_delivery import list_private_files
        return list_private_files(self.db, actor, space, conversation)

    def private_artifact_url(self, actor: str, space: str, file_id: str) -> dict:
        # The access RPC resolves the associated conversation and verifies it.
        if not enabled():
            raise HTTPException(503,'Fichiers professionnels désactivés.')
        from app.services.oria_collab_private_generated_delivery import private_file_url
        return private_file_url(self.db,actor,space,file_id)
