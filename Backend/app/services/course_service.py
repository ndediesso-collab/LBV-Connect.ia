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

Le traitement ne genere pas encore le PDF/DOCX lui-meme. Le texte assemble,
la transcription et le format choisi sont transmis a un renderiseur injecte.
"""
from __future__ import annotations

from dataclasses import asdict, dataclass
from decimal import Decimal, InvalidOperation, ROUND_CEILING
from hashlib import sha256
import json
import math
import os
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
    """A implementer dans la couche artifact (PDF/DOCX prives)."""

    def render_course(
        self, *, user_id: str, course_id: str, title: str,
        document_format: str, markdown: str, transcript: str,
    ) -> Mapping[str, Any]: ...


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
            context = "\n\n".join(item.get("message", "")[-2000:] for item in results[-4:])
            context = context[-SECTION_CONTEXT_CHARS:]
            def perform(part: str = chunk, i: int = index, ctx: str = context) -> dict[str, Any]:
                answer = self.ai.compose_course_section(
                    model=plan.provider_model, transcript=part, section_index=i + 1,
                    total_sections=len(parts), previous_context=ctx,
                )
                if not isinstance(answer, dict) or not isinstance(answer.get("usage"), dict):
                    raise CourseInvalid("Usage de redaction absent.")
                # Une reponse incomplete a des tokens facturables : les
                # conserver et bloquer la publication jusqu'a reconciliation.
                return {"message": str(answer.get("message") or ""),
                        "usage": answer["usage"], "complete": bool(answer.get("complete"))}
            saved = self._step_result(uid=uid, cid=cid, stage="document",
                                      index=index, invoke=perform)
            results.append(saved)
            if not saved.get("complete") or not saved.get("message", "").strip():
                self.jobs.flag_reconciliation(user_id=uid, course_id=cid,
                                              detail=f"Section {index+1} incomplete")
                raise CourseNeedsReconciliation("Section incomplete : usage a reconcilier.")
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
        markdown = f"# {plan.title}\n\n" + "\n\n".join(
            f"## Partie {i + 1}\n\n{part['message']}"
            for i, part in enumerate(results)
        )
        transcript = "\n\n".join(transcripts)
        artifact: Mapping[str, Any] | None = None
        if self.renderer is not None:
            artifact = self.renderer.render_course(
                user_id=uid, course_id=cid, title=plan.title,
                document_format=plan.document_format,
                markdown=markdown, transcript=transcript,
            )
        completed = {"course_id": cid, "format": plan.document_format,
                     "markdown": markdown, "transcript": transcript,
                     "artifact": dict(artifact) if artifact is not None else None,
                     "writing_credits": actual.credits}
        # Sans renderer, le cours reste preparé ; l'artefact n'est pas pret.
        if artifact is not None:
            self.jobs.finish(user_id=uid, course_id=cid, result=completed)
        return completed
