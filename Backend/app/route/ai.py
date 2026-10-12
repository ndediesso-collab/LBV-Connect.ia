from json import dumps

import asyncio

import base64

from uuid import uuid4

from types import SimpleNamespace

from datetime import datetime, timezone

from time import perf_counter

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


from app.repositories.supabase_artifact_repository import (
    supabase_artifact_repository,
)



from app.services.openai_service import OpenAIService

from app.services.artifact_service import (
    ArtifactError,
    ArtifactService,
)

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

    artifacts: list[dict[str, Any]] | None = None

    artifact_errors: list[str] | None = None



class ChatControlRequest(BaseModel):
    """
    Commande envoyée pendant une génération active.

    Le frontend utilisera ce contrat pour le bouton « Modifier ».
    """

    generation_id: str
    instruction: str | None = None
    reasoning_mode: str | None = None


# ============================================================
# CONTRÔLE DES GÉNÉRATIONS ACTIVES
# ============================================================

REASONING_MODES = {
    "fast",
    "balanced",
    "deep",
}

MAX_CONTROL_INSTRUCTION_CHARS = 8000
MAX_PENDING_CONTROLS = 4
MAX_SMART_RESTARTS = 3
ACTIVE_GENERATION_TTL_SECONDS = 60 * 60


class ActiveChatGeneration:
    """
    État minimal d'une génération pilotable.

    Ce registre est volontairement en mémoire pour la première version.
    Il convient à un unique process backend. Si Oria passe à plusieurs
    workers/instances, ce registre devra être déplacé vers un stockage
    partagé (par exemple Redis) afin que /chat/control retrouve toujours
    la génération active.
    """

    def __init__(
        self,
        *,
        user_id: str,
        model: str,
        openai_model: str,
        reasoning_mode: str,
        transport: str,
    ):
        self.user_id = user_id
        self.model = model
        self.openai_model = openai_model
        self.reasoning_mode = reasoning_mode
        self.transport = transport
        self.control_queue: asyncio.Queue[dict[str, Any]] = asyncio.Queue(
            maxsize=MAX_PENDING_CONTROLS
        )
        self.active_attempt_id: str | None = None
        self.created_at = perf_counter()
        self.closed = False


_ACTIVE_CHAT_GENERATIONS: dict[str, ActiveChatGeneration] = {}


def _normalize_reasoning_mode(
    value: str | None,
) -> str:
    """Valide le preset public de réflexion Oria."""
    mode = str(value or "balanced").strip().lower()

    if mode not in REASONING_MODES:
        raise HTTPException(
            status_code=400,
            detail=(
                "Mode de réflexion invalide. "
                "Valeurs autorisées : fast, balanced, deep."
            ),
        )

    return mode


def _normalize_generation_id(
    value: str | None,
) -> str:
    """
    Retourne un identifiant de génération sûr.

    Le frontend peut le créer avant l'envoi afin de connaître immédiatement
    l'identifiant à utiliser avec /ai/chat/control.
    """
    if value is None or not str(value).strip():
        return str(uuid4())

    generation_id = str(value).strip()

    if (
        len(generation_id) > 128
        or re.fullmatch(r"[A-Za-z0-9._:-]+", generation_id) is None
    ):
        raise HTTPException(
            status_code=400,
            detail="generation_id invalide.",
        )

    return generation_id


def _cleanup_active_generations() -> None:
    """Supprime les entrées terminées ou anormalement anciennes."""
    now = perf_counter()

    for generation_id, state in list(_ACTIVE_CHAT_GENERATIONS.items()):
        if (
            state.closed
            or now - state.created_at > ACTIVE_GENERATION_TTL_SECONDS
        ):
            _ACTIVE_CHAT_GENERATIONS.pop(generation_id, None)


def _register_active_generation(
    *,
    generation_id: str,
    user_id: str,
    model: str,
    openai_model: str,
    reasoning_mode: str,
    transport: str,
) -> ActiveChatGeneration:
    _cleanup_active_generations()

    existing = _ACTIVE_CHAT_GENERATIONS.get(generation_id)

    if existing is not None and not existing.closed:
        raise HTTPException(
            status_code=409,
            detail=(
                "Une génération portant cet identifiant est déjà active."
            ),
        )

    state = ActiveChatGeneration(
        user_id=user_id,
        model=model,
        openai_model=openai_model,
        reasoning_mode=reasoning_mode,
        transport=transport,
    )

    _ACTIVE_CHAT_GENERATIONS[generation_id] = state
    return state


def _close_active_generation(
    generation_id: str,
    state: ActiveChatGeneration,
) -> None:
    state.closed = True

    if _ACTIVE_CHAT_GENERATIONS.get(generation_id) is state:
        _ACTIVE_CHAT_GENERATIONS.pop(generation_id, None)


def _sse(
    event: str,
    payload: dict[str, Any],
) -> str:
    """Encode un événement SSE Oria."""
    return (
        f"event: {event}\n"
        "data: "
        + dumps(payload, ensure_ascii=False)
        + "\n\n"
    )


def _restart_message(
    *,
    original_message: str,
    modification_instructions: list[str],
) -> str:
    """
    Reconstruit la demande pour un smart restart sans créer un nouveau
    message visible dans la conversation.
    """
    if not modification_instructions:
        return original_message

    instructions = "\n\n".join(
        f"- {instruction}"
        for instruction in modification_instructions
        if instruction.strip()
    )

    if not instructions:
        return original_message

    return (
        f"{original_message}\n\n"
        "========================\n"
        "MODIFICATION EN COURS DE RÉPONSE\n"
        "========================\n"
        "L'utilisateur a modifié la réponse attendue pendant la génération. "
        "Réponds toujours à la demande originale, mais applique maintenant "
        "les instructions les plus récentes ci-dessous. "
        "Ne parle pas du redémarrage technique de la génération.\n\n"
        f"{instructions}"
    )






