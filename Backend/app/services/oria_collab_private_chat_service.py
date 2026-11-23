"""ORIA Collaboratif 4A : conversations propres + usage OpenRouter mesuré.

Ne touche PAS au moteur IA / crédit historique et n'utilise PAS le pool du
propriétaire. Ce premier chat texte débite les recharges personnelles uniquement.
Fonctionnalité désactivée par défaut : ORIA_COLLAB_PRIVATE_CHAT_ENABLED=0.
"""
from __future__ import annotations

import asyncio
from decimal import Decimal
import os
from typing import Any
from uuid import UUID

from fastapi import HTTPException

from app.config.credit_costs import (
    OPENROUTER_CHAT_ALLOWED_MODELS_BY_PACK, OPENROUTER_CHAT_MODEL_IDS,
)
from app.services.oria_collab_profiles_service import CollabProfilesService


def _first(response: Any) -> dict | None:
    rows = getattr(response, "data", None) or []
    return rows[0] if isinstance(rows, list) and rows else None


def mixed_billing_enabled() -> bool:
    # Off by default, with an independent staging flag.
    return os.getenv("ORIA_COLLAB_MIXED_BILLING_ENABLED", "0").strip() == "1"


def mixed_funding_split(pack_available: int, personal_available: int, reserve: int) -> tuple[int,int]:
    """Pure helper; SQL rechecks both balances atomically under row locks."""
    if type(reserve) is not int or reserve <= 0:
        raise ValueError("Montant de réservation invalide.")
    q = max(0, int(pack_available))
    p = max(0, int(personal_available))
    from_pack = min(q, reserve)
    from_personal = reserve - from_pack
    if from_personal > p:
        raise ValueError("Crédits disponibles insuffisants.")
    return from_pack, from_personal


def mixed_funding_settle(pack_reserved: int, personal_reserved: int, actual: int) -> tuple[int,int,int,int]:
    """Charge quota first, then personal; reject overrun without silent debit."""
    if min(pack_reserved,personal_reserved)<0 or not 1 <= actual <= pack_reserved+personal_reserved:
        raise ValueError("Réservation dépassée, vérification nécessaire.")
    pack_spent = min(pack_reserved,actual)
    personal_spent = actual-pack_spent
    return pack_spent,personal_spent,pack_reserved-pack_spent,personal_reserved-personal_spent


def private_chat_enabled() -> bool:
    return os.getenv("ORIA_COLLAB_PRIVATE_CHAT_ENABLED", "0").strip() == "1"


def require_private_chat_flag(*, scoped: bool = False) -> None:
    if os.getenv("ORIA_COLLAB_MULTI_ACTIVE", "0") == "1" and not scoped:
        raise HTTPException(503, "Utiliser une conversation associée à un espace explicite.")
    if not private_chat_enabled():
        raise HTTPException(503, "Le chat privé professionnel est désactivé sur cet environnement.")


def _checked_rpc(db: Any, name: str, values: dict) -> dict:
    try:
        result = db.rpc(name, values).execute()
        value = getattr(result, "data", None)
        if isinstance(value, list) and len(value) == 1:
            value = value[0]
        if not isinstance(value, dict) or value.get("success") is not True:
            raise RuntimeError("bad_private_chat_rpc_response")
        return value
    except Exception as exc:
        message = str(exc).lower()
        errors = (
            ("collab_mix_insufficient_credits",402,
             "Quota et recharges insuffisants pour cette demande."),
            ("collab_mix_reconciliation_required",409,
             "Le portefeuille du pack doit être rapproché par l'administrateur."),
            ("collab_mix_previous_unfinished",409,
             "Une demande précédente attend un rapprochement."),
            ("collab_mix_idempotency_conflict",409,"Référence de demande déjà utilisée."),
            ("collab_mix_pack_inactive",403,"Pack professionnel expiré ou inactif."),
            ("collab_mix_member_inactive",403,"Profil professionnel inactif."),
            ("collab_mix_personal_budget_guard_required",409,
             "Recharge personnelle bloquée par le plafond API du pack ; contactez l'administrateur."),
            ("collab_mix_cost_overrun",409,
             "Coût réel supérieur à la réserve : vérification requise."),
            ("collab_mix_historical_",503,
             "Transaction du portefeuille principal non confirmée."),
            ("collab_mix_",503,
             "Débit mixte indisponible. Le support doit vérifier la référence."),
            ("collab_chat_insufficient_personal_credits",402,
             "Crédits personnels insuffisants. Achetez une recharge pour continuer."),
            ("collab_chat_previous_unfinished",409,
             "Une réponse précédente attend une vérification. Contactez l'assistance."),
            ("collab_chat_idempotency_conflict",409,"Identifiant de requête déjà utilisé."),
            ("collab_chat_pack_inactive",403,"Pack professionnel inactif ou expiré."),
            ("collab_chat_member_inactive",403,"Profil professionnel inactif."),
            ("collab_chat_seat_limit",403,"Nombre de profils actifs supérieur à la limite du pack."),
            ("collab_chat_forbidden",403,"Conversation inaccessible."),
            ("collab_chat_needs_review",409,"Réservation à rapprocher avant toute nouvelle réponse."),
            ("collab_chat_credits_overrun",409,"Coût fournisseur supérieur à la provision disponible."),
            ("collab_chat_bad_input",422,"Demande de chat invalide."),
        )
        for marker, status, text in errors:
            if marker in message:
                raise HTTPException(status, text) from exc
        raise HTTPException(503, "Opération de chat indisponible ; vérifiez le journal serveur.") from exc


