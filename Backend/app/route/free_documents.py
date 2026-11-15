"""Stage 6C: simple PDF/DOCX for free Luna accounts.

Routes intentionally gated by original Phase-3 flag + Supabase grant. No API calls
on quote; no client-supplied price, reservation amount or user id trusted.
"""
from __future__ import annotations

import asyncio
import logging
from uuid import uuid4
from fastapi import APIRouter, Header, HTTPException
from pydantic import BaseModel, ConfigDict, Field

from app.config.free_tier_policy import FREE_CHAT_INPUT_TOKENS_MAX, FREE_CHAT_OUTPUT_TOKENS_MAX
from app.core.supabase import supabase
from app.route.free_chat import _enabled, _identity, _quote
from app.route.ai import _oria_openrouter_service, MODEL_OPENAI_IDS
from app.services.chat_provider_router import ChatProvider, active_chat_provider
from app.services.conversation_memory_utils import estimate_text_tokens
from app.services.free_tier_gateway import FreeTierGateway
from app.services.oria_cv_flow import analyze_cv_turn
from app.services.oria_cv_templates import cv_generation_message
from app.services.oria_cv_renderer import adapt_cv_payload
from app.services.openai_service import OpenAIService
from app.services.token_billing_service import TokenBillingService, OpenRouterTokenBillingService

router = APIRouter(prefix='/free', tags=['ORIA Gratuit - documents (staging)'])
logger = logging.getLogger(__name__)
DOCUMENT_INPUT_OVERHEAD_TOKENS = 5500
_ALLOWED = {'pdf': 'free_pdf_luna', 'docx': 'free_docx_luna'}

class FreeDocumentRequest(BaseModel):
    model_config = ConfigDict(extra='forbid')
    message: str = Field(min_length=1, max_length=12000)
    format: str = Field(pattern='^(pdf|docx)$')
    reasoning_mode: str = Field(default='balanced', pattern='^(fast|balanced)$')

class FreeDocumentConfirmRequest(FreeDocumentRequest):
    confirmed: bool = False


def _preflight(request: FreeDocumentRequest, uid: str) -> dict:
    fmt = request.format
    cv_decision = analyze_cv_turn(request.message)
    if cv_decision is not None:
        if not cv_decision.ready:
            raise HTTPException(400, cv_decision.question or 'Informations CV incomplètes.')
        if cv_decision.fmt != fmt:
            raise HTTPException(400, 'Le format du CV ne correspond pas à l’export demandé.')
    if fmt not in _ALLOWED:
        raise HTTPException(403, 'Format réservé aux packs.')
    tokens = estimate_text_tokens(request.message.strip()) + DOCUMENT_INPUT_OVERHEAD_TOKENS
    if tokens > FREE_CHAT_INPUT_TOKENS_MAX:
        raise HTTPException(413, 'Demande trop volumineuse pour ORIA Gratuit.')
    gateway = FreeTierGateway(supabase)
    grant = gateway.grant(uid)
    if grant.get('enabled') is not True:
        raise HTTPException(503, 'Quota gratuit non activé.')
    if grant.get('paid_pack_active') is True:
        raise HTTPException(403, 'Utilisez les crédits de votre pack actif.')
    provider = active_chat_provider()
    try:
        amount, api_xaf = _quote(provider, tokens)
        balance = gateway.balance(uid)
        from app.services.free_tier_quote import make_free_chat_quote
        quote = make_free_chat_quote(
            provider=provider.value, reserved_credits=amount,
            reserve_api_xaf=api_xaf, balance=balance,
            max_output_tokens=FREE_CHAT_OUTPUT_TOKENS_MAX,
            input_token_budget=tokens,
        )
        quote['action'] = _ALLOWED[fmt]
        quote['format'] = fmt
        quote['document_kind'] = 'simple'
        return {'gateway': gateway, 'provider': provider, 'quote': quote,
                'amount': amount, 'api_xaf': api_xaf, 'cv_decision': cv_decision}
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception('ORIA free document quote failed')
        raise HTTPException(503, 'Devis documentaire indisponible.') from exc

@router.post('/document/quote')
def quote_free_document(
    payload: FreeDocumentRequest,
    user_id: str | None = Header(default=None, alias='user-id'),
    authorization: str | None = Header(default=None, alias='authorization'),
):
    _enabled()
    uid = _identity(user_id, authorization)
    return {'success': True, 'quote': _preflight(payload, uid)['quote']}

