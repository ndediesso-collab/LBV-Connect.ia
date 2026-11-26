"""HTTP API for ORIA Assistant v1. All public visitor data is server-mediated."""
from __future__ import annotations

import logging

from uuid import UUID

from fastapi import APIRouter, Depends, Header, HTTPException, Query
from pydantic import BaseModel, Field, ConfigDict

from app.core.supabase import supabase
from app.services.oria_assistant_service import (
    create_owner_assistant,
    delete_owner_assistant,
    get_owner_assistant,
    get_public_assistant,
    get_public_assistant_for_generation,
    list_owner_assistants,
    regenerate_owner_assistant_link,
    send_visitor_message,
    start_visitor_conversation,
    update_owner_assistant,
    visitor_messages,
    visitor_pending_request,
)
from app.services.oria_assistant_requests_service import (
    cancel_visitor_request_draft,
    confirm_visitor_request,
    get_owner_request,
    list_owner_requests,
    update_owner_request_status,
)

router = APIRouter(prefix="/assistant", tags=["ORIA Assistant"])
logger = logging.getLogger("oria_assistant.public")


class AssistantCreatePayload(BaseModel):
    name: str = Field(min_length=2, max_length=80)
    description: str = Field(default="", max_length=300)
    instructions: str = Field(min_length=10, max_length=12000)
    welcome_message: str = Field(default="Bonjour ! Comment puis-je vous aider ?", max_length=500)
    business_name: str = Field(default="", max_length=120)
    business_email: str = Field(default="", max_length=254)
    business_phone: str = Field(default="", max_length=40)
    whatsapp_number: str = Field(default="", max_length=40)
    collection_instructions: str = Field(default="", max_length=8000)
    is_public: bool = False


class AssistantUpdatePayload(BaseModel):
    model_config = ConfigDict(extra="forbid")
    name: str | None = Field(default=None, min_length=2, max_length=80)
    description: str | None = Field(default=None, max_length=300)
    instructions: str | None = Field(default=None, min_length=10, max_length=12000)
    welcome_message: str | None = Field(default=None, max_length=500)
    business_name: str | None = Field(default=None, max_length=120)
    business_email: str | None = Field(default=None, max_length=254)
    business_phone: str | None = Field(default=None, max_length=40)
    whatsapp_number: str | None = Field(default=None, max_length=40)
    collection_instructions: str | None = Field(default=None, max_length=8000)
    is_public: bool | None = None


class VisitorMessagePayload(BaseModel):
    request_id: str = Field(min_length=36, max_length=36)
    message: str = Field(min_length=1, max_length=8000)


class VisitorRequestConfirmationPayload(BaseModel):
    draft_id: UUID


class AssistantRequestStatusPayload(BaseModel):
    model_config = ConfigDict(extra="forbid")
    status: str = Field(min_length=3, max_length=20)


def _authenticate_owner(
    user_id: str | None,
    authorization: str | None,
) -> str:
    if not user_id or not authorization:
        raise HTTPException(401, "Authentification ORIA obligatoire.")
    token = authorization.strip()
    if token.lower().startswith("bearer "):
        token = token[7:].strip()
    if not token:
        raise HTTPException(401, "Session ORIA expirée.")
    try:
        response = supabase.auth.get_user(token)
        user = response.user
    except Exception as exc:
        raise HTTPException(401, "Session ORIA invalide ou expirée.") from exc
    if user is None:
        raise HTTPException(401, "Utilisateur non authentifié.")
    authenticated_id = str(user.id)
    if authenticated_id != str(user_id):
        raise HTTPException(403, "La session ne correspond pas au compte transmis.")
    return authenticated_id


def _owner_headers(
    user_id: str | None = Header(default=None, alias="user-id"),
    authorization: str | None = Header(default=None, alias="authorization"),
) -> str:
    return _authenticate_owner(user_id, authorization)


@router.get("/assistants")
def owner_list_assistants(owner_user_id: str = Depends(_owner_headers)):
    return {"success": True, "assistants": list_owner_assistants(owner_user_id)}


@router.post("/assistants", status_code=201)
def owner_create_assistant(
    payload: AssistantCreatePayload,
    owner_user_id: str = Depends(_owner_headers),
):
    assistant = create_owner_assistant(owner_user_id, payload.model_dump())
    return {"success": True, "assistant": assistant}


@router.get("/assistants/{assistant_id}")
def owner_get_assistant(assistant_id: UUID, owner_user_id: str = Depends(_owner_headers)):
    return {"success": True, "assistant": get_owner_assistant(owner_user_id, str(assistant_id))}


@router.patch("/assistants/{assistant_id}")
def owner_update_assistant(
    assistant_id: UUID,
    payload: AssistantUpdatePayload,
    owner_user_id: str = Depends(_owner_headers),
):
    values = payload.model_dump(exclude_unset=True)
    if any(value is None for value in values.values()):
        raise HTTPException(422, "Les champs transmis ne peuvent pas être nuls.")
    assistant = update_owner_assistant(owner_user_id, str(assistant_id), values)
    return {"success": True, "assistant": assistant}


