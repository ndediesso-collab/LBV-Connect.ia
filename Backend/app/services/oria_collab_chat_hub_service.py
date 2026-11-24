"""ORIA Collaboratif: workspace-locked chat hub, no separate billing/provider.

All public entrypoints are authenticated in the FastAPI route. Never rely on
claims about sender/workspace from the request body. Files are privately stored.
"""
from __future__ import annotations

import os
import re
from pathlib import PurePosixPath
from typing import Any
from uuid import UUID, uuid4

from fastapi import HTTPException

BUCKET = "oria-collab-private"
MAX_UPLOAD = 8 * 1024 * 1024
MIME = {
    ".pdf": "application/pdf", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
    ".png": "image/png", ".webp": "image/webp", ".txt": "text/plain",
    ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    ".webm": "audio/webm", ".ogg": "audio/ogg", ".m4a": "audio/mp4",
    ".mp3": "audio/mpeg", ".wav": "audio/wav",
}


def uuid(value: str) -> str:
    try:
        return str(UUID(str(value)))
    except (ValueError, TypeError, AttributeError) as error:
        raise HTTPException(422, "Identifiant incorrect.") from error


def enabled() -> bool:
    return (os.getenv("ORIA_COLLABORATIF_ENABLED", "0") == "1"
            and os.getenv("ORIA_COLLAB_WORKSPACE_CONTEXT_ENABLED", "0") == "1"
            and os.getenv("ORIA_COLLAB_CHAT_UNIFIED_ENABLED", "0") == "1")


def require_enabled() -> None:
    if not enabled():
        raise HTTPException(503, "Le chat collaboratif est désactivé dans cet environnement.")


def valid_file_name(name: str) -> tuple[str, str]:
    # Prevent control chars, path traversal, HTML/SVG and remote JS execution.
    candidate = (name or "").replace("\\", "/").split("/")[-1].strip()
    if not candidate or len(candidate) > 150 or re.search(r"[\x00-\x1f\x7f]", candidate):
        raise HTTPException(422, "Nom de fichier non autorisé.")
    ext = PurePosixPath(candidate).suffix.lower()
    if ext not in MIME:
        raise HTTPException(415, "Format de fichier non accepté.")
    return candidate, MIME[ext]


