"""ORIA Cours -- orchestration serveur d'un cours audio de 4 h maximum.

Emplacement: Backend/app/services/course_service.py

Ce module NE cree PAS de route HTTP, de tables SQL, ni de bucket.
Il requiert un registre de traitement PERSISTANT (CourseJobStore) dont les
operations sont atomiques. Ne pas deployer avec un registre en memoire :
les checkpoints de generation et de facturation doivent survivre au reboot.

Parcours : enregistrement LOCAL -> upload segmente -> submit SQL -> devis
serveur -> accord explicite -> reservation AUDIO -> transcription interne
-> reglement AUDIO -> reservation REDACTION Luna -> redaction -> PDF/DOCX.

ATTENTION : le worker et les RPC Supabase doivent egalement etre adaptes
pour accepter une reservation de document apres la transcription. NE PAS
activer ce service isole avec l'ancien controle des deux reservations.

Code-First : chaque section du cours est redigee directement en HTML statique.
Un assembleur compose une source HTML unique, puis un renderiseur explicite
utilise le moteur ArtifactService d'ORIA (PDF/DOCX) et persiste separement la
transcription. Le worker doit injecter OriaCourseArtifactRenderer (ou un
renderiseur strictement compatible) ; aucun ancien export Markdown ne peut etre
utilise silencieusement. Adapter les RPC et le worker AVANT activation.
"""
from __future__ import annotations

from dataclasses import asdict, dataclass
from decimal import Decimal, InvalidOperation, ROUND_CEILING
from hashlib import sha256
from html import escape as html_escape
from html.parser import HTMLParser
import json
import math
import os
import re
from typing import Any, Callable, Mapping, Protocol, Sequence
from uuid import UUID, uuid5

from app.config.credit_costs import (
    ACCOUNTING_USD_XAF,
    COURSE_MAX_DURATION_MS,
    COURSE_TRANSCRIPTION_DEFAULT_MODEL,
    COURSE_TRANSCRIPTION_USD_PER_MINUTE,
    CreditAction,
    COURSE_MAX_OUTPUT_TOKENS,
    ORIA_CREDIT_VALUE_XAF,
    PACK_API_SAFETY_RESERVE_RATIO,
    normalize_course_document_format,
    validate_course_writing_model,
)
from app.services.token_billing_service import (
    CourseBillingService,
    CourseWritingStep,
)


class CourseError(RuntimeError):
    """Erreur métier sans données privées dans le message public."""


class CourseInvalid(CourseError):
    pass


class CourseUnavailable(CourseError):
    pass


class CourseInsufficientCredits(CourseError):
    def __init__(self) -> None:
        super().__init__("Crédits insuffisants pour cette action.")


class CourseNeedsReconciliation(CourseError):
    """Appel fournisseur ou règlement incertain : NE PAS refaire l'appel."""


# Cette autorisation vaut pour ORIA Cours UNIQUEMENT, jamais pour le Chat.
COURSE_PROVIDER_MODELS = {"luna": "gpt-6-luna"}
COURSE_WRITING_MODEL = "luna"

# Decoupage plus court, pour que les devis de cours ne supposent pas des
# transcriptions de 60 000 tokens par section. La vraie transcription est
# encore inconnue a l'etape devis : un depassement stoppe la redaction.
SECTION_MINUTES_FOR_QUOTE = 10
MAX_COURSE_SECTIONS = 120
SECTION_MAX_CHARS = 12_500
SECTION_CONTEXT_CHARS = 2_000
INPUT_TOKENS_QUOTE_PER_SECTION = 18_000
# Plafond commun au devis ET à l'appel OpenAI de chaque section Cours.
# Ne pas utiliser le plafond du Chat général (32 000 tokens).
OUTPUT_TOKENS_QUOTE_PER_SECTION = COURSE_MAX_OUTPUT_TOKENS
# Le moteur documentaire existant refuse toute source > 1 million de caracteres.
MAX_COURSE_DOCUMENT_HTML_CHARS = 1_000_000
MAX_COURSE_DOCUMENT_ELEMENTS = 6000


class CourseJobStore(Protocol):
    """Contrat du FUTUR repository SQL de progression.

    ensure_job : unique(user_id,course_id) et conflit si plan different ;
    update_reservation : mise a jour monotone / idempotente ;
    begin_call : insert UNIQUE(stage, index) et refuse un doublon 'started' ;
    finish_call : checkpoint durable avant de retourner au service ;
    get_call : resultat persiste de l'appel, sinon None ;
    set_settled : update monotone, jamais retour a 'reserved' ;
    finish : sauvegarde la sortie finale et marque complete ;
    flag_reconciliation : enregistre une intervention necessaire.
    Toutes les methodes exigent (user_id,course_id) pour l'isolation.
    """

    def ensure_job(self, *, user_id: str, course_id: str, plan: dict[str, Any]) -> dict[str, Any]: ...
    def get_job(self, *, user_id: str, course_id: str) -> dict[str, Any] | None: ...
    def update_reservation(self, *, user_id: str, course_id: str, stage: str, status: str) -> None: ...
    def begin_call(self, *, user_id: str, course_id: str, stage: str, index: int) -> None: ...
    def finish_call(self, *, user_id: str, course_id: str, stage: str, index: int, result: dict[str, Any]) -> None: ...
    def get_call(self, *, user_id: str, course_id: str, stage: str, index: int) -> dict[str, Any] | None: ...
    def set_settled(self, *, user_id: str, course_id: str, stage: str, credits: int, api_cost_xaf: str) -> None: ...
    def finish(self, *, user_id: str, course_id: str, result: dict[str, Any]) -> None: ...
    def flag_reconciliation(self, *, user_id: str, course_id: str, detail: str) -> None: ...


