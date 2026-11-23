"""Independent group-AI routes. No modifications to legacy /ai/chat or /payments."""
from __future__ import annotations

from uuid import UUID
from fastapi import APIRouter, Header
from pydantic import BaseModel, Field

from app.core.supabase import supabase
from app.route.collab_profiles import require_user
from app.services.oria_collab_group_ai_service import GroupAiService

router = APIRouter(prefix="/collaboratif/groups", tags=["ORIA Collaboratif IA collective"])


class GroupAIAsk(BaseModel):
    request_id: UUID
    model: str = Field(min_length=1, max_length=80)
    prompt: str = Field(min_length=1, max_length=4000)
    reasoning_mode: str = "balanced"


class GroupAIPolicy(BaseModel):
    allow_unequal: bool


@router.get("/ai/models")
def models(user_id: str | None = Header(None, alias="user-id"),
           authorization: str | None = Header(None, alias="authorization")):
    return GroupAiService(supabase).models(require_user(user_id, authorization))


@router.get("/ai/jobs/{request_id}")
def status(request_id: UUID,
           user_id: str | None = Header(None, alias="user-id"),
           authorization: str | None = Header(None, alias="authorization")):
    return GroupAiService(supabase).status(require_user(user_id, authorization), str(request_id))


@router.patch("/{group_id}/ai/policy")
def policy(group_id: UUID, body: GroupAIPolicy,
           user_id: str | None = Header(None, alias="user-id"),
           authorization: str | None = Header(None, alias="authorization")):
    return GroupAiService(supabase).policy(require_user(user_id, authorization), str(group_id), body.allow_unequal)


@router.post("/{group_id}/ai/ask")
async def ask(group_id: UUID, body: GroupAIAsk,
            user_id: str | None = Header(None, alias="user-id"),
            authorization: str | None = Header(None, alias="authorization")):
    return await GroupAiService(supabase).ask(
        require_user(user_id, authorization), group_id=str(group_id),
        request_id=str(body.request_id), model=body.model,
        prompt=body.prompt, reasoning_mode=body.reasoning_mode)
