from json import dumps
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
# VALIDATION COMMUNE CHAT
# ============================================================


def _prepare_chat(
    model: str,
    message: str,
    web: bool,
    attachments: list[ChatAttachment],
    user_id: str | None,
    authorization: str | None,
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

    return (
        authenticated_user_id,
        repository,
        wallet,
        message,
        action,
        cost,
        is_trial_model,
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
    ) = _prepare_chat(
        model=model,
        message=message,
        web=web,
        attachments=attachments,
        user_id=user_id,
        authorization=authorization,
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
    ) = _prepare_chat(
        model=model,
        message=message,
        web=web,
        attachments=attachments,
        user_id=user_id,
        authorization=authorization,
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