class ChatHubService:
    def __init__(self, db: Any):
        self.db = db

    def _rpc(self, name: str, actor: str, space: str, **params: Any) -> dict:
        require_enabled()
        actor_id, workspace_id = uuid(actor), uuid(space)
        payload = {"p_actor_user_id": actor_id, "p_workspace_id": workspace_id, **params}
        try:
            response = self.db.rpc(name, payload).execute()
            data = getattr(response, "data", None)
            if isinstance(data, list) and len(data) == 1:
                data = data[0]
            if not isinstance(data, dict) or data.get("success") is not True:
                raise RuntimeError("invalid_collab_rpc_response")
            if data.get("workspace_id") != workspace_id:
                raise RuntimeError("wrong_collab_workspace")
            return data
        except HTTPException:
            raise
        except Exception as exc:
            msg = str(exc).lower()
            if any(s in msg for s in ("collab_edit_not_owner_or_ai_message",
                                  "collab_edit_attachment_message", "collab_edit_ai_prompt_forbidden")):
                raise HTTPException(403, "Ce message ne peut pas etre modifie.") from exc
            if any(s in msg for s in ("forbidden", "unauthorized", "not_participant")):
                raise HTTPException(404, "Conversation inaccessible.") from exc
            if any(s in msg for s in ("inactive", "pack_inactive", "capacity_exceeded")):
                raise HTTPException(403, "Cet espace ne peut pas recevoir de nouveaux messages.") from exc
            if any(s in msg for s in ("message_limit", "group_full", "group_archived", "conflicting_retry")):
                raise HTTPException(409, "Limite atteinte, conversation archivée ou message déjà envoyé.") from exc
            if "invalid" in msg or "bad_cursor" in msg:
                raise HTTPException(422, "Données incorrectes.") from exc
            raise HTTPException(503, "Service collaboratif indisponible. Consultez le journal du backend.") from exc

    def boot(self, actor: str, space: str) -> dict:
        context = self._rpc("oria_collab_workspace_context_v3", actor, space)
        if context.get("pack_active"):
            general = self._rpc("oria_collab_chat_general_v1", actor, space)
        else:
            general = {"workspace_id": uuid(space), "group_id": None}
        groups = self._rpc("oria_collab_workspace_groups_v3", actor, space)
        profiles = self._rpc("oria_collab_workspace_profiles_v3", actor, space)
        privates = {"conversations": []}
        directs = {"threads": []}
        notices = self._rpc("oria_collab_chat_notifications_v1", actor, space, p_limit=30)
        return {"success": True, "workspace_id": uuid(space), "context": context,
                "general_group_id": general.get("group_id"),
                "groups": groups.get("groups", []), "profiles": profiles.get("profiles", []),
                "privates": privates.get("conversations", []), "directs": directs.get("threads", []),
                "unread": notices.get("unread", 0)}

    def group_read(self, actor: str, space: str, group: str, before: str | None, limit: int) -> dict:
        result = self._rpc("oria_collab_workspace_group_messages_v3", actor, space,
                           p_group_id=uuid(group), p_before_message_id=uuid(before) if before else None,
                           p_limit=limit)
        if result.get("group_id") != uuid(group):
            raise HTTPException(503, "Historique de salon incohérent.")
        # La RPC a valide l'identite/adhesion. Enrichit les messages avec edited_at
        # sans exposer d'autre groupe. Ancienne migration: lecture toujours possible.
        rows = result.get("messages") or []
        if rows:
            try:
                ids = [r["id"] for r in rows if isinstance(r, dict) and r.get("id")]
                if ids:
                    stamps = (self.db.table("oria_collab_group_messages")
                              .select("id,edited_at").eq("group_id",uuid(group))
                              .in_("id",ids).execute().data or [])
                    mapping = {r["id"]:r.get("edited_at") for r in stamps}
                    for row in rows:
                        if isinstance(row,dict): row["edited_at"] = mapping.get(row.get("id"))
            except Exception:
                pass  # Lecture des messages possible meme avant migration SQL P7.
        return result

    def edit_human(self, actor: str, space: str, group: str,
                   message: str, content: str) -> dict:
        require_enabled()
        cleaned = (content or "").strip()
        if not 1 <= len(cleaned) <= 4000:
            raise HTTPException(422,"Message vide ou superieur a 4 000 caracteres.")
        result = self._rpc("oria_collab_chat_group_edit_v1",actor,space,
                           p_group_id=uuid(group),p_message_id=uuid(message),
                           p_content=cleaned)
        if result.get("group_id") != uuid(group) or result.get("message_id") != uuid(message):
            raise HTTPException(503,"Confirmation d'edition incoherente.")
        return result

    def direct_open(self, actor: str, space: str, other: str) -> dict:
        return self._rpc("oria_collab_chat_direct_open_v1", actor, space, p_other_user_id=uuid(other))

    def direct_list(self, actor: str, space: str) -> dict:
        return self._rpc("oria_collab_chat_direct_list_v1", actor, space)

    def direct_read(self, actor: str, space: str, thread: str, before: str | None, limit: int) -> dict:
        result = self._rpc("oria_collab_chat_direct_read_v1", actor, space,
            p_thread_id=uuid(thread),p_before_message_id=uuid(before) if before else None,p_limit=limit)
        if result.get("thread_id") != uuid(thread):
            raise HTTPException(503, "Historique direct incohérent.")
        return result

    def send(self, actor: str, space: str, room_type: str, room: str,
             content: str, client_message_id: str) -> dict:
        room_id = uuid(room)
        request_id = uuid(client_message_id)
        if room_type == "group":
            name, field = "oria_collab_chat_group_send_v1", "p_group_id"
        elif room_type == "direct":
            name, field = "oria_collab_chat_direct_send_v1", "p_thread_id"
        else:
            raise HTTPException(422, "Type de conversation inconnu.")
        response = self._rpc(name, actor, space, **{field: room_id},
                             p_client_message_id=request_id, p_content=content)
        if response.get("group_id", response.get("thread_id")) != room_id:
            raise HTTPException(503, "Message d'un autre salon reçu.")
        return response

    def notices(self, actor: str, space: str) -> dict:
        return self._rpc("oria_collab_chat_notifications_v1",actor,space,p_limit=30)

    def mark_read(self, actor: str, space: str) -> dict:
        return self._rpc("oria_collab_chat_notifications_read_v1",actor,space)

    def files(self, actor: str, space: str, room_type: str, room: str) -> dict:
        result = self._rpc("oria_collab_chat_files_v1",actor,space,
                           p_room_type=room_type,p_room_id=uuid(room))
        if result.get("room_id") != uuid(room):
            raise HTTPException(503, "Pièces jointes hors de cet espace.")
        return result

    def file_url(self, actor: str, space: str, file_id: str) -> dict:
        result = self._rpc("oria_collab_chat_file_access_v1",actor,space,p_file_id=uuid(file_id))
        if result.get("file_id") != uuid(file_id):
            raise HTTPException(503, "Pièce jointe incohérente.")
        path = result.get("storage_path")
        if not isinstance(path,str) or not path.startswith(uuid(space)+"/"):
            raise HTTPException(503,"Chemin du fichier invalide.")
        try:
            signed = self.db.storage.from_(BUCKET).create_signed_url(path,30)
        except Exception as exc:
            raise HTTPException(503,"Lien temporaire indisponible.") from exc
        url = (signed.get("signedURL") or signed.get("signedUrl") or signed.get("signed_url")) if isinstance(signed,dict) else None
        if not isinstance(url,str) or not url.startswith("https://"):
            raise HTTPException(503,"Lien temporaire invalide.")
        return {"success":True,"workspace_id":uuid(space),"file_id":uuid(file_id),"url":url,"expires_in":30}

    def upload(self, actor: str, space: str, room_type: str, room: str, filename: str,
               data: bytes, content_type: str | None, caption: str | None) -> dict:
        require_enabled()
        space_id, actor_id, room_id = uuid(space), uuid(actor), uuid(room)
        name, expected_type = valid_file_name(filename)
        if not data or len(data)>MAX_UPLOAD:
            raise HTTPException(413,"Fichier vide ou supérieur à 8 Mo.")
        # Lightweight signature checks prevent obvious type spoofing.
        signature_ok = (
            (expected_type == "application/pdf" and data.startswith(b"%PDF-"))
            or (expected_type == "image/png" and data.startswith(b"\x89PNG\r\n\x1a\n"))
            or (expected_type == "image/jpeg" and data.startswith(b"\xff\xd8\xff"))
            or (expected_type == "image/webp" and len(data)>=12 and data[:4]==b"RIFF" and data[8:12]==b"WEBP")
            or (expected_type.startswith("application/vnd.openxmlformats-") and data.startswith(b"PK\x03\x04"))
            or (expected_type == "text/plain" and b"\x00" not in data)
            or (expected_type == "audio/webm" and data[:4] == b"\x1a\x45\xdf\xa3")
            or (expected_type == "audio/ogg" and data.startswith(b"OggS"))
            or (expected_type == "audio/mp4" and len(data) >= 12 and data[4:8] == b"ftyp")
            or (expected_type == "audio/mpeg" and (data.startswith(b"ID3") or
                (len(data)>=2 and data[0] == 0xff and (data[1]&0xe0)==0xe0)))
            or (expected_type == "audio/wav" and data[:4] == b"RIFF" and data[8:12] == b"WAVE")
        )
        if not signature_ok:
            raise HTTPException(415, "Le contenu du fichier ne correspond pas à son format.")
        if content_type and content_type.lower().split(";",1)[0].strip() != expected_type:
            # Browsers may send application/octet-stream for Office docs.
            if content_type.lower().strip() != "application/octet-stream":
                raise HTTPException(415,"Type MIME différent de l'extension.")
        if expected_type.startswith("audio/"):
            # Reutilise la validation du chat principal : piste audio uniquement,
            # duree <= 5 minutes, sans piste video ni fichier corrompu.
            from app.services.audio_service import AudioService, AudioError
            try:
                ext = PurePosixPath(name).suffix.lstrip(".")
                AudioService._duration(data, ext)
            except AudioError as exc:
                raise HTTPException(422,str(exc)) from exc
        if room_type not in ("group","direct"):
            raise HTTPException(422,"Type de salon incorrect.")
        file_id = str(uuid4())
        safe_name = re.sub(r"[^a-zA-Z0-9._-]","_",name)[:120]
        storage_path=f"{space_id}/{file_id}/{safe_name}"
        # Preflight scope and membership BEFORE uploading data to private Storage.
        if room_type == "group":
            self.group_read(actor_id,space_id,room_id,None,1)
        else:
            self.direct_read(actor_id,space_id,room_id,None,1)
        try:
            self.db.storage.from_(BUCKET).upload(storage_path,data,
                {"content-type": expected_type,"upsert":"false"})
        except Exception as exc:
            raise HTTPException(503,"Envoi sécurisé du fichier impossible.") from exc
        try:
            label = (caption or "").strip()
            if label:
                label = label[:(4000 if room_type=="group" else 8000)]
            else:
                label = f"📎 {name}"
            posted = self.send(actor_id,space_id,room_type,room_id,label,str(uuid4()))
            message_id = posted.get("message_id")
            if not isinstance(message_id,str):
                raise HTTPException(503,"Message de fichier non confirmé.")
            attached = self._rpc("oria_collab_chat_file_attach_v1",actor_id,space_id,
                p_room_type=room_type,p_message_id=uuid(message_id),p_file_id=file_id,
                p_storage_path=storage_path,p_original_name=name,p_mime_type=expected_type,
                p_size_bytes=len(data))
            if attached.get("message_id")!=uuid(message_id) or attached.get("file_id")!=file_id:
                raise HTTPException(503,"Attachement de fichier non confirmé.")
            return {"success":True,"workspace_id":space_id,"message_id":message_id,
                    "file_id":file_id,"original_name":name}
        except Exception:
            # The message may already be persisted: never blindly retry or delete it.
            # The private object remains inaccessible without SQL attachment grant.
            raise
