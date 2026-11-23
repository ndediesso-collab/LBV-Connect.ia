"""API ORIA Collaboratif 4A : historique indépendant et chat texte personnel."""
from uuid import UUID

from fastapi import APIRouter, Header, Query, HTTPException
from pydantic import BaseModel, Field

from app.core.supabase import supabase
from app.route.collab_profiles import require_user
from app.services.oria_collab_private_chat_service import PrivateChatService

router = APIRouter(prefix="/collaboratif/private", tags=["ORIA Collaboratif privé"])


class ConversationInput(BaseModel):
    title: str = Field(default="Nouvelle conversation",max_length=120)


class ChatInput(BaseModel):
    request_id: UUID
    model: str = Field(min_length=2,max_length=100)
    message: str = Field(min_length=1,max_length=8000)
    reasoning_mode: str = "balanced"


def _actor(user_id: str | None, authorization: str | None) -> str:
    return require_user(user_id,authorization)


@router.get("/models")
def models(user_id: str | None = Header(None,alias="user-id"),
           authorization: str | None = Header(None,alias="authorization")):
    return PrivateChatService(supabase).models(_actor(user_id,authorization))


@router.get("/conversations")
def list_conversations(member_user_id: UUID | None = Query(None),
         user_id: str | None = Header(None,alias="user-id"),
         authorization: str | None = Header(None,alias="authorization")):
    return PrivateChatService(supabase).list_conversations(
        _actor(user_id,authorization), str(member_user_id) if member_user_id else None)


@router.post("/conversations", status_code=201)
def new_conversation(body:ConversationInput,
         user_id: str | None = Header(None,alias="user-id"),
         authorization: str | None = Header(None,alias="authorization")):
    _actor(user_id,authorization)
    raise HTTPException(410, "Chat ORIA personnel inaccessible dans cet espace. Utilisez le chat principal.")


@router.get("/conversations/{conversation_id}/messages")
def messages(conversation_id:UUID,
         user_id: str | None = Header(None,alias="user-id"),
         authorization: str | None = Header(None,alias="authorization")):
    return PrivateChatService(supabase).messages(_actor(user_id,authorization),str(conversation_id))


@router.post("/conversations/{conversation_id}/chat")
async def chat(conversation_id:UUID, body:ChatInput,
         user_id: str | None = Header(None,alias="user-id"),
         authorization: str | None = Header(None,alias="authorization")):
    _actor(user_id,authorization)
    raise HTTPException(410, "Chat ORIA personnel inaccessible dans cet espace. Utilisez le chat principal.")


@router.get("/jobs/{request_id}")
def job(request_id:UUID,
         user_id: str | None = Header(None,alias="user-id"),
         authorization: str | None = Header(None,alias="authorization")):
    return PrivateChatService(supabase).job(_actor(user_id,authorization),str(request_id))
