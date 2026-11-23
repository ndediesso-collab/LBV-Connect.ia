"""Routes sécurisées de création, de copie et d'acceptation des invitations par lien."""
from __future__ import annotations

from uuid import UUID
from fastapi import APIRouter, Header, HTTPException
from pydantic import BaseModel, Field

from app.core.supabase import supabase
from app.route.collaboratif import _enabled, _identity
from app.services.oria_collab_share_invites_service import ShareInvitesService, require_share_enabled

router = APIRouter(prefix="/collaboratif", tags=["ORIA Collaboratif liens"])


def ready() -> None:
    if not _enabled():
        raise HTTPException(503, "ORIA Collaboratif désactivé.")
    require_share_enabled()


def actor(user_id: str | None, authorization: str | None) -> str:
    ready()
    return _identity(user_id, authorization)


class Secret(BaseModel):
    token: str = Field(min_length=32, max_length=128)


class Accept(Secret):
    first_name: str = Field(min_length=1, max_length=60)
    last_name: str = Field(min_length=1, max_length=60)
    avatar_key: str = "ink"
    supervision_accepted: bool


@router.get("/workspaces/{workspace_id}/share-invitations")
def list_share_invitations(
    workspace_id: UUID,
    user_id: str | None = Header(default=None, alias="user-id"),
    authorization: str | None = Header(default=None, alias="authorization"),
):
    return ShareInvitesService(supabase).list(actor(user_id, authorization), str(workspace_id))


@router.post("/workspaces/{workspace_id}/share-invitations", status_code=201)
def issue_share_invitation(
    workspace_id: UUID,
    user_id: str | None = Header(default=None, alias="user-id"),
    authorization: str | None = Header(default=None, alias="authorization"),
):
    return ShareInvitesService(supabase).issue(actor(user_id, authorization), str(workspace_id))


@router.post("/workspaces/{workspace_id}/share-invitations/{invitation_id}/revoke")
def revoke_share_invitation(
    workspace_id: UUID, invitation_id: UUID,
    user_id: str | None = Header(default=None, alias="user-id"),
    authorization: str | None = Header(default=None, alias="authorization"),
):
    return ShareInvitesService(supabase).revoke(
        actor(user_id, authorization), str(workspace_id), str(invitation_id))


@router.post("/share-invitations/preview")
def preview_share_invitation(body: Secret):
    ready()
    return ShareInvitesService(supabase).preview(body.token)


@router.post("/share-invitations/accept")
def accept_share_invitation(
    body: Accept,
    user_id: str | None = Header(default=None, alias="user-id"),
    authorization: str | None = Header(default=None, alias="authorization"),
):
    return ShareInvitesService(supabase).accept(
        actor(user_id, authorization), body.token, body.first_name,
        body.last_name, body.avatar_key, body.supervision_accepted)