# ============================================================
# ARTIFACTS NATIFS — DÉTECTION / GÉNÉRATION / PERSISTANCE
# ============================================================

ARTIFACT_SERVICE = ArtifactService()
ARTIFACT_REPOSITORY = supabase_artifact_repository

MAX_ARTIFACTS_PER_TURN = 5

_ARTIFACT_FORMAT_PATTERNS: list[tuple[str, tuple[str, ...]]] = [
    ("pdf", ("pdf",)),
    ("docx", ("docx", "word", "document word")),
    ("xlsx", ("xlsx", "excel", "classeur")),
    ("pptx", ("pptx", "powerpoint", "power point", "diaporama")),
    ("odt", ("odt", "open document text")),
    ("ods", ("ods", "open document spreadsheet")),
    ("odp", ("odp", "open document presentation")),
    ("epub", ("epub", "ebook", "e-book", "livre numérique")),
    ("rtf", ("rtf",)),
    ("csv", ("csv",)),
    ("tsv", ("tsv",)),
    ("jsonl", ("jsonl", "ndjson")),
    ("json", ("json",)),
    ("sqlite", ("sqlite", "base sqlite")),
    ("zip", ("zip", "archive zip")),
    ("md", ("markdown", "fichier md", ".md")),
    ("txt", ("txt", "texte brut", "plain text")),
    ("html", ("html", "page html")),
    ("css", ("css", "feuille css")),
    ("tsx", ("tsx",)),
    ("jsx", ("jsx",)),
    ("ts", ("typescript", "fichier ts", ".ts")),
    ("js", ("javascript", "fichier js", ".js")),
    ("py", ("python", "fichier py", ".py")),
    ("sql", ("sql", "script sql")),
    ("xml", ("xml",)),
    ("yaml", ("yaml", "yml")),
    ("toml", ("toml",)),
    ("svg", ("svg",)),
    ("tex", ("latex", "fichier tex", ".tex")),
    ("ics", ("ics", "calendrier ics")),
    ("vcf", ("vcf", "vcard")),
]

_ARTIFACT_GENERATION_WORDS = (
    "crée", "cree", "créer", "creer", "génère", "genere", "générer",
    "generer", "fais", "faire", "fabrique", "prépare", "prepare",
    "produis", "exporte", "convertis", "transforme", "donne-moi",
    "donne moi", "create", "generate", "make", "build", "export",
    "convert", "save", "give me", "write",
)

_CODE_EXTENSION_BY_LANGUAGE = {
    "python": "py",
    "py": "py",
    "javascript": "js",
    "js": "js",
    "typescript": "ts",
    "ts": "ts",
    "tsx": "tsx",
    "jsx": "jsx",
    "json": "json",
    "jsonl": "jsonl",
    "sql": "sql",
    "html": "html",
    "css": "css",
    "xml": "xml",
    "yaml": "yaml",
    "yml": "yml",
    "toml": "toml",
    "bash": "sh",
    "shell": "sh",
    "sh": "sh",
    "powershell": "ps1",
    "ps1": "ps1",
    "java": "java",
    "c": "c",
    "cpp": "cpp",
    "c++": "cpp",
    "csharp": "cs",
    "cs": "cs",
    "go": "go",
    "rust": "rs",
    "rs": "rs",
    "php": "php",
    "ruby": "rb",
    "rb": "rb",
    "markdown": "md",
    "md": "md",
    "latex": "tex",
    "tex": "tex",
}


def _artifact_filename_from_message(
    message: str,
    *,
    extension: str,
    explicit_filename: str | None = None,
) -> str | None:
    """
    Résout un nom demandé explicitement.

    Le nom final est encore assaini par ArtifactService puis par le repository.
    """
    if explicit_filename and explicit_filename.strip():
        return explicit_filename.strip()

    # Cherche un nom explicite du type rapport.pdf / main.py / data.xlsx.
    match = re.search(
        rf"""(?ix)
        (?<![A-Za-z0-9_.-])
        ([A-Za-z0-9À-ÿ _().-]{{1,100}}\.{re.escape(extension)})
        (?![A-Za-z0-9_.-])
        """,
        message,
    )

    if match:
        return match.group(1).strip()

    return None


