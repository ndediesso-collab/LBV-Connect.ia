#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Installe le socle backend du chantier 3 ORIA Transcription.

Ajoute un upload TUS privé/reprenable, une file SQL durable et un worker FFmpeg
qui prépare les segments avant le submit/quote/confirm existant. Aucun appel IA,
aucune réservation de crédits et aucun changement de tarification dans ce flux.

Le script est volontairement local : il n'écrit pas sur GitHub.
"""
from __future__ import annotations

from datetime import datetime
from pathlib import Path
import shutil
import sys

ROOT = Path(__file__).resolve().parent
BACKEND = ROOT / "Backend"
ROUTE = BACKEND / "app" / "route" / "courses.py"
MAIN = BACKEND / "app" / "main.py"
REQ = BACKEND / "requirements.txt"
REPO_NEW = BACKEND / "app" / "repositories" / "supabase_course_audio_import_repository.py"
WORKER_NEW = BACKEND / "app" / "services" / "course_audio_import_worker.py"
SQL_NEW = BACKEND / "oria_transcription_audio_import.sql"
TEST_NEW = BACKEND / "tests" / "test_oria_course_audio_import_policy.py"


def fail(message: str) -> None:
    raise RuntimeError(message)


def replace_once(source: str, old: str, new: str, label: str) -> str:
    count = source.count(old)
    if count != 1:
        fail(f"Ancre '{label}' attendue une seule fois, trouvée {count}. Aucun fichier écrit.")
    return source.replace(old, new, 1)


REPOSITORY_SOURCE = r'''"""Registre privé des imports audio longs ORIA Transcription.

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
'''

WORKER_SOURCE = r'''"""Préparation asynchrone des fichiers audio longs ORIA Transcription.

Ce worker ne fait aucun appel OpenAI/Luna et ne touche jamais aux crédits.
Il récupère la source privée par flux, vérifie sa vraie durée, la réencode en
segments WebM/Opus autonomes de 4 min 45 et les dépose dans le stockage audio
existant de ORIA Cours. La suite (submit/devis/confirmation/IA) reste inchangée.
"""
from __future__ import annotations

import hashlib
import json
import logging
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
from threading import Event, Thread
from time import monotonic
from typing import Any
from uuid import uuid4

import httpx

from app.repositories.supabase_audio_repository import SupabaseCourseAudioRepository
from app.repositories.supabase_course_audio_import_repository import (
    CourseAudioImportError, SupabaseCourseAudioImportRepository,
)
from app.services.audio_service import CourseAudioPolicy

logger = logging.getLogger("oria.transcription.audio_import")


