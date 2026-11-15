"""ORIA Free images: server-owned, budget reserved, idempotent 1K image jobs.

Requires the ORIA_FREE_IMAGE_JOBS_V1 SQL migration and an explicit Render flag.
Closing a browser modal doesn't cancel a BackgroundTasks worker. A Render restart
can still interrupt an in-flight job; never automatically resubmit a billed POST.
"""
from __future__ import annotations

import asyncio
import logging
import os
import tempfile
from decimal import Decimal, InvalidOperation, ROUND_CEILING
from pathlib import Path
from uuid import UUID

from fastapi import APIRouter, BackgroundTasks, Header, HTTPException
from pydantic import BaseModel, ConfigDict, Field

from app.core.supabase import supabase
from app.route.ai import _authenticate_chat_user
from app.services.free_tier_gateway import FreeTierGateway
from app.services.media_service import MediaService
from app.services.openrouter_media_service import OpenRouterMediaService

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/free/images", tags=["ORIA free images"])
TABLE = "oria_free_image_jobs"
MODEL = "recraft/recraft-v4.1-flash"
# Accounting: 1 credit = 0.10 XAF; capped 6 XAF reservation (60 credits)
# against published approx 0.007 USD/image (~4.20 XAF at 600/USD).
RESERVE_CREDITS = 60
RESERVE_XAF = Decimal("6.000000")
USD_XAF = Decimal("600")
CREDIT_XAF = Decimal("0.10")
ALLOWED_RATIOS = frozenset(("1:1", "4:3", "3:4", "16:9", "9:16"))


def _enabled() -> None:
    if os.getenv("ORIA_FREE_IMAGES_ENABLED", "0") != "1":
        raise HTTPException(503, "Images gratuites temporairement suspendues.")
    if not os.getenv("OPENROUTER_API_KEY", "").strip():
        raise HTTPException(503, "Fournisseur d'images gratuites indisponible.")


def _user(uid: str | None, authorization: str | None) -> str:
    return _authenticate_chat_user(uid, authorization)


def _job(uid: str, job_id: UUID) -> dict:
    result = (supabase.table(TABLE).select("*").eq("id", str(job_id))
              .eq("user_id", uid).limit(1).execute().data or [])
    if not result:
        raise HTTPException(404, "Création introuvable.")
    return result[0]


def _public(job: dict) -> dict:
    status = str(job.get("status") or "unknown")
    if status in ("queued", "processing"):
        from datetime import datetime, timezone
        try:
            started = datetime.fromisoformat(str(job.get("updated_at") or job.get("created_at")).replace("Z", "+00:00"))
            if (datetime.now(timezone.utc) - started).total_seconds() > 900:
                status = "needs_review"  # View-only; no provider retry / automatic refund
        except (ValueError, TypeError):
            pass
    return {
        "id": job.get("id"), "status": status, "model": MODEL,
        "prompt": str(job.get("prompt") or "")[:1500],
        "created_at": job.get("created_at"),
        "media_id": job.get("media_id"), "media_url": job.get("media_url"),
        "reserved_credits": job.get("reserved_credits"),
        "charged_credits": job.get("charged_credits"),
        "error_code": job.get("error_code"),
    }


def actual_bill(usage: dict) -> tuple[int, Decimal] | None:
    """Only accept verified usage, not guessed published prices as actuals."""
    if not isinstance(usage, dict):
        return None
    number = usage.get("cost")
    if type(number) not in (str, float, int, Decimal) or isinstance(number, bool):
        return None
    try:
        dollars = Decimal(str(number))
    except (InvalidOperation, ValueError):
        return None
    if not dollars.is_finite() or dollars <= 0:
        return None
    xaf = (dollars * USD_XAF).quantize(Decimal("0.000001"))
    credits = int((xaf / CREDIT_XAF).to_integral_value(rounding=ROUND_CEILING))
    # Never settle above already reserved amount/budget.
    if credits <= 0 or credits > RESERVE_CREDITS or xaf > RESERVE_XAF:
        return None
    return credits, xaf


def _update(uid: str, job_id: str, **fields) -> None:
    from datetime import datetime, timezone
    fields["updated_at"] = datetime.now(timezone.utc).isoformat()
    supabase.table(TABLE).update(fields).eq("id", job_id).eq("user_id", uid).execute()


