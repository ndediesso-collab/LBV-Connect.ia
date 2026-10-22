"""Routes HTTP privees d'ORIA Cours.

Destination : Backend/app/routes/courses.py (ou app/route selon le projet).
Enregistrer ``router`` dans l'application FastAPI; prefix HTTP ``/courses``.

La creation, l'envoi, la soumission, le devis et les lectures ne declenchent
aucun appel fournisseur. La confirmation reserve les fonds SEULEMENT si un
ordonnanceur durable est raccorde, avant de lui soumettre l'identifiant du
cours. Aucun travail long n'est lance en requete HTTP/BackgroundTasks.

Securite : authentification Supabase verifiee et propriete de chaque objet ;
le client ne choisit ni user_id interne, ni prix, ni modele de transcription.
Les plans/devis prives et les textes de transcription restent cote serveur.
"""
from __future__ import annotations

import base64
import binascii
from dataclasses import asdict, dataclass
from datetime import datetime, timedelta, timezone
import hashlib
import hmac
import json
import logging
import os
from typing import Any, Callable
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, File, Header, HTTPException, UploadFile
from starlette.concurrency import run_in_threadpool
from pydantic import BaseModel, ConfigDict, Field

from app.core.supabase import supabase
from app.config.credit_costs import available_course_writing_models
from app.repositories.supabase_audio_repository import (
    CourseStorageConflict,
    CourseStorageError,
    SupabaseCourseAudioRepository,
)
from app.repositories.supabase_credit_repository import (
    ApiBudgetConfigurationError,
    InsufficientCreditsForActionError,
    SupabaseCreditRepository,
)
from app.repositories.supabase_course_job_repository import (
    CourseJobConflict,
    CourseJobLeaseError,
    CourseJobNeedsReconciliation,
    CourseJobStoreError,
    SupabaseCourseJobRepository,
)
from app.repositories.supabase_artifact_repository import supabase_artifact_repository
from app.services.audio_service import AudioInvalid, CourseAudioPolicy
from app.services.course_service import (
    CourseInvalid,
    CourseInsufficientCredits,
    CourseNeedsReconciliation,
    CoursePlan,
    CourseService,
    CourseUnavailable,
)

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/courses", tags=["ORIA Cours"])
QUOTE_TTL_SECONDS = 15 * 60


class CreateCourseBody(BaseModel):
    model_config = ConfigDict(extra="forbid")
    title: str = Field(min_length=1, max_length=160)
    document_format: str = "pdf"
    course_id: UUID | None = None  # facultatif pour retry idempotent du client


class QuoteBody(BaseModel):
    model_config = ConfigDict(extra="forbid")
    writing_model: str = Field(min_length=1, max_length=80)


class ConfirmBody(BaseModel):
    model_config = ConfigDict(extra="forbid")
    quote_token: str = Field(min_length=40, max_length=4096)
    approved: bool


@dataclass
class CourseDependencies:
    audio: Any
    jobs: Any
    service: Any
    artifacts: Any


def _get_components() -> CourseDependencies:
    # Toutes les operations de donnees doivent utiliser un client serveur
    # privilege, jamais une session ouverte par le navigateur.
    audio = SupabaseCourseAudioRepository(supabase)
    jobs = SupabaseCourseJobRepository(supabase)
    credits = SupabaseCreditRepository(supabase)
    service = CourseService(
        course_repository=audio, job_store=jobs,
        credit_repository=credits, openai_service=None,
    )  # Pas de client OpenAI sur les routes de controle.
    return CourseDependencies(audio, jobs, service, supabase_artifact_repository)


def _authenticated_user(
    user_id: str | None = Header(default=None, alias="user-id"),
    authorization: str | None = Header(default=None, alias="authorization"),
) -> str:
    """Meme contrat de headers que ai.py, sans importer ses routes lourdes."""
    if not user_id or not authorization:
        raise HTTPException(401, "Headers user-id et authorization requis.")
    parts = authorization.strip().split(None, 1)
    if len(parts) != 2 or parts[0].lower() != "bearer" or not parts[1].strip():
        raise HTTPException(401, "Token Bearer Supabase requis.")
    try:
        uid = str(UUID(user_id))
    except (TypeError, ValueError, AttributeError):
        raise HTTPException(401, "Identifiant utilisateur invalide.") from None
    try:
        result = supabase.auth.get_user(parts[1].strip())
        owner = getattr(result, "user", None)
        auth_uid = str(UUID(str(owner.id))) if owner is not None else None
    except Exception:
        raise HTTPException(401, "Session Supabase invalide ou expiree.") from None
    if not auth_uid:
        raise HTTPException(401, "Utilisateur non authentifie.")
    if auth_uid != uid:
        raise HTTPException(403, "Ce compte ne correspond pas a la session.")
    return uid


