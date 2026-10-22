"""Gestion des notes vocales ORIA, sans modifier la facturation du Chat.

Protocole : enregistrement -> upload privé -> transcription asynchrone ->
prévisualisation/réécoute -> envoi vocal OU envoi texte modifiable.

L'API OpenAI ne reçoit jamais un audio avant une réservation de crédits.
Les prix ne sont pas inventés : voir ORIA_AUDIO_CREDITS_PER_MINUTE et
l'action CreditAction.AUDIO_TRANSCRIPTION requises dans le guide.
"""
from __future__ import annotations

import hashlib
import json
import math
import os
import shutil
import subprocess
import tempfile
from pathlib import PurePosixPath
from typing import Any
from uuid import UUID, uuid4

from app.config.credit_costs import CreditAction
from app.core.supabase import supabase
from app.repositories.supabase_audio_repository import SupabaseAudioRepository
from app.repositories.supabase_credit_repository import SupabaseCreditRepository
from app.services.openai_service import OpenAIService


class AudioError(RuntimeError):
    pass


class AudioUnavailable(AudioError):
    pass


class AudioConflict(AudioError):
    pass


class AudioInsufficientCredits(AudioError):
    pass


class AudioPackInactive(AudioError):
    pass


class AudioNotFound(AudioError):
    pass


class AudioInvalid(AudioError):
    pass