def _work_image(uid: str, job_id: str, prompt: str, ratio: str):
    """Runs after response. All side effects owned by server, not React."""
    from pathlib import Path
    _update(uid, job_id, status="processing")
    with tempfile.TemporaryDirectory(prefix="oria-free-img-") as folder:
        try:
            service = OpenRouterMediaService()
            item = service.create_image(
                model=MODEL, prompt=prompt, destination=Path(folder) / job_id,
                resolution="1K", aspect_ratio=ratio, request_id=job_id,
            )
            binary = Path(item.file_path).read_bytes()
            # Persist BEFORE claiming success or settling the reservation.
            saved = MediaService().save_image(
                user_id=uid, image_bytes=binary, action="free_image_recraft",
                model=MODEL, prompt=prompt, mime_type=item.mime_type,
                credits_cost=0,
            )
            media_id = str(saved.get("id") or "")
            media_url = str(saved.get("media_url") or saved.get("url") or "")
            _update(uid, job_id, status="saved_pending_billing",
                    media_id=media_id or None, media_url=media_url or None)
            charge = actual_bill(item.usage)
            if charge is None:
                # Image delivered, but provider did not confirm cost. Hold until audited.
                _update(uid, job_id, status="needs_review", error_code="cost_unconfirmed")
                return
            credits, xaf = charge
            settlement = FreeTierGateway(supabase).settle(uid, job_id, credits, xaf)
            from app.services.oria_free_audit import record_only_if_settled
            if not record_only_if_settled(supabase,user_id=uid,reservation_id=job_id,
                                        action="free_image_recraft",credits=credits,api_xaf=xaf):
                # Image déjà sauvée : ne jamais regénérer à cause d'un souci de rapprochement.
                _update(uid, job_id, status="needs_review", error_code="audit_settlement_unconfirmed")
                return
            _update(uid, job_id, status="completed", charged_credits=credits,
                    api_cost_xaf=float(xaf), error_code=None)
            if media_id:
                try:
                    supabase.table("generated_media").update({"credits_cost": credits}) \
                        .eq("id", media_id).eq("user_id", uid).execute()
                except Exception:
                    logger.warning("ORIA free image media cost mirror failed job=%s", job_id)
        except Exception as error:
            # A request failure is not evidence that the provider charged nothing.
            # Do not auto-release / auto-retry. The record remains auditable.
            logger.exception("ORIA free image needs review, job=%s exception=%s", job_id, type(error).__name__)
            try:
                _update(uid, job_id, status="needs_review", error_code=type(error).__name__[:48])
            except Exception:
                logger.exception("ORIA free image status update failed, job=%s", job_id)


async def _worker(uid: str, job_id: str, prompt: str, ratio: str):
    await asyncio.to_thread(_work_image, uid, job_id, prompt, ratio)


class CreateImageJob(BaseModel):
    model_config = ConfigDict(extra="forbid")
    request_id: UUID
    prompt: str = Field(min_length=3, max_length=1800)
    aspect_ratio: str = "1:1"


@router.get("/capabilities")
def free_image_capabilities(user_id: str | None = Header(default=None, alias="user-id"),
                            authorization: str | None = Header(default=None)):
    uid = _user(user_id, authorization)
    _enabled()
    grant = FreeTierGateway(supabase).grant(uid)
    if grant.get("enabled") is not True or grant.get("paid_pack_active") is True:
        raise HTTPException(403, "Images gratuites réservées aux comptes gratuits actifs.")
    # SQL migration and OpenRouter model entitlement are probed on every load.
    supabase.table(TABLE).select("id").eq("user_id", uid).limit(1).execute()
    service = OpenRouterMediaService()
    if MODEL not in service.image_models_allowed:
        raise HTTPException(503, "Modèle économique non autorisé.")
    try:
        entry = next((row for row in service.list_image_models() if row.get("id") == MODEL), None)
    except Exception as error:
        raise HTTPException(503, "Catalogue d'images momentanément indisponible.") from error
    if not entry:
        raise HTTPException(503, "Modèle Recraft indisponible chez le fournisseur.")
    return {"success": True, "ready": True, "model": MODEL,
            "max_resolution": "1K", "reserve_credits": RESERVE_CREDITS,
            "ratios": sorted(ALLOWED_RATIOS)}