class CourseAudioImportWorker:
    MAX_SOURCE_BYTES = 512 * 1024 * 1024
    MAX_DURATION_SECONDS = 4 * 60 * 60
    TARGET_SEGMENT_SECONDS = 285
    MAX_SEGMENTS = 120
    MAX_SEGMENT_BYTES = 20 * 1024 * 1024
    DOWNLOAD_BLOCK_BYTES = 8 * 1024 * 1024
    LEASE_SECONDS = 300
    HEARTBEAT_SECONDS = 45

    def __init__(self, client: Any, *, worker_id: str | None = None) -> None:
        if client is None:
            raise ValueError("Client Supabase service_role requis.")
        self.client = client
        self.worker_id = str(worker_id or uuid4())
        self.imports = SupabaseCourseAudioImportRepository(client)
        self.audio = SupabaseCourseAudioRepository(client)

    @staticmethod
    def _ensure_ffmpeg() -> tuple[str, str]:
        """Charge les binaires FFmpeg/FFprobe portables installés par static-ffmpeg."""
        try:
            from static_ffmpeg import run as static_ffmpeg_run
            ffmpeg, ffprobe = static_ffmpeg_run.get_or_fetch_platform_executables_else_raise()
        except Exception as exc:
            raise CourseAudioImportError("ffmpeg_binary_unavailable") from exc
        binary_dir = str(Path(ffmpeg).resolve().parent)
        current_path = os.environ.get("PATH", "")
        if binary_dir not in current_path.split(os.pathsep):
            os.environ["PATH"] = binary_dir + os.pathsep + current_path
        if not Path(ffmpeg).is_file() or not Path(ffprobe).is_file():
            raise CourseAudioImportError("ffmpeg_binary_unavailable")
        return str(ffmpeg), str(ffprobe)

    def _progress(
        self, row: dict[str, Any], phase: str, percent: int,
        *, duration_ms: int | None = None, segment_count: int | None = None,
    ) -> None:
        self.imports.progress(
            import_id=str(row["id"]), worker_id=self.worker_id,
            phase=phase, progress_percent=max(0, min(99, int(percent))),
            duration_ms=duration_ms, segment_count=segment_count,
        )

    def _heartbeat_loop(self, import_id: str, stop: Event, failure: list[BaseException]) -> None:
        while not stop.wait(self.HEARTBEAT_SECONDS):
            try:
                self.imports.heartbeat(
                    import_id=import_id, worker_id=self.worker_id,
                    lease_seconds=self.LEASE_SECONDS,
                )
            except BaseException as exc:
                failure.append(exc)
                stop.set()
                return

    def _download_source(self, row: dict[str, Any], destination: Path) -> tuple[int, str]:
        signed_url = self.imports.signed_source_url(storage_path=str(row["storage_path"]))
        digest = hashlib.sha256()
        total = 0
        timeout = httpx.Timeout(connect=20.0, read=180.0, write=60.0, pool=20.0)
        try:
            with httpx.stream("GET", signed_url, timeout=timeout, follow_redirects=True) as response:
                response.raise_for_status()
                content_length = response.headers.get("content-length")
                if content_length:
                    try:
                        if int(content_length) > self.MAX_SOURCE_BYTES:
                            raise CourseAudioImportError("source_too_large")
                    except ValueError:
                        pass
                with destination.open("wb") as handle:
                    for block in response.iter_bytes(self.DOWNLOAD_BLOCK_BYTES):
                        if not block:
                            continue
                        total += len(block)
                        if total > self.MAX_SOURCE_BYTES:
                            raise CourseAudioImportError("source_too_large")
                        handle.write(block)
                        digest.update(block)
        except CourseAudioImportError:
            raise
        except Exception as exc:
            raise CourseAudioImportError("source_download_failed") from exc
        expected_size = row.get("size_bytes")
        if total <= 0 or total != expected_size:
            raise CourseAudioImportError("source_size_mismatch")
        return total, digest.hexdigest()

    @staticmethod
    def _probe_source(ffprobe: str, ffmpeg: str, source: Path) -> tuple[int, dict[str, Any]]:
        try:
            process = subprocess.run(
                [ffprobe, "-v", "error", "-show_entries",
                 "format=duration:stream=codec_type,codec_name,channels,sample_rate,duration",
                 "-of", "json", str(source)],
                capture_output=True, timeout=180, check=False,
            )
        except subprocess.TimeoutExpired as exc:
            raise CourseAudioImportError("source_probe_timeout") from exc
        if process.returncode != 0:
            raise CourseAudioImportError("source_invalid_or_corrupt")
        try:
            info = json.loads(process.stdout.decode("utf-8", errors="replace"))
            streams = info.get("streams") if isinstance(info, dict) else None
            raw_duration = info.get("format", {}).get("duration")
            if raw_duration is None:
                audio_streams = [item for item in streams or [] if isinstance(item, dict) and item.get("codec_type") == "audio"]
                stream_durations = [float(item["duration"]) for item in audio_streams if item.get("duration") not in (None, "N/A")]
                raw_duration = max(stream_durations) if stream_durations else None
            duration = float(raw_duration) if raw_duration is not None else 0.0
        except (ValueError, TypeError, AttributeError, json.JSONDecodeError):
            duration = 0.0
            info = {}
            streams = None
        if not isinstance(streams, list) or not any(item.get("codec_type") == "audio" for item in streams if isinstance(item, dict)):
            raise CourseAudioImportError("audio_track_missing")
        if any(item.get("codec_type") == "video" for item in streams if isinstance(item, dict)):
            raise CourseAudioImportError("video_track_not_supported")
        # Certains WebM issus de MediaRecorder n'ont ni format.duration ni
        # stream.duration. Dans ce cas, on mesure la durée réellement décodée.
        if not (0.4 <= duration <= CourseAudioImportWorker.MAX_DURATION_SECONDS):
            try:
                decoded = subprocess.run(
                    [ffmpeg, "-nostdin", "-hide_banner", "-v", "error", "-i", str(source),
                     "-map", "0:a:0", "-vn", "-t", str(CourseAudioImportWorker.MAX_DURATION_SECONDS + 1),
                     "-f", "null", "-", "-progress", "pipe:1", "-nostats"],
                    capture_output=True, timeout=6 * 60 * 60, check=False,
                )
            except subprocess.TimeoutExpired as exc:
                raise CourseAudioImportError("source_decode_timeout") from exc
            if decoded.returncode != 0:
                raise CourseAudioImportError("source_audio_decode_failed")
            last_duration = None
            for line in decoded.stdout.decode("utf-8", errors="replace").splitlines():
                if line.startswith("out_time_us="):
                    try:
                        last_duration = int(line.split("=", 1)[1]) / 1_000_000
                    except ValueError:
                        continue
            duration = float(last_duration or 0.0)
        if not (0.4 <= duration <= CourseAudioImportWorker.MAX_DURATION_SECONDS):
            raise CourseAudioImportError("duration_out_of_range")
        return int(round(duration * 1000)), info

    def _split(self, ffmpeg: str, source: Path, output_dir: Path) -> list[Path]:
        output_dir.mkdir(parents=True, exist_ok=True)
        pattern = output_dir / "segment_%03d.webm"
        command = [
            ffmpeg, "-nostdin", "-hide_banner", "-loglevel", "error", "-y",
            "-i", str(source), "-map", "0:a:0", "-vn",
            "-c:a", "libopus", "-b:a", "96k", "-application", "audio",
            "-f", "segment", "-segment_time", str(self.TARGET_SEGMENT_SECONDS),
            "-reset_timestamps", "1", "-segment_format", "webm", str(pattern),
        ]
        try:
            result = subprocess.run(command, capture_output=True, timeout=6 * 60 * 60, check=False)
        except subprocess.TimeoutExpired as exc:
            raise CourseAudioImportError("ffmpeg_split_timeout") from exc
        if result.returncode != 0:
            raise CourseAudioImportError("ffmpeg_split_failed")
        files = sorted(output_dir.glob("segment_*.webm"))
        if not 1 <= len(files) <= self.MAX_SEGMENTS:
            raise CourseAudioImportError("segment_count_out_of_range")
        return files

    def _process(self, row: dict[str, Any], stop: Event, heartbeat_failure: list[BaseException]) -> None:
        import_id = str(row["id"])
        user_id = str(row["user_id"])
        course_id = str(row["course_id"])
        ffmpeg, ffprobe = self._ensure_ffmpeg()
        self._progress(row, "downloading", 5)
        with tempfile.TemporaryDirectory(prefix="oria-audio-import-") as directory:
            root = Path(directory)
            source = root / ("source." + str(row.get("extension") or "bin"))
            self._download_source(row, source)
            if stop.is_set() or heartbeat_failure:
                raise CourseAudioImportError("worker_lease_lost")
            self._progress(row, "verifying", 16)
            source_duration_ms, _ = self._probe_source(ffprobe, ffmpeg, source)
            self._progress(row, "splitting", 22, duration_ms=source_duration_ms)
            segments_dir = root / "segments"
            files = self._split(ffmpeg, source, segments_dir)
            if stop.is_set() or heartbeat_failure:
                raise CourseAudioImportError("worker_lease_lost")
            manifests: list[dict[str, Any]] = []
            self._progress(row, "uploading_segments", 48,
                           duration_ms=source_duration_ms, segment_count=len(files))
            for index, path in enumerate(files):
                if stop.is_set() or heartbeat_failure:
                    raise CourseAudioImportError("worker_lease_lost")
                try:
                    data = path.read_bytes()
                except OSError as exc:
                    raise CourseAudioImportError("segment_read_failed") from exc
                if not data or len(data) > self.MAX_SEGMENT_BYTES:
                    raise CourseAudioImportError("segment_size_out_of_range")
                try:
                    manifest, normalized = CourseAudioPolicy.inspect_segment(
                        index=index, data=data, mime_type="audio/webm",
                    )
                except Exception as exc:
                    raise CourseAudioImportError("segment_audio_validation_failed") from exc
                if manifest["duration_ms"] > 300_000 or manifest["size_bytes"] > self.MAX_SEGMENT_BYTES:
                    raise CourseAudioImportError("segment_limits_exceeded")
                self.audio.upload_segment(
                    user_id=user_id, course_id=course_id, index=index,
                    data=normalized, mime_type=manifest["mime_type"],
                    extension=manifest["extension"], duration_ms=manifest["duration_ms"],
                )
                manifests.append(manifest)
                percent = 48 + int(47 * (index + 1) / len(files))
                self._progress(row, "uploading_segments", percent,
                               duration_ms=source_duration_ms, segment_count=index + 1)
            checked = CourseAudioPolicy.validate_manifest(manifests, document_format="pdf")
            if abs(int(checked["duration_ms"]) - source_duration_ms) > 8_000:
                raise CourseAudioImportError("split_duration_mismatch")
            if checked["segment_count"] > self.MAX_SEGMENTS:
                raise CourseAudioImportError("segment_count_out_of_range")
            if stop.is_set() or heartbeat_failure:
                raise CourseAudioImportError("worker_lease_lost")
            # Les segments sont déjà confirmés dans le stockage audio privé.
            # On confirme d'abord l'état SQL completed ; le nettoyage source est
            # ensuite best-effort et sera repris par cleanup_pending_sources().
            # Ainsi, une perte de bail ne peut jamais effacer la seule source
            # d'un import dont la fin n'aurait pas été confirmée.
            stop.set()
            self.imports.finish(
                import_id=import_id, worker_id=self.worker_id, status="completed",
                duration_ms=int(checked["duration_ms"]), segment_count=int(checked["segment_count"]),
            )
            try:
                self.imports.delete_source(storage_path=str(row["storage_path"]), import_id=import_id)
            except Exception:
                logger.warning("ORIA audio import source cleanup deferred import_id=%s", import_id)

    def run_once(self) -> bool:
        """Traite une tâche prête ; False si la file est vide."""
        row = self.imports.claim(worker_id=self.worker_id, lease_seconds=self.LEASE_SECONDS)
        if not row:
            try:
                self.imports.cleanup_pending_sources(limit=10)
            except Exception:
                logger.warning("ORIA audio import temporary cleanup pass failed", exc_info=True)
            return False
        import_id = str(row.get("id") or "")
        stop = Event()
        heartbeat_failure: list[BaseException] = []
        heartbeat = Thread(
            target=self._heartbeat_loop, args=(import_id, stop, heartbeat_failure),
            name="oria-audio-import-heartbeat", daemon=True,
        )
        heartbeat.start()
        try:
            self._process(row, stop, heartbeat_failure)
        except CourseAudioImportError as exc:
            safe_code = str(exc)[:80]
            logger.warning("ORIA audio import failed import_id=%s code=%s", import_id, safe_code)
            try:
                self.imports.finish(
                    import_id=import_id, worker_id=self.worker_id,
                    status="failed", error_code=safe_code,
                )
            except Exception:
                logger.exception("ORIA audio import failure transition not confirmed import_id=%s", import_id)
        except Exception:
            logger.exception("Unexpected ORIA audio import failure import_id=%s", import_id)
            try:
                self.imports.finish(
                    import_id=import_id, worker_id=self.worker_id,
                    status="failed", error_code="processing_failed",
                )
            except Exception:
                logger.exception("ORIA audio import failure transition not confirmed import_id=%s", import_id)
        finally:
            stop.set()
            heartbeat.join(timeout=10)
        return True