class CourseDocumentRenderer(Protocol):
    """Rendu Code-First explicite ; un ancien render_course(markdown=...) est refuse."""

    def render_course_code_first(
        self, *, user_id: str, course_id: str, title: str,
        document_format: str, html_source: str, transcript: str,
    ) -> Mapping[str, Any]: ...


class OriaCourseArtifactRenderer:
    """Adaptateur au moteur de fichiers ORIA, sans moteur documentaire concurrent.

    L'appelant injecte ArtifactService et supabase_artifact_repository deja
    utilises par ai.py. Les UUID de fichiers sont stables par cours afin de
    rendre les reprises detectables. Le stockage doit appliquer une contrainte
    d'unicite sur l'identifiant ; sans transaction couvrant Storage et SQL,
    un echec reseau incertain exige une reconciliation, jamais un nouvel UUID.
    Le worker doit conserver un lease exclusif sur (user_id, course_id).
    """

    def __init__(self, *, artifact_service: Any, artifact_repository: Any) -> None:
        self.artifacts = artifact_service
        self.repository = artifact_repository

    @staticmethod
    def _public_reference(record: Mapping[str, Any], expected_id: str) -> dict[str, Any]:
        record_id = str(record.get("id") or record.get("artifact_id") or "")
        if record_id != expected_id:
            raise CourseNeedsReconciliation("Reference de fichier enregistre incoherente.")
        return {
            "artifact_id": record_id,
            "filename": record.get("filename"),
            "extension": record.get("extension"),
            "mime_type": record.get("mime_type"),
        }

    def _existing(self, *, user_id: str, artifact_id: str,
                  course_id: str, kind: str, source_hash: str) -> dict[str, Any] | None:
        # La recherche est TOUJOURS bornee au proprietaire authentifie.
        record = self.repository.get_artifact(artifact_id=artifact_id, user_id=user_id)
        if record is None:
            return None
        meta = record.get("metadata") if isinstance(record, dict) else None
        if (not isinstance(meta, dict)
                or meta.get("source") != "oria-course"
                or meta.get("course_id") != course_id
                or meta.get("kind") != kind
                or meta.get("source_sha256") != source_hash):
            raise CourseNeedsReconciliation("Fichier preexistant a rapprocher avant reprise.")
        return self._public_reference(record, artifact_id)

    def _persist(self, *, user_id: str, course_id: str,
                 generated: Any, artifact_id: str, kind: str,
                 source_hash: str, model: str) -> dict[str, Any]:
        saved = self.repository.save_artifact(
            user_id=user_id, artifact_id=artifact_id,
            filename=generated.filename, extension=generated.extension,
            mime_type=generated.mime_type, category=generated.category,
            file_bytes=generated.data, size_bytes=generated.size_bytes,
            sha256=generated.sha256, conversation_id=None, model=model,
            source_message_id=None,
            metadata={**generated.metadata, "source": "oria-course",
                      "course_id": course_id, "kind": kind,
                      "source_sha256": source_hash},
        )
        if not isinstance(saved, dict):
            raise CourseNeedsReconciliation("Confirmation de sauvegarde documentaire invalide.")
        return self._public_reference(saved, artifact_id)

    def render_course_code_first(
        self, *, user_id: str, course_id: str, title: str,
        document_format: str, html_source: str, transcript: str,
    ) -> Mapping[str, Any]:
        uid, cid = _uid(user_id), _uid(course_id)
        fmt = normalize_course_document_format(document_format)
        if fmt not in {"pdf", "docx"}:
            raise CourseInvalid("Format ORIA Cours non pris en charge par le renderiseur.")
        if not isinstance(html_source, str) or not html_source.strip():
            raise CourseInvalid("Source documentaire Code-First vide.")
        if not isinstance(transcript, str) or not transcript.strip():
            raise CourseInvalid("Transcription originale absente.")
        if len(html_source) > MAX_COURSE_DOCUMENT_HTML_CHARS:
            raise CourseUnavailable("Source du cours trop longue pour un seul document.")

        doc_id = str(uuid5(UUID(cid), "oria-cours/document/v1"))
        txt_id = str(uuid5(UUID(cid), "oria-cours/transcription/v1"))
        doc_hash = sha256(html_source.encode("utf-8")).hexdigest()
        txt_hash = sha256(transcript.encode("utf-8")).hexdigest()
        document = self._existing(user_id=uid, artifact_id=doc_id,
                                  course_id=cid, kind="document", source_hash=doc_hash)
        transcription = self._existing(user_id=uid, artifact_id=txt_id,
                                       course_id=cid, kind="transcript", source_hash=txt_hash)

        # Une compilation seulement lorsque le document n'est pas deja persiste.
        # source_id designe le meme HTML statique que pour les creations ORIA.
        if document is None:
            payload = {
                "schema_version": "oria.artifact.v1",
                "sources": [{"id": "cours", "kind": "html", "content": html_source}],
                "artifacts": [{
                    "format": fmt,
                    "filename": f"oria-cours-{UUID(cid).hex[:16]}.{fmt}",
                    "source_id": "cours", "native_data": None,
                }],
            }
            generated = self.artifacts.create_from_payload(payload, metadata={
                "source": "oria-course", "course_id": cid, "kind": "document",
                "source_sha256": doc_hash,
            })
            if len(generated) != 1 or generated[0].extension != fmt:
                raise CourseUnavailable("Compilation du document ORIA Cours incomplete.")
            document = self._persist(user_id=uid, course_id=cid,
                                     generated=generated[0], artifact_id=doc_id,
                                     kind="document", source_hash=doc_hash,
                                     model="gpt-6-luna")

        if transcription is None:
            generated_txt = self.artifacts.create(
                file_type="txt", content=transcript,
                filename=f"oria-cours-transcription-{UUID(cid).hex[:16]}.txt",
                metadata={"source": "oria-course", "course_id": cid,
                          "kind": "transcript", "source_sha256": txt_hash},
            )
            transcription = self._persist(user_id=uid, course_id=cid,
                                          generated=generated_txt, artifact_id=txt_id,
                                          kind="transcript", source_hash=txt_hash,
                                          model="gpt-4o-mini-transcribe")
        # Ne pas persister d'URL signee ephemere dans la sortie du job SQL.
        # /ai/artifacts/{artifact_id} emettra une URL neuve a chaque consultation.
        return {"document": document, "transcription": transcription}


