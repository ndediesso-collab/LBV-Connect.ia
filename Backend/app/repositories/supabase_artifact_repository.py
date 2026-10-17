from __future__ import annotations

import hashlib
import logging
from typing import Any, Optional
from uuid import UUID, uuid4

from app.core.supabase import supabase


logger = logging.getLogger(__name__)


class SupabaseArtifactRepository:
    """
    Repository de persistance des fichiers générés par Oria.

    Responsabilités :
    - envoyer les fichiers natifs dans Supabase Storage ;
    - enregistrer leurs métadonnées dans `generated_artifacts` ;
    - créer des URLs signées temporaires de téléchargement ;
    - récupérer les fichiers d'un utilisateur ;
    - supprimer proprement la ligne DB et le fichier Storage.

    Contrairement aux images/vidéos publiques, les artifacts utilisateur
    sont privés par défaut : Word, PDF, Excel, ZIP, code, etc. peuvent
    contenir des informations personnelles ou professionnelles.

    Le bucket attendu est privé :

        generated-artifacts

    La table attendue est :

        generated_artifacts
    """

    BUCKET_NAME = "generated-artifacts"
    TABLE_NAME = "generated_artifacts"

    DEFAULT_SIGNED_URL_EXPIRES_IN = 60 * 60
    MAX_SIGNED_URL_EXPIRES_IN = 24 * 60 * 60

    # ============================================================
    # STORAGE
    # ============================================================

    def upload_file(
        self,
        *,
        user_id: str | UUID,
        artifact_id: str | UUID,
        filename: str,
        file_bytes: bytes,
        content_type: str,
        upsert: bool = False,
    ) -> str:
        """
        Upload un artifact dans Supabase Storage.

        Arborescence :
            <user_id>/artifacts/<artifact_id>/<filename>

        Retourne le chemin Storage.
        """
        normalized_user_id = str(user_id).strip()
        normalized_artifact_id = str(artifact_id).strip()

        if not normalized_user_id:
            raise ValueError("user_id est obligatoire.")

        if not normalized_artifact_id:
            raise ValueError("artifact_id est obligatoire.")

        if not isinstance(file_bytes, (bytes, bytearray)) or not file_bytes:
            raise ValueError("Le fichier artifact est vide.")

        safe_filename = self._safe_filename(filename)

        storage_path = (
            f"{normalized_user_id}/"
            f"artifacts/"
            f"{normalized_artifact_id}/"
            f"{safe_filename}"
        )

        try:
            self._storage_upload(
                path=storage_path,
                file_bytes=bytes(file_bytes),
                content_type=content_type,
                upsert=upsert,
            )
        except Exception as exc:
            raise RuntimeError(
                "Impossible d'envoyer l'artifact dans Supabase Storage : "
                f"{exc}"
            ) from exc

        return storage_path

    def delete_file(
        self,
        storage_path: str,
    ) -> None:
        """Supprime un fichier du bucket generated-artifacts."""
        if not storage_path:
            return

        try:
            self._storage_remove(storage_path)
        except Exception as exc:
            raise RuntimeError(
                "Impossible de supprimer l'artifact Storage : "
                f"{exc}"
            ) from exc

    def create_signed_url(
        self,
        storage_path: str,
        *,
        expires_in: Optional[int] = None,
    ) -> str:
        """
        Crée une URL temporaire de téléchargement.

        Les artifacts restent privés dans Storage. Le frontend reçoit donc
        uniquement une URL signée de courte durée.
        """
        if not storage_path:
            raise ValueError("Le chemin Storage est obligatoire.")

        resolved_expires_in = int(
            expires_in or self.DEFAULT_SIGNED_URL_EXPIRES_IN
        )

        if resolved_expires_in < 60:
            resolved_expires_in = 60

        if resolved_expires_in > self.MAX_SIGNED_URL_EXPIRES_IN:
            resolved_expires_in = self.MAX_SIGNED_URL_EXPIRES_IN

        try:
            response = (
                supabase.storage
                .from_(self.BUCKET_NAME)
                .create_signed_url(
                    storage_path,
                    resolved_expires_in,
                )
            )
        except Exception as exc:
            raise RuntimeError(
                "Impossible de créer l'URL signée de l'artifact : "
                f"{exc}"
            ) from exc

        signed_url = self._extract_signed_url(response)

        if not signed_url:
            raise RuntimeError(
                "Supabase n'a retourné aucune URL signée exploitable."
            )

        return signed_url

    # ============================================================
    # DATABASE
    # ============================================================

    def create_artifact(
        self,
        *,
        user_id: str | UUID,
        artifact_id: str | UUID,
        filename: str,
        extension: str,
        mime_type: str,
        category: str,
        storage_path: str,
        size_bytes: int,
        sha256: str,
        conversation_id: Optional[str] = None,
        model: Optional[str] = None,
        source_message_id: Optional[str] = None,
        metadata: Optional[dict[str, Any]] = None,
    ) -> dict[str, Any]:
        """Enregistre les métadonnées d'un artifact déjà uploadé."""
        normalized_user_id = str(user_id).strip()
        normalized_artifact_id = str(artifact_id).strip()

        if not normalized_user_id:
            raise ValueError("user_id est obligatoire.")

        if not normalized_artifact_id:
            raise ValueError("artifact_id est obligatoire.")

        self._assert_owned_storage_path(
            storage_path=storage_path,
            user_id=normalized_user_id,
            artifact_id=normalized_artifact_id,
        )

        if size_bytes < 0:
            raise ValueError("size_bytes ne peut pas être négatif.")

        payload: dict[str, Any] = {
            "id": normalized_artifact_id,
            "user_id": normalized_user_id,
            "conversation_id": conversation_id,
            "source_message_id": source_message_id,
            "filename": self._safe_filename(filename),
            "extension": str(extension).lower().lstrip("."),
            "mime_type": str(mime_type),
            "category": str(category),
            "storage_path": storage_path,
            "size_bytes": int(size_bytes),
            "sha256": str(sha256).lower(),
            "model": model,
            "metadata": metadata or {},
        }

        payload = {
            key: value
            for key, value in payload.items()
            if value is not None
        }

        try:
            response = (
                supabase
                .table(self.TABLE_NAME)
                .insert(payload)
                .execute()
            )
        except Exception as exc:
            raise RuntimeError(
                "Impossible d'enregistrer l'artifact dans Supabase : "
                f"{exc}"
            ) from exc

        rows = self._extract_rows(response)

        if not rows:
            raise RuntimeError(
                "Supabase n'a retourné aucun artifact après insertion."
            )

        return rows[0]

    def save_artifact(
        self,
        *,
        user_id: str | UUID,
        filename: str,
        extension: str,
        mime_type: str,
        category: str,
        file_bytes: bytes,
        size_bytes: Optional[int] = None,
        sha256: str,
        artifact_id: Optional[str | UUID] = None,
        conversation_id: Optional[str] = None,
        model: Optional[str] = None,
        source_message_id: Optional[str] = None,
        metadata: Optional[dict[str, Any]] = None,
    ) -> dict[str, Any]:
        """
        Upload + insertion DB atomique au niveau applicatif.

        Si l'insertion DB échoue après l'upload, le fichier Storage est
        supprimé pour éviter les fichiers orphelins.
        """
        resolved_artifact_id = (
            str(artifact_id)
            if artifact_id is not None
            else str(uuid4())
        )

        # Contrôles avant tout upload : les métadonnées du fichier source
        # doivent correspondre exactement aux octets réellement stockés.
        if not isinstance(file_bytes, (bytes, bytearray)) or not file_bytes:
            raise ValueError("Le fichier artifact est vide ou invalide.")

        resolved_size = (
            int(size_bytes)
            if size_bytes is not None
            else len(file_bytes)
        )
        if resolved_size != len(file_bytes):
            raise ValueError("size_bytes ne correspond pas au fichier envoyé.")

        actual_sha256 = hashlib.sha256(file_bytes).hexdigest()
        if str(sha256 or "").strip().lower() != actual_sha256:
            raise ValueError("sha256 ne correspond pas au fichier envoyé.")

        storage_path = self.upload_file(
            user_id=user_id,
            artifact_id=resolved_artifact_id,
            filename=filename,
            file_bytes=file_bytes,
            content_type=mime_type,
            upsert=False,
        )

        try:
            artifact = self.create_artifact(
                user_id=user_id,
                artifact_id=resolved_artifact_id,
                filename=filename,
                extension=extension,
                mime_type=mime_type,
                category=category,
                storage_path=storage_path,
                size_bytes=resolved_size,
                sha256=sha256,
                conversation_id=conversation_id,
                model=model,
                source_message_id=source_message_id,
                metadata=metadata,
            )
        except Exception:
            try:
                self.delete_file(storage_path)
            except Exception:
                pass
            raise

        result = dict(artifact)
        # La persistance a réussi : un incident temporaire de signature ne
        # doit pas faire croire à ai.py que le fichier a été perdu. Le lien
        # pourra être régénéré via GET /ai/artifacts/{artifact_id}.
        try:
            download_url = self.create_signed_url(storage_path)
        except Exception:
            logger.warning(
                "Signature indisponible pour l'artifact %s ; "
                "son enregistrement a réussi.",
                resolved_artifact_id,
            )
            download_url = None

        result["download_url"] = download_url
        result["url"] = download_url
        return result

    def get_artifact(
        self,
        *,
        artifact_id: str | UUID,
        user_id: str | UUID,
    ) -> Optional[dict[str, Any]]:
        """Récupère un artifact appartenant à l'utilisateur."""
        try:
            response = (
                supabase
                .table(self.TABLE_NAME)
                .select("*")
                .eq("id", str(artifact_id))
                .eq("user_id", str(user_id))
                .limit(1)
                .execute()
            )
        except Exception as exc:
            raise RuntimeError(
                f"Impossible de récupérer l'artifact : {exc}"
            ) from exc

        rows = self._extract_rows(response)
        return rows[0] if rows else None

    def get_artifact_with_url(
        self,
        *,
        artifact_id: str | UUID,
        user_id: str | UUID,
        expires_in: Optional[int] = None,
    ) -> Optional[dict[str, Any]]:
        """Récupère un artifact et crée une URL signée fraîche."""
        artifact = self.get_artifact(
            artifact_id=artifact_id,
            user_id=user_id,
        )

        if not artifact:
            return None

        result = dict(artifact)
        storage_path = result.get("storage_path")

        if storage_path:
            self._assert_owned_storage_path(
                storage_path=str(storage_path),
                user_id=user_id,
                artifact_id=artifact_id,
            )
            download_url = self.create_signed_url(
                str(storage_path),
                expires_in=expires_in,
            )
            result["download_url"] = download_url
            result["url"] = download_url

        return result

    def list_artifacts(
        self,
        *,
        user_id: str | UUID,
        conversation_id: Optional[str] = None,
        category: Optional[str] = None,
        extension: Optional[str] = None,
        limit: int = 50,
        offset: int = 0,
        include_urls: bool = False,
    ) -> list[dict[str, Any]]:
        """Liste les artifacts d'un utilisateur, du plus récent au plus ancien."""
        if limit < 1:
            raise ValueError("limit doit être supérieur ou égal à 1.")

        limit = min(limit, 100)
        offset = max(offset, 0)

        try:
            query = (
                supabase
                .table(self.TABLE_NAME)
                .select("*")
                .eq("user_id", str(user_id))
                .order("created_at", desc=True)
                .range(offset, offset + limit - 1)
            )

            if conversation_id:
                query = query.eq(
                    "conversation_id",
                    conversation_id,
                )

            if category:
                query = query.eq(
                    "category",
                    category,
                )

            if extension:
                query = query.eq(
                    "extension",
                    str(extension).lower().lstrip("."),
                )

            response = query.execute()
        except Exception as exc:
            raise RuntimeError(
                "Impossible de récupérer les artifacts : "
                f"{exc}"
            ) from exc

        rows = self._extract_rows(response)

        if not include_urls:
            return rows

        result: list[dict[str, Any]] = []

        for row in rows:
            item = dict(row)
            storage_path = item.get("storage_path")

            if storage_path:
                try:
                    self._assert_owned_storage_path(
                        storage_path=str(storage_path),
                        user_id=user_id,
                        artifact_id=row.get("id"),
                    )
                    download_url = self.create_signed_url(
                        str(storage_path)
                    )
                    item["download_url"] = download_url
                    item["url"] = download_url
                except Exception:
                    pass

            result.append(item)

        return result

    def delete_artifact(
        self,
        *,
        artifact_id: str | UUID,
        user_id: str | UUID,
    ) -> bool:
        """
        Supprime un artifact.

        Le fichier Storage est supprimé en premier. Si cette suppression
        échoue, la ligne DB reste intacte pour ne pas perdre la référence.
        """
        artifact = self.get_artifact(
            artifact_id=artifact_id,
            user_id=user_id,
        )

        if not artifact:
            return False

        storage_path = artifact.get("storage_path")

        if storage_path:
            self._assert_owned_storage_path(
                storage_path=str(storage_path),
                user_id=user_id,
                artifact_id=artifact_id,
            )
            self.delete_file(str(storage_path))

        try:
            (
                supabase
                .table(self.TABLE_NAME)
                .delete()
                .eq("id", str(artifact_id))
                .eq("user_id", str(user_id))
                .execute()
            )
        except Exception as exc:
            raise RuntimeError(
                "Impossible de supprimer l'artifact de la base : "
                f"{exc}"
            ) from exc

        return True

    # ============================================================
    # HELPERS
    # ============================================================

    @staticmethod
    def _assert_owned_storage_path(
        *,
        storage_path: str,
        user_id: str | UUID,
        artifact_id: str | UUID,
    ) -> None:
        """Refuse toute signature/suppression hors du chemin de cet artifact."""
        prefix = (
            f"{str(user_id).strip()}/artifacts/"
            f"{str(artifact_id).strip()}/"
        )
        relative_name = storage_path[len(prefix):] if storage_path.startswith(prefix) else ""
        if (
            not relative_name
            or "/" in relative_name
            or "\\" in relative_name
            or relative_name in {".", ".."}
        ):
            raise ValueError(
                "Le chemin Storage ne correspond pas à l'artifact "
                "de l'utilisateur courant."
            )

    @staticmethod
    def _safe_filename(
        filename: str,
    ) -> str:
        value = str(filename or "").strip()
        value = value.replace("\\", "/").split("/")[-1]

        if not value:
            return "document-oria"

        forbidden = '<>:"/\\|?*'
        for char in forbidden:
            value = value.replace(char, "-")

        value = "".join(
            char
            for char in value
            if ord(char) >= 32
        ).strip().rstrip(" .")

        # Préserver les noms techniques de projets : .env, .gitignore, etc.
        # Le chemin est déjà réduit au seul basename ci-dessus.
        return value[:180] if value and value not in {".", ".."} else "document-oria"

    @staticmethod
    def _extract_signed_url(
        response: Any,
    ) -> Optional[str]:
        if response is None:
            return None

        if isinstance(response, str):
            return response

        if isinstance(response, dict):
            data = response.get("data", response)

            if isinstance(data, str):
                return data

            if isinstance(data, dict):
                value = (
                    data.get("signedURL")
                    or data.get("signedUrl")
                    or data.get("signed_url")
                    or data.get("url")
                )
                return str(value) if value else None

        data = getattr(response, "data", None)

        if isinstance(data, str):
            return data

        if isinstance(data, dict):
            value = (
                data.get("signedURL")
                or data.get("signedUrl")
                or data.get("signed_url")
                or data.get("url")
            )
            return str(value) if value else None

        # Certaines versions du SDK retournent un objet dont la propriété
        # signed_url est directement exposée.
        for attribute in (
            "signed_url",
            "signedURL",
            "signedUrl",
            "url",
        ):
            value = getattr(response, attribute, None)
            if value:
                return str(value)

        return None

    @staticmethod
    def _extract_response_data(
        response: Any,
    ) -> Any:
        if response is None:
            return None

        if isinstance(response, dict):
            return response.get("data", response)

        return getattr(response, "data", None)

    @classmethod
    def _extract_rows(
        cls,
        response: Any,
    ) -> list[dict[str, Any]]:
        data = cls._extract_response_data(response)

        if data is None:
            return []

        if isinstance(data, list):
            return [
                item
                for item in data
                if isinstance(item, dict)
            ]

        if isinstance(data, dict):
            return [data]

        return []

    def _storage_upload(
        self,
        *,
        path: str,
        file_bytes: bytes,
        content_type: str,
        upsert: bool,
    ) -> Any:
        options = {
            "content-type": content_type,
            "upsert": upsert,
        }

        storage = supabase.storage.from_(self.BUCKET_NAME)

        return storage.upload(
            path,
            file_bytes,
            options,
        )

    def _storage_remove(
        self,
        storage_path: str,
    ) -> Any:
        storage = supabase.storage.from_(self.BUCKET_NAME)
        return storage.remove([storage_path])


supabase_artifact_repository = SupabaseArtifactRepository()
