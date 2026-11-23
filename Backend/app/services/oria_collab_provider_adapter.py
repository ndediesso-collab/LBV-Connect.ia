"""Pont de modèle/fournisseur pour ORIA Collaboratif.

Source de vérité : routeur Chat principal (modèles autorisés par pack,
fournisseur unique actif, tarifs/tokens fournisseur). Les quotas, salles et
réservations restent ceux du Collaboratif. Aucun fallback de fournisseur.
"""
from __future__ import annotations

import asyncio
from dataclasses import dataclass
from decimal import Decimal

from fastapi import HTTPException

from app.services.chat_provider_router import (
    ChatModelNotAvailableError, ChatProvider, ChatProviderConfigurationError,
    ChatProviderSelection, active_chat_provider, select_chat_model,
)
from app.services.token_billing_service import (
    TokenBillingService, OpenRouterTokenBillingService,
)


@dataclass(frozen=True)
class CollabChatQuote:
    reserved_credits: int
    reserved_api_cost_xaf: Decimal


@dataclass(frozen=True)
class CollabChatResult:
    message: str
    credits: int
    total_cost_usd: Decimal
    total_cost_xaf: Decimal
    response_id: str
    artifact_payload: dict | None = None


def _principal_catalog():
    # Import différé : ne pas créer de cycle app.route.ai au démarrage.
    from app.route.ai import (
        _discovery_chat_rights, MODEL_OPENAI_IDS, OPENROUTER_CHAT_MODEL_IDS,
        _ORIA_CHAT_DISPLAY_NAMES,
    )
    return _discovery_chat_rights, MODEL_OPENAI_IDS, OPENROUTER_CHAT_MODEL_IDS, _ORIA_CHAT_DISPLAY_NAMES


def models_for_collab_pack(pack_id: str) -> dict:
    """Même allowlist server-side et labels que GET /ai/chat/capabilities."""
    try:
        provider = active_chat_provider()
        rights, openai, openrouter, labels = _principal_catalog()
        allowed = rights(provider).get(str(pack_id))
        if allowed is None:
            raise HTTPException(403, 'Pack ORIA inconnu pour le fournisseur actif.')
        catalog = openai if provider is ChatProvider.OPENAI else openrouter
        items = [
            {'id': key, 'label': label, 'reasoning_modes': ['fast', 'balanced', 'deep']}
            for key, label in labels.items() if key in allowed and key in catalog
        ]
        return {'provider': provider.value, 'models': [m['id'] for m in items],
                'model_catalog': items, 'reasoning_modes': ['fast', 'balanced', 'deep']}
    except ChatProviderConfigurationError as exc:
        raise HTTPException(503, str(exc)) from exc


def selection_for_collab_pack(model: str, pack_id: str) -> ChatProviderSelection:
    """Validation modèle/pack/fournisseur identique au Chat principal."""
    try:
        provider = active_chat_provider()
        rights, openai, openrouter, _labels = _principal_catalog()
        frozen_flags = ({'ORIA_OPENAI_ENABLED': '1', 'ORIA_OPENROUTER_ENABLED': '0'}
                        if provider is ChatProvider.OPENAI else
                        {'ORIA_OPENAI_ENABLED': '0', 'ORIA_OPENROUTER_ENABLED': '1'})
        return select_chat_model(
            oria_model=model, pack_id=str(pack_id), environ=frozen_flags,
            allowed_models_by_pack=rights(provider),
            openai_model_ids=openai, openrouter_model_ids=openrouter,
            trial_authorized=False,
        )
    except ChatModelNotAvailableError as exc:
        raise HTTPException(403, str(exc)) from exc
    except ChatProviderConfigurationError as exc:
        raise HTTPException(503, str(exc)) from exc


