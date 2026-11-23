"""Routes 6B1 : annuaire des espaces et renommage par le proprietaire.

Aucune selection implicite de l'espace courant pour les RPC historiques.
"""
from __future__ import annotations

from fastapi import APIRouter, Header, HTTPException
from pydantic import BaseModel, Field

from app.core.supabase import supabase
from app.route.collaboratif import _enabled, _identity
from app.services.oria_collab_workspace_directory_service import WorkspaceDirectoryService

router = APIRouter(prefix="/collaboratif", tags=["ORIA Collaboratif espaces"])


class WorkspaceNameInput(BaseModel):
    name: str = Field(min_length=3, max_length=80)


def _actor(user_id: str | None, authorization: str | None) -> str:
    actor = _identity(user_id, authorization)
    if not _enabled():
        raise HTTPException(503, "ORIA Collaboratif est désactivé.")
    return actor


@router.get("/workspaces")
def list_my_workspaces(
    user_id: str | None = Header(default=None, alias="user-id"),
    authorization: str | None = Header(default=None, alias="authorization"),
):
    return WorkspaceDirectoryService(supabase).list_mine(_actor(user_id, authorization))


@router.patch("/workspaces/mine")
def rename_workspace(
    body: WorkspaceNameInput,
    user_id: str | None = Header(default=None, alias="user-id"),
    authorization: str | None = Header(default=None, alias="authorization"),
):
    return WorkspaceDirectoryService(supabase).rename_mine(
        _actor(user_id, authorization), body.name,
    )
