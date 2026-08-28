from __future__ import annotations

from typing import Any, Optional
from uuid import UUID, uuid4

from app.core.supabase import supabase


class SupabaseMediaRepository:
    """
    Repository dédié aux médias générés par les utilisateurs.

    Responsabilités :
    - envoyer les fichiers dans Supabase Storage ;
    - enregistrer leurs métadonnées dans generated_media ;
    - récupérer les créations d'un utilisateur ;
    - récupérer une création précise ;
    - supprimer une création et son fichier ;
    - générer les URLs publiques persistantes pour le frontend.

    Le bucket attendu est :
        generated-media
    """

    BUCKET_NAME = "generated-media"
    TABLE_NAME = "generated_media"
    SIGNED_URL_EXPIRES_IN = 3600

    # ============================================================
    # STORAGE
    # ============================================================

    def upload_file(
        self,
        *,
        user_id: str | UUID,
        file_bytes: bytes,
        storage_path: str,
        content_type: str,
        upsert: bool = False,
    ) -> str:
        """
        Upload un fichier dans Supabase Storage.

        Retourne le chemin Storage du fichier.
        """
        normalized_user_id = str(user_id)

        if not file_bytes:
            raise ValueError("Le fichier média est vide.")

        if not storage_path:
            raise ValueError("Le chemin Storage est obligatoire.")

        if not storage_path.startswith(f"{normalized_user_id}/"):
            raise ValueError(
                "Le chemin Storage doit appartenir à l'utilisateur courant."
            )

        try:
            self._storage_upload(
                path=storage_path,
                file_bytes=file_bytes,
                content_type=content_type,
                upsert=upsert,
            )
        except Exception as exc:
            raise RuntimeError(
                f"Impossible d'envoyer le média dans Supabase Storage : {exc}"
            ) from exc

        return storage_path

    def delete_file(self, storage_path: str) -> None:
        """Supprime un fichier du bucket generated-media."""
        if not storage_path:
            return

        try:
            self._storage_remove(storage_path)
        except Exception as exc:
            raise RuntimeError(
                f"Impossible de supprimer le média Storage : {exc}"
            ) from exc

    def get_public_url(
        self,
        storage_path: str,
    ) -> str:
        """
        Retourne l'URL publique permanente du fichier Storage.

        Le bucket `generated-media` doit être PUBLIC dans Supabase.
        Cette URL peut être persistée dans `generated_media.url` puis
        utilisée directement par le navigateur dans <img> et <video>.
        """
        if not storage_path:
            raise ValueError("Le chemin Storage est obligatoire.")

        try:
            response = (
                supabase.storage
                .from_(self.BUCKET_NAME)
                .get_public_url(storage_path)
            )
        except Exception as exc:
            raise RuntimeError(
                f"Impossible de créer l'URL publique du média : {exc}"
            ) from exc

        if isinstance(response, str):
            public_url = response
        elif isinstance(response, dict):
            data = response.get("data", response)
            if isinstance(data, dict):
                public_url = (
                    data.get("publicUrl")
                    or data.get("public_url")
                    or data.get("url")
                )
            else:
                public_url = None
        else:
            data = getattr(response, "data", None)
            if isinstance(data, dict):
                public_url = (
                    data.get("publicUrl")
                    or data.get("public_url")
                    or data.get("url")
                )
            else:
                public_url = None

        if not public_url:
            raise RuntimeError(
                "Supabase n'a pas retourné d'URL publique pour le média."
            )

        return str(public_url)

    def create_signed_url(
        self,
        storage_path: str,
        *,
        expires_in: Optional[int] = None,
    ) -> str:
        """
        Compatibilité avec les anciens appelants.

        Le nouveau flux utilise l'URL publique permanente.
        `expires_in` est conservé uniquement pour compatibilité avec les anciens appels.
        """
        return self.get_public_url(storage_path)

    # ============================================================
    # DATABASE
    # ============================================================

    def create_media(
        self,
        *,
        user_id: str | UUID,
        media_type: str,
        storage_path: str,
        mime_type: str,
        action: str,
        media_id: Optional[str | UUID] = None,
        url: Optional[str] = None,
        model: Optional[str] = None,
        prompt: Optional[str] = None,
        credits_cost: int = 0,
        conversation_id: Optional[str] = None,
        video_id: Optional[str] = None,
        seconds: Optional[int] = None,
        size: Optional[int] = None,
        width: Optional[int] = None,
        height: Optional[int] = None,
    ) -> dict[str, Any]:
        """
        Enregistre les métadonnées d'un média après son upload Storage.
        """
        if media_type not in {"image", "video"}:
            raise ValueError(
                "media_type doit être 'image' ou 'video'."
            )

        if credits_cost < 0:
            raise ValueError("credits_cost ne peut pas être négatif.")

        resolved_media_id = (
            str(media_id)
            if media_id is not None
            else str(uuid4())
        )

        if url is None:
            url = self.get_public_url(storage_path)

        payload = {
            "id": resolved_media_id,
            "user_id": str(user_id),
            "conversation_id": conversation_id,
            "type": media_type,
            "storage_path": storage_path,
            "url": url,
            "mime_type": mime_type,
            "action": action,
            "model": model,
            "prompt": prompt,
            "credits_cost": credits_cost,
            "video_id": video_id,
            "seconds": seconds,
            "size": size,
            "width": width,
            "height": height,
        }

        # Évite d'envoyer des valeurs None inutiles si certaines colonnes
        # sont optionnelles.
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
                f"Impossible d'enregistrer le média dans Supabase : {exc}"
            ) from exc

        rows = self._extract_rows(response)

        if not rows:
            raise RuntimeError(
                "Supabase n'a retourné aucune création média après insertion."
            )

        return rows[0]

    def refresh_media_url(
        self,
        *,
        media_id: str | UUID,
        user_id: str | UUID,
        expires_in: Optional[int] = None,
    ) -> Optional[dict[str, Any]]:
        """
        Récupère une création et lui ajoute une URL signée fraîche.

        La colonne `url` persistée reste inchangée. Cette méthode
        fournit une URL temporaire exploitable immédiatement par le frontend.
        """
        media = self.get_media(
            media_id=media_id,
            user_id=user_id,
        )

        if not media:
            return None

        result = dict(media)
        storage_path = result.get("storage_path")

        if storage_path:
            public_url = self.get_public_url(
                str(storage_path)
            )
            result["url"] = public_url
            result["media_url"] = public_url
            result["public_url"] = public_url

        return result

    def get_media_with_url(
        self,
        *,
        media_id: str | UUID,
        user_id: str | UUID,
        expires_in: Optional[int] = None,
    ) -> Optional[dict[str, Any]]:
        """Récupère une création avec une URL signée fraîche."""
        media = self.get_media(
            media_id=media_id,
            user_id=user_id,
        )

        if not media:
            return None

        result = dict(media)
        storage_path = result.get("storage_path")

        if storage_path:
            public_url = self.get_public_url(
                str(storage_path)
            )
            result["url"] = public_url
            result["media_url"] = public_url
            result["public_url"] = public_url

        return result

    def get_media(
        self,
        *,
        media_id: str | UUID,
        user_id: str | UUID,
    ) -> Optional[dict[str, Any]]:
        """Récupère une création appartenant à l'utilisateur."""
        try:
            response = (
                supabase
                .table(self.TABLE_NAME)
                .select("*")
                .eq("id", str(media_id))
                .eq("user_id", str(user_id))
                .limit(1)
                .execute()
            )
        except Exception as exc:
            raise RuntimeError(
                f"Impossible de récupérer le média : {exc}"
            ) from exc

        rows = self._extract_rows(response)

        return rows[0] if rows else None

    def list_media(
        self,
        *,
        user_id: str | UUID,
        media_type: Optional[str] = None,
        limit: int = 100,
        offset: int = 0,
    ) -> list[dict[str, Any]]:
        """
        Récupère les créations de l'utilisateur, des plus récentes
        aux plus anciennes.
        """
        if limit < 1:
            raise ValueError("limit doit être supérieur ou égal à 1.")

        if limit > 100:
            limit = 100

        if offset < 0:
            offset = 0

        if media_type is not None and media_type not in {"image", "video"}:
            raise ValueError(
                "media_type doit être 'image', 'video' ou None."
            )

        try:
            query = (
                supabase
                .table(self.TABLE_NAME)
                .select("*")
                .eq("user_id", str(user_id))
                .order("created_at", desc=True)
                .range(offset, offset + limit - 1)
            )

            if media_type:
                query = query.eq("type", media_type)

            response = query.execute()

        except Exception as exc:
            raise RuntimeError(
                f"Impossible de récupérer les créations média : {exc}"
            ) from exc

        rows = self._extract_rows(response)

        normalized_rows: list[dict[str, Any]] = []

        for row in rows:
            item = dict(row)
            storage_path = item.get("storage_path")

            if storage_path:
                try:
                    public_url = self.get_public_url(
                        str(storage_path)
                    )
                    item["url"] = public_url
                    item["media_url"] = public_url
                    item["public_url"] = public_url
                except Exception:
                    # Ne bloque pas toute la liste si une URL ne peut pas
                    # être reconstruite pour une ligne particulière.
                    pass

            normalized_rows.append(item)

        return normalized_rows

    def delete_media(
        self,
        *,
        media_id: str | UUID,
        user_id: str | UUID,
    ) -> bool:
        """
        Supprime la création de la DB et son fichier Storage.

        La propriété est toujours vérifiée via user_id.
        """
        media = self.get_media(
            media_id=media_id,
            user_id=user_id,
        )

        if not media:
            return False

        storage_path = media.get("storage_path")

        # Supprimer d'abord le fichier Storage.
        # Si cela échoue, on ne supprime pas la référence DB.
        if storage_path:
            self.delete_file(storage_path)

        try:
            response = (
                supabase
                .table(self.TABLE_NAME)
                .delete()
                .eq("id", str(media_id))
                .eq("user_id", str(user_id))
                .execute()
            )
        except Exception as exc:
            raise RuntimeError(
                f"Impossible de supprimer le média de la base : {exc}"
            ) from exc

        rows = self._extract_rows(response)

        # Certaines versions de PostgREST peuvent ne pas retourner
        # les lignes supprimées sans select. Le fait que la requête
        # n'ait pas levé d'exception suffit alors comme confirmation.
        return bool(rows) or True

    # ============================================================
    # HELPERS
    # ============================================================

    @staticmethod
    def _extract_response_data(response: Any) -> Any:
        """Supporte les différentes formes de réponse du client Supabase."""
        if response is None:
            return None

        if isinstance(response, dict):
            return response.get("data", response)

        return getattr(response, "data", None)

    @classmethod
    def _extract_rows(cls, response: Any) -> list[dict[str, Any]]:
        data = cls._extract_response_data(response)

        if data is None:
            return []

        if isinstance(data, list):
            return [
                item for item in data
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
        """
        Compatible avec les versions courantes du SDK Supabase Python.

        Le SDK attend généralement un dictionnaire d'options pour
        l'upload.
        """
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

    def _storage_remove(self, storage_path: str) -> Any:
        storage = supabase.storage.from_(self.BUCKET_NAME)

        return storage.remove([storage_path])


# Instance partagée.
supabase_media_repository = SupabaseMediaRepository()