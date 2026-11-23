"""Explicit workspaces for private and collective AI, staging-only.

The old mono-workspace SQL routines remain authoritative for reservation and
settlement. The new identity RPC refuses this route after multi-admission cutover.
"""
import asyncio
import json
from uuid import UUID
from typing import Literal

from fastapi import APIRouter, Header, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from app.core.supabase import supabase
from app.route.collab_profiles import require_user
from app.services.oria_collab_ai_workspace_service import ScopedAiWorkspaceService
from app.services.oria_collab_delivery_supervisor import await_independent_delivery

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
    actor(user_id, authorization)
    raise HTTPException(410, "Chats personnels retirés d’ORIA Collaboratif. Utilisez ORIA classique hors de l’espace.")


@router.post("/groups/{group_id}/ask")
async def group_ask(workspace_id: UUID, group_id: UUID, body: GroupAsk,
                    user_id: str | None = Header(None, alias="user-id"),
                    authorization: str | None = Header(None, alias="authorization")):
    uid = actor(user_id, authorization)
    return await await_independent_delivery(
        f'group:{workspace_id}:{body.request_id}',
        lambda: ScopedAiWorkspaceService(supabase).group_ask(
            uid, str(workspace_id), str(group_id),
            str(body.request_id), body.model, body.prompt, body.reasoning_mode, body.web,
        ),
    )


@router.get("/groups/{group_id}/jobs/latest")
def latest_group_job(workspace_id: UUID, group_id: UUID,
                     user_id: str | None = Header(None, alias="user-id"),
                     authorization: str | None = Header(None, alias="authorization")):
    return ScopedAiWorkspaceService(supabase).latest_group_delivery(
        actor(user_id, authorization), str(workspace_id), str(group_id))


@router.get("/groups/{group_id}/jobs/{request_id}")
def group_delivery_status(workspace_id: UUID, group_id: UUID, request_id: UUID,
                         user_id: str | None = Header(None, alias="user-id"),
                         authorization: str | None = Header(None, alias="authorization")):
    return ScopedAiWorkspaceService(supabase).delivery_status(
        actor(user_id, authorization), str(workspace_id), "group",
        str(group_id), str(request_id))


@router.get("/groups/{group_id}/jobs/{request_id}/stream")
async def group_stream(workspace_id: UUID, group_id: UUID, request_id: UUID,
                       user_id: str | None = Header(None, alias='user-id'),
                       authorization: str | None = Header(None, alias='authorization')):
    """Authenticated SSE snapshots. Disconnecting only stops this VIEWER."""
    uid = actor(user_id, authorization)
    service = ScopedAiWorkspaceService(supabase)
    service.authorize(uid, str(workspace_id), 'group', str(group_id))

    async def events():
        marker = None
        # Browser reconnects every <= 30 seconds, keeping Render requests short.
        for _ in range(39):
            try:
                state = await asyncio.to_thread(
                    service.delivery_status, uid, str(workspace_id), 'group',
                    str(group_id), str(request_id),
                )
            except HTTPException as exc:
                if exc.status_code == 404:
                    yield ': en_attente_de_reservation\n\n'
                    await asyncio.sleep(.7)
                    continue
                yield 'event: erreur\ndata: {"state":"unknown"}\n\n'
                return
            signature = (state.get('state'), state.get('seq'), state.get('phase'))
            if signature != marker:
                marker = signature
                yield 'event: snapshot\ndata: '+json.dumps(state, ensure_ascii=False)+'\n\n'
            if state.get('state') in {'settled','released','uncertain','needs_review','failed'}:
                return
            await asyncio.sleep(.7)
        yield ': reconnecter\n\n'

    return StreamingResponse(events(), media_type='text/event-stream', headers={
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        'X-Accel-Buffering': 'no', 'Connection': 'keep-alive',
    })


@router.post("/groups/{group_id}/jobs/{request_id}/recover")
def group_recover_receipt(workspace_id: UUID, group_id: UUID, request_id: UUID,
                          user_id: str | None = Header(None, alias='user-id'),
                          authorization: str | None = Header(None, alias='authorization')):
    """Finish a saved provider receipt, NEVER regenerate or charge twice."""
    uid = actor(user_id, authorization)
    ScopedAiWorkspaceService(supabase).authorize(
        uid, str(workspace_id), 'group', str(group_id))
    from app.services.oria_collab_stream_store_v1 import settle_saved_receipt
    return settle_saved_receipt(
        supabase, actor=uid, workspace=str(workspace_id),
        group=str(group_id), request=str(request_id),
    )


@router.get("/private/{conversation_id}/jobs/{request_id}")
def private_delivery_status(workspace_id: UUID, conversation_id: UUID, request_id: UUID,
                           user_id: str | None = Header(None, alias="user-id"),
                           authorization: str | None = Header(None, alias="authorization")):
    return ScopedAiWorkspaceService(supabase).delivery_status(
        actor(user_id, authorization), str(workspace_id), "private",
        str(conversation_id), str(request_id))


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
