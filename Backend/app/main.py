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

VERCEL_ORIGIN_REGEX = (
    r"^https://lbv-connect-[a-z0-9-]+-ndediesso-collabs-projects\.vercel\.app$"
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[],
    allow_origin_regex=VERCEL_ORIGIN_REGEX,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ============================================================
# ROUTES
# ============================================================

# Routes générales :
# - crédits
# - wallet
# - transactions
# - conversations
# - historique
app.include_router(router)

# Routes IA :
# - /ai/chat
app.include_router(ai_router)