from __future__ import annotations

import base64
import binascii
from typing import Any, Optional
from uuid import UUID, uuid4

from app.repositories.supabase_media_repository import (
    SupabaseMediaRepository,
    supabase_media_repository,
)


class MediaService:
    """
    Couche métier dédiée à la persistance des médias générés.

    Flux principal :

        AI generation
             ↓
        MediaService
             ↓
        Storage upload
             ↓
        generated_media
             ↓
        signed URL
             ↓
        Frontend

    Cette classe ne gère pas les crédits.
    Le débit des crédits reste sous la responsabilité du système
    de crédits déjà présent dans ai.py.
    """

    IMAGE_DIRECTORY = "images"
    VIDEO_DIRECTORY = "videos"

    DEFAULT_IMAGE_EXTENSION = "png"
    DEFAULT_VIDEO_EXTENSION = "mp4"

    MIME_TO_EXTENSION = {
        "image/png": "png",
        "image/jpeg": "jpg",
        "image/webp": "webp",
        "image/gif": "gif",
        "video/mp4": "mp4",
        "video/webm": "webm",
        "video/quicktime": "mov",
    }

    def __init__(
        self,
        repository: SupabaseMediaRepository = supabase_media_repository,
    ) -> None:
        self.repository = repository

    # ============================================================
    # IMAGE
    # ============================================================

    def save_image(
        self,
        *,
        user_id: str | UUID,
        image_bytes: bytes,
        action: str,
        model: Optional[str] = None,
        prompt: Optional[str] = None,
        credits_cost: int = 0,
        conversation_id: Optional[str] = None,
        mime_type: str = "image/png",
        width: Optional[int] = None,
        height: Optional[int] = None,
    ) -> dict[str, Any]:
        """
        Sauvegarde une image générée dans Storage puis dans
        generated_media.

        En cas d'échec de l'insertion DB après upload, le fichier
        Storage est supprimé afin d'éviter les fichiers orphelins.
        """
        normalized_user_id = str(user_id)

        self._validate_media_bytes(
            media_bytes=image_bytes,
            media_type="image",
        )

        mime_type = self._normalize_image_mime_type(mime_type)

        extension = self.MIME_TO_EXTENSION.get(
            mime_type,
            self.DEFAULT_IMAGE_EXTENSION,
        )

        media_id = str(uuid4())

        storage_path = (
            f"{normalized_user_id}/"
            f"{self.IMAGE_DIRECTORY}/"
            f"{media_id}.{extension}"
        )

        uploaded_path = self.repository.upload_file(
            user_id=normalized_user_id,
            file_bytes=image_bytes,
            storage_path=storage_path,
            content_type=mime_type,
            upsert=False,
        )

        try:
            media = self.repository.create_media(
                user_id=normalized_user_id,
                media_type="image",
                storage_path=uploaded_path,
                mime_type=mime_type,
                action=action,
                model=model,
                prompt=prompt,
                credits_cost=credits_cost,
                conversation_id=conversation_id,
                size=len(image_bytes),
                width=width,
                height=height,
            )
        except Exception:
            self._safe_delete_storage(uploaded_path)
            raise

        media["url"] = self.repository.create_signed_url(
            uploaded_path
        )

        return media

    # ============================================================
    # VIDEO
    # ============================================================

    def save_video(
        self,
        *,
        user_id: str | UUID,
        video_bytes: bytes,
        action: str,
        model: Optional[str] = None,
        prompt: Optional[str] = None,
        credits_cost: int = 0,
        conversation_id: Optional[str] = None,
        video_id: Optional[str] = None,
        seconds: Optional[int] = None,
        mime_type: str = "video/mp4",
        width: Optional[int] = None,
        height: Optional[int] = None,
    ) -> dict[str, Any]:
        """
        Sauvegarde une vidéo générée dans Storage puis dans
        generated_media.
        """
        normalized_user_id = str(user_id)

        self._validate_media_bytes(
            media_bytes=video_bytes,
            media_type="video",
        )

        mime_type = self._normalize_video_mime_type(mime_type)

        extension = self.MIME_TO_EXTENSION.get(
            mime_type,
            self.DEFAULT_VIDEO_EXTENSION,
        )

        media_id = str(uuid4())

        storage_path = (
            f"{normalized_user_id}/"
            f"{self.VIDEO_DIRECTORY}/"
            f"{media_id}.{extension}"
        )

        uploaded_path = self.repository.upload_file(
            user_id=normalized_user_id,
            file_bytes=video_bytes,
            storage_path=storage_path,
            content_type=mime_type,
            upsert=False,
        )

        try:
            media = self.repository.create_media(
                user_id=normalized_user_id,
                media_type="video",
                storage_path=uploaded_path,
                mime_type=mime_type,
                action=action,
                model=model,
                prompt=prompt,
                credits_cost=credits_cost,
                conversation_id=conversation_id,
                video_id=video_id,
                seconds=seconds,
                size=len(video_bytes),
                width=width,
                height=height,
            )
        except Exception:
            self._safe_delete_storage(uploaded_path)
            raise

        media["url"] = self.repository.create_signed_url(
            uploaded_path
        )

        return media

    # ============================================================
    # BASE64
    # ============================================================

    def save_image_base64(
        self,
        *,
        user_id: str | UUID,
        image_base64: str,
        action: str,
        model: Optional[str] = None,
        prompt: Optional[str] = None,
        credits_cost: int = 0,
        conversation_id: Optional[str] = None,
        mime_type: str = "image/png",
        width: Optional[int] = None,
        height: Optional[int] = None,
    ) -> dict[str, Any]:
        """
        Variante pratique lorsque le fournisseur retourne encore
        une image en Base64.

        Accepte également un Data URI :
            data:image/png;base64,...
        """
        image_bytes, detected_mime = self.decode_base64_media(
            image_base64,
            expected_type="image",
        )

        if detected_mime:
            mime_type = detected_mime

        return self.save_image(
            user_id=user_id,
            image_bytes=image_bytes,
            action=action,
            model=model,
            prompt=prompt,
            credits_cost=credits_cost,
            conversation_id=conversation_id,
            mime_type=mime_type,
            width=width,
            height=height,
        )

    def save_video_base64(
        self,
        *,
        user_id: str | UUID,
        video_base64: str,
        action: str,
        model: Optional[str] = None,
        prompt: Optional[str] = None,
        credits_cost: int = 0,
        conversation_id: Optional[str] = None,
        video_id: Optional[str] = None,
        seconds: Optional[int] = None,
        mime_type: str = "video/mp4",
        width: Optional[int] = None,
        height: Optional[int] = None,
    ) -> dict[str, Any]:
        """
        Variante pratique lorsque le fournisseur retourne encore
        une vidéo en Base64.
        """
        video_bytes, detected_mime = self.decode_base64_media(
            video_base64,
            expected_type="video",
        )

        if detected_mime:
            mime_type = detected_mime

        return self.save_video(
            user_id=user_id,
            video_bytes=video_bytes,
            action=action,
            model=model,
            prompt=prompt,
            credits_cost=credits_cost,
            conversation_id=conversation_id,
            video_id=video_id,
            seconds=seconds,
            mime_type=mime_type,
            width=width,
            height=height,
        )

    # ============================================================
    # RECUPERATION
    # ============================================================

    def list_user_media(
        self,
        *,
        user_id: str | UUID,
        media_type: Optional[str] = None,
        limit: int = 100,
        offset: int = 0,
        signed_url_expires_in: Optional[int] = None,
    ) -> list[dict[str, Any]]:
        """
        Récupère les créations d'un utilisateur et ajoute une URL
        signée temporaire à chaque média.
        """
        media_list = self.repository.list_media(
            user_id=user_id,
            media_type=media_type,
            limit=limit,
            offset=offset,
        )

        result: list[dict[str, Any]] = []

        for media in media_list:
            item = dict(media)

            storage_path = item.get("storage_path")

            if storage_path:
                item["url"] = self.repository.create_signed_url(
                    storage_path,
                    expires_in=signed_url_expires_in,
                )

            result.append(item)

        return result

    def get_user_media(
        self,
        *,
        media_id: str | UUID,
        user_id: str | UUID,
        signed_url_expires_in: Optional[int] = None,
    ) -> Optional[dict[str, Any]]:
        """Récupère une création appartenant à l'utilisateur."""
        media = self.repository.get_media(
            media_id=media_id,
            user_id=user_id,
        )

        if not media:
            return None

        result = dict(media)

        storage_path = result.get("storage_path")

        if storage_path:
            result["url"] = self.repository.create_signed_url(
                storage_path,
                expires_in=signed_url_expires_in,
            )

        return result

    # ============================================================
    # SUPPRESSION
    # ============================================================

    def delete_user_media(
        self,
        *,
        media_id: str | UUID,
        user_id: str | UUID,
    ) -> bool:
        """
        Supprime une création de l'utilisateur ainsi que son fichier
        Storage.
        """
        return self.repository.delete_media(
            media_id=media_id,
            user_id=user_id,
        )

    # ============================================================
    # HELPERS
    # ============================================================

    @classmethod
    def decode_base64_media(
        cls,
        value: str,
        *,
        expected_type: str,
    ) -> tuple[bytes, Optional[str]]:
        """
        Décode une valeur Base64 ou un Data URI.

        Retourne :
            (bytes, mime_type_detecté)
        """
        if not isinstance(value, str) or not value.strip():
            raise ValueError("Le contenu Base64 du média est vide.")

        raw_value = value.strip()
        detected_mime: Optional[str] = None

        if raw_value.startswith("data:"):
            try:
                header, encoded = raw_value.split(",", 1)
            except ValueError as exc:
                raise ValueError(
                    "Data URI média invalide."
                ) from exc

            if ";base64" not in header.lower():
                raise ValueError(
                    "Le Data URI média doit utiliser Base64."
                )

            detected_mime = header[5:].split(";", 1)[0].strip().lower()

            if expected_type == "image" and not detected_mime.startswith(
                "image/"
            ):
                raise ValueError(
                    "Le média reçu n'est pas une image."
                )

            if expected_type == "video" and not detected_mime.startswith(
                "video/"
            ):
                raise ValueError(
                    "Le média reçu n'est pas une vidéo."
                )

            raw_value = encoded.strip()

        try:
            decoded = base64.b64decode(
                raw_value,
                validate=True,
            )
        except (binascii.Error, ValueError) as exc:
            raise ValueError(
                "Le contenu Base64 du média est invalide."
            ) from exc

        if not decoded:
            raise ValueError("Le média décodé est vide.")

        return decoded, detected_mime

    @staticmethod
    def _validate_media_bytes(
        *,
        media_bytes: bytes,
        media_type: str,
    ) -> None:
        if not isinstance(media_bytes, bytes):
            raise TypeError(
                f"Le média {media_type} doit être fourni sous forme de bytes."
            )

        if not media_bytes:
            raise ValueError(
                f"Le média {media_type} est vide."
            )

    @classmethod
    def _normalize_image_mime_type(cls, mime_type: str) -> str:
        value = (mime_type or "").strip().lower()

        if not value.startswith("image/"):
            return "image/png"

        return value

    @classmethod
    def _normalize_video_mime_type(cls, mime_type: str) -> str:
        value = (mime_type or "").strip().lower()

        if not value.startswith("video/"):
            return "video/mp4"

        return value

    def _safe_delete_storage(self, storage_path: str) -> None:
        """
        Nettoyage best-effort après un échec d'insertion DB.
        On ne masque jamais l'erreur originale.
        """
        try:
            self.repository.delete_file(storage_path)
        except Exception:
            pass


# Instance partagée pour les routes/services.
media_service = MediaService()