class PrivateChatService:
    def __init__(self, db: Any):
        self.db = db
        self.profiles = CollabProfilesService(db)

    def context(self, uid: str, *, owner_allowed: bool = False) -> dict:
        require_private_chat_flag()
        ctx = self.profiles._context(uid, eligible_required=not owner_allowed)
        if ctx["is_owner"] and not owner_allowed:
            raise HTTPException(403, "L'administrateur utilise son chat ORIA habituel.")
        if not ctx["is_owner"] and not ctx["eligible"]:
            raise HTTPException(403, "Pack professionnel expiré.")
        return ctx

    def list_conversations(self, uid: str, member_user_id: str | None = None) -> dict:
        ctx = self.context(uid, owner_allowed=True)
        target = uid
        if ctx["is_owner"]:
            if member_user_id is not None:
                member = _first(self.db.table("oria_collab_members")
                                .select("user_id,role")
                                .eq("workspace_id",ctx["workspace_id"])
                                .eq("user_id",member_user_id).limit(1).execute())
                if not member or member["role"] != "member":
                    raise HTTPException(404,"Collaborateur introuvable dans cet espace.")
                target = member_user_id
            else:
                target = ""
        try:
            query = self.db.table("oria_collab_private_conversations")\
                .select("id,member_user_id,title,created_at,updated_at")\
                .eq("workspace_id",ctx["workspace_id"])
            if target:
                query = query.eq("member_user_id",target)
            rows = query.order("updated_at",desc=True).limit(100).execute().data or []
        except HTTPException:
            raise
        except Exception as exc:
            raise HTTPException(503,"Lecture des conversations indisponible.") from exc
        return {"success":True,"conversations":rows,"is_owner":ctx["is_owner"],
                "notice":"L'administrateur peut consulter les conversations professionnelles en lecture seule."}

    def new_conversation(self, uid: str, title: str) -> dict:
        ctx = self.context(uid)
        clean = (title or "").strip() or "Nouvelle conversation"
        if len(clean)>120:
            raise HTTPException(422,"Titre trop long.")
        try:
            value = _first(self.db.table("oria_collab_private_conversations")
                .insert({"workspace_id":ctx["workspace_id"],"member_user_id":uid,"title":clean})
                .execute())
            if not value:
                raise RuntimeError("empty_insert")
            return {"success":True,"conversation":value}
        except Exception as exc:
            raise HTTPException(503,"Impossible de créer la conversation.") from exc

    def _conversation(self, ctx: dict, conversation_id: str) -> dict:
        try:
            row = _first(self.db.table("oria_collab_private_conversations")
                .select("id,workspace_id,member_user_id,title,updated_at")
                .eq("id",conversation_id).eq("workspace_id",ctx["workspace_id"])
                .limit(1).execute())
        except Exception as exc:
            raise HTTPException(503,"Vérification de conversation indisponible.") from exc
        if not row or (not ctx["is_owner"] and row["member_user_id"]!=ctx["user_id"]):
            raise HTTPException(404,"Conversation privée introuvable.")
        return row

    def messages(self, uid: str, conversation_id: str) -> dict:
        ctx = self.context(uid, owner_allowed=True)
        convo = self._conversation(ctx,conversation_id)
        try:
            rows = self.db.table("oria_collab_private_messages")\
                .select("id,request_id,role,content,created_at")\
                .eq("conversation_id",conversation_id)\
                .order("created_at",desc=True).limit(150).execute().data or []
        except Exception as exc:
            raise HTTPException(503,"Historique indisponible.") from exc
        return {"success":True,"conversation":convo,"messages":list(reversed(rows)),
                "read_only":ctx["is_owner"],"notice":
                 "Cette conversation professionnelle peut être consultée en lecture seule par l'administrateur."}

    def job(self, uid: str, request_id: str) -> dict:
        ctx = self.context(uid)
        try:
            row = _first(self.db.table("oria_collab_private_chat_jobs")
                .select("id,state,actual_credits,assistant_message,conversation_id,funding_version,pack_reserved_credits,personal_reserved_credits")
                .eq("id",request_id).eq("member_user_id",uid)
                .eq("workspace_id",ctx["workspace_id"]).limit(1).execute())
        except Exception as exc:
            raise HTTPException(503,"État de requête indisponible.") from exc
        if not row:
            raise HTTPException(404,"Requête inconnue.")
        return {"success":True, "request_id":request_id,"state":row["state"],
                "message":row["assistant_message"] if row["state"]=="settled" else None,
                "cost":row["actual_credits"] if row["state"]=="settled" else None,
                "funding_version":row.get("funding_version",1),
                "pack_reserved":row.get("pack_reserved_credits",0),
                "personal_reserved":row.get("personal_reserved_credits",0)}

    def models(self, uid: str) -> dict:
        ctx = self.context(uid)
        from app.services.oria_collab_provider_adapter import models_for_collab_pack
        catalog = models_for_collab_pack(ctx["pack_id"])
        return {"success":True, **catalog,
                "note":("Chat texte : quota de pack prioritaire, puis crédits personnels."
                        if mixed_billing_enabled() else
                        "Chat texte non-streaming, débité sur les recharges personnelles.")}

    async def chat(self, uid: str, *, conversation_id: str, request_id: str,
                   model: str, message: str, reasoning_mode: str,
                   workspace_id: str | None = None) -> dict:
        if workspace_id is None:
            if os.getenv("ORIA_COLLAB_MULTI_ACTIVE", "0") == "1":
                raise HTTPException(503, "Chat historique désactivé en multi-espaces.")
            ctx = self.context(uid)
        else:
            require_private_chat_flag(scoped=True)
            if not mixed_billing_enabled():
                raise HTTPException(503, "Le routage mixte doit être activé pour ce chat.")
            ctx = _checked_rpc(self.db,"oria_collab_scope_write_auth_v5", {
                "p_actor_user_id":uid,"p_workspace_id":workspace_id,"p_owner_only":False,
            })
            if ctx.get("workspace_id") != workspace_id or ctx.get("member_user_id") != uid:
                raise HTTPException(404,"Accès à cet espace refusé.")
            if ctx.get("is_owner") is True:
                raise HTTPException(403,"Le propriétaire utilise son chat ORIA classique.")
            ctx = {**ctx,"user_id":uid,"eligible":True}
        self._conversation(ctx,conversation_id)
        clean = message.strip()
        if not 1<=len(clean)<=8000 or reasoning_mode not in {"fast","balanced","deep"}:
            raise HTTPException(422,"Message ou mode de raisonnement invalide.")
        from app.services.oria_collab_provider_adapter import (
            selection_for_collab_pack, quote_collab_text, execute_collab_text,
        )
        selection = selection_for_collab_pack(model, ctx["pack_id"])
        from app.services.conversation_memory_utils import estimate_text_tokens

        try:
            rows = self.db.table("oria_collab_private_messages")\
                .select("role,content").eq("conversation_id",conversation_id)\
                .order("created_at",desc=True).limit(24).execute().data or []
        except Exception as exc:
            raise HTTPException(503,"Contexte privé indisponible.") from exc
        history = [{"role":row["role"],"content":row["content"]}
                   for row in reversed(rows)]
        estimated_tokens=max(1,estimate_text_tokens(clean)+
                             sum(estimate_text_tokens(v["content"]) for v in history)+512)
        max_output=4096 if reasoning_mode=="deep" else 2048
        if estimated_tokens>30000:
            raise HTTPException(413,"Contexte trop volumineux ; ouvrez une nouvelle conversation.")
        try:
            quote = quote_collab_text(
                selection, estimated_input_tokens=estimated_tokens,
                max_output_tokens=max_output, reasoning_mode=reasoning_mode,
                message=clean, history=history,
            )
        except (RuntimeError, ValueError) as exc:
            raise HTTPException(503,"Modèle ou devis fournisseur non disponible.") from exc
        mixed = mixed_billing_enabled()
        reservation_params={
            "p_member_user_id":uid,"p_conversation_id":conversation_id,
            "p_request_id":request_id,"p_model":selection.api_model,
            "p_message":clean,"p_reserve_credits":quote.reserved_credits,
        }
        if mixed:
            if os.getenv("ORIA_COLLAB_QUOTAS_ENABLED", "0").strip() != "1":
                raise HTTPException(503,"La gestion des quotas professionnels doit être activée.")
            from app.repositories.supabase_credit_repository import SupabaseCreditRepository
            from app.route.ai import MODEL_ACTIONS
            action = MODEL_ACTIONS.get(model,{}).get("normal")
            if action is None:
                raise HTTPException(403,"Action du modèle indisponible dans le catalogue ORIA.")
            reservation_params.update({
                "p_action":action.value,
                "p_api_reservation_xaf":str(quote.reserved_api_cost_xaf),
                "p_pack_api_limit_xaf":SupabaseCreditRepository._pack_budget_limit(ctx["pack_id"]),
                "p_budget_enabled":SupabaseCreditRepository._api_budget_enabled(),
            })
        if workspace_id is not None:
            reservation_params["p_workspace_id"] = workspace_id
        reservation=_checked_rpc(
            self.db,
            ("oria_collab_reserve_private_chat_v3" if workspace_id is not None
             else "oria_collab_reserve_private_chat_v2" if mixed else "oria_collab_reserve_private_chat"),
            reservation_params,
        )
        if reservation.get("created") is not True:
            if reservation.get("state")=="settled":
                return {"success":True,"request_id":request_id,"message":reservation.get("response"),
                        "cost":reservation.get("actual_credits"),"replayed":True}
            raise HTTPException(409,"Cette demande existe déjà. Aucune nouvelle requête IA n'a été lancée.")
        # Les erreurs APRES cette ligne peuvent avoir été facturées par le fournisseur.
        # Ne JAMAIS libérer la provision sans preuve vérifiable d'absence de débit.
        try:
            metered = await execute_collab_text(
                selection, message=clean, history=history,
                reasoning_mode=reasoning_mode, max_output_tokens=max_output,
            )
            if len(metered.message)>100000:
                raise RuntimeError("provider_result_not_deliverable")
            if metered.credits>quote.reserved_credits:
                raise RuntimeError("provider_over_quote_keep_reservation")
            settle_params={
                "p_member_user_id":uid,"p_request_id":request_id,
                "p_actual_credits":metered.credits,
                "p_provider_response_id":metered.response_id,
                "p_provider_cost_usd":str(metered.total_cost_usd),
                "p_response":metered.message,
            }
            if mixed:
                settle_params["p_actual_api_cost_xaf"]=str(metered.total_cost_xaf)
            if workspace_id is not None:
                settle_params["p_workspace_id"] = workspace_id
            settled=_checked_rpc(self.db,
                ("oria_collab_settle_private_chat_v3" if workspace_id is not None
                 else "oria_collab_settle_private_chat_v2" if mixed else "oria_collab_settle_private_chat"),
                settle_params)
            return {"success":True,"request_id":request_id,"message":settled["response"],
                    "cost":settled["actual_credits"],"balance":settled.get("balance"),
                    "pack_charged":settled.get("pack_charged_credits"),
                    "personal_charged":settled.get("personal_charged_credits"),
                    "replayed":False}
        except Exception as exc:
            try:
                uncertain_args={"p_member_user_id":uid,"p_request_id":request_id,
                    "p_reason":type(exc).__name__}
                if workspace_id is not None:
                    uncertain_args["p_workspace_id"] = workspace_id
                _checked_rpc(self.db,
                    "oria_collab_mark_private_chat_uncertain_v3" if workspace_id is not None
                    else "oria_collab_mark_private_chat_uncertain", uncertain_args)
            except HTTPException:
                pass
            raise HTTPException(503,
                "Réponse non confirmée : crédits réservés pour vérification, sans second débit. "
                f"Référence de suivi : {request_id}.") from exc
