"""Routes ORIA Collaboratif Phase 2 — autorisations refaites à chaque appel."""
from uuid import UUID
import os
from fastapi import APIRouter, Header, HTTPException
from pydantic import BaseModel, Field

from app.core.supabase import supabase
from app.route.collaboratif import _enabled, _identity
from app.services.oria_collab_profiles_service import CollabProfilesService

router = APIRouter(prefix="/collaboratif", tags=["ORIA Collaboratif profils"])


def require_user(user_id: str | None, authorization: str | None) -> str:
    verified = _identity(user_id, authorization)
    if not _enabled():
        raise HTTPException(503, "ORIA Collaboratif est désactivé.")
    return verified


class InvitationInput(BaseModel):
    phone_e164: str = Field(min_length=8, max_length=30)


class AcceptInput(BaseModel):
    token: str = Field(min_length=32, max_length=128)
    first_name: str = Field(min_length=1, max_length=60)
    last_name: str = Field(min_length=1, max_length=60)
    avatar_key: str = "ink"
    supervision_accepted: bool


class ChangeStatusInput(BaseModel):
    status: str


class EditProfileInput(BaseModel):
    first_name: str = Field(min_length=1, max_length=60)
    last_name: str = Field(min_length=1, max_length=60)
    avatar_key: str = "ink"


@router.get("/profiles")
def profiles(user_id: str | None = Header(default=None, alias="user-id"),
             authorization: str | None = Header(default=None, alias="authorization")):
    return CollabProfilesService(supabase).list_profiles(require_user(user_id, authorization))


@router.post("/invitations", status_code=201)
def invite(body: InvitationInput,
           user_id: str | None = Header(default=None, alias="user-id"),
           authorization: str | None = Header(default=None, alias="authorization")):
    if os.getenv("ORIA_COLLAB_EMAIL_INVITES_ENABLED", "0") == "1" or os.getenv("ORIA_COLLAB_SHARE_INVITES_ENABLED", "0") == "1":
        raise HTTPException(409, "Invitations par téléphone désactivées : utilisez les invitations e-mail.")
    return CollabProfilesService(supabase).issue_invite(
        require_user(user_id, authorization), body.phone_e164)


@router.post("/invitations/accept")
def accept(body: AcceptInput,
           user_id: str | None = Header(default=None, alias="user-id"),
           authorization: str | None = Header(default=None, alias="authorization")):
    # Le SQL revalide auth.users.phone_confirmed_at + numéro exact invité.
    return CollabProfilesService(supabase).accept_invite(
        require_user(user_id, authorization), body.token,
        body.first_name, body.last_name, body.avatar_key, body.supervision_accepted)


@router.post("/invitations/{invite_id}/revoke")
def revoke(invite_id: UUID,
           user_id: str | None = Header(default=None, alias="user-id"),
           authorization: str | None = Header(default=None, alias="authorization")):
    return CollabProfilesService(supabase).revoke(
        require_user(user_id, authorization), invite_id)


@router.patch("/members/{target_user_id}/status")
def change_status(target_user_id: UUID, body: ChangeStatusInput,
           user_id: str | None = Header(default=None, alias="user-id"),
           authorization: str | None = Header(default=None, alias="authorization")):
    return CollabProfilesService(supabase).set_status(
        require_user(user_id, authorization), target_user_id, body.status)


@router.patch("/profile/me")
def edit_me(body: EditProfileInput,
           user_id: str | None = Header(default=None, alias="user-id"),
           authorization: str | None = Header(default=None, alias="authorization")):
    return CollabProfilesService(supabase).update_profile(
        require_user(user_id, authorization), body.first_name,
        body.last_name, body.avatar_key)
