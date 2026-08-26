from datetime import datetime, timezone
import secrets

from fastapi import HTTPException

from app.config.payments import (
    ADDON_PACKS,
    PRIMARY_PACKS,
)


# ============================================================
# RÉFÉRENCE DE PAIEMENT
# ============================================================

def generate_payment_reference() -> str:
    """
    Génère une référence unique LBV-Connect pour une commande.
    """

    timestamp = datetime.now(
        timezone.utc
    ).strftime("%Y%m%d%H%M%S")

    token = secrets.token_hex(
        5
    ).upper()

    return f"LBV-{timestamp}-{token}"


# ============================================================
# PRODUIT
# ============================================================

def get_payment_product(
    payment_type: str,
    product_id: str,
):
    """
    Retourne les informations commerciales du produit.
    """

    if payment_type == "primary_pack":
        product = PRIMARY_PACKS.get(product_id)

    elif payment_type == "addon":
        product = ADDON_PACKS.get(product_id)

    else:
        raise HTTPException(
            status_code=400,
            detail="Type de paiement invalide.",
        )

    if product is None:
        raise HTTPException(
            status_code=404,
            detail="Produit de paiement introuvable.",
        )

    return product


# ============================================================
# VALIDATION COMPLÉMENT
# ============================================================

def validate_addon_purchase(
    wallet,
):
    """
    Vérifie qu'un utilisateur possède actuellement
    un pack principal actif avant d'autoriser
    l'achat d'un complément.

    Une recharge complémentaire :
    - ajoute uniquement des crédits au solde ;
    - ne crée pas un nouveau pack ;
    - ne prolonge pas la durée du pack ;
    - ne remplace pas le pack actif.
    """

    if wallet is None:
        raise HTTPException(
            status_code=404,
            detail="Portefeuille introuvable.",
        )

    if not wallet.pack_id:
        raise HTTPException(
            status_code=403,
            detail=(
                "Un pack principal actif est requis "
                "pour acheter un complément."
            ),
        )

    if not wallet.is_pack_active:
        raise HTTPException(
            status_code=403,
            detail=(
                "Votre pack principal est expiré ou inactif. "
                "Activez d'abord un nouveau pack."
            ),
        )


# ============================================================
# VALIDATION FOURNISSEUR
# ============================================================

def validate_provider(
    provider: str,
):
    """
    Vérifie que le fournisseur demandé est supporté.
    """

    if provider not in {
        "airtel_money",
        "moov_money",
    }:
        raise HTTPException(
            status_code=400,
            detail=(
                "Fournisseur de paiement non supporté."
            ),
        )
