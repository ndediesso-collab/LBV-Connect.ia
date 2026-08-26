from json import dumps
import base64
from uuid import uuid4
from types import SimpleNamespace
from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, File, Form, Header, HTTPException, UploadFile
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from app.config.credit_costs import (
    CreditAction,
    IMAGE_ANALYSIS_COSTS,
    FILE_ANALYSIS_COSTS,
    MAX_MULTIMODAL_ATTACHMENTS,
)

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

from app.services.model_trial_service import (
    ModelTrialService,
)


# ============================================================
# ROUTER
# ============================================================

router = APIRouter(
    prefix="/ai",
    tags=["AI"],
)


# ============================================================
# REQUEST / PIÈCES JOINTES
# ============================================================


class ChatAttachment:
    """Pièce jointe déjà lue et prête pour OpenAIService."""

    def __init__(
        self,
        type: str,
        name: str | None,
        mime_type: str | None,
        data: str,
    ):
        self.type = type
        self.name = name
        self.mime_type = mime_type
        self.data = data


async def _build_attachments(
    files: list[UploadFile] | None,
) -> list[ChatAttachment]:
    """Lit les vrais fichiers multipart et les convertit en Base64."""

    files = files or []

    if len(files) > MAX_MULTIMODAL_ATTACHMENTS:
        raise HTTPException(
            status_code=400,
            detail=(
                f"Maximum {MAX_MULTIMODAL_ATTACHMENTS} "
                "images ou fichiers par message."
            ),
        )

    import base64

    attachments: list[ChatAttachment] = []

    for upload in files:
        if not upload.filename:
            raise HTTPException(
                status_code=400,
                detail="Une pièce jointe n'a pas de nom de fichier.",
            )

        mime_type = upload.content_type or "application/octet-stream"
        data = await upload.read()

        if not data:
            raise HTTPException(
                status_code=400,
                detail=f"Le fichier '{upload.filename}' est vide.",
            )

        attachment_type = (
            "image"
            if mime_type.startswith("image/")
            else "file"
        )

        attachments.append(
            ChatAttachment(
                type=attachment_type,
                name=upload.filename,
                mime_type=mime_type,
                data=base64.b64encode(data).decode("utf-8"),
            )
        )

    return attachments


# ============================================================
# RESPONSE CLASSIQUE
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

    trial: bool = False
    trials_remaining: int | None = None


# ============================================================
# RÉPONSES MÉDIAS
# ============================================================


class MediaResponse(BaseModel):
    success: bool
    type: str
    action: str
    model: str
    cost: int
    previous_balance: int
    credits_remaining: int
    remaining_percentage: float
    mime_type: str
    data: str
    video_id: str | None = None
    seconds: str | None = None
    size: str | None = None


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
    "light_pack": {
        "luna",
    },

    "intermediate_pack": {
        "luna",
        "gpt-5",
    },

    "pro_pack": {
        "luna",
        "gpt-5",
        "gpt-5.6-terra",
    },

    "business_pack": {
        "luna",
        "gpt-5",
        "gpt-5.6-terra",
        "gpt-5.6-sol",
    },
}


# ============================================================
# MÉDIAS AUTORISÉS PAR PACK
# ============================================================


PACK_ALLOWED_MEDIA = {
    "light_pack": {
        CreditAction.IMAGE_480,
        CreditAction.IMAGE_720,
        CreditAction.VIDEO_4S,
        CreditAction.VIDEO_8S,
    },
    "intermediate_pack": {
        CreditAction.IMAGE_480,
        CreditAction.IMAGE_720,
        CreditAction.VIDEO_LITE,
    },
    "pro_pack": {
        CreditAction.IMAGE_PRO,
        CreditAction.IMAGE_PRO_STANDARD,
        CreditAction.IMAGE_PRO_ULTRA,
        CreditAction.VIDEO_PRO_FAST,
        CreditAction.VIDEO_PRO_STANDARD,
        CreditAction.VIDEO_PRO_EXTENSION,
    },
    "business_pack": {
        CreditAction.IMAGE_BUSINESS,
        CreditAction.IMAGE_BUSINESS_HD,
        CreditAction.IMAGE_BUSINESS_ULTRA,
        CreditAction.VIDEO_BUSINESS_FAST,
        CreditAction.VIDEO_BUSINESS_STANDARD,
        CreditAction.VIDEO_BUSINESS_LONG,
    },
}