def _resolve_artifact_requests(
    *,
    message: str,
    explicit_type: str | None = None,
    explicit_filename: str | None = None,
) -> list[dict[str, str | None]]:
    """
    Détermine si le tour demande un ou plusieurs fichiers.

    Priorité :
    1. `artifact_type` fourni explicitement par le frontend ;
    2. détection prudente dans le langage naturel.

    `artifact_type` accepte aussi une liste séparée par des virgules afin que
    le frontend puisse demander PDF + DOCX dans un seul tour.
    """
    message_text = str(message or "").strip()
    lower_message = message_text.lower()

    detected_types: list[str] = []

    if explicit_type and explicit_type.strip():
        raw_types = re.split(r"[,;|]+", explicit_type)

        for raw_type in raw_types:
            normalized = raw_type.strip().lower().lstrip(".")
            normalized = ArtifactService.TYPE_ALIASES.get(
                normalized,
                normalized,
            )

            if normalized and normalized not in detected_types:
                detected_types.append(normalized)
    else:
        # Évite de générer un fichier simplement parce que l'utilisateur parle
        # du concept PDF/Excel. Il faut aussi une intention de création/export.
        has_generation_intent = any(
            word in lower_message
            for word in _ARTIFACT_GENERATION_WORDS
        )

        # Quelques formulations sont naturellement des demandes de fichier.
        has_file_intent = (
            "fichier" in lower_message
            or "file" in lower_message
            or "document" in lower_message
            or "présentation" in lower_message
            or "presentation" in lower_message
            or "tableur" in lower_message
            or "spreadsheet" in lower_message
            or "archive" in lower_message
        )

        if has_generation_intent or has_file_intent:
            for extension, keywords in _ARTIFACT_FORMAT_PATTERNS:
                if any(keyword in lower_message for keyword in keywords):
                    if extension not in detected_types:
                        detected_types.append(extension)

    if not detected_types:
        return []

    requests: list[dict[str, str | None]] = []

    for extension in detected_types[:MAX_ARTIFACTS_PER_TURN]:
        filename = _artifact_filename_from_message(
            message_text,
            extension=extension,
            explicit_filename=(
                explicit_filename
                if len(detected_types) == 1
                else None
            ),
        )

        # Si plusieurs formats sont demandés avec un nom fourni explicitement,
        # réutiliser le même stem et adapter l'extension.
        if (
            explicit_filename
            and len(detected_types) > 1
            and explicit_filename.strip()
        ):
            raw_name = explicit_filename.strip()
            stem = re.sub(
                r"\.[A-Za-z0-9]{1,12}$",
                "",
                raw_name,
            )
            filename = f"{stem}.{extension}"

        requests.append(
            {
                "file_type": extension,
                "filename": filename,
            }
        )

    return requests


def _strip_outer_code_fence(
    value: str,
) -> str:
    text = str(value or "").strip()

    match = re.fullmatch(
        r"```[A-Za-z0-9_+.-]*\s*\n?(.*?)\n?```",
        text,
        flags=re.DOTALL,
    )

    if match:
        return match.group(1).strip()

    return text


def _try_json_payload(
    value: str,
) -> Any | None:
    candidate = _strip_outer_code_fence(value)

    try:
        import json
        return json.loads(candidate)
    except Exception:
        return None


def _markdown_table_rows(
    value: str,
) -> list[list[str]] | None:
    """
    Extrait le premier tableau Markdown afin que XLSX/CSV/ODS deviennent
    immédiatement exploitables au lieu d'avoir tout le texte dans une cellule.
    """
    raw_lines = [
        line.strip()
        for line in str(value or "").splitlines()
    ]

    for index in range(len(raw_lines) - 1):
        header = raw_lines[index]
        separator = raw_lines[index + 1]

        if "|" not in header or "|" not in separator:
            continue

        separator_cells = [
            cell.strip()
            for cell in separator.strip("|").split("|")
        ]

        if not separator_cells:
            continue

        if not all(
            re.fullmatch(r":?-{3,}:?", cell or "") is not None
            for cell in separator_cells
        ):
            continue

        rows: list[list[str]] = [
            [
                cell.strip()
                for cell in header.strip("|").split("|")
            ]
        ]

        cursor = index + 2

        while cursor < len(raw_lines):
            line = raw_lines[cursor]

            if "|" not in line or not line:
                break

            rows.append(
                [
                    cell.strip()
                    for cell in line.strip("|").split("|")
                ]
            )
            cursor += 1

        return rows

    return None


def _zip_content_from_response(
    response_text: str,
) -> dict[str, Any]:
    """
    Transforme des blocs de code Markdown en fichiers d'une archive ZIP.

    Si la réponse n'est pas structurée en plusieurs fichiers, l'archive contient
    simplement `README.md` avec la réponse complète.
    """
    files: list[dict[str, Any]] = []
    text_value = str(response_text or "")

    pattern = re.compile(
        r"""(?ms)
        (?:
            ^\s*\#{1,6}\s+
            (?P<heading>[^\n`]+?\.[A-Za-z0-9_+-]{1,12})
            \s*\n
        )?
        ^```(?P<language>[A-Za-z0-9_+.-]*)[^\n]*\n
        (?P<code>.*?)
        ^```\s*$
        """,
        re.VERBOSE,
    )

    for index, match in enumerate(pattern.finditer(text_value), start=1):
        heading = (match.group("heading") or "").strip()
        language = (match.group("language") or "").strip().lower()
        code = match.group("code")

        if heading:
            filename = heading.split("/")[-1].strip()
            extension = filename.rsplit(".", 1)[-1].lower()
        else:
            extension = _CODE_EXTENSION_BY_LANGUAGE.get(
                language,
                "txt",
            )
            filename = f"fichier-{index}.{extension}"

        files.append(
            {
                "name": filename,
                "file_type": extension,
                "content": code,
            }
        )

    if not files:
        files.append(
            {
                "name": "README.md",
                "file_type": "md",
                "content": text_value,
            }
        )

    return {"files": files[:ArtifactService.MAX_ARCHIVE_FILES]}


