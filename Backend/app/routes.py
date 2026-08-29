import re

from fastapi import APIRouter, Header, HTTPException
from pydantic import BaseModel

from app.config.credit_costs import CreditAction
from app.core.supabase import supabase
from app.models.credit_transaction import (
    CreditTransaction,
    CreditTransactionType,
)
from app.repositories.supabase_credit_repository import (
    SupabaseCreditRepository,
)
from app.services.credit_service import (
    CreditService,
    InactivePackError,
    InsufficientCreditsError,
    UnsupportedActionError,
)
from app.services.wallet_service import WalletService

from app.config.payments import (
    ADDON_PACKS,
    PRIMARY_PACKS,
)

from app.services.payment_service import (
    create_chariow_checkout,
    generate_payment_reference,
    get_country_phone_config,
    get_payment_product,
    validate_addon_purchase,
    validate_provider,
)


router = APIRouter()


# ============================================================
# SCHEMAS
# ============================================================


class CreditConsumptionRequest(BaseModel):
    action: CreditAction
    confirmed: bool = False

class CreatePaymentRequest(BaseModel):
    payment_type: str
    product_id: str
    provider: str | None = None


class UpdatePhoneRequest(BaseModel):
    phone: str
    country_iso2: str


# ============================================================
# HELPERS — RÉPONSES
# ============================================================


def _wallet_response(wallet):
    """
    Transforme un objet CreditWallet en réponse JSON stable.
    """

    if wallet is None:
        return None

    return {
        "user_id": wallet.user_id,
        "pack_id": wallet.pack_id,
        "balance": wallet.balance,
        "initial_credits": wallet.initial_credits,
        "consumed_credits": wallet.consumed_credits,
        "consumed_percentage": wallet.consumed_percentage,
        "remaining_percentage": wallet.remaining_percentage,
        "pack_activated_at": wallet.pack_activated_at,
        "pack_expires_at": wallet.pack_expires_at,
        "is_pack_active": wallet.is_pack_active,
        "created_at": wallet.created_at,
        "updated_at": wallet.updated_at,
    }

# ============================================================
# PAIEMENTS — CRÉATION D'UNE COMMANDE
# ============================================================


@router.post("/payments/create")
def create_payment(
    request: CreatePaymentRequest,
    user_id: str | None = Header(
        default=None,
        alias="user-id",
    ),
    authorization: str | None = Header(
        default=None,
        alias="authorization",
    ),
):
    """
    Crée une commande de paiement authentifiée.

    IMPORTANT :

    Cette route ne considère PAS le paiement comme réussi.

    Elle crée uniquement une transaction :

        pending

    L'activation du pack aura lieu uniquement après
    confirmation réelle du paiement par Chariow.
    """

    # ========================================================
    # 1. AUTHENTIFICATION
    # ========================================================

    authenticated_user_id = (
        _get_authenticated_user_id(
            user_id=user_id,
            authorization=authorization,
        )
    )

    # ========================================================
    # 2. VALIDATION FOURNISSEUR
    # ========================================================

    validate_provider(
        request.provider
    )

    # ========================================================
    # 3. VALIDATION PRODUIT
    # ========================================================

    product = get_payment_product(
        payment_type=request.payment_type,
        product_id=request.product_id,
    )

    # ========================================================
    # 4. WALLET
    # ========================================================

    repository = _get_repository()

    wallet = repository.get_wallet(
        authenticated_user_id
    )

    if wallet is None:

        raise HTTPException(
            status_code=404,
            detail=(
                "Aucun portefeuille de crédits "
                "trouvé pour cet utilisateur."
            ),
        )

    # ========================================================
    # 5. COMPLÉMENT
    # ========================================================

    if request.payment_type == "addon":

        validate_addon_purchase(
            wallet
        )

    # ========================================================
    # 6. RÉFÉRENCE UNIQUE
    # ========================================================

    reference = (
        generate_payment_reference()
    )

    # ========================================================
    # 7. PAYLOAD TRANSACTION
    # ========================================================

    transaction_payload = {
        "user_id": authenticated_user_id,

        "reference": reference,

        "payment_type": request.payment_type,

        "pack_id": (
            request.product_id
            if request.payment_type
            == "primary_pack"
            else None
        ),

        "addon_id": (
            request.product_id
            if request.payment_type
            == "addon"
            else None
        ),

        # Historique : le champ reste persisté pour compatibilité.
        # Il ne sert plus à limiter les moyens de paiement.
        "provider": request.provider or "chariow",

        "amount": product["price"],

        "currency": "XAF",

        "credits": product["credits"],

        "status": "pending",

        "metadata": {
            "source": "lbv_connect",
            "version": "v1",
        },
    }

    # ========================================================
    # 8. CRÉATION SUPABASE
    # ========================================================

    try:

        response = (
            supabase
            .table(
                "payment_transactions"
            )
            .insert(
                transaction_payload
            )
            .execute()
        )

    except Exception as error:

        raise HTTPException(
            status_code=500,
            detail=(
                "Impossible de créer la transaction "
                f"de paiement : {str(error)}"
            ),
        )

    if not response.data:

        raise HTTPException(
            status_code=500,
            detail=(
                "La transaction de paiement "
                "n'a pas pu être créée."
            ),
        )

    transaction = response.data[0]

    # ========================================================
    # 9. RÉPONSE
    # ========================================================

    return {
        "success": True,

        "message": (
            "Commande de paiement créée."
        ),

        "transaction": transaction,

        "payment": {
            "reference": reference,
            # Historique : le champ reste persisté pour compatibilité.
        # Il ne sert plus à limiter les moyens de paiement.
        "provider": request.provider or "chariow",
            "payment_type": request.payment_type,
            "product_id": request.product_id,
            "amount": product["price"],
            "currency": "XAF",
            "credits": product["credits"],
            "status": "pending",
        },
    }

def _transaction_response(transaction):
    """
    Transforme une transaction en réponse JSON.
    """

    return {
        "id": getattr(transaction, "id", None),
        "user_id": getattr(transaction, "user_id", None),

        "transaction_type": (
            transaction.transaction_type.value
            if hasattr(
                transaction.transaction_type,
                "value",
            )
            else transaction.transaction_type
        ),

        "amount": getattr(
            transaction,
            "amount",
            None,
        ),

        "balance_after": getattr(
            transaction,
            "balance_after",
            None,
        ),

        "created_at": getattr(
            transaction,
            "created_at",
            None,
        ),

        "action": (
            transaction.action.value
            if getattr(
                transaction,
                "action",
                None,
            ) is not None
            and hasattr(
                transaction.action,
                "value",
            )
            else getattr(
                transaction,
                "action",
                None,
            )
        ),

        "reference_id": getattr(
            transaction,
            "reference_id",
            None,
        ),
    }

