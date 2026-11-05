"""ORIA - originaux envoyés au chat, distincts des artifacts générés.

Phase 2A : stockage, rattachement à une conversation, lecture privée.
Aucun appel IA ni aucune modification des crédits dans ce module.
"""
from __future__ import annotations

import hashlib
import logging
import re
from typing import Any
from uuid import UUID, uuid4

from app.core.supabase import supabase

LOG = logging.getLogger(__name__)
BUCKET = "conversation-attachments"
TABLE = "conversation_attachments"
MAX_ATTACHMENTS_PER_MESSAGE = 3
MAX_FILE_BYTES = 12 * 1024 * 1024

ALLOWED_TYPES = {
    ".pdf": ("application/pdf", 12 * 1024 * 1024),
    ".docx": ("application/vnd.openxmlformats-officedocument.wordprocessingml.document", 5 * 1024 * 1024),
    ".png": ("image/png", 10 * 1024 * 1024),
    ".jpg": ("image/jpeg", 10 * 1024 * 1024),
    ".jpeg": ("image/jpeg", 10 * 1024 * 1024),
    ".webp": ("image/webp", 10 * 1024 * 1024),
    ".gif": ("image/gif", 10 * 1024 * 1024),
    ".txt": ("text/plain", 2 * 1024 * 1024),
    ".md": ("text/markdown", 2 * 1024 * 1024),
    ".csv": ("text/csv", 2 * 1024 * 1024),
    ".json": ("application/json", 2 * 1024 * 1024),
    ".jsonl": ("application/x-ndjson", 2 * 1024 * 1024),
    ".py": ("text/x-python", 2 * 1024 * 1024),
    ".js": ("text/javascript", 2 * 1024 * 1024),
    ".jsx": ("text/javascript", 2 * 1024 * 1024),
    ".ts": ("text/typescript", 2 * 1024 * 1024),
    ".tsx": ("text/typescript", 2 * 1024 * 1024),
    ".html": ("text/html", 2 * 1024 * 1024),
    ".css": ("text/css", 2 * 1024 * 1024),
    ".sql": ("application/sql", 2 * 1024 * 1024),
    ".xml": ("application/xml", 2 * 1024 * 1024),
    ".yaml": ("text/yaml", 2 * 1024 * 1024),
    ".yml": ("text/yaml", 2 * 1024 * 1024),
    ".toml": ("application/toml", 2 * 1024 * 1024),
    ".tex": ("application/x-tex", 2 * 1024 * 1024),
    ".sh": ("application/x-sh", 2 * 1024 * 1024),
    ".xlsx": ("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", 10 * 1024 * 1024),
    ".pptx": ("application/vnd.openxmlformats-officedocument.presentationml.presentation", 10 * 1024 * 1024),
}


class AttachmentConflict(ValueError):
    """Un identifiant existant ne correspond pas à ce même fichier."""


class AttachmentUnavailable(RuntimeError):
    """Persistance ou récupération non confirmée ; aucun appel IA à relancer."""


def canonical_uuid(value: Any) -> str:
    try:
        return str(UUID(str(value)))
    except (ValueError, TypeError, AttributeError) as exc:
        raise ValueError("Identifiant UUID invalide.") from exc


def safe_filename(value: str) -> str:
    name = str(value or "").replace("\\", "/").split("/")[-1].strip()
    name = "".join("-" if ord(ch) < 32 or ch in '<>:"/\\|?*' else ch for ch in name)
    name = name.rstrip(" .")
    if not name or name.startswith(".") or len(name) > 180:
        raise ValueError("Nom de pièce jointe invalide.")
    return name