IMAGE_ACTIONS = {
    CreditAction.IMAGE_480,
    CreditAction.IMAGE_720,
    CreditAction.IMAGE_PRO,
    CreditAction.IMAGE_PRO_STANDARD,
    CreditAction.IMAGE_PRO_ULTRA,
    CreditAction.IMAGE_BUSINESS,
    CreditAction.IMAGE_BUSINESS_HD,
    CreditAction.IMAGE_BUSINESS_ULTRA,
}

VIDEO_ACTIONS = {
    CreditAction.VIDEO_4S,
    CreditAction.VIDEO_8S,
    CreditAction.VIDEO_LITE,
    CreditAction.VIDEO_PRO_FAST,
    CreditAction.VIDEO_PRO_STANDARD,
    CreditAction.VIDEO_PRO_EXTENSION,
    CreditAction.VIDEO_BUSINESS_FAST,
    CreditAction.VIDEO_BUSINESS_STANDARD,
    CreditAction.VIDEO_BUSINESS_LONG,
}


# ============================================================
# AUTHENTIFICATION
# ============================================================


def _authenticate_chat_user(
    user_id: str | None,
    authorization: str | None,
) -> str:
    """
    Authentifie l'utilisateur à partir des headers.

    Le token Supabase est vérifié puis comparé au
    user-id transmis.
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
        user_response = supabase.auth.get_user(
            clean_token
        )

        authenticated_user = (
            user_response.user
        )

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

    authenticated_user_id = str(
        authenticated_user.id
    )

    if authenticated_user_id != str(user_id):
        raise HTTPException(
            status_code=403,
            detail=(
                "Le user-id ne correspond pas "
                "à l'utilisateur authentifié."
            ),
        )

    return authenticated_user_id


# ============================================================
# VALIDATION DES PIÈCES JOINTES
# ============================================================


def _validate_attachments(
    attachments: list[ChatAttachment],
) -> None:
    """
    Vérifie les pièces jointes.

    Maximum global :
        3 images/fichiers.
    """

    if len(attachments) > MAX_MULTIMODAL_ATTACHMENTS:
        raise HTTPException(
            status_code=400,
            detail=(
                f"Maximum "
                f"{MAX_MULTIMODAL_ATTACHMENTS} "
                "images ou fichiers par message."
            ),
        )

    allowed_types = {
        "image",
        "file",
    }

    for attachment in attachments:

        if attachment.type not in allowed_types:
            raise HTTPException(
                status_code=400,
                detail=(
                    "Type de pièce jointe invalide : "
                    f"{attachment.type}"
                ),
            )

        if not attachment.data:
            raise HTTPException(
                status_code=400,
                detail=(
                    "Une pièce jointe ne contient "
                    "aucune donnée."
                ),
            )


# ============================================================
# CALCUL DU COÛT MULTIMODAL
# ============================================================


def _calculate_multimodal_cost(
    action: CreditAction,
    attachments: list[ChatAttachment],
    base_cost: int,
) -> int:
    """
    Calcule le coût final :

        coût du modèle
        + coût analyse images
        + coût analyse fichiers
    """

    image_count = sum(
        1
        for attachment in attachments
        if attachment.type == "image"
    )

    file_count = sum(
        1
        for attachment in attachments
        if attachment.type == "file"
    )

    image_cost = (
        image_count
        * IMAGE_ANALYSIS_COSTS.get(
            action,
            0,
        )
    )

    file_cost = (
        file_count
        * FILE_ANALYSIS_COSTS.get(
            action,
            0,
        )
    )

    return (
        base_cost
        + image_cost
        + file_cost
    )


# ============================================================
# CONVERSION DES PIÈCES JOINTES
# ============================================================


def _attachments_for_openai(
    attachments: list[ChatAttachment],
) -> list[dict[str, Any]]:
    """
    Convertit les objets Pydantic en dictionnaires
    compatibles avec OpenAIService.
    """

    return [
        {
            "type": attachment.type,
            "name": attachment.name,
            "mime_type": attachment.mime_type,
            "data": attachment.data,
        }
        for attachment in attachments
    ]


# ============================================================
# MÉMOIRE CONVERSATIONNELLE
# ============================================================

MAX_HISTORY_MESSAGES = 40


def _get_conversation_history(
    conversation_id: str | None,
    authenticated_user_id: str,
    current_message: str,
) -> list[dict[str, str]]:
    """
    Charge l'historique persistant d'une conversation appartenant
    à l'utilisateur authentifié.

    Le message courant est retiré lorsqu'il a déjà été enregistré
    par le frontend avant l'appel IA afin d'éviter de l'envoyer deux fois.
    """
    if not conversation_id:
        return []

    conversation_response = (
        supabase
        .table("conversations")
        .select("id")
        .eq("id", conversation_id)
        .eq("user_id", authenticated_user_id)
        .limit(1)
        .execute()
    )

    if not conversation_response.data:
        raise HTTPException(
            status_code=404,
            detail="Conversation introuvable ou non autorisée.",
        )

    response = (
        supabase
        .table("messages")
        .select("role,content,created_at")
        .eq("conversation_id", conversation_id)
        .eq("user_id", authenticated_user_id)
        .order("created_at", desc=False)
        .execute()
    )

    rows = response.data or []

    # Le frontend sauvegarde déjà le message utilisateur avant
    # d'appeler /ai/chat ou /ai/chat/stream. On retire donc une
    # occurrence finale identique au message courant.
    normalized_current = current_message.strip()
    if rows and normalized_current:
        last = rows[-1]
        if (
            last.get("role") == "user"
            and str(last.get("content", "")).strip()
            == normalized_current
        ):
            rows.pop()

    history: list[dict[str, str]] = []

    for row in rows[-MAX_HISTORY_MESSAGES:]:
        role = row.get("role")
        content = row.get("content")

        if role not in {"user", "assistant", "system", "developer"}:
            continue
        if not content:
            continue

        history.append(
            {
                "role": role,
                "content": str(content),
            }
        )

    return history


# ============================================================
# VALIDATION COMMUNE CHAT
# ============================================================


def _prepare_chat(
    model: str,
    message: str,
    web: bool,
    attachments: list[ChatAttachment],
    user_id: str | None,
    authorization: str | None,
    conversation_id: str | None = None,
):
    """
    Prépare et valide une requête Chat.

    Utilisée par :
        /ai/chat
        /ai/chat/stream
    """

    authenticated_user_id = (
        _authenticate_chat_user(
            user_id=user_id,
            authorization=authorization,
        )
    )

    message = message.strip()

    if not message and not attachments:
        raise HTTPException(
            status_code=400,
            detail=(
                "Le message ou une pièce jointe "
                "est requis."
            ),
        )

    if model not in MODEL_ACTIONS:
        raise HTTPException(
            status_code=400,
            detail=(
                f"Modèle inconnu : "
                f"{model}"
            ),
        )

    # ========================================================
    # PIÈCES JOINTES
    # ========================================================

    _validate_attachments(
        attachments
    )

    # ========================================================
    # REPOSITORY
    # ========================================================

    repository = SupabaseCreditRepository(
        supabase
    )

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
    # MODÈLES AUTORISÉS
    # ========================================================

    allowed_models = PACK_ALLOWED_MODELS.get(
        wallet.pack_id,
        set(),
    )

    is_normal_model = (
        model in allowed_models
    )

    is_trial_model = False

    if not is_normal_model:

        trial_model = (
            ModelTrialService.get_trial_model(
                wallet.pack_id
            )
        )

        is_trial_model = (
            trial_model == model
        )

        if not is_trial_model:
            raise HTTPException(
                status_code=403,
                detail=(
                    f"Le modèle '{model}' "
                    f"n'est pas disponible avec le pack "
                    f"'{wallet.pack_id}'."
                ),
            )

    # ========================================================
    # ACTION
    # ========================================================

    action_type = (
        "web"
        if web
        else "normal"
    )

    action = MODEL_ACTIONS[
        model
    ][action_type]

    # ========================================================
    # COÛT DE BASE
    # ========================================================

    if is_trial_model:

        remaining_trials = (
            ModelTrialService.get_remaining(
                authenticated_user_id,
                model,
            )
        )

        if remaining_trials <= 0:
            raise HTTPException(
                status_code=403,
                detail=(
                    f"Vous avez utilisé vos 5 essais "
                    f"de {model}."
                ),
            )

        base_cost = (
            ModelTrialService.get_trial_cost(
                model,
                web,
            )
        )

    else:

        try:
            base_cost = CreditService.get_cost(
                wallet,
                action,
            )

        except UnsupportedActionError as error:
            raise HTTPException(
                status_code=403,
                detail=str(error),
            )

    # ========================================================
    # COÛT FINAL MULTIMODAL
    # ========================================================

    cost = _calculate_multimodal_cost(
        action=action,
        attachments=attachments,
        base_cost=base_cost,
    )

    # ========================================================
    # PACK ACTIF
    # ========================================================

    if not wallet.is_pack_active:
        raise HTTPException(
            status_code=403,
            detail=(
                "Le pack de crédits est "
                "expiré ou inactif."
            ),
        )

    # ========================================================
    # SOLDE
    # ========================================================

    if wallet.balance < cost:
        raise HTTPException(
            status_code=402,
            detail=(
                "Crédits insuffisants "
                "pour effectuer cette action."
            ),
        )

    history = _get_conversation_history(
        conversation_id=conversation_id,
        authenticated_user_id=authenticated_user_id,
        current_message=message,
    )

    return (
        authenticated_user_id,
        repository,
        wallet,
        message,
        action,
        cost,
        is_trial_model,
        history,
    )


# ============================================================
# CONSOMMATION + TRANSACTION
# ============================================================


def _consume_and_record(
    repository,
    wallet,
    authenticated_user_id: str,
    action,
    cost: int,
    is_trial_model: bool,
    model_id: str,
):
    """
    Débite les crédits après génération réussie.

    `cost` représente déjà le coût final :
        modèle
        + images
        + fichiers
    """

    # ========================================================
    # MODÈLE DÉCOUVERTE
    # ========================================================

    if is_trial_model:

        previous_balance = wallet.balance

        if previous_balance < cost:
            raise HTTPException(
                status_code=402,
                detail=(
                    "Crédits insuffisants "
                    "pour effectuer cette action."
                ),
            )

        wallet.balance -= cost

        wallet.updated_at = (
            datetime.now(timezone.utc)
        )

        consumed_credits = (
            wallet.initial_credits
            - wallet.balance
        )

        consumed_percentage = (
            (
                consumed_credits
                / wallet.initial_credits
            )
            * 100
            if wallet.initial_credits > 0
            else 0
        )

        remaining_percentage = max(
            0,
            100 - consumed_percentage,
        )

        result = SimpleNamespace(
            cost=cost,
            previous_balance=previous_balance,
            new_balance=wallet.balance,
            consumed_credits=consumed_credits,
            consumed_percentage=(
                consumed_percentage
            ),
            remaining_percentage=(
                remaining_percentage
            ),
            requires_warning=(
                remaining_percentage <= 20
            ),
            requires_critical_warning=(
                remaining_percentage <= 5
            ),
            action=action,
        )

    # ========================================================
    # MODÈLE NORMAL
    # ========================================================

    else:

        try:
            result = CreditService.consume(
                wallet=wallet,
                action=action,
                confirmed=True,
                cost_override=cost,
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

        except TypeError as error:
            raise RuntimeError(
                "CreditService.consume doit "
                "accepter cost_override pour "
                "la facturation multimodale."
            ) from error

    # ========================================================
    # SAUVEGARDE WALLET
    # ========================================================

    repository.update_wallet(
        wallet
    )

    # ========================================================
    # TRANSACTION
    # ========================================================

    transaction = CreditTransaction(
        id=str(uuid4()),
        user_id=authenticated_user_id,
        transaction_type=(
            CreditTransactionType.USAGE
        ),
        amount=-result.cost,
        balance_after=result.new_balance,
        created_at=wallet.updated_at,
        action=action,
        reference_id=None,
    )

    repository.create_transaction(
        transaction
    )

    # ========================================================
    # ESSAI
    # ========================================================

    trials_remaining = None

    if is_trial_model:

        trial = (
            ModelTrialService.consume_trial(
                authenticated_user_id,
                model_id,
            )
        )

        trials_remaining = max(
            0,
            trial["max_trials"]
            - trial["used_trials"],
        )

    return (
        result,
        trials_remaining,
    )


# ============================================================
# POST /ai/chat
# ============================================================


@router.post(
    "/chat",
    response_model=ChatResponse,
)
async def chat(
    model: str = Form(...),
    message: str = Form(""),
    web: bool = Form(False),
    conversation_id: str | None = Form(default=None),
    files: list[UploadFile] = File(default=[]),
    user_id: str | None = Header(
        default=None,
        alias="user-id",
    ),
    authorization: str | None = Header(
        default=None,
        alias="authorization",
    ),
):

    attachments = await _build_attachments(files)

    (
        authenticated_user_id,
        repository,
        wallet,
        message,
        action,
        cost,
        is_trial_model,
        history,
    ) = _prepare_chat(
        model=model,
        message=message,
        web=web,
        attachments=attachments,
        user_id=user_id,
        authorization=authorization,
        conversation_id=conversation_id,
    )

    openai_service = OpenAIService()

    # ========================================================
    # APPEL OPENAI
    # ========================================================

    try:

        response = openai_service.chat(
            model=MODEL_OPENAI_IDS[
                model
            ],
            message=message,
            web=web,
            attachments=_attachments_for_openai(
                attachments
            ),
            history=history,
        )

    except Exception as error:
        raise HTTPException(
            status_code=502,
            detail=(
                "Impossible de contacter "
                "le service IA : "
                f"{str(error)}"
            ),
        )

    # ========================================================
    # CONSOMMATION
    # ========================================================

    try:

        result, trials_remaining = (
            _consume_and_record(
                repository=repository,
                wallet=wallet,
                authenticated_user_id=(
                    authenticated_user_id
                ),
                action=action,
                cost=cost,
                is_trial_model=is_trial_model,
                model_id=model,
            )
        )

    except RuntimeError as error:

        raise HTTPException(
            status_code=500,
            detail=str(error),
        )

    # ========================================================
    # RÉPONSE
    # ========================================================

    return ChatResponse(
        success=True,
        model=model,
        action=result.action.value,
        message=response,
        cost=result.cost,
        previous_balance=result.previous_balance,
        credits_remaining=result.new_balance,
        consumed_percentage=(
            result.consumed_percentage
        ),
        remaining_percentage=(
            result.remaining_percentage
        ),
        requires_warning=(
            result.requires_warning
        ),
        requires_critical_warning=(
            result.requires_critical_warning
        ),
        trial=is_trial_model,
        trials_remaining=trials_remaining,
    )


# ============================================================
# PRÉPARATION D'UNE CRÉATION MÉDIA
# ============================================================


def _prepare_media(
    action_value: str,
    prompt: str,
    user_id: str | None,
    authorization: str | None,
):
    """Authentifie, valide le pack et réserve le coût logique du média."""

    authenticated_user_id = _authenticate_chat_user(
        user_id=user_id,
        authorization=authorization,
    )

    prompt = prompt.strip()

    if not prompt:
        raise HTTPException(
            status_code=400,
            detail="Le prompt de création est requis.",
        )

    try:
        action = CreditAction(action_value)
    except ValueError:
        raise HTTPException(
            status_code=400,
            detail=f"Action média inconnue : {action_value}",
        )

    if action not in IMAGE_ACTIONS and action not in VIDEO_ACTIONS:
        raise HTTPException(
            status_code=400,
            detail="L'action demandée n'est pas une action de création média.",
        )

    repository = SupabaseCreditRepository(supabase)
    wallet = repository.get_wallet(authenticated_user_id)

    if wallet is None:
        raise HTTPException(
            status_code=404,
            detail="Aucun portefeuille de crédits trouvé pour cet utilisateur.",
        )

    if not wallet.is_pack_active:
        raise HTTPException(
            status_code=403,
            detail="Le pack de crédits est expiré ou inactif.",
        )

    allowed_media = PACK_ALLOWED_MEDIA.get(wallet.pack_id, set())

    if action not in allowed_media:
        raise HTTPException(
            status_code=403,
            detail=(
                f"L'action '{action.value}' n'est pas disponible "
                f"avec le pack '{wallet.pack_id}'."
            ),
        )

    try:
        cost = CreditService.get_cost(wallet, action)
    except UnsupportedActionError as error:
        raise HTTPException(
            status_code=403,
            detail=str(error),
        )

    if wallet.balance < cost:
        raise HTTPException(
            status_code=402,
            detail="Crédits insuffisants pour effectuer cette création.",
        )

    return (
        authenticated_user_id,
        repository,
        wallet,
        action,
        prompt,
        cost,
    )


# ============================================================
# CONSOMMATION MÉDIA ATOMIQUE
# ============================================================


def _consume_media(
    repository,
    wallet,
    authenticated_user_id: str,
    action: CreditAction,
    cost: int,
):
    """Débite le média via la RPC Supabase atomique."""

    try:
        result = CreditService.consume(
            wallet=wallet,
            action=action,
            confirmed=True,
            cost_override=cost,
            repository=repository,
            user_id=authenticated_user_id,
        )
    except InactivePackError as error:
        raise HTTPException(status_code=403, detail=str(error))
    except InsufficientCreditsError as error:
        raise HTTPException(status_code=402, detail=str(error))
    except UnsupportedActionError as error:
        raise HTTPException(status_code=403, detail=str(error))
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error))

    return result


# ============================================================
# POST /ai/image
# ============================================================


@router.post(
    "/image",
    response_model=MediaResponse,
)
async def generate_image(
    action: str = Form(...),
    prompt: str = Form(...),
    user_id: str | None = Header(
        default=None,
        alias="user-id",
    ),
    authorization: str | None = Header(
        default=None,
        alias="authorization",
    ),
):
    """Génère une image réelle via l'API Images OpenAI."""

    (
        authenticated_user_id,
        repository,
        wallet,
        credit_action,
        prompt,
        cost,
    ) = _prepare_media(
        action_value=action,
        prompt=prompt,
        user_id=user_id,
        authorization=authorization,
    )

    if credit_action not in IMAGE_ACTIONS:
        raise HTTPException(
            status_code=400,
            detail="Cette action n'est pas une création d'image.",
        )

    service = OpenAIService()

    try:
        generated = service.generate_image(
            action=credit_action.value,
            prompt=prompt,
        )
    except Exception as error:
        raise HTTPException(
            status_code=502,
            detail=f"La génération d'image a échoué : {error}",
        )

    result = _consume_media(
        repository=repository,
        wallet=wallet,
        authenticated_user_id=authenticated_user_id,
        action=credit_action,
        cost=cost,
    )

    return MediaResponse(
        success=True,
        type="image",
        action=credit_action.value,
        model=generated["model"],
        cost=result.cost,
        previous_balance=result.previous_balance,
        credits_remaining=result.new_balance,
        remaining_percentage=result.remaining_percentage,
        mime_type=generated["mime_type"],
        data=generated["b64_json"],
        size=generated["size"],
    )


