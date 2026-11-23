"""ORIA Collaboratif — pont Chariow, sans second checkout/webhook.

Les recharges professionnelles appartiennent au membre Supabase authentifie.
Le titulaire du pack conserve son wallet historique; aucune recharge privee
n'est transferee dans le portefeuille de l'administrateur.
"""
from __future__ import annotations

from decimal import Decimal, InvalidOperation
import re
from typing import Any

from fastapi import HTTPException

from app.config.payments import ADDON_PACKS
from app.services.payment_service import COUNTRY_PHONE_CONFIGS, get_chariow_product_id
from app.services.oria_collab_profiles_service import CollabProfilesService

# Reutilisation stricte des quatre addons Chariow deja commercialises.
COLLAB_ADDON_IDS = frozenset((
    "credits_1000_563", "credits_2000", "credits_4000", "credits_10000",
))
_EMAIL = re.compile(r"^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+$")


def _first(response: Any) -> dict | None:
    rows = getattr(response, "data", None) or []
    return rows[0] if isinstance(rows, list) and rows else None


def _member_record(db: Any, user_id: str) -> dict | None:
    try:
        return _first(db.table("oria_collab_members")
                      .select("user_id,workspace_id,role,status,first_name,last_name,phone_e164")
                      .eq("user_id", user_id).limit(1).execute())
    except Exception as exc:
        raise HTTPException(503, "Lecture des identites professionnelles indisponible.") from exc


def validate_receipt_email(email: str | None) -> str:
    value = str(email or "").strip()
    if len(value) > 254 or not _EMAIL.fullmatch(value) or ".." in value:
        raise HTTPException(422, "Une adresse e-mail de recu valide est necessaire pour Chariow.")
    return value


def _phone_country(phone: str) -> str:
    matches = [cfg.iso2 for cfg in COUNTRY_PHONE_CONFIGS.values()
               if phone.startswith(cfg.calling_code)]
    if len(matches) != 1:
        raise HTTPException(422, "Pays du numero professionnel non pris en charge par Chariow.")
    return matches[0]


def prepare_collab_checkout(db: Any, *, user_id: str, payment_type: str,
                            product_id: str, billing_email: str | None,
                            enabled: bool) -> dict | None:
    """None => checkout ORIA habituel. Un membre ne peut acheter un pack.

    La cle service_role reste sur le serveur. Aucune instruction de credit en
    provenance du navigateur n'entre dans cette fonction.
    """
    if not enabled:
        return None
    member = _member_record(db, user_id)
    if not member or member.get("role") == "owner":
        return None
    if member.get("role") != "member":
        raise HTTPException(403, "Role professionnel inconnu.")
    if payment_type != "addon" or product_id not in COLLAB_ADDON_IDS:
        raise HTTPException(403, "Les collaborateurs peuvent uniquement acheter des recharges personnelles.")
    context = CollabProfilesService(db)._context(user_id, eligible_required=True)
    if context["is_owner"] or context["workspace_id"] != str(member["workspace_id"]):
        raise HTTPException(403, "Identite professionnelle incoherente.")
    first, last = str(member.get("first_name") or "").strip(), str(member.get("last_name") or "").strip()
    phone = str(member.get("phone_e164") or "")
    if not first or not last or not re.fullmatch(r"\+[1-9]\d{7,14}", phone):
        raise HTTPException(422, "Completer le profil professionnel avant le paiement.")
    return {
        "user_id": user_id,
        "workspace_id": context["workspace_id"],
        "first_name": first, "last_name": last,
        "phone": phone, "country_iso2": _phone_country(phone),
        "billing_email": validate_receipt_email(billing_email),
    }


def refuse_collab_legacy_create(db: Any, *, user_id: str, enabled: bool) -> None:
    """La route historique /payments/create ne finalise pas les checkouts."""
    if not enabled:
        return
    member = _member_record(db, user_id)
    if member and member.get("role") == "member":
        raise HTTPException(405, "Utilisez /payments/checkout pour les recharges professionnelles.")


def collab_transaction_metadata(context: dict) -> dict:
    return {
        "oria_collab_target": "personal",
        "oria_collab_member_user_id": context["user_id"],
        "oria_collab_workspace_id": context["workspace_id"],
        "oria_collab_version": 1,
    }


def is_collab_personal_payment(payment: dict) -> bool:
    metadata = payment.get("metadata") or {}
    return isinstance(metadata, dict) and metadata.get("oria_collab_target") == "personal"


