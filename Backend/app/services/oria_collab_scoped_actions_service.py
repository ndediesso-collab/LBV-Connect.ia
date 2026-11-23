"""Explicit workspace operations for ORIA Collaboratif.

Never infer a workspace from user_id. All provider checkouts use the existing
Chariow client and the existing signed Pulse endpoint. Readiness OFF by default.
"""
from __future__ import annotations

import os
from typing import Any
from uuid import UUID

from fastapi import HTTPException

from app.services.payment_service import create_chariow_checkout, generate_payment_reference
from app.services.oria_collab_payment_bridge import validate_receipt_email

RPCS = {
    "private_create": "oria_collab_scope_private_create_v5",
    "group_create": "oria_collab_scope_group_create_v5",
    "group_participant": "oria_collab_scope_group_participant_v5",
    "group_archive": "oria_collab_scope_group_archive_v5",
    "group_post": "oria_collab_scope_group_post_v5",
    "quota_transfer": "oria_collab_scope_quota_transfer_v5",
    "topup_start": "oria_collab_scope_topup_start_v5",
    "extension_start": "oria_collab_scope_group_extension_start_v5",
}
ADDON_IDS = frozenset({"credits_1000_563", "credits_2000", "credits_4000", "credits_10000"})
EXTENSION_ID = "oria_collab_messages_5000"


def enabled() -> bool:
    return (os.getenv("ORIA_COLLAB_SCOPED_ACTIONS_ENABLED", "0") == "1"
            and os.getenv("ORIA_COLLABORATIF_ENABLED", "0") == "1"
            and os.getenv("ORIA_COLLAB_WORKSPACE_CONTEXT_ENABLED", "0") == "1")


def require_enabled() -> None:
    if not enabled():
        raise HTTPException(503, "Les actions de cet espace ne sont pas encore activées.")


def uuid(value: str) -> str:
    try:
        return str(UUID(str(value)))
    except (ValueError, TypeError, AttributeError) as exc:
        raise HTTPException(422, "Identifiant invalide.") from exc


class ScopedActionsService:
    def __init__(self, db: Any):
        self.db = db

    def call(self, name: str, actor: str, space: str, **parameters: Any) -> dict:
        require_enabled()
        actor_id, workspace_id = uuid(actor), uuid(space)
        if name not in RPCS:
            raise HTTPException(503, "Opération inconnue.")
        args = {"p_actor_user_id": actor_id, "p_workspace_id": workspace_id,
                **parameters}
        try:
            response = self.db.rpc(RPCS[name], args).execute()
            result = getattr(response, "data", None)
            if isinstance(result, list) and len(result) == 1:
                result = result[0]
            if not isinstance(result, dict) or result.get("success") is not True:
                raise RuntimeError("collab_scoped_invalid_rpc_result")
            if result.get("workspace_id") != workspace_id:
                raise RuntimeError("collab_scoped_wrong_workspace")
            if name in ("topup_start", "private_create") and result.get("member_user_id") != actor_id:
                raise RuntimeError("collab_scoped_wrong_member")
            return result
        except HTTPException:
            raise
        except Exception as exc:
            message = str(exc).lower()
            if any(marker in message for marker in ("collab_scope_owner_required", "collab_scope_forbidden")):
                raise HTTPException(403, "Accès à cet espace interdit.") from exc
            if "collab_scope_insufficient" in message:
                raise HTTPException(402, "Crédits insuffisants dans cet espace.") from exc
            if any(marker in message for marker in ("collab_scope_group_missing", "collab_scope_member_inactive")):
                raise HTTPException(404, "Salon ou profil inaccessible.") from exc
            if any(marker in message for marker in ("collab_scope_message_conflict", "collab_scope_group_full",
                                                   "collab_scope_group_archived", "collab_scope_quota_reconciliation_required")):
                raise HTTPException(409, "Action impossible : limite ou état en cours.") from exc
            raise HTTPException(503, "Opération indisponible. Vérifier le journal du backend et les migrations.") from exc

    def checkout(self, actor: str, space: str, *, product_id: str, email: str,
                 group_id: str | None = None) -> dict:
        """Atomic order creation before invoking existing Chariow provider.

        A pending order is NOT proof of payment and never grants credits.
        The signed existing webhook and 013/009 SQL finalizers remain authoritative.
        """
        require_enabled()
        email = validate_receipt_email(email)
        code = product_id
        if group_id is None:
            if code not in ADDON_IDS:
                raise HTTPException(422, "Recharge non autorisée.")
            operation = "topup_start"
            args = {"p_reference": str(generate_payment_reference()), "p_addon_id": code}
        else:
            if code != EXTENSION_ID:
                raise HTTPException(422, "Produit d'extension incorrect.")
            operation = "extension_start"
            args = {"p_reference": str(generate_payment_reference()), "p_group_id": uuid(group_id)}
        reference = args["p_reference"]
        if not 12 <= len(reference) <= 130 or not reference.replace("-", "").replace("_", "").isalnum():
            raise HTTPException(503, "Référence de paiement invalide.")
        # Workspaces and prices are verified by SQL; never trust browser fields.
        order = self.call(operation, actor, space, **args)
        if order.get("reference") != reference or (group_id and order.get("group_id") != uuid(group_id)):
            raise HTTPException(503, "Commande incohérente, rapprochement nécessaire.")
        from app.config.payments import ADDON_PACKS
        if group_id is None:
            expected = ADDON_PACKS.get(code)
            if (not expected or int(order.get("credits", -1)) != int(expected["credits"])
                    or int(order.get("amount_xaf", -1)) != int(expected["price"])):
                raise HTTPException(503, "Prix de recharge non concordant. Aucun checkout lancé.")
        else:
            if int(order.get("amount_xaf", -1)) != 3000 or int(order.get("message_quantity", -1)) != 5000:
                raise HTTPException(503, "Quantité d'extension non concordante.")
        try:
            result = create_chariow_checkout(product_id=code, reference_id=reference, email=email)
            url = result.get("checkout_url") if isinstance(result, dict) else None
            if not isinstance(url, str) or not url.startswith("https://"):
                raise ValueError("bad_chariow_checkout_url")
        except Exception as exc:
            # Keep order pending. Never refund/add credits without signed webhook.
            raise HTTPException(502, "Chariow indisponible. Aucun crédit ajouté ; commande à rapprocher.") from exc
        return {"success": True, "workspace_id": uuid(space), "reference": reference,
                "checkout_url": url, "payment_status": "pending", "product_id": code,
                "amount_xaf": order["amount_xaf"]}
