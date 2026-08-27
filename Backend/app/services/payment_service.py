from datetime import datetime, timezone
import os
import secrets

import requests
from fastapi import HTTPException

from app.config.payments import (
    ADDON_PACKS,
    PRIMARY_PACKS,
)


# ============================================================
# CONFIGURATION CHARIOW
# ============================================================

CHARIOW_API_URL = "https://api.chariow.com/v1/checkout"

CHARIOW_PRODUCTS = {
    # Packs principaux
    "light_pack": "prd_v8usp6po",
    "intermediate_pack": "prd_soqhl40l",
    "pro_pack": "prd_o99vfrh8",
    "business_pack": "prd_30huzdah",

    # Packs complémentaires
    "credits_1000_563": "prd_fzpye84k",
    "credits_2000": "prd_ogtnea3w",
    "credits_4000": "prd_dkwkowfu",
    "credits_10000": "prd_59tc7tcl",
}


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
# PRODUIT CHARIOW
# ============================================================

def get_chariow_product_id(
    product_id: str,
) -> str:
    """
    Retourne l'identifiant du produit correspondant
    dans Chariow.
    """

    chariow_product_id = CHARIOW_PRODUCTS.get(
        product_id
    )

    if chariow_product_id is None:
        raise HTTPException(
            status_code=404,
            detail=(
                "Aucun produit Chariow configuré "
                "pour cette offre."
            ),
        )

    return chariow_product_id


# ============================================================
# CRÉATION DU CHECKOUT CHARIOW
# ============================================================

def create_chariow_checkout(
    product_id: str,
    reference_id: str,
    email: str,
    first_name: str | None = None,
    last_name: str | None = None,
    phone: str | None = None,
):
    """
    Crée un checkout Chariow et retourne son URL.

    La clé CHARIOW_API reste uniquement côté backend.
    """

    api_key = os.getenv("CHARIOW_API")

    if not api_key:
        raise HTTPException(
            status_code=500,
            detail=(
                "La clé API Chariow n'est pas configurée "
                "sur le serveur."
            ),
        )

    chariow_product_id = get_chariow_product_id(
        product_id
    )

    customer = {
        "email": email,
    }

    if first_name:
        customer["first_name"] = first_name

    if last_name:
        customer["last_name"] = last_name

    if phone:
        customer["phone"] = phone

    payload = {
        "product_id": chariow_product_id,
        "customer": customer,
        "custom_metadata": {
            "lbv_product_id": product_id,
            "lbv_reference_id": reference_id,
        },
    }

    try:
        response = requests.post(
            CHARIOW_API_URL,
            headers={
                "Authorization": f"Bearer {api_key}",
                "Content-Type": "application/json",
            },
            json=payload,
            timeout=20,
        )
    except requests.RequestException as exc:
        raise HTTPException(
            status_code=502,
            detail=(
                "Impossible de contacter le service "
                "de paiement Chariow."
            ),
        ) from exc

    try:
        data = response.json()
    except ValueError as exc:
        raise HTTPException(
            status_code=502,
            detail=(
                "Réponse invalide reçue depuis Chariow."
            ),
        ) from exc

    if not response.ok:
        detail = (
            data.get("message")
            or data.get("error")
            or "Chariow a refusé la création du checkout."
        )

        raise HTTPException(
            status_code=502,
            detail=f"Erreur Chariow : {detail}",
        )

    checkout_url = (
        data.get("data", {})
        .get("payment", {})
        .get("checkout_url")
    )

    if not checkout_url:
        raise HTTPException(
            status_code=502,
            detail=(
                "Chariow n'a fourni aucune URL "
                "de paiement."
            ),
        )

    return {
        "checkout_url": checkout_url,
        "chariow_product_id": chariow_product_id,
    }


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

    Chariow reste le prestataire de checkout.
    Le provider correspond au moyen de paiement
    choisi par l'utilisateur.
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
