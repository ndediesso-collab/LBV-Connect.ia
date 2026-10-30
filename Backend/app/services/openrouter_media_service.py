"""ORIA — OpenRouter provider adapter for image/video creations.

Install as app/services/openrouter_media_service.py.

No ORIA billing, no user identity and no persistence are performed by this adapter.
Invoke paid methods ONLY from a caller that has atomically reserved ORIA credits,
validated pack entitlements, recorded idempotency and (for video) persists job IDs.

Official contracts (Oct 2026):
  POST /api/v1/images -> data[].b64_json; usage.cost optional
  POST /api/v1/videos -> async job ID
  GET  /api/v1/videos/{job_id} -> status / usage.cost
  GET  /api/v1/videos/{job_id}/content -> bytes (when completed)
"""
from __future__ import annotations

import base64
import binascii
import json
import logging
import os
import re
import datetime
import urllib.error
import urllib.request
import threading

from app.services.oria_memory_management import purge_ram
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Mapping


BASE_URL = "https://openrouter.ai/api/v1"
MAX_REFERENCE_BYTES = 10 * 1024 * 1024
# Encoded 4K responses can exceed 29 MiB, and decoded PNGs can exceed 20 MiB.
# Keep independent bounded limits: HTTP/JSON bytes and decoded image bytes.
MAX_IMAGE_BYTES = 40 * 1024 * 1024
MAX_IMAGE_RESPONSE_BYTES = 64 * 1024 * 1024
MAX_VIDEO_BYTES = 150 * 1024 * 1024
_ID_RE = re.compile(r"^[A-Za-z0-9_-]{1,160}$")
_IMAGE_MIMES = {"image/png", "image/jpeg", "image/webp"}
_RECOVERY_LOG = logging.getLogger("oria.openrouter.recovery")
# One heavy OpenRouter media operation at a time per Python worker.
# Across multiple Gunicorn/Uvicorn workers, set WEB_CONCURRENCY=1 on small Render plans.
_HEAVY_MEDIA_LOCK = threading.Lock()
_IMAGE_SIGNATURES = {
    "image/png": lambda b: b.startswith(b"\x89PNG\r\n\x1a\n"),
    "image/jpeg": lambda b: b.startswith(b"\xff\xd8\xff"),
    "image/webp": lambda b: b.startswith(b"RIFF") and b[8:12] == b"WEBP",
}


class OpenRouterMediaError(RuntimeError):
    def __init__(self, message: str, *, status_code: int | None = None,
                 retry_after_seconds: int | None = None, provider_reason: str | None = None,
                 phase: str | None = None):
        super().__init__(message)
        self.status_code = status_code
        self.retry_after_seconds = retry_after_seconds
        # Structured, bounded, sanitized reason only. Never store raw provider bodies.
        self.provider_reason = provider_reason
        self.phase = phase


@dataclass(frozen=True)
class OpenRouterMediaFile:
    file_path: str
    mime_type: str
    model: str
    usage: dict[str, Any]
    interaction_id: str | None = None

    @property
    def media_type(self) -> str:
        return "image" if self.mime_type.startswith("image/") else "video"