class AudioService:
    MAX_BYTES = 20 * 1024 * 1024
    MAX_DURATION_SECONDS = 5 * 60
    MIN_DURATION_SECONDS = 0.4
    TRANSCRIPTION_MODEL = "gpt-4o-mini-transcribe"
    MIME_EXTENSIONS = {
        "audio/webm": "webm",
        "audio/ogg": "ogg",
        "audio/mpeg": "mp3",
        "audio/mp3": "mp3",
        "audio/mp4": "m4a",
        "audio/x-m4a": "m4a",
        "audio/m4a": "m4a",
        "audio/wav": "wav",
        "audio/x-wav": "wav",
        "audio/aac": "aac",
        "audio/3gpp": "3gp",
    }
    TRANSCODING_MIMES = {"audio/aac", "audio/3gpp"}
    MAX_EDITED_CHARS = 20000

    def __init__(self, *, audio_repository: SupabaseAudioRepository | None = None,
                 credit_repository: Any | None = None,
                 openai_service: Any | None = None):
        self.repo = audio_repository or SupabaseAudioRepository()
        self.credits = credit_repository or SupabaseCreditRepository(supabase)
        # Ne créer le client OpenAI que lorsqu'un traitement est effectivement requis.
        self._openai_service = openai_service

    @classmethod
    def _billing_parameters(cls) -> tuple[CreditAction, int]:
        action = getattr(CreditAction, "AUDIO_TRANSCRIPTION", None)
        raw_price = os.getenv("ORIA_AUDIO_CREDITS_PER_MINUTE", "").strip()
        if action is None or not raw_price:
            raise AudioUnavailable(
                "Facturation audio non configurée : action AUDIO_TRANSCRIPTION "
                "et variable ORIA_AUDIO_CREDITS_PER_MINUTE requises."
            )
        try:
            per_minute = int(raw_price)
        except ValueError as error:
            raise AudioUnavailable("Prix audio non numérique.") from error
        if not (1 <= per_minute <= 100000):
            raise AudioUnavailable("Prix audio hors limites.")
        return action, per_minute

    @staticmethod
    def _reservation_ttl_seconds() -> int:
        """Délai audio explicite (15 min à 2 h), indépendamment du Chat.

        Le repository de crédits applique aussi cette limite. La contrôler ici
        avant de prendre le job évite de le bloquer en état « processing »
        lorsque la configuration serveur est invalide.
        """
        raw = os.getenv("ORIA_AUDIO_RESERVATION_TTL_SECONDS", "3600")
        try:
            ttl = int(raw)
        except (TypeError, ValueError) as error:
            raise AudioUnavailable("Délai de réservation audio invalide.") from error
        if not 900 <= ttl <= 7200:
            raise AudioUnavailable("Le délai audio doit être compris entre 900 et 7200 secondes.")
        return ttl

    @classmethod
    def _duration(cls, data: bytes, extension: str) -> float:
        if not shutil.which("ffprobe"):
            raise AudioUnavailable("ffprobe est nécessaire au contrôle des durées audio.")
        path = None
        try:
            with tempfile.NamedTemporaryFile(suffix=f".{extension}", delete=False) as f:
                path = f.name
                f.write(data)
            process = subprocess.run(
                ["ffprobe", "-v", "error", "-show_entries", "format=duration:stream=codec_type",
                 "-of", "json", path],
                capture_output=True, timeout=18, check=False,
            )
            if process.returncode != 0:
                raise AudioInvalid("Enregistrement corrompu ou format audio invalide.")
            info = json.loads(process.stdout)
            if not any(s.get("codec_type") == "audio" for s in info.get("streams", [])):
                raise AudioInvalid("Aucune piste audio détectée.")
            if any(s.get("codec_type") == "video" for s in info.get("streams", [])):
                raise AudioInvalid("Les messages vocaux ne doivent pas contenir de vidéo.")
            duration = float(info.get("format", {}).get("duration") or 0)
            if not math.isfinite(duration) or not cls.MIN_DURATION_SECONDS <= duration <= cls.MAX_DURATION_SECONDS:
                raise AudioInvalid("Durée audio hors limites (maximum 5 minutes).")
            return duration
        except (subprocess.TimeoutExpired, json.JSONDecodeError, ValueError) as error:
            raise AudioInvalid("Impossible de mesurer l'enregistrement audio.") from error
        finally:
            if path:
                try:
                    os.unlink(path)
                except OSError:
                    pass

    @classmethod
    def _normalize_audio(cls, data: bytes, mime_type: str) -> tuple[bytes, str, str]:
        mime = (mime_type or "").split(";", 1)[0].strip().lower()
        if mime not in cls.MIME_EXTENSIONS:
            raise AudioInvalid("Format audio non pris en charge.")
        if not data or len(data) > cls.MAX_BYTES:
            raise AudioInvalid("Fichier audio vide ou supérieur à 20 Mo.")
        ext = cls.MIME_EXTENSIONS[mime]
        if mime not in cls.TRANSCODING_MIMES:
            return data, mime, ext
        if not shutil.which("ffmpeg"):
            raise AudioUnavailable("ffmpeg est nécessaire pour convertir AAC et 3GPP.")
        infile = outfile = None
        try:
            with tempfile.NamedTemporaryFile(suffix=f".{ext}", delete=False) as input_file:
                infile = input_file.name
                input_file.write(data)
            with tempfile.NamedTemporaryFile(suffix=".m4a", delete=False) as output_file:
                outfile = output_file.name
            process = subprocess.run(
                ["ffmpeg", "-nostdin", "-v", "error", "-y", "-i", infile,
                 "-map", "0:a:0", "-vn", "-c:a", "aac", "-b:a", "96k", outfile],
                capture_output=True, timeout=40, check=False,
            )
            if process.returncode != 0:
                raise AudioInvalid("Conversion de l'audio impossible.")
            with open(outfile, "rb") as f:
                result = f.read(cls.MAX_BYTES + 1)
            if not result or len(result) > cls.MAX_BYTES:
                raise AudioInvalid("Audio converti vide ou trop volumineux.")
            return result, "audio/mp4", "m4a"
        except subprocess.TimeoutExpired as error:
            raise AudioInvalid("Délai de conversion audio dépassé.") from error
        finally:
            for path in (infile, outfile):
                if path:
                    try:
                        os.unlink(path)
                    except OSError:
                        pass

    @staticmethod
    def _public(row: dict[str, Any], *, playback_url: str | None = None) -> dict[str, Any]:
        return {
            "audio_id": row["id"],
            "conversation_id": row.get("conversation_id"),
            "message_id": row.get("message_id"),
            "duration_ms": row.get("duration_ms"),
            "mime_type": row.get("mime_type"),
            "size_bytes": row.get("size_bytes"),
            "transcription_status": row.get("transcription_status"),
            "transcription": row.get("transcription") if row.get("transcription_status") == "complete" and row.get("billing_status") == "settled" else None,
            "delivery_mode": row.get("delivery_mode"),
            "edited_text": row.get("edited_text") if row.get("delivery_mode") == "text" else None,
            "billing_status": row.get("billing_status"),
            "credit_cost": row.get("credit_cost"),
            "playback_url": playback_url,
        }

    def _owned(self, user_id: str, audio_id: str) -> dict[str, Any]:
        row = self.repo.get(user_id=user_id, audio_id=audio_id)
        if not row:
            raise AudioNotFound("Note vocale introuvable.")
        return row

    def prepare_audio(self, *, user_id: str, conversation_id: str | None,
                      filename: str, mime_type: str, data: bytes,
                      request_id: str | None = None) -> dict[str, Any]:
        # Refuser AVANT upload si facturation/dépendances indisponibles.
        action, per_minute = self._billing_parameters()
        if not shutil.which("ffprobe"):
            raise AudioUnavailable("ffprobe n'est pas installé sur le backend.")
        try:
            audio_id = str(UUID(request_id)) if request_id else str(uuid4())
        except ValueError as error:
            raise AudioInvalid("request_id doit être un UUID.") from error
        if request_id:
            existing = self.repo.get(user_id=user_id, audio_id=audio_id)
            if existing:
                if hashlib.sha256(data).hexdigest() != existing.get("client_sha256"):
                    raise AudioConflict("Cet identifiant correspond à un autre audio.")
                return self._public(existing)
        original_sha = hashlib.sha256(data).hexdigest()
        valid_audio, stored_mime, extension = self._normalize_audio(data, mime_type)
        duration_seconds = self._duration(valid_audio, extension)
        duration_ms = math.ceil(duration_seconds * 1000)
        cost = max(1, math.ceil(duration_seconds / 60)) * per_minute
        # Les montants sont validés par le wallet avant toute facturation ultérieure.
        wallet = self.credits.get_wallet(user_id)
        if wallet is None or not wallet.is_pack_active:
            raise AudioPackInactive("Pack inactif : transcription indisponible.")
        if wallet.balance < cost:
            raise AudioInsufficientCredits(f"Crédits insuffisants : {cost} nécessaires à la transcription.")
        storage_path = self.repo.upload(
            user_id=user_id, audio_id=audio_id, ext=extension,
            data=valid_audio, mime_type=stored_mime,
        )
        try:
            row = self.repo.insert({
                "id": audio_id,
                "user_id": user_id,
                "conversation_id": conversation_id,
                "filename": PurePosixPath((filename or "note-oria").replace("\\", "/")).name[:140],
                "mime_type": stored_mime,
                "size_bytes": len(valid_audio),
                "storage_path": storage_path,
                "sha256": hashlib.sha256(valid_audio).hexdigest(),
                "client_sha256": original_sha,
                "duration_ms": duration_ms,
                "transcription_status": "queued",
                "billing_status": "none",
                "credit_cost": cost,
                "delivery_mode": "draft",
            })
        except Exception:
            try:
                self.repo.remove(storage_path, user_id=user_id, audio_id=audio_id)
            except Exception:
                pass
            raise
        return self._public(row)

    def process_audio(self, *, user_id: str, audio_id: str) -> dict[str, Any]:
        """Traite une note une seule fois via transition atomique queued->processing.

        La réservation SQL dure 60 minutes par défaut pour l'audio, contre
        15 minutes pour les autres actions. Une interruption pendant un appel
        OpenAI reste une situation d'examen manuel : on ne retranscrit pas
        automatiquement un job dont la facturation fournisseur est incertaine.
        """
        action, _ = self._billing_parameters()
        ttl_seconds = self._reservation_ttl_seconds()
        current = self._owned(user_id, audio_id)
        if current.get("transcription_status") == "queued" and current.get("billing_status") not in ("none", "released"):
            raise AudioConflict("Cette note a déjà une réservation à réconcilier.")

        claimed = self.repo.update(
            user_id=user_id, audio_id=audio_id,
            values={"transcription_status": "processing"},
            expected_status="queued",
        )
        if not claimed:
            return self._public(self._owned(user_id, audio_id))
        if claimed.get("billing_status") not in ("none", "released"):
            # Préserve l'état et la référence : surtout ne pas facturer une
            # seconde fois une tâche déjà engagée.
            raise AudioConflict("Cette note a déjà une opération de crédits en cours.")

        reservation_id = str(uuid4())
        reservation_recorded = False
        api_finished = False
        try:
            # Journaliser la référence AVANT l'appel RPC. Si Supabase valide
            # la réservation mais que la réponse réseau est perdue, la
            # référence reste récupérable pour une libération idempotente.
            pending = self.repo.update(
                user_id=user_id, audio_id=audio_id,
                values={"credit_reservation_id": reservation_id,
                        "billing_status": "release_pending"},
                expected_status="processing",
            )
            if not pending:
                raise AudioConflict("Impossible de sécuriser la réservation de la note.")
            reservation_recorded = True

            self.credits.reserve_credits(
                user_id=user_id, amount=int(claimed["credit_cost"]),
                action=action, reference_id=reservation_id,
                ttl_seconds=ttl_seconds,
            )
            confirmed = self.repo.update(
                user_id=user_id, audio_id=audio_id,
                values={"billing_status": "reserved"},
                expected_status="processing",
            )
            if not confirmed:
                raise AudioConflict("Impossible de confirmer la réservation audio.")

            raw_audio = self.repo.download(
                user_id=user_id, audio_id=audio_id,
                path=claimed["storage_path"],
            )
            service = self._openai_service or OpenAIService()
            result = service.transcribe_audio(
                data=raw_audio,
                filename=PurePosixPath(claimed["storage_path"]).name,
                mime_type=claimed["mime_type"],
                model=self.TRANSCRIPTION_MODEL,
            )
            transcript = str(result.get("text") or "").strip()
            if not transcript:
                raise AudioError("Transcription vide.")
            api_finished = True

            # Persister le résultat AVANT le débit définitif : reconciliation
            # possible sans deuxième appel OpenAI. En cas de panne d'écriture,
            # ne jamais repasser le job automatiquement à queued.
            saved = self.repo.update(
                user_id=user_id, audio_id=audio_id,
                values={"transcription": transcript,
                        "transcription_status": "complete",
                        "billing_status": "settlement_pending"},
                expected_status="processing",
            )
            if not saved:
                raise AudioConflict("Impossible de sauvegarder la transcription terminée.")
            self.credits.settle_credit_reservation(
                user_id=user_id, reference_id=reservation_id,
                actual_amount=int(claimed["credit_cost"]),
            )
            final = self.repo.update(
                user_id=user_id, audio_id=audio_id,
                values={"billing_status": "settled"},
            )
            return self._public(final or self._owned(user_id, audio_id))
        except Exception:
            if api_finished:
                # L'appel OpenAI a réussi : ne pas libérer les crédits et ne
                # surtout pas permettre une deuxième transcription payante.
                # Si la sauvegarde a échoué, l'état 'processing' est conservé
                # pour un examen manuel plutôt que de risquer une double API.
                raise
            if reservation_recorded:
                try:
                    # Même si reserve_credits() a levé une erreur réseau,
                    # la RPC release est idempotente et utilise la référence
                    # écrite préalablement. Un résultat inconnu reste bloqué.
                    self.credits.release_credit_reservation(
                        user_id=user_id, reference_id=reservation_id,
                    )
                    billing_status = "released"
                except Exception:
                    billing_status = "release_pending"
            else:
                billing_status = "none"
            self.repo.update(
                user_id=user_id, audio_id=audio_id,
                values={"transcription_status": "failed",
                        "billing_status": billing_status},
            )
            raise

    def reconcile_billing(self, *, user_id: str, audio_id: str) -> dict[str, Any]:
        row = self._owned(user_id, audio_id)
        if row.get("billing_status") == "settled":
            return self._public(row)
        if row.get("billing_status") != "settlement_pending":
            raise AudioConflict("Aucun règlement audio en attente.")
        reservation_id = row.get("credit_reservation_id")
        if not reservation_id or not row.get("transcription"):
            raise AudioConflict("Transcription non prête pour le règlement.")
        self.credits.settle_credit_reservation(
            user_id=user_id, reference_id=reservation_id,
            actual_amount=int(row["credit_cost"]),
        )
        updated = self.repo.update(user_id=user_id, audio_id=audio_id,
                                   values={"billing_status": "settled"})
        return self._public(updated or self._owned(user_id, audio_id))

    def reconcile_release(self, *, user_id: str, audio_id: str) -> dict[str, Any]:
        """Retente uniquement une libération échouée d'un job déjà en échec.

        Ne traite jamais les tâches 'processing' dont l'appel OpenAI pourrait
        être encore actif, ni les transcriptions déjà obtenues. La RPC SQL de
        libération est idempotente. En cas de réservation introuvable ou d'une
        panne DB, l'état reste 'release_pending' pour vérification serveur.
        """
        row = self._owned(user_id, audio_id)
        if row.get("billing_status") == "released":
            return self._public(row)
        if row.get("billing_status") != "release_pending":
            raise AudioConflict("Aucune libération audio en attente.")
        if row.get("transcription_status") != "failed" or row.get("transcription"):
            raise AudioConflict("La libération nécessite un job échoué sans transcription.")
        reservation_id = row.get("credit_reservation_id")
        if not reservation_id:
            raise AudioConflict("Référence de réservation introuvable.")
        self.credits.release_credit_reservation(
            user_id=user_id, reference_id=reservation_id,
        )
        updated = self.repo.update(
            user_id=user_id, audio_id=audio_id,
            values={"billing_status": "released"},
            expected_status="failed",
        )
        if not updated:
            raise AudioConflict("État modifié pendant la libération des crédits.")
        return self._public(updated)

    def get_audio(self, *, user_id: str, audio_id: str,
                  include_playback: bool = True) -> dict[str, Any]:
        row = self._owned(user_id, audio_id)
        playback_url = None
        if include_playback:
            playback_url = self.repo.signed_url(
                user_id=user_id, audio_id=audio_id, path=row["storage_path"]
            )
        return self._public(row, playback_url=playback_url)

    def send_audio(self, *, user_id: str, audio_id: str,
                   mode: str, edited_text: str | None = None) -> dict[str, Any]:
        row = self._owned(user_id, audio_id)
        if mode not in {"voice", "text"}:
            raise AudioInvalid("Choisir voice ou text.")
        if row.get("delivery_mode") not in {None, "draft"}:
            if row.get("delivery_mode") == mode:
                return self._public(row)
            raise AudioConflict("Cette note a déjà été envoyée sous un autre format.")
        values: dict[str, Any] = {"delivery_mode": mode}
        if mode == "text":
            if row.get("transcription_status") != "complete" or row.get("billing_status") != "settled":
                raise AudioConflict("La transcription et son règlement doivent être terminés avant l'envoi texte.")
            text = str(edited_text if edited_text is not None else row.get("transcription") or "").strip()
            if not text or len(text) > self.MAX_EDITED_CHARS:
                raise AudioInvalid("Transcription vide ou trop longue.")
            values["edited_text"] = text
        updated = self.repo.update(user_id=user_id, audio_id=audio_id, values=values)
        return self._public(updated or self._owned(user_id, audio_id))

    def attach_message(self, *, user_id: str, audio_id: str,
                       message_id: str) -> dict[str, Any]:
        """Lie la note à un message chat existant dont l'utilisateur est propriétaire."""
        row = self._owned(user_id, audio_id)
        if row.get("delivery_mode") != "voice":
            raise AudioConflict("Seules les notes envoyées comme audio restent liées au message.")
        if row.get("message_id"):
            if str(row["message_id"]) == str(message_id):
                return self._public(row)
            raise AudioConflict("Cette note appartient déjà à un autre message.")
        response = (supabase.table("messages").select("id,conversation_id,role")
                    .eq("id", message_id).eq("user_id", user_id).limit(1).execute())
        rows = self.repo._rows(response)
        if not rows or rows[0].get("role") != "user":
            raise AudioNotFound("Message utilisateur introuvable.")
        if row.get("conversation_id") != rows[0].get("conversation_id"):
            raise AudioConflict("Le message n'appartient pas à cette conversation.")
        updated = self.repo.update(user_id=user_id, audio_id=audio_id,
                                   values={"message_id": message_id})
        return self._public(updated or self._owned(user_id, audio_id))

    def delete_draft(self, *, user_id: str, audio_id: str) -> None:
        row = self._owned(user_id, audio_id)
        if row.get("delivery_mode") != "draft":
            raise AudioConflict("Une note déjà envoyée ne peut pas être supprimée ici.")
        if row.get("transcription_status") in {"processing"} or row.get("billing_status") in {
            "reserved", "settlement_pending", "release_pending",
        }:
            raise AudioConflict("Transcription ou règlement en cours : suppression différée.")
        self.repo.remove(row["storage_path"], user_id=user_id, audio_id=audio_id)
        self.repo.delete_record(user_id=user_id, audio_id=audio_id)

    def queue_retry(self, *, user_id: str, audio_id: str) -> dict[str, Any]:
        row = self._owned(user_id, audio_id)
        if row.get("billing_status") not in {"none", "released"}:
            raise AudioConflict("Une réservation audio est encore à réconcilier.")
        if row.get("transcription_status") != "failed":
            raise AudioConflict("Seul un audio en échec peut être relancé.")
        updated = self.repo.update(
            user_id=user_id, audio_id=audio_id,
            values={"transcription_status": "queued"}, expected_status="failed"
        )
        if not updated:
            raise AudioConflict("La note a déjà été remise en file d'attente.")
        return self._public(updated)

