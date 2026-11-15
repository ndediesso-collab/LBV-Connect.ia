"""Isolated Luna free-tier STAGING endpoints. Disabled by default.

No client amount/user id is accepted. Never releases a reservation on an
uncertain upstream error. Pack and gift routes are untouched.
"""
from __future__ import annotations

import asyncio
import logging
import os
from decimal import Decimal
from uuid import uuid4

from fastapi import APIRouter, Header, HTTPException
from pydantic import BaseModel, ConfigDict, Field

from app.config.free_tier_policy import (
    FREE_CHAT_INPUT_TOKENS_MAX, FREE_CHAT_OUTPUT_TOKENS_MAX, FREE_DAILY_CREDITS,
)
from app.services.conversation_memory_utils import estimate_text_tokens
from app.services.free_tier_gateway import FreeTierGateway
from app.services.openai_service import OpenAIService
from app.services.token_billing_service import (
    TokenBillingService, OpenRouterTokenBillingService,
)
from app.services.chat_provider_router import ChatProvider, active_chat_provider
from app.core.supabase import supabase
from app.route.ai import _authenticate_chat_user, _oria_openrouter_service, MODEL_OPENAI_IDS

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/free", tags=["ORIA Gratuit (staging)"])


class FreeChatRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    message: str = Field(min_length=1, max_length=12000)
    model: str = Field(default="luna", pattern="^luna$")
    web: bool = False
    reasoning_mode: str = Field(default="balanced", pattern="^(fast|balanced)$")


def _enabled() -> None:
    # Deliberately separate from SQL enabled. Both gates must be open.
    if os.getenv("ORIA_FREE_CHAT_STAGING_ENABLED", "0") != "1":
        raise HTTPException(status_code=503, detail="ORIA Gratuit en préparation.")


def _identity(user_id: str | None, authorization: str | None) -> str:
    return _authenticate_chat_user(user_id=user_id, authorization=authorization)


def _quote(provider: ChatProvider, tokens: int):
    if provider is ChatProvider.OPENAI:
        return TokenBillingService.estimate_reservation(
            model="luna", estimated_input_tokens=tokens,
            max_output_tokens=FREE_CHAT_OUTPUT_TOKENS_MAX,
            web_enabled=False, include_api_cost=True,
        )
    if provider is ChatProvider.OPENROUTER:
        quote = OpenRouterTokenBillingService.estimate_reservation(
            provider_model="openai/gpt-6-luna", estimated_input_tokens=tokens,
            max_output_tokens=FREE_CHAT_OUTPUT_TOKENS_MAX, web_enabled=False,
        )
        return quote.reserved_credits, quote.reserved_api_cost_xaf
    raise HTTPException(status_code=503, detail="Fournisseur IA non disponible.")


@router.get("/status")
def free_status(user_id: str | None = Header(default=None, alias="user-id"),
                authorization: str | None = Header(default=None)):
    _enabled()
    uid = _identity(user_id, authorization)
    gateway = FreeTierGateway(supabase)
    try:
        grant = gateway.grant(uid)
        if grant.get("enabled") is not True:
            raise HTTPException(status_code=503, detail="Quota gratuit inactif.")
        return {"success": True, "daily_credits": FREE_DAILY_CREDITS,
                "paid_pack_active": grant.get("paid_pack_active") is True,
                "wallet": gateway.balance(uid), "granted": grant.get("granted") is True}
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("ORIA free status unavailable")
        raise HTTPException(status_code=503, detail="Solde gratuit temporairement indisponible.") from exc