def _course_id(value: str) -> str:
    try:
        return str(UUID(value))
    except (TypeError, ValueError, AttributeError):
        raise HTTPException(422, "Identifiant du cours invalide.") from None


def _owned_course(deps: CourseDependencies, uid: str, cid: str) -> dict[str, Any]:
    record = deps.audio.get_course(user_id=uid, course_id=cid)
    if not isinstance(record, dict) or str(record.get("user_id")) != uid or str(record.get("id")) != cid:
        raise HTTPException(404, "Cours introuvable.")
    return record


def _public_course(record: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": str(record["id"]), "title": str(record.get("title") or ""),
        "document_format": record.get("document_format"),
        "status": record.get("status"),
        "submitted_at": record.get("submitted_at"),
        "submitted_segment_count": record.get("submitted_segment_count"),
        "submitted_duration_ms": record.get("submitted_duration_ms"),
    }


def _public_segment(row: dict[str, Any]) -> dict[str, Any]:
    # Ne jamais retourner storage_path, hash de contenu ou octets audio.
    return {"index": row["segment_index"], "duration_ms": row["duration_ms"],
            "size_bytes": row["size_bytes"], "mime_type": row["mime_type"]}


def _quote_key() -> bytes:
    value = os.environ.get("ORIA_COURSE_QUOTE_SIGNING_KEY", "").strip()
    if len(value.encode("utf-8")) < 32:
        raise HTTPException(503, "Signature des devis ORIA Cours non configuree.")
    return value.encode("utf-8")


def _plan_hash(plan: CoursePlan) -> str:
    normalized = json.dumps(asdict(plan), sort_keys=True, ensure_ascii=False,
                            separators=(",", ":"))
    return hashlib.sha256(normalized.encode("utf-8")).hexdigest()


def _b64_encode(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).decode("ascii").rstrip("=")


def _b64_decode(value: str) -> bytes:
    if not value or len(value) > 3500 or any(c not in "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_" for c in value):
        raise ValueError("Jeton de devis invalide.")
    return base64.urlsafe_b64decode(value + "=" * (-len(value) % 4))


def _issue_quote_token(plan: CoursePlan) -> tuple[str, str]:
    expires = datetime.now(timezone.utc) + timedelta(seconds=QUOTE_TTL_SECONDS)
    payload = {
        "v": 1, "uid": plan.user_id, "cid": plan.course_id,
        "model": plan.writing_model, "plan_sha256": _plan_hash(plan),
        "exp": int(expires.timestamp()),
    }
    data = _b64_encode(json.dumps(payload, separators=(",", ":"),
                                  sort_keys=True).encode("utf-8"))
    sig = _b64_encode(hmac.new(_quote_key(), data.encode("ascii"), hashlib.sha256).digest())
    return f"{data}.{sig}", expires.isoformat()


def _verify_quote_token(token: str, *, uid: str, cid: str) -> dict[str, Any]:
    try:
        data, signature = token.split(".", 1)
        authentic = hmac.new(_quote_key(), data.encode("ascii"), hashlib.sha256).digest()
        supplied = _b64_decode(signature)
        if not hmac.compare_digest(authentic, supplied):
            raise ValueError("signature")
        payload = json.loads(_b64_decode(data).decode("utf-8"))
        if (not isinstance(payload, dict) or payload.get("v") != 1
                or payload.get("uid") != uid or payload.get("cid") != cid
                or not isinstance(payload.get("model"), str)
                or not isinstance(payload.get("plan_sha256"), str)
                or type(payload.get("exp")) is not int
                or payload["exp"] <= int(datetime.now(timezone.utc).timestamp())):
            raise ValueError("payload")
        return payload
    except HTTPException:
        raise
    except (ValueError, TypeError, UnicodeError, binascii.Error, json.JSONDecodeError):
        raise HTTPException(409, "Devis invalide ou expire ; demander un nouveau devis.") from None


