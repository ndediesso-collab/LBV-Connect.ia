"""Email invitations 6B2A. Toutes les RPC restent reservees au backend."""
from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Header, HTTPException
from pydantic import BaseModel, Field

from app.core.supabase import supabase
from app.route.collaboratif import _identity, _enabled
from app.services.oria_collab_email_invites_service import (
    EmailInvitationsService, require_email_feature,
)

router = APIRouter(prefix="/collaboratif", tags=["ORIA Collaboratif invitations email"])


def _ready() -> None:
    if not _enabled():
        raise HTTPException(503, "ORIA Collaboratif désactivé.")
    require_email_feature()


def _actor(user_id: str | None, authorization: str | None) -> str:
    _ready()
    return _identity(user_id, authorization)


class Issue(BaseModel):
    email: str = Field(min_length=5, max_length=254)


class Preview(BaseModel):
    token: str = Field(min_length=32, max_length=128)


class Accept(Preview):
    first_name: str = Field(min_length=1, max_length=60)
    last_name: str = Field(min_length=1, max_length=60)
    avatar_key: str = "ink"
    supervision_accepted: bool


@router.get("/workspaces/{workspace_id}/email-invitations")
def list_email_invitations(
    workspace_id: UUID,
    user_id: str | None = Header(default=None, alias="user-id"),
    authorization: str | None = Header(default=None, alias="authorization"),
):
    return EmailInvitationsService(supabase).list(_actor(user_id, authorization), str(workspace_id))


@router.post("/workspaces/{workspace_id}/email-invitations", status_code=201)
def issue_email_invitation(
    workspace_id: UUID, body: Issue,
    user_id: str | None = Header(default=None, alias="user-id"),
    authorization: str | None = Header(default=None, alias="authorization"),
):
    return EmailInvitationsService(supabase).issue(_actor(user_id, authorization), str(workspace_id), body.email)


@router.post("/workspaces/{workspace_id}/email-invitations/{invitation_id}/resend")
def resend_email_invitation(
    workspace_id: UUID, invitation_id: UUID,
    user_id: str | None = Header(default=None, alias="user-id"),
    authorization: str | None = Header(default=None, alias="authorization"),
):
    return EmailInvitationsService(supabase).resend(
        _actor(user_id, authorization), str(workspace_id), str(invitation_id),
    )


@router.post("/workspaces/{workspace_id}/email-invitations/{invitation_id}/revoke")
def revoke_email_invitation(
    workspace_id: UUID, invitation_id: UUID,
    user_id: str | None = Header(default=None, alias="user-id"),
    authorization: str | None = Header(default=None, alias="authorization"),
):
    return EmailInvitationsService(supabase).revoke(
        _actor(user_id, authorization), str(workspace_id), str(invitation_id),
    )


@router.post("/email-invitations/preview")
def preview_email_invitation(body: Preview):
    _ready()
    # Un lien de 256 bits est requis; ne divulgue que le nom de l'espace.
    return EmailInvitationsService(supabase).preview(body.token)


@router.post("/email-invitations/accept")
def accept_email_invitation(
    body: Accept,
    user_id: str | None = Header(default=None, alias="user-id"),
    authorization: str | None = Header(default=None, alias="authorization"),
):
    return EmailInvitationsService(supabase).accept(
        _actor(user_id, authorization), body.token, body.first_name,
        body.last_name, body.avatar_key, body.supervision_accepted,
    )
