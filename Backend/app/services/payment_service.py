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
    # ========================================================
    # PACKS PRINCIPAUX
    # ========================================================

    "light_pack": "prd_v8usp6po",
    "intermediate_pack": "prd_soqhl40l",
    "pro_pack": "prd_o99vfrh8",
    "business_pack": "prd_30huzdah",

    # ========================================================
    # PACKS COMPLÉMENTAIRES
    # ========================================================

    "credits_1000_563": "prd_fzpye84k",
    "credits_2000": "prd_ogtnea3w",
    "credits_4000": "prd_dkwkowfu",
    "credits_10000": "prd_59tc7tcl",
}


# ============================================================
# ALIAS PRODUITS
# ============================================================
#
# Permet de conserver la compatibilité avec d'anciens IDs
# éventuellement encore utilisés par le frontend.
#
# L'ID officiel reste :
#
#     credits_1000_563
#
# pour 1 000 crédits à 563 XAF.
# ============================================================

PRODUCT_ALIASES = {
    "credits_1000": "credits_1000_563",
}


# ============================================================
# NORMALISATION PRODUIT
# ============================================================

def normalize_product_id(
    product_id: str,
) -> str:
    """
    Normalise l'identifiant d'un produit LBV-Connect.

    Permet notamment de convertir les anciens IDs
    vers les nouveaux IDs officiels.
    """

    if not product_id:
        return product_id

    return PRODUCT_ALIASES.get(
        product_id,
        product_id,
    )


# ============================================================
# RÉFÉRENCE DE PAIEMENT
# ============================================================

def generate_payment_reference() -> str:
    """
    Génère une référence unique LBV-Connect
    pour une commande.
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

    Les anciens IDs compatibles sont automatiquement
    normalisés vers leur ID officiel.
    """

    normalized_product_id = normalize_product_id(
        product_id
    )

    if payment_type == "primary_pack":

        product = PRIMARY_PACKS.get(
            normalized_product_id
        )

    elif payment_type == "addon":

        product = ADDON_PACKS.get(
            normalized_product_id
        )

    else:

        raise HTTPException(
            status_code=400,
            detail="Type de paiement invalide.",
        )

    if product is None:

        raise HTTPException(
            status_code=404,
            detail=(
                "Produit de paiement introuvable."
            ),
        )

    return product


# ============================================================
# PRODUIT CHARIOW
# ============================================================

