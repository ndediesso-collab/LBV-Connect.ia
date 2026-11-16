"""ORIA freemium: narrow routing for existing Chariow addon products.

The existing checkout and webhook remain authoritative. This module NEVER
contacts Chariow or grants credits. All credit writes are performed by the
service-role-only SQL RPC after an authenticated, paid webhook.
"""
from __future__ import annotations

import os
from typing import Any, Mapping

from fastapi import HTTPException

FREE_ADDON_PRODUCTS: dict[str, tuple[int, int]] = {
    "credits_1000_563": (600, 1000),
    "credits_2000": (1000, 2000),
}
FREE_WALLET_TARGET_KEY = "oria_wallet_target"
FREE_WALLET_TARGET = "free"
FREE_ADDON_STAGING_ENV = "ORIA_FREE_ADDON_CHECKOUT_STAGING_ENABLED"


def is_free_addon_checkout(*, payment_type: str, product_id: str, wallet: Any) -> bool:
    """An existing addon is free-tier only if there is no active paid pack."""
    if payment_type != "addon" or product_id not in FREE_ADDON_PRODUCTS:
        return False
    return wallet is None or not bool(getattr(wallet, "is_pack_active", False))


def require_free_checkout_ready(supabase_client: Any) -> None:
    """Prevent collecting money for a free tier that is not fully launched."""
    if os.environ.get(FREE_ADDON_STAGING_ENV, "0").strip() != "1":
        raise HTTPException(status_code=503, detail="Recharges gratuites ORIA non encore disponibles.")
    try:
        res = (
            supabase_client.table("oria_free_settings")
            .select("enabled")
            .eq("id", 1)
            .limit(1)
            .execute()
        )
        data = getattr(res, "data", None)
    except Exception as exc:
        raise HTTPException(status_code=503, detail="Configuration freemium indisponible.") from exc
    if not isinstance(data, list) or len(data) != 1 or data[0].get("enabled") is not True:
        raise HTTPException(status_code=503, detail="Recharges gratuites non activées côté Supabase.")


def require_free_recharge_wallet_ready(supabase_client: Any, user_id: str) -> None:
    """Prevent payment when a historic purchased balance has no expiry contract.

    The SQL migration does not retroactively expire previously purchased funds.
    Old balance holders can spend their historic funds and then buy a new 14d
    topup. This check MUST execute before initiating a Chariow checkout.
    """
    try:
        response = (
            supabase_client.table("oria_free_credit_wallets")
            .select("purchased_balance,purchased_expires_at")
            .eq("user_id", user_id).limit(1).execute()
        )
        rows = getattr(response, "data", None)
        if not isinstance(rows, list):
            raise ValueError("Solde gratuit indetermine")
        if rows:
            balance = rows[0].get("purchased_balance")
            if type(balance) is not int or balance < 0:
                raise ValueError("Solde achete invalide")
            if balance > 0 and rows[0].get("purchased_expires_at") is None:
                raise HTTPException(status_code=409, detail=(
                    "Des credits de recharge anterieurs sans expiration sont encore "
                    "disponibles. Utilisez-les avant d'acheter une recharge 14 jours."
                ))
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=503, detail=(
            "Verification de la validite des recharges temporairement indisponible."
        )) from exc


def free_wallet_targeted(payment: Mapping[str, Any]) -> bool:
    metadata = payment.get("metadata")
    return isinstance(metadata, dict) and metadata.get(FREE_WALLET_TARGET_KEY) == FREE_WALLET_TARGET


def validate_free_target_payment(payment: Mapping[str, Any]) -> None:
    """Defense in depth before existing webhook updates payment_transactions.

    NOTE: this is NOT webhook authentication; the existing HMAC gate does that.
    """
    if not free_wallet_targeted(payment):
        raise HTTPException(status_code=409, detail="Destination de recharge gratuite absente.")
    product_id = payment.get("addon_id")
    expected = FREE_ADDON_PRODUCTS.get(str(product_id))
    if payment.get("payment_type") != "addon" or payment.get("pack_id") is not None or expected is None:
        raise HTTPException(status_code=409, detail="Produit de recharge gratuite non autorisé.")
    try:
        amount = payment.get("amount")
        credits = payment.get("credits")
        if isinstance(amount, bool) or isinstance(credits, bool):
            raise ValueError("boolean")
        if int(amount) != expected[0] or int(credits) != expected[1] or str(payment.get("currency")) != "XAF":
            raise ValueError("inconsistent commercial data")
    except (ValueError, TypeError) as exc:
        raise HTTPException(status_code=409, detail="Prix ou crédits de la recharge incohérents.") from exc


def finalize_free_addon_paid(supabase_client: Any, reference: str) -> dict[str, Any]:
    """Dispatch to the *existing* additive SQL RPC, no fallback to paid wallet."""
    if not isinstance(reference, str) or not reference.strip() or len(reference) > 200:
        raise HTTPException(status_code=400, detail="Référence de recharge gratuite invalide.")
    try:
        response = supabase_client.rpc(
            "oria_free_finalize_existing_addon", {"p_reference": reference}
        ).execute()
    except Exception as exc:
        raise HTTPException(
            status_code=503,
            detail="Paiement confirmé, recharge gratuite en attente de rapprochement.",
        ) from exc
    data = getattr(response, "data", None)
    if (not isinstance(data, dict)
        or type(data.get("processed")) is not bool
        or data.get("reference") != reference
        or type(data.get("credited_credits")) is not int
        or data["credited_credits"] <= 0):
        raise HTTPException(status_code=503, detail="Rapprochement de recharge non confirmé.")
    return data
