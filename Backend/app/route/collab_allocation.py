"""P15 : proposition et confirmation atomique de la répartition (propriétaire uniquement)."""
from __future__ import annotations

from datetime import datetime
from typing import Literal
from uuid import UUID

from fastapi import APIRouter, Header
from pydantic import BaseModel, Field

from app.core.supabase import supabase
from app.route.collab_profiles import require_user
from app.services.oria_collab_allocation_service import AllocationService

router = APIRouter(prefix="/collaboratif/workspaces/{workspace_id}/allocation",
                   tags=["ORIA Collaboratif répartition assistée"])


class AllocationItem(BaseModel):
    user_id: UUID
    available: int = Field(ge=0, le=1_200_000_000)


class AllocationChoice(BaseModel):
    decision_id: UUID
    mode: Literal["equal", "manual", "later"]
    allocations: list[AllocationItem] = Field(default_factory=list, max_length=6)
    members_fingerprint: str = Field(pattern=r"^[a-f0-9]{32}$")
    pack_activated_at: datetime


@router.get("/preview")
def preview(workspace_id: UUID,
            user_id: str | None = Header(None, alias="user-id"),
            authorization: str | None = Header(None, alias="authorization")):
    uid = require_user(user_id, authorization)
    return AllocationService(supabase).preview(uid, str(workspace_id))


@router.post("/apply")
def apply(workspace_id: UUID, body: AllocationChoice,
          user_id: str | None = Header(None, alias="user-id"),
          authorization: str | None = Header(None, alias="authorization")):
    uid = require_user(user_id, authorization)
    return AllocationService(supabase).apply(
        uid, str(workspace_id), decision_id=str(body.decision_id),
        mode=body.mode,
        allocations=[{"user_id": str(item.user_id), "available": item.available}
                     for item in body.allocations],
        fingerprint=body.members_fingerprint,
        pack_activated_at=body.pack_activated_at.isoformat(),
    )