def _artifact_content_from_response(
    *,
    file_type: str,
    response_text: str,
) -> Any:
    """
    Adapte la réponse finale au format demandé sans nouvel appel IA.

    Le coût utilisateur reste donc le coût du tour Chat déjà calculé.
    """
    normalized_type = str(file_type).lower().lstrip(".")
    cleaned = _strip_outer_code_fence(response_text)

    if normalized_type in {"xlsx", "ods", "csv", "tsv"}:
        json_payload = _try_json_payload(cleaned)

        if isinstance(json_payload, (list, dict)):
            return json_payload

        table_rows = _markdown_table_rows(cleaned)

        if table_rows:
            return table_rows

        return [
            [line]
            for line in cleaned.splitlines()
            if line.strip()
        ] or [[""]]

    if normalized_type in {"json", "jsonl", "ndjson"}:
        json_payload = _try_json_payload(cleaned)

        if json_payload is not None:
            return json_payload

        return {"content": cleaned}

    if normalized_type == "sqlite":
        json_payload = _try_json_payload(cleaned)

        if isinstance(json_payload, list):
            if all(isinstance(row, dict) for row in json_payload):
                return json_payload

        if isinstance(json_payload, dict):
            if "tables" in json_payload:
                return json_payload
            return [json_payload]

        return [{"content": cleaned}]

    if normalized_type == "zip":
        return _zip_content_from_response(cleaned)

    return cleaned


def _artifact_public_payload(
    artifact: dict[str, Any],
) -> dict[str, Any]:
    """Réduit les métadonnées à ce qui doit être envoyé au frontend."""
    return {
        "id": artifact.get("id"),
        "artifact_id": artifact.get("id"),
        "filename": artifact.get("filename"),
        "extension": artifact.get("extension"),
        "mime_type": artifact.get("mime_type"),
        "category": artifact.get("category"),
        "size_bytes": artifact.get("size_bytes"),
        "sha256": artifact.get("sha256"),
        "conversation_id": artifact.get("conversation_id"),
        "source_message_id": artifact.get("source_message_id"),
        "download_url": artifact.get("download_url"),
        "url": artifact.get("download_url") or artifact.get("url"),
        "created_at": artifact.get("created_at"),
    }


def _create_and_persist_artifact(
    *,
    authenticated_user_id: str,
    artifact_request: dict[str, str | None],
    response_text: str,
    conversation_id: str | None,
    source_message_id: str | None,
    model: str,
    openai_model: str,
    generation_id: str | None,
    attempt_id: str | None,
    reasoning_mode: str,
) -> dict[str, Any]:
    """Fabrique puis persiste un artifact privé dans Supabase."""
    file_type = str(
        artifact_request.get("file_type") or ""
    ).strip()

    filename = artifact_request.get("filename")

    content = _artifact_content_from_response(
        file_type=file_type,
        response_text=response_text,
    )

    generated = ARTIFACT_SERVICE.create(
        file_type=file_type,
        content=content,
        filename=filename,
        metadata={
            "source": "oria-chat",
            "generation_id": generation_id,
            "attempt_id": attempt_id,
            "reasoning_mode": reasoning_mode,
            "oria_model": model,
            "openai_model": openai_model,
        },
    )

    persisted = ARTIFACT_REPOSITORY.save_artifact(
        user_id=authenticated_user_id,
        artifact_id=generated.artifact_id,
        filename=generated.filename,
        extension=generated.extension,
        mime_type=generated.mime_type,
        category=generated.category,
        file_bytes=generated.data,
        size_bytes=generated.size_bytes,
        sha256=generated.sha256,
        conversation_id=conversation_id,
        model=model,
        source_message_id=source_message_id,
        metadata=generated.metadata,
    )

    return _artifact_public_payload(persisted)


# ============================================================
# ENDPOINTS ARTIFACTS
# ============================================================


@router.get("/artifact-capabilities")
def get_artifact_capabilities(
    user_id: str | None = Header(default=None, alias="user-id"),
    authorization: str | None = Header(default=None, alias="authorization"),
):
    """Retourne les formats de fichiers que le backend Oria sait fabriquer."""
    _authenticate_chat_user(
        user_id=user_id,
        authorization=authorization,
    )

    return {
        "success": True,
        "private_storage": True,
        "max_artifacts_per_turn": MAX_ARTIFACTS_PER_TURN,
        "max_file_size_bytes": ArtifactService.MAX_ARTIFACT_BYTES,
        "formats": ARTIFACT_SERVICE.supported_types(),
    }


@router.get("/artifacts")
def list_user_artifacts(
    conversation_id: str | None = None,
    category: str | None = None,
    extension: str | None = None,
    limit: int = 50,
    offset: int = 0,
    include_urls: bool = False,
    user_id: str | None = Header(default=None, alias="user-id"),
    authorization: str | None = Header(default=None, alias="authorization"),
):
    """Liste les fichiers générés appartenant à l'utilisateur courant."""
    authenticated_user_id = _authenticate_chat_user(
        user_id=user_id,
        authorization=authorization,
    )

    artifacts = ARTIFACT_REPOSITORY.list_artifacts(
        user_id=authenticated_user_id,
        conversation_id=conversation_id,
        category=category,
        extension=extension,
        limit=limit,
        offset=offset,
        include_urls=include_urls,
    )

    return {
        "success": True,
        "artifacts": [
            _artifact_public_payload(item)
            for item in artifacts
        ],
    }


@router.get("/artifacts/{artifact_id}")
def get_user_artifact(
    artifact_id: str,
    user_id: str | None = Header(default=None, alias="user-id"),
    authorization: str | None = Header(default=None, alias="authorization"),
):
    """Retourne un fichier avec une nouvelle URL signée de téléchargement."""
    authenticated_user_id = _authenticate_chat_user(
        user_id=user_id,
        authorization=authorization,
    )

    artifact = ARTIFACT_REPOSITORY.get_artifact_with_url(
        artifact_id=artifact_id,
        user_id=authenticated_user_id,
    )

    if artifact is None:
        raise HTTPException(
            status_code=404,
            detail="Fichier généré introuvable.",
        )

    return {
        "success": True,
        "artifact": _artifact_public_payload(artifact),
    }