# ============================================================
# PAIEMENTS — CHECKOUT FRONTEND
# ============================================================

@router.post("/payments/checkout")
def checkout_payment(
    request: CreatePaymentRequest,
    user_id: str | None = Header(
        default=None,
        alias="user-id",
    ),
    authorization: str | None = Header(
        default=None,
        alias="authorization",
    ),
):
    """
    Alias utilisé par le frontend pour initialiser un paiement.

    Cette route crée uniquement une transaction `pending`.
    Elle ne considère jamais le paiement comme réussi.

    L'activation d'un pack principal ou l'ajout de crédits
    intervient uniquement après confirmation par le webhook
    Chariow.
    """

    authenticated_user_id = _get_authenticated_user_id(
        user_id=user_id,
        authorization=authorization,
    )

    validate_provider(
        request.provider
    )

    product = get_payment_product(
        payment_type=request.payment_type,
        product_id=request.product_id,
    )

    repository = _get_repository()

    wallet = repository.get_wallet(
        authenticated_user_id
    )

    if wallet is None:
        raise HTTPException(
            status_code=404,
            detail=(
                "Aucun portefeuille de crédits "
                "trouvé pour cet utilisateur."
            ),
        )

    if request.payment_type == "addon":
        validate_addon_purchase(
            wallet
        )

    reference = generate_payment_reference()

    transaction_payload = {
        "user_id": authenticated_user_id,
        "reference": reference,
        "payment_type": request.payment_type,
        "pack_id": (
            request.product_id
            if request.payment_type == "primary_pack"
            else None
        ),
        "addon_id": (
            request.product_id
            if request.payment_type == "addon"
            else None
        ),
        "provider": request.provider or "chariow",
        "amount": product["price"],
        "currency": "XAF",
        "credits": product["credits"],
        "status": "pending",
        "metadata": {
            "source": "lbv_connect",
            "version": "v1",
            "endpoint": "/payments/checkout",
        },
    }

    try:
        response = (
            supabase
            .table("payment_transactions")
            .insert(transaction_payload)
            .execute()
        )
    except Exception as error:
        raise HTTPException(
            status_code=500,
            detail=(
                "Impossible de créer la transaction "
                f"de paiement : {str(error)}"
            ),
        )

    if response is None or not response.data:
        raise HTTPException(
            status_code=500,
            detail=(
                "La transaction de paiement "
                "n'a pas pu être créée."
            ),
        )

    transaction = response.data[0]

    # ========================================================
    # 8. RÉCUPÉRATION DU CLIENT AUTHENTIFIÉ
    # ========================================================

    token = _extract_token(
        authorization
    )

    try:
        auth_response = supabase.auth.get_user(
            token
        )
    except Exception as error:
        raise HTTPException(
            status_code=401,
            detail=(
                "Impossible de récupérer les informations "
                "de l'utilisateur authentifié."
            ),
        ) from error

    auth_user = getattr(
        auth_response,
        "user",
        None,
    )

    if auth_user is None:
        raise HTTPException(
            status_code=401,
            detail="Utilisateur authentifié introuvable.",
        )

    customer_email = getattr(
        auth_user,
        "email",
        None,
    )

    if not customer_email:
        raise HTTPException(
            status_code=400,
            detail=(
                "Aucune adresse e-mail n'est associée "
                "à votre compte."
            ),
        )

    # ========================================================
    # 9. RÉCUPÉRATION DES INFORMATIONS CLIENT
    # ========================================================

    # Les informations peuvent être stockées dans les
    # métadonnées utilisateur Supabase. On accepte plusieurs
    # variantes de noms afin de rester compatible avec le
    # profil actuellement utilisé par le frontend.
    user_metadata = getattr(
        auth_user,
        "user_metadata",
        None,
    )

    if not isinstance(user_metadata, dict):
        user_metadata = {}

    first_name = (
        user_metadata.get("first_name")
        or user_metadata.get("firstname")
        or user_metadata.get("firstName")
        or user_metadata.get("prenom")
        or ""
    )

    last_name = (
        user_metadata.get("last_name")
        or user_metadata.get("lastname")
        or user_metadata.get("lastName")
        or user_metadata.get("nom")
        or ""
    )

    # --------------------------------------------------------
    # TÉLÉPHONE
    # --------------------------------------------------------
    #
    # Source de vérité moderne :
    #     auth.users.phone
    #
    # Compatibilité avec les anciens comptes :
    #     user_metadata.phone
    #     user_metadata.phone_number
    #     user_metadata.phoneNumber
    #     user_metadata.telephone
    # --------------------------------------------------------
    auth_phone = getattr(
        auth_user,
        "phone",
        None,
    )

    phone = (
        auth_phone
        or user_metadata.get("phone")
        or user_metadata.get("phone_number")
        or user_metadata.get("phoneNumber")
        or user_metadata.get("telephone")
        or ""
    )

    # Le pays est une donnée applicative choisie lors de l'inscription.
    # Il détermine l'indicatif attendu par la normalisation et le code ISO
    # envoyé à Chariow.
    country_iso2 = (
        user_metadata.get("country_iso2")
        or user_metadata.get("country")
        or ""
    )

    first_name = str(first_name).strip()
    last_name = str(last_name).strip()
    phone = str(phone).strip()
    country_iso2 = str(country_iso2).strip().upper()

    if not first_name:
        raise HTTPException(
            status_code=400,
            detail=(
                "Votre prénom est requis pour initialiser "
                "le paiement Chariow. Complétez votre profil."
            ),
        )

    if not last_name:
        raise HTTPException(
            status_code=400,
            detail=(
                "Votre nom est requis pour initialiser "
                "le paiement Chariow. Complétez votre profil."
            ),
        )

    if not phone:
        raise HTTPException(
            status_code=400,
            detail=(
                "Votre numéro de téléphone est requis pour "
                "initialiser le paiement Chariow. Complétez "
                "votre profil."
            ),
        )

    if not country_iso2:
        raise HTTPException(
            status_code=400,
            detail=(
                "Votre pays est requis pour initialiser le "
                "paiement Chariow. Complétez votre profil."
            ),
        )

    # Validation explicite du pays avant l'appel Chariow.
    # Cela évite d'envoyer un code pays arbitraire.
    get_country_phone_config(
        country_iso2
    )

    # ========================================================
    # 10. CRÉATION DU CHECKOUT CHARIOW
    # ========================================================

    chariow_checkout = create_chariow_checkout(
        product_id=request.product_id,
        reference_id=reference,
        email=customer_email,
        first_name=first_name,
        last_name=last_name,
        phone=phone,
        country_iso2=country_iso2,
    )

    checkout_url = chariow_checkout[
        "checkout_url"
    ]

    # ========================================================
    # 10. RÉPONSE FRONTEND
    # ========================================================

    return {
        "success": True,
        "message": "Checkout Chariow créé.",
        "transaction": transaction,
        "payment": {
            "reference": reference,
            "provider": request.provider or "chariow",
            "payment_type": request.payment_type,
            "product_id": request.product_id,
            "amount": product["price"],
            "currency": "XAF",
            "credits": product["credits"],
            "status": "pending",
            "checkout_url": checkout_url,
            "chariow_product_id": chariow_checkout[
                "chariow_product_id"
            ],
        },
        "checkout_url": checkout_url,
    }


