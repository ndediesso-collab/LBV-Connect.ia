"""Devis et coûts OpenRouter d'ORIA Cours, sans accès au wallet ni Supabase.

Le prix OpenRouter d'une transcription est dépendant du modèle (durée OU
jetons). La réservation audio exige donc un plafond administrateur par minute,
spécifiquement validé pour le modèle choisi. Aucun tarif OpenAI direct n'est
réutilisé par défaut.

Les résultats de coûts deviennent exploitables seulement APRÈS migration du
CourseService, des jobs/RPC, et du stockage des usages fournisseur.
"""
from __future__ import annotations

from dataclasses import dataclass
from decimal import Decimal, InvalidOperation, ROUND_CEILING
from collections.abc import Mapping, Sequence
from typing import Any

from app.config.credit_costs import (
    ACCOUNTING_USD_XAF, ORIA_CREDIT_VALUE_XAF, PACK_API_SAFETY_RESERVE_RATIO,
    COURSE_MAX_DURATION_MS, COURSE_MAX_OUTPUT_TOKENS,
)
from app.services.token_billing_service import OpenRouterTokenBillingService
from app.services.provider_usage_adapter import normalize_provider_usage


class CourseProviderCostUncertain(ValueError):
    """Dépense fournisseur potentielle : ne pas libérer la réservation."""


@dataclass(frozen=True)
class CourseOpenRouterAmount:
    cost_usd: Decimal
    cost_xaf: Decimal
    credits: int


def _positive(value: Any, field: str, *, allow_zero: bool = False) -> Decimal:
    try:
        if value is None or isinstance(value, bool):
            raise TypeError(field)
        n = Decimal(str(value))
    except (TypeError, ValueError, InvalidOperation) as exc:
        raise ValueError(f"Valeur économique invalide : {field}.") from exc
    if not n.is_finite() or n < 0 or (n == 0 and not allow_zero):
        raise ValueError(f"Valeur économique non positive : {field}.")
    return n


def _from_usd(amount: Decimal) -> CourseOpenRouterAmount:
    xaf = amount * _positive(ACCOUNTING_USD_XAF, "ACCOUNTING_USD_XAF")
    credits = max(1, int((xaf / _positive(ORIA_CREDIT_VALUE_XAF, "ORIA_CREDIT_VALUE_XAF")).to_integral_value(rounding=ROUND_CEILING)))
    return CourseOpenRouterAmount(cost_usd=amount, cost_xaf=xaf, credits=credits)