# ============================================================
# POST /ai/video
# ============================================================


@router.post(
    "/video",
    response_model=MediaResponse,
)
async def generate_video(
    action: str = Form(...),
    prompt: str = Form(...),
    user_id: str | None = Header(
        default=None,
        alias="user-id",
    ),
    authorization: str | None = Header(
        default=None,
        alias="authorization",
    ),
):
    """Génère une vidéo réelle via Sora."""

    (
        authenticated_user_id,
        repository,
        wallet,
        credit_action,
        prompt,
        cost,
    ) = _prepare_media(
        action_value=action,
        prompt=prompt,
        user_id=user_id,
        authorization=authorization,
    )

    if credit_action not in VIDEO_ACTIONS:
        raise HTTPException(
            status_code=400,
            detail="Cette action n'est pas une création vidéo.",
        )

    service = OpenAIService()

    try:
        generated = service.generate_video(
            action=credit_action.value,
            prompt=prompt,
        )
    except Exception as error:
        raise HTTPException(
            status_code=502,
            detail=f"La génération vidéo a échoué : {error}",
        )

    result = _consume_media(
        repository=repository,
        wallet=wallet,
        authenticated_user_id=authenticated_user_id,
        action=credit_action,
        cost=cost,
    )

    return MediaResponse(
        success=True,
        type="video",
        action=credit_action.value,
        model=generated["model"],
        cost=result.cost,
        previous_balance=result.previous_balance,
        credits_remaining=result.new_balance,
        remaining_percentage=result.remaining_percentage,
        mime_type=generated["mime_type"],
        data=base64.b64encode(generated["data"]).decode("utf-8"),
        video_id=generated["video_id"],
        seconds=generated["seconds"],
        size=generated["size"],
    )