# ============================================================
# AUTHENTIFICATION
# ============================================================


def _extract_token(
    authorization: str | None,
) -> str:
    """
    Nettoie le header Authorization.

    Format attendu :

        Authorization: Bearer <SUPABASE_ACCESS_TOKEN>
    """

    if not authorization:
        raise HTTPException(
            status_code=401,
            detail="Header authorization manquant.",
        )

    clean_token = authorization.strip()

    if clean_token.lower().startswith("bearer "):
        clean_token = clean_token[7:].strip()

    if not clean_token:
        raise HTTPException(
            status_code=401,
            detail="Token d'authentification manquant.",
        )

    return clean_token


def _authenticate_user(
    user_id: str | None,
    authorization: str | None,
) -> str:
    """
    Authentifie l'utilisateur connecté.

    Le frontend transmet :

        user-id: <UUID utilisateur>
        authorization: Bearer <access_token>

    Le backend :

        1. vérifie que les headers existent ;
        2. nettoie le token ;
        3. demande à Supabase de vérifier le token ;
        4. récupère l'identité réelle ;
        5. compare l'identité du token au user-id transmis ;
        6. retourne l'UUID utilisateur validé.

    Le user_id transmis par le frontend n'est donc jamais
    considéré comme une preuve d'identité à lui seul.
    """

    if not user_id:
        raise HTTPException(
            status_code=401,
            detail="Header user-id manquant.",
        )

    token = _extract_token(
        authorization
    )

    try:
        response = supabase.auth.get_user(
            token
        )

        user = getattr(
            response,
            "user",
            None,
        )

        if user is None:
            raise HTTPException(
                status_code=401,
                detail="Utilisateur non authentifié.",
            )

        authenticated_user_id = getattr(
            user,
            "id",
            None,
        )

        if not authenticated_user_id:
            raise HTTPException(
                status_code=401,
                detail="Identifiant utilisateur introuvable.",
            )

        # --------------------------------------------------------
        # Vérification anti-usurpation
        # --------------------------------------------------------

        if authenticated_user_id != user_id:
            raise HTTPException(
                status_code=403,
                detail=(
                    "L'identifiant utilisateur ne correspond "
                    "pas au token d'authentification."
                ),
            )

        return authenticated_user_id

    except HTTPException:
        raise

    except Exception:
        raise HTTPException(
            status_code=401,
            detail=(
                "Session utilisateur invalide ou expirée."
            ),
        )


def _get_authenticated_user_id(
    user_id: str | None,
    authorization: str | None,
) -> str:
    """
    Point d'entrée unique pour les routes protégées.
    """

    return _authenticate_user(
        user_id=user_id,
        authorization=authorization,
    )


# ============================================================
# PROFIL — NUMÉRO DE TÉLÉPHONE
# ============================================================


@router.put("/profile/phone")
def update_my_phone(
    request: UpdatePhoneRequest,
    user_id: str | None = Header(
        default=None,
        alias="user-id",
    ),
    authorization: str | None = Header(
        default=None,
        alias="authorization",
    ),
):
    """
    Enregistre directement le numéro de l'utilisateur authentifié
    dans la colonne native `auth.users.phone`.

    Flux attendu :
        register Supabase
            -> session immédiate
            -> PUT /profile/phone
            -> auth.users.phone
            -> checkout Chariow

    La confirmation e-mail doit être désactivée dans Supabase afin que
    `signUp()` puisse retourner une session immédiatement.

    Le numéro n'est pas stocké uniquement dans
    `raw_user_meta_data.phone` : cette route écrit explicitement dans
    la colonne native `auth.users.phone` avec la Service Role Key.
    """

    authenticated_user_id = _get_authenticated_user_id(
        user_id=user_id,
        authorization=authorization,
    )

    return _set_user_phone(
        user_id=authenticated_user_id,
        phone=request.phone,
        country_iso2=request.country_iso2,
    )


def _set_user_phone(
    user_id: str,
    phone: str,
    country_iso2: str,
) -> dict:
    """
    Normalise le numéro puis l'écrit dans `auth.users.phone`.

    Cette fonction utilise le client Supabase configuré avec la
    Service Role Key. Elle ne déclenche aucune validation SMS :
    le téléphone est une donnée de profil applicative.
    """

    # ========================================================
    # 1. VALIDATION DU PAYS
    # ========================================================

    normalized_country = (
        str(country_iso2)
        .strip()
        .upper()
    )

    try:
        country_config = get_country_phone_config(
            normalized_country
        )
    except Exception as error:
        raise HTTPException(
            status_code=400,
            detail=(
                f"Pays non supporté : "
                f"{normalized_country or 'inconnu'}."
            ),
        ) from error

    # ========================================================
    # 2. NORMALISATION DU NUMÉRO
    # ========================================================

    raw_phone = str(phone).strip()

    if not raw_phone:
        raise HTTPException(
            status_code=400,
            detail="Le numéro de téléphone est requis.",
        )

    digits = re.sub(
        r"\D",
        "",
        raw_phone,
    )

    if not digits:
        raise HTTPException(
            status_code=400,
            detail="Le numéro de téléphone est invalide.",
        )

    calling_digits = re.sub(
        r"\D",
        "",
        str(country_config.calling_code),
    )

    # +24177379848 -> 77379848
    if (
        calling_digits
        and digits.startswith(calling_digits)
        and len(digits) > len(calling_digits)
    ):
        digits = digits[len(calling_digits):]

    # 0024177379848 -> 77379848
    elif digits.startswith("00"):
        international_digits = digits[2:]

        if (
            calling_digits
            and international_digits.startswith(
                calling_digits
            )
            and len(international_digits) > len(calling_digits)
        ):
            digits = international_digits[len(calling_digits):]

    # 077379848 -> 77379848
    if digits.startswith("0"):
        digits = digits[1:]

    if not digits:
        raise HTTPException(
            status_code=400,
            detail="Le numéro de téléphone est invalide.",
        )
    calling_digits = re.sub(
        r"\D",
        "",
        str(country_config.calling_code),
    )

    if not calling_digits:
        raise HTTPException(
            status_code=400,
            detail="Indicatif téléphonique du pays invalide.",
        )

    phone_international = (
        f"+{calling_digits}{digits}"
    )

    # ========================================================
    # 3. ÉCRITURE DIRECTE DANS auth.users.phone
    # ========================================================

    try:
        response = (
            supabase
            .auth
            .admin
            .update_user_by_id(
                user_id,
                {
                    "phone": phone_international,
                },
            )
        )
    except Exception as error:
        raise HTTPException(
            status_code=500,
            detail=(
                "Impossible d'enregistrer le numéro dans "
                f"auth.users.phone : {str(error)}"
            ),
        ) from error

    updated_user = getattr(
        response,
        "user",
        None,
    )

    if updated_user is None:
        raise HTTPException(
            status_code=500,
            detail=(
                "Supabase n'a pas confirmé la mise à jour "
                "de auth.users.phone."
            ),
        )

    native_phone = getattr(
        updated_user,
        "phone",
        None,
    )

    if native_phone != phone_international:
        raise HTTPException(
            status_code=500,
            detail=(
                "Supabase n'a pas retourné le numéro attendu "
                f"dans auth.users.phone : {native_phone!r}."
            ),
        )

    return {
        "success": True,
        "message": (
            "Numéro de téléphone enregistré dans "
            "auth.users.phone."
        ),
        "user_id": user_id,
        "phone": phone_international,
        "country_iso2": normalized_country,
    }