def quote_collab_text(
    selection: ChatProviderSelection, *, estimated_input_tokens: int,
    max_output_tokens: int, reasoning_mode: str, message: str, history: list[dict],
    artifact_types: tuple[str, ...] = (),
    web_enabled: bool = False,
) -> CollabChatQuote:
    """Tarification du fournisseur réellement appelé, sans devis OpenRouter fictif."""
    if reasoning_mode not in ('fast', 'balanced', 'deep'):
        raise ValueError('Mode de raisonnement non autorisé.')
    if selection.provider is ChatProvider.OPENAI:
        credits, xaf = TokenBillingService.estimate_reservation(
            model=selection.oria_model, estimated_input_tokens=estimated_input_tokens,
            max_output_tokens=max_output_tokens, web_enabled=web_enabled,
            include_api_cost=True,
        )
    elif selection.provider is ChatProvider.OPENROUTER:
        from app.route.ai import _oria_openrouter_service
        service = _oria_openrouter_service()
        service.build_request(
            model=selection.api_model, message=message, history=history,
            reasoning_mode=reasoning_mode, web=web_enabled,
            artifact_types=artifact_types, max_completion_tokens=max_output_tokens,
        )
        quote = OpenRouterTokenBillingService.estimate_reservation(
            provider_model=selection.api_model,
            estimated_input_tokens=estimated_input_tokens,
            max_output_tokens=max_output_tokens, web_enabled=web_enabled,
        )
        credits, xaf = quote.reserved_credits, quote.reserved_api_cost_xaf
    else:
        raise ValueError('Fournisseur Chat non configuré.')
    if type(credits) is not int or credits < 1:
        raise ValueError('Réservation de crédits invalide.')
    return CollabChatQuote(reserved_credits=credits, reserved_api_cost_xaf=Decimal(str(xaf)))


async def execute_collab_text(
    selection: ChatProviderSelection, *, message: str, history: list[dict],
    reasoning_mode: str, max_output_tokens: int,
    artifact_types: tuple[str, ...] = (),
    web_enabled: bool = False,
) -> CollabChatResult:
    """Un seul appel fournisseur, aucun retry automatique après la réservation."""
    if selection.provider is ChatProvider.OPENAI:
        from app.services.openai_service import OpenAIService
        response = await asyncio.to_thread(
            OpenAIService().chat, model=selection.api_model, message=message,
            history=history, reasoning_mode=reasoning_mode, web=web_enabled,
            artifact_types=artifact_types, max_output_tokens=max_output_tokens,
        )
        usage = response.get('usage')
        if not isinstance(usage, dict):
            raise RuntimeError('Usage OpenAI absent : rapprochement nécessaire.')
        web_calls=response.get('web_search_calls') if web_enabled else 0
        if type(web_calls) is not int or web_calls < 0:
            raise RuntimeError('Compteur des recherches Web absent ou invalide : rapprochement requis.')
        bill = TokenBillingService.calculate(
            model=selection.oria_model, usage=usage, web_search_calls=web_calls)
        provider_id = str(response.get('provider_response_id') or '').strip()
        response_text = response.get('message')
        credits, usd, xaf = bill.credits, bill.total_cost_usd, bill.total_cost_xaf
    elif selection.provider is ChatProvider.OPENROUTER:
        from app.route.ai import _oria_openrouter_service
        response = await asyncio.to_thread(
            _oria_openrouter_service().chat, model=selection.api_model,
            message=message, history=history, reasoning_mode=reasoning_mode,
            web=web_enabled, artifact_types=artifact_types,
            max_completion_tokens=max_output_tokens,
        )
        bill = OpenRouterTokenBillingService.calculate(response)
        if len(bill.request_ids) != 1:
            raise RuntimeError('Identifiant fournisseur OpenRouter incertain.')
        provider_id = bill.request_ids[0]
        response_text = response.get('message')
        credits, usd, xaf = bill.credits, bill.total_cost_usd, bill.total_cost_xaf
    else:
        raise RuntimeError('Fournisseur non autorisé.')
    if not isinstance(provider_id, str) or not provider_id or len(provider_id) > 256:
        raise RuntimeError('Identifiant fournisseur absent : rapprochement requis.')
    if artifact_types:
        if not isinstance(response.get('artifact_payload'), dict):
            raise RuntimeError('Contrat documentaire non livré par le fournisseur.')
        # JSON payload is NEVER displayed or persisted as a text chat answer.
        response_text = ''
    elif not isinstance(response_text, str) or not response_text.strip():
        raise RuntimeError('Réponse fournisseur vide : rapprochement requis.')
    if type(credits) is not int or credits < 1:
        raise RuntimeError('Coût fournisseur invalide.')
    return CollabChatResult(
        message=response_text, credits=credits,
        total_cost_usd=Decimal(str(usd)), total_cost_xaf=Decimal(str(xaf)),
        response_id=provider_id,
        artifact_payload=response.get('artifact_payload') if artifact_types else None,
    )