def estimate_transcription_reservation(
    *, durations_ms: Sequence[int], admin_usd_per_minute_ceiling: str | Decimal | None,
) -> CourseOpenRouterAmount:
    """Borne haute fournie/validée par l'administrateur, pas tarif réel.

    Chaque segment peut être arrondi indépendamment; le total est majorant.
    Le plafond choisi DOIT couvrir la tarification du modèle et du routage.
    """
    if not durations_ms or len(durations_ms) > 120:
        raise ValueError("Manifeste audio absent ou trop segmenté.")
    if any(type(d) is not int or d <= 0 for d in durations_ms):
        raise ValueError("Durée de segment invalide.")
    if sum(durations_ms) > COURSE_MAX_DURATION_MS:
        raise ValueError("Cours supérieur à quatre heures.")
    cap = _positive(admin_usd_per_minute_ceiling, "plafond transcription USD/min")
    minutes = sum((d + 59_999) // 60_000 for d in durations_ms)
    safety = _positive(PACK_API_SAFETY_RESERVE_RATIO, "marge", allow_zero=True)
    if safety > 1:
        raise ValueError("Marge disproportionnée.")
    return _from_usd(Decimal(minutes) * cap * (Decimal(1) + safety))


def calculate_transcription_actual(results: Sequence[Mapping[str, Any]]) -> CourseOpenRouterAmount:
    """Additionne des coûts réels par segment, jamais des prix par minute.

    Des identifiants distincts sont requis pour éviter les doubles règlements.
    """
    if not results or len(results) > 120:
        raise CourseProviderCostUncertain("Segments de transcription non confirmés.")
    seen: set[str] = set()
    total = Decimal(0)
    for item in results:
        if not isinstance(item, Mapping) or item.get("provider") != "openrouter":
            raise CourseProviderCostUncertain("Fournisseur audio non confirmé.")
        rid = item.get("response_id")
        if not isinstance(rid, str) or not rid.strip() or rid in seen:
            raise CourseProviderCostUncertain("Identifiant d'appel audio absent ou dupliqué.")
        seen.add(rid)
        if item.get("reconciliation_required") is True:
            raise CourseProviderCostUncertain("Appel audio à rapprocher.")
        amt = _positive(item.get("provider_cost_usd"), "coût audio USD", allow_zero=True)
        usage = item.get("usage")
        if not isinstance(usage, Mapping):
            raise CourseProviderCostUncertain("Usage audio manquant.")
        if usage.get("cost") is None or amt != _positive(usage["cost"], "usage.cost", allow_zero=True):
            raise CourseProviderCostUncertain("Montants audio contradictoires.")
        total += amt
    return _from_usd(total)


def estimate_writing_reservation(
    *, model: str, count: int, max_input_tokens_per_section: int,
) -> CourseOpenRouterAmount:
    """Provisionne toutes les sections AVANT l'appel, avec marge globale."""
    if type(count) is not int or not 1 <= count <= 120:
        raise ValueError("Nombre de sections invalide.")
    if type(max_input_tokens_per_section) is not int or max_input_tokens_per_section <= 0:
        raise ValueError("Plafond d'entrée invalide.")
    quote = OpenRouterTokenBillingService.estimate_reservation(
        provider_model=model, estimated_input_tokens=max_input_tokens_per_section,
        max_output_tokens=COURSE_MAX_OUTPUT_TOKENS, web_enabled=False,
    )
    return _from_usd(quote.reserved_cost_usd * count)


def calculate_writing_actual(results: Sequence[Mapping[str, Any]], *, model: str) -> CourseOpenRouterAmount:
    """Coûts réels de chaque appel, arrondis UNE seule fois au niveau du cours."""
    if not results or len(results) > 120:
        raise CourseProviderCostUncertain("Sections de rédaction absentes ou trop nombreuses.")
    prepared: list[dict[str, Any]] = []
    for item in results:
        if not isinstance(item, Mapping) or item.get("provider") != "openrouter" or item.get("model") != model:
            raise CourseProviderCostUncertain("Modèle ou fournisseur de section incorrect.")
        if item.get("reconciliation_required") is True:
            raise CourseProviderCostUncertain("Section à rapprocher avant règlement.")
        usage = item.get("usage")
        if not isinstance(usage, Mapping):
            raise CourseProviderCostUncertain("Usage de section absent.")
        try:
            normalized = normalize_provider_usage(
                provider="openrouter", usage=usage, model=model,
                request_id=item.get("response_id"),
            )
        except ValueError as exc:
            raise CourseProviderCostUncertain("Usage de section non fiable.") from exc
        prepared.append({
            "model": model, "response_id": item.get("response_id"),
            "provider_cost_usd": item.get("provider_cost_usd"),
            "provider_usage": normalized.to_dict(), "web_search_calls": 0,
        })
    try:
        result = OpenRouterTokenBillingService.calculate_many(prepared)
    except ValueError as exc:
        raise CourseProviderCostUncertain("Coût final de rédaction non rapproché.") from exc
    return CourseOpenRouterAmount(
        cost_usd=result.total_cost_usd, cost_xaf=result.total_cost_xaf,
        credits=result.credits,
    )

__all__ = [
    "CourseOpenRouterAmount", "CourseProviderCostUncertain",
    "estimate_transcription_reservation", "calculate_transcription_actual",
    "estimate_writing_reservation", "calculate_writing_actual",
]