# HELPERS — REPOSITORY
# ============================================================


def _get_repository():
    """
    Centralise la création du repository Supabase.
    """

    return SupabaseCreditRepository(
        supabase
    )


def _get_wallet_service():
    """
    Centralise la création du WalletService.
    """

    repository = _get_repository()

    return WalletService(
        repository
    )


# ============================================================
# WALLET — UTILISATEUR CONNECTÉ
# ============================================================


@router.get(
    "/credits/me"
)
def get_my_wallet(
    user_id: str | None = Header(
        default=None,
        alias="user-id",
    ),
    authorization: str | None = Header(
        default=None,
        alias="authorization",
    ),
):
    """
    Retourne le portefeuille de crédits
    de l'utilisateur authentifié.

    Endpoint frontend :

        GET /credits/me

    Headers :

        user-id: <UUID>
        authorization: Bearer <TOKEN>
    """

    authenticated_user_id = (
        _get_authenticated_user_id(
            user_id=user_id,
            authorization=authorization,
        )
    )

    repository = _get_repository()

    wallet = repository.get_wallet(
        authenticated_user_id
    )

    if wallet is None:
        raise HTTPException(
            status_code=404,
            detail=(
                "Aucun portefeuille de crédits "
                "trouvé pour cet utilisateur."
            ),
        )

    return {
        "success": True,
        "wallet": _wallet_response(
            wallet
        ),
    }


# ============================================================
# TRANSACTIONS — UTILISATEUR CONNECTÉ
# ============================================================


@router.get(
    "/credits/me/transactions"
)
def get_my_credit_transactions(
    user_id: str | None = Header(
        default=None,
        alias="user-id",
    ),
    authorization: str | None = Header(
        default=None,
        alias="authorization",
    ),
):
    """
    Retourne les transactions de crédits
    de l'utilisateur authentifié.
    """

    authenticated_user_id = (
        _get_authenticated_user_id(
            user_id=user_id,
            authorization=authorization,
        )
    )

    repository = _get_repository()

    try:
        transactions = (
            repository.get_transactions(
                authenticated_user_id
            )
        )

    except AttributeError:
        raise HTTPException(
            status_code=500,
            detail=(
                "La méthode get_transactions(user_id) "
                "n'existe pas encore dans "
                "SupabaseCreditRepository."
            ),
        )

    return {
        "success": True,
        "user_id": authenticated_user_id,
        "transactions": [
            _transaction_response(
                transaction
            )
            for transaction in transactions
        ],
    }


# ============================================================
# CONSOMMATION — UTILISATEUR CONNECTÉ
# ============================================================


@router.post(
    "/credits/me/consume"
)
def consume_my_credits(
    request: CreditConsumptionRequest,
    user_id: str | None = Header(
        default=None,
        alias="user-id",
    ),
    authorization: str | None = Header(
        default=None,
        alias="authorization",
    ),
):
    """
    Consomme des crédits pour l'utilisateur authentifié.

    Le débit réel est effectué atomiquement par la RPC Supabase
    `consume_credits` via SupabaseCreditRepository.

    IMPORTANT :
    - le frontend ne fournit jamais le montant des crédits ;
    - le coût est déterminé côté backend ;
    - les requêtes multimodales peuvent fournir un `cost_override`
      calculé côté backend ;
    - aucune mise à jour manuelle du wallet ni transaction
      supplémentaire n'est effectuée après la RPC.
    """

    # ========================================================
    # 1. AUTHENTIFICATION
    # ========================================================

    authenticated_user_id = (
        _get_authenticated_user_id(
            user_id=user_id,
            authorization=authorization,
        )
    )

    # ========================================================
    # 2. REPOSITORY
    # ========================================================

    repository = _get_repository()

    # ========================================================
    # 3. WALLET
    # ========================================================

    wallet = repository.get_wallet(
        authenticated_user_id
    )

    if wallet is None:
        raise HTTPException(
            status_code=404,
            detail=(
                "Aucun portefeuille de crédits "
                "trouvé pour cet utilisateur."
            ),
        )

    try:
        # ====================================================
        # 4. CONSOMMATION ATOMIQUE
        # ====================================================

        service = CreditService()

        result = service.consume(
            wallet=wallet,
            action=request.action,
            confirmed=request.confirmed,
            repository=repository,
            user_id=authenticated_user_id,
            reference_id=None,
        )

        # ====================================================
        # 5. RÉPONSE
        # ====================================================

        return {
            "success": True,
            "user_id": authenticated_user_id,
            "pack_id": wallet.pack_id,
            "action": result.action.value,
            "cost": result.cost,
            "previous_balance": result.previous_balance,
            "new_balance": result.new_balance,
            "consumed_credits": result.consumed_credits,
            "consumed_percentage": result.consumed_percentage,
            "remaining_percentage": result.remaining_percentage,
            "requires_warning": result.requires_warning,
            "requires_critical_warning": (
                result.requires_critical_warning
            ),
            "requires_confirmation": (
                result.requires_confirmation
            ),
        }

    except InactivePackError as error:
        raise HTTPException(
            status_code=403,
            detail=str(error),
        )

    except InsufficientCreditsError as error:
        raise HTTPException(
            status_code=402,
            detail=str(error),
        )

    except UnsupportedActionError as error:
        raise HTTPException(
            status_code=403,
            detail=str(error),
        )

    except ValueError as error:
        raise HTTPException(
            status_code=400,
            detail=str(error),
        )

    except HTTPException:
        raise

    except Exception as error:
        raise HTTPException(
            status_code=500,
            detail=str(error),
        )


