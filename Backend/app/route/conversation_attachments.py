"""API additive : stockage privé des fichiers joints à une conversation ORIA.

Aucun appel fournisseur IA ni débit de crédits. Le frontend actuel reste
compatible, mais doit choisir ces endpoints pour bénéficier de la persistance.
"""
from __future__ import annotations

import logging
from uuid import UUID

from fastapi import APIRouter, File, Form, Header, HTTPException, UploadFile
from fastapi.concurrency import run_in_threadpool
from pydantic import BaseModel

from app.core.supabase import supabase
from app.repositories.supabase_conversation_attachment_repository import (
    AttachmentConflict,
    AttachmentUnavailable,
    MAX_FILE_BYTES,
    canonical_uuid,
    conversation_attachment_repository as repository,
    public_metadata,
)

LOG = logging.getLogger(__name__)
router = APIRouter(tags=["Conversation Attachments"])


class LinkAttachmentRequest(BaseModel):
    message_id: UUID


def authenticated_owner(user_id: str | None, authorization: str | None) -> str:
    if not user_id or not authorization:
        raise HTTPException(status_code=401, detail="Authentification requise.")
    token = authorization.strip()
    if token.lower().startswith("bearer "):
        token = token[7:].strip()
    if not token:
        raise HTTPException(status_code=401, detail="Token manquant.")
    try:
        user = supabase.auth.get_user(token).user
        owner = canonical_uuid(getattr(user, "id", None))
    except Exception as exc:
        raise HTTPException(status_code=401, detail="Session invalide ou expirée.") from exc
    try:
        supplied = canonical_uuid(user_id)
    except ValueError as exc:
        raise HTTPException(status_code=401, detail="Identifiant utilisateur invalide.") from exc
    if owner != supplied:
        raise HTTPException(status_code=403, detail="Identité non autorisée.")
    return owner


def _error(exc: Exception) -> HTTPException:
    if isinstance(exc, AttachmentConflict):
        return HTTPException(status_code=409, detail=str(exc))
    if isinstance(exc, ValueError):
        return HTTPException(status_code=422, detail=str(exc))
    if isinstance(exc, (PermissionError, LookupError)):
        return HTTPException(status_code=404, detail="Conversation, message ou fichier introuvable.")
    LOG.exception("ORIA_ATTACHMENTS backend_error", exc_info=exc)
    return HTTPException(status_code=503, detail="Stockage des pièces jointes temporairement indisponible.")


@router.post("/conversations/{conversation_id}/attachments", status_code=201)
async def upload_conversation_attachment(
    conversation_id: UUID,
    file: UploadFile = File(...),
    attachment_id: UUID | None = Form(None),
    user_id: str | None = Header(default=None, alias="user-id"),
    authorization: str | None = Header(default=None, alias="authorization"),
):
    """Une seule fois par fichier ; envoyer attachment_id pour un retry idempotent."""
    owner = authenticated_owner(user_id, authorization)
    try:
        blob = await file.read(MAX_FILE_BYTES + 1)
        if len(blob) > MAX_FILE_BYTES:
            raise ValueError("Fichier supérieur à la limite de 12 Mo.")
        row = await run_in_threadpool(
            repository.save,
            user_id=owner, conversation_id=str(conversation_id),
            filename=file.filename or "", mime_type=file.content_type or "",
            file_bytes=blob,
            attachment_id=str(attachment_id) if attachment_id else None,
        )
        from app.services.conversation_document_memory import conversation_document_memory
        try:
            state = await run_in_threadpool(
                conversation_document_memory.index_file,
                user_id=owner, conversation_id=str(conversation_id),
                attachment_id=str(row["id"]),
            )
            row = {**row, "index_status": state}
        except Exception:
            LOG.exception("ORIA_ATTACHMENT_INDEX_FAILED id=%s", row["id"])
            # Le stockage confirme reste disponible pour une relecture native.
        return {"success": True, "attachment": public_metadata(row)}
    except Exception as exc:
        raise _error(exc) from exc
    finally:
        await file.close()


@router.get("/conversations/{conversation_id}/attachments")
def list_conversation_attachments(
    conversation_id: UUID, limit: int = 100, offset: int = 0,
    user_id: str | None = Header(default=None, alias="user-id"),
    authorization: str | None = Header(default=None, alias="authorization"),
):
    owner = authenticated_owner(user_id, authorization)
    try:
        rows = repository.list(user_id=owner, conversation_id=str(conversation_id),
                               limit=limit, offset=offset)
        return {"success": True, "attachments": [public_metadata(r) for r in rows],
                "next_offset": offset + len(rows) if len(rows) == limit else None}
    except Exception as exc:
        raise _error(exc) from exc


@router.get("/conversations/{conversation_id}/attachments/{attachment_id}")
def get_conversation_attachment(
    conversation_id: UUID, attachment_id: UUID,
    user_id: str | None = Header(default=None, alias="user-id"),
    authorization: str | None = Header(default=None, alias="authorization"),
):
    owner = authenticated_owner(user_id, authorization)
    try:
        return {"success": True, **repository.signed_download(
            user_id=owner, conversation_id=str(conversation_id),
            attachment_id=str(attachment_id))}
    except Exception as exc:
        raise _error(exc) from exc


@router.post("/conversations/{conversation_id}/attachments/{attachment_id}/link")
def link_conversation_attachment(
    conversation_id: UUID, attachment_id: UUID, body: LinkAttachmentRequest,
    user_id: str | None = Header(default=None, alias="user-id"),
    authorization: str | None = Header(default=None, alias="authorization"),
):
    owner = authenticated_owner(user_id, authorization)
    try:
        row = repository.link_to_message(
            user_id=owner, conversation_id=str(conversation_id),
            attachment_id=str(attachment_id), message_id=str(body.message_id))
        return {"success": True, "attachment": public_metadata(row)}
    except Exception as exc:
        raise _error(exc) from exc


@router.delete("/conversations/{conversation_id}/attachments/{attachment_id}")
def delete_conversation_attachment(
    conversation_id: UUID, attachment_id: UUID,
    user_id: str | None = Header(default=None, alias="user-id"),
    authorization: str | None = Header(default=None, alias="authorization"),
):
    owner = authenticated_owner(user_id, authorization)
    try:
        deleted = repository.delete(user_id=owner, conversation_id=str(conversation_id),
                                    attachment_id=str(attachment_id))
        if not deleted:
            raise LookupError("Fichier introuvable.")
        return {"success": True, "deleted": True}
    except Exception as exc:
        raise _error(exc) from exc
