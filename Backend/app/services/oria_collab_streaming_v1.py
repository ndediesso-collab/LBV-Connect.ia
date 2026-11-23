"""Use the *existing* OpenAI/OpenRouter streaming APIs; bill only at final usage.

A provider stream is consumed once on a worker thread. The callback persists
snapshots in Postgres; it never sends raw provider content directly to HTTP.
"""
from __future__ import annotations

import asyncio
from decimal import Decimal
from collections.abc import Callable
from typing import Any

from app.services.chat_provider_router import ChatProvider, ChatProviderSelection
from app.services.oria_collab_provider_adapter import CollabChatResult
from app.services.token_billing_service import TokenBillingService, OpenRouterTokenBillingService


def _consume_stream(
    selection: ChatProviderSelection, message: str, history: list[dict],
    reasoning_mode: str, max_output_tokens: int, web_enabled: bool,
    attachments: list[dict] | None, generation_id: str,
    on_delta: Callable[[str], None],
) -> CollabChatResult:
    if selection.provider is ChatProvider.OPENAI:
        from app.services.openai_service import OpenAIService
        source = OpenAIService().chat_stream(
            model=selection.api_model, message=message, history=history,
            reasoning_mode=reasoning_mode, web=web_enabled,
            attachments=attachments, generation_id=generation_id,
            max_output_tokens=max_output_tokens,
        )
    elif selection.provider is ChatProvider.OPENROUTER:
        from app.route.ai import _oria_openrouter_service
        source = _oria_openrouter_service().chat_stream(
            model=selection.api_model, message=message, history=history,
            reasoning_mode=reasoning_mode, web=web_enabled,
            attachments=attachments, generation_id=generation_id,
            max_completion_tokens=max_output_tokens,
        )
    else:
        raise RuntimeError('Fournisseur streaming non autorisé.')

    chunks: list[str] = []
    size = 0
    final: dict[str, Any] | None = None
    for event in source:
        if not isinstance(event, dict):
            raise RuntimeError('Trame streaming fournisseur invalide.')
        kind = event.get('type')
        if kind == 'delta':
            delta = event.get('content')
            if not isinstance(delta, str):
                raise RuntimeError('Delta fournisseur invalide.')
            size += len(delta)
            if size > 4000:
                # Existing group SQL has a 4k response ceiling. Do not silently
                # truncate, settle an incomplete answer or retry the provider.
                raise RuntimeError('Réponse au-delà des 4 000 caractères autorisés.')
            chunks.append(delta)
            on_delta(delta)
        elif kind == 'usage':
            if final is not None:
                raise RuntimeError('Usage fournisseur final dupliqué.')
            final = event
        elif kind == 'artifact_error':
            raise RuntimeError('Contrat documentaire inattendu dans un chat texte.')
    answer = ''.join(chunks).strip()
    if final is None or not answer:
        raise RuntimeError('Usage final ou réponse fournisseur absent.')
    response_id = str(final.get('response_id') or '').strip()
    if not response_id or len(response_id) > 256:
        raise RuntimeError('ID fournisseur final absent : rapprochement requis.')
    if selection.provider is ChatProvider.OPENAI:
        usage = final.get('usage')
        web_count = final.get('web_search_calls') if web_enabled else 0
        if not isinstance(usage, dict) or type(web_count) is not int or web_count < 0:
            raise RuntimeError('Usage OpenAI non vérifiable.')
        bill = TokenBillingService.calculate(
            model=selection.oria_model, usage=usage, web_search_calls=web_count)
    else:
        bill = OpenRouterTokenBillingService.calculate(final)
        if len(bill.request_ids) != 1 or bill.request_ids[0] != response_id:
            raise RuntimeError('Usage OpenRouter et ID fournisseur discordants.')
    if bill.credits < 1:
        raise RuntimeError('Montant facturable invalide.')
    return CollabChatResult(
        message=answer, credits=bill.credits,
        total_cost_usd=Decimal(str(bill.total_cost_usd)),
        total_cost_xaf=Decimal(str(bill.total_cost_xaf)),
        response_id=response_id,
    )


async def execute_collab_text_streamed(
    selection: ChatProviderSelection, *, message: str,
    history: list[dict], reasoning_mode: str, max_output_tokens: int,
    web_enabled: bool, attachments: list[dict] | None,
    generation_id: str, on_delta: Callable[[str], None],
) -> CollabChatResult:
    return await asyncio.to_thread(
        _consume_stream, selection, message, history, reasoning_mode,
        max_output_tokens, web_enabled, attachments, generation_id, on_delta,
    )
