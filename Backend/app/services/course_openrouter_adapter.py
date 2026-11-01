"""ORIA Cours — fournisseur OpenRouter, *non encore branché au worker*.

Deux opérations: transcription de segments / composition de fragments HTML.
Ne réserve ni ne consomme aucun crédit et ne modifie aucun job Supabase.

AVERTISSEMENT: l'orchestrateur historique applique les tarifs OpenAI directs
et les fonctions SQL imposent gpt-6-luna. Ce module est volontairement isolé
jusqu'à une migration financière/SQL coordonnée et testée.
"""
from __future__ import annotations

import base64
import json
import os
import urllib.error
import urllib.request
from collections.abc import Callable, Mapping
from dataclasses import dataclass
from decimal import Decimal, InvalidOperation
from typing import Any

from app.services.prompt_service import build_course_section_messages

TRANSCRIPTION_URL = "https://openrouter.ai/api/v1/audio/transcriptions"
COMPLETIONS_URL = "https://openrouter.ai/api/v1/chat/completions"
MAX_AUDIO_BYTES = 20 * 1024 * 1024
MAX_RESPONSE_BYTES = 4 * 1024 * 1024
MAX_SECTION_CHARS = 60_000
MAX_CONTEXT_CHARS = 8_000

# L'extension dérive du MIME déclaré par le repository, non d'un nom client.
FORMATS_BY_MIME = {
    "audio/webm": "webm", "audio/ogg": "ogg",
    "audio/mpeg": "mp3", "audio/mp3": "mp3",
    "audio/m4a": "m4a", "audio/x-m4a": "m4a", "audio/mp4": "m4a",
    "audio/wav": "wav", "audio/x-wav": "wav",
    "audio/flac": "flac",
}


class CourseOpenRouterError(RuntimeError):
    """Échec fournisseur, sans détails du contenu privé dans le message."""


class CourseOpenRouterUncertain(CourseOpenRouterError):
    """Appel possiblement facturé: NE PAS réessayer automatiquement."""


@dataclass(frozen=True)
class CourseOpenRouterModels:
    writing_model: str = "openai/gpt-6-luna"
    transcription_model: str = "openai/gpt-4o-mini-transcribe"

    def __post_init__(self) -> None:
        if self.writing_model not in {
            "openai/gpt-6-luna",
        }:
            raise ValueError("Rédacteur ORIA Cours non autorisé.")
        if self.transcription_model not in {
            "openai/gpt-4o-mini-transcribe", "openai/whisper-1",
            "openai/whisper-large-v3", "openai/whisper-large-v3-turbo",
        }:
            raise ValueError("Transcripteur ORIA Cours non autorisé.")


def _reported_cost(usage: Any) -> str | None:
    if not isinstance(usage, Mapping) or usage.get("cost") is None:
        return None
    try:
        cost = Decimal(str(usage["cost"]))
    except (TypeError, ValueError, InvalidOperation) as exc:
        raise CourseOpenRouterUncertain("Montant de l'appel fournisseur illisible.") from exc
    if not cost.is_finite() or cost < 0:
        raise CourseOpenRouterUncertain("Montant de l'appel fournisseur invalide.")
    return str(cost)


