"""API group chat ORIA Collaboratif Phase 5A — messagerie uniquement.

L'activation nécessite les deux flags ORIA_COLLABORATIF_ENABLED=1 et
ORIA_COLLAB_GROUPS_ENABLED=1. Aucune route de paiement ou de génération IA.
"""
import os
from uuid import UUID

from fastapi import APIRouter, Header, HTTPException, Query
from pydantic import BaseModel, Field

from app.core.supabase import supabase
from app.route.collab_profiles import require_user
from app.services.oria_collab_groups_service import CollabGroupsService

router = APIRouter(prefix="/collaboratif/groups", tags=["ORIA Collaboratif groupes"])


def _actor(user_id: str | None, authorization: str | None) -> str:
    actor = require_user(user_id, authorization)
    if os.getenv("ORIA_COLLAB_GROUPS_ENABLED", "0").strip() != "1":
        raise HTTPException(status_code=503, detail="Les groupes ORIA ne sont pas encore activés.")
    return actor


class NewGroup(BaseModel):
    title: str = Field(min_length=1, max_length=100)
    description: str = Field(default="", max_length=500)


class ParticipantChange(BaseModel):
    member_user_id: UUID
    added: bool


class ArchiveChange(BaseModel):
    archived: bool


class GroupMessage(BaseModel):
    client_message_id: UUID
    content: str = Field(min_length=1, max_length=4000)


@router.get("")
def list_groups(user_id: str | None = Header(None, alias="user-id"),
                authorization: str | None = Header(None, alias="authorization")):
    return CollabGroupsService(supabase).list_groups(_actor(user_id, authorization))


@router.post("", status_code=201)
def create_group(body: NewGroup,
                 user_id: str | None = Header(None, alias="user-id"),
                 authorization: str | None = Header(None, alias="authorization")):
    return CollabGroupsService(supabase).create(_actor(user_id, authorization),
                                                 body.title, body.description)


@router.post("/{group_id}/participants")
def set_participant(group_id: UUID, body: ParticipantChange,
                    user_id: str | None = Header(None, alias="user-id"),
                    authorization: str | None = Header(None, alias="authorization")):
    return CollabGroupsService(supabase).set_participant(
        _actor(user_id, authorization), group_id, body.member_user_id, body.added)


@router.patch("/{group_id}/archive")
def archive(group_id: UUID, body: ArchiveChange,
            user_id: str | None = Header(None, alias="user-id"),
            authorization: str | None = Header(None, alias="authorization")):
    return CollabGroupsService(supabase).archive(_actor(user_id, authorization),
                                                 group_id, body.archived)


@router.get("/{group_id}/messages")
def messages(group_id: UUID, before: UUID | None = Query(None),
             limit: int = Query(50, ge=1, le=100),
             user_id: str | None = Header(None, alias="user-id"),
             authorization: str | None = Header(None, alias="authorization")):
    return CollabGroupsService(supabase).messages(
        _actor(user_id, authorization), group_id, before, limit)


@router.post("/{group_id}/messages")
def post(group_id: UUID, body: GroupMessage,
         user_id: str | None = Header(None, alias="user-id"),
         authorization: str | None = Header(None, alias="authorization")):
    return CollabGroupsService(supabase).post(
        _actor(user_id, authorization), group_id, body.client_message_id, body.content)