__all__ = ["CourseAudioImportWorker"]
'''

SQL_SOURCE = r'''-- ORIA Transcription — Chantier 3 : import audio long, privé et reprenable.
-- Migration additive : ne modifie ni oria_courses, ni le stockage des segments,
-- ni les devis/réservations/crédits. Aucun appel IA n'est déclenché ici.

CREATE TABLE IF NOT EXISTS public.oria_course_audio_imports (
    id UUID PRIMARY KEY,
    user_id UUID NOT NULL,
    course_id UUID NOT NULL REFERENCES public.oria_courses(id) ON DELETE CASCADE,
    filename TEXT NOT NULL CHECK (char_length(filename) BETWEEN 1 AND 180),
    mime_type TEXT NOT NULL,
    extension TEXT NOT NULL CHECK (extension IN ('webm','ogg','m4a','mp3','wav','aac','3gp')),
    size_bytes BIGINT NOT NULL CHECK (size_bytes BETWEEN 1 AND 536870912),
    storage_path TEXT NOT NULL UNIQUE,
    status TEXT NOT NULL DEFAULT 'uploading'
        CHECK (status IN ('uploading','queued','processing','completed','failed')),
    phase TEXT NOT NULL DEFAULT 'uploading'
        CHECK (phase IN ('uploading','queued','downloading','verifying','splitting','uploading_segments','completed','failed')),
    progress_percent SMALLINT NOT NULL DEFAULT 0 CHECK (progress_percent BETWEEN 0 AND 100),
    duration_ms BIGINT CHECK (duration_ms IS NULL OR duration_ms BETWEEN 400 AND 14400000),
    segment_count INTEGER CHECK (segment_count IS NULL OR segment_count BETWEEN 1 AND 120),
    error_code TEXT,
    worker_id UUID,
    lease_expires_at TIMESTAMPTZ,
    upload_expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '23 hours'),
    source_deleted_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT oria_course_audio_import_path_matches_id
      CHECK (storage_path LIKE user_id::text || '/' || course_id::text || '/imports/' || id::text || '.%')
);

