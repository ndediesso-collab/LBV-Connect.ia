from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.routes import router
from app.route.ai import router as ai_router


app = FastAPI(
    title="LBV-Connect Backend",
)


# ============================================================
# CORS — FRONTEND VERCEL
# ============================================================

ALLOWED_ORIGINS = [
    "https://lbv-connect-2shs981lh-ndediesso-collabs-projects.vercel.app",
]


app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ============================================================
# ROUTES
# ============================================================

app.include_router(router)
app.include_router(ai_router)