# ============================================================
# PACK LÉGER — TEST
# ============================================================


@router.post(
    "/credits/test/light-wallet/{user_id}"
)
def create_light_wallet_test(
    user_id: str,
):
    try:
        wallet_service = _get_wallet_service()

        wallet = (
            wallet_service
            .create_light_wallet(
                user_id
            )
        )

        return {
            "success": True,
            "message": (
                "Pack Léger attribué "
                "avec succès."
            ),
            "wallet": _wallet_response(
                wallet
            ),
        }

    except ValueError as error:
        raise HTTPException(
            status_code=409,
            detail=str(error),
        )

    except Exception as error:
        raise HTTPException(
            status_code=500,
            detail=str(error),
        )


# ============================================================
# PACK INTERMÉDIAIRE — TEST
# ============================================================


@router.post(
    "/credits/test/intermediate-wallet/{user_id}"
)
def create_intermediate_wallet_test(
    user_id: str,
):
    try:
        wallet_service = _get_wallet_service()

        wallet = (
            wallet_service
            .create_intermediate_wallet(
                user_id
            )
        )

        return {
            "success": True,
            "message": (
                "Pack Intermédiaire attribué "
                "avec succès."
            ),
            "wallet": _wallet_response(
                wallet
            ),
        }

    except ValueError as error:
        raise HTTPException(
            status_code=409,
            detail=str(error),
        )

    except Exception as error:
        raise HTTPException(
            status_code=500,
            detail=str(error),
        )


# ============================================================
# PACK PRO — TEST
# ============================================================


@router.post(
    "/credits/test/pro-wallet/{user_id}"
)
def create_pro_wallet_test(
    user_id: str,
):
    try:
        wallet_service = _get_wallet_service()

        wallet = (
            wallet_service
            .create_pro_wallet(
                user_id
            )
        )

        return {
            "success": True,
            "message": (
                "Pack Pro attribué "
                "avec succès."
            ),
            "wallet": _wallet_response(
                wallet
            ),
        }

    except ValueError as error:
        raise HTTPException(
            status_code=409,
            detail=str(error),
        )

    except Exception as error:
        raise HTTPException(
            status_code=500,
            detail=str(error),
        )


# ============================================================
# PACK BUSINESS — TEST
# ============================================================


@router.post(
    "/credits/test/business-wallet/{user_id}"
)
def create_business_wallet_test(
    user_id: str,
):
    try:
        wallet_service = _get_wallet_service()

        wallet = (
            wallet_service
            .create_business_wallet(
                user_id
            )
        )

        return {
            "success": True,
            "message": (
                "Pack Business attribué "
                "avec succès."
            ),
            "wallet": _wallet_response(
                wallet
            ),
        }

    except ValueError as error:
        raise HTTPException(
            status_code=409,
            detail=str(error),
        )

    except Exception as error:
        raise HTTPException(
            status_code=500,
            detail=str(error),
        )


# ============================================================
# CHARIOW — WEBHOOK DE PAIEMENT
# ============================================================

class ChariowWebhookRequest(BaseModel):
    """
    Payload volontairement tolérant.

    Chariow peut faire évoluer la structure du Pulse.
    Les champs sont donc normalisés par `_normalize_chariow_event`
    avant traitement.
    """
    event: str | None = None
    type: str | None = None
    status: str | None = None
    order_id: str | None = None
    transaction_id: str | None = None
    reference: str | None = None
    product_id: str | None = None
    product_name: str | None = None
    user_id: str | None = None
    customer_email: str | None = None
    email: str | None = None
    amount: int | float | str | None = None
    data: dict | None = None


def _chariow_value(payload: ChariowWebhookRequest, *keys):
    """Recherche une valeur dans le payload racine puis dans `data`."""
    raw = payload.model_dump(exclude_none=True)

    data = raw.get("data")
    if isinstance(data, dict):
        raw = {**data, **raw}

    for key in keys:
        value = raw.get(key)
        if value not in (None, ""):
            return value

    return None


def _normalize_chariow_event(payload: ChariowWebhookRequest) -> dict:
    """Normalise les champs essentiels du Pulse Chariow."""
    event = str(
        _chariow_value(payload, "event", "type") or ""
    ).strip().lower()

    status = str(
        _chariow_value(payload, "status", "payment_status")
        or ""
    ).strip().lower()

    order_id = _chariow_value(
        payload,
        "order_id",
        "transaction_id",
        "id",
        "reference",
    )

    product_id = _chariow_value(
        payload,
        "product_id",
        "product",
        "product_reference",
    )

    user_id = _chariow_value(
        payload,
        "user_id",
        "customer_id",
        "client_id",
        "metadata_user_id",
    )

    email = _chariow_value(
        payload,
        "customer_email",
        "email",
    )

    return {
        "event": event,
        "status": status,
        "order_id": str(order_id) if order_id else None,
        "product_id": str(product_id) if product_id else None,
        "user_id": str(user_id) if user_id else None,
        "email": str(email) if email else None,
    }


def _is_chariow_success(event: dict) -> bool:
    """
    Détermine si le Pulse représente une vente confirmée.

    Tant que Chariow n'a pas envoyé son payload réel de test,
    on reste volontairement conservateur : seuls les statuts
    explicitement positifs sont acceptés.
    """
    success_statuses = {
        "success",
        "successful",
        "paid",
        "completed",
        "complete",
        "succeeded",
    }

    success_events = {
        "sale_success",
        "sale_successful",
        "successful_sale",
        "vente_reussie",
        "vente réussie",
        "payment_success",
        "payment_succeeded",
    }

    return (
        event["status"] in success_statuses
        or event["event"] in success_events
    )


def _find_chariow_user_id(event: dict) -> str:
    """
    Retourne l'utilisateur LBV-Connect auquel attribuer l'achat.

    Pour la première version, le Pulse doit transmettre user_id.
    L'email seul n'est volontairement pas utilisé pour créditer
    un wallet afin d'éviter une attribution ambiguë.
    """
    if not event["user_id"]:
        raise HTTPException(
            status_code=400,
            detail=(
                "Le Pulse Chariow ne contient pas "
                "l'identifiant utilisateur LBV-Connect."
            ),
        )

    return event["user_id"]