class OpenRouterMediaService:
    """Small stdlib HTTP client; injectable ``opener`` enables network-free tests."""

    def __init__(self, *, api_key: str | None = None, opener: Any = None):
        self.api_key = (api_key if api_key is not None else os.getenv("OPENROUTER_API_KEY", "")).strip()
        self.opener = opener or urllib.request.urlopen
        if not self.api_key:
            raise OpenRouterMediaError("OPENROUTER_API_KEY absente du serveur.")

    @staticmethod
    def _allowlist(env_var: str, defaults: tuple[str, ...]) -> tuple[str, ...]:
        raw = os.getenv(env_var, "").strip()
        selected = tuple(x.strip() for x in raw.split(",") if x.strip()) if raw else defaults
        return tuple(dict.fromkeys(selected))

    @property
    def image_models_allowed(self) -> tuple[str, ...]:
        return self._allowlist(
            "ORIA_OPENROUTER_IMAGE_MODELS",
            ("google/gemini-3.1-flash-lite-image", "google/gemini-3.1-flash-image", "google/gemini-3-pro-image"),
        )

    @property
    def video_models_allowed(self) -> tuple[str, ...]:
        return self._allowlist(
            "ORIA_OPENROUTER_VIDEO_MODELS",
            ("google/veo-3.1-lite", "google/veo-3.1-fast", "google/veo-3.1"),
        )

    @staticmethod
    def _retry_after(exc: urllib.error.HTTPError) -> int | None:
        value = str(exc.headers.get("Retry-After", "")).strip() if exc.headers else ""
        if value.isdigit():
            return min(900, max(1, int(value)))
        # HTTP-date accepted without an unbounded delay.
        if value:
            try:
                from email.utils import parsedate_to_datetime
                date = parsedate_to_datetime(value)
                now = datetime.datetime.now(datetime.timezone.utc)
                seconds = int((date - now).total_seconds())
                return min(900, max(1, seconds))
            except (TypeError, ValueError, OverflowError):
                pass
        return None

    @staticmethod
    def _safe_provider_reason(exc: urllib.error.HTTPError) -> str | None:
        """Extract stable, non-sensitive OpenRouter error classifications.

        Never include upstream raw text, echoed prompts, request bodies or keys.
        The metadata is required to distinguish OpenRouter/platform limits from
        provider-specific throttling, without recording customer information.
        """
        try:
            raw = exc.read(8192)
            obj = json.loads(raw)
            error = obj.get("error") if isinstance(obj, dict) else None
            if not isinstance(error, dict):
                return None
            metadata = error.get("metadata")
            if not isinstance(metadata, dict):
                metadata = {}

            def safe_token(value: Any, limit: int = 40) -> str | None:
                if not isinstance(value, str):
                    return None
                value = value.strip().lower()
                # Strictly classify machine tokens only, never natural language.
                return value if re.fullmatch(r"[a-z0-9_.-]{1,%d}" % limit, value) else None

            parts = []
            for key, label in (
                ("error_type", "type"),
                ("limit_source", "source"),
                ("provider_name", "fournisseur"),
                ("provider_code", "code_fournisseur"),
                ("reason", "raison"),
            ):
                token = safe_token(metadata.get(key))
                if token:
                    parts.append(f"{label}={token}")

            if parts:
                return ", ".join(parts)[:150]

            # Some older OpenRouter replies do not expose metadata.
            code = error.get("code")
            message = error.get("message")
            normalized = " ".join(str(x).lower() for x in (code, message) if x is not None)
            for needle, label in (
                ("resource_exhausted", "type=resource_exhausted"),
                ("rate_limit", "type=rate_limit"),
                ("rate limit", "type=rate_limit"),
                ("quota", "type=quota"),
                ("capacity", "type=capacity"),
                ("temporarily unavailable", "type=temporarily_unavailable"),
            ):
                if needle in normalized:
                    return label
        except (ValueError, TypeError, UnicodeError, AttributeError, OSError):
            pass
        return None

    def _call(self, method: str, route: str, *, payload: Mapping[str, Any] | None = None,
              timeout: int = 40, max_bytes: int = 3 * 1024 * 1024,
              trace_id: str | None = None) -> bytes:
        # Never allow user-supplied hostnames, query URLs, arbitrary job paths, etc.
        trace = trace_id if isinstance(trace_id, str) and re.fullmatch(r"[A-Za-z0-9_-]{8,80}", trace_id) else "unknown"
        if not route.startswith("/") or ".." in route or "//" in route or "?" in route:
            raise OpenRouterMediaError("Route OpenRouter interne invalide.")
        body = json.dumps(payload, separators=(",", ":")).encode("utf-8") if payload is not None else None
        req = urllib.request.Request(
            BASE_URL + route, data=body, method=method,
            headers={
                "Authorization": f"Bearer {self.api_key}",
                "Accept": "application/json" if max_bytes <= 3 * 1024 * 1024 else "*/*",
                "Content-Type": "application/json",
                "X-Title": "ORIA",
            },
        )
        try:
            with self.opener(req, timeout=timeout) as response:
                if not 200 <= response.status < 300:
                    raise OpenRouterMediaError(
                        f"OpenRouter a répondu HTTP {response.status}.", status_code=response.status
                    )
                try:
                    result = response.read(max_bytes + 1)
                except Exception as exc:
                    if route == "/images" and method == "POST":
                        _RECOVERY_LOG.warning(
                            "image_recovery phase=http_read_failed request_id=%s error_type=%s",
                            trace, type(exc).__name__,
                        )
                    raise
                if len(result) > max_bytes:
                    if route == "/images" and method == "POST":
                        _RECOVERY_LOG.warning("image_recovery phase=http_size_limit request_id=%s bytes=%d", trace, len(result))
                    raise OpenRouterMediaError("Réponse OpenRouter trop volumineuse.", phase="http_size_limit")
                if route == "/images" and method == "POST":
                    _RECOVERY_LOG.info("image_recovery phase=http_received request_id=%s http_status=%d bytes=%d", trace, response.status, len(result))
                return result
        except urllib.error.HTTPError as exc:
            # Never log full vendor body, which can contain echoed prompts/metadata.
            mapping = {
                400: "Paramètres ou modèle refusés par OpenRouter.",
                401: "Clé OpenRouter invalide ou révoquée.",
                402: "Solde OpenRouter insuffisant.",
                403: "Modèle ou compte OpenRouter non autorisé.",
                404: "Modèle ou tâche OpenRouter introuvable.",
                429: "Limite OpenRouter atteinte.",
            }
            retry_after = self._retry_after(exc) if exc.code == 429 else None
            reason = self._safe_provider_reason(exc) if exc.code == 429 else None
            message = mapping.get(exc.code, "Erreur du fournisseur OpenRouter.")
            if exc.code == 429:
                detail = f" Diagnostic fournisseur : {reason}." if reason else ""
                message = ("OpenRouter a refusé la vidéo (HTTP 429 : limite de débit ou capacité)."
                           f"{detail} "
                           f"Nouvelle tentative conseillée après {retry_after or 120} secondes. "
                           "Ce délai n'assure pas que le modèle sera disponible.")
            raise OpenRouterMediaError(message, status_code=exc.code,
                                       retry_after_seconds=retry_after,
                                       provider_reason=reason) from exc
        except (urllib.error.URLError, TimeoutError) as exc:
            # Unknown upstream execution outcome: caller must NOT automatically retry a paid POST.
            raise OpenRouterMediaError(
                "Réseau OpenRouter indisponible : résultat potentiellement incertain. "
                "Ne pas relancer automatiquement une création payante."
            ) from exc

    def _json(self, method: str, route: str, *, payload: Mapping[str, Any] | None = None,
              timeout: int = 40, max_bytes: int = 3 * 1024 * 1024,
              trace_id: str | None = None) -> dict[str, Any]:
        result = self._call(method, route, payload=payload, timeout=timeout, max_bytes=max_bytes, trace_id=trace_id)
        try:
            data = json.loads(result)
        except (UnicodeDecodeError, ValueError) as exc:
            raise OpenRouterMediaError("Réponse JSON OpenRouter invalide.", phase="json_decode") from exc
        if not isinstance(data, dict):
            raise OpenRouterMediaError("Réponse OpenRouter inattendue.", phase="json_shape")
        return data

    @staticmethod
    def _catalog_entries(raw: Mapping[str, Any], allowed: tuple[str, ...]) -> list[dict[str, Any]]:
        rows = raw.get("data")
        if not isinstance(rows, list):
            raise OpenRouterMediaError("Catalogue OpenRouter invalide.")
        return [row for row in rows if isinstance(row, dict) and row.get("id") in allowed]

    def list_image_models(self) -> list[dict[str, Any]]:
        return self._catalog_entries(self._json("GET", "/images/models"), self.image_models_allowed)

    def list_video_models(self) -> list[dict[str, Any]]:
        return self._catalog_entries(self._json("GET", "/videos/models"), self.video_models_allowed)

    @staticmethod
    def _require_model(model: str, options: list[dict[str, Any]]) -> dict[str, Any]:
        entry = next((item for item in options if item.get("id") == model), None)
        if entry is None:
            raise OpenRouterMediaError("Modèle absent de la liste autorisée et disponible OpenRouter.")
        return entry

    @staticmethod
    def _reference(mime: str, content: bytes) -> dict[str, Any]:
        if mime not in _IMAGE_MIMES or not (0 < len(content) <= MAX_REFERENCE_BYTES):
            raise OpenRouterMediaError("Image de référence invalide (PNG/JPEG/WebP, 10 Mo max).")
        if not _IMAGE_SIGNATURES[mime](content):
            raise OpenRouterMediaError("L'image de référence ne correspond pas au type déclaré.")
        return {"type": "image_url", "image_url": {
            "url": f"data:{mime};base64,{base64.b64encode(content).decode('ascii')}"
        }}

    @staticmethod
    def _parameter(entry: Mapping[str, Any], name: str) -> Any:
        """Image API catalogue: supported_parameters is a map of typed specs.

        Video API catalogue: separate supported_* arrays. Fail closed if a
        parameter's capabilities cannot be established.
        """
        params = entry.get("supported_parameters")
        if isinstance(params, dict):
            return params.get(name)
        if isinstance(params, list) and name in params:
            return {"type": "boolean"}
        return None

    @classmethod
    def _image_choices(cls, entry: Mapping[str, Any], name: str) -> list[Any]:
        value = cls._parameter(entry, name)
        if not isinstance(value, dict):
            return []
        choices = value.get("values")
        return choices if isinstance(choices, list) else []

    @staticmethod
    def _assert_choice(value: Any, allowed: Any, name: str) -> None:
        if not isinstance(allowed, list) or not allowed:
            raise OpenRouterMediaError(f"Capacités {name} non confirmées pour ce modèle.")
        if value not in allowed:
            raise OpenRouterMediaError(f"{name} non pris en charge par ce modèle.")

    @staticmethod
    def _save_media(path: Path, data: bytes, limit: int) -> None:
        if not data or len(data) > limit:
            raise OpenRouterMediaError("Résultat média vide ou trop volumineux.")
        path.parent.mkdir(parents=True, exist_ok=True)
        if path.is_symlink():
            raise OpenRouterMediaError("Destination de média invalide.")
        created = False
        try:
            with path.open("xb") as handle:
                created = True
                handle.write(data)
        except BaseException:
            # Only unlink a newly created partial file, after its handle closes.
            if created:
                path.unlink(missing_ok=True)
            raise

    @staticmethod
    def _usage(data: Mapping[str, Any]) -> dict[str, Any]:
        usage = data.get("usage")
        if isinstance(usage, dict):
            return dict(usage)
        # Absence of cost is not zero cost. Downstream billing must reconcile.
        return {"cost": None, "reconciliation_required": True}

    @staticmethod
    def _verified_image(b64_value: Any, declared_mime: Any) -> tuple[bytes, str]:
        """Decode a bounded image and recognize its MIME from a verified signature.

        OpenRouter may omit media_type; defaulting to PNG would discard valid JPEGs.
        We never fetch arbitrary provider URLs or trust an unverified MIME.
        """
        if not isinstance(b64_value, str) or not b64_value:
            raise OpenRouterMediaError("Image Base64 absente.", phase="base64_missing")
        if len(b64_value) > 4 * ((MAX_IMAGE_BYTES + 2) // 3) + 64:
            raise OpenRouterMediaError("Image Base64 trop volumineuse.", phase="base64_size_limit")
        if b64_value.startswith("data:"):
            # Optional data URI supported without fetching third-party URLs.
            prefix, sep, value = b64_value.partition(",")
            match = re.fullmatch(r"data:(image/(?:png|jpeg|webp));base64", prefix, re.I)
            if not sep or not match:
                raise OpenRouterMediaError("Data URI image invalide.", phase="data_uri")
            b64_value = value
        try:
            decoded = base64.b64decode(b64_value, validate=True)
        except (ValueError, binascii.Error) as exc:
            raise OpenRouterMediaError("Image Base64 invalide.", phase="base64_decode") from exc
        if not decoded or len(decoded) > MAX_IMAGE_BYTES:
            raise OpenRouterMediaError("Image décodée hors limites.", phase="image_size_limit")
        real_mime = next((mime for mime, check in _IMAGE_SIGNATURES.items() if check(decoded)), None)
        if real_mime is None:
            raise OpenRouterMediaError("Signature image non reconnue.", phase="image_signature")
        if declared_mime and declared_mime not in _IMAGE_MIMES:
            raise OpenRouterMediaError("Format image fournisseur non pris en charge.", phase="media_type_unsupported")
        # If metadata disagrees with signature, verified bytes are authoritative.
        return decoded, real_mime

    def create_image(self, *, model: str, prompt: str, destination: Path,
                     resolution: str = "1K", aspect_ratio: str = "1:1",
                     reference_bytes: bytes | None = None,
                     reference_mime: str = "image/png",
                     request_id: str | None = None) -> OpenRouterMediaFile:
        """Serialise large image operations; purge after the inner stack is released.

        Billing reservation and idempotency remain the caller's responsibility.
        This lock is per worker process, not a distributed lock.
        """
        with _HEAVY_MEDIA_LOCK:
            try:
                return self._create_image_impl(
                    model=model, prompt=prompt, destination=destination,
                    resolution=resolution, aspect_ratio=aspect_ratio,
                    reference_bytes=reference_bytes, reference_mime=reference_mime,
                    request_id=request_id,
                )
            finally:
                purge_ram("openrouter_image")

    def _create_image_impl(self, *, model: str, prompt: str, destination: Path,
                     resolution: str = "1K", aspect_ratio: str = "1:1",
                     reference_bytes: bytes | None = None,
                     reference_mime: str = "image/png",
                     request_id: str | None = None) -> OpenRouterMediaFile:
        """PAID: only call after ORIA's reservation and idempotency checks."""
        if not 1 <= len(prompt.strip()) <= 8000:
            raise OpenRouterMediaError("Description image invalide.")
        model_entry = self._require_model(model, self.list_image_models())
        self._assert_choice(resolution, self._image_choices(model_entry, "resolution"), "Résolution")
        self._assert_choice(aspect_ratio, self._image_choices(model_entry, "aspect_ratio"), "Format")
        payload: dict[str, Any] = {"model": model, "prompt": prompt.strip(),
                                   "resolution": resolution, "aspect_ratio": aspect_ratio}
        if reference_bytes is not None:
            if self._parameter(model_entry, "input_references") is None:
                raise OpenRouterMediaError("Ce modèle ne prend pas en charge la retouche avec référence.")
            payload["input_references"] = [self._reference(reference_mime, reference_bytes)]
        # Image bytes are Base64-encoded inside JSON (roughly 4/3 expansion).
        # Bound the whole response, then independently check decoded image bytes.
        # IMPORTANT: never resubmit this paid POST automatically after a failure.
        trace = request_id if isinstance(request_id, str) and re.fullmatch(r"[A-Za-z0-9_-]{8,80}", request_id) else "unknown"
        phase = "http_request"
        try:
            result = self._json("POST", "/images", payload=payload, timeout=150,
                                max_bytes=MAX_IMAGE_RESPONSE_BYTES, trace_id=trace)
            phase = "json_decoded"
            images = result.get("data")
            if not isinstance(images, list) or not images:
                raise OpenRouterMediaError("OpenRouter n'a pas retourné d'image.", phase="image_list_empty")
            _RECOVERY_LOG.info("image_recovery phase=json_decoded request_id=%s entries=%d has_usage=%s",
                               trace, len(images), isinstance(result.get("usage"), dict))
            failure: OpenRouterMediaError | None = None
            # Some responses include empty or unsupported entries before the first usable image.
            for index, item in enumerate(images):
                phase = "base64_decode"
                if not isinstance(item, dict):
                    failure = OpenRouterMediaError("Entrée image invalide.", phase="image_item_type")
                    continue
                try:
                    content, mime = self._verified_image(item.get("b64_json"), item.get("media_type"))
                except OpenRouterMediaError as exc:
                    failure = exc
                    _RECOVERY_LOG.warning("image_recovery phase=%s request_id=%s index=%d",
                                          exc.phase or "decode_failed", trace, index)
                    continue
                phase = "temporary_file"
                output = Path(destination).with_suffix({"image/png": ".png", "image/jpeg": ".jpg",
                                                        "image/webp": ".webp"}[mime])
                usage = self._usage(result)
                # The decoded bytes have been verified. Drop the huge Base64 JSON
                # immediately rather than keeping it alive through file writes.
                item.clear()
                images.clear()
                result.clear()
                self._save_media(output, content, MAX_IMAGE_BYTES)
                _RECOVERY_LOG.info("image_recovery phase=temporary_file_saved request_id=%s index=%d mime=%s bytes=%d",
                                   trace, index, mime, len(content))
                return OpenRouterMediaFile(str(output), mime, model, usage)
            raise failure or OpenRouterMediaError("Aucune image exploitable.", phase="image_unusable")
        except Exception as exc:
            known_phase = getattr(exc, "phase", None) or phase
            _RECOVERY_LOG.error("image_recovery phase=%s request_id=%s error_type=%s",
                                known_phase, trace, type(exc).__name__)
            raise

    @staticmethod
    def _job_id(job_id: str) -> str:
        if not isinstance(job_id, str) or not _ID_RE.fullmatch(job_id):
            raise OpenRouterMediaError("Identifiant de tâche vidéo invalide.")
        return job_id

    def submit_video(self, *, model: str, prompt: str, duration: int, resolution: str = "720p",
                     aspect_ratio: str = "16:9", generate_audio: bool = False,
                     first_frame: bytes | None = None,
                     first_frame_mime: str = "image/png") -> dict[str, Any]:
        """PAID: caller MUST save returned job ID durably before replying to the client."""
        if not 1 <= len(prompt.strip()) <= 8000:
            raise OpenRouterMediaError("Description vidéo invalide.")
        entry = self._require_model(model, self.list_video_models())
        if type(duration) is not int or not (1 <= duration <= 60):
            raise OpenRouterMediaError("Durée vidéo invalide.")
        self._assert_choice(duration, entry.get("supported_durations"), "Durée")
        self._assert_choice(resolution, entry.get("supported_resolutions"), "Résolution")
        self._assert_choice(aspect_ratio, entry.get("supported_aspect_ratios"), "Format")
        if type(generate_audio) is not bool:
            raise OpenRouterMediaError("Paramètre audio invalide.")
        if generate_audio and entry.get("generate_audio") is not True:
            raise OpenRouterMediaError("Ce modèle ne génère pas d'audio.")
        payload: dict[str, Any] = {
            "model": model, "prompt": prompt.strip(), "duration": duration,
            "resolution": resolution, "aspect_ratio": aspect_ratio,
            "generate_audio": generate_audio,
        }
        if first_frame is not None:
            frame_options = entry.get("supported_frame_images") or []
            names = [x if isinstance(x, str) else x.get("frame_type")
                     for x in frame_options if isinstance(x, (str, dict))]
            if "first_frame" not in names:
                raise OpenRouterMediaError("Ce modèle ne permet pas de première image.")
            payload["frame_images"] = [{**self._reference(first_frame_mime, first_frame),
                                        "frame_type": "first_frame"}]
        result = self._json("POST", "/videos", payload=payload, timeout=70)
        job_id = self._job_id(result.get("id"))
        if result.get("status") not in {"pending", "in_progress", "completed"}:
            raise OpenRouterMediaError("Tâche vidéo retournée dans un état inattendu.")
        return {"job_id": job_id, "status": result["status"], "model": model,
                "generation_id": result.get("generation_id"),
                "polling_url": result.get("polling_url")}

    def get_video_status(self, job_id: str) -> dict[str, Any]:
        """Read-only polling; caller must verify owner via its own durable job table."""
        job_id = self._job_id(job_id)
        data = self._json("GET", f"/videos/{job_id}")
        if data.get("id") != job_id:
            raise OpenRouterMediaError("Identifiant tâche incohérent.")
        state = data.get("status")
        if state not in {"pending", "in_progress", "completed", "failed", "cancelled", "expired"}:
            raise OpenRouterMediaError("État vidéo OpenRouter inconnu.")
        return {"job_id": job_id, "status": state,
                "generation_id": data.get("generation_id"),
                "error": str(data.get("error") or "")[:300] if state in {"failed", "cancelled", "expired"} else None,
                "usage": self._usage(data) if state == "completed" else None}

    def download_video(self, *, job_id: str, destination: Path, model: str) -> OpenRouterMediaFile:
        """Download completed video with bounded RAM; serialise heavyweight work."""
        with _HEAVY_MEDIA_LOCK:
            try:
                return self._download_video_impl(job_id=job_id, destination=destination, model=model)
            finally:
                purge_ram("openrouter_video_download")

    def _download_video_impl(self, *, job_id: str, destination: Path, model: str) -> OpenRouterMediaFile:
        """Stream directly to an exclusive file; never buffer 150 MiB in RAM."""
        status = self.get_video_status(job_id)
        if status["status"] != "completed":
            raise OpenRouterMediaError("La vidéo n'est pas terminée.")

        job_id = self._job_id(job_id)
        output = Path(destination).with_suffix(".mp4")
        output.parent.mkdir(parents=True, exist_ok=True)
        if output.is_symlink():
            raise OpenRouterMediaError("Destination de média invalide.")
        req = urllib.request.Request(
            BASE_URL + f"/videos/{job_id}/content",
            method="GET",
            headers={
                "Authorization": f"Bearer {self.api_key}",
                "Accept": "video/mp4",
                "X-Title": "ORIA",
            },
        )
        # Exclusive create; never delete a pre-existing file if open("xb") fails.
        created = False
        try:
            try:
                with output.open("xb") as handle:
                    created = True
                    with self.opener(req, timeout=90) as response:
                        if not 200 <= response.status < 300:
                            raise OpenRouterMediaError(
                                f"OpenRouter a répondu HTTP {response.status}.", status_code=response.status
                            )
                        total = 0
                        header = b""
                        while True:
                            chunk = response.read(1024 * 1024)
                            if not chunk:
                                break
                            total += len(chunk)
                            if total > MAX_VIDEO_BYTES:
                                raise OpenRouterMediaError("Vidéo OpenRouter trop volumineuse.", phase="video_size_limit")
                            if len(header) < 12:
                                header = (header + chunk)[:12]
                            handle.write(chunk)
                        if total < 12 or header[4:8] != b"ftyp":
                            raise OpenRouterMediaError("OpenRouter n'a pas retourné une vidéo MP4 valide.")
            except BaseException:
                if created:
                    output.unlink(missing_ok=True)
                raise
        except urllib.error.HTTPError as exc:
            raise OpenRouterMediaError(
                f"OpenRouter a répondu HTTP {exc.code} lors de la récupération vidéo.",
                status_code=exc.code, phase="video_download_http",
            ) from exc
        except (urllib.error.URLError, TimeoutError) as exc:
            raise OpenRouterMediaError(
                "Échec réseau lors de la récupération vidéo ; consulter le statut avant de recommencer.",
                phase="video_download_network",
            ) from exc
        return OpenRouterMediaFile(str(output), "video/mp4", model,
                                   status["usage"] or {}, interaction_id=job_id)