@router.post('/document')
async def create_free_document(
    payload: FreeDocumentConfirmRequest,
    user_id: str | None = Header(default=None, alias='user-id'),
    authorization: str | None = Header(default=None, alias='authorization'),
):
    _enabled()
    uid = _identity(user_id, authorization)
    if payload.confirmed is not True:
        raise HTTPException(428, 'Confirmez le devis avant la génération.')
    info = _preflight(payload, uid)
    quote = info['quote']
    cv_decision = info.get('cv_decision')
    provider_message = (cv_generation_message(
        payload.message, style=cv_decision.style, fmt=payload.format,
    ) if cv_decision is not None else payload.message)
    if not quote['can_reserve_by_balance']:
        raise HTTPException(402, 'Crédits insuffisants ou opération trop coûteuse.')
    rid = str(uuid4())
    gateway = info['gateway']
    try:
        gateway.reserve(uid, rid, info['amount'], info['api_xaf'], action=_ALLOWED[payload.format])
    except Exception as exc:
        logger.info('ORIA free document reserve refused: %s', type(exc).__name__)
        raise HTTPException(402, 'Solde ou budget API indisponible.') from exc
    # An upstream failure may have been charged. We never release without proof.
    try:
        if info['provider'] is ChatProvider.OPENAI:
            model_id = MODEL_OPENAI_IDS['luna']
            result = await asyncio.to_thread(
                OpenAIService().chat, model=model_id, message=provider_message,
                web=False, attachments=[], history=[], reasoning_mode=payload.reasoning_mode,
                artifact_types=(payload.format,), max_output_tokens=FREE_CHAT_OUTPUT_TOKENS_MAX,
            )
            usage = result.get('usage')
            if not isinstance(usage, dict):
                raise ValueError('No provider usage')
            bill = TokenBillingService.calculate(model='luna', usage=usage, web_search_calls=0)
        elif info['provider'] is ChatProvider.OPENROUTER:
            model_id = 'openai/gpt-6-luna'
            result = await asyncio.to_thread(
                _oria_openrouter_service().chat, model=model_id, message=provider_message,
                web=False, attachments=[], history=[], reasoning_mode=payload.reasoning_mode,
                artifact_types=(payload.format,), max_completion_tokens=FREE_CHAT_OUTPUT_TOKENS_MAX,
            )
            bill = OpenRouterTokenBillingService.calculate(result)
        else:
            raise ValueError('Unknown active provider')
        if bill.credits > info['amount']:
            raise ValueError('Actual provider cost above authorized reserve')
        structured = result.get('artifact_payload')
        if not isinstance(structured, dict):
            raise ValueError('Document contract incomplete')
        if cv_decision is not None:
            artifacts = structured.get('artifacts')
            if not isinstance(artifacts, list) or len(artifacts) != 1:
                raise ValueError('CV: exactement un fichier structuré attendu')
            spec = artifacts[0]
            if (not isinstance(spec, dict) or spec.get('format') != payload.format
                    or not isinstance(spec.get('native_data'), dict)
                    or spec['native_data'].get('cv_v1') is not True):
                raise ValueError('CV: les données cv_v1 du modèle sont obligatoires')
            structured = adapt_cv_payload(structured, expected_style=cv_decision.style)
    except Exception as exc:
        logger.exception('ORIA free document provider/contract uncertain; reservation=%s', rid)
        raise HTTPException(503, 'Production documentaire incertaine : réservation à rapprocher.') from exc

    # Render with ORIA's existing security and conversion engine, never by
    # writing model output straight to disk. No hidden second provider call.
    created = None
    conversion_failure = False
    try:
        from app.route.ai import _render_document_results
        rendered = await asyncio.to_thread(
            _render_document_results, artifact_payload=structured,
            artifact_requests=[{'file_type': payload.format, 'filename': None}],
            generation_id=rid, attempt_id=rid,
            reasoning_mode=payload.reasoning_mode,
            model='luna', openai_model=model_id,
        )
        if len(rendered) != 1 or rendered[0].extension != payload.format:
            raise ValueError('Unexpected document count')
        created = rendered[0]
    except Exception:
        conversion_failure = True
        logger.exception('ORIA free document conversion failed; reservation=%s', rid)

    # Upstream billing must be settled exactly once, even if local conversion
    # fails: the API costs were already incurred and are measured accurately.
    try:
        settlement = gateway.settle(uid, rid, bill.credits, bill.total_cost_xaf)
        if settlement.get('status') == 'review':
            raise RuntimeError('Settlement requires reconciliation')
        balance = gateway.balance(uid)
    except Exception as exc:
        logger.exception('ORIA free document settlement failed; reservation=%s', rid)
        raise HTTPException(503, 'Usage IA à rapprocher ; aucun fichier confirmé.') from exc
    if conversion_failure or created is None:
        raise HTTPException(422, 'Le modèle a consommé des crédits, mais le fichier n’a pas pu être compilé. Réessayez avec un document plus court.')
    try:
        from app.route.ai import _persist_document_result
        public = await asyncio.to_thread(
            _persist_document_result, generated=created,
            authenticated_user_id=uid, conversation_id=None,
            source_message_id=None, model='luna',
        )
    except Exception as exc:
        logger.exception('ORIA free document storage failed; reservation=%s', rid)
        raise HTTPException(503, 'Fichier créé, mais sauvegarde privée indisponible.') from exc
    return {'success': True, 'format': payload.format, 'artifacts': [public],
            'cost': bill.credits, 'credits_remaining': balance['balance'],
            'settlement_status': settlement.get('status')}
