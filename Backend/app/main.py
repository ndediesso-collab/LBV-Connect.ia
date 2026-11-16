
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
