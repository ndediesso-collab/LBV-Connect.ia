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
#
# Exemple :
# https://lbv-connect-xxxxx-ndediesso-collabs-projects.vercel.app
#
# Le domaine de production ci-dessus est géré séparément.
VERCEL_ORIGIN_REGEX = (
    r"^https://lbv-connect-[a-z0-9-]+"
    r"-ndediesso-collabs-projects\.vercel\.app$"
)


app.add_middleware(
    CORSMiddleware,

    # ========================================================
    # ORIGINES AUTORISÉES
    # ========================================================

    allow_origins=[
        VERCEL_PRODUCTION_ORIGIN,
    ],

    # Previews Vercel
    allow_origin_regex=VERCEL_ORIGIN_REGEX,

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
# ROUTES
# ============================================================

# Routes générales :
#
# - crédits
# - wallet
# - transactions
# - conversations
# - historique
app.include_router(router)


# ============================================================
# ROUTES IA
# ============================================================

# - /ai/chat
# - streaming IA selon les routes disponibles
app.include_router(ai_router)