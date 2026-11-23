"""Explicit workspaces for private and collective AI, staging-only.

The old mono-workspace SQL routines remain authoritative for reservation and
settlement. The new identity RPC refuses this route after multi-admission cutover.
"""
from uuid import UUID
from typing import Literal

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
    web: bool = False


class GroupAsk(BaseModel):
    request_id: UUID
    model: str = Field(min_length=1, max_length=80)
    prompt: str = Field(min_length=1, max_length=4000)
    reasoning_mode: str = "balanced"
    web: bool = False


class ArtifactPlan(BaseModel):
    kind: Literal['group', 'private']
    target_id: UUID
    message: str = Field(min_length=1, max_length=8000)
    artifact_type: str | None = Field(default=None, max_length=240)


class ChatPreferences(BaseModel):
    model: str = Field(min_length=1, max_length=80)
    reasoning_mode: str = Field(pattern='^(fast|balanced|deep)$')


def actor(user_id: str | None, authorization: str | None) -> str:
    return require_user(user_id, authorization)


@router.get("/models")
def scoped_models(workspace_id: UUID,
                  user_id: str | None = Header(None, alias="user-id"),
                  authorization: str | None = Header(None, alias="authorization")):
    return ScopedAiWorkspaceService(supabase).models(actor(user_id, authorization),str(workspace_id))


@router.post('/artifacts/plan')
def plan_workspace_artifacts(workspace_id: UUID, body: ArtifactPlan,
                             user_id: str | None = Header(None, alias='user-id'),
                             authorization: str | None = Header(None, alias='authorization')):
    """Lecture seule : intentions de fichiers détectées par le moteur du chat principal.

    Ce endpoint ne génère pas de fichier et ne réserve aucun crédit.
    """
    return ScopedAiWorkspaceService(supabase).plan_artifacts(
        actor(user_id, authorization), str(workspace_id),
        body.kind, str(body.target_id), body.message, body.artifact_type,
    )


@router.patch('/preferences')
def save_chat_preferences(workspace_id: UUID, body: ChatPreferences,
                          user_id: str | None = Header(None, alias='user-id'),
                          authorization: str | None = Header(None, alias='authorization')):
    return ScopedAiWorkspaceService(supabase).save_preferences(
        actor(user_id, authorization), str(workspace_id),
        body.model, body.reasoning_mode)


@router.post("/private/{conversation_id}/ask")
async def private_ask(workspace_id: UUID, conversation_id: UUID, body: PrivateAsk,
                      user_id: str | None = Header(None, alias="user-id"),
                      authorization: str | None = Header(None, alias="authorization")):
    return await ScopedAiWorkspaceService(supabase).private_ask(
        actor(user_id, authorization), str(workspace_id), str(conversation_id),
        str(body.request_id), body.model, body.message, body.reasoning_mode,body.web,
    )


@router.post("/groups/{group_id}/ask")
async def group_ask(workspace_id: UUID, group_id: UUID, body: GroupAsk,
                    user_id: str | None = Header(None, alias="user-id"),
                    authorization: str | None = Header(None, alias="authorization")):
    return await ScopedAiWorkspaceService(supabase).group_ask(
        actor(user_id, authorization), str(workspace_id), str(group_id),
        str(body.request_id), body.model, body.prompt, body.reasoning_mode,body.web,
    )


@router.get('/private/{conversation_id}/files')
def private_generated_files(workspace_id: UUID, conversation_id: UUID,
                            user_id: str | None = Header(None,alias='user-id'),
                            authorization: str | None = Header(None,alias='authorization')):
    return ScopedAiWorkspaceService(supabase).private_artifacts(
        actor(user_id,authorization),str(workspace_id),str(conversation_id))


@router.get('/private/files/{file_id}/url')
def private_generated_file_url(workspace_id: UUID,file_id: UUID,
                               user_id: str | None = Header(None,alias='user-id'),
                               authorization: str | None = Header(None,alias='authorization')):
    return ScopedAiWorkspaceService(supabase).private_artifact_url(
        actor(user_id,authorization),str(workspace_id),str(file_id))