def validate_file(filename: str, mime_type: str, binary: bytes) -> tuple[str, str]:
    name = safe_filename(filename)
    ext = "." + name.rsplit(".", 1)[-1].lower() if "." in name else ""
    if ext not in ALLOWED_TYPES:
        raise ValueError("Format de pièce jointe non pris en charge.")
    expected_mime, max_bytes = ALLOWED_TYPES[ext]
    claimed_mime = str(mime_type or "").split(";", 1)[0].strip().lower()
    mime_aliases = {
        ".py": {"text/plain", "application/x-python-code", "text/x-python-script"},
        ".js": {"application/javascript", "text/plain"},
        ".jsx": {"application/javascript", "text/plain"},
        ".ts": {"application/typescript", "text/plain"},
        ".tsx": {"application/typescript", "text/plain"},
        ".jsonl": {"application/json", "text/plain"},
        ".sql": {"text/plain", "text/x-sql"},
        ".xml": {"text/xml", "text/plain"},
        ".yaml": {"application/x-yaml", "text/plain"},
        ".yml": {"application/x-yaml", "text/plain"},
        ".toml": {"text/plain"},
        ".tex": {"text/plain"},
        ".sh": {"text/x-shellscript", "text/plain"},
    }
    if claimed_mime not in (expected_mime, "application/octet-stream", "", *mime_aliases.get(ext, set())):
        raise ValueError("L'extension et le type MIME ne correspondent pas.")
    if not isinstance(binary, bytes) or not 0 < len(binary) <= max_bytes:
        raise ValueError("Pièce jointe vide ou trop volumineuse pour ce format.")
    if ext == ".pdf" and not binary.startswith(b"%PDF-"):
        raise ValueError("PDF invalide.")
    if ext in (".docx", ".xlsx", ".pptx") and not binary.startswith(b"PK\x03\x04"):
        raise ValueError("Archive Office invalide.")
    if ext == ".png" and not binary.startswith(b"\x89PNG\r\n\x1a\n"):
        raise ValueError("Image PNG invalide.")
    if ext in (".jpg", ".jpeg") and not binary.startswith(b"\xff\xd8\xff"):
        raise ValueError("Image JPEG invalide.")
    if ext == ".webp" and not (binary[:4] == b"RIFF" and binary[8:12] == b"WEBP"):
        raise ValueError("Image WebP invalide.")
    if ext == ".gif" and binary[:6] not in (b"GIF87a", b"GIF89a"):
        raise ValueError("Image GIF invalide.")
    if ext in (".txt", ".md", ".csv", ".json", ".jsonl", ".py", ".js", ".jsx", ".ts", ".tsx", ".html", ".css", ".sql", ".xml", ".yaml", ".yml", ".toml", ".tex", ".sh"):
        try:
            binary.decode("utf-8-sig")
        except UnicodeError as exc:
            raise ValueError("Fichier texte non UTF-8.") from exc
    return name, expected_mime


def public_metadata(row: dict[str, Any]) -> dict[str, Any]:
    """Jamais de storage_path ni de jeton signé dans les listes."""
    return {key: row.get(key) for key in (
        "id", "conversation_id", "message_id", "filename", "mime_type",
        "kind", "size_bytes", "sha256", "created_at", "index_status",
    )}