@router.post("/payments/chariow/webhook")
def chariow_webhook(
    payload: ChariowWebhookRequest,
):
    """
    Point d'entrée Chariow pour les ventes.

    Vente réussie :
        - pack principal -> activation du pack ;
        - complément -> ajout des crédits.

    Vente échouée :
        - aucune modification du wallet.

    IMPORTANT :
    Le traitement final doit être protégé par l'idempotence
    côté base de données/RPC avant la mise en production.
    """

    event = _normalize_chariow_event(payload)

    # --------------------------------------------------------
    # 1. Échec / événement non payé
    # --------------------------------------------------------

    if not _is_chariow_success(event):
        return {
            "success": True,
            "processed": False,
            "message": "Paiement non confirmé : aucune action effectuée.",
        }

    # --------------------------------------------------------
    # 2. Données obligatoires
    # --------------------------------------------------------

    user_id = _find_chariow_user_id(event)
    reference_id = event["order_id"]

    if not reference_id:
        raise HTTPException(
            status_code=400,
            detail="Identifiant unique de commande Chariow manquant.",
        )

    product_id = event["product_id"]

    if not product_id:
        raise HTTPException(
            status_code=400,
            detail="Identifiant du produit Chariow manquant.",
        )

    # --------------------------------------------------------
    # 3. Détection du produit
    # --------------------------------------------------------

    repository = _get_repository()
    wallet_service = WalletService(repository)

    # Pack principal
    if product_id in PRIMARY_PACKS:
        product = PRIMARY_PACKS[product_id]

        if product_id == "light_pack":
            wallet = wallet_service.create_light_wallet(
                user_id=user_id,
                reference_id=reference_id,
            )
        elif product_id == "intermediate_pack":
            wallet = wallet_service.create_intermediate_wallet(
                user_id=user_id,
                reference_id=reference_id,
            )
        elif product_id == "pro_pack":
            wallet = wallet_service.create_pro_wallet(
                user_id=user_id,
                reference_id=reference_id,
            )
        elif product_id == "business_pack":
            wallet = wallet_service.create_business_wallet(
                user_id=user_id,
                reference_id=reference_id,
            )
        else:
            raise HTTPException(
                status_code=400,
                detail="Pack principal non supporté.",
            )

        return {
            "success": True,
            "processed": True,
            "payment_type": "primary_pack",
            "product_id": product_id,
            "reference_id": reference_id,
            "credits": product["credits"],
            "wallet": _wallet_response(wallet),
        }

    # Complément
    if product_id in ADDON_PACKS:
        product = ADDON_PACKS[product_id]

        wallet = repository.get_wallet(user_id)

        validate_addon_purchase(wallet)

        wallet = wallet_service.recharge(
            user_id=user_id,
            credits=product["credits"],
            reference_id=reference_id,
        )

        return {
            "success": True,
            "processed": True,
            "payment_type": "addon",
            "product_id": product_id,
            "reference_id": reference_id,
            "credits_added": product["credits"],
            "wallet": _wallet_response(wallet),
        }

    raise HTTPException(
        status_code=404,
        detail="Produit Chariow inconnu.",
    )


# ============================================================
# CONVERSATIONS + HISTORIQUE
# ============================================================
#
# Les routes ci-dessous utilisent le même client Supabase que
# le reste du backend. Ce client doit être initialisé avec
# SUPABASE_SERVICE_ROLE_KEY côté Render.
#
# L'utilisateur n'est jamais identifié uniquement par le
# user-id envoyé par le frontend :
#
#   user-id: <UUID>
#   authorization: Bearer <SUPABASE_ACCESS_TOKEN>
#
# Le token est vérifié auprès de Supabase puis comparé au
# user-id transmis.
# ============================================================


class ConversationCreateRequest(BaseModel):
    title: str = "Nouvelle conversation"
    model: str | None = None


class ConversationMessageCreateRequest(BaseModel):
    role: str
    content: str


def _validate_conversation_role(role: str) -> str:
    normalized_role = role.strip().lower()

    if normalized_role not in {"user", "assistant", "system"}:
        raise HTTPException(
            status_code=400,
            detail="Rôle de message invalide.",
        )

    return normalized_role


def _get_conversation(
    conversation_id: str,
    authenticated_user_id: str,
):
    response = (
        supabase
        .table("conversations")
        .select("*")
        .eq("id", conversation_id)
        .eq("user_id", authenticated_user_id)
        .limit(1)
        .execute()
    )

    if not response.data:
        raise HTTPException(
            status_code=404,
            detail="Conversation introuvable.",
        )

    return response.data[0]


# ============================================================
# GET /conversations
# ============================================================


@router.get("/conversations")
def get_conversations(
    user_id: str | None = Header(
        default=None,
        alias="user-id",
    ),
    authorization: str | None = Header(
        default=None,
        alias="authorization",
    ),
):
    """
    Retourne uniquement les conversations de l'utilisateur
    authentifié.
    """

    authenticated_user_id = _get_authenticated_user_id(
        user_id=user_id,
        authorization=authorization,
    )

    response = (
        supabase
        .table("conversations")
        .select("*")
        .eq("user_id", authenticated_user_id)
        .order("updated_at", desc=True)
        .execute()
    )

    return {
        "success": True,
        "user_id": authenticated_user_id,
        "conversations": response.data or [],
    }


# ============================================================
# POST /conversations
# ============================================================


@router.post("/conversations")
def create_conversation(
    request: ConversationCreateRequest,
    user_id: str | None = Header(
        default=None,
        alias="user-id",
    ),
    authorization: str | None = Header(
        default=None,
        alias="authorization",
    ),
):
    """
    Crée une conversation appartenant à l'utilisateur
    authentifié.
    """

    authenticated_user_id = _get_authenticated_user_id(
        user_id=user_id,
        authorization=authorization,
    )

    title = request.title.strip() or "Nouvelle conversation"

    payload = {
        "user_id": authenticated_user_id,
        "title": title,
    }

    if request.model:
        payload["model"] = request.model

    response = (
        supabase
        .table("conversations")
        .insert(payload)
        .execute()
    )

    if not response.data:
        raise HTTPException(
            status_code=500,
            detail="Impossible de créer la conversation.",
        )

    return {
        "success": True,
        "conversation": response.data[0],
    }


# ============================================================
# GET /conversations/{conversation_id}
# ============================================================


@router.get("/conversations/{conversation_id}")
def get_conversation(
    conversation_id: str,
    user_id: str | None = Header(
        default=None,
        alias="user-id",
    ),
    authorization: str | None = Header(
        default=None,
        alias="authorization",
    ),
):
    """
    Retourne une conversation uniquement si elle appartient
    à l'utilisateur authentifié.
    """

    authenticated_user_id = _get_authenticated_user_id(
        user_id=user_id,
        authorization=authorization,
    )

    conversation = _get_conversation(
        conversation_id=conversation_id,
        authenticated_user_id=authenticated_user_id,
    )

    return {
        "success": True,
        "conversation": conversation,
    }


# ============================================================
# GET /conversations/{conversation_id}/messages
# ============================================================