@dataclass(frozen=True)
class CoursePlan:
    user_id: str
    course_id: str
    pack_id: str
    pack_activated_at: str
    writing_model: str
    provider_model: str
    document_format: str
    title: str
    duration_ms: int
    segment_count: int
    segment_manifest_sha256: str
    max_writing_sections: int
    transcription_reservation_credits: int
    transcription_reservation_api_xaf: str
    document_reservation_credits: int
    document_reservation_api_xaf: str
    estimated_total_credits: int
    transcription_reservation_id: str
    document_reservation_id: str

    def public_quote(self) -> dict[str, Any]:
        """Aucun identifiant de modele interne / cout fournisseur expose."""
        return {
            "course_id": self.course_id,
            "document_format": self.document_format,
            "writing_model": self.writing_model,
            "duration_ms": self.duration_ms,
            "segments": self.segment_count,
            "estimated_total_credits": self.estimated_total_credits,
            # Montant maximal immobilise a la fois, et non somme des etapes.
            "maximum_reserved_credits": max(
                self.transcription_reservation_credits,
                self.document_reservation_credits,
            ),
            "transcription_reservation_credits": self.transcription_reservation_credits,
            "document_reservation_credits": self.document_reservation_credits,
            "requires_confirmation": True,
            "note": (
                "Devis initial a deux etapes : transcription puis redaction Luna. "
                "Les reservations ne sont pas simultanees. "
                "Un supplement exige un nouvel accord."
            ),
        }


def _decimal(value: Any, label: str, *, allow_zero: bool = False) -> Decimal:
    try:
        result = Decimal(str(value))
    except (TypeError, ValueError, InvalidOperation) as error:
        raise CourseInvalid(f"Valeur non valide : {label}.") from error
    if not result.is_finite() or (result < 0 if allow_zero else result <= 0):
        raise CourseInvalid(f"Valeur non valide : {label}.")
    return result


def _credits_for_xaf(xaf: Decimal) -> int:
    unit = _decimal(ORIA_CREDIT_VALUE_XAF, "valeur_credit")
    return max(1, int((xaf / unit).to_integral_value(rounding=ROUND_CEILING)))


def _reserve_xaf(xaf: Decimal) -> Decimal:
    ratio = _decimal(PACK_API_SAFETY_RESERVE_RATIO, "marge", allow_zero=True)
    if ratio > 1:
        raise CourseInvalid("Marge de securite invalide.")
    return xaf * (1 + ratio)


def _uid(value: str) -> str:
    try:
        return str(UUID(str(value)))
    except (ValueError, AttributeError, TypeError) as error:
        raise CourseInvalid("Identifiant UUID invalide.") from error


def _deterministic_reference(course_id: str, stage: str) -> str:
    return str(uuid5(UUID(_uid(course_id)), f"oria-cours/{stage}/v1"))


def _validated_manifest(segments: Sequence[dict[str, Any]], fmt: str) -> dict[str, Any]:
    from app.services.audio_service import CourseAudioPolicy

    return CourseAudioPolicy.validate_manifest(
        [{
            "index": s["segment_index"],
            "duration_ms": s["duration_ms"],
            "size_bytes": s["size_bytes"],
            "mime_type": s["mime_type"],
            "extension": str(s["storage_path"]).rsplit(".", 1)[-1],
            "sha256": s["sha256"],
        } for s in segments],
        document_format=fmt,
    )


def _fingerprint(segments: Sequence[dict[str, Any]]) -> str:
    stable = [{
        "i": s["segment_index"], "ms": s["duration_ms"],
        "bytes": s["size_bytes"], "sha": s["sha256"],
    } for s in segments]
    return sha256(json.dumps(stable, sort_keys=True, separators=(",", ":")).encode()).hexdigest()


def _split_sections(transcripts: Sequence[str]) -> list[str]:
    """Conserve l'ordre chronologique ; coupe les longues transcriptions aux mots."""
    sections: list[str] = []
    current = ""
    for index, transcript in enumerate(transcripts, start=1):
        if not isinstance(transcript, str) or not transcript.strip():
            raise CourseInvalid(f"Transcription du segment {index} absente.")
        text = f"[Segment audio {index}]\n{transcript.strip()}"
        while text:
            room = SECTION_MAX_CHARS - len(current) - (2 if current else 0)
            if room < 2000:
                sections.append(current)
                current = ""
                room = SECTION_MAX_CHARS
            if len(text) <= room:
                current += ("\n\n" if current else "") + text
                break
            cut = text.rfind(" ", max(0, room - 2500), room)
            if cut <= 0:
                cut = room
            current += ("\n\n" if current else "") + text[:cut]
            sections.append(current)
            current = ""
            text = text[cut:].lstrip()
    if current:
        sections.append(current)
    return sections