class ConversationAttachmentRepository:
    def __init__(self, client: Any = None):
        self.client = client if client is not None else supabase

    def _check_conversation(self, *, user_id: str, conversation_id: str) -> None:
        found = (self.client.table("conversations").select("id")
                 .eq("id", conversation_id).eq("user_id", user_id)
                 .limit(1).execute().data or [])
        if not found:
            raise PermissionError("Conversation absente ou non autorisée.")

    def get(self, *, user_id: str, conversation_id: str, attachment_id: str) -> dict | None:
        uid, cid, aid = (canonical_uuid(x) for x in (user_id, conversation_id, attachment_id))
        rows = (self.client.table(TABLE).select("*")
                .eq("id", aid).eq("user_id", uid).eq("conversation_id", cid)
                .limit(1).execute().data or [])
        return dict(rows[0]) if rows else None

    def list(self, *, user_id: str, conversation_id: str, limit: int = 100,
             offset: int = 0) -> list[dict]:
        uid, cid = canonical_uuid(user_id), canonical_uuid(conversation_id)
        self._check_conversation(user_id=uid, conversation_id=cid)
        if not 1 <= limit <= 100 or offset < 0:
            raise ValueError("Pagination invalide.")
        rows = (self.client.table(TABLE).select("*")
                .eq("user_id", uid).eq("conversation_id", cid)
                .order("created_at", desc=False).range(offset, offset + limit - 1)
                .execute().data or [])
        return [dict(row) for row in rows]

    @staticmethod
    def _expected_path(user_id: str, conversation_id: str,
                       attachment_id: str, filename: str) -> str:
        return f"{user_id}/{conversation_id}/{attachment_id}/{filename}"

    def _verify_row(self, row: dict, *, uid: str, cid: str, aid: str,
                    name: str, mime: str, size: int, digest: str) -> dict:
        expected_path = self._expected_path(uid, cid, aid, name)
        if any((str(row.get(key)) != val) for key, val in {
            "user_id": uid, "conversation_id": cid, "id": aid,
            "filename": name, "mime_type": mime,
            "storage_path": expected_path, "sha256": digest,
        }.items()) or row.get("size_bytes") != size:
            raise AttachmentConflict("Identifiant déjà utilisé pour un autre fichier.")
        return row

    def save(self, *, user_id: str, conversation_id: str, filename: str,
             mime_type: str, file_bytes: bytes, attachment_id: str | None = None) -> dict:
        uid, cid = canonical_uuid(user_id), canonical_uuid(conversation_id)
        aid = canonical_uuid(attachment_id) if attachment_id else str(uuid4())
        name, mime = validate_file(filename, mime_type, file_bytes)
        size = len(file_bytes)
        digest = hashlib.sha256(file_bytes).hexdigest()
        self._check_conversation(user_id=uid, conversation_id=cid)
        existing = self.get(user_id=uid, conversation_id=cid, attachment_id=aid)
        if existing is not None:
            return self._verify_row(existing, uid=uid, cid=cid, aid=aid,
                                    name=name, mime=mime, size=size, digest=digest)
        path = self._expected_path(uid, cid, aid, name)
        storage = self.client.storage.from_(BUCKET)
        try:
            storage.upload(path, file_bytes, {"content-type": mime, "upsert": False})
        except Exception as error:
            # L'upload a pu être validé avant la coupure réseau. Contrôler
            # son contenu en lecture privée plutôt que l'écraser ou le supprimer.
            try:
                current = storage.download(path)
                if not isinstance(current, (bytes, bytearray)) or bytes(current) != file_bytes:
                    raise AttachmentConflict("Objet Storage existant différent.")
            except AttachmentConflict:
                raise
            except Exception as check_error:
                raise AttachmentUnavailable(
                    "Upload non confirmé ; réessayer avec le même attachment_id."
                ) from check_error
            LOG.info("ORIA_ATTACHMENT reconciled upload for %s", aid)

        record = {
            "id": aid, "user_id": uid, "conversation_id": cid,
            "message_id": None, "filename": name, "mime_type": mime,
            "kind": "image" if mime.startswith("image/") else "file",
            "storage_path": path, "size_bytes": size, "sha256": digest,
        }
        try:
            result = self.client.table(TABLE).insert(record).execute()
            row = (result.data or [None])[0]
        except Exception as error:
            # Ne jamais supprimer le blob : le commit SQL peut avoir réussi.
            try:
                row = self.get(user_id=uid, conversation_id=cid, attachment_id=aid)
            except Exception:
                row = None
            if row is None:
                raise AttachmentUnavailable(
                    "Sauvegarde SQL non confirmée ; réessayer avec le même attachment_id."
                ) from error
        if not isinstance(row, dict):
            raise AttachmentUnavailable("Insertion SQL non confirmée.")
        return self._verify_row(row, uid=uid, cid=cid, aid=aid,
                                name=name, mime=mime, size=size, digest=digest)

    def link_to_message(self, *, user_id: str, conversation_id: str,
                        attachment_id: str, message_id: str) -> dict:
        uid, cid, aid, mid = (canonical_uuid(x) for x in (
            user_id, conversation_id, attachment_id, message_id))
        self._check_conversation(user_id=uid, conversation_id=cid)
        message_rows = (self.client.table("messages").select("id,role")
                        .eq("id", mid).eq("user_id", uid)
                        .eq("conversation_id", cid).limit(1).execute().data or [])
        if not message_rows or message_rows[0].get("role") != "user":
            raise PermissionError("Message utilisateur absent ou non autorisé.")
        row = self.get(user_id=uid, conversation_id=cid, attachment_id=aid)
        if row is None:
            raise LookupError("Pièce jointe introuvable.")
        if row.get("message_id") is not None:
            if str(row["message_id"]) == mid:
                return row
            raise AttachmentConflict("Pièce jointe déjà associée à un autre message.")
        bound = (self.client.table(TABLE).select("id")
                 .eq("user_id", uid).eq("conversation_id", cid)
                 .eq("message_id", mid).limit(MAX_ATTACHMENTS_PER_MESSAGE).execute().data or [])
        if len(bound) >= MAX_ATTACHMENTS_PER_MESSAGE:
            raise AttachmentConflict("Maximum trois pièces jointes par message.")
        updated = (self.client.table(TABLE).update({"message_id": mid})
                   .eq("id", aid).eq("user_id", uid).eq("conversation_id", cid)
                   .is_("message_id", "null").execute().data or [])
        if updated:
            return dict(updated[0])
        after = self.get(user_id=uid, conversation_id=cid, attachment_id=aid)
        if after and str(after.get("message_id")) == mid:
            return after
        raise AttachmentConflict("Rattachement concurrent à un autre message.")

    def signed_download(self, *, user_id: str, conversation_id: str,
                        attachment_id: str, expires_in: int = 3600) -> dict:
        row = self.get(user_id=user_id, conversation_id=conversation_id,
                       attachment_id=attachment_id)
        if row is None:
            raise LookupError("Pièce jointe introuvable.")
        uid, cid, aid = (canonical_uuid(x) for x in (user_id, conversation_id, attachment_id))
        expected = self._expected_path(uid, cid, aid, safe_filename(row["filename"]))
        if row.get("storage_path") != expected:
            raise AttachmentConflict("Chemin Storage incohérent.")
        result = self.client.storage.from_(BUCKET).create_signed_url(expected, expires_in)
        if isinstance(result, str):
            url = result
        elif isinstance(result, dict):
            data = result.get("data", result)
            url = ((data.get("signedURL") or data.get("signedUrl")
                    or data.get("signed_url") or data.get("url"))
                   if isinstance(data, dict) else data if isinstance(data, str) else None)
        else:
            url = (getattr(result, "signed_url", None)
                   or getattr(result, "signedURL", None))
            data = getattr(result, "data", None)
            if not url and isinstance(data, dict):
                url = data.get("signedURL") or data.get("signed_url")
        if not url:
            raise AttachmentUnavailable("Lien privé temporairement indisponible.")
        return {"attachment": public_metadata(row), "download_url": str(url)}

    def read_bytes(self, *, user_id: str, conversation_id: str,
                   attachment_id: str) -> tuple[dict, bytes]:
        """Lecture privée vérifiée pour le futur indexeur documentaire.

        Ne renvoie jamais de données à l'utilisateur sans l'authentification
        préalable de la route ; l'indexeur appelle cette méthode côté serveur.
        """
        row = self.get(user_id=user_id, conversation_id=conversation_id,
                       attachment_id=attachment_id)
        if row is None:
            raise LookupError("Pièce jointe introuvable.")
        uid, cid, aid = (canonical_uuid(x) for x in (user_id, conversation_id, attachment_id))
        path = self._expected_path(uid, cid, aid, safe_filename(row["filename"]))
        if row.get("storage_path") != path:
            raise AttachmentConflict("Chemin Storage incohérent.")
        binary = self.client.storage.from_(BUCKET).download(path)
        if not isinstance(binary, (bytes, bytearray)):
            raise AttachmentUnavailable("Objet Storage illisible.")
        data = bytes(binary)
        if (len(data) != row.get("size_bytes") or
                hashlib.sha256(data).hexdigest() != row.get("sha256")):
            raise AttachmentUnavailable("Objet Storage incohérent avec la base.")
        return row, data

    def delete(self, *, user_id: str, conversation_id: str, attachment_id: str) -> bool:
        uid, cid, aid = (canonical_uuid(x) for x in (user_id, conversation_id, attachment_id))
        row = self.get(user_id=uid, conversation_id=cid, attachment_id=aid)
        if row is None:
            return False
        path = self._expected_path(uid, cid, aid, safe_filename(row["filename"]))
        if row.get("storage_path") != path:
            raise AttachmentConflict("Chemin Storage incohérent.")
        # Storage puis SQL : sur erreur de SQL, le second essai doit être tolérant
        # à l'absence de l'objet (remove Supabase est normalement idempotent).
        self.client.storage.from_(BUCKET).remove([path])
        self.client.table(TABLE).delete().eq("id", aid).eq("user_id", uid).eq("conversation_id", cid).execute()
        return True

    def purge_conversation(self, *, user_id: str, conversation_id: str) -> None:
        uid, cid = canonical_uuid(user_id), canonical_uuid(conversation_id)
        # Sécurise la suppression de conversation : si Storage tombe,
        # refuser l'effacement de la conversation et conserver les références.
        while True:
            batch = self.list(user_id=uid, conversation_id=cid, limit=100)
            if not batch:
                return
            for row in batch:
                self.delete(user_id=uid, conversation_id=cid,
                            attachment_id=str(row["id"]))


conversation_attachment_repository = ConversationAttachmentRepository()
