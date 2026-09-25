from json import dumps

import base64

from uuid import uuid4

from types import SimpleNamespace

from datetime import datetime, timezone

from typing import Any

import re

import unicodedata



from fastapi import APIRouter, File, Form, Header, HTTPException, Request, UploadFile

from fastapi.responses import StreamingResponse

from pydantic import BaseModel



from app.config import credit_costs as credit_costs_config

from app.config.credit_costs import (
    CreditAction,
    MAX_CHAT_INPUT_TOKENS,
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



from app.services.openai_service import OpenAIService

from app.services.token_billing_service import (
    MediaBillingError,
    MediaBillingService,
    TokenBillingError,
    TokenBillingService,
    UnsupportedMediaBillingModelError,
)

from app.services.media_service import MediaService



from app.services.model_trial_service import (

    ModelTrialService,

)





# ============================================================

# ROUTER

# ============================================================



router = APIRouter(

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

    media_id: str | None = None

    conversation_id: str | None = None

    media_url: str | None = None

    public_url: str | None = None

    url: str | None = None

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



    "gpt-6-sol": {

        "normal": CreditAction.CHAT_SOL,

        "web": CreditAction.CHAT_SOL_WEB,

    },



    "gpt-6-astra": {

        "normal": CreditAction.CHAT_ASTRA,

        "web": CreditAction.CHAT_ASTRA_WEB,

    },

}





# ============================================================

# MODÈLES ORIA → IDS OPENAI

# ============================================================





MODEL_OPENAI_IDS = {

    # Alias frontend historique conservé : Luna pointe désormais vers GPT-6.
    "luna": "gpt-6-luna",

    "gpt-5": "gpt-5",

    "gpt-5.6-terra": "gpt-5.6-terra",

    "gpt-6-sol": "gpt-6-sol",

    "gpt-6-astra": "gpt-6-astra",

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
        "gpt-5.6-terra",
        "gpt-6-sol",
    },

    "business_pack": {
        "gpt-5.6-terra",
        "gpt-6-sol",
        "gpt-6-astra",
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

# GET /ai/media-capabilities

# ============================================================



@router.get("/media-capabilities")

def get_media_capabilities(

    user_id: str | None = Header(default=None, alias="user-id"),

    authorization: str | None = Header(default=None, alias="authorization"),

):

    """

    Retourne les créations média disponibles pour le pack actif

    de l'utilisateur authentifié.



    Le préfixe /ai est ajouté par main.py.

    """

    authenticated_user_id = _authenticate_chat_user(

        user_id=user_id,

        authorization=authorization,

    )



    repository = SupabaseCreditRepository(supabase)

    wallet = repository.get_wallet(authenticated_user_id)



    # Un utilisateur authentifié peut ne pas encore avoir de wallet.

    # On retourne une structure exploitable par le frontend plutôt

    # qu'un 404 qui transforme une capacité optionnelle en erreur.

    if wallet is None:

        return {

            "success": True,

            "user_id": authenticated_user_id,

            "pack_id": None,

            "pack_active": False,

            "images": [],

            "videos": [],

            "media": [],

        }



    allowed_media = PACK_ALLOWED_MEDIA.get(wallet.pack_id, set())



    images = sorted(

        action.value

        for action in allowed_media

        if action in IMAGE_ACTIONS

    )

    video_backend_available = True

    try:
        MediaBillingService.resolve_video_backend(
            wallet.pack_id
        )
    except MediaBillingError:
        video_backend_available = False

    videos = (
        sorted(
            action.value
            for action in allowed_media
            if action in VIDEO_ACTIONS
        )
        if video_backend_available
        else []
    )

    return {

        "success": True,

        "user_id": authenticated_user_id,

        "pack_id": wallet.pack_id,

        "pack_active": bool(wallet.is_pack_active),

        "images": images,

        "videos": videos,

        "media": images + videos,

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
# FACTURATION DYNAMIQUE DU CHAT
# ============================================================


def _as_mapping(value: Any) -> dict[str, Any] | None:
    """Convertit un objet OpenAI/Pydantic en dictionnaire si possible."""

    if isinstance(value, dict):
        return value

    model_dump = getattr(value, "model_dump", None)

    if callable(model_dump):
        dumped = model_dump()

        if isinstance(dumped, dict):
            return dumped

    return None


def _calculate_real_chat_cost(
    *,
    model: str,
    usage: Any,
    web_search_calls: int,
) -> int:
    """
    Convertit l'usage OpenAI réel en crédits Oria.

    Les pièces jointes ne reçoivent plus de supplément fixe :
    leur coût est déjà reflété dans l'usage OpenAI.
    """

    usage_mapping = _as_mapping(usage)

    if usage_mapping is None:
        raise RuntimeError(
            "OpenAIService n'a pas fourni un objet usage exploitable "
            "pour la facturation dynamique."
        )

    try:
        billing = TokenBillingService.calculate(
            model=model,
            usage=usage_mapping,
            web_search_calls=web_search_calls,
        )

    except TokenBillingError as error:
        raise RuntimeError(
            f"Impossible de calculer le coût réel de la requête : {error}"
        ) from error

    if billing.credits <= 0:
        raise RuntimeError(
            "La consommation OpenAI retournée est vide ou invalide ; "
            "aucun débit n'a été effectué."
        )

    return billing.credits


def _extract_classic_chat_result(
    *,
    response: Any,
    model: str,
    web: bool,
) -> tuple[str, int]:
    """
    Extrait le texte et le coût réel d'une réponse Chat classique.

    OpenAIService.chat() doit maintenant retourner :
        {
            "message": "...",
            "usage": {...},
            "web_search_calls": 0,
        }
    """

    payload = _as_mapping(response)

    if payload is None:
        raise RuntimeError(
            "OpenAIService.chat() doit désormais retourner un dictionnaire "
            "contenant 'message' et 'usage'."
        )

    message = str(
        payload.get("message")
        or payload.get("output_text")
        or ""
    )

    if not message.strip():
        raise RuntimeError(
            "Le service IA n'a retourné aucun contenu exploitable."
        )

    if web and "web_search_calls" not in payload:
        raise RuntimeError(
            "OpenAIService.chat() doit fournir 'web_search_calls' "
            "pour une requête utilisant la recherche Web."
        )

    cost = _calculate_real_chat_cost(
        model=model,
        usage=payload.get("usage"),
        web_search_calls=payload.get(
            "web_search_calls",
            0,
        ),
    )

    return message, cost


def _parse_stream_item(
    item: Any,
) -> tuple[str | None, Any | None, int | None]:
    """
    Normalise un élément de OpenAIService.chat_stream().

    Protocole recommandé :
        {"type": "delta", "content": "..."}
        {"type": "usage", "usage": {...}, "web_search_calls": 0}

    Les chaînes simples restent acceptées comme deltas, mais un
    événement final contenant usage est obligatoire pour débiter.
    """

    if isinstance(item, str):
        return item, None, None

    payload = _as_mapping(item)

    if payload is None:
        return None, None, None

    item_type = str(
        payload.get("type")
        or ""
    ).strip()

    delta = None

    if item_type in {
        "delta",
        "response.output_text.delta",
    }:
        delta = payload.get(
            "content",
            payload.get("delta"),
        )

    elif (
        "content" in payload
        and "usage" not in payload
    ):
        delta = payload.get("content")

    usage = payload.get("usage")

    web_search_calls = (
        payload.get("web_search_calls")
        if "web_search_calls" in payload
        else None
    )

    if delta is not None:
        delta = str(delta)

    return delta, usage, web_search_calls


# ============================================================

# MÉMOIRE CONVERSATIONNELLE

# ============================================================



# Nombre maximal de messages qu'une conversation peut conserver

# selon le pack actif. Cette limite de stockage est volontairement

# distincte du nombre de messages envoyés au modèle à chaque requête.

PACK_HISTORY_LIMITS = {

    "light_pack": 300,

    "intermediate_pack": 500,

    "pro_pack": 1000,

    "business_pack": 2000,

}



# Contexte récent réellement transmis au modèle.

MAX_CONTEXT_MESSAGES = 40



# En complément du contexte récent, Oria peut récupérer quelques anciens

# messages pertinents dans l'historique autorisé par le pack. Ils sont

# ajoutés avant les messages récents afin de conserver l'ordre conversationnel.

MAX_RETRIEVED_HISTORY_MESSAGES = 8

MIN_RETRIEVAL_SCORE = 2



# Mémoire longue structurée persistée dans Supabase.

# Elle complète l'historique brut sans remplacer les 40 messages récents.

STRUCTURED_MEMORY_MAX_CHARS = 12000



# Mots très fréquents à ignorer lors de la recherche dans l'historique.

_HISTORY_STOP_WORDS = {

    "a", "ai", "au", "aux", "avec", "ce", "ces", "cette", "dans", "de",

    "des", "du", "elle", "en", "et", "est", "il", "je", "la", "le",

    "les", "leur", "lui", "ma", "mais", "me", "mes", "moi", "mon",

    "ne", "nos", "notre", "nous", "on", "ou", "par", "pas", "pour",

    "que", "qui", "sa", "se", "ses", "son", "sur", "ta", "te", "tes",

    "toi", "ton", "tu", "un", "une", "vos", "votre", "vous", "y",

    "the", "a", "an", "and", "are", "as", "at", "be", "by", "for",

    "from", "in", "is", "it", "of", "on", "or", "that", "this", "to",

    "was", "were", "with", "you", "your",

}





def _normalize_history_text(value: str) -> str:

    """Normalise un texte pour la recherche légère dans l'historique."""

    value = unicodedata.normalize("NFKD", value.lower())

    value = "".join(char for char in value if not unicodedata.combining(char))

    return re.sub(r"[^a-z0-9_+#.-]+", " ", value).strip()





def _history_search_terms(message: str) -> set[str]:

    """Extrait les termes utiles du nouveau message utilisateur."""

    normalized = _normalize_history_text(message)

    return {

        term

        for term in normalized.split()

        if len(term) >= 3 and term not in _HISTORY_STOP_WORDS

    }





def _retrieve_relevant_old_messages(

    old_rows: list[dict[str, Any]],

    current_message: str,

) -> list[dict[str, Any]]:

    """

    Recherche dans l'ancien historique les messages les plus proches du

    message courant, sans appel IA supplémentaire et sans coût de crédits.



    Cette première couche de mémoire longue est volontairement locale :

    elle privilégie les termes, identifiants, noms de fichiers, modèles,

    fonctions et expressions déjà employés dans la conversation.

    """

    query_terms = _history_search_terms(current_message)

    if not query_terms or not old_rows:

        return []



    scored: list[tuple[int, int, dict[str, Any]]] = []



    for index, row in enumerate(old_rows):

        content = str(row.get("content") or "").strip()

        if not content:

            continue



        normalized_content = _normalize_history_text(content)

        content_terms = set(normalized_content.split())

        overlap = query_terms.intersection(content_terms)



        if not overlap:

            continue



        # Les correspondances exactes de termes comptent double. Une petite

        # prime favorise aussi les anciens messages les plus récents en cas

        # d'égalité, sans écraser la pertinence textuelle.

        score = len(overlap) * 2



        normalized_query = _normalize_history_text(current_message)

        if normalized_query and normalized_query in normalized_content:

            score += 4



        if score < MIN_RETRIEVAL_SCORE:

            continue



        scored.append((score, index, row))



    # Sélection par pertinence, puis remise en ordre chronologique avant

    # injection dans le contexte du modèle.

    selected = sorted(

        scored,

        key=lambda item: (item[0], item[1]),

        reverse=True,

    )[:MAX_RETRIEVED_HISTORY_MESSAGES]



    return [

        item[2]

        for item in sorted(selected, key=lambda item: item[1])

    ]







def _get_structured_conversation_memory(

    conversation_id: str | None,

    authenticated_user_id: str,

) -> str:

    """

    Charge la mémoire longue structurée d'une conversation.



    La mémoire reste strictement liée à la conversation et à son propriétaire.

    Une absence de mémoire est normale pour une conversation nouvelle.

    """

    if not conversation_id:

        return ""



    response = (

        supabase

        .table("conversation_memories")

        .select("summary")

        .eq("conversation_id", conversation_id)

        .eq("user_id", authenticated_user_id)

        .limit(1)

        .execute()

    )



    if not response.data:

        return ""



    summary = str(response.data[0].get("summary") or "").strip()

    if not summary:

        return ""



    # Garde-fou pour éviter qu'une mémoire anormalement volumineuse

    # n'envahisse le contexte envoyé au modèle.

    return summary[-STRUCTURED_MEMORY_MAX_CHARS:]





def _structured_memory_as_history(

    summary: str,

) -> list[dict[str, str]]:

    """

    Transforme la mémoire persistée en contexte explicite pour le modèle.



    Elle est injectée comme contexte système avant les messages historiques.

    """

    summary = summary.strip()

    if not summary:

        return []



    return [

        {

            "role": "system",

            "content": (

                "Mémoire longue de cette conversation. "

                "Utilise ces informations uniquement comme contexte "

                "lorsqu'elles sont pertinentes. Les messages récents "

                "et les nouvelles instructions de l'utilisateur priment "

                "en cas de contradiction.\n\n"

                f"{summary}"

            ),

        }

    ]





def _get_conversation_history(

    conversation_id: str | None,

    authenticated_user_id: str,

    current_message: str,

    pack_id: str,

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



    # La quantité d'historique disponible dépend du pack actif.

    # Le nettoyage physique de Supabase sera géré par le composant

    # responsable de l'enregistrement des messages. Ici, on borne

    # uniquement l'historique exploitable par cette route.

    history_limit = PACK_HISTORY_LIMITS.get(

        pack_id,

        PACK_HISTORY_LIMITS["light_pack"],

    )

    rows = rows[-history_limit:]



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



    # Les 40 derniers messages restent le contexte immédiat. Les messages

    # plus anciens restent disponibles pour une recherche ciblée.

    recent_rows = rows[-MAX_CONTEXT_MESSAGES:]

    old_rows = (

        rows[:-MAX_CONTEXT_MESSAGES]

        if len(rows) > MAX_CONTEXT_MESSAGES

        else []

    )



    retrieved_rows = _retrieve_relevant_old_messages(

        old_rows=old_rows,

        current_message=current_message,

    )



    # Les anciens messages retrouvés sont placés avant le contexte récent.

    # Ils gardent leur rôle d'origine : aucune ancienne réponse n'est élevée

    # artificiellement au rang de message system/developer.

    context_rows = retrieved_rows + recent_rows



    history: list[dict[str, str]] = []



    for row in context_rows:

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



    structured_memory = _get_structured_conversation_memory(

        conversation_id=conversation_id,

        authenticated_user_id=authenticated_user_id,

    )



    return (

        _structured_memory_as_history(structured_memory)

        + history

    )





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

    Aucun coût fixe n'est calculé ici.
    Une réservation prudente sera créée avant l'appel OpenAI puis
    finalisée avec le coût réel calculé depuis l'usage retourné.
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
            detail=f"Modèle inconnu : {model}",
        )

    _validate_attachments(
        attachments
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

    if not wallet.is_pack_active:
        raise HTTPException(
            status_code=403,
            detail=(
                "Le pack de crédits est "
                "expiré ou inactif."
            ),
        )

    # Garde-fou minimal avant l'estimation puis la réservation atomique.
    if wallet.balance <= 0:
        raise HTTPException(
            status_code=402,
            detail=(
                "Crédits insuffisants "
                "pour effectuer cette action."
            ),
        )

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

    # L'action reste un identifiant de transaction.
    # Elle ne détermine plus le prix du Chat.
    action_type = (
        "web"
        if web
        else "normal"
    )

    action = MODEL_ACTIONS[
        model
    ][action_type]

    history = _get_conversation_history(
        conversation_id=conversation_id,
        authenticated_user_id=authenticated_user_id,
        current_message=message,
        pack_id=wallet.pack_id,
    )

    return (
        authenticated_user_id,
        repository,
        wallet,
        message,
        action,
        is_trial_model,
        history,
    )


# ============================================================
# RÉSERVATION / SETTLEMENT DU CHAT
# ============================================================


def _estimate_chat_input_tokens(
    *,
    message: str,
    history: list[dict[str, str]],
    attachments: list[ChatAttachment],
) -> int:
    """Estimation prudente utilisée uniquement pour la réservation."""
    if attachments:
        return MAX_CHAT_INPUT_TOKENS

    text_parts = [message]

    for item in history:
        content = item.get("content")
        if content:
            text_parts.append(str(content))

    total_chars = sum(len(part) for part in text_parts)

    # Estimation volontairement prudente, sans dépendance tokenizer externe.
    estimated_tokens = max(1, (total_chars + 2) // 3)

    return min(estimated_tokens, MAX_CHAT_INPUT_TOKENS)


def _reserve_chat_credits(
    *,
    repository,
    authenticated_user_id: str,
    action: CreditAction,
    model: str,
    message: str,
    history: list[dict[str, str]],
    attachments: list[ChatAttachment],
    web: bool,
) -> tuple[str, int]:
    """Réserve atomiquement un montant prudent avant l'appel OpenAI."""
    estimated_input_tokens = _estimate_chat_input_tokens(
        message=message,
        history=history,
        attachments=attachments,
    )

    try:
        reserved_amount = TokenBillingService.estimate_reservation(
            model=model,
            estimated_input_tokens=estimated_input_tokens,
            web_enabled=web,
        )
    except TokenBillingError as error:
        raise HTTPException(
            status_code=400,
            detail=(
                "Impossible d'estimer la réservation de crédits : "
                f"{error}"
            ),
        ) from error

    reservation_id = str(uuid4())

    try:
        repository.reserve_credits(
            user_id=authenticated_user_id,
            amount=reserved_amount,
            action=action,
            reference_id=reservation_id,
        )
    except Exception as error:
        error_text = str(error).lower()

        if "insufficient_credits" in error_text:
            raise HTTPException(
                status_code=402,
                detail=(
                    "Crédits insuffisants pour réserver cette requête. "
                    "Aucun appel OpenAI n'a été effectué."
                ),
            ) from error

        if "inactive_pack" in error_text:
            raise HTTPException(
                status_code=403,
                detail="Le pack de crédits est expiré ou inactif.",
            ) from error

        raise HTTPException(
            status_code=500,
            detail=(
                "Impossible de réserver les crédits avant la requête IA : "
                f"{error}"
            ),
        ) from error

    return reservation_id, reserved_amount


def _release_chat_reservation(
    *,
    repository,
    authenticated_user_id: str,
    reservation_id: str,
) -> None:
    repository.release_credit_reservation(
        user_id=authenticated_user_id,
        reference_id=reservation_id,
    )


def _settle_chat_reservation(
    *,
    repository,
    wallet_before_reservation,
    authenticated_user_id: str,
    reservation_id: str,
    action: CreditAction,
    cost: int,
    is_trial_model: bool,
    model_id: str,
):
    """
    Finalise la réservation avec le coût réel.

    La RPC Supabase crée déjà la transaction USAGE : aucun second débit ni
    aucune seconde transaction n'est effectué côté Python.
    """
    try:
        settled_wallet = repository.settle_credit_reservation(
            user_id=authenticated_user_id,
            reference_id=reservation_id,
            actual_amount=cost,
        )
    except Exception as error:
        raise RuntimeError(
            "La réponse IA a été générée mais le settlement des crédits "
            f"a échoué : {error}"
        ) from error

    previous_balance = wallet_before_reservation.balance
    new_balance = settled_wallet.balance

    consumed_credits = settled_wallet.initial_credits - new_balance
    consumed_percentage = (
        (consumed_credits / settled_wallet.initial_credits) * 100
        if settled_wallet.initial_credits > 0
        else 0
    )
    remaining_percentage = max(0, 100 - consumed_percentage)

    result = SimpleNamespace(
        cost=cost,
        previous_balance=previous_balance,
        new_balance=new_balance,
        consumed_credits=consumed_credits,
        consumed_percentage=consumed_percentage,
        remaining_percentage=remaining_percentage,
        requires_warning=(remaining_percentage <= 20),
        requires_critical_warning=(remaining_percentage <= 5),
        action=action,
    )

    trials_remaining = None

    if is_trial_model:
        trial = ModelTrialService.consume_trial(
            authenticated_user_id,
            model_id,
        )
        trials_remaining = max(
            0,
            trial["max_trials"] - trial["used_trials"],
        )

    return result, trials_remaining


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
    user_id: str | None = Header(default=None, alias="user-id"),
    authorization: str | None = Header(default=None, alias="authorization"),
):
    attachments = await _build_attachments(files)

    (
        authenticated_user_id,
        repository,
        wallet,
        message,
        action,
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

    reservation_id, _reserved_amount = _reserve_chat_credits(
        repository=repository,
        authenticated_user_id=authenticated_user_id,
        action=action,
        model=model,
        message=message,
        history=history,
        attachments=attachments,
        web=web,
    )

    openai_service = OpenAIService()

    try:
        openai_response = openai_service.chat(
            model=MODEL_OPENAI_IDS[model],
            message=message,
            web=web,
            attachments=_attachments_for_openai(attachments),
            history=history,
        )
    except Exception as error:
        try:
            _release_chat_reservation(
                repository=repository,
                authenticated_user_id=authenticated_user_id,
                reservation_id=reservation_id,
            )
        except Exception:
            pass

        raise HTTPException(
            status_code=502,
            detail=f"Impossible de contacter le service IA : {error}",
        ) from error

    try:
        response_text, cost = _extract_classic_chat_result(
            response=openai_response,
            model=model,
            web=web,
        )
    except RuntimeError as error:
        # L'appel fournisseur a déjà abouti. On ne libère pas aveuglément une
        # réservation si l'usage final est inexploitable : l'API a pu facturer.
        raise HTTPException(status_code=502, detail=str(error)) from error

    try:
        result, trials_remaining = _settle_chat_reservation(
            repository=repository,
            wallet_before_reservation=wallet,
            authenticated_user_id=authenticated_user_id,
            reservation_id=reservation_id,
            action=action,
            cost=cost,
            is_trial_model=is_trial_model,
            model_id=model,
        )
    except RuntimeError as error:
        raise HTTPException(status_code=500, detail=str(error)) from error

    return ChatResponse(
        success=True,
        model=model,
        action=result.action.value,
        message=response_text,
        cost=result.cost,
        previous_balance=result.previous_balance,
        credits_remaining=result.new_balance,
        consumed_percentage=result.consumed_percentage,
        remaining_percentage=result.remaining_percentage,
        requires_warning=result.requires_warning,
        requires_critical_warning=result.requires_critical_warning,
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
    """
    Authentifie et valide une création média.

    Aucun coût fixe n'est déterminé ici.
    La facturation image suit désormais :
        estimation -> reserve -> génération -> coût réel -> settle.
    """
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
    except ValueError as error:
        raise HTTPException(
            status_code=400,
            detail=f"Action média inconnue : {action_value}",
        ) from error

    if action not in IMAGE_ACTIONS and action not in VIDEO_ACTIONS:
        raise HTTPException(
            status_code=400,
            detail=(
                "L'action demandée n'est pas une action "
                "de création média."
            ),
        )

    repository = SupabaseCreditRepository(supabase)
    wallet = repository.get_wallet(authenticated_user_id)

    if wallet is None:
        raise HTTPException(
            status_code=404,
            detail=(
                "Aucun portefeuille de crédits trouvé "
                "pour cet utilisateur."
            ),
        )

    if not wallet.is_pack_active:
        raise HTTPException(
            status_code=403,
            detail="Le pack de crédits est expiré ou inactif.",
        )

    if wallet.balance <= 0:
        raise HTTPException(
            status_code=402,
            detail="Crédits insuffisants pour effectuer cette création.",
        )

    allowed_media = PACK_ALLOWED_MEDIA.get(
        wallet.pack_id,
        set(),
    )

    if action not in allowed_media:
        raise HTTPException(
            status_code=403,
            detail=(
                f"L'action '{action.value}' n'est pas disponible "
                f"avec le pack '{wallet.pack_id}'."
            ),
        )

    return (
        authenticated_user_id,
        repository,
        wallet,
        action,
        prompt,
    )


# ============================================================
# RÉSERVATION / SETTLEMENT DES MÉDIAS
# ============================================================


def _reserve_image_credits(
    *,
    repository,
    wallet,
    authenticated_user_id: str,
    action: CreditAction,
) -> tuple[str, int]:
    """Réserve un montant prudent avant l'appel Image API."""
    try:
        reserved_amount = (
            MediaBillingService.estimate_image_reservation(
                pack_id=wallet.pack_id,
                action=action,
                count=1,
            )
        )
    except UnsupportedMediaBillingModelError as error:
        raise HTTPException(
            status_code=503,
            detail=(
                "Aucun modèle image facturable n'est configuré "
                f"pour ce pack : {error}"
            ),
        ) from error
    except MediaBillingError as error:
        raise HTTPException(
            status_code=400,
            detail=(
                "Impossible d'estimer le coût de la génération "
                f"d'image : {error}"
            ),
        ) from error

    reservation_id = str(uuid4())

    try:
        repository.reserve_credits(
            user_id=authenticated_user_id,
            amount=reserved_amount,
            action=action,
            reference_id=reservation_id,
        )
    except Exception as error:
        error_text = str(error).lower()

        if "insufficient_credits" in error_text:
            raise HTTPException(
                status_code=402,
                detail=(
                    "Crédits insuffisants pour réserver cette "
                    "génération. Aucun appel fournisseur n'a été effectué."
                ),
            ) from error

        if "inactive_pack" in error_text:
            raise HTTPException(
                status_code=403,
                detail="Le pack de crédits est expiré ou inactif.",
            ) from error

        raise HTTPException(
            status_code=500,
            detail=(
                "Impossible de réserver les crédits avant "
                f"la génération : {error}"
            ),
        ) from error

    return reservation_id, reserved_amount


def _release_media_reservation(
    *,
    repository,
    authenticated_user_id: str,
    reservation_id: str,
) -> None:
    """Libère une réservation si aucun coût fournisseur n'a été engagé."""
    repository.release_credit_reservation(
        user_id=authenticated_user_id,
        reference_id=reservation_id,
    )


def _calculate_real_image_cost(
    *,
    generated: Any,
    reserved_amount: int,
) -> int:
    """
    Calcule le coût réel depuis l'usage retourné par OpenAI.

    Si une incohérence exceptionnelle survient après une génération
    réussie, le montant réservé sert de fallback économique.
    """
    mapping = _as_mapping(generated)

    if mapping is None:
        return reserved_amount

    try:
        billing = (
            MediaBillingService
            .calculate_image_from_provider_result(
                mapping
            )
        )
    except MediaBillingError:
        return reserved_amount

    if billing.credits <= 0:
        return reserved_amount

    return billing.credits



def _video_pricing_table() -> dict[str, dict[str, float]]:
    """
    Retourne la grille vidéo centralisée dans credit_costs.py.

    Le nouveau nom VIDEO_PRICING_USD_PER_SECOND est prioritaire.
    LEGACY_SORA_PRICING_USD_PER_SECOND reste accepté pendant la migration.
    """
    pricing = getattr(
        credit_costs_config,
        "VIDEO_PRICING_USD_PER_SECOND",
        None,
    )

    if not pricing:
        pricing = getattr(
            credit_costs_config,
            "LEGACY_SORA_PRICING_USD_PER_SECOND",
            None,
        )

    if not isinstance(pricing, dict) or not pricing:
        raise UnsupportedMediaBillingModelError(
            "Aucune grille tarifaire vidéo par seconde n'est configurée "
            "dans credit_costs.py."
        )

    return pricing


def _video_pricing_tier_from_size(size: Any) -> str | None:
    """Convertit une taille OpenAI en palier tarifaire Sora."""
    normalized = str(size or "").strip().lower()

    if normalized in {"1280x720", "720x1280", "720p"}:
        return "720p"

    if normalized in {"1792x1024", "1024x1792", "1024p"}:
        return "1024p"

    if normalized in {"1920x1080", "1080x1920", "1080p"}:
        return "1080p"

    return None


def _resolve_video_rate_usd_per_second(
    *,
    model: str,
    size: Any = None,
    conservative: bool = False,
) -> float:
    """
    Résout le tarif vidéo depuis la configuration économique centrale.

    Pour la réservation, `conservative=True` prend le tarif le plus élevé
    du modèle. Le settlement rend automatiquement le surplus après génération.
    """
    pricing = _video_pricing_table()
    model_rates = pricing.get(str(model))

    if not isinstance(model_rates, dict) or not model_rates:
        raise UnsupportedMediaBillingModelError(
            f"Aucun tarif vidéo n'est configuré pour le modèle '{model}'."
        )

    numeric_rates: list[float] = []
    for value in model_rates.values():
        try:
            rate = float(value)
        except (TypeError, ValueError):
            continue
        if rate > 0:
            numeric_rates.append(rate)

    if not numeric_rates:
        raise UnsupportedMediaBillingModelError(
            f"La grille tarifaire du modèle '{model}' est vide ou invalide."
        )

    if conservative:
        return max(numeric_rates)

    tier = _video_pricing_tier_from_size(size)
    if tier is not None and tier in model_rates:
        try:
            rate = float(model_rates[tier])
        except (TypeError, ValueError):
            rate = 0.0
        if rate > 0:
            return rate

    # Filet de sécurité économique : si la taille n'est pas reconnue,
    # on facture au tarif le plus élevé plutôt que de sous-facturer.
    return max(numeric_rates)


def _reserve_video_credits(
    *,
    repository,
    wallet,
    authenticated_user_id: str,
    action: CreditAction,
) -> tuple[str, int]:
    """Réserve un montant prudent avant l'appel OpenAI Videos."""
    try:
        _provider, model = MediaBillingService.resolve_video_backend(
            wallet.pack_id
        )
        conservative_rate = _resolve_video_rate_usd_per_second(
            model=model,
            conservative=True,
        )
        reserved_amount = MediaBillingService.estimate_video_reservation(
            pack_id=wallet.pack_id,
            action=action,
            rate_usd_per_second=conservative_rate,
        )
    except UnsupportedMediaBillingModelError as error:
        raise HTTPException(
            status_code=503,
            detail=(
                "Aucun modèle vidéo facturable n'est configuré "
                f"pour ce pack : {error}"
            ),
        ) from error
    except MediaBillingError as error:
        raise HTTPException(
            status_code=400,
            detail=(
                "Impossible d'estimer le coût de la génération vidéo : "
                f"{error}"
            ),
        ) from error

    reservation_id = str(uuid4())

    try:
        repository.reserve_credits(
            user_id=authenticated_user_id,
            amount=reserved_amount,
            action=action,
            reference_id=reservation_id,
        )
    except Exception as error:
        error_text = str(error).lower()

        if "insufficient_credits" in error_text:
            raise HTTPException(
                status_code=402,
                detail=(
                    "Crédits insuffisants pour réserver cette génération "
                    "vidéo. Aucun appel OpenAI n'a été effectué."
                ),
            ) from error

        if "inactive_pack" in error_text:
            raise HTTPException(
                status_code=403,
                detail="Le pack de crédits est expiré ou inactif.",
            ) from error

        raise HTTPException(
            status_code=500,
            detail=(
                "Impossible de réserver les crédits avant la génération "
                f"vidéo : {error}"
            ),
        ) from error

    return reservation_id, reserved_amount


def _calculate_real_video_cost(
    *,
    generated: Any,
    reserved_amount: int,
) -> int:
    """
    Calcule le coût réel d'une vidéo terminée.

    Si le fournisseur renvoie un coût USD total, il est prioritaire.
    Sinon Oria facture durée × tarif/seconde du modèle et de la résolution.
    En cas d'incohérence après une génération réussie, la réservation sert
    de fallback afin d'éviter de rendre gratuitement un média déjà facturé.
    """
    mapping = _as_mapping(generated)
    if mapping is None:
        return reserved_amount

    provider = str(mapping.get("provider") or "openai")
    model = str(mapping.get("model") or "")
    action = mapping.get("action")
    seconds = mapping.get("seconds")
    total_cost_usd = mapping.get("total_cost_usd")

    if not model or not action:
        return reserved_amount

    try:
        if total_cost_usd is not None:
            billing = MediaBillingService.calculate_video(
                provider=provider,
                model=model,
                action=action,
                total_cost_usd=total_cost_usd,
                seconds=seconds,
            )
        else:
            rate = _resolve_video_rate_usd_per_second(
                model=model,
                size=mapping.get("size"),
                conservative=False,
            )
            billing = MediaBillingService.calculate_video(
                provider=provider,
                model=model,
                action=action,
                seconds=seconds,
                rate_usd_per_second=rate,
            )
    except MediaBillingError:
        return reserved_amount

    if billing.credits <= 0:
        return reserved_amount

    return billing.credits

def _settle_media_reservation(
    *,
    repository,
    wallet_before_reservation,
    authenticated_user_id: str,
    reservation_id: str,
    action: CreditAction,
    cost: int,
):
    """Finalise une réservation média avec le coût réel."""
    try:
        settled_wallet = repository.settle_credit_reservation(
            user_id=authenticated_user_id,
            reference_id=reservation_id,
            actual_amount=cost,
        )
    except Exception as error:
        raise RuntimeError(
            "Le média a été généré mais le settlement "
            f"des crédits a échoué : {error}"
        ) from error

    previous_balance = wallet_before_reservation.balance
    new_balance = settled_wallet.balance

    consumed_credits = (
        settled_wallet.initial_credits
        - new_balance
    )

    consumed_percentage = (
        (
            consumed_credits
            / settled_wallet.initial_credits
        )
        * 100
        if settled_wallet.initial_credits > 0
        else 0
    )

    remaining_percentage = max(
        0,
        100 - consumed_percentage,
    )

    return SimpleNamespace(
        cost=cost,
        previous_balance=previous_balance,
        new_balance=new_balance,
        consumed_credits=consumed_credits,
        consumed_percentage=consumed_percentage,
        remaining_percentage=remaining_percentage,
        requires_warning=(remaining_percentage <= 20),
        requires_critical_warning=(remaining_percentage <= 5),
        action=action,
    )


# ============================================================

# LECTURE DU PAYLOAD MÉDIA

# ============================================================





async def _read_media_request(

    request: Request,

) -> tuple[str, str, str | None]:

    """

    Lit une requête de création média envoyée par le frontend.



    Le frontend peut envoyer :

        - application/json

        - multipart/form-data

        - application/x-www-form-urlencoded



    Avant cette compatibilité, les paramètres `Form(...)`

    provoquaient un HTTP 422 dès que le frontend envoyait du JSON.

    """



    content_type = (

        request.headers.get("content-type", "")

        .lower()

    )



    action = None

    prompt = None

    conversation_id = None



    if "application/json" in content_type:

        try:

            payload = await request.json()

        except Exception:

            raise HTTPException(

                status_code=400,

                detail="Le corps JSON de la requête média est invalide.",

            )



        if not isinstance(payload, dict):

            raise HTTPException(

                status_code=400,

                detail="Le corps de la requête média doit être un objet JSON.",

            )



        action = (

            payload.get("action")

            or payload.get("media_action")

            or payload.get("mediaAction")

        )



        prompt = payload.get("prompt")

        conversation_id = (

            payload.get("conversation_id")

            or payload.get("conversationId")

        )



    else:

        try:

            form = await request.form()

        except Exception:

            raise HTTPException(

                status_code=400,

                detail="Impossible de lire les données du formulaire média.",

            )



        action = (

            form.get("action")

            or form.get("media_action")

            or form.get("mediaAction")

        )



        prompt = form.get("prompt")

        conversation_id = (

            form.get("conversation_id")

            or form.get("conversationId")

        )



    if action is None or not str(action).strip():

        raise HTTPException(

            status_code=400,

            detail="Le paramètre 'action' est requis pour la création média.",

        )



    if prompt is None or not str(prompt).strip():

        raise HTTPException(

            status_code=400,

            detail="Le paramètre 'prompt' est requis pour la création média.",

        )



    normalized_conversation_id = (

        str(conversation_id).strip()

        if conversation_id is not None

        and str(conversation_id).strip()

        else None

    )



    return (

        str(action).strip(),

        str(prompt).strip(),

        normalized_conversation_id,

    )





# ============================================================
# POST /ai/image
# ============================================================


@router.post(
    "/image",
    response_model=MediaResponse,
)
async def generate_image(
    request: Request,
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
    Génère une image avec facturation dynamique.

    Flux :
        validation
        -> estimation
        -> reserve
        -> Image API
        -> coût réel
        -> settle
        -> persistance média
    """
    action, prompt, conversation_id = (
        await _read_media_request(request)
    )

    (
        authenticated_user_id,
        repository,
        wallet,
        credit_action,
        prompt,
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

    reservation_id, reserved_amount = (
        _reserve_image_credits(
            repository=repository,
            wallet=wallet,
            authenticated_user_id=authenticated_user_id,
            action=credit_action,
        )
    )

    service = OpenAIService()

    try:
        generated = service.generate_image(
            action=credit_action.value,
            prompt=prompt,
            pack_id=wallet.pack_id,
        )
    except Exception as error:
        try:
            _release_media_reservation(
                repository=repository,
                authenticated_user_id=authenticated_user_id,
                reservation_id=reservation_id,
            )
        except Exception:
            pass

        raise HTTPException(
            status_code=502,
            detail=(
                "La génération d'image a échoué : "
                f"{error}"
            ),
        ) from error

    actual_cost = _calculate_real_image_cost(
        generated=generated,
        reserved_amount=reserved_amount,
    )

    try:
        result = _settle_media_reservation(
            repository=repository,
            wallet_before_reservation=wallet,
            authenticated_user_id=authenticated_user_id,
            reservation_id=reservation_id,
            action=credit_action,
            cost=actual_cost,
        )
    except RuntimeError as error:
        # L'appel fournisseur a déjà réussi : ne pas release
        # aveuglément la réservation après ce point.
        raise HTTPException(
            status_code=500,
            detail=str(error),
        ) from error

    # La sauvegarde intervient après settlement pour persister le
    # coût final réellement débité.
    persisted: dict[str, Any] = {}

    try:
        persisted = MediaService().save_openai_image(
            user_id=authenticated_user_id,
            generated=generated,
            action=credit_action.value,
            prompt=prompt,
            credits_cost=result.cost,
            conversation_id=conversation_id,
        )
    except Exception as error:
        # La génération a été facturée par le fournisseur et settle.
        # On renvoie quand même l'image afin que l'utilisateur ne perde
        # pas un résultat déjà payé.
        print(
            "[MEDIA IMAGE] "
            "persistence_failed=True "
            f"user_id={authenticated_user_id!r} "
            f"error={str(error)!r}",
            flush=True,
        )

    images = generated.get("images") or []

    first_image = (
        images[0]
        if images
        and isinstance(images[0], dict)
        else {}
    )

    image_data = (
        generated.get("b64_json")
        or first_image.get("b64_json")
        or ""
    )

    media_url = (
        persisted.get("media_url")
        or persisted.get("public_url")
        or persisted.get("url")
    )

    return MediaResponse(
        success=True,
        type="image",
        action=credit_action.value,
        model=str(generated["model"]),
        cost=result.cost,
        previous_balance=result.previous_balance,
        credits_remaining=result.new_balance,
        remaining_percentage=result.remaining_percentage,
        mime_type=str(
            generated.get("mime_type")
            or "image/png"
        ),
        data=str(image_data),
        media_id=persisted.get("id"),
        conversation_id=conversation_id,
        media_url=media_url,
        public_url=persisted.get("public_url"),
        url=persisted.get("url"),
        size=str(
            generated.get("size")
            or ""
        ),
    )


# ============================================================
# POST /ai/video
# ============================================================


@router.post(
    "/video",
    response_model=MediaResponse,
)
async def generate_video(
    request: Request,
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
    Génère une vidéo OpenAI avec facturation dynamique.

    Flux :
        validation
        -> estimation prudente
        -> reserve
        -> OpenAI Videos
        -> coût réel durée/résolution
        -> settle
        -> persistance média
    """
    action, prompt, conversation_id = await _read_media_request(request)

    (
        authenticated_user_id,
        repository,
        wallet,
        credit_action,
        prompt,
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

    reservation_id, reserved_amount = _reserve_video_credits(
        repository=repository,
        wallet=wallet,
        authenticated_user_id=authenticated_user_id,
        action=credit_action,
    )

    service = OpenAIService()

    try:
        generated = service.generate_video(
            action=credit_action.value,
            prompt=prompt,
            pack_id=wallet.pack_id,
        )
    except Exception as error:
        try:
            _release_media_reservation(
                repository=repository,
                authenticated_user_id=authenticated_user_id,
                reservation_id=reservation_id,
            )
        except Exception:
            pass

        raise HTTPException(
            status_code=502,
            detail=(
                "La génération vidéo a échoué : "
                f"{error}"
            ),
        ) from error

    actual_cost = _calculate_real_video_cost(
        generated=generated,
        reserved_amount=reserved_amount,
    )

    try:
        result = _settle_media_reservation(
            repository=repository,
            wallet_before_reservation=wallet,
            authenticated_user_id=authenticated_user_id,
            reservation_id=reservation_id,
            action=credit_action,
            cost=actual_cost,
        )
    except RuntimeError as error:
        # La vidéo a déjà été générée : ne pas libérer la réservation.
        raise HTTPException(
            status_code=500,
            detail=str(error),
        ) from error

    persisted: dict[str, Any] = {}

    try:
        persisted = MediaService().save_generated_video(
            user_id=authenticated_user_id,
            generated=generated,
            action=credit_action.value,
            prompt=prompt,
            credits_cost=result.cost,
            conversation_id=conversation_id,
        )
    except Exception as error:
        # Le fournisseur a déjà généré la vidéo et le settlement est effectué.
        # On retourne quand même le contenu afin de ne pas perdre le résultat.
        print(
            "[MEDIA VIDEO] "
            "persistence_failed=True "
            f"user_id={authenticated_user_id!r} "
            f"error={str(error)!r}",
            flush=True,
        )

    raw_video = generated.get("data")
    if isinstance(raw_video, bytearray):
        raw_video = bytes(raw_video)

    if isinstance(raw_video, bytes):
        video_data = base64.b64encode(raw_video).decode("utf-8")
    elif isinstance(raw_video, str):
        video_data = raw_video
    else:
        video_data = ""

    media_url = (
        persisted.get("media_url")
        or persisted.get("public_url")
        or persisted.get("url")
    )

    return MediaResponse(
        success=True,
        type="video",
        action=credit_action.value,
        model=str(generated.get("model") or ""),
        cost=result.cost,
        previous_balance=result.previous_balance,
        credits_remaining=result.new_balance,
        remaining_percentage=result.remaining_percentage,
        mime_type=str(generated.get("mime_type") or "video/mp4"),
        data=video_data,
        media_id=persisted.get("id"),
        conversation_id=conversation_id,
        media_url=media_url,
        public_url=persisted.get("public_url"),
        url=persisted.get("url"),
        video_id=(
            str(generated.get("video_id"))
            if generated.get("video_id") is not None
            else None
        ),
        seconds=(
            str(generated.get("seconds"))
            if generated.get("seconds") is not None
            else None
        ),
        size=(
            str(generated.get("size"))
            if generated.get("size") is not None
            else None
        ),
    )


# ============================================================

# GET /ai/media

# ============================================================





@router.get("/media")

def get_generated_media(

    user_id: str | None = Header(default=None, alias="user-id"),

    authorization: str | None = Header(default=None, alias="authorization"),

):

    """Retourne les créations média persistées de l'utilisateur."""



    authenticated_user_id = _authenticate_chat_user(user_id, authorization)



    try:

        media = MediaService().list_user_media(

            user_id=authenticated_user_id,

        )

    except Exception as error:

        raise HTTPException(

            status_code=500,

            detail=f"Impossible de récupérer les créations média : {error}",

        )



    return {"success": True, "count": len(media), "media": media}





# ============================================================

# DELETE /ai/media/{media_id}

# ============================================================





@router.delete("/media/{media_id}")

def delete_generated_media(

    media_id: str,

    user_id: str | None = Header(default=None, alias="user-id"),

    authorization: str | None = Header(default=None, alias="authorization"),

):

    """Supprime une création appartenant à l'utilisateur authentifié."""



    authenticated_user_id = _authenticate_chat_user(user_id, authorization)



    try:

        deleted = MediaService().delete_user_media(

            media_id=media_id,

            user_id=authenticated_user_id,

        )

    except Exception as error:

        raise HTTPException(

            status_code=500,

            detail=f"Impossible de supprimer la création média : {error}",

        )



    if not deleted:

        raise HTTPException(

            status_code=404,

            detail="Création média introuvable ou non autorisée.",

        )



    return {"success": True, "id": media_id}





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


@router.post("/chat/stream")
async def chat_stream(
    model: str = Form(...),
    message: str = Form(""),
    web: bool = Form(False),
    conversation_id: str | None = Form(default=None),
    files: list[UploadFile] = File(default=[]),
    user_id: str | None = Header(default=None, alias="user-id"),
    authorization: str | None = Header(default=None, alias="authorization"),
):
    """Streaming Chat Oria avec réservation avant l'appel et settlement final."""
    attachments = await _build_attachments(files)

    (
        authenticated_user_id,
        repository,
        wallet,
        message,
        action,
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

    reservation_id, reserved_amount = _reserve_chat_credits(
        repository=repository,
        authenticated_user_id=authenticated_user_id,
        action=action,
        model=model,
        message=message,
        history=history,
        attachments=attachments,
        web=web,
    )

    openai_service = OpenAIService()
    openai_attachments = _attachments_for_openai(attachments)

    def event_stream():
        full_response = ""
        final_usage = None
        final_web_search_calls = None
        settled = False

        try:
            yield (
                "event: start\n"
                "data: "
                + dumps(
                    {
                        "success": True,
                        "model": model,
                        "web": web,
                        "attachments": len(openai_attachments),
                        "reservation_id": reservation_id,
                        "reserved_credits": reserved_amount,
                    },
                    ensure_ascii=False,
                )
                + "\n\n"
            )

            stream_result = openai_service.chat_stream(
                model=MODEL_OPENAI_IDS[model],
                message=message,
                web=web,
                attachments=openai_attachments,
                history=history,
            )

            for item in stream_result:
                if item is None:
                    continue

                delta, usage, web_search_calls = _parse_stream_item(item)

                if usage is not None:
                    final_usage = usage
                if web_search_calls is not None:
                    final_web_search_calls = web_search_calls
                if not delta:
                    continue

                full_response += delta
                yield (
                    "event: delta\n"
                    "data: "
                    + dumps({"content": delta}, ensure_ascii=False)
                    + "\n\n"
                )

            if not full_response.strip():
                try:
                    _release_chat_reservation(
                        repository=repository,
                        authenticated_user_id=authenticated_user_id,
                        reservation_id=reservation_id,
                    )
                except Exception:
                    pass

                yield (
                    "event: error\n"
                    "data: "
                    + dumps(
                        {"detail": "Le service IA n'a retourné aucun contenu."},
                        ensure_ascii=False,
                    )
                    + "\n\n"
                )
                return

            if final_usage is None:
                yield (
                    "event: error\n"
                    "data: "
                    + dumps(
                        {
                            "detail": (
                                "La réponse a été générée mais l'usage OpenAI "
                                "final n'a pas été fourni."
                            )
                        },
                        ensure_ascii=False,
                    )
                    + "\n\n"
                )
                return

            if web and final_web_search_calls is None:
                yield (
                    "event: error\n"
                    "data: "
                    + dumps(
                        {
                            "detail": (
                                "La réponse Web a été générée mais le nombre réel "
                                "de recherches Web n'a pas été fourni."
                            )
                        },
                        ensure_ascii=False,
                    )
                    + "\n\n"
                )
                return

            try:
                cost = _calculate_real_chat_cost(
                    model=model,
                    usage=final_usage,
                    web_search_calls=(final_web_search_calls or 0),
                )
            except RuntimeError as error:
                yield (
                    "event: error\n"
                    "data: "
                    + dumps({"detail": str(error)}, ensure_ascii=False)
                    + "\n\n"
                )
                return

            try:
                result, trials_remaining = _settle_chat_reservation(
                    repository=repository,
                    wallet_before_reservation=wallet,
                    authenticated_user_id=authenticated_user_id,
                    reservation_id=reservation_id,
                    action=action,
                    cost=cost,
                    is_trial_model=is_trial_model,
                    model_id=model,
                )
                settled = True
            except Exception as error:
                yield (
                    "event: error\n"
                    "data: "
                    + dumps(
                        {
                            "detail": (
                                "La réponse IA a été générée mais le settlement "
                                f"des crédits a échoué : {error}"
                            )
                        },
                        ensure_ascii=False,
                    )
                    + "\n\n"
                )
                return

            yield (
                "event: done\n"
                "data: "
                + dumps(
                    {
                        "success": True,
                        "model": model,
                        "action": result.action.value,
                        "cost": result.cost,
                        "previous_balance": result.previous_balance,
                        "credits_remaining": result.new_balance,
                        "consumed_percentage": result.consumed_percentage,
                        "remaining_percentage": result.remaining_percentage,
                        "requires_warning": result.requires_warning,
                        "requires_critical_warning": result.requires_critical_warning,
                        "trial": is_trial_model,
                        "trials_remaining": trials_remaining,
                    },
                    ensure_ascii=False,
                )
                + "\n\n"
            )

        except Exception as error:
            # Si aucun contenu n'a été produit, l'appel n'a pas abouti : on rend
            # la réservation. Après production de contenu, on évite un remboursement
            # aveugle car le fournisseur peut déjà avoir facturé des tokens.
            if not settled and not full_response.strip():
                try:
                    _release_chat_reservation(
                        repository=repository,
                        authenticated_user_id=authenticated_user_id,
                        reservation_id=reservation_id,
                    )
                except Exception:
                    pass

            yield (
                "event: error\n"
                "data: "
                + dumps(
                    {"detail": f"Erreur pendant le streaming IA : {error}"},
                    ensure_ascii=False,
                )
                + "\n\n"
            )

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache, no-transform",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )

