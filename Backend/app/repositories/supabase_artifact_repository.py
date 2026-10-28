from __future__ import annotations

import hashlib
import logging
import re
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit
from typing import Any, Optional
from uuid import UUID, uuid4, uuid5

from app.core.supabase import supabase


logger = logging.getLogger(__name__)


class CourseArtifactStorageUncertain(RuntimeError):
    """Stockage Cours non confirmé : rapprocher Storage/SQL, sans nouvel upload."""


class CourseArtifactConflict(RuntimeError):
    """Référence documentaire Cours existante mais différente ou incohérente."""


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
    MAX_ARTIFACT_BYTES = 50 * 1024 * 1024

    # L'aperçu navigateur est limité aux rendus passifs et natifs.
    # HTML, SVG et autres fichiers source ne doivent PAS être embarqués en iframe
    # depuis le stockage de fichiers utilisateur (risque de contenu actif).
    INLINE_PREVIEW_TYPES = frozenset({"pdf"})
    INLINE_PREVIEW_MIME = {"pdf": "application/pdf"}

    # Les noms correspondent a OriaCourseArtifactRenderer (course_service.py).
    # Les doubles identifiants (document et transcription) sont déterministes.
    COURSE_ID_NAMESPACES = {
        "document": "oria-cours/document/v1",
        "transcript": "oria-cours/transcription/v1",
    }

    def __init__(self, client: Any = None) -> None:
        """Client Supabase optionnel injecté, pour isoler les workers Cours.

        Sans injection, l'instance historique conserve exactement le client
        global du Chat et ses routes de création de fichiers ordinaires.
        """
        self.client = client if client is not None else supabase

    @staticmethod
    def _course_artifact_metadata(metadata: Any) -> bool:
        return isinstance(metadata, dict) and metadata.get("source") == "oria-course"

    @classmethod
    def _validate_course_save(
        cls, *, user_id: str | UUID, artifact_id: str | UUID,
        filename: str, extension: str, mime_type: str,
        category: str, metadata: dict[str, Any],
        file_bytes: bytes, size_bytes: int | None, sha256: str,
        conversation_id: str | None, source_message_id: str | None,
    ) -> tuple[str, str, str, str]:
        """Contrat metier local ; SQL reste autorite pour la transaction.

        Source HTML et octets PDF/DOCX n'ont PAS le meme SHA256 :
        source_sha256 dans metadata identifie la source du cours, alors que
        sha256 identifie les octets physiques sauvegardes.
        """
        try:
            uid = str(UUID(str(user_id)))
            aid = str(UUID(str(artifact_id)))
            course_id = str(UUID(str(metadata.get("course_id"))))
        except (TypeError, AttributeError, ValueError) as exc:
            raise ValueError("Identifiants ORIA Cours invalides.") from exc
        kind = metadata.get("kind")
        if kind not in cls.COURSE_ID_NAMESPACES:
            raise ValueError("Nature du fichier ORIA Cours invalide.")
        if aid != str(uuid5(UUID(course_id), cls.COURSE_ID_NAMESPACES[kind])):
            raise ValueError("Identifiant deterministe du cours incoherent.")
        ext = str(extension or "").lower().lstrip(".")
        mt = str(mime_type or "").split(";", 1)[0].lower().strip()
        if kind == "document":
            if ext not in ("pdf", "docx") or category != "document":
                raise ValueError("Document ORIA Cours attendu en PDF/DOCX.")
            permitted_mimes = {
                "pdf": "application/pdf",
                "docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            }
            if mt != permitted_mimes[ext]:
                raise ValueError("MIME documentaire ORIA Cours incoherent.")
        else:
            if ext != "txt" or category != "text" or mt != "text/plain":
                raise ValueError("Transcription ORIA Cours attendue en TXT.")
        if not isinstance(metadata.get("source_sha256"), str) or re.fullmatch(
            r"[0-9a-f]{64}", metadata["source_sha256"]
        ) is None:
            raise ValueError("Empreinte de source ORIA Cours invalide.")
        if conversation_id is not None or source_message_id is not None:
            raise ValueError("Les fichiers ORIA Cours restent independants du Chat.")
        if not isinstance(file_bytes, (bytes, bytearray)) or not file_bytes:
            raise ValueError("Fichier ORIA Cours vide.")
        if len(file_bytes) > cls.MAX_ARTIFACT_BYTES:
            raise ValueError("Fichier ORIA Cours trop volumineux.")
        if size_bytes is not None and (type(size_bytes) is not int or size_bytes != len(file_bytes)):
            raise ValueError("Taille du fichier ORIA Cours incoherente.")
        if not isinstance(sha256, str) or sha256.lower() != hashlib.sha256(file_bytes).hexdigest():
            raise ValueError("Empreinte du fichier ORIA Cours incoherente.")
        expected_filename = cls._safe_filename(filename)
        if not expected_filename.lower().endswith("." + ext):
            raise ValueError("Nom de fichier ORIA Cours incoherent.")
        return uid, aid, course_id, expected_filename

    @classmethod
    def _verify_course_existing(
        cls, row: Any, *, user_id: str, artifact_id: str,
        course_id: str, filename: str, extension: str,
        mime_type: str, category: str, size_bytes: int,
        sha256: str, metadata: dict[str, Any],
    ) -> dict[str, Any]:
        """Refuse toute reprise si les donnees preexistantes divergent."""
        if not isinstance(row, dict):
            raise CourseArtifactConflict("Ligne ORIA Cours invalide.")
        existing_metadata = row.get("metadata")
        if (
            str(row.get("id")) != artifact_id
            or str(row.get("user_id")) != user_id
            or str(row.get("filename")) != filename
            or str(row.get("extension")) != extension
            or str(row.get("mime_type")) != mime_type
            or str(row.get("category")) != category
            or type(row.get("size_bytes")) is not int
            or row["size_bytes"] != size_bytes
            or str(row.get("sha256", "")).lower() != sha256.lower()
            or not isinstance(existing_metadata, dict)
            or existing_metadata.get("source") != "oria-course"
            or existing_metadata.get("course_id") != course_id
            or existing_metadata.get("kind") != metadata["kind"]
            or existing_metadata.get("source_sha256") != metadata["source_sha256"]
        ):
            raise CourseArtifactConflict("Fichier ORIA Cours preexistant incoherent.")
        cls._assert_owned_storage_path(
            storage_path=row.get("storage_path"),
            user_id=user_id, artifact_id=artifact_id,
        )
        expected_path = f"{user_id}/artifacts/{artifact_id}/{filename}"
        if row.get("storage_path") != expected_path:
            raise CourseArtifactConflict("Chemin prive ORIA Cours inattendu.")
        # Les metadonnees verifiees ne prouvent pas que l'objet Storage existe
        # encore : une suppression administrative hors repository reste possible.
        return dict(row)

    def _save_course_artifact(
        self, *, user_id: str | UUID, artifact_id: str | UUID,
        filename: str, extension: str, mime_type: str, category: str,
        file_bytes: bytes, size_bytes: int | None, sha256: str,
        metadata: dict[str, Any], conversation_id: str | None,
        model: str | None, source_message_id: str | None,
    ) -> dict[str, Any]:
        """Stockage idempotent a cle fixe ; aucun effacement sur erreur incertaine.

        Le stockage objet et PostgreSQL ne partagent pas de transaction.
        L'objet peut exister meme si HTTP annonce un echec : on ne fait
        ni upsert, ni suppression automatique, ni retry d'un upload incertain.
        """
        uid, aid, cid, clean_name = self._validate_course_save(
            user_id=user_id, artifact_id=artifact_id, filename=filename,
            extension=extension, mime_type=mime_type, category=category,
            metadata=metadata, file_bytes=file_bytes, size_bytes=size_bytes,
            sha256=sha256, conversation_id=conversation_id,
            source_message_id=source_message_id,
        )
        ext = str(extension).lower().lstrip(".")
        expected = dict(user_id=uid, artifact_id=aid, course_id=cid,
                        filename=clean_name, extension=ext,
                        mime_type=mime_type, category=category,
                        size_bytes=len(file_bytes), sha256=sha256,
                        metadata=metadata)
        # Lecture AVANT upload : la reprise d'un commit valide n'ecrase rien.
        try:
            prior = self.get_artifact(user_id=uid, artifact_id=aid)
        except Exception as exc:
            raise CourseArtifactStorageUncertain(
                "Verification SQL du document ORIA Cours indisponible."
            ) from exc
        if prior is not None:
            return self._verify_course_existing(prior, **expected)

        try:
            self.upload_file(user_id=uid, artifact_id=aid,
                             filename=clean_name, file_bytes=file_bytes,
                             content_type=mime_type, upsert=False)
        except Exception as exc:
            # En cas de conflit Storage ou de timeout, ne pas ecraser l'objet.
            # Une insertion DB concurrente peut etre devenue visible.
            try:
                prior = self.get_artifact(user_id=uid, artifact_id=aid)
            except Exception:
                prior = None
            if prior is not None:
                return self._verify_course_existing(prior, **expected)
            raise CourseArtifactStorageUncertain(
                "Upload ORIA Cours non confirme ; reconciliation Storage requise."
            ) from exc

        try:
            row = self.create_artifact(
                user_id=uid, artifact_id=aid, filename=clean_name,
                extension=ext, mime_type=mime_type, category=category,
                storage_path=f"{uid}/artifacts/{aid}/{clean_name}",
                size_bytes=len(file_bytes), sha256=sha256,
                conversation_id=None, model=model, source_message_id=None,
                metadata=metadata,
            )
        except Exception as exc:
            # Ne PAS supprimer le blob ici : l'insertion a pu etre commitee.
            try:
                prior = self.get_artifact(user_id=uid, artifact_id=aid)
            except Exception:
                prior = None
            if prior is not None:
                return self._verify_course_existing(prior, **expected)
            raise CourseArtifactStorageUncertain(
                "Insertion SQL ORIA Cours non confirmee ; reconciliation requise."
            ) from exc
        return self._verify_course_existing(row, **expected)

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
        normalized_user_id = self._safe_storage_segment(user_id, "user_id")
        normalized_artifact_id = self._safe_storage_segment(artifact_id, "artifact_id")

        if not isinstance(file_bytes, (bytes, bytearray)) or not file_bytes:
            raise ValueError("Le fichier artifact est vide.")
        if len(file_bytes) > self.MAX_ARTIFACT_BYTES:
            raise ValueError("Le fichier artifact dépasse la limite de 50 Mo.")
        if not isinstance(content_type, str) or not content_type.strip():
            raise ValueError("Le type MIME du fichier est obligatoire.")

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
        download: bool = False,
    ) -> str:
        """Signe un chemin privé en mode lecture (inline) ou téléchargement.

        Cette méthode bas niveau doit seulement être appelée sur un chemin
        obtenu après contrôle de propriété, par save_artifact/get/list.
        Les URLs signées sont des *bearer tokens* temporaires : elles ne sont
        jamais persistées en base ni placées dans les journaux.
        """
        if not isinstance(storage_path, str) or not storage_path.strip():
            raise ValueError("Le chemin Storage est obligatoire.")
        if type(download) is not bool:
            raise ValueError("Le mode download doit être un booléen.")
        if expires_in is None:
            resolved_expires_in = self.DEFAULT_SIGNED_URL_EXPIRES_IN
        else:
            if isinstance(expires_in, bool):
                raise ValueError("Durée de signature invalide.")
            try:
                resolved_expires_in = int(expires_in)
            except (TypeError, ValueError, OverflowError) as exc:
                raise ValueError("Durée de signature invalide.") from exc
            resolved_expires_in = max(60, min(
                resolved_expires_in, self.MAX_SIGNED_URL_EXPIRES_IN,
            ))

        try:
            bucket = self.client.storage.from_(self.BUCKET_NAME)
            if download:
                try:
                    # storage-py expose le troisième argument « options ».
                    response = bucket.create_signed_url(
                        storage_path, resolved_expires_in, {"download": True},
                    )
                except TypeError:
                    # Compatibilité avec d'anciens SDK/faux clients de test
                    # qui ne connaissent pas encore l'argument options.
                    response = bucket.create_signed_url(
                        storage_path, resolved_expires_in,
                    )
                    plain_url = self._extract_signed_url(response)
                    if not plain_url:
                        raise RuntimeError("Aucune URL signée exploitable.")
                    return self._add_download_query(plain_url)
            else:
                response = bucket.create_signed_url(
                    storage_path, resolved_expires_in,
                )
        except Exception as exc:
            raise RuntimeError(
                "Impossible de créer l'URL signée de l'artifact."
            ) from exc

        signed_url = self._extract_signed_url(response)
        if not signed_url:
            raise RuntimeError("Supabase n'a retourné aucune URL signée exploitable.")
        # Le SDK moderne ajoute déjà le paramètre download en mode attachement.
        # Ne pas modifier une signature officielle en ajoutant des paramètres
        # supplémentaires sauf dans le fallback de compatibilité ci-dessus.
        return signed_url

    @staticmethod
    def _add_download_query(signed_url: str) -> str:
        """Ajoute download à une URL déjà signée, sans perdre le token."""
        parts = urlsplit(signed_url)
        query = [(key, value) for key, value in parse_qsl(
            parts.query, keep_blank_values=True,
        ) if key.lower() != "download"]
        query.append(("download", ""))
        return urlunsplit((
            parts.scheme, parts.netloc, parts.path,
            urlencode(query, doseq=True), parts.fragment,
        ))

    @classmethod
    def _supports_inline_preview(cls, artifact: dict[str, Any]) -> bool:
        extension = str(artifact.get("extension") or "").lower().lstrip(".")
        mime = str(artifact.get("mime_type") or "").lower().split(";", 1)[0].strip()
        return (
            extension in cls.INLINE_PREVIEW_TYPES
            and mime == cls.INLINE_PREVIEW_MIME.get(extension)
        )

    def _attach_access_urls(
        self,
        artifact: dict[str, Any],
        *,
        user_id: str | UUID,
        expires_in: Optional[int] = None,
    ) -> dict[str, Any]:
        """Enrichit un enregistrement déjà contrôlé avec des URLs éphémères.

        Un défaut de signature ne change pas le succès de la persistance.
        Le frontend peut rappeler GET /ai/artifacts/{id} pour renouveler.
        """
        result = dict(artifact)
        result.update({
            "download_url": None,
            "url": None,
            "preview_url": None,
            "preview_supported": self._supports_inline_preview(result),
            "preview_available": False,
        })
        storage_path = result.get("storage_path")
        if not storage_path:
            return result
        self._assert_owned_storage_path(
            storage_path=str(storage_path),
            user_id=user_id,
            artifact_id=result.get("id"),
        )
        # Pour les PDF, obtenir l'URL inline pour un lecteur intégré.
        # Ne JAMAIS utiliser le contenu HTML/SVG utilisateur comme iframe.
        if result["preview_supported"]:
            try:
                result["preview_url"] = self.create_signed_url(
                    str(storage_path), expires_in=expires_in,
                )
                result["preview_available"] = bool(result["preview_url"])
            except Exception:
                logger.warning(
                    "Aperçu indisponible pour l'artifact %s.", result.get("id"),
                )
        try:
            result["download_url"] = self.create_signed_url(
                str(storage_path), expires_in=expires_in, download=True,
            )
        except Exception:
            logger.warning(
                "Téléchargement signé indisponible pour l'artifact %s.",
                result.get("id"),
            )
            # Le lien inline reste exploitable pour sauvegarder le PDF
            # côté navigateur si le lien de téléchargement n'est pas prêt.
            result["download_url"] = result["preview_url"]
        result["url"] = result["download_url"]
        return result

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
        normalized_user_id = self._safe_storage_segment(user_id, "user_id")
        normalized_artifact_id = self._safe_storage_segment(artifact_id, "artifact_id")

        self._assert_owned_storage_path(
            storage_path=storage_path,
            user_id=normalized_user_id,
            artifact_id=normalized_artifact_id,
        )

        if not 0 < size_bytes <= self.MAX_ARTIFACT_BYTES:
            raise ValueError("size_bytes du fichier invalide ou supérieur à 50 Mo.")

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
                self.client
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

        # ORIA Cours : parcours de persistance renforcé, opt-in.
        # Le Chat et les autres créations gardent leur chemin historique.
        if self._course_artifact_metadata(metadata):
            if artifact_id is None:
                raise ValueError("Identifiant deterministe ORIA Cours obligatoire.")
            return self._save_course_artifact(
                user_id=user_id, artifact_id=resolved_artifact_id,
                filename=filename, extension=extension,
                mime_type=mime_type, category=category,
                file_bytes=file_bytes, size_bytes=size_bytes,
                sha256=sha256, metadata=dict(metadata),
                conversation_id=conversation_id, model=model,
                source_message_id=source_message_id,
            )

        # Contrôles avant tout upload : les métadonnées du fichier source
        # doivent correspondre exactement aux octets réellement stockés.
        if not isinstance(file_bytes, (bytes, bytearray)) or not file_bytes:
            raise ValueError("Le fichier artifact est vide ou invalide.")
        if len(file_bytes) > self.MAX_ARTIFACT_BYTES:
            raise ValueError("Le fichier artifact dépasse la limite de 50 Mo.")
        self._safe_storage_segment(user_id, "user_id")
        self._safe_storage_segment(resolved_artifact_id, "artifact_id")

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

        # La création de liens ne fait pas partie de la transaction Storage/DB.
        # Un défaut temporaire ne doit pas faire croire que le fichier n'existe pas.
        return self._attach_access_urls(artifact, user_id=user_id)

    def get_artifact(
        self,
        *,
        artifact_id: str | UUID,
        user_id: str | UUID,
    ) -> Optional[dict[str, Any]]:
        """Récupère un artifact appartenant à l'utilisateur."""
        try:
            response = (
                self.client
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

        return self._attach_access_urls(
            artifact, user_id=user_id, expires_in=expires_in,
        )

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
                self.client
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
            try:
                item = self._attach_access_urls(row, user_id=user_id)
            except (ValueError, TypeError):
                # Ligne incohérente : ne jamais signer un chemin appartenant
                # à un autre utilisateur. L'élément reste listable sans lien.
                logger.warning(
                    "Chemin de stockage incohérent pour l'artifact %s.",
                    row.get("id"),
                )
                item = dict(row)
                item.update({
                    "url": None, "download_url": None, "preview_url": None,
                    "preview_available": False, "preview_supported": False,
                })
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

        # Les fichiers facturés ORIA Cours servent de preuve durable du job.
        # Empêcher une suppression partielle (Storage supprimé puis trigger SQL
        # qui refuse DELETE) ; l'effacement RGPD exige un parcours serveur
        # explicite et coordonné avec le job et la transcription.
        if self._course_artifact_metadata(artifact.get("metadata")):
            raise PermissionError(
                "Suppression ORIA Cours réservée à une procédure serveur dédiée."
            )

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
                self.client
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
    def _safe_storage_segment(value: str | UUID, label: str) -> str:
        """Bloque les segments non canoniques avant tout accès Storage."""
        normalized = str(value or "").strip()
        if re.fullmatch(r"[A-Za-z0-9_-]{1,128}", normalized) is None:
            raise ValueError(f"Identifiant Storage invalide : {label}.")
        return normalized

    @classmethod
    def _assert_owned_storage_path(
        cls,
        *,
        storage_path: str,
        user_id: str | UUID,
        artifact_id: str | UUID,
    ) -> None:
        """Refuse toute signature/suppression hors du chemin de cet artifact."""
        normalized_user = cls._safe_storage_segment(user_id, "user_id")
        normalized_artifact = cls._safe_storage_segment(artifact_id, "artifact_id")
        prefix = f"{normalized_user}/artifacts/{normalized_artifact}/"
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

        storage = self.client.storage.from_(self.BUCKET_NAME)

        return storage.upload(
            path,
            file_bytes,
            options,
        )

    def _storage_remove(
        self,
        storage_path: str,
    ) -> Any:
        storage = self.client.storage.from_(self.BUCKET_NAME)
        return storage.remove([storage_path])


supabase_artifact_repository = SupabaseArtifactRepository()
