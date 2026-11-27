
from fastapi import FastAPI
import asyncio
import logging
import os

from fastapi.middleware.cors import CORSMiddleware

from app.routes import router

from app.route.ai import router as ai_router
from app.route.free_addon_recovery import router as free_addon_recovery_router
from app.route.free_cv_plan import router as free_cv_plan_router
from app.route.free_chat import router as free_router
from app.route.free_documents import router as free_documents_router
from app.route.free_image_jobs import router as free_image_jobs_router
from app.route.collaboratif import router as collaboratif_router
from app.route.collab_profiles import router as collab_profiles_router
from app.route.collab_recharges import router as collab_recharges_router
from app.route.collab_private import router as collab_private_router
from app.route.collab_quotas import router as collab_quotas_router
from app.route.collab_groups import router as collab_groups_router
from app.route.collab_group_ai import router as collab_group_ai_router
from app.route.collab_message_extensions import router as collab_message_extensions_router
from app.route.collab_workspace_directory import router as collab_workspace_directory_router
from app.route.collab_email_invites import router as collab_email_invites_router
from app.route.collab_workspace_scope import router as collab_workspace_scope_router
from app.route.collab_workspace_finance import router as collab_workspace_finance_router
from app.route.collab_scoped_actions import router as collab_scoped_actions_router
from app.route.collab_allocation import router as collab_allocation_router
from app.route.collab_ai_workspace import router as collab_ai_workspace_router
from app.route.collab_chat_hub import router as collab_chat_hub_router
from app.route.collab_share_invites import router as collab_share_invites_router
from app.route.collab_push import router as collab_push_router

from app.services.oria_memory_middleware import OriaMemoryCleanupMiddleware


app = FastAPI(
    title="LBV-Connect Backend",
)

# ORIA_FREE_WATCHDOG_PERMANENT_V1
# Lance un contrôle toutes les cinq minutes, indépendant du navigateur.
# Activer seulement APRES migration SQL avec ORIA_FREE_WATCHDOG_ENABLED=1.
_oria_watchdog_task = None

@app.on_event("startup")
async def _start_free_watchdog():
    global _oria_watchdog_task
    if os.getenv("ORIA_FREE_WATCHDOG_ENABLED", "0") != "1":
        return
    from app.services.oria_free_generation_watchdog import reconcile_stale_global
    async def _run():
        while True:
            try:
                await asyncio.to_thread(reconcile_stale_global)
            except asyncio.CancelledError:
                raise
            except Exception:
                logging.getLogger("oria.free.watchdog").exception("Periodic reconciliation failed")
            await asyncio.sleep(300)
    _oria_watchdog_task = asyncio.create_task(_run())

@app.on_event("shutdown")
async def _stop_free_watchdog():
    global _oria_watchdog_task
    if _oria_watchdog_task is not None:
        _oria_watchdog_task.cancel()
        try:
            await _oria_watchdog_task
        except asyncio.CancelledError:
            pass
        _oria_watchdog_task = None


# ============================================================
# ORIA — GESTION AUTOMATIQUE DE LA RAM
# ============================================================

app.add_middleware(
    OriaMemoryCleanupMiddleware
)


# ============================================================
# CORS
# ============================================================

# Ancien domaine Vercel de production
VERCEL_PRODUCTION_ORIGIN = (
    "https://lbv-connect-ia.vercel.app"
)

# Nouveau domaine officiel ORIA
ORIA_PRODUCTION_ORIGINS = [
    "https://myoriaai.com",
    "https://www.myoriaai.com",
]


# Previews Vercel du projet
VERCEL_ORIGIN_REGEX = (
    r"^https://lbv-connect-[a-z0-9-]+"
    r"-ndediesso-collabs-projects\.vercel\.app$"
)


# Expo Web / développement local
LOCALHOST_ORIGIN_REGEX = (
    r"^https?://(localhost|127\.0\.0\.1)(:\d+)?$"
)


