"""Repository Supabase privé pour les notes vocales ORIA.

À placer dans ``app/repositories/supabase_audio_repository.py``.
Contrat conservé avec ``app.services.audio_service.AudioService`` : upload,
insert, get, update, download, signed_url, remove et delete_record.

Le client Supabase injecté doit être un client *serveur* (service_role), jamais
exposé à un client web/mobile. La table et le bucket doivent être privés.
"""
from __future__ import annotations

import hashlib
import re
from typing import Any
from uuid import UUID

from app.core.supabase import supabase


class AudioStorageError(RuntimeError):
    """Erreur de stockage ou de métadonnées d'une note vocale."""


class SupabaseAudioRepository:
    TABLE = "oria_voice_notes"
    BUCKET = "oria-voice-notes"
    SIGNED_URL_SECONDS = 15 * 60
    MAX_AUDIO_BYTES = 20 * 1024 * 1024

    # Formats *stockés*, après éventuel transcodage par AudioService.
    MIME_BY_EXTENSION: dict[str, frozenset[str]] = {
        "webm": frozenset({"audio/webm"}),
        "ogg": frozenset({"audio/ogg"}),
        "mp3": frozenset({"audio/mpeg", "audio/mp3"}),
        "m4a": frozenset({"audio/mp4", "audio/x-m4a", "audio/m4a"}),
        "wav": frozenset({"audio/wav", "audio/x-wav"}),
    }
    # Champs effectivement modifiés par AudioService (les autres sont immuables).
    EDITABLE_COLUMNS = frozenset({
        "transcription_status", "transcription", "edited_text",
        "delivery_mode", "billing_status", "credit_reservation_id", "message_id",
    })

    def __init__(self, client: Any | None = None):
        self.client = client if client is not None else supabase

    @staticmethod
    def _id(value: str | UUID, field: str) -> str:
        try:
            return str(UUID(str(value)))
        except (ValueError, TypeError, AttributeError) as error:
            raise ValueError(f"{field} doit être un UUID valide.") from error

    @staticmethod
    def _rows(response: Any) -> list[dict[str, Any]]:
        """Accepte les retours dict et objets PostgREST/Supabase."""
        data = response.get("data") if isinstance(response, dict) else getattr(response, "data", None)
        if isinstance(data, dict):
            return [data]
        if isinstance(data, (list, tuple)):
            return [row for row in data if isinstance(row, dict)]
        return []

    @staticmethod
    def _check_response(response: Any) -> None:
        """Certains adaptateurs signalent un échec dans la réponse, sans exception."""
        if isinstance(response, dict):
            error = response.get("error")
        else:
            error = getattr(response, "error", None)
        if error:
            raise AudioStorageError("Supabase a refusé l'opération audio.")

    @classmethod
    def _extension(cls, ext: str) -> str:
        extension = str(ext or "").lower().lstrip(".")
        if extension not in cls.MIME_BY_EXTENSION:
            raise ValueError("Extension audio stockée non autorisée.")
        return extension

    @classmethod
    def _validate_mime(cls, ext: str, mime_type: str) -> None:
        if str(mime_type or "").lower().strip() not in cls.MIME_BY_EXTENSION[cls._extension(ext)]:
            raise ValueError("Type MIME incompatible avec l'extension audio.")

    def path(self, user_id: str, audio_id: str, ext: str) -> str:
        return (
            f"{self._id(user_id, 'user_id')}/"
            f"{self._id(audio_id, 'audio_id')}/"
            f"original.{self._extension(ext)}"
        )

    def _check_path(self, path: str, *, user_id: str, audio_id: str) -> None:
        """N'accepte que l'objet original attendu dans le dossier de ce vocal."""
        user = self._id(user_id, "user_id")
        audio = self._id(audio_id, "audio_id")
        if not isinstance(path, str):
            raise AudioStorageError("Chemin de stockage vocal non autorisé.")
        match = re.fullmatch(
            rf"{re.escape(user)}/{re.escape(audio)}/original\.([a-z0-9]+)", path
        )
        if not match or match.group(1) not in self.MIME_BY_EXTENSION:
            raise AudioStorageError("Chemin de stockage vocal non autorisé.")

    def upload(
        self, *, user_id: str, audio_id: str, ext: str,
        data: bytes, mime_type: str,
    ) -> str:
        """Stocke une seule version originale ; aucun upsert silencieux."""
        path = self.path(user_id, audio_id, ext)
        self._validate_mime(ext, mime_type)
        if not isinstance(data, (bytes, bytearray)) or not 0 < len(data) <= self.MAX_AUDIO_BYTES:
            raise ValueError("Audio vide, invalide ou supérieur à 20 Mo.")
        try:
            response = self.client.storage.from_(self.BUCKET).upload(
                path, bytes(data), {"content-type": mime_type, "upsert": False}
            )
            self._check_response(response)
        except Exception as error:
            raise AudioStorageError("Impossible d'enregistrer la note vocale privée.") from error
        return path

    def remove(self, path: str, *, user_id: str, audio_id: str) -> None:
        """Supprime aussi un upload orphelin dont l'insertion DB a échoué."""
        self._check_path(path, user_id=user_id, audio_id=audio_id)
        try:
            response = self.client.storage.from_(self.BUCKET).remove([path])
            self._check_response(response)
        except Exception as error:
            raise AudioStorageError("Impossible de supprimer le fichier vocal privé.") from error

    def insert(self, payload: dict[str, Any]) -> dict[str, Any]:
        """Enregistre les métadonnées d'un audio déjà stocké, sans exposer son URL."""
        if not isinstance(payload, dict):
            raise ValueError("Métadonnées vocales invalides.")
        user_id = self._id(payload.get("user_id"), "user_id")
        audio_id = self._id(payload.get("id"), "audio_id")
        path = payload.get("storage_path")
        self._check_path(path, user_id=user_id, audio_id=audio_id)
        ext = path.rsplit(".", 1)[-1]
        self._validate_mime(ext, payload.get("mime_type"))
        size = payload.get("size_bytes")
        if type(size) is not int or not 0 < size <= self.MAX_AUDIO_BYTES:
            raise ValueError("Taille du fichier vocal invalide.")
        for field in ("sha256", "client_sha256"):
            if not isinstance(payload.get(field), str) or not re.fullmatch(r"[a-f0-9]{64}", payload[field]):
                raise ValueError(f"Empreinte {field} invalide.")
        duration_ms = payload.get("duration_ms")
        if type(duration_ms) is not int or not 400 <= duration_ms <= 300000:
            raise ValueError("Durée de note vocale invalide.")
        cost = payload.get("credit_cost")
        if type(cost) is not int or cost < 1:
            raise ValueError("Coût de transcription invalide.")
        if payload.get("transcription_status", "queued") != "queued" or \
                payload.get("billing_status", "none") != "none" or \
                payload.get("delivery_mode", "draft") != "draft":
            raise ValueError("Une nouvelle note doit être un brouillon non facturé.")
        # Vérifier l'identité sans modifier les références reçues du service.
        try:
            response = self.client.table(self.TABLE).insert(payload).execute()
            self._check_response(response)
        except Exception as error:
            raise AudioStorageError("Impossible d'enregistrer les métadonnées vocales.") from error
        rows = self._rows(response)
        if not rows:
            raise AudioStorageError("La base n'a pas confirmé la note vocale.")
        row = rows[0]
        if str(row.get("id")) != audio_id or str(row.get("user_id")) != user_id:
            raise AudioStorageError("La base a retourné un enregistrement vocal incohérent.")
        return row

    def get(self, *, user_id: str, audio_id: str) -> dict[str, Any] | None:
        """Lecture strictement limitée à l'utilisateur et à l'audio indiqués."""
        user = self._id(user_id, "user_id")
        audio = self._id(audio_id, "audio_id")
        try:
            response = (self.client.table(self.TABLE).select("*")
                        .eq("user_id", user).eq("id", audio).limit(1).execute())
            self._check_response(response)
        except Exception as error:
            raise AudioStorageError("Impossible de récupérer cette note vocale.") from error
        rows = self._rows(response)
        return rows[0] if rows else None

    def update(
        self, *, user_id: str, audio_id: str, values: dict[str, Any],
        expected_status: str | None = None,
    ) -> dict[str, Any] | None:
        """Mise à jour conditionnelle compatible avec les tâches concurrentes.

        Une absence de ligne signifie que l'audio n'existe pas, n'est pas possédé
        par l'utilisateur ou que l'état attendu a déjà changé.
        """
        user = self._id(user_id, "user_id")
        audio = self._id(audio_id, "audio_id")
        if not isinstance(values, dict) or not values:
            raise ValueError("La mise à jour audio ne peut pas être vide.")
        if not set(values).issubset(self.EDITABLE_COLUMNS):
            raise ValueError("Tentative de modifier des champs vocaux protégés.")
        if expected_status is not None and expected_status not in {
            "queued", "processing", "complete", "failed"
        }:
            raise ValueError("État audio attendu invalide.")
        try:
            query = (self.client.table(self.TABLE).update(values)
                     .eq("user_id", user).eq("id", audio))
            if expected_status is not None:
                query = query.eq("transcription_status", expected_status)
            response = query.execute()
            self._check_response(response)
        except Exception as error:
            raise AudioStorageError("Impossible de mettre à jour la note vocale.") from error
        rows = self._rows(response)
        return rows[0] if rows else None

    def _verify_registered_path(self, *, user_id: str, audio_id: str, path: str) -> dict[str, Any]:
        """Une URL ou un téléchargement exige une ligne possédée et ce même objet."""
        self._check_path(path, user_id=user_id, audio_id=audio_id)
        row = self.get(user_id=user_id, audio_id=audio_id)
        if not row or row.get("storage_path") != path:
            raise AudioStorageError("Fichier vocal introuvable ou accès non autorisé.")
        return row

    @staticmethod
    def _signed_url_value(response: Any) -> str | None:
        if isinstance(response, str):
            return response or None
        data = response.get("data") if isinstance(response, dict) else getattr(response, "data", None)
        for candidate in (response, data):
            if isinstance(candidate, dict):
                value = (candidate.get("signedURL") or candidate.get("signedUrl")
                         or candidate.get("signed_url") or candidate.get("url"))
            else:
                value = (getattr(candidate, "signed_url", None)
                         or getattr(candidate, "signedURL", None)
                         or getattr(candidate, "signedUrl", None)
                         or getattr(candidate, "url", None))
            if isinstance(value, str) and value:
                return value
        return None

    def signed_url(self, *, user_id: str, audio_id: str, path: str) -> str:
        """Lien éphémère de réécoute, jamais URL publique permanente."""
        self._verify_registered_path(user_id=user_id, audio_id=audio_id, path=path)
        try:
            response = self.client.storage.from_(self.BUCKET).create_signed_url(
                path, self.SIGNED_URL_SECONDS
            )
            self._check_response(response)
            url = self._signed_url_value(response)
        except Exception as error:
            raise AudioStorageError("Impossible de créer le lien temporaire audio.") from error
        if not url:
            raise AudioStorageError("Supabase n'a retourné aucun lien audio signé.")
        return url

    def download(self, *, user_id: str, audio_id: str, path: str) -> bytes:
        """Téléchargement côté backend pour la transcription, jamais en public."""
        row = self._verify_registered_path(user_id=user_id, audio_id=audio_id, path=path)
        try:
            response = self.client.storage.from_(self.BUCKET).download(path)
            self._check_response(response)
        except Exception as error:
            raise AudioStorageError("Impossible de récupérer l'enregistrement vocal.") from error
        if not isinstance(response, (bytes, bytearray)) or not response:
            raise AudioStorageError("Contenu audio absent ou invalide dans Storage.")
        if len(response) > self.MAX_AUDIO_BYTES:
            raise AudioStorageError("Contenu audio téléchargé trop volumineux.")
        if len(response) != row.get("size_bytes") or \
                hashlib.sha256(response).hexdigest() != row.get("sha256"):
            raise AudioStorageError("Intégrité de la note vocale stockée non conforme.")
        return bytes(response)

    def delete_record(self, *, user_id: str, audio_id: str) -> None:
        """Efface uniquement la ligne qui appartient à cet utilisateur."""
        user = self._id(user_id, "user_id")
        audio = self._id(audio_id, "audio_id")
        try:
            response = (self.client.table(self.TABLE).delete()
                        .eq("user_id", user).eq("id", audio).execute())
            self._check_response(response)
        except Exception as error:
            raise AudioStorageError("Impossible de supprimer les métadonnées vocales.") from error


# Nom d'import conservé, utilisé par les services qui importent le singleton.
supabase_audio_repository = SupabaseAudioRepository()