@router.get("/conversations/{conversation_id}/messages")
def get_conversation_messages(
    conversation_id: str,
    user_id: str | None = Header(
        default=None,
        alias="user-id",
    ),
    authorization: str | None = Header(
        default=None,
        alias="authorization",
    ),
):
    """
    Retourne l'historique d'une conversation.

    La conversation est d'abord vérifiée contre l'utilisateur
    authentifié afin d'empêcher l'accès à l'historique d'un
    autre utilisateur.
    """

    authenticated_user_id = _get_authenticated_user_id(
        user_id=user_id,
        authorization=authorization,
    )

    _get_conversation(
        conversation_id=conversation_id,
        authenticated_user_id=authenticated_user_id,
    )

    response = (
        supabase
        .table("messages")
        .select("*")
        .eq("conversation_id", conversation_id)
        .order("created_at", desc=False)
        .execute()
    )

    return {
        "success": True,
        "conversation_id": conversation_id,
        "messages": response.data or [],
    }


# ============================================================
# POST /conversations/{conversation_id}/messages
# ============================================================


@router.post("/conversations/{conversation_id}/messages")
def create_conversation_message(
    conversation_id: str,
    request: ConversationMessageCreateRequest,
    user_id: str | None = Header(
        default=None,
        alias="user-id",
    ),
    authorization: str | None = Header(
        default=None,
        alias="authorization",
    ),
):
    """
    Ajoute un message à une conversation authentifiée.

    Cette route est utile pour la persistance de l'historique.
    Le moteur IA peut également utiliser directement cette
    route après une réponse OpenAI réussie.
    """

    authenticated_user_id = _get_authenticated_user_id(
        user_id=user_id,
        authorization=authorization,
    )

    _get_conversation(
        conversation_id=conversation_id,
        authenticated_user_id=authenticated_user_id,
    )

    role = _validate_conversation_role(request.role)
    content = request.content.strip()

    if not content:
        raise HTTPException(
            status_code=400,
            detail="Le contenu du message ne peut pas être vide.",
        )

    response = (
        supabase
        .table("messages")
        .insert(
            {
                "conversation_id": conversation_id,
                "user_id": authenticated_user_id,
                "role": role,
                "content": content,
            }
        )
        .execute()
    )

    if not response.data:
        raise HTTPException(
            status_code=500,
            detail="Impossible d'enregistrer le message.",
        )

    # Mise à jour de la date de dernière activité.
    supabase.table("conversations").update(
        {
            "updated_at": "now()",
        }
    ).eq(
        "id",
        conversation_id,
    ).eq(
        "user_id",
        authenticated_user_id,
    ).execute()

    return {
        "success": True,
        "message": response.data[0],
    }


# ============================================================
# DELETE /conversations/{conversation_id}
# ============================================================


@router.delete("/conversations/{conversation_id}")
def delete_conversation(
    conversation_id: str,
    user_id: str | None = Header(
        default=None,
        alias="user-id",
    ),
    authorization: str | None = Header(
        default=None,
        alias="authorization",
    ),
):
    """
    Supprime une conversation appartenant à l'utilisateur
    authentifié.

    Les messages liés doivent être supprimés par la base via
    une contrainte ON DELETE CASCADE, ou être supprimés avant
    la conversation si cette contrainte n'existe pas.
    """

    authenticated_user_id = _get_authenticated_user_id(
        user_id=user_id,
        authorization=authorization,
    )

    _get_conversation(
        conversation_id=conversation_id,
        authenticated_user_id=authenticated_user_id,
    )

    # Suppression explicite des messages afin de ne pas dépendre
    # d'une configuration CASCADE particulière.
    supabase.table("messages").delete().eq(
        "conversation_id",
        conversation_id,
    ).execute()

    response = (
        supabase
        .table("conversations")
        .delete()
        .eq("id", conversation_id)
        .eq("user_id", authenticated_user_id)
        .execute()
    )

    if not response.data:
        raise HTTPException(
            status_code=404,
            detail="Conversation introuvable ou déjà supprimée.",
        )

    return {
        "success": True,
        "conversation_id": conversation_id,
    }


# ============================================================
# MÉDIAS — MES CRÉATIONS
# ============================================================

def _build_media_public_url(storage_path: str | None) -> str | None:
    """
    Construit l'URL publique canonique d'un média Supabase Storage.

    `storage_path` est la source de vérité :
        <user_id>/images/<media_id>.png
        <user_id>/videos/<media_id>.mp4

    Le bucket `generated-media` doit être public.
    """
    if not storage_path:
        return None

    try:
        response = (
            supabase.storage
            .from_("generated-media")
            .get_public_url(storage_path)
        )
    except Exception:
        return None

    public_url = None

    if isinstance(response, str):
        public_url = response
    elif isinstance(response, dict):
        data = response.get("data", response)
        if isinstance(data, dict):
            public_url = (
                data.get("publicUrl")
                or data.get("public_url")
                or data.get("url")
            )
    else:
        data = getattr(response, "data", None)
        if isinstance(data, dict):
            public_url = (
                data.get("publicUrl")
                or data.get("public_url")
                or data.get("url")
            )

    if not public_url:
        return None

    public_url = str(public_url).strip()

    # Même si un client/SDK renvoie une URL signée, on normalise vers
    # l'endpoint public et on retire le token d'expiration.
    public_url = public_url.replace(
        "/storage/v1/object/sign/",
        "/storage/v1/object/public/",
    )

    try:
        from urllib.parse import urlsplit, urlunsplit

        parsed = urlsplit(public_url)
        public_url = urlunsplit(
            (
                parsed.scheme,
                parsed.netloc,
                parsed.path,
                "",
                "",
            )
        )
    except Exception:
        pass

    return public_url
#
# Les créations générées sont persistées dans Supabase.
# Ces routes utilisent la même authentification que les autres
# ressources protégées : le token Supabase est vérifié puis
# comparé au user-id transmis par le frontend.
#
# Table Supabase attendue :
#     generated_media
#
# Colonnes utilisées :
#     id
#     user_id
#     media_type
#     prompt
#     storage_path
#     public_url
#     mime_type
#     size_bytes
#     metadata
#     created_at
#     updated_at
#
# Le frontend peut utiliser `public_url` pour afficher la création
# et laisser le navigateur gérer son téléchargement / "Enregistrer sous".
# ============================================================


class MediaCreateRequest(BaseModel):
    media_type: str
    prompt: str | None = None
    storage_path: str | None = None
    public_url: str | None = None
    mime_type: str | None = None
    size_bytes: int | None = None
    metadata: dict | None = None


def _validate_media_type(media_type: str) -> str:
    normalized_media_type = media_type.strip().lower()

    if normalized_media_type not in {"image", "video"}:
        raise HTTPException(
            status_code=400,
            detail="Type de média invalide. Utilisez 'image' ou 'video'.",
        )

    return normalized_media_type