@router.post("/jobs", status_code=202)
def create_free_image_job(payload: CreateImageJob, tasks: BackgroundTasks,
                          user_id: str | None = Header(default=None, alias="user-id"),
                          authorization: str | None = Header(default=None)):
    uid = _user(user_id, authorization)
    _enabled()
    ratio = payload.aspect_ratio
    if ratio not in ALLOWED_RATIOS:
        raise HTTPException(422, "Format d'image non pris en charge.")
    job_id = str(payload.request_id)
    prompt = payload.prompt.strip()
    if len(prompt) < 3:
        raise HTTPException(422, "Description image vide.")
    existing = (supabase.table(TABLE).select("*").eq("id", job_id)
                .eq("user_id", uid).limit(1).execute().data or [])
    if existing:
        if existing[0].get("prompt") != prompt or existing[0].get("aspect_ratio") != ratio:
            raise HTTPException(409, "Identifiant déjà utilisé pour une autre création.")
        return {"success": True, "job": _public(existing[0]), "replayed": True}
    service = OpenRouterMediaService()
    if MODEL not in service.image_models_allowed:
        raise HTTPException(503, "Modèle gratuit indisponible.")
    # Preflight model supports chosen ratio BEFORE reserve and POST.
    entries = service.list_image_models()
    model_entry = next((item for item in entries if item.get("id") == MODEL), None)
    if not model_entry:
        raise HTTPException(503, "Catalogue Recraft indisponible.")
    ratios = service._image_choices(model_entry, "aspect_ratio")
    if ratio not in ratios:
        raise HTTPException(422, "Format non disponible pour ce modèle.")
    gateway = FreeTierGateway(supabase)
    grant = gateway.grant(uid)
    if grant.get("enabled") is not True or grant.get("paid_pack_active") is True:
        raise HTTPException(403, "Accès gratuit non autorisé.")
    try:
        supabase.table(TABLE).insert({
            "id": job_id, "user_id": uid, "prompt": prompt, "aspect_ratio": ratio,
            "status": "queued", "reserved_credits": RESERVE_CREDITS,
        }).execute()
    except Exception:
        # Simultaneous identical retry: unique id means exactly one can win.
        existing = (supabase.table(TABLE).select("*").eq("id", job_id)
                    .eq("user_id", uid).limit(1).execute().data or [])
        if existing and existing[0].get("prompt") == prompt and existing[0].get("aspect_ratio") == ratio:
            return {"success": True, "job": _public(existing[0]), "replayed": True}
        raise HTTPException(503, "Impossible d'enregistrer la création, aucun appel fournisseur lancé.")
    try:
        gateway.reserve(uid, job_id, RESERVE_CREDITS, RESERVE_XAF, action="free_image_recraft")
        _update(uid, job_id, status="reserved")
    except Exception as error:
        _update(uid, job_id, status="declined", error_code="reserve_rejected")
        logger.warning("ORIA free image reserve refused, exception=%s", type(error).__name__)
        raise HTTPException(402, "Crédits gratuits ou budget API insuffisants.")
    # Synchronous accepted response, worker continues even if modal closes.
    tasks.add_task(_worker, uid, job_id, prompt, ratio)
    return {"success": True, "job": _public(_job(uid, payload.request_id)), "replayed": False}


@router.get("/jobs")
def list_free_image_jobs(user_id: str | None = Header(default=None, alias="user-id"),
                         authorization: str | None = Header(default=None)):
    uid = _user(user_id, authorization)
    data = (supabase.table(TABLE).select("*").eq("user_id", uid)
            .order("created_at", desc=True).limit(30).execute().data or [])
    return {"success": True, "jobs": [_public(item) for item in data]}


@router.get("/jobs/{job_id}")
def get_free_image_job(job_id: UUID, user_id: str | None = Header(default=None, alias="user-id"),
                       authorization: str | None = Header(default=None)):
    return {"success": True, "job": _public(_job(_user(user_id, authorization), job_id))}