# ORIA_COLLAB_OWNER_PACK_GATE_P11
from app.middleware.oria_collab_pack_gate import OriaCollabOwnerPackGateMiddleware
app.add_middleware(OriaCollabOwnerPackGateMiddleware)

app.add_middleware(
    CORSMiddleware,

    # Origines exactes autorisées
    allow_origins=[
        VERCEL_PRODUCTION_ORIGIN,
        *ORIA_PRODUCTION_ORIGINS,
    ],

    # Previews Vercel et développement local
    allow_origin_regex=(
        f"(?:{VERCEL_ORIGIN_REGEX[1:-1]})"
        f"|(?:{LOCALHOST_ORIGIN_REGEX[1:-1]})"
    ),

    # Authentification
    allow_credentials=True,

    # Méthodes HTTP
    allow_methods=["*"],

    # Headers HTTP
    allow_headers=["*"],
)


# ============================================================
# ROUTES GÉNÉRALES
# ============================================================

app.include_router(router)


# ============================================================
# ROUTES IA
# ============================================================

app.include_router(
    ai_router,
    prefix="/ai",
)

# ORIA Gratuit : staging flag and SQL enabled both required.
app.include_router(free_router, prefix="/ai")
app.include_router(free_documents_router, prefix="/ai")
app.include_router(free_image_jobs_router, prefix="/ai")


# ORIA gratuit: rapprochement de recharges serveur + collecte CV sans frais.
app.include_router(free_addon_recovery_router)
app.include_router(free_cv_plan_router, prefix="/ai")

# ORIA Collaboratif — fondations additives (activation derriere flag).
app.include_router(collaboratif_router)
app.include_router(collab_profiles_router)
app.include_router(collab_recharges_router)
app.include_router(collab_private_router)
app.include_router(collab_quotas_router)
app.include_router(collab_groups_router)
app.include_router(collab_group_ai_router)
app.include_router(collab_message_extensions_router)
app.include_router(collab_workspace_directory_router)
app.include_router(collab_email_invites_router)
app.include_router(collab_workspace_scope_router)
app.include_router(collab_workspace_finance_router)
app.include_router(collab_scoped_actions_router)
app.include_router(collab_allocation_router)
app.include_router(collab_ai_workspace_router)
app.include_router(collab_chat_hub_router)
app.include_router(collab_share_invites_router)
app.include_router(collab_push_router)

# ORIA 6B2D - Garde des anciennes routes mono-equipe en multi-adhesion.
# OFF par defaut. Le gate DOIT etre actif avant le DROP INDEX de staging.
from fastapi import Request as _CollabGateRequest
from fastapi.responses import JSONResponse as _CollabGateJSON
import os as _collab_gate_os

@app.middleware("http")
async def _oria_multi_workspace_legacy_gate(request: _CollabGateRequest, call_next):
    if _collab_gate_os.getenv("ORIA_COLLAB_MULTI_ACTIVE", "0") == "1":
        path = request.url.path.rstrip("/")
        if path.startswith("/collaboratif/") and not (
            path.startswith("/collaboratif/workspaces/")
            or path == "/collaboratif/workspaces"
            or path.startswith("/collaboratif/email-invitations/")
            or path.startswith("/collaboratif/share-invitations/")
        ):
            return _CollabGateJSON(status_code=503, content={
                "detail":"Ancienne route mono-equipe fermee : selectionnez un espace precis."
            })
    return await call_next(request)


# ORIA_COLLAB_P16_PUSH_WORKER
# Inactif jusqu'à ORIA_COLLAB_PUSH_P16_ENABLED=1 et WORKER_ENABLED=1.
# Claim SQL atomique : plusieurs instances Render ne prennent pas la même ligne.
_oria_collab_push_task = None

