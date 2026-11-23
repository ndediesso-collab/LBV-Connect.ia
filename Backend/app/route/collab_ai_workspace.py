"""Explicit workspaces for private and collective AI, staging-only.

The old mono-workspace SQL routines remain authoritative for reservation and
settlement. The new identity RPC refuses this route after multi-admission cutover.
"""
from uuid import UUID

from fastapi import APIRouter, Header
from pydantic import BaseModel, Field

from app.core.supabase import supabase
from app.route.collab_profiles import require_user
from app.services.oria_collab_ai_workspace_service import ScopedAiWorkspaceService

router = APIRouter(prefix="/collaboratif/workspaces/{workspace_id}/ai",
                   tags=["ORIA Collaboratif IA et quotas"])


class PrivateAsk(BaseModel):
    request_id: UUID
    model: str = Field(min_length=1, max_length=80)
    message: str = Field(min_length=1, max_length=8000)
    reasoning_mode: str = "balanced"


class GroupAsk(BaseModel):
    request_id: UUID
    model: str = Field(min_length=1, max_length=80)
    prompt: str = Field(min_length=1, max_length=4000)
    reasoning_mode: str = "balanced"


def actor(user_id: str | None, authorization: str | None) -> str:
    return require_user(user_id, authorization)


@router.get("/models")
def scoped_models(workspace_id: UUID,
                  user_id: str | None = Header(None, alias="user-id"),
                  authorization: str | None = Header(None, alias="authorization")):
    return ScopedAiWorkspaceService(supabase).models(actor(user_id, authorization),str(workspace_id))


@router.post("/private/{conversation_id}/ask")
async def private_ask(workspace_id: UUID, conversation_id: UUID, body: PrivateAsk,
                      user_id: str | None = Header(None, alias="user-id"),
                      authorization: str | None = Header(None, alias="authorization")):
    return await ScopedAiWorkspaceService(supabase).private_ask(
        actor(user_id, authorization), str(workspace_id), str(conversation_id),
        str(body.request_id), body.model, body.message, body.reasoning_mode,
    )


@router.post("/groups/{group_id}/ask")
async def group_ask(workspace_id: UUID, group_id: UUID, body: GroupAsk,
                    user_id: str | None = Header(None, alias="user-id"),
                    authorization: str | None = Header(None, alias="authorization")):
    return await ScopedAiWorkspaceService(supabase).group_ask(
        actor(user_id, authorization), str(workspace_id), str(group_id),
        str(body.request_id), body.model, body.prompt, body.reasoning_mode,
    )
