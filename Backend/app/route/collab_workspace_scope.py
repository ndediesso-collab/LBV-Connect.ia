"""6B2B1: API contextuelle; ancienne API mono-espace laissée intacte."""
from __future__ import annotations

import os
from uuid import UUID

from fastapi import APIRouter, Header, HTTPException, Query
from pydantic import BaseModel, Field

from app.core.supabase import supabase
from app.route.collab_profiles import require_user
from app.services.oria_collab_workspace_scope_service import ScopedWorkspaceService

router = APIRouter(prefix="/collaboratif/workspaces/{workspace_id}/scope",
                   tags=["ORIA Collaboratif contexte explicite"])


def _actor(user_id: str | None, authorization: str | None) -> str:
    if os.getenv("ORIA_COLLAB_WORKSPACE_CONTEXT_ENABLED", "0").strip() != "1":
        raise HTTPException(503, "La consultation des espaces n'est pas encore activée.")
    return require_user(user_id, authorization)


def _service() -> ScopedWorkspaceService:
    return ScopedWorkspaceService(supabase)


class ProfileUpdate(BaseModel):
    first_name: str = Field(min_length=1, max_length=60)
    last_name: str = Field(min_length=1, max_length=60)
    avatar_key: str = Field(default="ink", pattern="^(ink|stone|paper|slate|silver|carbon)$")


@router.get("/context")
def context(workspace_id: UUID, user_id: str | None = Header(None, alias="user-id"),
            authorization: str | None = Header(None, alias="authorization")):
    return _service().context(_actor(user_id, authorization), str(workspace_id))


@router.get("/profiles")
def profiles(workspace_id: UUID, user_id: str | None = Header(None, alias="user-id"),
             authorization: str | None = Header(None, alias="authorization")):
    return _service().profiles(_actor(user_id, authorization), str(workspace_id))


@router.patch("/profile/me")
def update_profile(workspace_id: UUID, body: ProfileUpdate,
                   user_id: str | None = Header(None, alias="user-id"),
                   authorization: str | None = Header(None, alias="authorization")):
    return _service().update_profile(_actor(user_id, authorization), str(workspace_id),
                                     body.first_name, body.last_name, body.avatar_key)


@router.get("/groups")
def groups(workspace_id: UUID, user_id: str | None = Header(None, alias="user-id"),
           authorization: str | None = Header(None, alias="authorization")):
    return _service().groups(_actor(user_id, authorization), str(workspace_id))


@router.get("/groups/{group_id}/messages")
def group_messages(workspace_id: UUID, group_id: UUID,
                   before: UUID | None = Query(None), limit: int = Query(50, ge=1, le=100),
                   user_id: str | None = Header(None, alias="user-id"),
                   authorization: str | None = Header(None, alias="authorization")):
    return _service().group_messages(_actor(user_id, authorization), str(workspace_id),
                                      str(group_id), str(before) if before else None, limit)


@router.get("/private/conversations")
def private_list(workspace_id: UUID, member: UUID | None = Query(None),
                 user_id: str | None = Header(None, alias="user-id"),
                 authorization: str | None = Header(None, alias="authorization")):
    return _service().private_list(_actor(user_id, authorization), str(workspace_id),
                                    str(member) if member else None)


@router.get("/private/conversations/{conversation_id}/messages")
def private_messages(workspace_id: UUID, conversation_id: UUID,
                     user_id: str | None = Header(None, alias="user-id"),
                     authorization: str | None = Header(None, alias="authorization")):
    return _service().private_messages(_actor(user_id, authorization), str(workspace_id),
                                        str(conversation_id))


@router.get("/quota")
def quota(workspace_id: UUID, user_id: str | None = Header(None, alias="user-id"),
          authorization: str | None = Header(None, alias="authorization")):
    return _service().quota(_actor(user_id, authorization), str(workspace_id))
