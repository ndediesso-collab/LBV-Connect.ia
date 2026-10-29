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
import os
import re
import datetime
import urllib.error
import urllib.request
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Mapping


BASE_URL = "https://openrouter.ai/api/v1"
MAX_REFERENCE_BYTES = 10 * 1024 * 1024
MAX_IMAGE_BYTES = 20 * 1024 * 1024
MAX_VIDEO_BYTES = 150 * 1024 * 1024
_ID_RE = re.compile(r"^[A-Za-z0-9_-]{1,160}$")
_IMAGE_MIMES = {"image/png", "image/jpeg", "image/webp"}
_IMAGE_SIGNATURES = {
    "image/png": lambda b: b.startswith(b"\x89PNG\r\n\x1a\n"),
    "image/jpeg": lambda b: b.startswith(b"\xff\xd8\xff"),
    "image/webp": lambda b: b.startswith(b"RIFF") and b[8:12] == b"WEBP",
}


class OpenRouterMediaError(RuntimeError):
    def __init__(self, message: str, *, status_code: int | None = None,
                 retry_after_seconds: int | None = None, provider_reason: str | None = None):
        super().__init__(message)
        self.status_code = status_code
        self.retry_after_seconds = retry_after_seconds
        # Structured, bounded, sanitized reason only. Never store raw provider bodies.
        self.provider_reason = provider_reason


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
        # Parse only a small, allowlisted error code; do not return arbitrary text or prompts.
        try:
            raw = exc.read(8192)
            obj = json.loads(raw)
            error = obj.get("error") if isinstance(obj, dict) else None
            code = error.get("code") if isinstance(error, dict) else None
            message = error.get("message") if isinstance(error, dict) else None
            normalized = " ".join(str(x).lower() for x in (code, message) if x is not None)
            for needle, label in (
                ("resource_exhausted", "resource_exhausted"),
                ("rate_limit", "rate_limit"),
                ("rate limit", "rate_limit"),
                ("quota", "quota"),
                ("capacity", "capacity"),
                ("temporarily unavailable", "temporarily_unavailable"),
            ):
                if needle in normalized:
                    return label
        except (ValueError, TypeError, UnicodeError, AttributeError, OSError):
            pass
        return None

    def _call(self, method: str, route: str, *, payload: Mapping[str, Any] | None = None,
              timeout: int = 40, max_bytes: int = 3 * 1024 * 1024) -> bytes:
        # Never allow user-supplied hostnames, query URLs, arbitrary job paths, etc.
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
                result = response.read(max_bytes + 1)
                if len(result) > max_bytes:
                    raise OpenRouterMediaError("Réponse OpenRouter trop volumineuse.")
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
                message = ("OpenRouter a refusé cette requête (HTTP 429 : débit, quota ou capacité). "
                           "L'existence de crédits USD ne supprime pas cette limite. "
                           f"Nouvelle tentative conseillée dans {retry_after or 120} secondes.")
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
              timeout: int = 40, max_bytes: int = 3 * 1024 * 1024) -> dict[str, Any]:
        result = self._call(method, route, payload=payload, timeout=timeout, max_bytes=max_bytes)
        try:
            data = json.loads(result)
        except (UnicodeDecodeError, ValueError) as exc:
            raise OpenRouterMediaError("Réponse JSON OpenRouter invalide.") from exc
        if not isinstance(data, dict):
            raise OpenRouterMediaError("Réponse OpenRouter inattendue.")
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
        with path.open("xb") as handle:
            handle.write(data)

    @staticmethod
    def _usage(data: Mapping[str, Any]) -> dict[str, Any]:
        usage = data.get("usage")
        if isinstance(usage, dict):
            return dict(usage)
        # Absence of cost is not zero cost. Downstream billing must reconcile.
        return {"cost": None, "reconciliation_required": True}

    def create_image(self, *, model: str, prompt: str, destination: Path,
                     resolution: str = "1K", aspect_ratio: str = "1:1",
                     reference_bytes: bytes | None = None,
                     reference_mime: str = "image/png") -> OpenRouterMediaFile:
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
        # Base64 image response can be large; bound JSON response to ~29MiB.
        result = self._json("POST", "/images", payload=payload, timeout=150,
                            max_bytes=29 * 1024 * 1024)
        images = result.get("data")
        if not isinstance(images, list) or not images or not isinstance(images[0], dict):
            raise OpenRouterMediaError("OpenRouter n'a pas retourné d'image.")
        item = images[0]
        mime = str(item.get("media_type") or "image/png")
        if mime not in _IMAGE_MIMES:
            raise OpenRouterMediaError("Format d'image générée inattendu.")
        try:
            content = base64.b64decode(item["b64_json"], validate=True)
        except (KeyError, TypeError, ValueError, binascii.Error) as exc:
            raise OpenRouterMediaError("Image générée absente ou mal encodée.") from exc
        if not _IMAGE_SIGNATURES[mime](content):
            raise OpenRouterMediaError("Image générée corrompue.")
        output = Path(destination).with_suffix({"image/png": ".png", "image/jpeg": ".jpg",
                                                "image/webp": ".webp"}[mime])
        self._save_media(output, content, MAX_IMAGE_BYTES)
        return OpenRouterMediaFile(str(output), mime, model, self._usage(result))

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
        """PAID result retrieval; only after owner check + confirmed completed state."""
        status = self.get_video_status(job_id)
        if status["status"] != "completed":
            raise OpenRouterMediaError("La vidéo n'est pas terminée.")
        data = self._call("GET", f"/videos/{self._job_id(job_id)}/content", timeout=90,
                          max_bytes=MAX_VIDEO_BYTES)
        # Validate common MP4/ISO BMFF signature instead of blindly trusting extension.
        if len(data) < 12 or data[4:8] != b"ftyp":
            raise OpenRouterMediaError("OpenRouter n'a pas retourné une vidéo MP4 valide.")
        output = Path(destination).with_suffix(".mp4")
        self._save_media(output, data, MAX_VIDEO_BYTES)
        return OpenRouterMediaFile(str(output), "video/mp4", model,
                                   status["usage"] or {}, interaction_id=job_id)