def _translate_error(exc: Exception) -> HTTPException:
    if isinstance(exc, HTTPException):
        return exc
    if isinstance(exc, (CourseInsufficientCredits, InsufficientCreditsForActionError)):
        return HTTPException(402, "Credits ORIA insuffisants pour cette action.")
    if isinstance(exc, (CourseInvalid, AudioInvalid, ValueError)):
        return HTTPException(422, str(exc)[:250])
    if isinstance(exc, (CourseStorageConflict, CourseJobConflict)):
        return HTTPException(409, "Conflit : le cours ou le segment a deja change.")
    if isinstance(exc, (CourseNeedsReconciliation, CourseJobNeedsReconciliation)):
        return HTTPException(409, "Verification manuelle necessaire ; ne pas relancer l'operation.")
    if isinstance(exc, CourseUnavailable):
        return HTTPException(409, str(exc)[:220])
    if isinstance(exc, (CourseStorageError, CourseJobStoreError, CourseJobLeaseError, ApiBudgetConfigurationError)):
        return HTTPException(503, "Stockage ou facturation ORIA Cours indisponible.")
    logger.exception("Erreur inattendue dans une route ORIA Cours", exc_info=exc)
    return HTTPException(503, "Service ORIA Cours temporairement indisponible.")


# Aucun dispatcher par defaut. L'etape 'file durable' doit fournir une fonction
# qui ecrit dans une queue persistante et idempotente sur course_id, afin que
# le cours soit repris meme si l'API redemarre. La presence de cette fonction
# est verifiee AVANT la reservation des credits.
_course_dispatcher: Callable[[str, str], None] | None = None


def configure_course_dispatcher(dispatcher: Callable[[str, str], None] | None) -> None:
    global _course_dispatcher
    if dispatcher is not None and not callable(dispatcher):
        raise TypeError("Le dispatcher doit etre appelable.")
    _course_dispatcher = dispatcher


def _safe_public_job(job: dict[str, Any] | None) -> dict[str, Any] | None:
    if not isinstance(job, dict):
        return None
    return {
        "status": job.get("status"),
        "transcription_reservation_status": job.get("transcription_reservation_status"),
        "document_reservation_status": job.get("document_reservation_status"),
        "document_ready": bool(isinstance(job.get("output"), dict)
                               and isinstance(job["output"].get("artifact"), dict)
                               and job["output"]["artifact"].get("id")),
        "requires_manual_review": job.get("status") == "reconciliation_required",
    }


@router.get("/capabilities")
def course_capabilities(
    uid: str = Depends(_authenticated_user),
    deps: CourseDependencies = Depends(_get_components),
) -> dict[str, Any]:
    """Formats/durees/choix publics autorises par le pack reel du compte."""
    try:
        wallet = deps.service.credits.get_wallet(uid)
        active = bool(wallet is not None and wallet.is_pack_active)
        pack_id = str(wallet.pack_id or "") if active else ""
        return {
            "pack_active": active,
            "writing_models": list(available_course_writing_models(pack_id)),
            "document_formats": ["pdf", "docx"], "default_document_format": "pdf",
            "maximum_duration_ms": CourseAudioPolicy.MAX_COURSE_DURATION_MS,
            "maximum_segment_duration_ms": CourseAudioPolicy.MAX_SEGMENT_DURATION_SECONDS * 1000,
            "maximum_segment_bytes": CourseAudioPolicy.MAX_SEGMENT_BYTES,
            "maximum_segments": CourseAudioPolicy.MAX_SEGMENTS,
        }
    except Exception as exc:
        raise _translate_error(exc) from None


@router.post("", status_code=201)
def create_course(
    payload: CreateCourseBody,
    uid: str = Depends(_authenticated_user),
    deps: CourseDependencies = Depends(_get_components),
) -> dict[str, Any]:
    cid = str(payload.course_id or uuid4())
    try:
        saved = deps.audio.create_course(user_id=uid, course_id=cid,
            title=payload.title, document_format=payload.document_format)
        return {"course": _public_course(saved)}
    except Exception as exc:
        raise _translate_error(exc) from None