# ============================================================
# ORIA COURS — VALIDATION AUDIO INDEPENDANTE DES NOTES VOCALES
# ============================================================
# IMPORTANT :
# - AudioService conserve integralement son fonctionnement actuel (5 minutes).
# - Une session Cours peut durer jusqu'a 4 heures au TOTAL, pas par segment.
# - Le client enregistre localement puis lance l'envoi. Le backend ne doit
#   commencer transcription et redaction qu'apres validation de l'envoi,
#   authentification et reservation des credits par le futur CourseService.
# - Les segments sont controles individuellement, puis comme un ensemble.
# - Ce module ne stocke PAS les segments, ne facture PAS et n'appelle PAS l'IA.
#   Le stockage, le worker et la facturation seront implementes dans les
#   fichiers backend specifiques que nous traiterons ensuite.


class CourseAudioPolicy:
    """Valide le contenu audio et le format d'une session ORIA Cours.

    Le traitement des longues sessions sera construit autour de segments
    courts pour respecter les limites d'upload et de transcription.
    Les informations remises a validate_manifest() doivent provenir d'une
    inspection SERVEUR des vrais octets, jamais des declarations du client.
    """

    MAX_COURSE_DURATION_MS = 4 * 60 * 60 * 1000  # 4 h = 14 400 s
    MAX_SEGMENT_DURATION_SECONDS = AudioService.MAX_DURATION_SECONDS  # 5 min
    MAX_SEGMENT_BYTES = AudioService.MAX_BYTES  # 20 Mio
    MAX_SEGMENTS = 120  # permet des segments de ~2 min jusqu'a 4 heures
    MAX_COURSE_BYTES = 512 * 1024 * 1024  # borne de securite par cours
    DEFAULT_DOCUMENT_FORMAT = "pdf"
    DOCUMENT_FORMATS = frozenset({"pdf", "docx"})

    @classmethod
    def validate_document_format(cls, value: str | None = None) -> str:
        """PDF par defaut ; DOCX sur demande explicite."""
        if value is None:
            return cls.DEFAULT_DOCUMENT_FORMAT
        if not isinstance(value, str):
            raise AudioInvalid("Le format du cours doit etre PDF ou DOCX.")
        selected = value.strip().lower()
        if selected not in cls.DOCUMENT_FORMATS:
            raise AudioInvalid("Format non pris en charge : choisissez PDF ou DOCX.")
        return selected

    @classmethod
    def inspect_segment(
        cls, *, index: int, data: bytes, mime_type: str
    ) -> tuple[dict[str, Any], bytes]:
        """Controle un vrai segment et retourne ses metadonnees + octets normalises.

        Utiliser les memes protections de format, de taille et de duree que
        les notes vocales, sans soumettre le segment a leur facturation.
        Les octets renvoyes sont destines au stockage prive du futur
        CourseService et ne doivent jamais etre exposes en JSON.
        """
        if type(index) is not int or not 0 <= index < cls.MAX_SEGMENTS:
            raise AudioInvalid("Indice de segment de cours invalide.")
        if not isinstance(data, bytes):
            raise AudioInvalid("Le segment audio doit etre transmis en octets.")

        normalized, stored_mime, extension = AudioService._normalize_audio(
            data, mime_type
        )
        # Utilise la limite existante de 5 minutes par SEGMENT.
        duration_seconds = AudioService._duration(normalized, extension)
        duration_ms = math.ceil(duration_seconds * 1000)

        return (
            {
                "index": index,
                "duration_ms": duration_ms,
                "size_bytes": len(normalized),
                "mime_type": stored_mime,
                "extension": extension,
                "sha256": hashlib.sha256(normalized).hexdigest(),
            },
            normalized,
        )

    @classmethod
    def validate_manifest(
        cls,
        segments: list[dict[str, Any]],
        *,
        document_format: str | None = None,
    ) -> dict[str, Any]:
        """Valide l'ensemble des segments DEJA inspectes par le serveur.

        Les indices doivent etre consecutifs et commencer a zero. Cette
        methode ne prouve pas que les fragments ont ete enregistres sans
        interruption : la capture continue/reprise est du ressort du client.
        La facturation est basee sur la duree TOTALE, pas sur un arrondi par
        segment qui sur-facturerait systematiquement l'utilisateur.
        """
        selected_format = cls.validate_document_format(document_format)
        if not isinstance(segments, list) or not 1 <= len(segments) <= cls.MAX_SEGMENTS:
            raise AudioInvalid("Nombre de segments de cours invalide.")

        duration_ms = 0
        size_bytes = 0
        verified_segments = []
        for expected_index, part in enumerate(segments):
            if not isinstance(part, dict) or type(part.get("index")) is not int:
                raise AudioInvalid("Metadonnees de segment invalides.")
            if part["index"] != expected_index:
                raise AudioInvalid("Segments manquants, inverses ou dupliques.")
            part_ms = part.get("duration_ms")
            part_size = part.get("size_bytes")
            digest = part.get("sha256")
            if (
                type(part_ms) is not int or not 400 <= part_ms <= cls.MAX_SEGMENT_DURATION_SECONDS * 1000
                or type(part_size) is not int or not 0 < part_size <= cls.MAX_SEGMENT_BYTES
                or not isinstance(digest, str) or len(digest) != 64
                or any(char not in "0123456789abcdef" for char in digest)
            ):
                raise AudioInvalid("Duree, taille ou empreinte de segment invalide.")
            if part.get("mime_type") not in AudioService.MIME_EXTENSIONS:
                raise AudioInvalid("Format d'un segment de cours invalide.")
            if part.get("extension") != AudioService.MIME_EXTENSIONS[part["mime_type"]]:
                raise AudioInvalid("Extension et type audio incoherents.")

            duration_ms += part_ms
            size_bytes += part_size
            if duration_ms > cls.MAX_COURSE_DURATION_MS:
                raise AudioInvalid("Un cours ne peut pas depasser 4 heures.")
            if size_bytes > cls.MAX_COURSE_BYTES:
                raise AudioInvalid("Ce cours audio est trop volumineux : compression necessaire.")
            verified_segments.append(digest)

        # Un seul arrondi par cours. La facturation finale reste a integrer.
        billable_minutes = (duration_ms + 60_000 - 1) // 60_000
        return {
            "duration_ms": duration_ms,
            "duration_minutes": round(duration_ms / 60_000, 3),
            "billable_minutes": billable_minutes,
            "size_bytes": size_bytes,
            "segment_count": len(segments),
            "document_format": selected_format,
            "segment_sha256": verified_segments,
        }

