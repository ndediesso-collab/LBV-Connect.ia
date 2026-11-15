"""ORIA gratuit: server-enforced two-result web search (OpenRouter Exa only).

Staging: no user input controls provider tool settings or price.
Neither this module nor the quote calls upstream providers.
"""
from __future__ import annotations

from urllib.parse import urlsplit

FREE_WEB_MAX_RESULTS = 2
FREE_WEB_MAX_CALLS = 1
FREE_WEB_MAX_CHARS_PER_RESULT = 1200
FREE_WEB_ADDITIONAL_INPUT_TOKENS = 3000
FREE_WEB_MODEL = "openai/gpt-6-luna"


class FreeWebUnavailable(ValueError):
    pass


def require_openrouter(provider: object) -> None:
    if getattr(provider, "value", None) != "openrouter":
        raise FreeWebUnavailable(
            "Recherche Web gratuite indisponible sur le fournisseur actuel."
        )


def validate_free_web_request(*, model: str, web: bool, max_completion_tokens: int,
                              attachments: object, history: object, artifact_types: object) -> None:
    if (model != FREE_WEB_MODEL or web is not True
            or type(max_completion_tokens) is not int or not (1 <= max_completion_tokens <= 4096)
            or attachments or history or artifact_types):
        raise FreeWebUnavailable("Paramètres de recherche Web gratuite non autorisés.")


def free_exa_tool() -> dict:
    # Fixed engine: native provider search ignores some of these restrictions.
    return {"type": "openrouter:web_search", "parameters": {
        "engine": "exa", "mode": "fast",
        "max_results": FREE_WEB_MAX_RESULTS,
        "max_uses": FREE_WEB_MAX_CALLS,
        "max_total_results": FREE_WEB_MAX_RESULTS,
        "max_characters": FREE_WEB_MAX_CHARS_PER_RESULT,
    }}


def free_web_quote(estimated_message_input_tokens: int) -> tuple[int, object]:
    if type(estimated_message_input_tokens) is not int or estimated_message_input_tokens <= 0:
        raise FreeWebUnavailable("Estimation d'entrée invalide.")
    # Reserve web snippets before dispatch; never trust a client quote.
    from app.services.token_billing_service import OpenRouterTokenBillingService
    from app.config.free_tier_policy import FREE_CHAT_OUTPUT_TOKENS_MAX
    q = OpenRouterTokenBillingService.estimate_reservation(
        provider_model=FREE_WEB_MODEL,
        estimated_input_tokens=estimated_message_input_tokens + FREE_WEB_ADDITIONAL_INPUT_TOKENS,
        max_output_tokens=FREE_CHAT_OUTPUT_TOKENS_MAX,
        web_enabled=True,
        max_web_calls=FREE_WEB_MAX_CALLS,
    )
    return q.reserved_credits, q.reserved_api_cost_xaf


def check_web_result(result: dict) -> dict:
    """Reject out-of-contract provider telemetry; never hide a billable attempt.

    Limits executed server tools at dispatch. Citation checks are a secondary
    sanity check; they do not substitute for the Exa max_results limit.
    """
    if not isinstance(result, dict):
        raise FreeWebUnavailable("Résultat fournisseur invalide.")
    usage = result.get("provider_usage")
    if not isinstance(usage, dict) or usage.get("provider") != "openrouter":
        raise FreeWebUnavailable("Usage fournisseur manquant.")
    searches = usage.get("web_search_requests")
    if searches is not None and (type(searches) is not int or not (0 <= searches <= FREE_WEB_MAX_CALLS)):
        raise FreeWebUnavailable("Recherche Web hors plafond : rapprochement nécessaire.")
    citations = result.get("citations") or []
    if not isinstance(citations, list):
        raise FreeWebUnavailable("Citations fournisseur invalides.")
    domains: set[str] = set()
    for c in citations:
        if not isinstance(c, dict):
            raise FreeWebUnavailable("Citation invalide.")
        url = c.get("url") or c.get("source_url") or ""
        if url:
            parsed = urlsplit(str(url))
            if parsed.scheme not in {"http", "https"} or not parsed.hostname:
                raise FreeWebUnavailable("URL de citation invalide.")
            domains.add(parsed.hostname.lower())
    if len(domains) > FREE_WEB_MAX_RESULTS:
        raise FreeWebUnavailable("Citations hors plafond : rapprochement nécessaire.")
    return {"web_search_calls": searches, "max_search_results": FREE_WEB_MAX_RESULTS,
            "cited_domains": len(domains)}
