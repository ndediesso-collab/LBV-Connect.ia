"""Free Web on current OpenAI provider, with conservative quoting.

OpenAI max_tool_calls=1 limits tool INVOCATIONS, not distinct source sites.
Do NOT advertise a 'two sites searched' guarantee for this provider.
"""
from __future__ import annotations

from app.config.free_tier_policy import FREE_CHAT_OUTPUT_TOKENS_MAX
# Reduction des longues reponses web gratuites, pas du moteur payant.
FREE_WEB_OUTPUT_TOKENS = min(FREE_CHAT_OUTPUT_TOKENS_MAX, 1536)
from app.services.chat_provider_router import ChatProvider

FREE_OPENAI_WEB_TOOL_CALLS = 1
FREE_OPENAI_WEB_SOURCE_CAP_GUARANTEED = False

class FreeOpenAIWebPolicyError(ValueError):
    pass

def require_web_provider(provider: object) -> None:
    if provider not in (ChatProvider.OPENAI, ChatProvider.OPENROUTER):
        raise FreeOpenAIWebPolicyError('Fournisseur Web gratuit non pris en charge.')

def free_provider_web_quote(provider: object, estimated_input: int):
    if type(estimated_input) is not int or estimated_input <= 0:
        raise FreeOpenAIWebPolicyError('Devis Web invalide.')
    require_web_provider(provider)
    if provider is ChatProvider.OPENROUTER:
        from app.services.free_web_policy import free_web_quote
        return free_web_quote(estimated_input)
    from app.services.token_billing_service import TokenBillingService
    # The provider can place more than two URLs in one web_search call;
    # reservation is per upstream TOOL call, not displayed citations.
    return TokenBillingService.estimate_reservation(
        model='luna', estimated_input_tokens=estimated_input + 3000,
        max_output_tokens=FREE_WEB_OUTPUT_TOKENS,
        web_enabled=True, include_api_cost=True,
        max_web_calls=FREE_OPENAI_WEB_TOOL_CALLS,
    )

def validated_openai_web_calls(result: dict) -> int:
    if not isinstance(result, dict):
        raise FreeOpenAIWebPolicyError('Réponse OpenAI invalide.')
    calls = result.get('web_search_calls')
    if type(calls) is not int or not 0 <= calls <= FREE_OPENAI_WEB_TOOL_CALLS:
        # Missing telemetry must NOT be silently rounded to 0 for billing.
        raise FreeOpenAIWebPolicyError('Compteur Web OpenAI absent ou hors plafond.')
    return calls
