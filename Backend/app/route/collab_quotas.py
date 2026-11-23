"""Répartition professionnelle des quotas : JWT, rôle et PostgreSQL revérifiés."""
from uuid import UUID

from fastapi import APIRouter, Header
from pydantic import BaseModel, Field

from app.core.supabase import supabase
from app.route.collab_profiles import require_user
from app.services.oria_collab_quotas_service import CollabQuotaService

router = APIRouter(prefix="/collaboratif/quotas", tags=["ORIA Collaboratif quotas"])


class TransferInput(BaseModel):
    from_user_id: UUID
    to_user_id: UUID
    amount: int = Field(ge=1, le=1_200_000_000)
    source: str = Field(default="pack", pattern=r"^(pack|personal)$")


@router.get("")
def quota_snapshot(
    user_id: str | None = Header(None, alias="user-id"),
    authorization: str | None = Header(None, alias="authorization"),
):
    return CollabQuotaService(supabase).snapshot(require_user(user_id, authorization))


@router.get("/movements")
def quota_movements(
    user_id: str | None = Header(None, alias="user-id"),
    authorization: str | None = Header(None, alias="authorization"),
):
    return CollabQuotaService(supabase).movements(require_user(user_id, authorization))


@router.post("/transfers")
def transfer(body: TransferInput,
    user_id: str | None = Header(None, alias="user-id"),
    authorization: str | None = Header(None, alias="authorization"),
):
    return CollabQuotaService(supabase).transfer(
        require_user(user_id, authorization),
        from_user_id=str(body.from_user_id),to_user_id=str(body.to_user_id),
        credits=body.amount, source=body.source,
    )


class ReconcileInput(BaseModel):
    source_user_id: UUID
    amount: int = Field(ge=1,le=1_200_000_000)


@router.post("/reconcile")
def reconcile_deficit(body: ReconcileInput,
    user_id: str | None = Header(None, alias="user-id"),
    authorization: str | None = Header(None, alias="authorization"),
):
    return CollabQuotaService(supabase).reconcile(
        require_user(user_id, authorization),
        source_user_id=str(body.source_user_id),credits=body.amount,
    )
