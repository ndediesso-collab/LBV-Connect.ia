import re

from fastapi import APIRouter, Header, HTTPException
from pydantic import BaseModel
from datetime import datetime, timezone

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

    # ========================================================
    # 5. COMPLÉMENT
    # ========================================================
    #
    # Un premier achat de pack principal ne nécessite PAS
    # de wallet existant.
    #
    # Le wallet est créé uniquement après confirmation réelle
    # du paiement par le webhook Chariow.
    #
    # En revanche, un addon nécessite obligatoirement un wallet
    # déjà actif puisqu'il recharge un pack existant.
    # ========================================================

    if request.payment_type == "addon":

        if wallet is None:
            raise HTTPException(
                status_code=404,
                detail=(
                    "Aucun portefeuille de crédits "
                    "trouvé pour cet utilisateur. "
                    "Un pack principal doit être acheté "
                    "avant de pouvoir acheter un complément."
                ),
            )

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

    Flux :

        Frontend
            ↓
        payment_transactions Supabase
            ↓
        référence locale persistée
            ↓
        Chariow
            ↓
        webhook Chariow
            ↓
        recherche par référence
            ↓
        activation du wallet

    La transaction est toujours créée en `pending`.
    L'activation du pack intervient uniquement après
    confirmation réelle du paiement par Chariow.
    """

    # ========================================================
    # 1. AUTHENTIFICATION
    # ========================================================

    authenticated_user_id = _get_authenticated_user_id(
        user_id=user_id,
        authorization=authorization,
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
    # 4. REPOSITORY / WALLET
    # ========================================================

    repository = _get_repository()

    wallet = repository.get_wallet(
        authenticated_user_id
    )

    # ========================================================
    # 5. VALIDATION ADDON
    # ========================================================

    if request.payment_type == "addon":

        if wallet is None:
            raise HTTPException(
                status_code=404,
                detail=(
                    "Aucun portefeuille de crédits "
                    "trouvé pour cet utilisateur. "
                    "Un pack principal doit être acheté "
                    "avant de pouvoir acheter un complément."
                ),
            )

        validate_addon_purchase(
            wallet
        )

    # ========================================================
    # 6. RÉFÉRENCE UNIQUE LOCALE
    # ========================================================

    reference = generate_payment_reference()

    print(
        "[PAYMENT CHECKOUT] "
        f"reference_generated={reference!r} "
        f"user_id={authenticated_user_id!r} "
        f"product_id={request.product_id!r} "
        f"payment_type={request.payment_type!r}",
        flush=True,
    )

    # ========================================================
    # 7. TRANSACTION SUPABASE
    # ========================================================

    transaction_payload = {
        "user_id": authenticated_user_id,

        # Référence principale utilisée par le webhook.
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

        # IMPORTANT :
        # On conserve également la référence dans metadata.
        # Cela permet au webhook de disposer d'une seconde
        # voie de correspondance si nécessaire.
        "metadata": {
            "source": "lbv_connect",
            "version": "v1",
            "endpoint": "/payments/checkout",

            # Liaison explicite avec Chariow.
            "lbv_reference_id": reference,

            # Informations internes utiles au diagnostic.
            "lbv_user_id": authenticated_user_id,
            "lbv_product_id": request.product_id,
            "lbv_payment_type": request.payment_type,
            "lbv_credits": product["credits"],
        },
    }

    # ========================================================
    # 8. CRÉATION SUPABASE AVANT CHARIOW
    # ========================================================

    try:

        response = (
            supabase
            .table("payment_transactions")
            .insert(transaction_payload)
            .execute()
        )

    except Exception as error:

        print(
            "[PAYMENT CHECKOUT] "
            f"supabase_insert_error={str(error)!r} "
            f"reference={reference!r}",
            flush=True,
        )

        raise HTTPException(
            status_code=500,
            detail=(
                "Impossible de créer la transaction "
                f"de paiement : {str(error)}"
            ),
        ) from error

    # ========================================================
    # 9. VÉRIFICATION INSERT
    # ========================================================

    if response is None or not response.data:

        print(
            "[PAYMENT CHECKOUT] "
            f"supabase_insert_failed=True "
            f"reference={reference!r}",
            flush=True,
        )

        raise HTTPException(
            status_code=500,
            detail=(
                "La transaction de paiement "
                "n'a pas pu être créée."
            ),
        )

    transaction = response.data[0]

    # ========================================================
    # 10. RÉCUPÉRATION DE LA RÉFÉRENCE RÉELLEMENT PERSISTÉE
    # ========================================================

    persisted_reference = transaction.get(
        "reference"
    )

    if not persisted_reference:

        raise HTTPException(
            status_code=500,
            detail=(
                "Supabase a créé la transaction mais "
                "aucune référence de paiement n'a été retournée."
            ),
        )

    # IMPORTANT :
    # À partir de maintenant, on utilise exclusivement
    # la référence réellement retournée par Supabase.
    reference = str(
        persisted_reference
    ).strip()

    print(
        "[PAYMENT CHECKOUT] "
        "supabase_transaction_created=True "
        f"reference={reference!r} "
        f"transaction_id={transaction.get('id')!r} "
        f"user_id={transaction.get('user_id')!r} "
        f"payment_type={transaction.get('payment_type')!r} "
        f"pack_id={transaction.get('pack_id')!r} "
        f"addon_id={transaction.get('addon_id')!r} "
        f"credits={transaction.get('credits')!r} "
        f"status={transaction.get('status')!r}",
        flush=True,
    )

    # ========================================================
    # 11. RÉCUPÉRATION DU CLIENT AUTHENTIFIÉ
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
    # 12. INFORMATIONS CLIENT
    # ========================================================

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

    # ========================================================
    # 13. TÉLÉPHONE
    # ========================================================

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

    # ========================================================
    # 14. VALIDATION PAYS
    # ========================================================

    get_country_phone_config(
        country_iso2
    )

    # ========================================================
    # 15. CRÉATION CHECKOUT CHARIOW
    # ========================================================

    phone_for_chariow = str(
        phone
    ).strip()

    if not phone_for_chariow.startswith("+"):
        phone_for_chariow = (
            f"+{phone_for_chariow}"
        )

    print(
        "[PAYMENT CHECKOUT] "
        "sending_to_chariow=True "
        f"reference={reference!r} "
        f"product_id={request.product_id!r} "
        f"email={customer_email!r}",
        flush=True,
    )

    chariow_checkout = create_chariow_checkout(
        product_id=request.product_id,
        reference_id=reference,
        email=customer_email,
        first_name=first_name,
        last_name=last_name,
        phone=phone_for_chariow,
        country_iso2=country_iso2,
    )

    checkout_url = chariow_checkout[
        "checkout_url"
    ]

    # ========================================================
    # 16. RÉPONSE FRONTEND
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

    # Numéro final au format international.
    # Exemple Gabon :
    # 77379848 -> +24177379848
    phone_international = (
        f"{country_config.calling_code}{digits}"
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

    # ========================================================
    # 4. VÉRIFICATION QUE SUPABASE A BIEN RÉPONDU
    # ========================================================

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

    # ========================================================
    # 5. SUCCÈS
    # ========================================================
    #
    # IMPORTANT :
    # On ne compare PAS `updated_user.phone` avec
    # `phone_international`.
    #
    # Le SDK Supabase peut retourner le numéro sous une forme
    # différente (ex. 24177379848) alors que la valeur envoyée
    # était +24177379848.
    #
    # Cette différence de représentation ne doit donc pas
    # provoquer une erreur 500.
    # ========================================================

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

@router.post("/ai/authorize")
def authorize_ai_request(
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
    Vérifie si l'utilisateur authentifié est autorisé
    à effectuer une requête IA.

    Cette route NE consomme PAS de crédit.

    Elle vérifie uniquement :

        1. identité authentifiée
        2. wallet existant
        3. pack actif
        4. date d'expiration non dépassée
        5. crédits disponibles

    La consommation réelle reste effectuée par
    /credits/me/consume via CreditService + RPC Supabase.
    """

    # ========================================================
    # 1. AUTHENTIFICATION
    # ========================================================

    authenticated_user_id = _get_authenticated_user_id(
        user_id=user_id,
        authorization=authorization,
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

    # ========================================================
    # 4. VÉRIFICATION PACK ACTIF
    # ========================================================

    if not wallet.is_pack_active:
        raise HTTPException(
            status_code=403,
            detail=(
                "Votre pack de crédits est expiré "
                "ou inactif."
            ),
        )

    # ========================================================
    # 5. VÉRIFICATION DATE D'ÉCHÉANCE
    # ========================================================

    if wallet.pack_expires_at is None:
        raise HTTPException(
            status_code=403,
            detail=(
                "La date d'expiration de votre pack "
                "est introuvable."
            ),
        )

    # ========================================================
    # 6. VÉRIFICATION CRÉDITS
    # ========================================================

    if wallet.balance <= 0:
        raise HTTPException(
            status_code=402,
            detail=(
                "Vous n'avez plus de crédits disponibles."
            ),
        )

    # ========================================================
    # 7. AUTORISATION
    # ========================================================

    return {
        "success": True,
        "authorized": True,
        "user_id": authenticated_user_id,
        "pack_id": wallet.pack_id,
        "balance": wallet.balance,
        "pack_activated_at": wallet.pack_activated_at,
        "pack_expires_at": wallet.pack_expires_at,
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
    reference_id: str | None = None
    product_id: str | None = None
    product_name: str | None = None
    user_id: str | None = None
    customer_email: str | None = None
    email: str | None = None
    amount: int | float | str | None = None
    metadata: dict | None = None
    data: dict | None = None


def _chariow_value(payload, *keys):
    """
    Recherche une valeur dans le payload Chariow.

    Supporte :
    - le payload racine ;
    - `sale` ;
    - `data` ;
    - `data.sale` ;
    - `metadata` ;
    - `custom_metadata` ;
    - `sale.metadata` ;
    - `sale.custom_metadata`.

    Compatible avec :
    - dict JSON natif ;
    - objets Pydantic / modèles disposant de `model_dump()`.
    """

    # ---------------------------------------------------------
    # 1. Normalisation du payload
    # ---------------------------------------------------------
    if isinstance(payload, dict):
        raw = payload

    elif hasattr(payload, "model_dump"):
        # IMPORTANT :
        # Ne pas utiliser model_dump(exclude_none=True)
        # car _RawChariowPayload implémente un model_dump()
        # qui n'accepte pas cet argument.
        raw = payload.model_dump()

    elif hasattr(payload, "dict"):
        # Compatibilité Pydantic plus ancienne
        raw = payload.dict()

    else:
        return None

    if not isinstance(raw, dict):
        return None

    # ---------------------------------------------------------
    # 2. Recherche générique dans un conteneur
    # ---------------------------------------------------------
    def search(container):
        if not isinstance(container, dict):
            return None

        # Recherche directe
        for key in keys:
            value = container.get(key)

            if value not in (None, ""):
                return value

        # Recherche dans metadata / custom_metadata
        for source_key in ("metadata", "custom_metadata"):
            source = container.get(source_key)

            if isinstance(source, dict):
                for key in keys:
                    value = source.get(key)

                    if value not in (None, ""):
                        return value

        return None

    # ---------------------------------------------------------
    # 3. Payload racine
    # ---------------------------------------------------------
    value = search(raw)

    if value not in (None, ""):
        return value

    # ---------------------------------------------------------
    # 4. Objet sale de Chariow
    # ---------------------------------------------------------
    sale = raw.get("sale")

    if isinstance(sale, dict):
        value = search(sale)

        if value not in (None, ""):
            return value

    # ---------------------------------------------------------
    # 5. Objet data
    # ---------------------------------------------------------
    data = raw.get("data")

    if isinstance(data, dict):
        value = search(data)

        if value not in (None, ""):
            return value

        # data.sale
        sale_data = data.get("sale")

        if isinstance(sale_data, dict):
            value = search(sale_data)

            if value not in (None, ""):
                return value

    # ---------------------------------------------------------
    # 6. Recherche dans product / customer si nécessaire
    # ---------------------------------------------------------
    for nested_key in ("product", "customer", "checkout", "affiliate", "store"):
        nested = raw.get(nested_key)

        if isinstance(nested, dict):
            value = search(nested)

            if value not in (None, ""):
                return value

    return None


def _normalize_chariow_event(payload) -> dict:
    """
    Normalise les champs essentiels du webhook Chariow.

    Structure Chariow observée :

        event
        sale.status
        sale.id
        sale.completed_at
        sale.custom_metadata.lbv_user_id
        sale.custom_metadata.lbv_product_id
        sale.custom_metadata.lbv_reference_id

    IMPORTANT :
    - `paid_at` provient directement de `sale.completed_at`.
    - `reference` provient prioritairement de
      `sale.custom_metadata.lbv_reference_id`.
    - Les informations reçues de Chariow servent à identifier et
      confirmer le paiement, mais ne déterminent jamais les crédits.
    """

    # ========================================================
    # 1. NORMALISATION DU PAYLOAD
    # ========================================================

    if isinstance(payload, dict):
        raw = payload

    elif hasattr(payload, "model_dump"):
        raw = payload.model_dump()

    elif hasattr(payload, "dict"):
        raw = payload.dict()

    else:
        raw = {}

    if not isinstance(raw, dict):
        raw = {}

    # ========================================================
    # 2. ÉVÉNEMENT
    # ========================================================

    event = str(
        _chariow_value(
            raw,
            "event",
            "type",
        ) or ""
    ).strip().lower()

    # ========================================================
    # 3. STATUT
    # ========================================================

    status = str(
        _chariow_value(
            raw,
            "status",
            "payment_status",
        ) or ""
    ).strip().lower()

    # ========================================================
    # 4. ID CHARIOW
    # ========================================================

    order_id = _chariow_value(
        raw,
        "order_id",
        "transaction_id",
        "id",
    )

    # ========================================================
    # 5. MÉTADONNÉES CHARIOW
    # ========================================================
    #
    # On récupère explicitement les custom_metadata de la vente.
    # C'est notamment là que Chariow transmet :
    #
    #   lbv_reference_id
    #   lbv_product_id
    #   lbv_user_id
    #
    # Cette extraction explicite évite de dépendre uniquement
    # d'une recherche générique.
    # ========================================================

    sale = raw.get("sale")

    if not isinstance(sale, dict):
        sale = {}

    sale_custom_metadata = sale.get(
        "custom_metadata"
    )

    if not isinstance(
        sale_custom_metadata,
        dict,
    ):
        sale_custom_metadata = {}

    # ========================================================
    # 6. RÉFÉRENCE LBV-CONNECT
    # ========================================================
    #
    # PRIORITÉ :
    #
    #   sale.custom_metadata.lbv_reference_id
    #
    # puis fallback vers les autres emplacements supportés.
    # ========================================================

    reference = (
        sale_custom_metadata.get(
            "lbv_reference_id"
        )
        or _chariow_value(
            raw,
            "reference",
            "reference_id",
            "payment_reference",
            "metadata_reference",
            "lbv_reference_id",
        )
    )

    # ========================================================
    # 7. PRODUIT
    # ========================================================

    product_id = (
        sale_custom_metadata.get(
            "lbv_product_id"
        )
        or _chariow_value(
            raw,
            "product_id",
            "product_reference",
            "lbv_product_id",
        )
    )

    # ========================================================
    # 8. USER ID
    # ========================================================
    #
    # Conservé uniquement pour diagnostic.
    # Il ne sert PAS à déterminer le wallet.
    # ========================================================

    user_id = (
        sale_custom_metadata.get(
            "lbv_user_id"
        )
        or _chariow_value(
            raw,
            "user_id",
            "customer_id",
            "client_id",
            "metadata_user_id",
            "lbv_user_id",
        )
    )

    # ========================================================
    # 9. EMAIL
    # ========================================================

    email = _chariow_value(
        raw,
        "customer_email",
        "email",
    )

    # ========================================================
    # 10. MONTANT
    # ========================================================

    amount = _chariow_value(
        raw,
        "amount",
        "paid_amount",
        "total_amount",
    )

    # ========================================================
    # 11. MÉTADONNÉES
    # ========================================================
    #
    # On conserve les métadonnées complètes pour l'audit.
    # Si Chariow utilise custom_metadata dans sale, on les
    # conserve également.
    # ========================================================

    metadata = _chariow_value(
        raw,
        "metadata",
        "custom_metadata",
    )

    if not isinstance(
        metadata,
        dict,
    ):
        metadata = {}

    metadata = {
        **metadata,
        "sale_custom_metadata": sale_custom_metadata,
    }

    # ========================================================
    # 12. DATE RÉELLE DE CONFIRMATION
    # ========================================================
    #
    # Chariow envoie actuellement :
    #
    #   sale.completed_at
    #
    # Cette valeur devient directement `paid_at`.
    #
    # Aucun calcul local n'est nécessaire ici.
    # ========================================================

    paid_at = (
        sale.get("completed_at")
        or _chariow_value(
            raw,
            "paid_at",
            "completed_at",
        )
    )

    # ========================================================
    # 13. ID TRANSACTION FOURNISSEUR
    # ========================================================

    provider_transaction_id = (
        sale.get("id")
        or _chariow_value(
            raw,
            "provider_transaction_id",
            "payment_id",
            "transaction_id",
            "id",
        )
    )

    # ========================================================
    # 14. RÉSULTAT NORMALISÉ
    # ========================================================

    normalized = {
        "event": event,

        "status": status,

        "order_id": (
            str(order_id)
            if order_id
            else None
        ),

        "reference": (
            str(reference).strip()
            if reference
            else None
        ),

        "product_id": (
            str(product_id)
            if product_id
            else None
        ),

        "user_id": (
            str(user_id)
            if user_id
            else None
        ),

        "email": (
            str(email)
            if email
            else None
        ),

        "amount": amount,

        "metadata": metadata,

        # IMPORTANT :
        # valeur provenant directement de Chariow.
        "paid_at": (
            str(paid_at)
            if paid_at
            else None
        ),

        "provider_transaction_id": (
            str(provider_transaction_id)
            if provider_transaction_id
            else None
        ),

        "raw_payload": raw,
    }

    print(
        "[CHARIOW WEBHOOK] "
        "normalized_event="
        f"{normalized['event']!r} "
        "status="
        f"{normalized['status']!r} "
        "reference="
        f"{normalized['reference']!r} "
        "paid_at="
        f"{normalized['paid_at']!r} "
        "provider_transaction_id="
        f"{normalized['provider_transaction_id']!r}",
        flush=True,
    )

    return normalized


def _is_chariow_success(event: dict) -> bool:
    """
    Détermine si le webhook Chariow représente une vente confirmée.

    Les événements/statuts explicitement positifs déclenchent
    la validation du paiement puis l'activation des crédits.
    """

    success_statuses = {
        "success",
        "successful",
        "paid",
        "completed",
        "complete",
        "succeeded",
        "approved",
        "confirmed",
        "successful_payment",
        "payment_successful",
    }

    success_events = {
        "successful.sale",
        "successful_sale",
        "sale_success",
        "sale_successful",
        "vente_reussie",
        "vente réussie",
        "payment_success",
        "payment_succeeded",
        "payment_successful",
        "purchase_success",
        "purchase_completed",
        "order_paid",
        "payment_confirmed",
    }

    normalized_event = str(
        event.get("event") or ""
    ).strip().lower()

    normalized_status = str(
        event.get("status") or ""
    ).strip().lower()

    return (
        normalized_status in success_statuses
        or normalized_event in success_events
    )


def _find_chariow_payment_transaction(
    event: dict,
) -> dict | None:
    """
    Retrouve la transaction locale créée avant le checkout Chariow.

    IMPORTANT :
    `payment_transactions` reste la source de vérité LBV-Connect.

    Le webhook Chariow peut transmettre la référence LBV-Connect
    sous différentes formes / emplacements. Cette fonction essaie
    plusieurs identifiants de correspondance sans jamais créer
    de transaction locale à partir du webhook.

    Ordre de recherche :
        1. event.reference
        2. event.order_id
        3. event.metadata.lbv_reference_id
        4. event.metadata.reference
        5. event.metadata.reference_id

    La transaction retournée provient exclusivement de
    `payment_transactions`.
    """

    candidates = []

    def add_candidate(value):
        if value is None:
            return

        value = str(value).strip()

        if value and value not in candidates:
            candidates.append(value)

    # ========================================================
    # 1. RÉFÉRENCE NORMALISÉE
    # ========================================================

    add_candidate(
        event.get("reference")
    )

    # ========================================================
    # 2. ID COMMANDE CHARIOW
    # ========================================================

    add_candidate(
        event.get("order_id")
    )

    # ========================================================
    # 3. MÉTADONNÉES CHARIOW
    # ========================================================

    metadata = event.get("metadata")

    if isinstance(metadata, dict):

        add_candidate(
            metadata.get("lbv_reference_id")
        )

        add_candidate(
            metadata.get("reference")
        )

        add_candidate(
            metadata.get("reference_id")
        )

        add_candidate(
            metadata.get("payment_reference")
        )

    # ========================================================
    # 4. DIAGNOSTIC
    # ========================================================

    print(
        "[CHARIOW WEBHOOK] "
        f"transaction_lookup_candidates={candidates!r}",
        flush=True,
    )

    # ========================================================
    # 5. RECHERCHE DANS SUPABASE
    # ========================================================

    for reference in candidates:

        try:
            response = (
                supabase
                .table("payment_transactions")
                .select("*")
                .eq("reference", reference)
                .limit(1)
                .execute()
            )

        except Exception as error:

            print(
                "[CHARIOW WEBHOOK] "
                f"transaction_lookup_error={str(error)!r} "
                f"reference={reference!r}",
                flush=True,
            )

            continue

        if response is not None and response.data:

            transaction = response.data[0]

            print(
                "[CHARIOW WEBHOOK] "
                "local_transaction_match=True "
                f"lookup_reference={reference!r} "
                f"local_reference="
                f"{transaction.get('reference')!r} "
                f"user_id="
                f"{transaction.get('user_id')!r} "
                f"payment_type="
                f"{transaction.get('payment_type')!r} "
                f"pack_id="
                f"{transaction.get('pack_id')!r} "
                f"addon_id="
                f"{transaction.get('addon_id')!r} "
                f"credits="
                f"{transaction.get('credits')!r} "
                f"status="
                f"{transaction.get('status')!r}",
                flush=True,
            )

            return transaction

    # ========================================================
    # 6. AUCUNE CORRESPONDANCE
    # ========================================================

    print(
        "[CHARIOW WEBHOOK] "
        "local_transaction_match=False "
        f"candidates={candidates!r}",
        flush=True,
    )

    return None


def _update_payment_transaction_from_chariow(
    payment_transaction: dict,
    event: dict,
    success: bool,
) -> dict:
    """
    Synchronise `payment_transactions` avec la confirmation Chariow.

    Architecture :

        Chariow
            ↓
        webhook
            ↓
        transaction locale Supabase
            ↓
        statut paid/pending
            ↓
        activation wallet

    IMPORTANT :
    - Supabase reste la source de vérité.
    - Le webhook ne modifie jamais user_id.
    - Le webhook ne modifie jamais credits.
    - Le webhook ne modifie jamais pack_id/addon_id.
    - Le montant local reste la référence commerciale.
    """

    # ========================================================
    # 1. RÉFÉRENCE LOCALE
    # ========================================================

    reference = payment_transaction.get(
        "reference"
    )

    if not reference:

        raise HTTPException(
            status_code=400,
            detail=(
                "Référence locale de paiement manquante."
            ),
        )

    reference = str(
        reference
    ).strip()

    # ========================================================
    # 2. MÉTADONNÉES EXISTANTES
    # ========================================================

    existing_metadata = (
        payment_transaction.get("metadata")
    )

    if not isinstance(
        existing_metadata,
        dict,
    ):
        existing_metadata = {}

    chariow_metadata = (
        event.get("metadata")
    )

    if not isinstance(
        chariow_metadata,
        dict,
    ):
        chariow_metadata = {}

    # ========================================================
    # 3. MÉTADONNÉES CHARIOW CONSERVÉES POUR AUDIT
    # ========================================================

    merged_metadata = {
        **existing_metadata,

        "chariow": {
            "event": event.get("event"),

            "status": event.get(
                "status"
            ),

            "order_id": event.get(
                "order_id"
            ),

            "provider_transaction_id": (
                event.get(
                    "provider_transaction_id"
                )
            ),

            "product_id": event.get(
                "product_id"
            ),

            "email": event.get(
                "email"
            ),

            "amount": event.get(
                "amount"
            ),

            "paid_at": event.get(
                "paid_at"
            ),

            "metadata": chariow_metadata,
        },
    }

    # ========================================================
    # 4. STATUT
    # ========================================================

    if success:

        status = "paid"

    else:

        status = (
            event.get("status")
            or "pending"
        )

    # ========================================================
    # 5. PAYLOAD DE MISE À JOUR
    # ========================================================

    update_payload = {
        "status": status,

        "metadata": merged_metadata,

        "provider": (
            payment_transaction.get(
                "provider"
            )
            or "chariow"
        ),
    }

    # ========================================================
    # 6. ID FOURNI PAR CHARIOW
    # ========================================================

    provider_transaction_id = (
        event.get(
            "provider_transaction_id"
        )
    )

    if provider_transaction_id:

        update_payload[
            "provider_transaction_id"
        ] = str(
            provider_transaction_id
        )

    # ========================================================
    # 7. DATE RÉELLE DE PAIEMENT
    # ========================================================

    if success:

        paid_at = event.get(
            "paid_at"
        )

        if paid_at:

            update_payload[
                "paid_at"
            ] = str(
                paid_at
            )

        else:

            update_payload[
                "paid_at"
            ] = (
                datetime.now(
                    timezone.utc
                ).isoformat()
            )

    # ========================================================
    # 8. LOG
    # ========================================================

    print(
        "[CHARIOW WEBHOOK] "
        "supabase_payment_update="
        f"reference={reference!r} "
        f"status={update_payload['status']!r} "
        "provider_transaction_id="
        f"{update_payload.get('provider_transaction_id')!r} "
        f"paid_at={update_payload.get('paid_at')!r}",
        flush=True,
    )

    # ========================================================
    # 9. MISE À JOUR SUPABASE
    # ========================================================

    try:

        response = (
            supabase
            .table(
                "payment_transactions"
            )
            .update(
                update_payload
            )
            .eq(
                "reference",
                reference,
            )
            .execute()
        )

    except Exception as error:

        print(
            "[CHARIOW WEBHOOK] "
            "supabase_payment_update_error="
            f"{str(error)!r} "
            f"reference={reference!r}",
            flush=True,
        )

        raise HTTPException(
            status_code=500,
            detail=(
                "Impossible de synchroniser "
                "la transaction de paiement "
                f"dans Supabase : {str(error)}"
            ),
        ) from error

    # ========================================================
    # 10. VALIDATION DE LA RÉPONSE SUPABASE
    # ========================================================

    if (
        response is None
        or not response.data
    ):

        raise HTTPException(
            status_code=500,
            detail=(
                "Supabase n'a pas confirmé "
                "la mise à jour de "
                "payment_transactions."
            ),
        )

    updated_transaction = (
        response.data[0]
    )

    # ========================================================
    # 11. LOG FINAL
    # ========================================================

    print(
        "[CHARIOW WEBHOOK] "
        "supabase_payment_updated=True "
        f"reference={reference!r} "
        f"status="
        f"{updated_transaction.get('status')!r} "
        f"paid_at="
        f"{updated_transaction.get('paid_at')!r} "
        "provider_transaction_id="
        f"{updated_transaction.get('provider_transaction_id')!r}",
        flush=True,
    )

    return updated_transaction


def _payment_activation_already_recorded(
    repository,
    user_id: str,
    reference_id: str,
) -> bool:
    """
    Vérifie si la référence de paiement a déjà produit une transaction
    de crédits. Cela permet de rejouer un webhook Chariow sans doubler
    les crédits, tout en permettant une nouvelle tentative si l'activation
    avait échoué après la confirmation du paiement.
    """
    try:
        transactions = repository.get_transactions(user_id)
    except Exception as error:
        print(
            "[CHARIOW WEBHOOK] "
            f"credit_transaction_lookup_error={str(error)!r} "
            f"reference_id={reference_id!r}",
            flush=True,
        )
        return False

    for transaction in transactions or []:
        transaction_reference = getattr(
            transaction,
            "reference_id",
            None,
        )
        if transaction_reference is None and isinstance(transaction, dict):
            transaction_reference = transaction.get("reference_id")

        if str(transaction_reference or "") == str(reference_id):
            return True

    return False


@router.post("/payments/chariow/webhook")
def chariow_webhook(
    payload: dict,
):
    """
    Point d'entrée Chariow pour les ventes.

    Architecture :

        Chariow
            -> webhook LBV-Connect
            -> payment_transactions Supabase
            -> lecture de la transaction confirmée
            -> activation du wallet

    Supabase est la source de vérité pour :
        - user_id
        - payment_type
        - pack_id
        - addon_id
        - credits
        - reference
        - amount

    Les informations commerciales reçues directement de Chariow
    ne servent pas à déterminer les crédits à attribuer.
    """

    print(
        "[CHARIOW WEBHOOK] RAW PAYLOAD:",
        payload,
        flush=True,
    )

    # --------------------------------------------------------
    # 1. NORMALISATION DU WEBHOOK CHARIOW
    # --------------------------------------------------------

    event = _normalize_chariow_event(payload)

    success = _is_chariow_success(event)

    print(
        "[CHARIOW WEBHOOK] "
        f"event={event.get('event')!r} "
        f"status={event.get('status')!r} "
        f"order_id={event.get('order_id')!r} "
        f"reference={event.get('reference')!r} "
        f"product_id={event.get('product_id')!r} "
        f"user_id_received={event.get('user_id')!r} "
        f"email={event.get('email')!r} "
        f"paid_at={event.get('paid_at')!r} "
        f"provider_transaction_id="
        f"{event.get('provider_transaction_id')!r} "
        f"payment_success={success}",
        flush=True,
    )

    # --------------------------------------------------------
    # 2. TRANSACTION SUPABASE OBLIGATOIRE
    # --------------------------------------------------------

    payment_transaction = _find_chariow_payment_transaction(
        event
    )

    if payment_transaction is None:
        print(
            "[CHARIOW WEBHOOK] "
            "local_transaction_found=False "
            "action=rejected",
            flush=True,
        )

        raise HTTPException(
            status_code=404,
            detail=(
                "Transaction de paiement LBV-Connect "
                "introuvable dans Supabase. "
                "Aucun crédit ne sera attribué."
            ),
        )

    print(
        "[CHARIOW WEBHOOK] "
        "local_transaction_found=True "
        f"reference={payment_transaction.get('reference')!r} "
        f"user_id={payment_transaction.get('user_id')!r} "
        f"payment_type={payment_transaction.get('payment_type')!r} "
        f"pack_id={payment_transaction.get('pack_id')!r} "
        f"addon_id={payment_transaction.get('addon_id')!r} "
        f"credits={payment_transaction.get('credits')!r} "
        f"amount={payment_transaction.get('amount')!r} "
        f"status_before={payment_transaction.get('status')!r} "
        f"paid_at_before={payment_transaction.get('paid_at')!r}",
        flush=True,
    )

    # --------------------------------------------------------
    # 3. IDENTITÉ ET DONNÉES COMMERCIALES DEPUIS SUPABASE
    # --------------------------------------------------------

    user_id = payment_transaction.get("user_id")
    reference_id = payment_transaction.get("reference")

    payment_type = payment_transaction.get(
        "payment_type"
    )

    product_id = (
        payment_transaction.get("pack_id")
        or payment_transaction.get("addon_id")
    )

    transaction_credits = payment_transaction.get(
        "credits"
    )

    if not user_id:
        raise HTTPException(
            status_code=400,
            detail=(
                "La transaction Supabase ne contient pas "
                "d'identifiant utilisateur LBV-Connect."
            ),
        )

    if not reference_id:
        raise HTTPException(
            status_code=400,
            detail="Référence locale de paiement manquante.",
        )

    if payment_type not in {
        "primary_pack",
        "addon",
    }:
        raise HTTPException(
            status_code=400,
            detail="Type de paiement Supabase invalide.",
        )

    if not product_id:
        raise HTTPException(
            status_code=400,
            detail=(
                "La transaction Supabase ne contient ni "
                "pack_id ni addon_id."
            ),
        )

    if transaction_credits in (None, ""):
        raise HTTPException(
            status_code=400,
            detail=(
                "La transaction Supabase ne contient pas "
                "le nombre de crédits à attribuer."
            ),
        )

    try:
        transaction_credits = int(
            transaction_credits
        )
    except (TypeError, ValueError) as error:
        raise HTTPException(
            status_code=400,
            detail=(
                "Le nombre de crédits de la transaction "
                "Supabase est invalide."
            ),
        ) from error

    if transaction_credits <= 0:
        raise HTTPException(
            status_code=400,
            detail=(
                "Le nombre de crédits de la transaction "
                "Supabase doit être supérieur à zéro."
            ),
        )

    # --------------------------------------------------------
    # 4. CHARIOW -> SUPABASE
    # --------------------------------------------------------

    updated_payment_transaction = (
        _update_payment_transaction_from_chariow(
            payment_transaction=payment_transaction,
            event=event,
            success=success,
        )
    )

    # Paiement non confirmé :
    # aucune activation.
    if not success:
        return {
            "success": True,
            "processed": False,
            "message": (
                "Paiement non confirmé : "
                "aucune action sur le wallet."
            ),
            "reference_id": reference_id,
            "status": updated_payment_transaction.get(
                "status"
            ),
        }

    # --------------------------------------------------------
    # 5. SUPABASE EST LA SOURCE DE VÉRITÉ
    # --------------------------------------------------------

    user_id = updated_payment_transaction.get(
        "user_id"
    )

    payment_type = updated_payment_transaction.get(
        "payment_type"
    )

    product_id = (
        updated_payment_transaction.get("pack_id")
        or updated_payment_transaction.get("addon_id")
    )

    transaction_credits = updated_payment_transaction.get(
        "credits"
    )

    reference_id = updated_payment_transaction.get(
        "reference"
    )

    if (
        str(
            updated_payment_transaction.get(
                "status",
                "",
            )
        ).lower()
        != "paid"
    ):
        raise HTTPException(
            status_code=500,
            detail=(
                "Le paiement Chariow a été confirmé mais "
                "Supabase n'a pas enregistré le statut paid."
            ),
        )

    if not updated_payment_transaction.get(
        "paid_at"
    ):
        raise HTTPException(
            status_code=500,
            detail=(
                "Le paiement Chariow a été confirmé mais "
                "Supabase n'a pas enregistré paid_at."
            ),
        )

    transaction_credits = int(
        transaction_credits
    )

    print(
        "[CHARIOW WEBHOOK] "
        "supabase_source_of_truth=True "
        f"user_id={str(user_id)!r} "
        f"payment_type={payment_type!r} "
        f"product_id={product_id!r} "
        f"credits={transaction_credits!r} "
        f"reference={reference_id!r} "
        f"status={updated_payment_transaction.get('status')!r} "
        f"paid_at={updated_payment_transaction.get('paid_at')!r}",
        flush=True,
    )

    # --------------------------------------------------------
    # 6. IDEMPOTENCE
    # --------------------------------------------------------

    repository = _get_repository()

    if _payment_activation_already_recorded(
        repository=repository,
        user_id=str(user_id),
        reference_id=str(reference_id),
    ):
        print(
            "[CHARIOW WEBHOOK] "
            "activation_already_recorded=True "
            f"reference_id={reference_id!r}",
            flush=True,
        )

        return {
            "success": True,
            "processed": False,
            "message": (
                "Paiement déjà activé. "
                "Aucun crédit supplémentaire attribué."
            ),
            "reference_id": reference_id,
            "user_id": str(user_id),
            "payment_transaction": (
                updated_payment_transaction
            ),
        }

    # --------------------------------------------------------
    # 7. ACTIVATION WALLET
    # --------------------------------------------------------

    wallet_service = WalletService(repository)

    # ========================================================
    # PACK PRINCIPAL
    # ========================================================


    if payment_type == "primary_pack":

        if product_id not in {
            "light_pack",
            "intermediate_pack",
            "pro_pack",
            "business_pack",
        }:
            raise HTTPException(
                status_code=404,
                detail=(
                    "Pack principal Supabase inconnu."
                ),
            )

        print(
            "[CHARIOW WEBHOOK] "
            f"primary_pack_detected={product_id!r} "
            f"credits_from_supabase="
            f"{transaction_credits!r}",
            flush=True,
        )

        try:
            if product_id == "light_pack":
                wallet = (
                    wallet_service.create_light_wallet(
                        user_id=user_id,
                        reference_id=reference_id,
                        credits=transaction_credits,
                    )
                )

            elif product_id == "intermediate_pack":
                wallet = (
                    wallet_service.create_intermediate_wallet(
                        user_id=user_id,
                        reference_id=reference_id,
                        credits=transaction_credits,
                    )
                )

            elif product_id == "pro_pack":
                wallet = (
                    wallet_service.create_pro_wallet(
                        user_id=user_id,
                        reference_id=reference_id,
                        credits=transaction_credits,
                    )
                )

            elif product_id == "business_pack":
                wallet = (
                    wallet_service.create_business_wallet(
                        user_id=user_id,
                        reference_id=reference_id,
                        credits=transaction_credits,
                    )
                )

        except HTTPException:
            raise

        except Exception as error:
            print(
                "[CHARIOW WEBHOOK] "
                f"wallet_activation_error="
                f"{str(error)!r} "
                f"reference_id={reference_id!r}",
                flush=True,
            )

            raise HTTPException(
                status_code=500,
                detail=(
                    "Paiement confirmé dans Supabase "
                    "mais activation du pack impossible : "
                    f"{str(error)}"
                ),
            ) from error

        print(
            "[CHARIOW WEBHOOK] "
            "wallet_activated=True "
            f"user_id={str(user_id)!r} "
            f"pack_id={product_id!r} "
            f"balance={getattr(wallet, 'balance', None)!r}",
            flush=True,
        )

        return {
            "success": True,
            "processed": True,
            "payment_type": payment_type,
            "product_id": product_id,
            "reference_id": reference_id,
            "credits": transaction_credits,
            "payment_transaction": (
                updated_payment_transaction
            ),
            "wallet": _wallet_response(wallet),
        }

    # ========================================================
    # COMPLÉMENT
    # ========================================================

    if payment_type == "addon":

        if product_id not in {
            "credits_1000_563",
            "credits_2000",
            "credits_4000",
            "credits_10000",
        }:
            raise HTTPException(
                status_code=404,
                detail=(
                    "Pack complémentaire Supabase inconnu."
                ),
            )

        wallet = repository.get_wallet(
            user_id
        )

        validate_addon_purchase(wallet)

        try:
            wallet = wallet_service.recharge(
                user_id=user_id,
                credits=transaction_credits,
                reference_id=reference_id,
            )

        except Exception as error:
            print(
                "[CHARIOW WEBHOOK] "
                f"addon_activation_error="
                f"{str(error)!r} "
                f"reference_id={reference_id!r}",
                flush=True,
            )

            raise HTTPException(
                status_code=500,
                detail=(
                    "Paiement confirmé dans Supabase "
                    "mais ajout des crédits impossible : "
                    f"{str(error)}"
                ),
            ) from error

        print(
            "[CHARIOW WEBHOOK] "
            "addon_recharged=True "
            f"user_id={str(user_id)!r} "
            f"product_id={product_id!r} "
            f"credits_added_from_supabase="
            f"{transaction_credits!r} "
            f"balance={getattr(wallet, 'balance', None)!r}",
            flush=True,
        )

        return {
            "success": True,
            "processed": True,
            "payment_type": payment_type,
            "product_id": product_id,
            "reference_id": reference_id,
            "credits_added": transaction_credits,
            "payment_transaction": (
                updated_payment_transaction
            ),
            "wallet": _wallet_response(wallet),
        }

    raise HTTPException(
        status_code=404,
        detail="Type de paiement Supabase inconnu.",
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