def validate_collab_signed_sale(event: dict, payment: dict) -> None:
    """Appeler uniquement APRES validation de la signature Pulse existante.

    Le montant et le produit du Pulse confirme doivent correspondre a la
    transaction serveur, pour ne pas crediter une vente de montant different.
    """
    if not is_collab_personal_payment(payment):
        raise HTTPException(400, "Transaction professionnelle invalide.")
    meta = payment["metadata"]
    if (payment.get("payment_type") != "addon" or
            payment.get("addon_id") not in COLLAB_ADDON_IDS or
            str(payment.get("user_id")) != str(meta.get("oria_collab_member_user_id")) or
            not meta.get("oria_collab_workspace_id")):
        raise HTTPException(409, "Liaison du paiement professionnel invalide.")
    product_id = str(payment["addon_id"])
    expected = ADDON_PACKS[product_id]
    if (int(payment.get("amount") or -1) != expected["price"] or
            int(payment.get("credits") or -1) != expected["credits"] or
            str(payment.get("currency") or "").upper() != "XAF"):
        raise HTTPException(409, "Montant ou credits de la commande incoherents.")
    # Le normaliseur Chariow expose lbv_product_id ou l'identifiant fournisseur.
    if str(event.get("reference") or "") != str(payment.get("reference")):
        raise HTTPException(409, "Reference Chariow incorrecte.")
    product_from_event = str(event.get("product_id") or "")
    if product_from_event not in (product_id, get_chariow_product_id(product_id)):
        raise HTTPException(409, "Produit Chariow different de la commande.")
    amount = event.get("amount")
    if isinstance(amount, dict):
        if str(amount.get("currency") or "").upper() != "XAF":
            raise HTTPException(409, "Devise Chariow invalide.")
        amount = amount.get("value")
    else:
        # Le format sans devise n'est pas suffisant pour les recharges pro.
        raise HTTPException(409, "Montant Chariow non verifie en XAF.")
    try:
        amount_decimal = Decimal(str(amount))
    except (InvalidOperation, TypeError, ValueError):
        raise HTTPException(409, "Montant Chariow invalide.") from None
    if not amount_decimal.is_finite() or amount_decimal != Decimal(expected["price"]):
        raise HTTPException(409, "Montant Chariow incorrect.")


def finalize_collab_personal_paid(db: Any, reference: str) -> dict:
    """RPC atomique, verrouille la commande payee et dedoublonne la reference."""
    try:
        response = db.rpc("oria_collab_finalize_personal_topup", {"p_reference": reference}).execute()
        result = getattr(response, "data", None)
        if isinstance(result, list) and len(result) == 1:
            result = result[0]
        if not isinstance(result, dict) or result.get("success") is not True:
            raise ValueError("bad_rpc_response")
    except Exception as exc:
        # Le webhook doit echouer : Chariow peut retenter, sinon rapprochement.
        raise HTTPException(503, "Paiement confirme, rapprochement des credits en attente.") from exc
    return {
        "success": True, "processed": bool(result.get("processed")),
        "wallet_type": "collab_personal", "reference_id": reference,
        "credits_added": int(result.get("credited_credits") or 0),
        "personal_balance": int(result.get("balance") or 0),
    }


def personal_balance(db: Any, user_id: str) -> dict:
    ctx = CollabProfilesService(db)._context(user_id, eligible_required=True)
    if ctx["is_owner"]:
        raise HTTPException(403, "Les recharges personnelles sont reservees aux collaborateurs.")
    try:
        entry = _first(db.table("oria_collab_personal_wallets")
                       .select("balance,credited_total,updated_at")
                       .eq("member_user_id", user_id).eq("workspace_id", ctx["workspace_id"]).limit(1).execute())
        payment_rows = (db.table("payment_transactions")
                        .select("reference,status,addon_id,amount,credits,created_at,paid_at,metadata")
                        .eq("user_id", user_id).eq("payment_type", "addon")
                        .order("created_at", desc=True).limit(50).execute()).data or []
    except Exception as exc:
        raise HTTPException(503, "Solde professionnel indisponible.") from exc
    purchases = [{k: p.get(k) for k in ("reference", "status", "addon_id", "amount", "credits", "created_at", "paid_at")}
                 for p in payment_rows if is_collab_personal_payment(p) and str((p.get("metadata") or {}).get("oria_collab_workspace_id")) == str(ctx["workspace_id"])][:10]
    return {
        "success": True, "wallet_type": "collab_personal",
        "member_user_id": user_id, "workspace_id": ctx["workspace_id"],
        "balance": int(entry["balance"]) if entry else 0,
        "credited_total": int(entry["credited_total"]) if entry else 0,
        "updated_at": entry.get("updated_at") if entry else None,
        "purchases": purchases,
    }


def reconcile_own_paid(db: Any, user_id: str) -> dict:
    """Rattrape les ventes payees deja signees, si l'activation a echoue."""
    ctx = CollabProfilesService(db)._context(user_id, eligible_required=True)
    if ctx["is_owner"]:
        raise HTTPException(403, "Action reservee aux collaborateurs.")
    try:
        rows = (db.table("payment_transactions")
                .select("reference,metadata")
                .eq("user_id", user_id).eq("payment_type", "addon")
                .eq("status", "paid").order("created_at", desc=True)
                .limit(50).execute()).data or []
    except Exception as exc:
        raise HTTPException(503, "Verification des paiements indisponible.") from exc
    processed = 0
    for row in rows:
        if is_collab_personal_payment(row) and str((row.get("metadata") or {}).get("oria_collab_workspace_id")) == str(ctx["workspace_id"]):
            response = finalize_collab_personal_paid(db, str(row["reference"]))
            processed += int(response["processed"])
    return {"success": True, "activated_now": processed, "checked": len(rows)}
