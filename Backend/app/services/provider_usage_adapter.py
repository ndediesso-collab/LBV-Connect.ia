"""ORIA — normalisation des usages fournisseurs, sans aucun débit du wallet.

Important : `usage.cost` OpenRouter est un total FOURNISSEUR communiqué ;
on ne lui ajoute pas automatiquement un tarif Web qui pourrait déjà y figurer.
Une absence de coût n'est JAMAIS convertie en 0 : réconciliation nécessaire.
"""
from __future__ import annotations

from dataclasses import dataclass
from decimal import Decimal, InvalidOperation
from typing import Any, Mapping


class ProviderUsageError(ValueError):
    pass


@dataclass(frozen=True)
class NormalizedProviderUsage:
    provider: str
    model: str | None
    request_id: str | None
    input_tokens: int
    output_tokens: int
    cached_input_tokens: int
    cache_write_tokens: int
    reasoning_tokens: int
    total_tokens: int
    web_search_requests: int | None
    reported_cost_usd: Decimal | None

    @property
    def reconciliation_required(self) -> bool:
        return self.provider == "openrouter" and self.reported_cost_usd is None

    def as_oria_usage(self) -> dict[str, int]:
        """Format du calculateur OpenAI EXISTANT ; ne pas l'utiliser pour tarifer Claude."""
        return {
            "input_tokens": self.input_tokens,
            "output_tokens": self.output_tokens,
            "cached_input_tokens": self.cached_input_tokens,
            "cache_write_tokens": self.cache_write_tokens,
            "reasoning_tokens": self.reasoning_tokens,
            "total_tokens": self.total_tokens,
        }

    def to_dict(self) -> dict[str, Any]:
        """Conserve Decimal en chaîne, pour transmission JSON sans arrondi float."""
        return {
            "provider": self.provider,
            "model": self.model,
            "request_id": self.request_id,
            **self.as_oria_usage(),
            "web_search_requests": self.web_search_requests,
            "reported_cost_usd": str(self.reported_cost_usd) if self.reported_cost_usd is not None else None,
            "reconciliation_required": self.reconciliation_required,
        }


def _mapping(value: Any) -> Mapping[str, Any]:
    return value if isinstance(value, Mapping) else {}


def _integer(value: Any, key: str) -> int:
    if isinstance(value, bool) or value is None:
        raise ProviderUsageError(f"Usage manquant ou invalide : {key}.")
    try:
        number = Decimal(str(value))
    except (InvalidOperation, ValueError, TypeError):
        raise ProviderUsageError(f"Usage invalide : {key}.") from None
    if not number.is_finite() or number < 0 or number != number.to_integral_value():
        raise ProviderUsageError(f"Usage non entier ou négatif : {key}.")
    return int(number)


def _first(data: Mapping[str, Any], *keys: str) -> Any:
    for key in keys:
        if data.get(key) is not None:
            return data[key]
    return None


def _optional_int(data: Mapping[str, Any], *keys: str, default: int = 0) -> int:
    v = _first(data, *keys)
    return default if v is None else _integer(v, keys[0])


def normalize_provider_usage(
    *, provider: str, usage: Mapping[str, Any] | None,
    request_id: str | None = None, model: str | None = None,
) -> NormalizedProviderUsage:
    """Accepte OpenAI Responses ou OpenRouter Chat Completions / Responses.

    Tokens de raisonnement INCLUS dans output_tokens, cache inclus dans input.
    `web_search_requests=None` signifie que le fournisseur ne l'a pas indiqué.
    Les outils facturés et leur nombre doivent rester indépendants.
    """
    if provider not in {"openai", "openrouter"} or not isinstance(usage, Mapping):
        raise ProviderUsageError("Fournisseur ou relevé d'usage invalide.")

    inp = _integer(_first(usage, "input_tokens", "prompt_tokens"), "input_tokens")
    out = _integer(_first(usage, "output_tokens", "completion_tokens"), "output_tokens")
    inp_detail = _mapping(_first(usage, "input_tokens_details", "prompt_tokens_details"))
    out_detail = _mapping(_first(usage, "output_tokens_details", "completion_tokens_details"))
    cached = _optional_int(inp_detail, "cached_tokens")
    writes = _optional_int(inp_detail, "cache_write_tokens", "cache_creation_tokens")
    reasoning = _optional_int(out_detail, "reasoning_tokens")
    if cached + writes > inp or reasoning > out:
        raise ProviderUsageError("Tokens de cache ou de raisonnement incohérents.")

    total_raw = usage.get("total_tokens")
    total = inp + out if total_raw is None else _integer(total_raw, "total_tokens")
    if total != inp + out:
        raise ProviderUsageError("Total de tokens incohérent ; rapprocher la requête.")

    search = _first(_mapping(usage.get("server_tool_use")), "web_search_requests")
    web_count = None if search is None else _integer(search, "web_search_requests")

    # OpenAI direct est tarifé par la grille existante ; OpenRouter annonce
    # son propre coût incluant éventuellement les frais des outils hébergés.
    cost: Decimal | None = None
    if provider == "openrouter" and usage.get("cost") is not None:
        try:
            cost = Decimal(str(usage["cost"]))
        except (TypeError, ValueError, InvalidOperation):
            raise ProviderUsageError("Coût fournisseur OpenRouter invalide.") from None
        if not cost.is_finite() or cost < 0:
            raise ProviderUsageError("Coût fournisseur OpenRouter non fini ou négatif.")
    elif provider == "openai" and usage.get("cost") is not None:
        # Ne pas mélanger une éventuelle mesure OpenAI avec le tarif direct
        # existant sans décision explicite d'ORIA.
        cost = None

    return NormalizedProviderUsage(
        provider=provider,
        model=model,
        request_id=request_id,
        input_tokens=inp,
        output_tokens=out,
        cached_input_tokens=cached,
        cache_write_tokens=writes,
        reasoning_tokens=reasoning,
        total_tokens=total,
        web_search_requests=web_count,
        reported_cost_usd=cost,
    )