CREATE INDEX IF NOT EXISTS oria_course_audio_import_queue_idx
    ON public.oria_course_audio_imports(status, lease_expires_at, created_at);
CREATE INDEX IF NOT EXISTS oria_course_audio_import_course_idx
    ON public.oria_course_audio_imports(user_id, course_id, created_at DESC);

ALTER TABLE public.oria_course_audio_imports ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.oria_course_audio_imports FROM anon, authenticated;
GRANT ALL ON TABLE public.oria_course_audio_imports TO service_role;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'oria-course-staging', 'oria-course-staging', false, 536870912,
  ARRAY['audio/webm','audio/ogg','audio/mp4','audio/mpeg','audio/mp3','audio/wav',
        'audio/x-wav','audio/aac','audio/3gpp','audio/x-m4a','audio/m4a']
)
ON CONFLICT (id) DO UPDATE SET
  public = false,
  file_size_limit = 536870912,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

CREATE OR REPLACE FUNCTION public.oria_course_audio_import_upload_allowed(p_object_name TEXT)
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.oria_course_audio_imports AS i
    WHERE i.user_id = auth.uid()
      AND i.storage_path = p_object_name
      AND i.status = 'uploading'
      AND i.upload_expires_at > now()
  );
$$;
REVOKE ALL ON FUNCTION public.oria_course_audio_import_upload_allowed(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.oria_course_audio_import_upload_allowed(TEXT) TO authenticated;

DROP POLICY IF EXISTS oria_course_audio_import_upload_insert ON storage.objects;
CREATE POLICY oria_course_audio_import_upload_insert
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'oria-course-staging'
  AND public.oria_course_audio_import_upload_allowed(name)
);

CREATE OR REPLACE FUNCTION public.oria_course_audio_import_queue(
  p_user_id UUID, p_course_id UUID, p_import_id UUID
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, storage, pg_temp
AS $$
DECLARE v_row public.oria_course_audio_imports;
BEGIN
  SELECT * INTO v_row FROM public.oria_course_audio_imports
   WHERE id = p_import_id AND user_id = p_user_id AND course_id = p_course_id
   FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'oria_course_audio_import_not_found'; END IF;
  IF v_row.status IN ('queued','processing','completed') THEN RETURN to_jsonb(v_row); END IF;
  IF v_row.status <> 'uploading' OR v_row.upload_expires_at <= now() THEN
    RAISE EXCEPTION 'oria_course_audio_import_state_conflict';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM storage.objects
     WHERE bucket_id = 'oria-course-staging' AND name = v_row.storage_path
  ) THEN RAISE EXCEPTION 'oria_course_audio_import_object_missing'; END IF;
  UPDATE public.oria_course_audio_imports
     SET status = 'queued', phase = 'queued', progress_percent = 0,
         error_code = NULL, updated_at = now()
   WHERE id = p_import_id RETURNING * INTO v_row;
  RETURN to_jsonb(v_row);
END;
$$;