def _media_response(media: dict) -> dict:
    """
    Normalise une création média pour le frontend.

    `storage_path` est la source de vérité pour l'URL.
    `url`, `media_url` et `public_url` sont exposés ensemble afin
    que les différents frontends puissent utiliser le même contrat.
    """
    storage_path = media.get("storage_path")

    public_url = _build_media_public_url(
        str(storage_path)
        if storage_path
        else None
    )

    # Fallback uniquement si storage_path n'est pas disponible.
    if not public_url:
        persisted_url = (
            media.get("url")
            or media.get("public_url")
            or media.get("media_url")
        )
        if persisted_url:
            public_url = str(persisted_url).strip()

    return {
        "id": media.get("id"),
        "user_id": media.get("user_id"),
        "media_type": (
            media.get("media_type")
            or media.get("type")
        ),
        "type": (
            media.get("type")
            or media.get("media_type")
        ),
        "prompt": media.get("prompt"),
        "storage_path": storage_path,
        "url": public_url,
        "media_url": public_url,
        "public_url": public_url,
        "mime_type": media.get("mime_type"),
        "size_bytes": media.get("size_bytes"),
        "metadata": media.get("metadata") or {},
        "created_at": media.get("created_at"),
        "updated_at": media.get("updated_at"),
    }


# ============================================================
# GET /media
# ============================================================


@router.get("/media")
def get_my_media(
    user_id: str | None = Header(
        default=None,
        alias="user-id",
    ),
    authorization: str | None = Header(
        default=None,
        alias="authorization",
    ),
):
    """
    Retourne toutes les créations média de l'utilisateur authentifié.

    Cette route constitue l'endpoint principal de la page
    "Mes créations". Le frontend peut l'appeler automatiquement
    au chargement de la page.
    """

    authenticated_user_id = _get_authenticated_user_id(
        user_id=user_id,
        authorization=authorization,
    )

    try:
        response = (
            supabase
            .table("generated_media")
            .select("*")
            .eq("user_id", authenticated_user_id)
            .order("created_at", desc=True)
            .execute()
        )
    except Exception as error:
        raise HTTPException(
            status_code=500,
            detail=f"Impossible de récupérer les créations média : {str(error)}",
        )

    media = response.data or []

    return {
        "success": True,
        "user_id": authenticated_user_id,
        "media": [
            _media_response(item)
            for item in media
        ],
        "count": len(media),
    }


# ============================================================
# GET /media/images
# ============================================================


@router.get("/media/images")
def get_my_images(
    user_id: str | None = Header(
        default=None,
        alias="user-id",
    ),
    authorization: str | None = Header(
        default=None,
        alias="authorization",
    ),
):
    """
    Retourne uniquement les images générées par l'utilisateur.
    """

    authenticated_user_id = _get_authenticated_user_id(
        user_id=user_id,
        authorization=authorization,
    )

    try:
        response = (
            supabase
            .table("generated_media")
            .select("*")
            .eq("user_id", authenticated_user_id)
            .eq("media_type", "image")
            .order("created_at", desc=True)
            .execute()
        )
    except Exception as error:
        raise HTTPException(
            status_code=500,
            detail=f"Impossible de récupérer les images : {str(error)}",
        )

    media = response.data or []

    return {
        "success": True,
        "user_id": authenticated_user_id,
        "media": [
            _media_response(item)
            for item in media
        ],
        "count": len(media),
    }


# ============================================================
# GET /media/videos
# ============================================================


@router.get("/media/videos")
def get_my_videos(
    user_id: str | None = Header(
        default=None,
        alias="user-id",
    ),
    authorization: str | None = Header(
        default=None,
        alias="authorization",
    ),
):
    """
    Retourne uniquement les vidéos générées par l'utilisateur.
    """

    authenticated_user_id = _get_authenticated_user_id(
        user_id=user_id,
        authorization=authorization,
    )

    try:
        response = (
            supabase
            .table("generated_media")
            .select("*")
            .eq("user_id", authenticated_user_id)
            .eq("media_type", "video")
            .order("created_at", desc=True)
            .execute()
        )
    except Exception as error:
        raise HTTPException(
            status_code=500,
            detail=f"Impossible de récupérer les vidéos : {str(error)}",
        )

    media = response.data or []

    return {
        "success": True,
        "user_id": authenticated_user_id,
        "media": [
            _media_response(item)
            for item in media
        ],
        "count": len(media),
    }


# ============================================================
# GET /media/{media_id}
# ============================================================


@router.get("/media/{media_id}")
def get_my_media_by_id(
    media_id: str,
    user_id: str | None = Header(
        default=None,
        alias="user-id",
    ),
    authorization: str | None = Header(
        default=None,
        alias="authorization",
    ),
):
    """
    Retourne une création média précise appartenant
    à l'utilisateur authentifié.
    """

    authenticated_user_id = _get_authenticated_user_id(
        user_id=user_id,
        authorization=authorization,
    )

    try:
        response = (
            supabase
            .table("generated_media")
            .select("*")
            .eq("id", media_id)
            .eq("user_id", authenticated_user_id)
            .limit(1)
            .execute()
        )
    except Exception as error:
        raise HTTPException(
            status_code=500,
            detail=f"Impossible de récupérer la création média : {str(error)}",
        )

    if not response.data:
        raise HTTPException(
            status_code=404,
            detail="Création média introuvable.",
        )

    return {
        "success": True,
        "media": _media_response(response.data[0]),
    }


# ============================================================
# DELETE /media/{media_id}
# ============================================================


@router.delete("/media/{media_id}")
def delete_my_media(
    media_id: str,
    user_id: str | None = Header(
        default=None,
        alias="user-id",
    ),
    authorization: str | None = Header(
        default=None,
        alias="authorization",
    ),
):
    """
    Supprime une création média appartenant à l'utilisateur.

    La suppression de la ligne de métadonnées ne supprime pas
    automatiquement le fichier du Storage. La suppression du
    fichier Storage reste donc une responsabilité du service
    média / repository si elle est implémentée.
    """

    authenticated_user_id = _get_authenticated_user_id(
        user_id=user_id,
        authorization=authorization,
    )

    try:
        response = (
            supabase
            .table("generated_media")
            .delete()
            .eq("id", media_id)
            .eq("user_id", authenticated_user_id)
            .execute()
        )
    except Exception as error:
        raise HTTPException(
            status_code=500,
            detail=f"Impossible de supprimer la création média : {str(error)}",
        )

    if not response.data:
        raise HTTPException(
            status_code=404,
            detail="Création média introuvable ou déjà supprimée.",
        )

    return {
        "success": True,
        "media_id": media_id,
        "message": "Création média supprimée.",
    }