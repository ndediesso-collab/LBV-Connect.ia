"""Owner-scoped commercial sale records for ORIA Assistant.

This service deliberately keeps commercial outcomes separate from request statuses.
A request can be treated while its commercial outcome remains open, won or lost.
"""
from __future__ import annotations

import logging
import re
from datetime import date, datetime, timezone
from decimal import Decimal, InvalidOperation
from typing import Any, Mapping
from uuid import UUID

from fastapi import HTTPException

from app.core.supabase import supabase

logger = logging.getLogger("oria.assistant.sales")
SALE_OUTCOMES = frozenset(("open", "won", "lost"))
CURRENCY_PATTERN = re.compile(r"^[A-Z]{3}$", re.ASCII)
MAX_AMOUNT = Decimal("9999999999999999.99")
CENT = Decimal("0.01")


def _first(data: Any) -> dict[str, Any] | None:
    if isinstance(data, list):
        data = data[0] if data else None
    return data if isinstance(data, dict) else None


def _uuid(value: Any, label: str) -> str:
    try:
        return str(UUID(str(value)))
    except (ValueError, TypeError, AttributeError) as exc:
        raise HTTPException(422, f"Identifiant {label} invalide.") from exc


def normalize_currency(value: Any = "XAF") -> str:
    currency = str(value or "XAF").strip().upper()
    if not CURRENCY_PATTERN.fullmatch(currency):
        raise HTTPException(422, "La devise doit être un code de trois lettres, par exemple XAF.")
    return currency


def normalize_amount(value: Any, *, label: str, nullable: bool = True) -> str | None:
    if value is None:
        if nullable:
            return None
        raise HTTPException(422, f"Le montant {label} est obligatoire.")
    try:
        amount = Decimal(str(value))
    except (InvalidOperation, ValueError, TypeError) as exc:
        raise HTTPException(422, f"Le montant {label} est invalide.") from exc
    if not amount.is_finite() or amount < 0 or amount > MAX_AMOUNT:
        raise HTTPException(422, f"Le montant {label} doit être positif ou nul et ne pas dépasser la limite autorisée.")
    if amount.quantize(CENT) != amount:
        raise HTTPException(422, f"Le montant {label} ne peut pas comporter plus de deux décimales.")
    return format(amount.quantize(CENT), "f")


def validate_sale_values(values: Mapping[str, Any], *, creating: bool) -> dict[str, Any]:
    """Pure validation/normalization used by the API and unit tests."""
    result: dict[str, Any] = {}

    if creating or "outcome" in values:
        outcome = values.get("outcome")
        if outcome not in SALE_OUTCOMES:
            raise HTTPException(422, "Le résultat commercial doit être open, won ou lost.")
        result["outcome"] = outcome

    if creating or "product_or_service" in values:
        product = values.get("product_or_service")
        if product is not None:
            product = str(product).strip()
            if len(product) > 180:
                raise HTTPException(422, "Le produit ou service ne peut pas dépasser 180 caractères.")
        result["product_or_service"] = product or None

    if creating or "quoted_amount" in values:
        result["quoted_amount"] = normalize_amount(
            values.get("quoted_amount"), label="du devis", nullable=True,
        )

    if creating or "collected_amount" in values:
        collected = normalize_amount(
            values.get("collected_amount", 0 if creating else None),
            label="encaissé", nullable=False,
        )
        result["collected_amount"] = collected

    if creating or "currency" in values:
        result["currency"] = normalize_currency(values.get("currency", "XAF"))

    if creating or "sale_date" in values:
        raw_date = values.get("sale_date")
        if isinstance(raw_date, datetime):
            raw_date = raw_date.date()
        if isinstance(raw_date, date):
            raw_date = raw_date.isoformat()
        if raw_date is not None:
            try:
                raw_date = date.fromisoformat(str(raw_date)).isoformat()
            except (TypeError, ValueError) as exc:
                raise HTTPException(422, "La date de vente est invalide.") from exc
        result["sale_date"] = raw_date

    if creating and result.get("outcome") == "won" and not result.get("sale_date"):
        raise HTTPException(422, "La date de réalisation est obligatoire pour une vente gagnée.")
    if not creating and result.get("outcome") == "won":
        # The existing sale date may be retained; the database row is checked by
        # update_owner_commercial_sale before applying the final combined state.
        pass

    if creating or "notes" in values:
        notes = values.get("notes")
        if notes is not None:
            notes = str(notes).strip()
            if len(notes) > 3000:
                raise HTTPException(422, "Le commentaire ne peut pas dépasser 3 000 caractères.")
        result["notes"] = notes or None

    return result