def get_chariow_product_id(
    product_id: str,
) -> str:
    """
    Retourne l'identifiant Chariow correspondant
    au produit LBV-Connect.
    """

    normalized_product_id = normalize_product_id(
        product_id
    )

    chariow_product_id = CHARIOW_PRODUCTS.get(
        normalized_product_id
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
    Crée un checkout Chariow.

    Chariow attend :
    - email
    - prénom
    - nom
    - téléphone

    directement à la racine du payload.
    """

    api_key = os.getenv(
        "CHARIOW_API"
    )

    if not api_key:

        raise HTTPException(
            status_code=500,
            detail=(
                "La clé API Chariow n'est pas "
                "configurée sur le serveur."
            ),
        )

    if not email:

        raise HTTPException(
            status_code=400,
            detail=(
                "L'adresse e-mail du client "
                "est obligatoire."
            ),
        )

    # --------------------------------------------------------
    # NORMALISATION DU PRODUIT
    # --------------------------------------------------------

    normalized_product_id = normalize_product_id(
        product_id
    )

    # --------------------------------------------------------
    # VALIDATION PRODUIT CHARIOW
    # --------------------------------------------------------

    chariow_product_id = get_chariow_product_id(
        normalized_product_id
    )

    # --------------------------------------------------------
    # PAYLOAD
    # --------------------------------------------------------

    payload = {
        "product_id": chariow_product_id,
        "email": email,
        "custom_metadata": {
            "lbv_product_id": normalized_product_id,
            "lbv_reference_id": reference_id,
        },
    }

    # --------------------------------------------------------
    # PRÉNOM
    # --------------------------------------------------------

    if first_name:

        payload["first_name"] = (
            str(first_name).strip()
        )

    # --------------------------------------------------------
    # NOM
    # --------------------------------------------------------

    if last_name:

        payload["last_name"] = (
            str(last_name).strip()
        )

    # --------------------------------------------------------
    # TÉLÉPHONE
    # --------------------------------------------------------

    if phone:

        payload["phone"] = {
            "number": str(phone).strip(),
            "country_code": "GA",
        }

    # --------------------------------------------------------
    # APPEL CHARIOW
    # --------------------------------------------------------

    try:

        response = requests.post(
            CHARIOW_API_URL,
            headers={
                "Authorization": (
                    f"Bearer {api_key}"
                ),
                "Content-Type": (
                    "application/json"
                ),
                "Accept": (
                    "application/json"
                ),
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

    # --------------------------------------------------------
    # RÉPONSE JSON
    # --------------------------------------------------------

    try:

        data = response.json()

    except ValueError as exc:

        raise HTTPException(
            status_code=502,
            detail=(
                "Réponse invalide reçue "
                "depuis Chariow."
            ),
        ) from exc

    # --------------------------------------------------------
    # ERREUR CHARIOW
    # --------------------------------------------------------

    if not response.ok:

        message = data.get(
            "message"
        )

        errors = data.get(
            "errors"
        )

        if isinstance(
            errors,
            list,
        ):

            errors = {
                "validation": errors
            }

        if isinstance(
            errors,
            dict,
        ):

            details = []

            for field, messages in errors.items():

                if isinstance(
                    messages,
                    list,
                ):

                    for item in messages:

                        details.append(
                            f"{field}: {item}"
                        )

                else:

                    details.append(
                        f"{field}: {messages}"
                    )

            if details:

                message = (
                    f"{message or 'Erreur de validation Chariow.'} "
                    f"({' | '.join(details)})"
                )

        if not message:

            message = (
                data.get("error")
                or
                "Chariow a refusé la création "
                "du checkout."
            )

        raise HTTPException(
            status_code=502,
            detail=(
                f"Erreur Chariow "
                f"(HTTP {response.status_code}) : "
                f"{message}"
            ),
        )

    # ========================================================
    # EXTRACTION RÉPONSE CHARIOW
    # ========================================================

    response_data = (
        data.get("data")
        or {}
    )

    step = response_data.get(
        "step"
    )

    payment = (
        response_data.get("payment")
        or {}
    )

    purchase = (
        response_data.get("purchase")
        or {}
    )

    # ========================================================
    # CHECKOUT EN ATTENTE DE PAIEMENT
    # ========================================================

    if step == "payment":

        checkout_url = payment.get(
            "checkout_url"
        )

        if not checkout_url:

            raise HTTPException(
                status_code=502,
                detail=(
                    "Chariow a créé le checkout "
                    "mais n'a fourni aucune URL "
                    "de paiement."
                ),
            )

        return {
            "checkout_url": checkout_url,
            "chariow_product_id": (
                chariow_product_id
            ),
            "chariow_step": step,
            "chariow_transaction_id": (
                payment.get(
                    "transaction_id"
                )
            ),
            "chariow_purchase_id": (
                purchase.get("id")
            ),
        }

    # ========================================================
    # PAIEMENT DÉJÀ COMPLÉTÉ
    # ========================================================

    if step == "completed":

        return {
            "checkout_url": None,
            "chariow_product_id": (
                chariow_product_id
            ),
            "chariow_step": step,
            "chariow_transaction_id": (
                payment.get(
                    "transaction_id"
                )
            ),
            "chariow_purchase_id": (
                purchase.get("id")
            ),
        }

    # ========================================================
    # RÉPONSE INATTENDUE
    # ========================================================

    raise HTTPException(
        status_code=502,
        detail=(
            "Réponse Chariow inattendue lors "
            "de la création du checkout."
        ),
    )


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
            detail=(
                "Portefeuille introuvable."
            ),
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
                "Votre pack principal est expiré "
                "ou inactif. Activez d'abord "
                "un nouveau pack."
            ),
        )


# ============================================================
# VALIDATION FOURNISSEUR
# ============================================================

def validate_provider(
    provider: str,
):
    """
    Vérifie que le fournisseur demandé
    est supporté.

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
                "Fournisseur de paiement "
                "non supporté."
            ),
        )