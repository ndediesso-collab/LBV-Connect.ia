
from fastapi import FastAPI

from fastapi.middleware.cors import CORSMiddleware

from app.routes import router

from app.route.ai import router as ai_router

from app.services.oria_memory_middleware import OriaMemoryCleanupMiddleware


app = FastAPI(
    title="LBV-Connect Backend",
)


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