@app.on_event("startup")
async def _oria_collab_push_start():
    global _oria_collab_push_task
    from app.services.oria_collab_push_service import worker_ready,dispatch_batch,prune_events
    from app.services.oria_assistant_push_service import dispatch_batch as dispatch_assistant_push_batch, prune_events as prune_assistant_push_events
    if not worker_ready():
        return
    async def loop():
        from app.core.supabase import supabase as _push_db
        from time import monotonic
        last_prune=0.0
        while True:
            try:
                await asyncio.to_thread(dispatch_batch, _push_db)
                await asyncio.to_thread(dispatch_assistant_push_batch, _push_db)
                if monotonic()-last_prune>3600:
                    await asyncio.to_thread(prune_events, _push_db)
                    await asyncio.to_thread(prune_assistant_push_events, _push_db)
                    last_prune=monotonic()
            except asyncio.CancelledError:
                raise
            except Exception:
                logging.getLogger("oria.collab.push").exception("P16 boucle Web Push : erreur provisoire")
            await asyncio.sleep(8)
    _oria_collab_push_task=asyncio.create_task(loop())

@app.on_event("shutdown")
async def _oria_collab_push_stop():
    global _oria_collab_push_task
    if _oria_collab_push_task is not None:
        _oria_collab_push_task.cancel()
        try:
            await _oria_collab_push_task
        except asyncio.CancelledError:
            pass
        _oria_collab_push_task=None
from app.route.oria_assistant import router as oria_assistant_router
app.include_router(oria_assistant_router)

from app.route.oria_assistant_push import router as oria_assistant_push_router
app.include_router(oria_assistant_push_router)

# ORIA Assistant — file e-mail durable (désactivée tant que la configuration Brevo n'est pas activée).
_oria_assistant_email_task = None

@app.on_event("startup")
async def _oria_assistant_email_start():
    global _oria_assistant_email_task
    from app.services.oria_assistant_email_worker import worker_ready, dispatch_batch
    if not worker_ready():
        return

    async def _oria_assistant_email_loop():
        from app.core.supabase import supabase as _assistant_email_db
        while True:
            try:
                await asyncio.to_thread(dispatch_batch, _assistant_email_db)
            except asyncio.CancelledError:
                raise
            except Exception:
                logging.getLogger("oria.assistant.email").exception("ORIA Assistant email worker failed")
            await asyncio.sleep(15)

    _oria_assistant_email_task = asyncio.create_task(_oria_assistant_email_loop())


@app.on_event("shutdown")
async def _oria_assistant_email_stop():
    global _oria_assistant_email_task
    if _oria_assistant_email_task is not None:
        _oria_assistant_email_task.cancel()
        try:
            await _oria_assistant_email_task
        except asyncio.CancelledError:
            pass
        _oria_assistant_email_task = None

# ORIA Transcription — préparateur audio long (aucun appel IA / aucune facturation).
# Activer uniquement après application de la migration SQL correspondante.
_oria_course_audio_import_task = None

@app.on_event("startup")
async def _oria_course_audio_import_start():
    global _oria_course_audio_import_task
    if (os.getenv("ORIA_COURSE_AUDIO_IMPORT_ENABLED", "0").strip() != "1"
            or os.getenv("ORIA_COURSE_AUDIO_IMPORT_WORKER_ENABLED", "0").strip() != "1"):
        return
    from app.core.supabase import supabase as _audio_import_db
    from app.services.course_audio_import_worker import CourseAudioImportWorker
    worker = CourseAudioImportWorker(_audio_import_db)

    async def _loop():
        while True:
            try:
                did_work = await asyncio.to_thread(worker.run_once)
                await asyncio.sleep(1 if did_work else 5)
            except asyncio.CancelledError:
                raise
            except Exception:
                logging.getLogger("oria.transcription.audio_import").exception(
                    "ORIA long-audio preparation loop failed"
                )
                await asyncio.sleep(5)

    _oria_course_audio_import_task = asyncio.create_task(_loop())


@app.on_event("shutdown")
async def _oria_course_audio_import_stop():
    global _oria_course_audio_import_task
    if _oria_course_audio_import_task is not None:
        _oria_course_audio_import_task.cancel()
        try:
            await _oria_course_audio_import_task
        except asyncio.CancelledError:
            pass
        _oria_course_audio_import_task = None

