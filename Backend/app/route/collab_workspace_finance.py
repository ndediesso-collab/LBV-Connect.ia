"""API de lecture des fonds d'un espace : jamais d'écriture ni de paiement."""
from __future__ import annotations

import os
from uuid import UUID

from fastapi import APIRouter, Header, HTTPException

from app.core.supabase import supabase
from app.route.collab_profiles import require_user
from app.services.oria_collab_workspace_finance_service import WorkspaceFinanceService

router = APIRouter(prefix="/collaboratif/workspaces/{workspace_id}/finance",
                   tags=["ORIA Collaboratif finances par espace"])


def _actor(user_id: str | None, authorization: str | None) -> str:
    if os.getenv("ORIA_COLLAB_WORKSPACE_FINANCE_ENABLED", "0").strip() != "1":
        raise HTTPException(503, "Finances par espace non activées.")
    return require_user(user_id, authorization)


@router.get("/wallet")
def wallet(workspace_id: UUID, user_id: str | None = Header(None, alias="user-id"),
           authorization: str | None = Header(None, alias="authorization")):
    actor = _actor(user_id, authorization)
    return WorkspaceFinanceService(supabase).wallet(actor, str(workspace_id))


@router.get("/events")
def events(workspace_id: UUID, user_id: str | None = Header(None, alias="user-id"),
           authorization: str | None = Header(None, alias="authorization")):
    actor = _actor(user_id, authorization)
    return WorkspaceFinanceService(supabase).events(actor, str(workspace_id))