# ============================================================
# GET /ai/media-capabilities
# ============================================================


@router.get("/media-capabilities")
def get_media_capabilities(
    user_id: str | None = Header(
        default=None,
        alias="user-id",
    ),
    authorization: str | None = Header(
        default=None,
        alias="authorization",
    ),
):
    """Retourne les créations média autorisées par le pack courant."""

    authenticated_user_id = _authenticate_chat_user(
        user_id=user_id,
        authorization=authorization,
    )

    repository = SupabaseCreditRepository(supabase)
    wallet = repository.get_wallet(authenticated_user_id)

    if wallet is None:
        raise HTTPException(
            status_code=404,
            detail="Aucun portefeuille de crédits trouvé pour cet utilisateur.",
        )

    allowed = PACK_ALLOWED_MEDIA.get(wallet.pack_id, set())

    return {
        "success": True,
        "pack_id": wallet.pack_id,
        "media": [
            {
                "action": action.value,
                "type": (
                    "image"
                    if action in IMAGE_ACTIONS
                    else "video"
                ),
                "credits": CreditService.get_cost(
                    wallet,
                    action,
                ),
            }
            for action in sorted(
                allowed,
                key=lambda item: item.value,
            )
        ],
    }


# ============================================================
# GET /ai/trials
# ============================================================