class _CourseContextText(HTMLParser):
    """Extrait le texte lisible des sections precedentes sans le HTML brut."""

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.text: list[str] = []

    def handle_data(self, data: str) -> None:
        if data.strip():
            self.text.append(data.strip())

    def handle_starttag(self, tag: str, attrs: Any) -> None:
        if tag in {"h2", "h3", "h4", "p", "li", "tr", "br"}:
            self.text.append("\n")


def _course_previous_context(results: Sequence[dict[str, Any]]) -> str:
    """Le contexte est une aide de continuite, jamais une nouvelle source."""
    excerpts: list[str] = []
    for item in results[-4:]:
        parser = _CourseContextText()
        parser.feed(str(item.get("html_fragment") or ""))
        parser.close()
        visible = " ".join(" ".join(parser.text).split())
        if visible:
            excerpts.append(visible[-2000:])
    return "\n\n".join(excerpts)[-SECTION_CONTEXT_CHARS:]


def _assemble_course_html(*, title: str, fragments: Sequence[str]) -> str:
    """Assemble les sources deja validees, sans nouvelle generation IA.

    @page et les styles s'appliquent au PDF WeasyPrint ; le moteur DOCX
    importe lui-meme les blocs HTML et conserve sa typographie native.
    Les limites correspondent aux controles de ArtifactService.
    """
    if not isinstance(title, str) or not title.strip():
        raise CourseInvalid("Titre de cours manquant.")
    if not fragments or any(not isinstance(f, str) or not f.strip() for f in fragments):
        raise CourseInvalid("Une ou plusieurs sections Code-First manquent.")
    css = """
@page { size: A4; margin: 19mm 18mm 20mm; }
body { font-family: 'DejaVu Sans', 'Liberation Sans', Arial, sans-serif;
       font-size: 10.5pt; line-height: 1.52; color: #1b2638; }
main { max-width: 100%; }
h1 { font-size: 23pt; color: #152e57; line-height: 1.18;
     margin: 0 0 10mm; padding-bottom: 3mm; border-bottom: 2px solid #285c9c; }
h2 { font-size: 15pt; color: #204778; margin: 8mm 0 3mm; }
h3 { font-size: 12pt; color: #204778; margin: 6mm 0 2mm; }
h4 { font-size: 10.8pt; color: #284263; margin: 4mm 0 2mm; }
h1,h2,h3,h4 { break-after: avoid; page-break-after: avoid; }
p,li { orphans: 3; widows: 3; }
p { margin: 0 0 3mm; }
ul,ol { margin: 1mm 0 4mm; padding-left: 7mm; }
li { margin-bottom: 1.2mm; }
table { width: 100%; border-collapse: collapse; margin: 3mm 0 5mm;
        font-size: 9.2pt; break-inside: avoid; }
th,td { border: 1px solid #d0d8e3; padding: 2mm 2.5mm;
        text-align: left; vertical-align: top; overflow-wrap: anywhere; }
th { color: #182b49; background: #e9eff7; }
tr { break-inside: avoid; page-break-inside: avoid; }
blockquote { margin: 3mm 0; padding-left: 4mm; border-left: 3px solid #a2b5d0; }
.oria-course-section { margin-bottom: 6mm; }
.oria-course-definition,.oria-course-example,.oria-course-exercise,
.oria-course-complement,.oria-course-warning { padding: 3mm 4mm;
    margin: 3mm 0 4mm; border-left: 3px solid #8ba5c6; background: #f5f8fc; }
.oria-course-complement { border-color: #7e9b6e; background: #f4f8f0; }
.oria-course-warning { border-color: #ce9853; background: #fbf7ed; }
.oria-course-equation { font-family: 'DejaVu Sans', 'Liberation Sans', serif;
    font-size: 11pt; line-height: 1.7; text-align: center;
    margin: 3mm 0; overflow-wrap: anywhere; }
""".strip()
    body = "\n".join(fragments)
    source = (
        '<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8">'
        '<title>ORIA Cours</title><style>' + css + '</style></head>'
        '<body><main><h1>' + html_escape(title.strip(), quote=True) + '</h1>\n'
        + body + '\n</main></body></html>'
    )
    if len(source) > MAX_COURSE_DOCUMENT_HTML_CHARS:
        raise CourseUnavailable("Cours trop volumineux pour un document unique.")
    if len(re.findall(r"<\s*[a-zA-Z][a-zA-Z0-9]*\b", source)) > MAX_COURSE_DOCUMENT_ELEMENTS:
        raise CourseUnavailable("Cours trop complexe pour le moteur documentaire.")
    return source