CREATE OR REPLACE FUNCTION public.oria_course_audio_import_claim(
  p_worker_id UUID, p_lease_seconds INTEGER DEFAULT 3600
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE v_id UUID; v_row public.oria_course_audio_imports;
BEGIN
  IF p_lease_seconds < 60 OR p_lease_seconds > 3600 THEN
    RAISE EXCEPTION 'oria_course_audio_import_invalid_lease';
  END IF;
  SELECT id INTO v_id
    FROM public.oria_course_audio_imports
   WHERE status = 'queued'
      OR (status = 'processing' AND lease_expires_at < now())
   ORDER BY created_at
   LIMIT 1
   FOR UPDATE SKIP LOCKED;
  IF v_id IS NULL THEN RETURN NULL; END IF;
  UPDATE public.oria_course_audio_imports
     SET status = 'processing', phase = CASE WHEN phase IN ('queued','uploading') THEN 'downloading' ELSE phase END,
         worker_id = p_worker_id,
         lease_expires_at = now() + make_interval(secs => p_lease_seconds),
         updated_at = now()
   WHERE id = v_id RETURNING * INTO v_row;
  RETURN to_jsonb(v_row);
END;
$$;

CREATE OR REPLACE FUNCTION public.oria_course_audio_import_heartbeat(
  p_import_id UUID, p_worker_id UUID, p_lease_seconds INTEGER DEFAULT 3600
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE v_row public.oria_course_audio_imports;
BEGIN
  IF p_lease_seconds < 60 OR p_lease_seconds > 3600 THEN RAISE EXCEPTION 'oria_course_audio_import_invalid_lease'; END IF;
  UPDATE public.oria_course_audio_imports
     SET lease_expires_at = now() + make_interval(secs => p_lease_seconds), updated_at = now()
   WHERE id = p_import_id AND worker_id = p_worker_id AND status = 'processing'
   RETURNING * INTO v_row;
  IF NOT FOUND THEN RAISE EXCEPTION 'oria_course_audio_import_lease_lost'; END IF;
  RETURN to_jsonb(v_row);
END;
$$;

CREATE OR REPLACE FUNCTION public.oria_course_audio_import_progress(
  p_import_id UUID, p_worker_id UUID, p_phase TEXT, p_progress_percent INTEGER,
  p_duration_ms BIGINT DEFAULT NULL, p_segment_count INTEGER DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE v_row public.oria_course_audio_imports;
BEGIN
  IF p_phase NOT IN ('downloading','verifying','splitting','uploading_segments')
     OR p_progress_percent < 0 OR p_progress_percent > 99 THEN
    RAISE EXCEPTION 'oria_course_audio_import_invalid_progress';
  END IF;
  UPDATE public.oria_course_audio_imports
     SET phase = p_phase, progress_percent = p_progress_percent,
         duration_ms = COALESCE(p_duration_ms, duration_ms),
         segment_count = COALESCE(p_segment_count, segment_count),
         lease_expires_at = now() + interval '5 minutes', updated_at = now()
   WHERE id = p_import_id AND worker_id = p_worker_id AND status = 'processing'
   RETURNING * INTO v_row;
  IF NOT FOUND THEN RAISE EXCEPTION 'oria_course_audio_import_lease_lost'; END IF;
  RETURN to_jsonb(v_row);
END;
$$;

CREATE OR REPLACE FUNCTION public.oria_course_audio_import_finish(
  p_import_id UUID, p_worker_id UUID, p_status TEXT,
  p_duration_ms BIGINT DEFAULT NULL, p_segment_count INTEGER DEFAULT NULL,
  p_error_code TEXT DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE v_row public.oria_course_audio_imports;
BEGIN
  IF p_status NOT IN ('completed','failed') THEN RAISE EXCEPTION 'oria_course_audio_import_invalid_final_status'; END IF;
  IF p_status = 'completed' AND (p_duration_ms IS NULL OR p_segment_count IS NULL
      OR p_duration_ms < 400 OR p_duration_ms > 14400000
      OR p_segment_count < 1 OR p_segment_count > 120) THEN
    RAISE EXCEPTION 'oria_course_audio_import_invalid_result';
  END IF;
  UPDATE public.oria_course_audio_imports
     SET status = p_status, phase = p_status,
         progress_percent = CASE WHEN p_status = 'completed' THEN 100 ELSE progress_percent END,
         duration_ms = COALESCE(p_duration_ms, duration_ms),
         segment_count = COALESCE(p_segment_count, segment_count),
         error_code = CASE WHEN p_status = 'failed' THEN left(COALESCE(p_error_code,'processing_failed'),80) ELSE NULL END,
         worker_id = NULL, lease_expires_at = NULL, updated_at = now()
   WHERE id = p_import_id AND worker_id = p_worker_id AND status = 'processing'
   RETURNING * INTO v_row;
  IF NOT FOUND THEN RAISE EXCEPTION 'oria_course_audio_import_lease_lost'; END IF;
  RETURN to_jsonb(v_row);
END;
$$;

CREATE OR REPLACE FUNCTION public.oria_course_audio_import_retry(
  p_user_id UUID, p_course_id UUID, p_import_id UUID
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, storage, pg_temp
AS $$
DECLARE v_row public.oria_course_audio_imports;
BEGIN
  SELECT * INTO v_row FROM public.oria_course_audio_imports
   WHERE id = p_import_id AND user_id = p_user_id AND course_id = p_course_id
   FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'oria_course_audio_import_not_found'; END IF;
  IF v_row.status <> 'failed' THEN RAISE EXCEPTION 'oria_course_audio_import_state_conflict'; END IF;
  IF NOT EXISTS (SELECT 1 FROM storage.objects WHERE bucket_id='oria-course-staging' AND name=v_row.storage_path) THEN
    RAISE EXCEPTION 'oria_course_audio_import_object_missing';
  END IF;
  UPDATE public.oria_course_audio_imports
     SET status='queued', phase='queued', progress_percent=0, error_code=NULL,
         worker_id=NULL, lease_expires_at=NULL, updated_at=now()
   WHERE id=p_import_id RETURNING * INTO v_row;
  RETURN to_jsonb(v_row);
END;
$$;

REVOKE ALL ON FUNCTION public.oria_course_audio_import_queue(UUID,UUID,UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.oria_course_audio_import_claim(UUID,INTEGER) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.oria_course_audio_import_heartbeat(UUID,UUID,INTEGER) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.oria_course_audio_import_progress(UUID,UUID,TEXT,INTEGER,BIGINT,INTEGER) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.oria_course_audio_import_finish(UUID,UUID,TEXT,BIGINT,INTEGER,TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.oria_course_audio_import_retry(UUID,UUID,UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.oria_course_audio_import_queue(UUID,UUID,UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.oria_course_audio_import_claim(UUID,INTEGER) TO service_role;
GRANT EXECUTE ON FUNCTION public.oria_course_audio_import_heartbeat(UUID,UUID,INTEGER) TO service_role;
GRANT EXECUTE ON FUNCTION public.oria_course_audio_import_progress(UUID,UUID,TEXT,INTEGER,BIGINT,INTEGER) TO service_role;
GRANT EXECUTE ON FUNCTION public.oria_course_audio_import_finish(UUID,UUID,TEXT,BIGINT,INTEGER,TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.oria_course_audio_import_retry(UUID,UUID,UUID) TO service_role;
'''

TEST_SOURCE = r'''"""Tests purs hors réseau des chemins et plafonds d'import audio."""
from __future__ import annotations

import pytest

from app.repositories.supabase_course_audio_import_repository import (
    CourseAudioImportError, SupabaseCourseAudioImportRepository,
)


def test_import_path_is_scoped_to_owner_course_and_import():
    user = "11111111-1111-4111-8111-111111111111"
    course = "22222222-2222-4222-8222-222222222222"
    import_id = "33333333-3333-4333-8333-333333333333"
    assert SupabaseCourseAudioImportRepository._path(
        user_id=user, course_id=course, import_id=import_id, extension="m4a"
    ) == f"{user}/{course}/imports/{import_id}.m4a"


def test_import_path_rejects_unapproved_extension():
    with pytest.raises(CourseAudioImportError):
        SupabaseCourseAudioImportRepository._path(
            user_id="11111111-1111-4111-8111-111111111111",
            course_id="22222222-2222-4222-8222-222222222222",
            import_id="33333333-3333-4333-8333-333333333333",
            extension="exe",
        )


def test_import_source_limit_is_512_mib():
    assert SupabaseCourseAudioImportRepository.MAX_UPLOAD_BYTES == 512 * 1024 * 1024
'''


def main() -> int:
    required = (ROUTE, MAIN, REQ)
    for path in required:
        if not path.is_file():
            fail(f"Fichier requis introuvable : {path.relative_to(ROOT)}")
    new_targets = (REPO_NEW, WORKER_NEW, SQL_NEW, TEST_NEW)
    existing = [path.relative_to(ROOT).as_posix() for path in new_targets if path.exists()]
    if existing:
        fail("Le chantier 3 backend semble déjà partiellement installé. Aucun écrasement : " + ", ".join(existing))

    route_text = ROUTE.read_text(encoding="utf-8")
    main_text = MAIN.read_text(encoding="utf-8")
    requirements_text = REQ.read_text(encoding="utf-8")

    if "from app.repositories.supabase_course_audio_import_repository import" in route_text:
        fail("Le repository audio-import est déjà raccordé à courses.py.")
    if "ORIA_COURSE_AUDIO_IMPORT_WORKER_ENABLED" in main_text:
        fail("Le worker audio-import est déjà déclaré dans main.py.")
    if "static-ffmpeg" in requirements_text.lower():
        fail("static-ffmpeg apparaît déjà dans requirements.txt ; vérifier la version avant application.")
    if "@router.get(\"/{course_id}\")" not in route_text:
        fail("Ancre de routes courses.py introuvable.")
    if "@router.put(\"/{course_id}/segments/{index}\"" not in route_text:
        fail("Route d'upload de segments introuvable.")
    if "@router.post(\"/{course_id}/submit\")" not in route_text:
        fail("Route de soumission introuvable.")

    # Imports backend additionnels.
    route_text = replace_once(
        route_text,
        "from app.repositories.supabase_audio_repository import (\n    CourseStorageConflict,\n    CourseStorageError,\n    SupabaseCourseAudioRepository,\n)\n",
        "from app.repositories.supabase_audio_repository import (\n    CourseStorageConflict,\n    CourseStorageError,\n    SupabaseCourseAudioRepository,\n)\nfrom app.repositories.supabase_course_audio_import_repository import (\n    CourseAudioImportError, SupabaseCourseAudioImportRepository,\n)\n",
        "import du repository des imports audio",
    )
    route_text = replace_once(
        route_text,
        "from app.services.audio_service import AudioInvalid, CourseAudioPolicy\n",
        "from app.services.audio_service import AudioInvalid, AudioService, CourseAudioPolicy\n",
        "réutilisation des formats audio acceptés",
    )

    route_text = replace_once(
        route_text,
        '            "maximum_segments": CourseAudioPolicy.MAX_SEGMENTS,\n        }',
        '            "maximum_segments": CourseAudioPolicy.MAX_SEGMENTS,\n            "long_audio_import_enabled": _audio_import_enabled(),\n        }',
        "capacité d'import audio long",
    )

    # Schéma de création de session. La taille déclarée est revérifiée sur le vrai objet par le worker.
    route_text = replace_once(
        route_text,
        "class QuoteBody(BaseModel):\n",
        "class CreateCourseAudioImportBody(BaseModel):\n    model_config = ConfigDict(extra=\"forbid\")\n    import_id: UUID\n    filename: str = Field(min_length=1, max_length=240)\n    mime_type: str = Field(min_length=3, max_length=100)\n    size_bytes: int = Field(gt=0, le=512 * 1024 * 1024)\n\n\nclass QuoteBody(BaseModel):\n",
        "schema de création d'import long",
    )

    # Helpers sûrs côté API : aucun chemin privé n'est exposé, hormis le chemin objet TUS nécessaire à l'upload.
    route_text = replace_once(
        route_text,
        "def _public_segment(row: dict[str, Any]) -> dict[str, Any]:\n    # Ne jamais retourner storage_path, hash de contenu ou octets audio.\n    return {\"index\": row[\"segment_index\"], \"duration_ms\": row[\"duration_ms\"],\n            \"size_bytes\": row[\"size_bytes\"], \"mime_type\": row[\"mime_type\"]}\n\n\n",
        "def _public_segment(row: dict[str, Any]) -> dict[str, Any]:\n    # Ne jamais retourner storage_path, hash de contenu ou octets audio.\n    return {\"index\": row[\"segment_index\"], \"duration_ms\": row[\"duration_ms\"],\n            \"size_bytes\": row[\"size_bytes\"], \"mime_type\": row[\"mime_type\"]}\n\n\ndef _audio_import_enabled() -> bool:\n    return os.getenv(\"ORIA_COURSE_AUDIO_IMPORT_ENABLED\", \"0\").strip() == \"1\"\n\n\ndef _require_audio_import_enabled() -> None:\n    if not _audio_import_enabled():\n        raise HTTPException(503, \"Import audio long ORIA non activé.\")\n\n\ndef _audio_import_repository() -> SupabaseCourseAudioImportRepository:\n    return SupabaseCourseAudioImportRepository(supabase)\n\n\ndef _public_audio_import(row: dict[str, Any] | None) -> dict[str, Any] | None:\n    if not isinstance(row, dict):\n        return None\n    return {\n        \"id\": str(row.get(\"id\") or \"\"),\n        \"course_id\": str(row.get(\"course_id\") or \"\"),\n        \"filename\": str(row.get(\"filename\") or \"audio\"),\n        \"mime_type\": row.get(\"mime_type\"),\n        \"size_bytes\": row.get(\"size_bytes\"),\n        \"status\": row.get(\"status\"),\n        \"phase\": row.get(\"phase\"),\n        \"progress_percent\": row.get(\"progress_percent\", 0),\n        \"duration_ms\": row.get(\"duration_ms\"),\n        \"segment_count\": row.get(\"segment_count\"),\n        \"error_code\": row.get(\"error_code\"),\n        \"created_at\": row.get(\"created_at\"),\n        \"updated_at\": row.get(\"updated_at\"),\n    }\n\n\ndef _assert_no_incomplete_audio_import(uid: str, cid: str) -> None:\n    # Tant que la migration et le flag ne sont pas activés, le parcours\n    # historique d'upload par segments reste entièrement indépendant.\n    if not _audio_import_enabled():\n        return\n    try:\n        latest = _audio_import_repository().latest(user_id=uid, course_id=cid)\n    except CourseAudioImportError:\n        raise HTTPException(503, \"Préparation audio indisponible : vérifier la migration ORIA Transcription.\") from None\n    if latest and latest.get(\"status\") != \"completed\":\n        raise HTTPException(409, \"Un import audio est encore incomplet. Reprenez ou terminez sa préparation avant de continuer.\")\n\n\n",
        "helpers de publication audio-import",
    )

    # Création, reprise, statut et finalisation d'un transfert TUS.
    audio_import_routes = r'''@router.post("/{course_id}/audio-imports", status_code=201)
def create_course_audio_import(
    course_id: str,
    payload: CreateCourseAudioImportBody,
    uid: str = Depends(_authenticated_user),
    deps: CourseDependencies = Depends(_get_components),
) -> dict[str, Any]:
    cid = _course_id(course_id)
    _require_audio_import_enabled()
    try:
        course = _owned_course(deps, uid, cid)
        if course.get("status") != "uploading":
            raise HTTPException(409, "Cet enregistrement n'accepte plus de nouveaux fichiers audio.")
        if deps.audio.list_segments(user_id=uid, course_id=cid):
            raise HTTPException(409, "Des segments audio existent déjà pour cet enregistrement.")
        repo = _audio_import_repository()
        latest = repo.latest(user_id=uid, course_id=cid)
        if latest and latest.get("status") != "completed" and str(latest.get("id")) != str(payload.import_id):
            raise HTTPException(409, "Un import audio existe déjà pour cet enregistrement. Reprenez-le avant d'en créer un autre.")
        mime = payload.mime_type.split(";", 1)[0].strip().lower()
        extension = AudioService.MIME_EXTENSIONS.get(mime)
        if not extension or extension not in {"webm", "ogg", "m4a", "mp3", "wav", "aac", "3gp"}:
            raise HTTPException(422, "Format audio non pris en charge.")
        row = repo.create(
            user_id=uid, course_id=cid, import_id=str(payload.import_id),
            filename=payload.filename, mime_type=mime, extension=extension,
            size_bytes=payload.size_bytes,
        )
        return {
            "audio_import": _public_audio_import(row),
            "bucket": repo.BUCKET,
            "object_name": row["storage_path"],
            "chunk_size_bytes": 6 * 1024 * 1024,
        }
    except HTTPException:
        raise
    except CourseAudioImportError as exc:
        raise HTTPException(409, str(exc)[:220]) from None
    except Exception as exc:
        raise _translate_error(exc) from None


@router.post("/{course_id}/audio-imports/{import_id}/complete")
def complete_course_audio_import(
    course_id: str,
    import_id: str,
    uid: str = Depends(_authenticated_user),
    deps: CourseDependencies = Depends(_get_components),
) -> dict[str, Any]:
    cid, iid = _course_id(course_id), _course_id(import_id)
    _require_audio_import_enabled()
    try:
        course = _owned_course(deps, uid, cid)
        if course.get("status") != "uploading":
            raise HTTPException(409, "Cet enregistrement n'accepte plus de préparation audio.")
        row = _audio_import_repository().queue(user_id=uid, course_id=cid, import_id=iid)
        return {"audio_import": _public_audio_import(row), "queued": row.get("status") in {"queued", "processing", "completed"}}
    except HTTPException:
        raise
    except CourseAudioImportError as exc:
        raise HTTPException(409, str(exc)[:220]) from None
    except Exception as exc:
        raise _translate_error(exc) from None


@router.get("/{course_id}/audio-imports/latest")
def latest_course_audio_import(
    course_id: str,
    uid: str = Depends(_authenticated_user),
) -> dict[str, Any]:
    cid = _course_id(course_id)
    _require_audio_import_enabled()
    try:
        row = _audio_import_repository().latest(user_id=uid, course_id=cid)
        if row and str(row.get("course_id")) != cid:
            raise HTTPException(404, "Import audio introuvable.")
        return {"audio_import": _public_audio_import(row)}
    except HTTPException:
        raise
    except CourseAudioImportError as exc:
        raise HTTPException(503, str(exc)[:220]) from None


@router.get("/{course_id}/audio-imports/{import_id}")
def get_course_audio_import(
    course_id: str,
    import_id: str,
    uid: str = Depends(_authenticated_user),
) -> dict[str, Any]:
    cid, iid = _course_id(course_id), _course_id(import_id)
    _require_audio_import_enabled()
    try:
        row = _audio_import_repository().get(user_id=uid, course_id=cid, import_id=iid)
        if not row:
            raise HTTPException(404, "Import audio introuvable.")
        return {"audio_import": _public_audio_import(row)}
    except HTTPException:
        raise
    except CourseAudioImportError as exc:
        raise HTTPException(503, str(exc)[:220]) from None


@router.post("/{course_id}/audio-imports/{import_id}/retry")
def retry_course_audio_import(
    course_id: str,
    import_id: str,
    uid: str = Depends(_authenticated_user),
    deps: CourseDependencies = Depends(_get_components),
) -> dict[str, Any]:
    cid, iid = _course_id(course_id), _course_id(import_id)
    _require_audio_import_enabled()
    try:
        course = _owned_course(deps, uid, cid)
        if course.get("status") != "uploading":
            raise HTTPException(409, "La préparation ne peut plus être relancée pour cet enregistrement.")
        row = _audio_import_repository().retry(user_id=uid, course_id=cid, import_id=iid)
        return {"audio_import": _public_audio_import(row), "queued": True}
    except HTTPException:
        raise
    except CourseAudioImportError as exc:
        raise HTTPException(409, str(exc)[:220]) from None


'''
    route_text = replace_once(
        route_text,
        '@router.get("/{course_id}")\ndef get_course(',
        audio_import_routes + '@router.get("/{course_id}")\ndef get_course(',
        "routes de transfert TUS avant route de lecture course",
    )

    # Verrou API : ni ajout manuel de fragments, ni soumission avant fin de l'import long.
    route_text = replace_once(
        route_text,
        'async def upload_segment(\n    course_id: str,\n    index: int,\n    file: UploadFile = File(...),\n    uid: str = Depends(_authenticated_user),\n    deps: CourseDependencies = Depends(_get_components),\n) -> dict[str, Any]:\n    cid = _course_id(course_id)\n',
        'async def upload_segment(\n    course_id: str,\n    index: int,\n    file: UploadFile = File(...),\n    uid: str = Depends(_authenticated_user),\n    deps: CourseDependencies = Depends(_get_components),\n) -> dict[str, Any]:\n    cid = _course_id(course_id)\n    _assert_no_incomplete_audio_import(uid, cid)\n',
        "blocage des imports longs incomplets avant upload segment manuel",
    )
    route_text = replace_once(
        route_text,
        '    try:\n        _owned_course(deps, uid, cid)\n        row = deps.audio.submit_course(user_id=uid, course_id=cid)\n',
        '    try:\n        _owned_course(deps, uid, cid)\n        _assert_no_incomplete_audio_import(uid, cid)\n        row = deps.audio.submit_course(user_id=uid, course_id=cid)\n',
        "blocage submit avant préparation complète",
    )

    # Worker opt-in dans le processus Render : travail lourd hors requête HTTP,
    # file SQL reprenable après redémarrage et baux indépendants.
    worker_loop = r'''

# ORIA Transcription — préparateur audio long (aucun appel IA / aucune facturation).
# Activer uniquement après application de la migration SQL correspondante.
_oria_course_audio_import_task = None

@app.on_event("startup")
async def _oria_course_audio_import_start():
    global _oria_course_audio_import_task
    if (os.getenv("ORIA_COURSE_AUDIO_IMPORT_ENABLED", "0").strip() != "1"
            or os.getenv("ORIA_COURSE_AUDIO_IMPORT_WORKER_ENABLED", "0").strip() != "1"):
        return
    from app.core.supabase import supabase as _audio_import_db
    from app.services.course_audio_import_worker import CourseAudioImportWorker
    worker = CourseAudioImportWorker(_audio_import_db)

    async def _loop():
        while True:
            try:
                did_work = await asyncio.to_thread(worker.run_once)
                await asyncio.sleep(1 if did_work else 5)
            except asyncio.CancelledError:
                raise
            except Exception:
                logging.getLogger("oria.transcription.audio_import").exception(
                    "ORIA long-audio preparation loop failed"
                )
                await asyncio.sleep(5)

    _oria_course_audio_import_task = asyncio.create_task(_loop())


@app.on_event("shutdown")
async def _oria_course_audio_import_stop():
    global _oria_course_audio_import_task
    if _oria_course_audio_import_task is not None:
        _oria_course_audio_import_task.cancel()
        try:
            await _oria_course_audio_import_task
        except asyncio.CancelledError:
            pass
        _oria_course_audio_import_task = None
'''
    main_text = main_text.rstrip() + worker_loop + "\n"

    if "static-ffmpeg==3.0" not in requirements_text:
        requirements_text = requirements_text.rstrip() + "\nstatic-ffmpeg==3.0\n"

    # Vérification de cohérence avant sauvegardes/écritures.
    required_route_markers = (
        "def _audio_import_enabled() -> bool:",
        "def create_course_audio_import(",
        "def complete_course_audio_import(",
        "def latest_course_audio_import(",
        "def get_course_audio_import(",
        "def retry_course_audio_import(",
        "_assert_no_incomplete_audio_import(uid, cid)",
    )
    if any(marker not in route_text for marker in required_route_markers):
        fail("Vérification de cohérence des routes d'import audio échouée.")
    if "ORIA_COURSE_AUDIO_IMPORT_WORKER_ENABLED" not in main_text:
        fail("Le worker de préparation n'est pas relié au démarrage FastAPI.")
    if "transcribe" in WORKER_SOURCE.lower() and "openai" in WORKER_SOURCE.lower():
        fail("Le worker de préparation ne doit pas intégrer de moteur IA.")

    # Toutes les transformations sont validées en mémoire avant la moindre écriture.
    stamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    backups = []
    for path, content in ((ROUTE, route_text), (MAIN, main_text), (REQ, requirements_text)):
        backup = path.with_name(path.name + f".bak-oria-audio-import-{stamp}")
        shutil.copy2(path, backup)
        backups.append(backup)
        path.write_text(content, encoding="utf-8", newline="\n")

    REPO_NEW.write_text(REPOSITORY_SOURCE, encoding="utf-8", newline="\n")
    WORKER_NEW.write_text(WORKER_SOURCE, encoding="utf-8", newline="\n")
    SQL_NEW.write_text(SQL_SOURCE, encoding="utf-8", newline="\n")
    TEST_NEW.write_text(TEST_SOURCE, encoding="utf-8", newline="\n")

    print("OK : socle backend du chantier 3 ORIA Transcription installé.")
    print("Fichiers créés :")
    for path in new_targets:
        print(f" - {path.relative_to(ROOT)}")
    print("Fichiers modifiés :")
    for path in (ROUTE, MAIN, REQ):
        print(f" - {path.relative_to(ROOT)}")
    print("Sauvegardes créées :")
    for path in backups:
        print(f" - {path.relative_to(ROOT)}")
    print("Fonctionnement ajouté :")
    print(" - Transfert TUS vers le bucket privé oria-course-staging (routes d'initialisation/finalisation).")
    print(" - File SQL durable, leases worker, progression et reprise d'un import échoué.")
    print(" - FFprobe vérifie la vraie durée ; FFmpeg encode des segments WebM/Opus de 4 min 45.")
    print(" - Les segments utilisent SupabaseCourseAudioRepository.upload_segment existant.")
    print(" - Aucun appel IA, aucun devis, aucune réservation ou dépense pendant la préparation.")
    print("Migration à appliquer dans Supabase avant activation du worker :")
    print(" - Backend/oria_transcription_audio_import.sql")
    print("Dépendance FFmpeg portable ajoutée : static-ffmpeg==3.0.")
    print("Activation Render après migration : ORIA_COURSE_AUDIO_IMPORT_ENABLED=1")
    print("Activation du worker Render : ORIA_COURSE_AUDIO_IMPORT_WORKER_ENABLED=1")
    print("À ce stade, le frontend TUS n'est pas encore raccordé ; prochaine sous-étape : interface d'import et reprise.")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        print(f"ERREUR : {exc}", file=sys.stderr)
        raise SystemExit(1)
