"""ORIA Collaboratif 5B: group @ORIA, shared quota, one billable provider call.

Server flags are OFF by default. Chariow's +5000-message product is separate:
phase 5B never creates a payment nor increases a group message_limit.
"""
from __future__ import annotations

import asyncio
import logging
import os
import re
from typing import Any

from fastapi import HTTPException

from app.config.credit_costs import OPENROUTER_CHAT_ALLOWED_MODELS_BY_PACK, OPENROUTER_CHAT_MODEL_IDS
from app.services.oria_collab_groups_service import CollabGroupsService

MENTION = re.compile(r"(^|[^\w])@oria(?!\w)", re.IGNORECASE)


def group_ai_enabled() -> bool:
    return (os.getenv("ORIA_COLLAB_GROUP_AI_ENABLED", "0").strip() == "1"
            and os.getenv("ORIA_COLLAB_GROUPS_ENABLED", "0").strip() == "1"
            and os.getenv("ORIA_COLLAB_QUOTAS_ENABLED", "0").strip() == "1")


def require_group_ai(*, scoped: bool = False) -> None:
    if os.getenv("ORIA_COLLAB_MULTI_ACTIVE", "0") == "1" and not scoped:
        raise HTTPException(503,"Les anciennes routes @ORIA sont fermées en multi-espaces.")
    if not group_ai_enabled():
        raise HTTPException(503, "@ORIA n'est pas encore activé dans les groupes.")


def _safe_rpc(db: Any, name: str, params: dict) -> dict:
    try:
        result = db.rpc(name, params).execute()
        value = getattr(result, "data", None)
        if isinstance(value, list) and len(value) == 1:
            value = value[0]
        if not isinstance(value, dict) or value.get("success") is not True:
            raise RuntimeError("collab_group_ai_invalid_result")
        return value
    except Exception as exc:
        raw = str(exc).lower()
        mapping = (
            ("collab_group_ai_previous_unfinished", 409, "Une demande @ORIA est déjà en cours ou en vérification dans ce salon."),
            ("collab_group_ai_equal_split_insufficient", 402, "Un participant n'a pas assez de crédits pour sa part égale. L'administrateur peut autoriser la répartition inégale."),
            ("collab_group_ai_insufficient_credits", 402, "Les quotas des participants sont insuffisants. Recharge ou redistribution nécessaire."),
            ("collab_group_ai_reconciliation_required", 409, "Le portefeuille professionnel nécessite un rapprochement."),
            ("collab_group_ai_message_limit", 409, "Deux places de message sont nécessaires pour la demande et la réponse @ORIA."),
            ("collab_group_ai_idempotency_conflict", 409, "La référence de demande correspond à un autre contenu."),
            ("collab_group_ai_needs_review", 409, "Cette génération doit être rapprochée avant toute reprise."),
            ("collab_group_ai_not_found", 404, "Génération introuvable."),
            ("collab_group_ai_forbidden", 403, "Génération inaccessible."),
            ("collab_group_ai_cost_overrun", 409, "Coût réel supérieur à la provision : contrôle nécessaire."),
            ("collab_group_not_participant", 403, "Vous n'êtes pas membre de ce groupe."),
            ("collab_group_archived", 409, "Ce salon est archivé."),
            ("collab_group_pack_inactive", 403, "Pack professionnel inactif."),
            ("collab_group_ai_historical_", 503, "Portefeuille principal non confirmé par Supabase."),
            ("collab_group_ai_", 503, "Opération collective indisponible : vérifier le journal du backend."),
        )
        for marker, code, message in mapping:
            if marker in raw:
                raise HTTPException(code, message) from exc
        raise HTTPException(503, "Facturation collective indisponible.") from exc


class GroupAiService:
    def __init__(self, db: Any):
        self.db = db
        self.groups = CollabGroupsService(db)

    def models(self, actor_id: str) -> dict:
        require_group_ai()
        ctx = self.groups._context(actor_id)
        from app.services.oria_collab_provider_adapter import models_for_collab_pack
        catalog = models_for_collab_pack(ctx["pack_id"])
        return {"success": True, **catalog,
                "funding": "quota_professionnel_collectif", "personal_recharges_charged": False}

    def policy(self, actor_id: str, group_id: str, allow_unequal: bool) -> dict:
        require_group_ai()
        self.groups.profiles._context(actor_id, owner_required=True)
        return _safe_rpc(self.db, "oria_collab_group_ai_policy", {
            "p_actor_user_id": actor_id, "p_group_id": group_id,
            "p_allow_unequal": allow_unequal,
        })

    def status(self, actor_id: str, request_id: str) -> dict:
        require_group_ai()
        self.groups._context(actor_id)
        return _safe_rpc(self.db, "oria_collab_group_ai_status", {
            "p_actor_user_id": actor_id, "p_request_id": request_id,
        })

    async def ask(self, actor_id: str, *, group_id: str, request_id: str,
                  model: str, prompt: str, reasoning_mode: str,
                  workspace_id: str | None = None, web: bool = False) -> dict:
        require_group_ai(scoped=workspace_id is not None)
        if workspace_id is None:
            ctx = self.groups._context(actor_id)
        else:
            ctx = _safe_rpc(self.db,"oria_collab_scope_write_auth_v5", {
                "p_actor_user_id":actor_id,"p_workspace_id":workspace_id,
                "p_owner_only":False,
            })
            if ctx.get("workspace_id") != workspace_id or ctx.get("member_user_id") != actor_id:
                raise HTTPException(404,"Espace non autorisé.")
        clean = prompt.strip() if isinstance(prompt, str) else ""
        if not 1 <= len(clean) <= 4000 or not MENTION.search(clean):
            raise HTTPException(422, "La demande doit contenir @ORIA et faire au maximum 4 000 caractères.")
        if reasoning_mode not in {"fast", "balanced", "deep"}:
            raise HTTPException(422, "Mode de raisonnement invalide.")
        from app.services.oria_collab_provider_adapter import (
            selection_for_collab_pack, quote_collab_text, execute_collab_text,
        )
        selection = selection_for_collab_pack(model, ctx["pack_id"])
        from app.services.oria_collab_shared_artifacts import (
            plan_shared_artifacts, supported_shared_legacy_requests,
        )
        from app.services.oria_collab_artifact_delivery import supported_document_requests
        from app.route.ai import _document_artifact_selection, _code_output_instruction
        artifact_requests = plan_shared_artifacts(clean)
        document_types, legacy_requests = _document_artifact_selection(artifact_requests)
        if artifact_requests:
            # All formats use the EXISTING principal-chat compiler & P2 SQL
            # settlement. Never launch a billable request if not ready.
            if workspace_id is None or os.getenv('ORIA_COLLAB_GROUP_DOCUMENTS_ENABLED', '0') != '1':
                raise HTTPException(501, 'Livraison collaborative désactivée : aucun crédit réservé.')
            if not (supported_document_requests(artifact_requests) or
                    supported_shared_legacy_requests(legacy_requests)):
                raise HTTPException(422, 'Format indisponible ou nombre de fichiers supérieur à 3.')
        provider_prompt = (_code_output_instruction(clean, []) if legacy_requests else clean)
        from app.services.conversation_memory_utils import estimate_text_tokens
        from app.route.ai import MODEL_ACTIONS
        from app.repositories.supabase_credit_repository import SupabaseCreditRepository
        action = MODEL_ACTIONS.get(model, {}).get('web' if web else 'normal')
        if action is None:
            raise HTTPException(403, "Action du modèle absente du catalogue ORIA.")
        # Historique de la salle courante uniquement. Aucun mélange d'espaces.
        visual_attachments: list[dict] = []
        recent = (_safe_rpc(self.db,"oria_collab_workspace_group_messages_v3", {
            "p_actor_user_id":actor_id,"p_workspace_id":workspace_id,
            "p_group_id":group_id,"p_before_message_id":None,"p_limit":28,
        }) if workspace_id is not None else self.groups.messages(actor_id, group_id, None, 28))
        if workspace_id is not None:
            from app.services.oria_collab_memory_v2 import group_history, document_context
            # Les RPC SQL contrôlent l'appartenance au groupe A CHAQUE page.
            history, scanned, incomplete_scan = await asyncio.to_thread(
                group_history, self.db, actor_id, workspace_id, group_id,
                clean, recent, _safe_rpc,
            )
            file_history = await asyncio.to_thread(
                document_context, self.db, actor_id, workspace_id, group_id,
                clean, _safe_rpc,
            )
            history.extend(file_history)
            from app.services.oria_collab_visual_context_v1 import collect_group_visuals
            visual_attachments, visual_context = await asyncio.to_thread(
                collect_group_visuals, self.db, actor_id, workspace_id,
                group_id, clean, _safe_rpc,
            )
            history.extend(visual_context)
            if incomplete_scan:
                history.append({'role': 'user', 'content': (
                    '[NOTE TECHNIQUE] Recherche historique bornée : tous les anciens '
                    'messages n\'ont pas été consultés. Ne prétends pas disposer '
                    'de la totalité des échanges.'
                )})
        else:
            history = []
            for row in recent.get("messages", []):
                content = str(row.get("content") or "")
                if not content:
                    continue
                role = "assistant" if row.get("sender_kind") == "oria" else "user"
                history.append({"role": role, "content": content if role == "assistant"
                                else "[Message du groupe] " + content})
        tokens = max(1, estimate_text_tokens(provider_prompt)
                     + sum(estimate_text_tokens(item["content"]) for item in history)
                     + len(visual_attachments) * 6000 + 512)
        if tokens > 30000:
            raise HTTPException(413, "Le contexte du groupe est trop volumineux.")
        max_output = (16384 if artifact_requests else
                      4096 if reasoning_mode == "deep" else 2048)
        try:
            quote = quote_collab_text(
                selection, estimated_input_tokens=tokens, max_output_tokens=max_output,
                reasoning_mode=reasoning_mode, message=provider_prompt, history=history,
                artifact_types=document_types, web_enabled=web,
                attachments=visual_attachments,
            )
            limit_xaf = SupabaseCreditRepository._pack_budget_limit(ctx["pack_id"])
            budget_on = SupabaseCreditRepository._api_budget_enabled()
        except (RuntimeError, ValueError) as exc:
            raise HTTPException(503, "Modèle ou devis fournisseur indisponible.") from exc

        # P8 preflight: fail before reserving credits if persistent streaming is not installed.
        if workspace_id is not None:
            from app.services.oria_collab_stream_store_v1 import preflight
            await asyncio.to_thread(preflight, self.db)
        reserved = _safe_rpc(self.db,
            "oria_collab_group_ai_reserve_v3" if workspace_id is not None
            else "oria_collab_group_ai_reserve", {
            "p_actor_user_id": actor_id, "p_group_id": group_id,
            "p_request_id": request_id, "p_model": selection.api_model,
            "p_prompt": clean, "p_reserve_credits": quote.reserved_credits,
            "p_action": action.value,
            "p_api_reservation_xaf": str(quote.reserved_api_cost_xaf),
            "p_pack_api_limit_xaf": limit_xaf,
            "p_budget_enabled": budget_on,
            **({"p_workspace_id": workspace_id} if workspace_id is not None else {}),
        })
        if reserved.get("created") is not True:
            if reserved.get("state") == "settled":
                return {"success": True, "replayed": True, "request_id": request_id,
                        "message": reserved.get("response"), "cost": reserved.get("actual_credits")}
            raise HTTPException(409, "Demande existante en attente. Aucun nouvel appel fournisseur n'a été lancé.")

        # BEGIN billable provider boundary: NEVER retry automatically, NEVER
        # release a reservation for uncertain delivery or missing cost.
        progress_writer = None
        try:
            if workspace_id is not None:
                from app.services.oria_collab_stream_store_v1 import ProgressWriter
                progress_writer = ProgressWriter(
                    self.db, request=request_id, workspace=workspace_id,
                    group=group_id, caller=actor_id,
                )
                await asyncio.to_thread(progress_writer.start)
            if progress_writer is not None and not artifact_requests:
                from app.services.oria_collab_streaming_v1 import execute_collab_text_streamed
                metered = await execute_collab_text_streamed(
                    selection, message=provider_prompt, history=history,
                    reasoning_mode=reasoning_mode, max_output_tokens=max_output,
                    web_enabled=web, attachments=visual_attachments,
                    generation_id=request_id, on_delta=progress_writer.delta,
                )
                try:
                    await asyncio.to_thread(progress_writer.flush)
                except Exception:
                    logging.getLogger(__name__).exception(
                        "ORIA_P8_PROGRESS_FLUSH_FAILED request_id=%s", request_id)
            else:
                # Documents/code remain non-streamed to avoid exposing artifact JSON.
                metered = await execute_collab_text(
                    selection, message=provider_prompt, history=history,
                    reasoning_mode=reasoning_mode, max_output_tokens=max_output,
                    artifact_types=document_types, web_enabled=web,
                    attachments=visual_attachments,
                )
            answer = metered.message
            staged_files = []
            if artifact_requests:
                from app.services.oria_collab_shared_artifacts import compile_shared_document_payload
                from app.services.oria_collab_artifact_delivery import (
                    stage_group_artifacts, group_document_confirmation,
                )
                if document_types:
                    generated = await compile_shared_document_payload(
                        artifact_payload=metered.artifact_payload,
                        artifact_requests=artifact_requests, generation_id=request_id,
                        reasoning_mode=reasoning_mode, model=model,
                        openai_model=selection.api_model,
                    )
                else:
                    from app.services.oria_collab_shared_artifacts import compile_shared_legacy_files
                    generated = await compile_shared_legacy_files(
                        artifact_requests=legacy_requests,
                        response_text=metered.message, requested_text=clean,
                        generation_id=request_id, reasoning_mode=reasoning_mode,
                        model=model, openai_model=selection.api_model,
                    )
                staged_files = await asyncio.to_thread(
                    stage_group_artifacts, self.db, workspace_id=workspace_id,
                    request_id=request_id, results=generated,
                )
                answer = group_document_confirmation(generated)
            if len(answer) > 4000:
                # Une reponse trop longue est a rapprocher, jamais tronquee apres debit.
                raise RuntimeError("group_answer_invalid")
            if metered.credits > quote.reserved_credits:
                raise RuntimeError("group_billing_needs_review")
            # Provider proof persisted BEFORE credit settlement: safe replay
            # can finish SQL settlement WITHOUT a second external API request.
            if progress_writer is not None:
                await asyncio.to_thread(
                    progress_writer.receipt, response=answer,
                    credits=metered.credits, provider_id=metered.response_id,
                    cost_usd=str(metered.total_cost_usd),
                    cost_xaf=str(metered.total_cost_xaf), artifacts=staged_files,
                )
            settled = _safe_rpc(self.db,
                ("oria_collab_group_ai_settle_artifacts_v1" if artifact_requests else
                 "oria_collab_group_ai_settle_v3") if workspace_id is not None
                else "oria_collab_group_ai_settle", {
                "p_actor_user_id": actor_id, "p_request_id": request_id,
                "p_actual_credits": metered.credits,
                "p_provider_response_id": metered.response_id,
                "p_provider_cost_usd": str(metered.total_cost_usd),
                "p_actual_api_cost_xaf": str(metered.total_cost_xaf),
                "p_response": answer,
                **({"p_workspace_id": workspace_id} if workspace_id is not None else {}),
                **({"p_artifacts": staged_files} if artifact_requests else {}),
            })
            if artifact_requests and (settled.get('artifact_count') != len(staged_files)
                                      or not settled.get('message_id')):
                raise RuntimeError('Réponse et fichiers non rapprochés.')
            if progress_writer is not None:
                try:
                    await asyncio.to_thread(progress_writer.settled)
                except Exception:
                    logging.getLogger(__name__).exception(
                        "ORIA_P8_PROGRESS_AFTER_SETTLE_FAILED request_id=%s", request_id)
            return {"success": True, "replayed": False, "request_id": request_id,
                    "message": settled["response"], "cost": settled["cost"],
                    "shares": settled.get("shares", []),
                    "files": settled.get("files", []) if artifact_requests else []}
        except Exception as exc:
            if progress_writer is not None:
                await asyncio.to_thread(progress_writer.uncertain)
            # Diagnostic sûr : référencer l'exception côté serveur avant de bloquer
            # le solde. Ne jamais envoyer les détails fournisseur au navigateur.
            logging.getLogger(__name__).exception(
                "ORIA_COLLAB_GROUP_AI_UNCERTAIN request_id=%s group_id=%s workspace_id=%s",
                request_id, group_id, workspace_id,
            )
            try:
                _safe_rpc(self.db,
                    "oria_collab_group_ai_uncertain_v3" if workspace_id is not None
                    else "oria_collab_group_ai_uncertain", {
                    "p_actor_user_id": actor_id, "p_request_id": request_id,
                    **({"p_workspace_id": workspace_id} if workspace_id is not None else {}),
                })
            except Exception:
                pass  # Operator must inspect SQL + provider logs. No silent refund.
            raise HTTPException(503, "Réponse ou coût fournisseur incertain : crédits réservés pour rapprochement. Aucune relance automatique.") from exc
