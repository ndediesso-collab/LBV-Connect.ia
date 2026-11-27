"""Registre privé des imports audio longs ORIA Transcription.

Toutes les mutations sont faites avec le client Supabase serveur (service_role).
Le navigateur ne lit jamais cette table : il ne reçoit que le chemin d'upload TUS
exactement autorisé par une politique RLS dédiée.
"""
from __future__ import annotations

from datetime import datetime, timezone
from pathlib import PurePosixPath
from typing import Any
from uuid import UUID

class CourseAudioImportError(RuntimeError):
    """Import audio introuvable, incohérent ou transition refusée."""


class SupabaseCourseAudioImportRepository:
    TABLE = "oria_course_audio_imports"
    BUCKET = "oria-course-staging"
    UPLOAD_URL_TTL_SECONDS = 60 * 60 * 6
    MAX_UPLOAD_BYTES = 512 * 1024 * 1024

    def __init__(self, client: Any | None = None) -> None:
        if client is None:
            from app.core.supabase import supabase
            client = supabase
        self.client = client

    @staticmethod
    def _uuid(value: Any, field: str) -> str:
        try:
            return str(UUID(str(value)))
        except (TypeError, ValueError, AttributeError) as exc:
            raise CourseAudioImportError(f"{field} invalide.") from exc

    @staticmethod
    def _rows(response: Any) -> list[dict[str, Any]]:
        data = response.get("data") if isinstance(response, dict) else getattr(response, "data", None)
        if isinstance(data, dict):
            return [data]
        if isinstance(data, (list, tuple)):
            return [item for item in data if isinstance(item, dict)]
        return []

    @staticmethod
    def _check(response: Any) -> None:
        error = response.get("error") if isinstance(response, dict) else getattr(response, "error", None)
        if error:
            raise CourseAudioImportError("Opération Supabase de préparation audio refusée.")

    @classmethod
    def _path(cls, *, user_id: str, course_id: str, import_id: str, extension: str) -> str:
        uid = cls._uuid(user_id, "user_id")
        cid = cls._uuid(course_id, "course_id")
        iid = cls._uuid(import_id, "import_id")
        ext = str(extension or "").lower().lstrip(".")
        if ext not in {"webm", "ogg", "m4a", "mp3", "wav", "aac", "3gp"}:
            raise CourseAudioImportError("Extension audio non prise en charge.")
        return f"{uid}/{cid}/imports/{iid}.{ext}"

    def create(
        self, *, user_id: str, course_id: str, import_id: str,
        filename: str, mime_type: str, extension: str, size_bytes: int,
    ) -> dict[str, Any]:
        uid = self._uuid(user_id, "user_id")
        cid = self._uuid(course_id, "course_id")
        iid = self._uuid(import_id, "import_id")
        if type(size_bytes) is not int or not 0 < size_bytes <= self.MAX_UPLOAD_BYTES:
            raise CourseAudioImportError("Le fichier doit faire au maximum 512 Mio.")
        clean_filename = PurePosixPath(str(filename or "").replace("\\", "/")).name[:180]
        if not clean_filename or clean_filename in {".", ".."}:
            raise CourseAudioImportError("Nom de fichier audio invalide.")
        clean_mime = str(mime_type or "").split(";", 1)[0].strip().lower()
        path = self._path(user_id=uid, course_id=cid, import_id=iid, extension=extension)
        previous = self.get(user_id=uid, course_id=cid, import_id=iid)
        if previous:
            immutable = (previous.get("filename"), previous.get("mime_type"),
                         previous.get("size_bytes"), previous.get("storage_path"))
            expected = (clean_filename, clean_mime, size_bytes, path)
            if immutable != expected:
                raise CourseAudioImportError("Cet identifiant d'import est déjà associé à un autre fichier.")
            if previous.get("status") != "uploading":
                raise CourseAudioImportError("Cet import n'est plus ouvert aux transferts.")
            return previous
        payload = {
            "id": iid, "user_id": uid, "course_id": cid,
            "filename": clean_filename, "mime_type": clean_mime,
            "extension": extension, "size_bytes": size_bytes,
            "storage_path": path, "status": "uploading", "phase": "uploading",
            "progress_percent": 0,
        }
        try:
            response = self.client.table(self.TABLE).insert(payload).execute()
            self._check(response)
        except Exception as exc:
            if isinstance(exc, CourseAudioImportError):
                raise
            raise CourseAudioImportError("Impossible de créer la session d'import audio.") from exc
        rows = self._rows(response)
        if not rows or str(rows[0].get("id")) != iid:
            raise CourseAudioImportError("La création de la session d'import n'a pas été confirmée.")
        return rows[0]

    def get(self, *, user_id: str, course_id: str, import_id: str) -> dict[str, Any] | None:
        uid = self._uuid(user_id, "user_id")
        cid = self._uuid(course_id, "course_id")
        iid = self._uuid(import_id, "import_id")
        try:
            response = (self.client.table(self.TABLE).select("*")
                        .eq("user_id", uid).eq("course_id", cid).eq("id", iid)
                        .limit(1).execute())
            self._check(response)
        except Exception as exc:
            raise CourseAudioImportError("Impossible de lire la session d'import audio.") from exc
        rows = self._rows(response)
        return rows[0] if rows else None

    def latest(self, *, user_id: str, course_id: str) -> dict[str, Any] | None:
        uid = self._uuid(user_id, "user_id")
        cid = self._uuid(course_id, "course_id")
        try:
            response = (self.client.table(self.TABLE).select("*")
                        .eq("user_id", uid).eq("course_id", cid)
                        .order("created_at", desc=True).limit(1).execute())
            self._check(response)
        except Exception as exc:
            raise CourseAudioImportError("Impossible de retrouver le dernier import audio.") from exc
        rows = self._rows(response)
        return rows[0] if rows else None

    def has_unfinished(self, *, user_id: str, course_id: str) -> bool:
        row = self.latest(user_id=user_id, course_id=course_id)
        return bool(row and row.get("status") != "completed")

    @staticmethod
    def _rpc_row(response: Any, *, allow_null: bool = False) -> dict[str, Any] | None:
        error = response.get("error") if isinstance(response, dict) else getattr(response, "error", None)
        if error:
            raise CourseAudioImportError("Transition SQL de l'import audio refusée.")
        data = response.get("data") if isinstance(response, dict) else getattr(response, "data", None)
        if isinstance(data, list):
            if len(data) == 0 and allow_null:
                return None
            if len(data) == 1:
                data = data[0]
        if data is None and allow_null:
            return None
        if not isinstance(data, dict):
            raise CourseAudioImportError("Réponse SQL de l'import audio invalide.")
        return data

    def _rpc(self, name: str, payload: dict[str, Any], *, allow_null: bool = False) -> dict[str, Any] | None:
        try:
            response = self.client.rpc(name, payload).execute()
        except Exception as exc:
            raise CourseAudioImportError("File SQL de préparation audio indisponible.") from exc
        return self._rpc_row(response, allow_null=allow_null)

    def queue(self, *, user_id: str, course_id: str, import_id: str) -> dict[str, Any]:
        uid, cid, iid = (self._uuid(user_id, "user_id"), self._uuid(course_id, "course_id"),
                         self._uuid(import_id, "import_id"))
        row = self._rpc("oria_course_audio_import_queue", {
            "p_user_id": uid, "p_course_id": cid, "p_import_id": iid,
        })
        assert row is not None
        return row

    def retry(self, *, user_id: str, course_id: str, import_id: str) -> dict[str, Any]:
        uid, cid, iid = (self._uuid(user_id, "user_id"), self._uuid(course_id, "course_id"),
                         self._uuid(import_id, "import_id"))
        row = self._rpc("oria_course_audio_import_retry", {
            "p_user_id": uid, "p_course_id": cid, "p_import_id": iid,
        })
        assert row is not None
        return row

    def claim(self, *, worker_id: str, lease_seconds: int = 3600) -> dict[str, Any] | None:
        wid = self._uuid(worker_id, "worker_id")
        row = self._rpc("oria_course_audio_import_claim", {
            "p_worker_id": wid, "p_lease_seconds": lease_seconds,
        }, allow_null=True)
        return row

    def heartbeat(self, *, import_id: str, worker_id: str, lease_seconds: int = 3600) -> dict[str, Any]:
        iid, wid = self._uuid(import_id, "import_id"), self._uuid(worker_id, "worker_id")
        row = self._rpc("oria_course_audio_import_heartbeat", {
            "p_import_id": iid, "p_worker_id": wid, "p_lease_seconds": lease_seconds,
        })
        assert row is not None
        return row

    def progress(
        self, *, import_id: str, worker_id: str, phase: str,
        progress_percent: int, duration_ms: int | None = None, segment_count: int | None = None,
    ) -> dict[str, Any]:
        iid, wid = self._uuid(import_id, "import_id"), self._uuid(worker_id, "worker_id")
        row = self._rpc("oria_course_audio_import_progress", {
            "p_import_id": iid, "p_worker_id": wid,
            "p_phase": phase, "p_progress_percent": progress_percent,
            "p_duration_ms": duration_ms, "p_segment_count": segment_count,
        })
        assert row is not None
        return row

    def finish(
        self, *, import_id: str, worker_id: str, status: str,
        duration_ms: int | None = None, segment_count: int | None = None,
        error_code: str | None = None,
    ) -> dict[str, Any]:
        iid, wid = self._uuid(import_id, "import_id"), self._uuid(worker_id, "worker_id")
        row = self._rpc("oria_course_audio_import_finish", {
            "p_import_id": iid, "p_worker_id": wid, "p_status": status,
            "p_duration_ms": duration_ms, "p_segment_count": segment_count,
            "p_error_code": error_code,
        })
        assert row is not None
        return row

    def signed_source_url(self, *, storage_path: str) -> str:
        try:
            response = self.client.storage.from_(self.BUCKET).create_signed_url(
                storage_path, self.UPLOAD_URL_TTL_SECONDS
            )
            self._check(response)
        except Exception as exc:
            raise CourseAudioImportError("Fichier source privé inaccessible.") from exc
        url = None
        data = response.get("data") if isinstance(response, dict) else getattr(response, "data", None)
        for candidate in (response, data):
            if isinstance(candidate, dict):
                url = candidate.get("signedURL") or candidate.get("signedUrl") or candidate.get("signed_url") or candidate.get("url")
            else:
                url = (getattr(candidate, "signed_url", None) or getattr(candidate, "signedURL", None)
                       or getattr(candidate, "signedUrl", None) or getattr(candidate, "url", None))
            if isinstance(url, str) and url.startswith("https://"):
                return url
        raise CourseAudioImportError("URL temporaire du fichier source absente.")

    def delete_source(self, *, storage_path: str, import_id: str) -> None:
        iid = self._uuid(import_id, "import_id")
        try:
            response = self.client.storage.from_(self.BUCKET).remove([storage_path])
            self._check(response)
            update = (self.client.table(self.TABLE).update({"source_deleted_at": datetime.now(timezone.utc).isoformat()})
                      .eq("id", iid).execute())
            self._check(update)
        except Exception as exc:
            raise CourseAudioImportError("Nettoyage du fichier temporaire non confirmé.") from exc

    def cleanup_pending_sources(self, *, limit: int = 10) -> int:
        """Nettoie après coup les originaux dont le traitement est déjà terminé."""
        try:
            response = (self.client.table(self.TABLE).select("id,storage_path")
                        .eq("status", "completed").is_("source_deleted_at", "null")
                        .order("updated_at").limit(limit).execute())
            self._check(response)
            rows = self._rows(response)
        except Exception as exc:
            raise CourseAudioImportError("Impossible de retrouver les fichiers temporaires à nettoyer.") from exc
        cleaned = 0
        for row in rows:
            try:
                self.delete_source(storage_path=str(row["storage_path"]), import_id=str(row["id"]))
                cleaned += 1
            except Exception:
                continue
        return cleaned