@router.put("/{course_id}/segments/{index}", status_code=201)
async def upload_segment(
    course_id: str,
    index: int,
    file: UploadFile = File(...),
    uid: str = Depends(_authenticated_user),
    deps: CourseDependencies = Depends(_get_components),
) -> dict[str, Any]:
    cid = _course_id(course_id)
    if index < 0 or index >= CourseAudioPolicy.MAX_SEGMENTS:
        raise HTTPException(422, "Indice de segment hors limites.")
    if not file.filename or not file.content_type:
        raise HTTPException(422, "Fichier audio et type MIME requis.")
    # Le corps multipart est lu avec une borne stricte : aucune lecture illimitee.
    try:
        data = await file.read(CourseAudioPolicy.MAX_SEGMENT_BYTES + 1)
        if not data or len(data) > CourseAudioPolicy.MAX_SEGMENT_BYTES:
            raise HTTPException(413, "Segment audio vide ou superieur a 20 Mio.")
        # Inspecter les octets et calculer la duree SERVEUR (ffprobe/decodage).
        manifest, normalized = await run_in_threadpool(
            CourseAudioPolicy.inspect_segment,
            index=index, data=data, mime_type=file.content_type,
        )
        row = await run_in_threadpool(
            deps.audio.upload_segment,
            user_id=uid, course_id=cid, index=index, data=normalized,
            mime_type=manifest["mime_type"], extension=manifest["extension"],
            duration_ms=manifest["duration_ms"],
        )
        return {"course_id": cid, "segment": _public_segment(row)}
    except HTTPException:
        raise
    except Exception as exc:
        raise _translate_error(exc) from None
    finally:
        await file.close()


@router.get("/{course_id}")
def get_course(
    course_id: str,
    uid: str = Depends(_authenticated_user),
    deps: CourseDependencies = Depends(_get_components),
) -> dict[str, Any]:
    cid = _course_id(course_id)
    try:
        course = _owned_course(deps, uid, cid)
        job = deps.jobs.get_job(user_id=uid, course_id=cid)
        return {"course": _public_course(course), "job": _safe_public_job(job)}
    except HTTPException:
        raise
    except Exception as exc:
        raise _translate_error(exc) from None


@router.get("/{course_id}/segments")
def list_segments(
    course_id: str,
    uid: str = Depends(_authenticated_user),
    deps: CourseDependencies = Depends(_get_components),
) -> dict[str, Any]:
    cid = _course_id(course_id)
    try:
        _owned_course(deps, uid, cid)
        segments = deps.audio.list_segments(user_id=uid, course_id=cid)
        return {"course_id": cid, "segments": [_public_segment(s) for s in segments]}
    except HTTPException:
        raise
    except Exception as exc:
        raise _translate_error(exc) from None


@router.get("/{course_id}/segments/{index}/playback")
def segment_playback(
    course_id: str,
    index: int,
    uid: str = Depends(_authenticated_user),
    deps: CourseDependencies = Depends(_get_components),
) -> dict[str, Any]:
    """Reecoute d'un segment via URL Supabase privee et temporaire."""
    cid = _course_id(course_id)
    if index < 0 or index >= CourseAudioPolicy.MAX_SEGMENTS:
        raise HTTPException(422, "Indice de segment hors limites.")
    try:
        _owned_course(deps, uid, cid)
        url = deps.audio.signed_segment_url(user_id=uid, course_id=cid, index=index)
        return {"course_id": cid, "index": index, "playback_url": url,
                "expires_in_seconds": 15 * 60}
    except HTTPException:
        raise
    except Exception as exc:
        raise _translate_error(exc) from None


@router.post("/{course_id}/submit")
def submit_course(
    course_id: str,
    uid: str = Depends(_authenticated_user),
    deps: CourseDependencies = Depends(_get_components),
) -> dict[str, Any]:
    cid = _course_id(course_id)
    try:
        _owned_course(deps, uid, cid)
        row = deps.audio.submit_course(user_id=uid, course_id=cid)
        return {"course": _public_course(row), "next": "quote"}
    except HTTPException:
        raise
    except Exception as exc:
        raise _translate_error(exc) from None


@router.post("/{course_id}/quote")
def quote_course(
    course_id: str,
    payload: QuoteBody,
    uid: str = Depends(_authenticated_user),
    deps: CourseDependencies = Depends(_get_components),
) -> dict[str, Any]:
    cid = _course_id(course_id)
    try:
        _owned_course(deps, uid, cid)
        plan = deps.service.prepare_quote(
            user_id=uid, course_id=cid, writing_model=payload.writing_model,
        )
        token, expires_at = _issue_quote_token(plan)
        return {"quote": plan.public_quote(), "quote_token": token,
                "expires_at": expires_at}
    except HTTPException:
        raise
    except Exception as exc:
        raise _translate_error(exc) from None


