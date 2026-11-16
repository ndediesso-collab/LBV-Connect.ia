"""ORIA paid OpenRouter media: admin-verified ceilings per exact model variant.

No provider calls, no user-supplied prices, and no modification to actual billing.
Without an explicitly approved ceiling, fall back to the current global maximum.
"""
from __future__ import annotations

import json
from decimal import Decimal, InvalidOperation


class PaidMediaQuoteConfigError(ValueError):
    pass


def exact_variant_key(*, kind: str, model: str, resolution: str,
                      mode: str, duration: int | None = None) -> str:
    if kind not in ("image", "video"):
        raise PaidMediaQuoteConfigError("Type média non pris en charge")
    fields = (model, resolution, mode)
    if any(not isinstance(v, str) or not v or "|" in v or len(v) > 160 for v in fields):
        raise PaidMediaQuoteConfigError("Variante média invalide")
    if kind == "video":
        if type(duration) is not int or duration < 1 or duration > 60:
            raise PaidMediaQuoteConfigError("Durée vidéo invalide")
        return f"{model}|{resolution}|{duration}|{mode}"
    if duration is not None:
        raise PaidMediaQuoteConfigError("Durée inattendue pour une image")
    return f"{model}|{resolution}|{mode}"


def approved_max_usd(*, kind: str, model: str, resolution: str, mode: str,
                     duration: int | None = None,
                     global_ceiling: Decimal, raw_json: str | None = None) -> Decimal:
    """Choose ceiling approved by admin for THIS exact variant, never from balance/prompt.

    Quotes and reservations MUST pass the same model, resolution, mode and duration.
    Missing per-variant prices use unchanged global ceiling; malformed config fails closed.
    """
    key = exact_variant_key(kind=kind, model=model, resolution=resolution,
                            mode=mode, duration=duration)
    try:
        maximum = Decimal(str(global_ceiling))
    except (ValueError, TypeError, InvalidOperation) as exc:
        raise PaidMediaQuoteConfigError("Plafond global invalide") from exc
    if not maximum.is_finite() or maximum <= 0:
        raise PaidMediaQuoteConfigError("Plafond global non configuré")
    if raw_json is None or raw_json.strip() == "":
        return maximum
    try:
        matrix = json.loads(raw_json)
    except (ValueError, TypeError) as exc:
        raise PaidMediaQuoteConfigError("JSON des plafonds fournisseurs invalide") from exc
    if not isinstance(matrix, dict) or len(matrix) > 100:
        raise PaidMediaQuoteConfigError("Table des plafonds fournisseurs invalide")
    for k, v in matrix.items():
        if not isinstance(k, str) or not k or type(v) not in (str, int, float):
            raise PaidMediaQuoteConfigError("Entrée de plafond fournisseur invalide")
        try:
            amount = Decimal(str(v))
        except (ValueError, InvalidOperation) as exc:
            raise PaidMediaQuoteConfigError("Plafond fournisseur illisible") from exc
        if not amount.is_finite() or amount <= 0 or amount > maximum:
            raise PaidMediaQuoteConfigError("Le plafond variante doit être positif et <= plafond global")
    if key not in matrix:
        return maximum
    return Decimal(str(matrix[key]))