@router.post("/chat")
async def free_chat(payload: FreeChatRequest,
                    user_id: str | None = Header(default=None, alias="user-id"),
                    authorization: str | None = Header(default=None)):
    _enabled()
    uid = _identity(user_id, authorization)
    if payload.web:
        from app.services.free_web_openai_policy import require_web_provider, FreeOpenAIWebPolicyError
        try:
            require_web_provider(active_chat_provider())
        except FreeOpenAIWebPolicyError as exc:
            raise HTTPException(status_code=403, detail=str(exc)) from exc
    message = payload.message.strip()
    if not message:
        raise HTTPException(status_code=400, detail="Message vide.")
    # Conservative overhead for system prompts and formatting. No attachment
    # or stored history is accepted in this endpoint yet.
    estimated_input = estimate_text_tokens(message) + 800
    if estimated_input > FREE_CHAT_INPUT_TOKENS_MAX:
        raise HTTPException(status_code=413, detail="Message trop long pour le quota gratuit.")
    gateway = FreeTierGateway(supabase)
    try:
        grant = gateway.grant(uid)
        if grant.get("enabled") is not True:
            raise HTTPException(status_code=503, detail="Quota gratuit inactif.")
        if grant.get("paid_pack_active") is True:
            raise HTTPException(status_code=403, detail="Utilisez les crédits de votre pack actif.")
        provider = active_chat_provider()
        if payload.web:
            from app.services.free_web_openai_policy import free_provider_web_quote
            reserve_credits, reserve_api_xaf = free_provider_web_quote(provider, estimated_input)
        else:
            reserve_credits, reserve_api_xaf = _quote(provider, estimated_input)
        if reserve_credits > 200:
            # A small balance must remain useful; if provider pricing or
            # config drifts, fail closed instead of silently overspending.
            raise HTTPException(status_code=503, detail="Devis Luna indisponible pour le gratuit.")
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("ORIA free quote failed")
        raise HTTPException(status_code=503, detail="Devis Luna temporairement indisponible.") from exc
    reservation_id = str(uuid4())
    try:
        gateway.reserve(uid, reservation_id, reserve_credits, reserve_api_xaf)
    except Exception as exc:
        logger.info("ORIA free reservation blocked, type=%s", type(exc).__name__)
        raise HTTPException(status_code=402, detail="Crédits insuffisants ou quota gratuit atteint.") from exc
    # After reserve, any unknown provider result is considered potentially
    # billable. Keep the reservation for a verified reconciliation.
    try:
        if provider is ChatProvider.OPENAI:
            model_id = MODEL_OPENAI_IDS["luna"]
            result = await asyncio.to_thread(
                OpenAIService().chat, model=model_id, message=message,
                web=payload.web, attachments=[], history=[],
                free_web_limits=payload.web,
                reasoning_mode=payload.reasoning_mode,
                max_output_tokens=FREE_CHAT_OUTPUT_TOKENS_MAX,
            )
            usage = result.get("usage")
            if not isinstance(usage, dict):
                raise ValueError("Missing reliable token usage.")
            from app.services.free_web_openai_policy import validated_openai_web_calls
            calls = validated_openai_web_calls(result) if payload.web else 0
            bill = TokenBillingService.calculate(model="luna", usage=usage, web_search_calls=calls)
        else:
            service = _oria_openrouter_service()
            result = await asyncio.to_thread(
                service.chat, model="openai/gpt-6-luna", message=message,
                web=payload.web, attachments=[], history=[],
                reasoning_mode=payload.reasoning_mode,
                max_completion_tokens=FREE_CHAT_OUTPUT_TOKENS_MAX,
                free_web_limits=payload.web,
            )
            if payload.web:
                from app.services.free_web_policy import check_web_result
                check_web_result(result)
            bill = OpenRouterTokenBillingService.calculate(result)
        if bill.credits > reserve_credits:
            raise ValueError("Coût fournisseur supérieur à la réservation autorisée")
        if not isinstance(result, dict) or not isinstance(result.get("message"), str) or not result["message"].strip():
            raise ValueError("Provider result has no usable response.")
    except Exception as exc:
        logger.exception("ORIA free provider uncertain; reservation=%s", reservation_id)
        raise HTTPException(status_code=503, detail=(
            "Réponse IA incertaine. Crédits réservés en attente de rapprochement."
        )) from exc
    try:
        settlement = gateway.settle(uid, reservation_id, bill.credits, bill.total_cost_xaf)
        balance = gateway.balance(uid)
    except Exception as exc:
        logger.exception("ORIA free settlement failed; reservation=%s", reservation_id)
        raise HTTPException(status_code=503, detail="Réponse générée : vérification des crédits nécessaire.") from exc
    return {"success": True, "model": "luna", "provider": provider.value,
            "message": result["message"], "web": payload.web,
            "citations": result.get("citations", []) if payload.web else [], "cost": bill.credits,
            "credits_remaining": balance["balance"], "wallet": balance,
            "settlement_status": settlement.get("status"),
            "requires_reconciliation": settlement.get("status") == "review"}

@router.get("/capabilities")
def free_capabilities(user_id: str | None = Header(default=None, alias="user-id"),
                      authorization: str | None = Header(default=None)):
    _enabled()
    _identity(user_id, authorization)
    from app.config.free_tier_access import get_free_feature_catalog
    return {"success": True, "catalog": get_free_feature_catalog()}


@router.post("/quote")
def free_chat_quote(payload: FreeChatRequest,
                    user_id: str | None = Header(default=None, alias="user-id"),
                    authorization: str | None = Header(default=None)):
    """Preflight for one Luna request; uses the EXACT quote functions of /chat.

    Never trusts an amount supplied by the browser and NEVER reserves credits.
    """
    _enabled()
    uid = _identity(user_id, authorization)
    if payload.web:
        from app.services.free_web_openai_policy import require_web_provider, FreeOpenAIWebPolicyError
        try:
            require_web_provider(active_chat_provider())
        except FreeOpenAIWebPolicyError as exc:
            raise HTTPException(status_code=403, detail=str(exc)) from exc
    message = payload.message.strip()
    if not message:
        raise HTTPException(status_code=400, detail="Message vide.")
    input_tokens = estimate_text_tokens(message) + 800
    if input_tokens > FREE_CHAT_INPUT_TOKENS_MAX:
        raise HTTPException(status_code=413, detail="Message trop long pour le quota gratuit.")
    gateway = FreeTierGateway(supabase)
    try:
        grant = gateway.grant(uid)
        if grant.get("enabled") is not True:
            raise HTTPException(status_code=503, detail="Quota gratuit inactif.")
        if grant.get("paid_pack_active") is True:
            raise HTTPException(status_code=403,
                                detail="Utilisez les crédits de votre pack actif.")
        provider = active_chat_provider()
        if payload.web:
            from app.services.free_web_openai_policy import free_provider_web_quote
            reserved_credits, reserved_xaf = free_provider_web_quote(provider, input_tokens)
        else:
            reserved_credits, reserved_xaf = _quote(provider, input_tokens)
        balance = gateway.balance(uid)
        from app.services.free_tier_quote import make_free_chat_quote
        quote = make_free_chat_quote(
            provider=provider.value,
            reserved_credits=reserved_credits,
            reserve_api_xaf=reserved_xaf,
            balance=balance,
            max_output_tokens=FREE_CHAT_OUTPUT_TOKENS_MAX,
            input_token_budget=input_tokens,
        )
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("ORIA free preflight unavailable")
        raise HTTPException(status_code=503,
                            detail="Devis Luna temporairement indisponible.") from exc
    quote["web"] = payload.web
    quote["max_sites"] = (2 if provider is ChatProvider.OPENROUTER else None) if payload.web else 0
    quote["openai_web_call_limit"] = 1 if payload.web and provider is ChatProvider.OPENAI else None
    quote["two_sites_guaranteed"] = provider is ChatProvider.OPENROUTER if payload.web else False
    return {"success": True, "quote": quote}
