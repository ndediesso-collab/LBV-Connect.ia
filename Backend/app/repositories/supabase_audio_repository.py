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


# ============================================================
# ORIA COURS — STOCKAGE PRIVE DISTINCT DES NOTES VOCALES
# ============================================================
# Les tables oria_courses / oria_course_segments et le bucket PRIVE
# oria-course-audio sont a creer via une migration Supabase SEPAREE.
# Aucun segment ne doit etre transcrit avant l'envoi complet du cours.
# Le service Cours fera : create_course -> upload_segment (plusieurs fois)
# -> submit_course -> reservation des credits -> worker de transcription.
# Les anciennes notes vocales et leur table oria_voice_notes sont intactes.


class CourseStorageError(AudioStorageError):
    """Operation de stockage de cours refusee ou non disponible."""


class CourseStorageConflict(CourseStorageError):
    """Ecriture concurrente, doublon contradictoire ou statut incompatible."""


class SupabaseCourseAudioRepository:
    """Stocke les fragments audio d'un cours sans modifier les notes vocales.

    IMPORTANT : Le depot utilise exclusivement un client Supabase SERVEUR.
    Un utilisateur est identifie en amont par la route authentifiee.

    Chaque cours reste en statut ``uploading`` pendant l'envoi. Seule la
    RPC atomique ``oria_submit_course`` peut passer a ``queued`` apres avoir
    valide tous les segments. Cette RPC, ainsi que les contraintes SQL
    interdisant l'ajout de segments apres soumission, sont indispensables
    avant l'activation de la fonction en production.
    """

    TABLE = "oria_courses"
    SEGMENTS_TABLE = "oria_course_segments"
    BUCKET = "oria-course-audio"
    SIGNED_URL_SECONDS = 15 * 60
    MAX_SEGMENT_BYTES = 20 * 1024 * 1024
    MAX_SEGMENT_DURATION_MS = 5 * 60 * 1000
    MAX_SEGMENTS = 120
    MAX_COURSE_DURATION_MS = 4 * 60 * 60 * 1000
    MAX_COURSE_BYTES = 512 * 1024 * 1024
    DOCUMENT_FORMATS = frozenset({"pdf", "docx"})
    MIME_BY_EXTENSION = SupabaseAudioRepository.MIME_BY_EXTENSION

    def __init__(self, client: Any | None = None):
        self.client = client if client is not None else supabase

    _id = staticmethod(SupabaseAudioRepository._id)
    _rows = staticmethod(SupabaseAudioRepository._rows)
    _check_response = staticmethod(SupabaseAudioRepository._check_response)
    _signed_url_value = staticmethod(SupabaseAudioRepository._signed_url_value)

    @classmethod
    def _index(cls, index: int) -> int:
        if type(index) is not int or not 0 <= index < cls.MAX_SEGMENTS:
            raise ValueError("Indice du segment de cours invalide.")
        return index

    @classmethod
    def _format(cls, document_format: str | None) -> str:
        if document_format is None:
            return "pdf"
        if not isinstance(document_format, str):
            raise ValueError("Le format du document doit etre PDF ou DOCX.")
        fmt = document_format.strip().lower()
        if fmt not in cls.DOCUMENT_FORMATS:
            raise ValueError("Le format du document doit etre PDF ou DOCX.")
        return fmt

    @classmethod
    def _mime(cls, ext: str, mime_type: str) -> str:
        extension = str(ext or "").strip().lower().lstrip(".")
        mime = str(mime_type or "").split(";", 1)[0].strip().lower()
        if extension not in cls.MIME_BY_EXTENSION or mime not in cls.MIME_BY_EXTENSION[extension]:
            raise ValueError("Format audio du cours non autorise.")
        return mime

    @classmethod
    def segment_path(
        cls, *, user_id: str, course_id: str, index: int, extension: str
    ) -> str:
        uid = cls._id(user_id, "user_id")
        cid = cls._id(course_id, "course_id")
        cls._index(index)
        ext = str(extension or "").lower().lstrip(".")
        if ext not in cls.MIME_BY_EXTENSION:
            raise ValueError("Extension audio du cours invalide.")
        return f"{uid}/{cid}/segments/{index:03d}.{ext}"

    def get_course(self, *, user_id: str, course_id: str) -> dict[str, Any] | None:
        uid = self._id(user_id, "user_id")
        cid = self._id(course_id, "course_id")
        try:
            response = (
                self.client.table(self.TABLE).select("*")
                .eq("user_id", uid).eq("id", cid).limit(1).execute()
            )
            self._check_response(response)
        except Exception as error:
            raise CourseStorageError("Impossible de lire ce cours prive.") from error
        rows = self._rows(response)
        row = rows[0] if rows else None
        if row and (str(row.get("id")) != cid or str(row.get("user_id")) != uid):
            raise CourseStorageError("Reponse Supabase incoherente pour ce cours.")
        return row

    def _owned_course(self, *, user_id: str, course_id: str) -> dict[str, Any]:
        row = self.get_course(user_id=user_id, course_id=course_id)
        if row is None:
            raise CourseStorageError("Cours introuvable ou non autorise.")
        return row

    def create_course(
        self, *, user_id: str, course_id: str,
        title: str | None = None, document_format: str | None = None,
    ) -> dict[str, Any]:
        """Cree un brouillon serveur au debut de l'ENVOI, pas de l'enregistrement.

        L'id demande peut etre reutilise sans creer de nouveau cours. Un ID
        deja enregistre avec d'autres choix est refuse (idempotence stricte).
        """
        uid = self._id(user_id, "user_id")
        cid = self._id(course_id, "course_id")
        fmt = self._format(document_format)
        clean_title = " ".join((title or "Cours sans titre").split())
        if not 1 <= len(clean_title) <= 160:
            raise ValueError("Le titre du cours doit contenir 1 a 160 caracteres.")

        previous = self.get_course(user_id=uid, course_id=cid)
        if previous:
            if previous.get("title") != clean_title or previous.get("document_format") != fmt:
                raise CourseStorageConflict("Cet identifiant correspond a un autre cours.")
            return previous
        payload = {
            "id": cid, "user_id": uid, "title": clean_title,
            "document_format": fmt, "status": "uploading",
        }
        try:
            response = self.client.table(self.TABLE).insert(payload).execute()
            self._check_response(response)
        except Exception as error:
            raise CourseStorageError("Impossible de creer le brouillon du cours.") from error
        rows = self._rows(response)
        if not rows or str(rows[0].get("id")) != cid or str(rows[0].get("user_id")) != uid:
            raise CourseStorageError("La creation du cours n'a pas ete confirmee.")
        return rows[0]

    def get_segment(
        self, *, user_id: str, course_id: str, index: int
    ) -> dict[str, Any] | None:
        uid = self._id(user_id, "user_id")
        cid = self._id(course_id, "course_id")
        i = self._index(index)
        self._owned_course(user_id=uid, course_id=cid)
        try:
            response = (
                self.client.table(self.SEGMENTS_TABLE).select("*")
                .eq("user_id", uid).eq("course_id", cid)
                .eq("segment_index", i).limit(1).execute()
            )
            self._check_response(response)
        except Exception as error:
            raise CourseStorageError("Impossible de lire le segment du cours.") from error
        rows = self._rows(response)
        row = rows[0] if rows else None
        if row and (
            str(row.get("user_id")) != uid
            or str(row.get("course_id")) != cid
            or row.get("segment_index") != i
        ):
            raise CourseStorageError("Metadonnees de segment incoherentes.")
        return row

    def upload_segment(
        self, *, user_id: str, course_id: str, index: int,
        data: bytes, mime_type: str, extension: str, duration_ms: int,
    ) -> dict[str, Any]:
        """Enregistre un segment DEJA inspecte par CourseAudioPolicy.

        L'appelant DOIT effectuer ``CourseAudioPolicy.inspect_segment`` sur
        les octets d'origine avant cette methode. La base doit aussi bloquer
        via une contrainte/trigger toute insertion apres la soumission.
        """
        uid = self._id(user_id, "user_id")
        cid = self._id(course_id, "course_id")
        i = self._index(index)
        normalized_mime = self._mime(extension, mime_type)
        if not isinstance(data, bytes) or not 0 < len(data) <= self.MAX_SEGMENT_BYTES:
            raise ValueError("Segment du cours vide ou superieur a 20 Mio.")
        if type(duration_ms) is not int or not 400 <= duration_ms <= self.MAX_SEGMENT_DURATION_MS:
            raise ValueError("Duree de segment invalide (maximum 5 minutes).")
        digest = hashlib.sha256(data).hexdigest()
        course = self._owned_course(user_id=uid, course_id=cid)
        if course.get("status") != "uploading":
            raise CourseStorageConflict("Le cours est deja soumis ou en traitement.")

        current = self.get_segment(user_id=uid, course_id=cid, index=i)
        if current:
            if (
                current.get("sha256") == digest
                and current.get("mime_type") == normalized_mime
                and current.get("duration_ms") == duration_ms
                and current.get("size_bytes") == len(data)
            ):
                return current  # Meme envoi rejoue, sans nouveau fichier.
            raise CourseStorageConflict("Un autre fichier utilise deja cet indice.")

        # Garde-fous locaux en plus de la future contrainte SQL atomique.
        # La base reste l'autorite en cas d'envois concurrents.
        already_stored = self.list_segments(user_id=uid, course_id=cid)
        total_ms = sum(int(row["duration_ms"]) for row in already_stored) + duration_ms
        total_size = sum(int(row["size_bytes"]) for row in already_stored) + len(data)
        if len(already_stored) >= self.MAX_SEGMENTS:
            raise CourseStorageConflict("Ce cours contient deja le maximum de segments.")
        if total_ms > self.MAX_COURSE_DURATION_MS:
            raise CourseStorageConflict("La duree totale du cours depasse 4 heures.")
        if total_size > self.MAX_COURSE_BYTES:
            raise CourseStorageConflict("Le cours depasse la taille totale autorisee (512 Mio).")

        path = self.segment_path(user_id=uid, course_id=cid, index=i, extension=extension)
        payload = {
            "user_id": uid, "course_id": cid, "segment_index": i,
            "storage_path": path, "mime_type": normalized_mime,
            "duration_ms": duration_ms, "size_bytes": len(data),
            "sha256": digest,
        }
        try:
            # Aucun overwrite : reutiliser un indice impose le MEME segment.
            response = self.client.storage.from_(self.BUCKET).upload(
                path, data, {"content-type": normalized_mime, "upsert": False}
            )
            self._check_response(response)
        except Exception as error:
            raise CourseStorageConflict("Impossible de deposer ce segment prive.") from error

        try:
            response = self.client.table(self.SEGMENTS_TABLE).insert(payload).execute()
            self._check_response(response)
            rows = self._rows(response)
            if not rows or any(rows[0].get(k) != v for k, v in payload.items()):
                raise CourseStorageError("La base n'a pas confirme ce segment.")
            return rows[0]
        except Exception as error:
            # Une reponse reseau perdue n'implique PAS que l'INSERT a echoue.
            # Ne jamais supprimer le blob si la ligne a pu etre creee :
            # cela detruirait un enregistrement deja confirme en base.
            try:
                confirmed = self.get_segment(user_id=uid, course_id=cid, index=i)
            except Exception:
                raise CourseStorageError(
                    "Insertion incertaine : conserver le blob et reconciler en serveur."
                ) from error
            if confirmed:
                if all(confirmed.get(k) == v for k, v in payload.items()):
                    return confirmed
                raise CourseStorageConflict(
                    "Un segment concurrent a ete enregistre a cet indice."
                ) from error
            # Absence confirmee : nettoyage de l'upload non reference.
            try:
                cleanup = self.client.storage.from_(self.BUCKET).remove([path])
                self._check_response(cleanup)
            except Exception:
                raise CourseStorageError(
                    "Insertion absente mais suppression du fichier non confirmee."
                ) from error
            raise CourseStorageError("Impossible d'enregistrer le segment du cours.") from error

    def list_segments(
        self, *, user_id: str, course_id: str
    ) -> list[dict[str, Any]]:
        uid = self._id(user_id, "user_id")
        cid = self._id(course_id, "course_id")
        self._owned_course(user_id=uid, course_id=cid)
        try:
            response = (
                self.client.table(self.SEGMENTS_TABLE).select("*")
                .eq("user_id", uid).eq("course_id", cid)
                .order("segment_index").limit(self.MAX_SEGMENTS + 1).execute()
            )
            self._check_response(response)
        except Exception as error:
            raise CourseStorageError("Impossible de retrouver les segments du cours.") from error
        rows = self._rows(response)
        if len(rows) > self.MAX_SEGMENTS:
            raise CourseStorageError("Trop de segments dans ce cours.")
        for row in rows:
            index = row.get("segment_index")
            if (
                str(row.get("user_id")) != uid
                or str(row.get("course_id")) != cid
                or type(index) is not int
            ):
                raise CourseStorageError("Segments prives incoherents.")
            expected_ext = str(row.get("storage_path") or "").rsplit(".", 1)[-1]
            if row.get("storage_path") != self.segment_path(
                user_id=uid, course_id=cid, index=index, extension=expected_ext
            ):
                raise CourseStorageError("Chemin de stockage du segment incorrect.")
            self._mime(expected_ext, row.get("mime_type"))
        return rows

    def download_segment(
        self, *, user_id: str, course_id: str, index: int
    ) -> bytes:
        row = self.get_segment(user_id=user_id, course_id=course_id, index=index)
        if row is None:
            raise CourseStorageError("Segment introuvable ou non autorise.")
        path = str(row.get("storage_path") or "")
        ext = path.rsplit(".", 1)[-1]
        if path != self.segment_path(user_id=user_id, course_id=course_id, index=index, extension=ext):
            raise CourseStorageError("Chemin du segment invalide.")
        self._mime(ext, row.get("mime_type"))
        try:
            result = self.client.storage.from_(self.BUCKET).download(path)
            self._check_response(result)
        except Exception as error:
            raise CourseStorageError("Impossible de lire le fichier audio du cours.") from error
        if not isinstance(result, (bytes, bytearray)) or not 0 < len(result) <= self.MAX_SEGMENT_BYTES:
            raise CourseStorageError("Taille du segment stocke invalide.")
        if len(result) != row.get("size_bytes") or hashlib.sha256(result).hexdigest() != row.get("sha256"):
            raise CourseStorageError("Le segment ne correspond pas a son empreinte de securite.")
        return bytes(result)

    def signed_segment_url(
        self, *, user_id: str, course_id: str, index: int
    ) -> str:
        """URL de reecoute courte duree, sans acces public au bucket."""
        row = self.get_segment(user_id=user_id, course_id=course_id, index=index)
        if row is None:
            raise CourseStorageError("Segment introuvable ou non autorise.")
        path = str(row.get("storage_path") or "")
        ext = path.rsplit(".", 1)[-1]
        if path != self.segment_path(user_id=user_id, course_id=course_id, index=index, extension=ext):
            raise CourseStorageError("Chemin du segment invalide.")
        self._mime(ext, row.get("mime_type"))
        try:
            response = self.client.storage.from_(self.BUCKET).create_signed_url(
                path, self.SIGNED_URL_SECONDS
            )
            self._check_response(response)
            url = self._signed_url_value(response)
        except Exception as error:
            raise CourseStorageError("Impossible de fournir la reecoute du cours.") from error
        if not url:
            raise CourseStorageError("URL audio privee manquante.")
        return url

    def submit_course(
        self, *, user_id: str, course_id: str
    ) -> dict[str, Any]:
        """Finalise l'envoi COMPLET d'un cours par une RPC SQL atomique.

        Contrainte serveur : ni transcription ni generation avant le retour
        confirme de la RPC. La migration doit installer ``oria_submit_course``
        et verifier, sous verrou SQL, la presence et la continuite des
        segments, la somme des durees (<=4 h), la taille (<=512 Mio),
        le format et le statut ``uploading`` ; puis passer a ``queued``.
        """
        # Import differe : le service Audio importe ce repository vocal.
        from app.services.audio_service import CourseAudioPolicy

        uid = self._id(user_id, "user_id")
        cid = self._id(course_id, "course_id")
        course = self._owned_course(user_id=uid, course_id=cid)
        if course.get("status") != "uploading":
            if course.get("status") == "queued":
                return course  # Retry HTTP d'une soumission deja confirmee.
            raise CourseStorageConflict("Ce cours n'est plus en phase d'envoi.")

        segments = self.list_segments(user_id=uid, course_id=cid)
        manifest = CourseAudioPolicy.validate_manifest(
            [{
                "index": seg["segment_index"],
                "duration_ms": seg["duration_ms"],
                "size_bytes": seg["size_bytes"],
                "mime_type": seg["mime_type"],
                "extension": str(seg["storage_path"]).rsplit(".", 1)[-1],
                "sha256": seg["sha256"],
            } for seg in segments],
            document_format=course.get("document_format"),
        )
        try:
            response = self.client.rpc("oria_submit_course", {
                "p_user_id": uid,
                "p_course_id": cid,
                "p_segment_count": manifest["segment_count"],
                "p_duration_ms": manifest["duration_ms"],
                "p_size_bytes": manifest["size_bytes"],
                "p_document_format": manifest["document_format"],
            }).execute()
            self._check_response(response)
        except Exception as error:
            raise CourseStorageError(
                "Soumission atomique indisponible : verifier la migration Supabase."
            ) from error
        rows = self._rows(response)
        if not rows or (
            str(rows[0].get("id")) != cid
            or str(rows[0].get("user_id")) != uid
            or rows[0].get("status") != "queued"
        ):
            raise CourseStorageError("La base n'a pas confirme la soumission du cours.")
        return rows[0]


# Ce singleton ne modifie pas le singleton historique des notes vocales.
supabase_course_audio_repository = SupabaseCourseAudioRepository()
