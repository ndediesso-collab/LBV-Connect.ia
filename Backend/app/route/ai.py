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
from app.services.openai_service import OpenAIService


router = APIRouter(
    prefix="/ai",
    tags=["AI"],
)


# ============================================================
# REQUEST
# ============================================================

class ChatRequest(BaseModel):
    model: str
    message: str
    web: bool = False


# ============================================================
# RESPONSE
# ============================================================

class ChatResponse(BaseModel):
    success: bool

    model: str
    action: str
    message: str

    cost: int
    previous_balance: int
    credits_remaining: int

    consumed_percentage: float
    remaining_percentage: float

    requires_warning: bool
    requires_critical_warning: bool


# ============================================================
# MODÈLES → ACTIONS DE CRÉDITS
# ============================================================

MODEL_ACTIONS = {
    "luna": {
        "normal": CreditAction.CHAT_LUNA,
        "web": CreditAction.CHAT_LUNA_WEB,
    },

    "gpt-5": {
        "normal": CreditAction.CHAT_GPT5,
        "web": CreditAction.CHAT_GPT5_WEB,
    },

    "gpt-5.6-terra": {
        "normal": CreditAction.CHAT_TERRA,
        "web": CreditAction.CHAT_TERRA_WEB,
    },

    "gpt-5.6-sol": {
        "normal": CreditAction.CHAT_SOL,
        "web": CreditAction.CHAT_SOL_WEB,
    },
}


# ============================================================
# MODÈLES LBV-CONNECT → IDS OPENAI
# ============================================================

MODEL_OPENAI_IDS = {
    "luna": "gpt-5.6-luna",
    "gpt-5": "gpt-5",
    "gpt-5.6-terra": "gpt-5.6-terra",
    "gpt-5.6-sol": "gpt-5.6-sol",
}


# ============================================================
# MODÈLES AUTORISÉS PAR PACK
# ============================================================

PACK_ALLOWED_MODELS = {
    # --------------------------------------------------------
    # PACK LÉGER
    # --------------------------------------------------------

    "light_pack": {
        "luna",
    },

    # --------------------------------------------------------
    # PACK INTERMÉDIAIRE
    # --------------------------------------------------------

    "intermediate_pack": {
        "luna",
        "gpt-5",
    },

    # --------------------------------------------------------
    # PACK PRO
    # --------------------------------------------------------

    "pro_pack": {
        "luna",
        "gpt-5",
        "gpt-5.6-terra",
    },

    # --------------------------------------------------------
    # PACK BUSINESS
    # --------------------------------------------------------

    "business_pack": {
        "luna",
        "gpt-5",
        "gpt-5.6-terra",
        "gpt-5.6-sol",
    },
}


# ============================================================
# POST /ai/chat
# ============================================================

def _authenticate_chat_user(
    user_id: str | None,
    authorization: str | None,
) -> str:
    """
    Authentifie l'utilisateur à partir des headers :

        user-id: <UUID Supabase>
        authorization: Bearer <access_token>

    Le token Supabase est vérifié côté backend puis son
    identité est comparée au user-id transmis.
    """

    if not user_id:
        raise HTTPException(
            status_code=401,
            detail="Header user-id manquant.",
        )

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

    try:
        user_response = supabase.auth.get_user(clean_token)
        authenticated_user = user_response.user

    except Exception:
        raise HTTPException(
            status_code=401,
            detail="Token Supabase invalide ou expiré.",
        )

    if authenticated_user is None:
        raise HTTPException(
            status_code=401,
            detail="Utilisateur non authentifié.",
        )

    authenticated_user_id = str(authenticated_user.id)

    if authenticated_user_id != str(user_id):
        raise HTTPException(
            status_code=403,
            detail=(
                "Le user-id ne correspond pas "
                "à l'utilisateur authentifié."
            ),
        )

    return authenticated_user_id


