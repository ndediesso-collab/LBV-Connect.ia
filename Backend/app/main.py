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

# Autorise :
# - les deployments Vercel du projet LBV-Connect
# - le domaine de production lorsqu'il sera défini
#
# Les URLs de preview Vercel peuvent changer à chaque
# déploiement : elles sont donc gérées dynamiquement.

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

app.include_router(router)
app.include_router(ai_router)