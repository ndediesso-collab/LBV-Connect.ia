"""Read/repair delivery of a **verified paid** free-wallet addon.

The endpoint NEVER creates checkout, accepts provider claims from a client,
sets status=paid, or edits balances. The existing signed webhook remains the
only place a payment is confirmed. This router is intentionally outside the
legacy Chariow routes to preserve paid pack operations.
"""
from __future__ import annotations

import logging
import re
from typing import Any

from fastapi import APIRouter, Header, HTTPException
from pydantic import BaseModel, ConfigDict, Field

from app.core.supabase import supabase
from app.route.ai import _authenticate_chat_user
from app.services.oria_free_addon_payment import (
    FREE_ADDON_PRODUCTS,
    finalize_free_addon_paid,
    free_wallet_targeted,
    validate_free_target_payment,
)

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/payments/free-addon", tags=["ORIA recharges sans pack"])
_REFERENCE = re.compile(r"^LBV-[0-9]{14}-[A-F0-9]{10}$")


class ReconcileRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    reference: str = Field(min_length=5, max_length=200)


def _owner(user_id: str | None, authorization: str | None) -> str:
    return _authenticate_chat_user(user_id=user_id, authorization=authorization)


def _paid(tx: dict[str, Any]) -> bool:
    return tx.get("status") == "paid" and bool(tx.get("paid_at"))


def _get_owned(reference: str, uid: str) -> dict[str, Any]:
    if not _REFERENCE.fullmatch(reference):
        raise HTTPException(400, "Référence de recharge invalide.")
    try:
        response = (supabase.table("payment_transactions").select("*")
                    .eq("reference", reference).eq("user_id", uid)
                    .limit(1).execute())
    except Exception as exc:
        logger.exception("oria_free_addon_payment_read_failed")
        raise HTTPException(503, "Vérification de paiement temporairement indisponible.") from exc
    rows = getattr(response, "data", None)
    if not isinstance(rows, list) or not rows:
        raise HTTPException(404, "Recharge introuvable pour ce compte.")
    tx = rows[0]
    if not isinstance(tx, dict) or not free_wallet_targeted(tx):
        # Never expose or redirect classic paid pack payments through free recovery.
        raise HTTPException(404, "Recharge gratuite introuvable.")
    validate_free_target_payment(tx)
    return tx


def _has_receipt(uid: str, reference: str) -> bool:
    try:
        response = (supabase.table("oria_free_addon_receipts")
                    .select("reference").eq("user_id", uid)
                    .eq("reference", reference).limit(1).execute())
    except Exception as exc:
        logger.exception("oria_free_addon_receipt_read_failed")
        raise HTTPException(503, "État de livraison temporairement indisponible.") from exc
    return bool(getattr(response, "data", None))


def _public(tx: dict[str, Any], *, delivered: bool) -> dict[str, Any]:
    # No internal metadata, provider payloads, secrets, identifiers of other users.
    return {
        "reference": tx["reference"],
        "product_id": tx["addon_id"],
        "credits": int(tx["credits"]),
        "amount_xaf": int(tx["amount"]),
        "paid_confirmed": _paid(tx),
        "delivered": delivered,
        "status": "credited" if delivered else "paid_pending_credit" if _paid(tx) else "awaiting_payment",
        "created_at": tx.get("created_at"),
    }


@router.get("/orders")
def free_addon_orders(
    user_id: str | None = Header(default=None, alias="user-id"),
    authorization: str | None = Header(default=None, alias="authorization"),
):
    uid = _owner(user_id, authorization)
    try:
        response = (supabase.table("payment_transactions").select("*")
                    .eq("user_id", uid).eq("payment_type", "addon")
                    .order("created_at", desc=True).limit(20).execute())
    except Exception as exc:
        logger.exception("oria_free_addon_orders_failed")
        raise HTTPException(503, "Historique des recharges temporairement indisponible.") from exc
    rows = getattr(response, "data", None)
    if not isinstance(rows, list):
        raise HTTPException(503, "Historique des recharges incomplet.")
    items: list[dict[str, Any]] = []
    for tx in rows:
        if not isinstance(tx, dict) or not free_wallet_targeted(tx):
            continue
        try:
            validate_free_target_payment(tx)
            receipt = _has_receipt(uid, tx["reference"])
        except HTTPException as exc:
            if exc.status_code == 503:
                raise
            logger.warning("Ignoring incompatible free addon record")
            continue
        items.append(_public(tx, delivered=receipt))
    return {"success": True, "items": items}


@router.post("/reconcile")
def reconcile_free_addon(
    payload: ReconcileRequest,
    user_id: str | None = Header(default=None, alias="user-id"),
    authorization: str | None = Header(default=None, alias="authorization"),
):
    uid = _owner(user_id, authorization)
    tx = _get_owned(payload.reference, uid)
    # A client may request a reconciliation, never assert a provider payment.
    if not _paid(tx):
        return {"success": True, "processed": False, "order": _public(tx, delivered=False),
                "message": "Paiement non encore confirmé par Chariow."}
    # Idempotent, service-role-only RPC: verifies paid_at, canonical product,
    # frozen target marker and receipt uniqueness again under SQL locks.
    result = finalize_free_addon_paid(supabase, payload.reference)
    if result.get("reference") != payload.reference:
        raise HTTPException(503, "Rapprochement non confirmé.")
    if not _has_receipt(uid, payload.reference):
        raise HTTPException(503, "Crédit en cours de rapprochement : reçu non retrouvé.")
    return {"success": True, "processed": bool(result["processed"]),
            "order": _public(tx, delivered=True),
            "message": "Recharge attribuée ou déjà attribuée. Aucun double crédit."}