@router.post(
    "/chat",
    response_model=ChatResponse,
)
def chat(
    request: ChatRequest,
    user_id: str | None = Header(
        default=None,
        alias="user-id",
    ),
    authorization: str | None = Header(
        default=None,
        alias="authorization",
    ),
):

    # ========================================================
    # 1. AUTHENTIFICATION
    # ========================================================

    authenticated_user_id = _authenticate_chat_user(
        user_id=user_id,
        authorization=authorization,
    )

    # ========================================================
    # 2. VALIDATION DU MESSAGE
    # ========================================================

    message = request.message.strip()

    if not message:
        raise HTTPException(
            status_code=400,
            detail="Le message ne peut pas être vide.",
        )

    # ========================================================
    # 3. VALIDATION DU MODÈLE
    # ========================================================

    if request.model not in MODEL_ACTIONS:
        raise HTTPException(
            status_code=400,
            detail=f"Modèle inconnu : {request.model}",
        )

    # ========================================================
    # 4. RÉCUPÉRATION DU WALLET
    # ========================================================

    repository = SupabaseCreditRepository(supabase)

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
    # 5. VÉRIFICATION DU PACK
    # ========================================================

    allowed_models = PACK_ALLOWED_MODELS.get(
        wallet.pack_id,
        set(),
    )

    if request.model not in allowed_models:
        raise HTTPException(
            status_code=403,
            detail=(
                f"Le modèle '{request.model}' "
                f"n'est pas disponible avec le pack "
                f"'{wallet.pack_id}'."
            ),
        )

    # ========================================================
    # 6. MODÈLE + MODE WEB
    #
    # Le modèle reste celui sélectionné dans le pack.
    # Web est une capacité supplémentaire du même modèle.
    # ========================================================

    action_type = "web" if request.web else "normal"

    action = MODEL_ACTIONS[
        request.model
    ][action_type]

    # ========================================================
    # 7. VÉRIFICATION DU COÛT
    # ========================================================

    try:
        cost = CreditService.get_cost(
            wallet,
            action,
        )

    except UnsupportedActionError as error:
        raise HTTPException(
            status_code=403,
            detail=str(error),
        )

    # ========================================================
    # 8. PACK ACTIF
    # ========================================================

    if not wallet.is_pack_active:
        raise HTTPException(
            status_code=403,
            detail=(
                "Le pack de crédits est expiré ou inactif."
            ),
        )

    # ========================================================
    # 9. SOLDE
    # ========================================================

    if wallet.balance < cost:
        raise HTTPException(
            status_code=402,
            detail=(
                "Crédits insuffisants "
                "pour effectuer cette action."
            ),
        )

    # ========================================================
    # 10. APPEL IA
    #
    # OpenAIService doit utiliser request.web pour activer
    # réellement l'outil web_search lorsque Web est actif.
    #
    # Aucun crédit n'est débité avant une réponse réussie.
    # ========================================================

    openai_service = OpenAIService()

    try:
        response = openai_service.chat(
            model=MODEL_OPENAI_IDS[request.model],
            message=message,
            web=request.web,
        )

    except Exception as error:
        raise HTTPException(
            status_code=502,
            detail=(
                "Impossible de contacter le service IA : "
                f"{str(error)}"
            ),
        )

    # ========================================================
    # 11. CONSOMMATION
    # ========================================================

    try:
        result = CreditService.consume(
            wallet=wallet,
            action=action,
            confirmed=True,
        )

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

    except ValueError as error:
        raise HTTPException(
            status_code=400,
            detail=str(error),
        )

    # ========================================================
    # 12. WALLET
    # ========================================================

    try:
        repository.update_wallet(wallet)

    except Exception as error:
        raise HTTPException(
            status_code=500,
            detail=(
                "La réponse IA a été obtenue, "
                "mais la mise à jour du portefeuille "
                "a échoué : "
                f"{str(error)}"
            ),
        )

    # ========================================================
    # 13. TRANSACTION
    # ========================================================

    transaction = CreditTransaction(
        id=str(uuid4()),
        user_id=authenticated_user_id,
        transaction_type=CreditTransactionType.USAGE,
        amount=-result.cost,
        balance_after=result.new_balance,
        created_at=wallet.updated_at,
        action=action,
        reference_id=None,
    )

    try:
        repository.create_transaction(transaction)

    except Exception as error:
        raise HTTPException(
            status_code=500,
            detail=(
                "Le portefeuille a été mis à jour, "
                "mais l'enregistrement de la transaction "
                "a échoué : "
                f"{str(error)}"
            ),
        )

    # ========================================================
    # 14. RÉPONSE
    # ========================================================

    return ChatResponse(
        success=True,
        model=request.model,
        action=result.action.value,
        message=response,
        cost=result.cost,
        previous_balance=result.previous_balance,
        credits_remaining=result.new_balance,
        consumed_percentage=result.consumed_percentage,
        remaining_percentage=result.remaining_percentage,
        requires_warning=result.requires_warning,
        requires_critical_warning=result.requires_critical_warning,
    )