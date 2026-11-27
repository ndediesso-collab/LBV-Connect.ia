"""Préparation asynchrone des fichiers audio longs ORIA Transcription.

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