@router.delete("/artifacts/{artifact_id}")
def delete_user_artifact(
    artifact_id: str,
    user_id: str | None = Header(default=None, alias="user-id"),
    authorization: str | None = Header(default=None, alias="authorization"),
):
    """Supprime définitivement un fichier généré appartenant à l'utilisateur."""
    authenticated_user_id = _authenticate_chat_user(
        user_id=user_id,
        authorization=authorization,
    )

    deleted = ARTIFACT_REPOSITORY.delete_artifact(
        artifact_id=artifact_id,
        user_id=authenticated_user_id,
    )

    if not deleted:
        raise HTTPException(
            status_code=404,
            detail="Fichier généré introuvable.",
        )

    return {
        "success": True,
        "artifact_id": artifact_id,
        "deleted": True,
    }


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



    # Le pack peut rester lié au portefeuille après expiration.
    # Dans ce cas, aucune création ne doit être annoncée comme disponible.
    # On conserve le pack_id pour que les frontends affichent le bon état.
    if not wallet.is_pack_active:
        return {
            "success": True,
            "user_id": authenticated_user_id,
            "pack_id": wallet.pack_id,
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
    reasoning_mode: str = Form("balanced"),
    artifact_type: str | None = Form(default=None),
    artifact_filename: str | None = Form(default=None),
    source_message_id: str | None = Form(default=None),
    files: list[UploadFile] = File(default=[]),
    user_id: str | None = Header(default=None, alias="user-id"),
    authorization: str | None = Header(default=None, alias="authorization"),
):
    reasoning_mode = _normalize_reasoning_mode(reasoning_mode)
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

    artifact_requests = _resolve_artifact_requests(
        message=message,
        explicit_type=artifact_type,
        explicit_filename=artifact_filename,
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
            reasoning_mode=reasoning_mode,
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

    generated_artifacts: list[dict[str, Any]] = []
    artifact_errors: list[str] = []

    for artifact_request in artifact_requests:
        try:
            generated_artifacts.append(
                _create_and_persist_artifact(
                    authenticated_user_id=authenticated_user_id,
                    artifact_request=artifact_request,
                    response_text=response_text,
                    conversation_id=conversation_id,
                    source_message_id=source_message_id,
                    model=model,
                    openai_model=MODEL_OPENAI_IDS[model],
                    generation_id=None,
                    attempt_id=None,
                    reasoning_mode=reasoning_mode,
                )
            )
        except Exception as error:
            artifact_errors.append(str(error))

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
        artifacts=generated_artifacts or None,
        artifact_errors=artifact_errors or None,
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
# POST /ai/chat/control
# ============================================================


@router.post("/chat/control")
async def control_chat_generation(
    payload: ChatControlRequest,
    user_id: str | None = Header(default=None, alias="user-id"),
    authorization: str | None = Header(default=None, alias="authorization"),
):
    """
    Modifie une génération déjà active.

    - changement d'instruction sur GPT-6 + WebSocket : mid-turn steering ;
    - changement de reasoning : smart restart ;
    - modèle sans steering : smart restart.

    Le contrôle n'est activé que lorsque le transport Responses WebSocket
    est disponible. Le streaming HTTP classique reste un fallback sûr.
    """
    authenticated_user_id = _authenticate_chat_user(
        user_id=user_id,
        authorization=authorization,
    )

    generation_id = _normalize_generation_id(payload.generation_id)
    state = _ACTIVE_CHAT_GENERATIONS.get(generation_id)

    if state is None or state.closed:
        raise HTTPException(
            status_code=404,
            detail="Cette génération n'est plus active.",
        )

    if state.user_id != authenticated_user_id:
        raise HTTPException(
            status_code=403,
            detail="Cette génération appartient à un autre utilisateur.",
        )

    instruction = str(payload.instruction or "").strip()

    if len(instruction) > MAX_CONTROL_INSTRUCTION_CHARS:
        raise HTTPException(
            status_code=400,
            detail=(
                "L'instruction de modification est trop longue "
                f"(maximum {MAX_CONTROL_INSTRUCTION_CHARS} caractères)."
            ),
        )

    requested_reasoning = (
        _normalize_reasoning_mode(payload.reasoning_mode)
        if payload.reasoning_mode
        else None
    )

    reasoning_changed = bool(
        requested_reasoning
        and requested_reasoning != state.reasoning_mode
    )
    instruction_changed = bool(instruction)

    if not reasoning_changed and not instruction_changed:
        return {
            "success": True,
            "accepted": False,
            "generation_id": generation_id,
            "strategy": "none",
            "reasoning_mode": state.reasoning_mode,
        }

    # Le contrôle bidirectionnel pendant une réponse nécessite Responses
    # WebSocket. Avec l'ancien SDK, le chat continue normalement en HTTP.
    if state.transport != "websocket":
        raise HTTPException(
            status_code=409,
            detail=(
                "La modification en cours de génération nécessite "
                "Responses WebSocket sur le backend. "
                "Le streaming HTTP actuel reste actif."
            ),
        )

    openai_service = OpenAIService()
    strategy = openai_service.resolve_modification_strategy(
        model=state.openai_model,
        instruction_changed=instruction_changed,
        reasoning_changed=reasoning_changed,
    )

    command = {
        "type": "modify",
        "instruction": instruction,
        "reasoning_mode": requested_reasoning,
    }

    try:
        state.control_queue.put_nowait(command)
    except asyncio.QueueFull as error:
        raise HTTPException(
            status_code=429,
            detail=(
                "Trop de modifications sont déjà en attente. "
                "Attendez qu'Oria applique la précédente."
            ),
        ) from error

    return {
        "success": True,
        "accepted": True,
        "generation_id": generation_id,
        "attempt_id": state.active_attempt_id,
        "strategy": strategy,
        "reasoning_mode": (
            requested_reasoning or state.reasoning_mode
        ),
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
    reasoning_mode: str = Form("balanced"),
    generation_id: str | None = Form(default=None),
    artifact_type: str | None = Form(default=None),
    artifact_filename: str | None = Form(default=None),
    source_message_id: str | None = Form(default=None),
    files: list[UploadFile] = File(default=[]),
    user_id: str | None = Header(default=None, alias="user-id"),
    authorization: str | None = Header(default=None, alias="authorization"),
):
    """
    Streaming Chat Oria V2.

    Contrat principal :
    - reasoning_mode : fast | balanced | deep ;
    - generation_id : identifiant stable du tour ;
    - attempt_id : identifiant de chaque tentative OpenAI ;
    - GPT-6 + WebSocket : steering sans redémarrage ;
    - changement de reasoning / steering impossible : smart restart ;
    - une seule réservation Oria est conservée pour le tour logique.
    """
    route_started_at = perf_counter()

    reasoning_mode = _normalize_reasoning_mode(reasoning_mode)
    generation_id = _normalize_generation_id(generation_id)

    attachments_started_at = perf_counter()
    attachments = await _build_attachments(files)
    attachments_ms = (perf_counter() - attachments_started_at) * 1000

    prepare_started_at = perf_counter()

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

    artifact_requests = _resolve_artifact_requests(
        message=message,
        explicit_type=artifact_type,
        explicit_filename=artifact_filename,
    )

    prepare_ms = (perf_counter() - prepare_started_at) * 1000

    reserve_started_at = perf_counter()

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

    reserve_ms = (perf_counter() - reserve_started_at) * 1000

    openai_service = OpenAIService()
    openai_attachments = _attachments_for_openai(attachments)
    openai_model = MODEL_OPENAI_IDS[model]

    websocket_available = (
        openai_service.supports_responses_websocket()
    )
    transport = (
        "websocket"
        if websocket_available
        else "http"
    )

    try:
        generation_state = _register_active_generation(
            generation_id=generation_id,
            user_id=authenticated_user_id,
            model=model,
            openai_model=openai_model,
            reasoning_mode=reasoning_mode,
            transport=transport,
        )
    except Exception:
        # La réservation a déjà été créée : si l'enregistrement local échoue
        # avant tout appel OpenAI, elle doit être rendue.
        try:
            _release_chat_reservation(
                repository=repository,
                authenticated_user_id=authenticated_user_id,
                reservation_id=reservation_id,
            )
        except Exception:
            pass
        raise

    async def event_stream():
        full_response = ""
        final_usage = None
        final_web_search_calls = None
        final_openai_timing: dict[str, Any] = {}
        settled = False
        first_delta_server_ms: float | None = None

        current_reasoning_mode = reasoning_mode
        original_message = message
        modification_instructions: list[str] = []

        restart_count = 0
        attempt_number = 1
        attempt_id = str(uuid4())

        try:
            generation_state.active_attempt_id = attempt_id

            yield _sse(
                "start",
                {
                    "success": True,
                    "model": model,
                    "openai_model": openai_model,
                    "web": web,
                    "attachments": len(openai_attachments),
                    "generation_id": generation_id,
                    "attempt_id": attempt_id,
                    "reasoning_mode": current_reasoning_mode,
                    "reservation_id": reservation_id,
                    "reserved_credits": reserved_amount,
                    "transport": transport,
                    "live_modify": websocket_available,
                    "artifact_requests": artifact_requests,
                    "timing": {
                        "attachments_ms": attachments_ms,
                        "prepare_chat_ms": prepare_ms,
                        "reserve_credits_ms": reserve_ms,
                        "backend_pre_stream_ms": (
                            perf_counter() - route_started_at
                        ) * 1000,
                    },
                },
            )

            while True:
                generation_state.reasoning_mode = current_reasoning_mode
                generation_state.active_attempt_id = attempt_id

                attempt_message = _restart_message(
                    original_message=original_message,
                    modification_instructions=modification_instructions,
                )

                restart_request: dict[str, Any] | None = None
                final_usage = None
                final_web_search_calls = None
                final_openai_timing = {}

                if websocket_available:
                    stream_result = openai_service.chat_stream_websocket(
                        model=openai_model,
                        message=attempt_message,
                        web=web,
                        attachments=openai_attachments,
                        history=history,
                        reasoning_mode=current_reasoning_mode,
                        generation_id=attempt_id,
                        control_queue=generation_state.control_queue,
                    )

                    try:
                        async for item in stream_result:
                            if item is None:
                                continue

                            payload = _as_mapping(item)
                            if payload is None:
                                continue

                            item_type = str(
                                payload.get("type") or ""
                            ).strip()

                            if item_type == "delta":
                                delta = str(
                                    payload.get("content") or ""
                                )

                                if not delta:
                                    continue

                                if first_delta_server_ms is None:
                                    first_delta_server_ms = (
                                        perf_counter() - route_started_at
                                    ) * 1000

                                full_response += delta

                                yield _sse(
                                    "delta",
                                    {
                                        "content": delta,
                                        "generation_id": generation_id,
                                        "attempt_id": attempt_id,
                                        "response_id": payload.get(
                                            "response_id"
                                        ),
                                    },
                                )
                                continue

                            if item_type == "usage":
                                final_usage = payload.get("usage")
                                final_web_search_calls = payload.get(
                                    "web_search_calls"
                                )
                                final_openai_timing = (
                                    payload.get("timing")
                                    if isinstance(
                                        payload.get("timing"),
                                        dict,
                                    )
                                    else {}
                                )
                                continue

                            if item_type == "restart_required":
                                if restart_count >= MAX_SMART_RESTARTS:
                                    yield _sse(
                                        "modify_rejected",
                                        {
                                            "generation_id": generation_id,
                                            "attempt_id": attempt_id,
                                            "reason": "restart_limit_reached",
                                            "detail": (
                                                "La limite de redémarrages "
                                                "de cette réponse est atteinte."
                                            ),
                                        },
                                    )
                                    # On laisse la génération actuelle continuer.
                                    continue

                                restart_request = payload
                                break

                            if item_type in {
                                "response_meta",
                                "steer_sent",
                                "steer_accepted",
                                "steer_boundary",
                                "control_error",
                            }:
                                forwarded = dict(payload)
                                forwarded["generation_id"] = generation_id
                                forwarded["attempt_id"] = attempt_id

                                yield _sse(
                                    item_type,
                                    forwarded,
                                )
                                continue

                    finally:
                        # En cas de smart restart, fermer explicitement l'ancien
                        # flux WebSocket afin qu'aucun delta tardif ne se mélange
                        # avec la nouvelle tentative.
                        if restart_request is not None:
                            try:
                                await stream_result.aclose()
                            except Exception:
                                pass

                else:
                    # Fallback sûr : streaming HTTP historique.
                    # Le chat reste utilisable si le SDK WebSocket n'est pas
                    # encore installé, mais le bouton Modifier en cours de
                    # génération est désactivé par /chat/control.
                    stream_result = openai_service.chat_stream(
                        model=openai_model,
                        message=attempt_message,
                        web=web,
                        attachments=openai_attachments,
                        history=history,
                        reasoning_mode=current_reasoning_mode,
                        generation_id=attempt_id,
                    )

                    for item in stream_result:
                        if item is None:
                            continue

                        payload = _as_mapping(item)

                        if payload is None:
                            # Compatibilité avec une ancienne implémentation.
                            delta, usage, web_search_calls = _parse_stream_item(
                                item
                            )

                            if usage is not None:
                                final_usage = usage

                            if web_search_calls is not None:
                                final_web_search_calls = web_search_calls

                            if delta:
                                if first_delta_server_ms is None:
                                    first_delta_server_ms = (
                                        perf_counter() - route_started_at
                                    ) * 1000

                                full_response += delta
                                yield _sse(
                                    "delta",
                                    {
                                        "content": delta,
                                        "generation_id": generation_id,
                                        "attempt_id": attempt_id,
                                    },
                                )

                            continue

                        item_type = str(
                            payload.get("type") or ""
                        ).strip()

                        if item_type == "delta":
                            delta = str(
                                payload.get("content") or ""
                            )

                            if not delta:
                                continue

                            if first_delta_server_ms is None:
                                first_delta_server_ms = (
                                    perf_counter() - route_started_at
                                ) * 1000

                            full_response += delta

                            yield _sse(
                                "delta",
                                {
                                    "content": delta,
                                    "generation_id": generation_id,
                                    "attempt_id": attempt_id,
                                    "response_id": payload.get(
                                        "response_id"
                                    ),
                                },
                            )
                            continue

                        if item_type == "usage":
                            final_usage = payload.get("usage")
                            final_web_search_calls = payload.get(
                                "web_search_calls"
                            )
                            final_openai_timing = (
                                payload.get("timing")
                                if isinstance(
                                    payload.get("timing"),
                                    dict,
                                )
                                else {}
                            )
                            continue

                        if item_type == "response_meta":
                            forwarded = dict(payload)
                            forwarded["generation_id"] = generation_id
                            forwarded["attempt_id"] = attempt_id
                            yield _sse("response_meta", forwarded)

                # ----------------------------------------------------
                # SMART RESTART
                # ----------------------------------------------------
                if restart_request is not None:
                    restart_count += 1

                    requested_mode = restart_request.get(
                        "reasoning_mode"
                    )
                    if requested_mode:
                        current_reasoning_mode = (
                            _normalize_reasoning_mode(
                                str(requested_mode)
                            )
                        )

                    instruction = str(
                        restart_request.get("instruction") or ""
                    ).strip()

                    if instruction:
                        modification_instructions.append(instruction)

                    old_attempt_id = attempt_id
                    attempt_number += 1
                    attempt_id = str(uuid4())

                    # La réponse visible doit repartir proprement dans la même
                    # bulle. Le frontend videra uniquement le contenu assistant,
                    # jamais le message utilisateur.
                    full_response = ""
                    first_delta_server_ms = None

                    generation_state.reasoning_mode = (
                        current_reasoning_mode
                    )
                    generation_state.active_attempt_id = attempt_id

                    yield _sse(
                        "generation_restarted",
                        {
                            "generation_id": generation_id,
                            "old_attempt_id": old_attempt_id,
                            "attempt_id": attempt_id,
                            "attempt_number": attempt_number,
                            "reasoning_mode": current_reasoning_mode,
                            "reason": restart_request.get("reason"),
                            "replace_content": True,
                        },
                    )
                    continue

                break

            # --------------------------------------------------------
            # VALIDATION DE LA RÉPONSE FINALE
            # --------------------------------------------------------
            if not full_response.strip():
                try:
                    _release_chat_reservation(
                        repository=repository,
                        authenticated_user_id=authenticated_user_id,
                        reservation_id=reservation_id,
                    )
                except Exception:
                    pass

                yield _sse(
                    "error",
                    {
                        "detail": (
                            "Le service IA n'a retourné aucun contenu."
                        ),
                        "generation_id": generation_id,
                        "attempt_id": attempt_id,
                    },
                )
                return

            if final_usage is None:
                yield _sse(
                    "error",
                    {
                        "detail": (
                            "La réponse a été générée mais l'usage OpenAI "
                            "final n'a pas été fourni."
                        ),
                        "generation_id": generation_id,
                        "attempt_id": attempt_id,
                    },
                )
                return

            if web and final_web_search_calls is None:
                yield _sse(
                    "error",
                    {
                        "detail": (
                            "La réponse Web a été générée mais le nombre réel "
                            "de recherches Web n'a pas été fourni."
                        ),
                        "generation_id": generation_id,
                        "attempt_id": attempt_id,
                    },
                )
                return

            try:
                cost = _calculate_real_chat_cost(
                    model=model,
                    usage=final_usage,
                    web_search_calls=(final_web_search_calls or 0),
                )
            except RuntimeError as error:
                yield _sse(
                    "error",
                    {
                        "detail": str(error),
                        "generation_id": generation_id,
                        "attempt_id": attempt_id,
                    },
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
                yield _sse(
                    "error",
                    {
                        "detail": (
                            "La réponse IA a été générée mais le settlement "
                            f"des crédits a échoué : {error}"
                        ),
                        "generation_id": generation_id,
                        "attempt_id": attempt_id,
                    },
                )
                return

            generated_artifacts: list[dict[str, Any]] = []
            artifact_errors: list[str] = []

            for artifact_request in artifact_requests:
                file_type = str(
                    artifact_request.get("file_type") or ""
                )

                yield _sse(
                    "artifact_processing",
                    {
                        "generation_id": generation_id,
                        "attempt_id": attempt_id,
                        "file_type": file_type,
                        "filename": artifact_request.get("filename"),
                    },
                )

                try:
                    artifact_payload = _create_and_persist_artifact(
                        authenticated_user_id=authenticated_user_id,
                        artifact_request=artifact_request,
                        response_text=full_response,
                        conversation_id=conversation_id,
                        source_message_id=source_message_id,
                        model=model,
                        openai_model=openai_model,
                        generation_id=generation_id,
                        attempt_id=attempt_id,
                        reasoning_mode=current_reasoning_mode,
                    )

                    generated_artifacts.append(artifact_payload)

                    yield _sse(
                        "artifact",
                        {
                            **artifact_payload,
                            "generation_id": generation_id,
                            "attempt_id": attempt_id,
                        },
                    )

                except Exception as error:
                    detail = str(error)
                    artifact_errors.append(detail)

                    yield _sse(
                        "artifact_error",
                        {
                            "generation_id": generation_id,
                            "attempt_id": attempt_id,
                            "file_type": file_type,
                            "detail": detail,
                        },
                    )

            yield _sse(
                "done",
                {
                    "success": True,
                    "model": model,
                    "openai_model": openai_model,
                    "action": result.action.value,
                    "cost": result.cost,
                    "previous_balance": result.previous_balance,
                    "credits_remaining": result.new_balance,
                    "consumed_percentage": result.consumed_percentage,
                    "remaining_percentage": result.remaining_percentage,
                    "requires_warning": result.requires_warning,
                    "requires_critical_warning": (
                        result.requires_critical_warning
                    ),
                    "trial": is_trial_model,
                    "trials_remaining": trials_remaining,
                    "generation_id": generation_id,
                    "attempt_id": attempt_id,
                    "attempts": attempt_number,
                    "smart_restarts": restart_count,
                    "reasoning_mode": current_reasoning_mode,
                    "transport": transport,
                    "artifacts": generated_artifacts,
                    "artifact_errors": artifact_errors,
                    "timing": {
                        **final_openai_timing,
                        "first_delta_server_ms": first_delta_server_ms,
                        "server_total_ms": (
                            perf_counter() - route_started_at
                        ) * 1000,
                        "attachments_ms": attachments_ms,
                        "prepare_chat_ms": prepare_ms,
                        "reserve_credits_ms": reserve_ms,
                    },
                },
            )

        except asyncio.CancelledError:
            # Le client a fermé le flux. Si aucun contenu n'a été produit,
            # rendre la réservation ; sinon ne pas rembourser aveuglément
            # une consommation fournisseur potentiellement engagée.
            if not settled and not full_response.strip():
                try:
                    _release_chat_reservation(
                        repository=repository,
                        authenticated_user_id=authenticated_user_id,
                        reservation_id=reservation_id,
                    )
                except Exception:
                    pass
            raise

        except Exception as error:
            if not settled and not full_response.strip():
                try:
                    _release_chat_reservation(
                        repository=repository,
                        authenticated_user_id=authenticated_user_id,
                        reservation_id=reservation_id,
                    )
                except Exception:
                    pass

            yield _sse(
                "error",
                {
                    "detail": (
                        f"Erreur pendant le streaming IA : {error}"
                    ),
                    "generation_id": generation_id,
                    "attempt_id": attempt_id,
                },
            )

        finally:
            _close_active_generation(
                generation_id,
                generation_state,
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