class OpenRouterCourseAdapter:
    """Même interface métier que les deux méthodes Cours d'OpenAIService.

    `transport` permet de simuler des réponses réseau dans les tests sans
    dépenser de crédits. Sans transport injecté, utilise urllib avec un délai
    fixe et sans retry. Aucun nom de modèle ne vient du navigateur.
    """

    def __init__(
        self, *, api_key: str | None = None,
        models: CourseOpenRouterModels | None = None,
        transport: Callable[[str, Mapping[str, Any]], Mapping[str, Any]] | None = None,
        html_validator: Callable[[str], str] | None = None,
    ) -> None:
        key = (api_key if api_key is not None else os.getenv("OPENROUTER_API_KEY", "")).strip()
        if not key:
            raise ValueError("Clé API OpenRouter absente.")
        self._key = key
        self.models = models or CourseOpenRouterModels()
        self._transport = transport
        self._html_validator = html_validator

    @staticmethod
    def _validate_course_html_fragment(html: str) -> str:
        # La méthode originale est source de vérité, sans duplication des
        # balises/classes permises dans le nouvel adaptateur.
        from app.services.openai_service import OpenAIService
        return OpenAIService._validate_course_html_fragment(html)

    def _post(self, endpoint: str, payload: Mapping[str, Any]) -> Mapping[str, Any]:
        if endpoint not in {TRANSCRIPTION_URL, COMPLETIONS_URL}:
            raise ValueError("Endpoint OpenRouter non autorisé.")
        if self._transport is not None:
            response = self._transport(endpoint, payload)
            if not isinstance(response, Mapping):
                raise CourseOpenRouterUncertain("Réponse fournisseur non structurée.")
            return response
        body = json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
        req = urllib.request.Request(
            endpoint, method="POST", data=body, headers={
                "Authorization": f"Bearer {self._key}",
                "Content-Type": "application/json", "Accept": "application/json",
                "X-OpenRouter-Title": "ORIA Cours",
            },
        )
        try:
            with urllib.request.urlopen(req, timeout=240) as stream:
                result = stream.read(MAX_RESPONSE_BYTES + 1)
                # OpenRouter STT returns request ID in the HTTP header, not
                # necessarily in JSON. It is indispensable for reconciliation.
                generation_id = stream.headers.get("X-Generation-Id")
        except (urllib.error.HTTPError, urllib.error.URLError, OSError, TimeoutError) as exc:
            # Même un timeout peut avoir coûté de l'argent côté fournisseur.
            raise CourseOpenRouterUncertain(
                "Appel fournisseur incertain : vérifier la facturation avant reprise."
            ) from exc
        if len(result) > MAX_RESPONSE_BYTES:
            raise CourseOpenRouterUncertain("Réponse fournisseur trop grande.")
        try:
            parsed = json.loads(result)
        except (ValueError, UnicodeError) as exc:
            raise CourseOpenRouterUncertain("Réponse fournisseur non décodable.") from exc
        if not isinstance(parsed, dict):
            raise CourseOpenRouterUncertain("Réponse fournisseur invalide.")
        if isinstance(generation_id, str) and generation_id.strip():
            parsed.setdefault("_oria_generation_id", generation_id.strip())
        return parsed

    def transcribe_course_segment(
        self, *, data: bytes, filename: str, mime_type: str,
    ) -> dict[str, Any]:
        if not isinstance(data, bytes) or not data or len(data) > MAX_AUDIO_BYTES:
            raise ValueError("Segment audio vide ou trop volumineux.")
        mime = str(mime_type or "").split(";", 1)[0].strip().lower()
        fmt = FORMATS_BY_MIME.get(mime)
        if fmt is None:
            raise ValueError("Format audio non validé pour OpenRouter.")
        payload = {
            "model": self.models.transcription_model,
            "input_audio": {"data": base64.b64encode(data).decode("ascii"), "format": fmt},
        }
        response = self._post(TRANSCRIPTION_URL, payload)
        transcript = response.get("text")
        if not isinstance(transcript, str) or not transcript.strip() or len(transcript) > 100_000:
            raise CourseOpenRouterUncertain("Transcription absente ou invalide.")
        usage = response.get("usage")
        cost = _reported_cost(usage)
        return {
            "text": transcript.strip(),
            "model": self.models.transcription_model,
            "provider": "openrouter", "response_id": response.get("id") or response.get("_oria_generation_id"),
            "usage": dict(usage) if isinstance(usage, Mapping) else None,
            "provider_cost_usd": cost,
            "reconciliation_required": cost is None,
        }

    def compose_course_section(
        self, *, model: str, transcript: str, section_index: int,
        total_sections: int, previous_context: str = "",
        reasoning_mode: str = "balanced", output_format: str = "html_fragment",
    ) -> dict[str, Any]:
        if model != self.models.writing_model:
            raise ValueError("Modèle de rédaction ORIA Cours incohérent avec le devis.")
        if output_format != "html_fragment":
            raise ValueError("ORIA Cours OpenRouter exige le contrat HTML Code-First.")
        if not isinstance(transcript, str) or not transcript.strip() or len(transcript) > MAX_SECTION_CHARS:
            raise ValueError("Section de transcription invalide.")
        if not isinstance(previous_context, str) or len(previous_context) > MAX_CONTEXT_CHARS:
            raise ValueError("Contexte pédagogique trop long.")
        if type(section_index) is not int or type(total_sections) is not int or not 1 <= section_index <= total_sections <= 500:
            raise ValueError("Index de section invalide.")
        efforts = {"fast": "low", "balanced": "medium", "deep": "high"}
        if reasoning_mode not in efforts:
            raise ValueError("Mode de réflexion invalide.")
        messages = build_course_section_messages(
            transcript=transcript, section_index=section_index,
            total_sections=total_sections, previous_context=previous_context,
            output_format="html_fragment",
        )
        payload = {
            "model": self.models.writing_model,
            "messages": messages,
            "max_completion_tokens": 12_288,
            "reasoning": {"effort": efforts[reasoning_mode]},
            "usage": {"include": True},
            "stream": False,
        }
        response = self._post(COMPLETIONS_URL, payload)
        choices = response.get("choices")
        choice = choices[0] if isinstance(choices, list) and len(choices) == 1 else None
        if not isinstance(choice, Mapping):
            raise CourseOpenRouterUncertain("Réponse de rédaction sans choix unique.")
        message = choice.get("message") if isinstance(choice.get("message"), Mapping) else {}
        source = message.get("content")
        text = source.strip() if isinstance(source, str) else ""
        finish = choice.get("finish_reason")
        complete = finish == "stop" and bool(text)
        reason: str | None = None
        html = ""
        if complete:
            validator = self._html_validator or self._validate_course_html_fragment
            try:
                html = validator(text)
            except ValueError:
                complete = False
                reason = "invalid_course_html_fragment"
        else:
            reason = str(finish or "missing_text")[:80]
        usage = response.get("usage")
        cost = _reported_cost(usage)
        return {
            "message": "", "model": model, "openrouter_model": str(response.get("model") or model),
            "provider": "openrouter", "response_id": response.get("id") or response.get("_oria_generation_id"),
            "output_format": "html_fragment", "html_fragment": html,
            "complete": bool(complete), "status": "completed" if complete else "incomplete",
            "incomplete_reason": reason,
            "usage": dict(usage) if isinstance(usage, Mapping) else None,
            "provider_cost_usd": cost,
            "reconciliation_required": cost is None,
            "section_index": section_index, "total_sections": total_sections,
        }


__all__ = ["CourseOpenRouterModels", "OpenRouterCourseAdapter",
           "CourseOpenRouterError", "CourseOpenRouterUncertain"]
