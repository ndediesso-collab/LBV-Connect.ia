from dataclasses import dataclass
from datetime import datetime, timezone
import os
import re
import secrets

import requests
from fastapi import HTTPException

from app.config.payments import (
    ADDON_PACKS,
    PRIMARY_PACKS,
)


# ============================================================
# RÉFÉRENTIEL PAYS — AFRIQUE FRANCOPHONE
# ============================================================
#
# Source unique pour les données pays/téléphone utilisées par
# le checkout LBV-Connect.
#
# iso2 :
#     code ISO 3166-1 alpha-2 du pays.
#     Transmis à Chariow via phone.country_code.
#
# calling_code :
#     indicatif téléphonique utilisé pour normaliser le numéro.
#
# Aucun opérateur Mobile Money n'est codé dans ce service.
# Chariow reste responsable des moyens de paiement disponibles.
#
# Périmètre initial : 19 pays convenus.
# ============================================================


@dataclass(frozen=True)
class CountryPhoneConfig:
    iso2: str
    name: str
    calling_code: str


COUNTRY_PHONE_CONFIGS: dict[str, CountryPhoneConfig] = {
    "BJ": CountryPhoneConfig("BJ", "Bénin", "+229"),
    "BF": CountryPhoneConfig("BF", "Burkina Faso", "+226"),
    "BI": CountryPhoneConfig("BI", "Burundi", "+257"),
    "CM": CountryPhoneConfig("CM", "Cameroun", "+237"),
    "CF": CountryPhoneConfig(
        "CF",
        "République centrafricaine",
        "+236",
    ),
    "KM": CountryPhoneConfig("KM", "Comores", "+269"),
    "CG": CountryPhoneConfig("CG", "Congo", "+242"),
    "CI": CountryPhoneConfig(
        "CI",
        "Côte d'Ivoire",
        "+225",
    ),
    "DJ": CountryPhoneConfig("DJ", "Djibouti", "+253"),
    "GA": CountryPhoneConfig("GA", "Gabon", "+241"),
    "GN": CountryPhoneConfig("GN", "Guinée", "+224"),
    "GQ": CountryPhoneConfig(
        "GQ",
        "Guinée équatoriale",
        "+240",
    ),
    "MG": CountryPhoneConfig("MG", "Madagascar", "+261"),
    "ML": CountryPhoneConfig("ML", "Mali", "+223"),
    "NE": CountryPhoneConfig("NE", "Niger", "+227"),
    "CD": CountryPhoneConfig(
        "CD",
        "République démocratique du Congo",
        "+243",
    ),
    "RW": CountryPhoneConfig("RW", "Rwanda", "+250"),
    "SN": CountryPhoneConfig("SN", "Sénégal", "+221"),
    "TG": CountryPhoneConfig("TG", "Togo", "+228"),
}


def get_country_phone_config(
    country_iso2: str,
) -> CountryPhoneConfig:
    """Retourne la configuration correspondant au pays choisi."""
    normalized_iso2 = (
        str(country_iso2 or "")
        .strip()
        .upper()
    )

    country = COUNTRY_PHONE_CONFIGS.get(
        normalized_iso2
    )

    if country is None:
        raise HTTPException(
            status_code=400,
            detail=(
                "Pays non pris en charge pour le "
                "numéro de téléphone."
            ),
        )

    return country


def normalize_phone_number(
    phone: str,
    country_iso2: str,
) -> tuple[str, str, str]:
    """
    Normalise le numéro selon le pays choisi.

    Accepte notamment :
        06123456
        +24106123456
        0024106123456

    Retourne :
        phone_number,
        phone_international,
        country_iso2
    """
    country = get_country_phone_config(
        country_iso2
    )

    raw = str(phone or "").strip()

    if not raw:
        raise HTTPException(
            status_code=400,
            detail="Le numéro de téléphone est obligatoire.",
        )

    digits = re.sub(r"\D", "", raw)

    if not digits:
        raise HTTPException(
            status_code=400,
            detail="Le numéro de téléphone est invalide.",
        )

    calling_digits = re.sub(
        r"\D",
        "",
        country.calling_code,
    )

    # Numéro déjà saisi avec l'indicatif.
    if (
        calling_digits
        and digits.startswith(calling_digits)
        and len(digits) > len(calling_digits)
    ):
        digits = digits[len(calling_digits):]

    # Numéro international saisi avec 00.
    elif digits.startswith("00"):
        international_digits = digits[2:]

        if (
            calling_digits
            and international_digits.startswith(
                calling_digits
            )
            and len(international_digits) > len(calling_digits)
        ):
            digits = international_digits[
                len(calling_digits):
            ]

    if not digits:
        raise HTTPException(
            status_code=400,
            detail="Le numéro de téléphone est invalide.",
        )

    phone_international = (
        f"{country.calling_code}{digits}"
    )

    return (
        digits,
        phone_international,
        country.iso2,
    )


# ============================================================
# CONFIGURATION CHARIOW
# ============================================================

CHARIOW_API_URL = "https://api.chariow.com/v1/checkout"

CHARIOW_PRODUCTS = {
    # PACKS PRINCIPAUX
    "light_pack": "prd_2tjuesk8",
    "intermediate_pack": "prd_vcyhokci",
    "pro_pack": "prd_2cvlitcn",
    "business_pack": "prd_cxq3ljlo",

    # PACKS COMPLÉMENTAIRES
    "credits_1000_563": "prd_4lgc2hbs",
    "credits_2000": "prd_mfrpb7jz",
    "credits_4000": "prd_ab0u0n7q",
    "credits_10000": "prd_iapt4thh",
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
    country_iso2: str | None = None,
):
    """
    Crée un checkout Chariow.

    Chariow reçoit uniquement les informations nécessaires
    au checkout et les métadonnées permettant à LBV-Connect
    de retrouver sa transaction après le paiement.

    Le user_id LBV-Connect n'est jamais transmis à Chariow.

    La liaison avec l'utilisateur est conservée localement
    dans `payment_transactions` via `reference_id`.
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
    # PAYLOAD CHARIOW
    # --------------------------------------------------------
    # IMPORTANT :
    # Aucun user_id LBV-Connect n'est transmis à Chariow.
    #
    # La seule donnée permettant de faire le rapprochement
    # avec notre transaction locale est la référence.
    # Le user_id reste uniquement dans Supabase.

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

        if not country_iso2:
            raise HTTPException(
                status_code=400,
                detail=(
                    "Le code pays est obligatoire pour "
                    "initialiser le paiement Chariow."
                ),
            )

        phone_number, _, normalized_country_iso2 = (
            normalize_phone_number(
                phone,
                country_iso2,
            )
        )

        payload["phone"] = {
            "number": phone_number,
            "country_code": normalized_country_iso2,
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

    print(
        "[CHARIOW] HTTP STATUS:",
        response.status_code,
        flush=True,
    )

    print(
        "[CHARIOW] RESPONSE:",
        response.text[:5000],
        flush=True,
    )

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
    provider: str | None,
):
    """
    Compatibilité avec les routes existantes.

    Aucun opérateur ni moyen de paiement n'est whitelisté ici.
    Airtel, Moov, MTN, Orange, cartes, etc. ne sont pas codés
    dans LBV-Connect.

    Chariow reste responsable de déterminer les moyens de paiement
    disponibles selon le client et son pays.
    """
    if provider is None:
        return None

    if not isinstance(provider, str):
        raise HTTPException(
            status_code=400,
            detail="Fournisseur de paiement invalide.",
        )

    return provider.strip() or None