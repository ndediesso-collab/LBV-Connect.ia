from uuid import uuid4

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


router = APIRouter()


# ============================================================
# SCHEMAS
# ============================================================


class CreditConsumptionRequest(BaseModel):
    action: CreditAction
    confirmed: bool = False


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

    IMPORTANT :

    Le user_id n'est plus fourni dans l'URL.

    On utilise :

        POST /credits/me/consume

    avec les headers d'authentification.
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

    try:
        service = CreditService()

        result = service.consume(
            wallet=wallet,
            action=request.action,
            confirmed=request.confirmed,
        )

        repository.update_wallet(
            wallet
        )

        transaction = CreditTransaction(
            id=str(uuid4()),
            user_id=authenticated_user_id,
            transaction_type=(
                CreditTransactionType.USAGE
            ),
            amount=-result.cost,
            balance_after=result.new_balance,
            created_at=wallet.updated_at,
            action=request.action,
            reference_id=None,
        )

        repository.create_transaction(
            transaction
        )

        return {
            "success": True,
            "user_id": authenticated_user_id,
            "pack_id": wallet.pack_id,

            "action": result.action.value,

            "cost": result.cost,

            "previous_balance": (
                result.previous_balance
            ),

            "new_balance": (
                result.new_balance
            ),

            "consumed_credits": (
                result.consumed_credits
            ),

            "consumed_percentage": (
                result.consumed_percentage
            ),

            "remaining_percentage": (
                result.remaining_percentage
            ),

            "requires_warning": (
                result.requires_warning
            ),

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