from fastapi import FastAPI

from fastapi.middleware.cors import CORSMiddleware

from app.routes import router

from app.route.ai import router as ai_router


app = FastAPI(
    title="LBV-Connect Backend",
)


# ============================================================
# CORS
# ============================================================

# Domaine Vercel de production
VERCEL_PRODUCTION_ORIGIN = (
    "https://lbv-connect-ia.vercel.app"
)


# Previews Vercel du projet
VERCEL_ORIGIN_REGEX = (
    r"^https://lbv-connect-[a-z0-9-]+"
    r"-ndediesso-collabs-projects\.vercel\.app$"
)


# Expo Web / développement local.
#
# Expo peut utiliser différents ports selon le lancement
# du serveur (8081, 8092, etc.). On autorise donc localhost
# et 127.0.0.1 sur n'importe quel port de développement.
LOCALHOST_ORIGIN_REGEX = (
    r"^https?://(localhost|127\.0\.0\.1)(:\d+)?$"
)


app.add_middleware(
    CORSMiddleware,

    # ========================================================
    # ORIGINES EXACTES AUTORISÉES
    # ========================================================

    allow_origins=[
        VERCEL_PRODUCTION_ORIGIN,
    ],

    # ========================================================
    # ORIGINES AUTORISÉES PAR REGEX
    # ========================================================

    # - Previews Vercel
    # - Expo Web / localhost
    allow_origin_regex=(
        f"(?:{VERCEL_ORIGIN_REGEX[1:-1]})"
        f"|(?:{LOCALHOST_ORIGIN_REGEX[1:-1]})"
    ),

    # ========================================================
    # AUTHENTIFICATION
    # ========================================================

    allow_credentials=True,

    # ========================================================
    # MÉTHODES
    # ========================================================

    allow_methods=[
        "*",
    ],

    # ========================================================
    # HEADERS
    # ========================================================

    allow_headers=[
        "*",
    ],
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