@router.post("/assistants/{assistant_id}/regenerate-link")
def owner_regenerate_assistant_link(assistant_id: UUID, owner_user_id: str = Depends(_owner_headers)):
    assistant = regenerate_owner_assistant_link(owner_user_id, str(assistant_id))
    return {"success": True, "assistant": assistant}


@router.delete("/assistants/{assistant_id}")
def owner_delete_assistant(assistant_id: UUID, owner_user_id: str = Depends(_owner_headers)):
    delete_owner_assistant(owner_user_id, str(assistant_id))
    return {"success": True}


@router.get("/requests")
def owner_list_assistant_requests(
    assistant_id: str | None = Query(default=None),
    status: str | None = Query(default=None),
    owner_user_id: str = Depends(_owner_headers),
):
    return {"success": True, "requests": list_owner_requests(
        owner_user_id, assistant_id=assistant_id, status=status,
    )}


@router.get("/requests/{request_id}")
def owner_get_assistant_request(request_id: UUID, owner_user_id: str = Depends(_owner_headers)):
    return {"success": True, "request": get_owner_request(owner_user_id, str(request_id))}


@router.patch("/requests/{request_id}")
def owner_update_assistant_request(
    request_id: UUID,
    payload: AssistantRequestStatusPayload,
    owner_user_id: str = Depends(_owner_headers),
):
    return {"success": True, "request": update_owner_request_status(
        owner_user_id, str(request_id), payload.status,
    )}


@router.get("/public/{slug}")
def public_assistant_info(slug: str):
    assistant = get_public_assistant(slug)
    # No owner id, model id, prompt or private settings are exposed.
    return {
        "success": True,
        "assistant": {
            "name": assistant["name"],
            "description": assistant.get("description") or "",
            "welcome_message": assistant.get("welcome_message") or "Bonjour ! Comment puis-je vous aider ?",
            "slug": assistant["slug"],
        },
    }


@router.post("/public/{slug}/conversations", status_code=201)
def public_start_conversation(slug: str):
    assistant = get_public_assistant(slug)
    return {"success": True, **start_visitor_conversation(assistant)}


@router.get("/public/{slug}/conversations/{conversation_id}/messages")
def public_get_messages(
    slug: str,
    conversation_id: UUID,
    visitor_token: str | None = Header(default=None, alias="x-oria-visitor-token"),
):
    assistant = get_public_assistant(slug)
    messages = visitor_messages(str(assistant["id"]), str(conversation_id), visitor_token or "")
    pending_request = visitor_pending_request(str(assistant["id"]), str(conversation_id), visitor_token or "")
    return {"success": True, "messages": messages, "pending_request": pending_request}


@router.post("/public/{slug}/conversations/{conversation_id}/requests/confirm")
def public_confirm_request(
    slug: str,
    conversation_id: UUID,
    payload: VisitorRequestConfirmationPayload,
    visitor_token: str | None = Header(default=None, alias="x-oria-visitor-token"),
):
    assistant = get_public_assistant_for_generation(slug)
    return confirm_visitor_request(
        assistant=assistant,
        conversation_id=str(conversation_id),
        visitor_token=visitor_token or "",
        draft_id=str(payload.draft_id),
    )


@router.post("/public/{slug}/conversations/{conversation_id}/requests/cancel")
def public_cancel_request_draft(
    slug: str,
    conversation_id: UUID,
    payload: VisitorRequestConfirmationPayload,
    visitor_token: str | None = Header(default=None, alias="x-oria-visitor-token"),
):
    assistant = get_public_assistant_for_generation(slug)
    return cancel_visitor_request_draft(
        assistant=assistant,
        conversation_id=str(conversation_id),
        visitor_token=visitor_token or "",
        draft_id=str(payload.draft_id),
    )


@router.post("/public/{slug}/conversations/{conversation_id}/messages")
def public_send_message(
    slug: str,
    conversation_id: UUID,
    payload: VisitorMessagePayload,
    visitor_token: str | None = Header(default=None, alias="x-oria-visitor-token"),
):
    assistant = get_public_assistant_for_generation(slug)
    try:
        return send_visitor_message(
            assistant=assistant,
            conversation_id=str(conversation_id),
            visitor_token=visitor_token or "",
            request_id=payload.request_id,
            message=payload.message,
        )
    except HTTPException:
        raise
    except Exception:
        # Log the full traceback server-side without recording visitor message text or tokens.
        logger.exception(
            "ORIA Assistant public message failed (slug=%s, conversation_id=%s)",
            slug,
            str(conversation_id),
        )
        raise HTTPException(
            status_code=503,
            detail="Le service rencontre un problème temporaire. Réessaie dans un instant.",
        )

# ORIA_ASSISTANT_CHANTIER3: company-name payload