class CourseService:
    """Moteur synchrone adapte a un worker serveur durable, PAS a une requete HTTP.

    L'execution doit etre protegee par un lease/claim SQL exclusif par cours
    (une seule invocation de run() a la fois). Ce lease appartient a la couche
    d'ordonnancement et n'est pas simule ici.
    """

    def __init__(
        self,
        *,
        course_repository: Any,
        job_store: CourseJobStore,
        credit_repository: Any,
        openai_service: Any,
        renderer: CourseDocumentRenderer | None = None,
        model_resolver: Callable[[str], str] | None = None,
    ) -> None:
        self.courses = course_repository
        self.jobs = job_store
        self.credits = credit_repository
        self.ai = openai_service
        self.renderer = renderer
        self.model_resolver = model_resolver or COURSE_PROVIDER_MODELS.__getitem__

    @staticmethod
    def _require_credits_only() -> None:
        """Empêche un lancement accidentel avec l'ancien plafond API fixe.

        Le flag 0 signifie facturation par crédits via les RPC historiques.
        Ce garde-fou ne remplace pas les protections du dispatch et du SQL.
        """
        if os.getenv("ORIA_ENFORCE_PACK_API_BUDGET", "0") != "0":
            raise CourseUnavailable(
                "Ancien plafond API par pack incompatible avec ORIA Cours : "
                "utiliser le circuit prépayé par crédits uniquement."
            )

    def prepare_quote(
        self, *, user_id: str, course_id: str, writing_model: str = COURSE_WRITING_MODEL,
    ) -> CoursePlan:
        uid, cid = _uid(user_id), _uid(course_id)
        course = self.courses.get_course(user_id=uid, course_id=cid)
        if not isinstance(course, dict) or course.get("status") != "queued":
            raise CourseInvalid("Le cours doit etre entierement envoye et confirme avant le devis.")
        title = str(course.get("title") or "Cours sans titre").strip()
        fmt = normalize_course_document_format(course.get("document_format"))
        segments = self.courses.list_segments(user_id=uid, course_id=cid)
        manifest = _validated_manifest(segments, fmt)
        duration_ms = manifest["duration_ms"]
        if duration_ms > COURSE_MAX_DURATION_MS:
            raise CourseInvalid("Duree maximale depassee : quatre heures.")

        wallet = self.credits.get_wallet(uid)
        if wallet is None or not wallet.is_pack_active:
            raise CourseInsufficientCredits()
        pack_id = str(wallet.pack_id or "")
        if writing_model != COURSE_WRITING_MODEL:
            raise CourseInvalid("ORIA Cours utilise exclusivement GPT-6 Luna.")
        # Cet appel depend du credit_costs.py version Luna-pour-tous-les-packs.
        # Ne pas passer en production avant mise a jour de cette configuration.
        selected = validate_course_writing_model(pack_id, COURSE_WRITING_MODEL)
        provider_model = str(self.model_resolver(selected))
        if not provider_model or provider_model == COURSE_TRANSCRIPTION_DEFAULT_MODEL:
            raise CourseUnavailable("Le modele de redaction ne peut pas etre utilise.")
        if wallet.pack_activated_at is None:
            raise CourseUnavailable("Date d'activation du pack manquante.")

        # Le devis initial peut etre majorant. Un dépassement des sections
        # anticipees suspend la redaction au lieu d'appeler le fournisseur.
        sections = max(
            1,
            math.ceil(duration_ms / (SECTION_MINUTES_FOR_QUOTE * 60_000)),
        )
        if sections > MAX_COURSE_SECTIONS:
            raise CourseInvalid("Nombre de sections trop important.")
        writing_steps = [CourseWritingStep(
            estimated_input_tokens=INPUT_TOKENS_QUOTE_PER_SECTION,
            max_output_tokens=OUTPUT_TOKENS_QUOTE_PER_SECTION,
        ) for _ in range(sections)]
        document_estimate = CourseBillingService.estimate_document(
            pack_id=pack_id, writing_model=selected, steps=writing_steps,
        )
        quote = CourseBillingService.quote_course(
            pack_id=pack_id, writing_model=selected, duration_ms=duration_ms,
            steps=writing_steps, document_format=fmt,
        )

        # Le devis audio couvre aussi le cas de la facturation par fragment
        # arrondi a la minute, afin de ne pas sous-provisionner 120 appels.
        rate = _decimal(COURSE_TRANSCRIPTION_USD_PER_MINUTE[COURSE_TRANSCRIPTION_DEFAULT_MODEL], "tarif_audio")
        segment_minutes = sum((s["duration_ms"] + 59_999) // 60_000 for s in segments)
        audio_provider_xaf = Decimal(segment_minutes) * rate * _decimal(ACCOUNTING_USD_XAF, "usd_xaf")
        audio_reserved_xaf = _reserve_xaf(audio_provider_xaf)
        audio_reserved_credits = max(quote.transcription_reservation_credits,
                                     _credits_for_xaf(audio_reserved_xaf))

        doc_reserved_xaf = _reserve_xaf(
            document_estimate.document_estimated_cost_usd
            * _decimal(ACCOUNTING_USD_XAF, "usd_xaf")
        )
        doc_reserved_credits = max(quote.document_reservation_credits,
                                   _credits_for_xaf(doc_reserved_xaf))
        return CoursePlan(
            user_id=uid, course_id=cid, pack_id=pack_id,
            pack_activated_at=wallet.pack_activated_at.isoformat(),
            writing_model=selected, provider_model=provider_model,
            document_format=fmt, title=title, duration_ms=duration_ms,
            segment_count=len(segments), segment_manifest_sha256=_fingerprint(segments),
            max_writing_sections=sections,
            transcription_reservation_credits=audio_reserved_credits,
            transcription_reservation_api_xaf=str(audio_reserved_xaf),
            document_reservation_credits=doc_reserved_credits,
            document_reservation_api_xaf=str(doc_reserved_xaf),
            estimated_total_credits=quote.total_estimated_credits,
            transcription_reservation_id=_deterministic_reference(cid, "transcription"),
            document_reservation_id=_deterministic_reference(cid, "document"),
        )

    @staticmethod
    def _reserve_stage(
        *, uid: str, cid: str, plan: CoursePlan, stage: str,
        jobs: CourseJobStore, credits: Any,
    ) -> dict[str, Any]:
        """Une etape a la fois. La RPC reserve les credits atomiquement.

        `reserved` et `settled` sont des etats monotones. Une reponse reseau
        incertaine impose un rapprochement ; ne jamais faire une deuxieme
        reservation aveugle avec un autre identifiant.
        """
        if stage not in ("transcription", "document"):
            raise CourseInvalid("Etape de reservation inconnue.")
        state = jobs.get_job(user_id=uid, course_id=cid)
        if state is None or state.get("plan") != asdict(plan):
            raise CourseNeedsReconciliation("Plan confirme absent ou modifie.")
        status = state.get(f"{stage}_reservation_status")
        if status in ("reserved", "settled"):
            return state
        if status not in (None, "", "pending"):
            raise CourseNeedsReconciliation("Etat financier de l'etape inconnu.")
        if stage == "document" and state.get("transcription_reservation_status") != "settled":
            raise CourseUnavailable("Transcription non reglee avant redaction.")

        wallet = credits.get_wallet(uid)
        amount = getattr(plan, f"{stage}_reservation_credits")
        if (wallet is None or not wallet.is_pack_active
                or type(wallet.balance) is not int or wallet.balance < amount):
            raise CourseInsufficientCredits()
        action = (CreditAction.COURSE_TRANSCRIPTION if stage == "transcription"
                  else CreditAction.COURSE_DOCUMENT_GENERATION)
        reference = getattr(plan, f"{stage}_reservation_id")
        cost_xaf = getattr(plan, f"{stage}_reservation_api_xaf")
        try:
            credits.reserve_credits(
                uid, amount, action, reference,
                ttl_seconds=21600, api_reservation_xaf=cost_xaf,
            )
        except Exception as exc:
            # Une exception SQL/HTTP peut signifier que le debit est deja
            # persiste : ne pas la considerer comme un simple refus de solde.
            jobs.flag_reconciliation(
                user_id=uid, course_id=cid,
                detail=f"Reservation {stage} non confirmee",
            )
            raise CourseNeedsReconciliation(
                "Reservation non confirmee : verification necessaire."
            ) from exc
        try:
            jobs.update_reservation(
                user_id=uid, course_id=cid, stage=stage, status="reserved",
            )
        except Exception as exc:
            jobs.flag_reconciliation(
                user_id=uid, course_id=cid,
                detail=f"Confirmation SQL de reservation {stage} incertaine",
            )
            raise CourseNeedsReconciliation(
                "Confirmation de reservation non certaine."
            ) from exc
        return jobs.get_job(user_id=uid, course_id=cid) or state

    def confirm_and_reserve(self, *, plan: CoursePlan, approved: bool) -> dict[str, Any]:
        """Au depart, immobilise UNIQUEMENT le devis de transcription.

        L'utilisateur accepte le devis global presentant aussi la redaction,
        mais celle-ci sera reservee seulement APRES le reglement de l'audio.
        """
        if not approved:
            raise CourseInvalid("Confirmation explicite du devis necessaire.")
        self._require_credits_only()
        fresh = self.prepare_quote(
            user_id=plan.user_id, course_id=plan.course_id,
            writing_model=plan.writing_model,
        )
        if fresh != plan:
            raise CourseInvalid("Le devis a change ; nouvelle confirmation requise.")
        existing = self.jobs.get_job(user_id=plan.user_id, course_id=plan.course_id)
        if existing is not None and existing.get("plan") != asdict(plan):
            raise CourseInvalid("Conflit de devis pour ce cours.")
        if existing and existing.get("status") == "completed":
            return existing
        # Verifier sans debit que la premiere operation est finançable.
        wallet = self.credits.get_wallet(plan.user_id)
        if (wallet is None or not wallet.is_pack_active
                or type(wallet.balance) is not int):
            raise CourseInsufficientCredits()
        if (not existing or existing.get("transcription_reservation_status")
                not in ("reserved", "settled")) and (
                wallet.balance < plan.transcription_reservation_credits):
            raise CourseInsufficientCredits()
        job = existing or self.jobs.ensure_job(
            user_id=plan.user_id, course_id=plan.course_id, plan=asdict(plan),
        )
        if job.get("status") == "completed":
            return job
        return self._reserve_stage(
            uid=plan.user_id, cid=plan.course_id, plan=plan,
            stage="transcription", jobs=self.jobs, credits=self.credits,
        )

    def _load_plan(self, uid: str, cid: str, *, stage: str = "transcription") -> CoursePlan:
        state = self.jobs.get_job(user_id=uid, course_id=cid)
        if not state or not isinstance(state.get("plan"), dict):
            raise CourseUnavailable("Cours non confirme ou suivi persistant absent.")
        plan = CoursePlan(**state["plan"])
        if plan.user_id != uid or plan.course_id != cid:
            raise CourseUnavailable("Plan de cours incoherent.")
        if plan.writing_model != COURSE_WRITING_MODEL or plan.provider_model != COURSE_PROVIDER_MODELS[COURSE_WRITING_MODEL]:
            raise CourseUnavailable("Ancien devis multi-modeles incompatible.")
        if state.get("transcription_reservation_status") not in ("reserved", "settled"):
            raise CourseUnavailable("Reservation de transcription non confirmee.")
        if stage == "document" and (
                state.get("transcription_reservation_status") != "settled"
                or state.get("document_reservation_status") not in ("reserved", "settled")):
            raise CourseUnavailable("Reservation de redaction non confirmee.")
        return plan

    def _step_result(self, *, uid: str, cid: str, stage: str, index: int,
                     invoke: Callable[[], dict[str, Any]]) -> dict[str, Any]:
        prior = self.jobs.get_call(user_id=uid, course_id=cid, stage=stage, index=index)
        if prior is not None:
            return prior
        # begin_call DOIT lever une erreur pour tout appel deja 'started'.
        # Une tentative interrompue ne peut pas etre relancee aveuglement.
        try:
            self.jobs.begin_call(user_id=uid, course_id=cid, stage=stage, index=index)
        except Exception as exc:
            raise CourseNeedsReconciliation(
                "Appel deja commence, verification necessaire avant reprise."
            ) from exc
        try:
            result = invoke()
            if not isinstance(result, dict):
                raise CourseInvalid("Reponse fournisseur non exploitable.")
            self.jobs.finish_call(user_id=uid, course_id=cid, stage=stage,
                                  index=index, result=result)
            return result
        except Exception as exc:
            self.jobs.flag_reconciliation(
                user_id=uid, course_id=cid,
                detail=f"Appel fournisseur {stage}/{index} incertain",
            )
            raise CourseNeedsReconciliation(
                "Traitement interrompu : verification necessaire avant reprise."
            ) from exc

    def transcribe_submitted_course(self, *, user_id: str, course_id: str) -> dict[str, Any]:
        uid, cid = _uid(user_id), _uid(course_id)
        plan = self._load_plan(uid, cid, stage="transcription")
        segments = self.courses.list_segments(user_id=uid, course_id=cid)
        if _fingerprint(segments) != plan.segment_manifest_sha256:
            raise CourseNeedsReconciliation("Le manifeste des segments a change.")
        results: list[dict[str, Any]] = []
        for index, segment in enumerate(segments):
            def perform(seg: dict[str, Any] = segment, i: int = index) -> dict[str, Any]:
                content = self.courses.download_segment(
                    user_id=uid, course_id=cid, index=i,
                )
                filename = str(seg["storage_path"]).rsplit("/", 1)[-1]
                result = self.ai.transcribe_course_segment(
                    data=content, filename=filename, mime_type=seg["mime_type"],
                )
                text = str(result.get("text") or "").strip()
                if not text:
                    raise CourseInvalid("Transcription audio vide.")
                if len(text) > 100_000:
                    raise CourseInvalid("Transcription du segment trop longue.")
                return {"text": text, "usage": result.get("usage"),
                        "duration_ms": seg["duration_ms"]}
            results.append(self._step_result(
                uid=uid, cid=cid, stage="transcription", index=index, invoke=perform,
            ))
        transcription = "\n\n".join(item["text"] for item in results)
        if not transcription.strip():
            raise CourseNeedsReconciliation("Transcription totale vide.")
        # La plupart des SDK ne renvoient pas d'usage audio en dollars. Le
        # cout budgete est une ESTIMATION sur la duree serveur, non une facture.
        unit = _decimal(COURSE_TRANSCRIPTION_USD_PER_MINUTE[COURSE_TRANSCRIPTION_DEFAULT_MODEL], "tarif_audio")
        minutes = sum(Decimal(s["duration_ms"]) / Decimal(60_000) for s in segments)
        xaf = minutes * unit * _decimal(ACCOUNTING_USD_XAF, "usd_xaf")
        credits = _credits_for_xaf(xaf)
        state = self.jobs.get_job(user_id=uid, course_id=cid) or {}
        if state.get("transcription_reservation_status") != "settled":
            self.credits.settle_credit_reservation(
                uid, plan.transcription_reservation_id, credits,
                actual_api_cost_xaf=str(xaf),
            )
            self.jobs.set_settled(user_id=uid, course_id=cid, stage="transcription",
                                  credits=credits, api_cost_xaf=str(xaf))
        return {"course_id": cid, "segments": len(results),
                "transcript": transcription, "transcription_credits": credits}

    def write_course(self, *, user_id: str, course_id: str) -> dict[str, Any]:
        uid, cid = _uid(user_id), _uid(course_id)
        plan = self._load_plan(uid, cid, stage="transcription")
        state = self.jobs.get_job(user_id=uid, course_id=cid) or {}
        if state.get("transcription_reservation_status") != "settled":
            raise CourseUnavailable("Transcription non terminee ou non reglee.")
        if state.get("status") == "completed" and isinstance(state.get("output"), dict):
            return dict(state["output"])
        # Aucun debit IA si le worker utilise encore l'ancien renderer Markdown,
        # ou si OpenAIService n'a pas ete mis a jour pour html_fragment.
        if self.renderer is None or not callable(
            getattr(self.renderer, "render_course_code_first", None)
        ):
            raise CourseUnavailable("Renderiseur Code-First ORIA Cours non configure.")
        validate_html = getattr(self.ai, "_validate_course_html_fragment", None)
        if not callable(validate_html):
            raise CourseUnavailable("OpenAIService Code-First ORIA Cours non deploye.")
        transcripts = []
        for i in range(plan.segment_count):
            saved = self.jobs.get_call(user_id=uid, course_id=cid,
                                       stage="transcription", index=i)
            if saved is None:
                raise CourseUnavailable("Un segment transcrit manque.")
            transcripts.append(saved["text"])
        parts = _split_sections(transcripts)
        if len(parts) > plan.max_writing_sections:
            # Aucun appel supplementaire en l'absence de devis valide.
            raise CourseUnavailable("Transcription plus longue que prevu : nouveau devis necessaire.")
        # La provision audio est deja reglee. Ne reserver la redaction qu'ici.
        # Avec Luna le montant reste celui du devis accepte par l'utilisateur.
        self._reserve_stage(
            uid=uid, cid=cid, plan=plan, stage="document",
            jobs=self.jobs, credits=self.credits,
        )
        self._load_plan(uid, cid, stage="document")
        results: list[dict[str, Any]] = []
        for index, chunk in enumerate(parts):
            # Les consommations reelles constatees sur les sections precedentes
            # ne doivent jamais permettre un appel de plus que le devis accepte.
            if results:
                spent = CourseBillingService.calculate_document_actual(
                    pack_id=plan.pack_id, writing_model=plan.writing_model,
                    usages=[entry["usage"] for entry in results],
                )
                prior = self.jobs.get_call(
                    user_id=uid, course_id=cid, stage="document", index=index,
                )
                next_quote = CourseBillingService.estimate_document(
                    pack_id=plan.pack_id, writing_model=plan.writing_model,
                    steps=[CourseWritingStep(
                        estimated_input_tokens=INPUT_TOKENS_QUOTE_PER_SECTION,
                        max_output_tokens=OUTPUT_TOKENS_QUOTE_PER_SECTION,
                    )],
                )
                if (prior is None and spent.credits + next_quote.reservation_credits
                        > plan.document_reservation_credits):
                    raise CourseUnavailable(
                        "Budget de redaction autorise atteint : nouvelle approbation requise."
                    )
            context = _course_previous_context(results)
            def perform(part: str = chunk, i: int = index, ctx: str = context) -> dict[str, Any]:
                answer = self.ai.compose_course_section(
                    model=plan.provider_model, transcript=part, section_index=i + 1,
                    total_sections=len(parts), previous_context=ctx,
                    output_format="html_fragment",
                )
                if not isinstance(answer, dict) or not isinstance(answer.get("usage"), dict):
                    raise CourseInvalid("Usage de redaction absent.")
                # Checkpoint du RESULTAT et de l'USAGE, meme si la sortie est
                # incomplete : aucune relance aveugle d'un appel deja facture.
                return {
                    "output_format": str(answer.get("output_format") or ""),
                    "html_fragment": str(answer.get("html_fragment") or ""),
                    "usage": answer["usage"],
                    "complete": bool(answer.get("complete")),
                    "incomplete_reason": str(answer.get("incomplete_reason") or ""),
                }
            saved = self._step_result(uid=uid, cid=cid, stage="document",
                                      index=index, invoke=perform)
            results.append(saved)
            if (saved.get("output_format") != "html_fragment"
                    or not saved.get("complete")
                    or not str(saved.get("html_fragment") or "").strip()):
                self.jobs.flag_reconciliation(user_id=uid, course_id=cid,
                                              detail=f"Section Code-First {index+1} absente ou incomplete")
                raise CourseNeedsReconciliation("Section Code-First incomplete : rapprochement necessaire.")
            try:
                validate_html(saved["html_fragment"])
            except ValueError as exc:
                self.jobs.flag_reconciliation(user_id=uid, course_id=cid,
                                              detail=f"Section Code-First {index+1} invalide")
                raise CourseNeedsReconciliation("Section documentaire invalide : rapprochement necessaire.") from exc
        # Verifier le document entier AVANT le reglement definitif des credits.
        # Si le document depasse les limites de compilation, aucun fichier
        # tronque n'est produit et l'usage deja consomme reste rapproche.
        html_source = _assemble_course_html(
            title=plan.title,
            fragments=[item["html_fragment"] for item in results],
        )
        actual = CourseBillingService.calculate_document_actual(
            pack_id=plan.pack_id, writing_model=plan.writing_model,
            usages=[part["usage"] for part in results],
        )
        if actual.credits > plan.document_reservation_credits:
            self.jobs.flag_reconciliation(
                user_id=uid, course_id=cid,
                detail="Cout final de redaction superieur au devis confirme",
            )
            raise CourseNeedsReconciliation("Cout de redaction a rapprocher.")
        state = self.jobs.get_job(user_id=uid, course_id=cid) or {}
        if state.get("document_reservation_status") != "settled":
            self.credits.settle_credit_reservation(
                uid, plan.document_reservation_id, actual.credits,
                actual_api_cost_xaf=str(actual.total_cost_xaf),
            )
            self.jobs.set_settled(user_id=uid, course_id=cid,
                                  stage="document", credits=actual.credits,
                                  api_cost_xaf=str(actual.total_cost_xaf))
        # Aucun Markdown intermediaire : composition deja faite et validee.
        transcript = "\n\n".join(transcripts)
        try:
            artifact = self.renderer.render_course_code_first(
                user_id=uid, course_id=cid, title=plan.title,
                document_format=plan.document_format,
                html_source=html_source, transcript=transcript,
            )
        except Exception as exc:
            # Si un stockage repond de maniere incertaine, les artefacts ont
            # peut-etre deja ete sauves. Les IDs stables permettent l'enquete.
            self.jobs.flag_reconciliation(user_id=uid, course_id=cid,
                                          detail="Compilation ou sauvegarde Code-First non confirmee")
            raise CourseNeedsReconciliation(
                "Document non confirme : verification du stockage necessaire."
            ) from exc
        if not isinstance(artifact, Mapping):
            raise CourseNeedsReconciliation("Reponse du renderiseur documentaire invalide.")
        for key in ("document", "transcription"):
            entry = artifact.get(key)
            if not isinstance(entry, Mapping) or not entry.get("artifact_id"):
                self.jobs.flag_reconciliation(user_id=uid, course_id=cid,
                                              detail=f"Fichier {key} non confirme")
                raise CourseNeedsReconciliation("Livraison documentaire incomplete.")
        completed = {
            "course_id": cid, "format": plan.document_format,
            "output_format": "html_code_first",
            "document_source_sha256": sha256(html_source.encode("utf-8")).hexdigest(),
            "artifact": dict(artifact),
            "writing_credits": actual.credits,
        }
        self.jobs.finish(user_id=uid, course_id=cid, result=completed)
        return completed