@router.post("/{course_id}/confirm", status_code=202)
def confirm_course(
    course_id: str,
    payload: ConfirmBody,
    uid: str = Depends(_authenticated_user),
    deps: CourseDependencies = Depends(_get_components),
) -> dict[str, Any]:
    cid = _course_id(course_id)
    if payload.approved is not True:
        raise HTTPException(422, "Le devis doit etre accepte explicitement.")
    # Protection ORIA Cours uniquement : aucun appel payant si le dispatch
    # n'a pas ete active explicitement, meme avec un dispatcher injecte.
    if os.getenv("ORIA_COURSE_DISPATCH_ENABLED", "0") != "1":
        raise HTTPException(503, "Envoi des cours non active.")
    # Un job payant confirme sans vrai ordonnanceur resterait bloque dans la
    # base avec une reservation expiree. Refus AVANT tout debit si absence.
    if not callable(_course_dispatcher):
        raise HTTPException(503, "File durable ORIA Cours non connectee.")
    token = _verify_quote_token(payload.quote_token, uid=uid, cid=cid)
    try:
        _owned_course(deps, uid, cid)
        plan = deps.service.prepare_quote(user_id=uid, course_id=cid,
                                           writing_model=token["model"])
        if not hmac.compare_digest(_plan_hash(plan), token["plan_sha256"]):
            raise HTTPException(409, "Le devis a change ; demander un nouveau devis.")
        job = deps.service.confirm_and_reserve(plan=plan, approved=True)
        # La fonction doit enregistrer un message PERSISTANT et idempotent.
        # Si elle echoue, le job SQL reste queued pour rapprochement/requeue;
        # NE PAS rembourser aveuglement ni refaire les reservations.
        if job.get("status") == "completed":
            return {"course_id": cid, "status": "completed",
                    "queued": False, "message": "Cours deja termine."}
        if job.get("status") == "reconciliation_required":
            raise HTTPException(409, "Rapprochement manuel du cours requis.")
        if job.get("status") == "processing":
            return {"course_id": cid, "status": "processing",
                    "queued": False, "message": "Cours deja en traitement."}
        try:
            _course_dispatcher(uid, cid)
        except Exception:
            logger.exception("Dispatch ORIA Cours non confirme course_id=%s", cid)
            raise HTTPException(503, "Reservations conservees ; envoi au worker a verifier.") from None
        return {"course_id": cid, "status": job.get("status", "queued"),
                "queued": True, "message": "Traitement accepte par la file durable."}
    except HTTPException:
        raise
    except Exception as exc:
        raise _translate_error(exc) from None


@router.get("/{course_id}/artifacts")
def course_artifacts(
    course_id: str,
    uid: str = Depends(_authenticated_user),
    deps: CourseDependencies = Depends(_get_components),
) -> dict[str, Any]:
    cid = _course_id(course_id)
    try:
        _owned_course(deps, uid, cid)
        job = deps.jobs.get_job(user_id=uid, course_id=cid)
        if not isinstance(job, dict) or job.get("status") != "completed":
            return {"course_id": cid, "ready": False, "artifacts": []}
        output = job.get("output")
        artifact = output.get("artifact") if isinstance(output, dict) else None
        if not isinstance(artifact, dict):
            raise HTTPException(409, "Resultat du cours incoherent.")
        transcript = artifact.get("transcript_artifact")
        if not isinstance(transcript, dict):
            raise HTTPException(409, "Transcription finale manquante.")
        items = []
        for kind, item in (("document", artifact), ("transcript", transcript)):
            ident = str(item.get("id", ""))
            try:
                UUID(ident)
            except (ValueError, TypeError, AttributeError):
                raise HTTPException(409, "Identifiant de fichier final invalide.") from None
            row = deps.artifacts.get_artifact(user_id=uid, artifact_id=ident)
            metadata = row.get("metadata") if isinstance(row, dict) else None
            if (not isinstance(row, dict) or not isinstance(metadata, dict)
                    or metadata.get("source") != "oria-course"
                    or metadata.get("course_id") != cid
                    or metadata.get("kind") != kind):
                raise HTTPException(409, "Fichier final prive non confirme.")
            items.append({"kind": kind, "id": ident, "filename": row["filename"],
                          "extension": row["extension"], "size_bytes": row["size_bytes"]})
        return {"course_id": cid, "ready": True, "artifacts": items,
                "download_endpoint": "/ai/artifacts/{artifact_id}"}
    except HTTPException:
        raise
    except Exception as exc:
        raise _translate_error(exc) from None


__all__ = ["router", "configure_course_dispatcher", "CourseDependencies"]

