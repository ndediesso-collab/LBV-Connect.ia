from fastapi import FastAPI

from app.routes import router
from app.route.ai import router as ai_router


app = FastAPI(
    title="LBV-Connect Backend",
)

app.include_router(router)
app.include_router(ai_router)