def _get_owned_request(owner_user_id: str, request_id: str) -> dict[str, Any]:
    try:
        row = _first(
            supabase.table("oria_assistant_requests")
            .select("id,assistant_id")
            .eq("id", request_id)
            .eq("owner_user_id", owner_user_id)
            .limit(1)
            .execute().data
        )
        if row is None:
            raise HTTPException(404, "Demande introuvable dans votre espace ORIA Assistant.")

        assistant_id = str(row.get("assistant_id") or "").strip()
        if not assistant_id:
            raise HTTPException(409, "Cette demande n'est rattachée à aucun assistant valide.")
        assistant = _first(
            supabase.table("oria_assistants")
            .select("id")
            .eq("id", assistant_id)
            .eq("owner_user_id", owner_user_id)
            .limit(1)
            .execute().data
        )
        if assistant is None:
            raise HTTPException(404, "L'assistant associé à cette demande est introuvable.")
        return {"id": str(row["id"]), "assistant_id": assistant_id}
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("ORIA Assistant commercial request ownership lookup failed")
        raise HTTPException(503, "Impossible de vérifier la demande commerciale pour le moment.") from exc


def get_owner_commercial_sale_for_request(owner_user_id: str, request_id: str) -> dict[str, Any] | None:
    """Return a sale only when the request itself belongs to the authenticated owner."""
    normalized_request_id = _uuid(request_id, "demande")
    _get_owned_request(owner_user_id, normalized_request_id)
    try:
        return _first(
            supabase.table("oria_assistant_sales")
            .select("*")
            .eq("request_id", normalized_request_id)
            .eq("owner_user_id", owner_user_id)
            .limit(1)
            .execute().data
        )
    except Exception as exc:
        logger.exception("ORIA Assistant commercial sale lookup failed")
        raise HTTPException(503, "Impossible de charger le résultat commercial pour le moment.") from exc


def create_owner_commercial_sale(owner_user_id: str, payload: Mapping[str, Any]) -> dict[str, Any]:
    request_id = _uuid(payload.get("request_id"), "demande")
    request = _get_owned_request(owner_user_id, request_id)

    try:
        existing = _first(
            supabase.table("oria_assistant_sales")
            .select("id")
            .eq("request_id", request_id)
            .eq("owner_user_id", owner_user_id)
            .limit(1)
            .execute().data
        )
    except Exception as exc:
        logger.exception("ORIA Assistant commercial duplicate check failed")
        raise HTTPException(503, "Impossible de vérifier les résultats commerciaux existants.") from exc
    if existing:
        raise HTTPException(409, "Un résultat commercial existe déjà pour cette demande. Modifiez-le plutôt que d'en créer un second.")

    values = validate_sale_values(payload, creating=True)
    row = {
        "owner_user_id": owner_user_id,
        "assistant_id": request["assistant_id"],
        "request_id": request_id,
        **values,
    }
    try:
        inserted = _first(
            supabase.table("oria_assistant_sales").insert(row).select("*").execute().data
        )
        if inserted is None:
            raise RuntimeError("commercial_sale_insert_returned_no_row")
        return inserted
    except HTTPException:
        raise
    except Exception as exc:
        # The UNIQUE(request_id) constraint remains the final race-condition guard.
        try:
            duplicate = _first(
                supabase.table("oria_assistant_sales")
                .select("id")
                .eq("request_id", request_id)
                .eq("owner_user_id", owner_user_id)
                .limit(1)
                .execute().data
            )
        except Exception:
            duplicate = None
        if duplicate:
            raise HTTPException(409, "Un résultat commercial existe déjà pour cette demande.") from exc
        logger.exception("ORIA Assistant commercial sale creation failed")
        raise HTTPException(503, "Impossible d'enregistrer le résultat commercial pour le moment.") from exc


def update_owner_commercial_sale(
    owner_user_id: str, sale_id: str, payload: Mapping[str, Any],
) -> dict[str, Any]:
    normalized_sale_id = _uuid(sale_id, "vente")
    try:
        existing = _first(
            supabase.table("oria_assistant_sales")
            .select("*")
            .eq("id", normalized_sale_id)
            .eq("owner_user_id", owner_user_id)
            .limit(1)
            .execute().data
        )
    except Exception as exc:
        logger.exception("ORIA Assistant commercial sale owner lookup failed")
        raise HTTPException(503, "Impossible de charger le résultat commercial pour le moment.") from exc
    if existing is None:
        raise HTTPException(404, "Résultat commercial introuvable.")

    values = validate_sale_values(payload, creating=False)
    if not values:
        raise HTTPException(400, "Aucune modification commerciale valide n'a été transmise.")

    final_outcome = values.get("outcome", existing.get("outcome"))
    final_sale_date = values.get("sale_date", existing.get("sale_date"))
    if final_outcome == "won" and not final_sale_date:
        raise HTTPException(422, "La date de réalisation est obligatoire pour une vente gagnée.")

    values["updated_at"] = datetime.now(timezone.utc).isoformat()
    try:
        updated = _first(
            supabase.table("oria_assistant_sales")
            .update(values)
            .eq("id", normalized_sale_id)
            .eq("owner_user_id", owner_user_id)
            .select("*")
            .execute().data
        )
        if updated is None:
            raise HTTPException(404, "Résultat commercial introuvable.")
        return updated
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("ORIA Assistant commercial sale update failed")
        raise HTTPException(503, "Impossible de modifier le résultat commercial pour le moment.") from exc