@router.get("/trials")
def get_trials(
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
    Retourne l'état des essais découverte.
    """

    authenticated_user_id = (
        _authenticate_chat_user(
            user_id=user_id,
            authorization=authorization,
        )
    )

    repository = SupabaseCreditRepository(
        supabase
    )

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

    trial_model = (
        ModelTrialService.get_trial_model(
            wallet.pack_id
        )
    )

    trials = {}

    if trial_model:

        trial = (
            ModelTrialService.get_or_create_trial(
                authenticated_user_id,
                trial_model,
            )
        )

        trials[trial_model] = {
            "used": trial["used_trials"],
            "max": trial["max_trials"],
            "remaining": max(
                0,
                trial["max_trials"]
                - trial["used_trials"],
            ),
        }

    return {
        "success": True,
        "user_id": authenticated_user_id,
        "pack_id": wallet.pack_id,
        "trials": trials,
    }


# ============================================================
# POST /ai/chat/stream
# ============================================================


@router.post(
    "/chat/stream",
)
async def chat_stream(
    model: str = Form(...),
    message: str = Form(""),
    web: bool = Form(False),
    conversation_id: str | None = Form(default=None),
    files: list[UploadFile] = File(default=[]),
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
    Streaming temps réel du Chat LBV-Connect.

    Flux :

        OpenAI
          ↓
        delta
          ↓
        FastAPI SSE
          ↓
        Frontend

    Les crédits sont débités uniquement après
    réception complète d'une réponse valide.
    """

    attachments = await _build_attachments(files)

    (
        authenticated_user_id,
        repository,
        wallet,
        message,
        action,
        cost,
        is_trial_model,
        history,
    ) = _prepare_chat(
        model=model,
        message=message,
        web=web,
        attachments=attachments,
        user_id=user_id,
        authorization=authorization,
        conversation_id=conversation_id,
    )

    openai_service = OpenAIService()

    attachments = _attachments_for_openai(
        attachments
    )

    def event_stream():
        """
        Générateur SSE.

        Chaque delta OpenAI est immédiatement envoyé
        au frontend afin de produire un affichage
        progressif de la réponse.
        """

        full_response = ""

        try:

            # ==================================================
            # START
            # ==================================================

            yield (
                "event: start\n"
                "data: "
                + dumps(
                    {
                        "success": True,
                        "model": model,
                        "web": web,
                        "attachments": len(
                            attachments
                        ),
                    },
                    ensure_ascii=False,
                )
                + "\n\n"
            )

            # ==================================================
            # STREAM OPENAI
            # ==================================================

            stream = openai_service.chat_stream(
                model=MODEL_OPENAI_IDS[
                    model
                ],
                message=message,
                web=web,
                attachments=attachments,
                history=history,
            )

            for delta in stream:

                if not delta:
                    continue

                full_response += delta

                # ----------------------------------------------
                # ENVOI IMMÉDIAT DU DELTA
                # ----------------------------------------------

                yield (
                    "event: delta\n"
                    "data: "
                    + dumps(
                        {
                            "content": delta,
                        },
                        ensure_ascii=False,
                    )
                    + "\n\n"
                )

            # ==================================================
            # VÉRIFICATION
            # ==================================================

            if not full_response.strip():

                yield (
                    "event: error\n"
                    "data: "
                    + dumps(
                        {
                            "detail": (
                                "Le service IA "
                                "n'a retourné "
                                "aucun contenu."
                            )
                        },
                        ensure_ascii=False,
                    )
                    + "\n\n"
                )

                return

            # ==================================================
            # CONSOMMATION APRÈS GÉNÉRATION
            # ==================================================

            try:

                result, trials_remaining = (
                    _consume_and_record(
                        repository=repository,
                        wallet=wallet,
                        authenticated_user_id=(
                            authenticated_user_id
                        ),
                        action=action,
                        cost=cost,
                        is_trial_model=(
                            is_trial_model
                        ),
                        model_id=model,
                    )
                )

            except Exception as error:

                yield (
                    "event: error\n"
                    "data: "
                    + dumps(
                        {
                            "detail": (
                                "La réponse IA a été "
                                "générée mais la "
                                "consommation des "
                                "crédits a échoué : "
                                f"{str(error)}"
                            )
                        },
                        ensure_ascii=False,
                    )
                    + "\n\n"
                )

                return

            # ==================================================
            # DONE
            # ==================================================

            yield (
                "event: done\n"
                "data: "
                + dumps(
                    {
                        "success": True,
                        "model": model,
                        "action": (
                            result.action.value
                        ),
                        "cost": result.cost,
                        "previous_balance": (
                            result.previous_balance
                        ),
                        "credits_remaining": (
                            result.new_balance
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
                        "trial": is_trial_model,
                        "trials_remaining": (
                            trials_remaining
                        ),
                    },
                    ensure_ascii=False,
                )
                + "\n\n"
            )

        except Exception as error:

            # ==================================================
            # ERREUR STREAMING
            # ==================================================

            yield (
                "event: error\n"
                "data: "
                + dumps(
                    {
                        "detail": (
                            "Erreur pendant le "
                            "streaming IA : "
                            f"{str(error)}"
                        )
                    },
                    ensure_ascii=False,
                )
                + "\n\n"
            )

    # ========================================================
    # RÉPONSE SSE
    # ========================================================

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": (
                "no-cache, no-transform"
            ),
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )