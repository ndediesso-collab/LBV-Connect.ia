"""ORIA Collaboratif 5B: group @ORIA, shared quota, one billable provider call.

Server flags are OFF by default. Chariow's +5000-message product is separate:
phase 5B never creates a payment nor increases a group message_limit.
"""
from __future__ import annotations

import asyncio
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
        models = OPENROUTER_CHAT_ALLOWED_MODELS_BY_PACK.get(ctx["pack_id"], frozenset())
        available = [name for name in sorted(models)
                     if name in OPENROUTER_CHAT_MODEL_IDS
                     and OPENROUTER_CHAT_MODEL_IDS[name].startswith(("openai/", "anthropic/"))]
        return {"success": True, "models": available, "provider": "openrouter",
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
                  workspace_id: str | None = None) -> dict:
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
        allow = OPENROUTER_CHAT_ALLOWED_MODELS_BY_PACK.get(ctx["pack_id"], frozenset())
        api_model = OPENROUTER_CHAT_MODEL_IDS.get(model)
        if model not in allow or not api_model or not api_model.startswith(("openai/", "anthropic/")):
            raise HTTPException(403, "Modèle non autorisé par le pack professionnel.")
        from app.services.chat_provider_router import ChatProvider, active_chat_provider
        if active_chat_provider() is not ChatProvider.OPENROUTER:
            raise HTTPException(503, "OpenRouter doit être actif pour @ORIA dans les groupes.")
        from app.services.token_billing_service import OpenRouterTokenBillingService, TokenBillingError
        from app.services.conversation_memory_utils import estimate_text_tokens
        from app.services.openrouter_chat_service import OpenRouterChatError
        from app.route.ai import _oria_openrouter_service, MODEL_ACTIONS
        from app.repositories.supabase_credit_repository import SupabaseCreditRepository

        action = MODEL_ACTIONS.get(model, {}).get("normal")
        if action is None:
            raise HTTPException(403, "Action du modèle absente du catalogue ORIA.")
        # RPC already checks group membership, pack validity and workspace.
        # No cross-group history is loaded. Historical messages belong ONLY to group_id.
        recent = (_safe_rpc(self.db,"oria_collab_workspace_group_messages_v3", {
            "p_actor_user_id":actor_id,"p_workspace_id":workspace_id,
            "p_group_id":group_id,"p_before_message_id":None,"p_limit":28,
        }) if workspace_id is not None else self.groups.messages(actor_id, group_id, None, 28))
        raw_messages = recent.get("messages", [])
        history = []
        for row in raw_messages:
            content = str(row.get("content") or "")
            if not content:
                continue
            if row.get("sender_kind") == "oria":
                history.append({"role": "assistant", "content": content})
            else:
                history.append({"role": "user", "content": "[Message du groupe] " + content})
        # Revalidate on every DB write in reserve; read-history is informational.
        tokens = max(1, estimate_text_tokens(clean)
                     + sum(estimate_text_tokens(item["content"]) for item in history) + 512)
        if tokens > 30000:
            raise HTTPException(413, "Le contexte du groupe est trop volumineux.")
        max_output = 4096 if reasoning_mode == "deep" else 2048
        try:
            service = _oria_openrouter_service()
            service.build_request(model=api_model, message=clean, history=history,
                                  reasoning_mode=reasoning_mode, web=False,
                                  max_completion_tokens=max_output)
            quote = OpenRouterTokenBillingService.estimate_reservation(
                provider_model=api_model, estimated_input_tokens=tokens,
                max_output_tokens=max_output, web_enabled=False)
            limit_xaf = SupabaseCreditRepository._pack_budget_limit(ctx["pack_id"])
            budget_on = SupabaseCreditRepository._api_budget_enabled()
        except (OpenRouterChatError, TokenBillingError, ValueError) as exc:
            raise HTTPException(503, "Modèle ou devis de réservation indisponible.") from exc

        reserved = _safe_rpc(self.db,
            "oria_collab_group_ai_reserve_v3" if workspace_id is not None
            else "oria_collab_group_ai_reserve", {
            "p_actor_user_id": actor_id, "p_group_id": group_id,
            "p_request_id": request_id, "p_model": api_model,
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
        try:
            output = await asyncio.to_thread(
                service.chat, model=api_model, message=clean,
                history=history, reasoning_mode=reasoning_mode,
                web=False, max_completion_tokens=max_output,
            )
            billing = OpenRouterTokenBillingService.calculate(output)
            answer = output.get("message")
            if not isinstance(answer, str) or not answer.strip() or len(answer) > 4000:
                # 5A group messages cap at 4000 chars; hold for reconciliation.
                raise RuntimeError("group_answer_invalid")
            if len(billing.request_ids) != 1 or billing.credits > quote.reserved_credits:
                raise RuntimeError("group_billing_needs_review")
            settled = _safe_rpc(self.db,
                "oria_collab_group_ai_settle_v3" if workspace_id is not None
                else "oria_collab_group_ai_settle", {
                "p_actor_user_id": actor_id, "p_request_id": request_id,
                "p_actual_credits": billing.credits,
                "p_provider_response_id": billing.request_ids[0],
                "p_provider_cost_usd": str(billing.total_cost_usd),
                "p_actual_api_cost_xaf": str(billing.total_cost_xaf),
                "p_response": answer,
                **({"p_workspace_id": workspace_id} if workspace_id is not None else {}),
            })
            return {"success": True, "replayed": False, "request_id": request_id,
                    "message": settled["response"], "cost": settled["cost"],
                    "shares": settled.get("shares", [])}
        except Exception as exc:
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
