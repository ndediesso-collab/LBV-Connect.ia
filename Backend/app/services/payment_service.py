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
    timestamp = datetime.now(timezone.utc).strftime("%Y%m%d%H%M%S")
    token = secrets.token_hex(5).upper()
    return f"LBV-{timestamp}-{token}"


# ============================================================
# PRODUIT
# ============================================================

def get_payment_product(payment_type: str, product_id: str):
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

def get_chariow_product_id(product_id: str) -> str:
    chariow_product_id = CHARIOW_PRODUCTS.get(product_id)

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
    first_name: str,
    last_name: str,
    phone: str,
):
    """
    Crée un checkout Chariow.

    Chariow attend email, prénom, nom et téléphone
    directement à la racine du payload.
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

    if not email:
        raise HTTPException(
            status_code=400,
            detail="L'adresse e-mail du client est obligatoire.",
        )

    if not first_name:
        raise HTTPException(
            status_code=400,
            detail="Le prénom du client est obligatoire.",
        )

    if not last_name:
        raise HTTPException(
            status_code=400,
            detail="Le nom du client est obligatoire.",
        )

    if not phone:
        raise HTTPException(
            status_code=400,
            detail=(
                "Le numéro de téléphone du client est obligatoire "
                "pour le checkout Chariow."
            ),
        )

    chariow_product_id = get_chariow_product_id(product_id)

    payload = {
        "product_id": chariow_product_id,
        "email": email,
        "first_name": first_name,
        "last_name": last_name,
        "phone": {
            "number": str(phone).strip(),
            "country_code": "GA",
        },
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
                "Accept": "application/json",
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
        message = data.get("message")
        errors = data.get("errors")

        if isinstance(errors, dict):
            details = []

            for field, messages in errors.items():
                if isinstance(messages, list):
                    for item in messages:
                        details.append(f"{field}: {item}")
                else:
                    details.append(f"{field}: {messages}")

            if details:
                message = (
                    f"{message or 'Erreur de validation Chariow.'} "
                    f"({' | '.join(details)})"
                )

        if not message:
            message = (
                data.get("error")
                or "Chariow a refusé la création du checkout."
            )

        raise HTTPException(
            status_code=502,
            detail=(
                f"Erreur Chariow (HTTP {response.status_code}) : "
                f"{message}"
            ),
        )

    response_data = data.get("data") or {}
    step = response_data.get("step")
    payment = response_data.get("payment") or {}
    purchase = response_data.get("purchase") or {}

    if step == "payment":
        checkout_url = payment.get("checkout_url")

        if not checkout_url:
            raise HTTPException(
                status_code=502,
                detail=(
                    "Chariow a créé le checkout mais n'a fourni "
                    "aucune URL de paiement."
                ),
            )

        return {
            "checkout_url": checkout_url,
            "chariow_product_id": chariow_product_id,
            "chariow_step": step,
            "chariow_transaction_id": payment.get(
                "transaction_id"
            ),
            "chariow_purchase_id": purchase.get("id"),
        }

    if step == "completed":
        return {
            "checkout_url": None,
            "chariow_product_id": chariow_product_id,
            "chariow_step": step,
            "chariow_transaction_id": payment.get(
                "transaction_id"
            ),
            "chariow_purchase_id": purchase.get("id"),
        }

    raise HTTPException(
        status_code=502,
        detail=(
            "Réponse Chariow inattendue lors de la création "
            "du checkout."
        ),
    )


# ============================================================
# VALIDATION COMPLÉMENT
# ============================================================

def validate_addon_purchase(wallet):
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

def validate_provider(provider: str):
    if provider not in {
        "airtel_money",
        "moov_money",
    }:
        raise HTTPException(
            status_code=400,
            detail="Fournisseur de paiement non supporté.",
        )