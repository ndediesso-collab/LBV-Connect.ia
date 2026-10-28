"""Worker ORIA Cours : orchestration sous bail PostgreSQL.

Destination : Backend/app/services/course_worker.py

Une instance s'occupe d'UN cours à la fois. Le lancement est une opération
serveur explicite, après `CourseService.confirm_and_reserve(approved=True)`.
ORIA Cours n'exige au départ que la réservation de transcription ; le service
réserve Luna seulement APRÈS le règlement définitif de l'audio.
Ce module NE crée pas de devis, ne prélève aucun crédit et ne soumet pas un
cours au nom de l'étudiant. Il NE doit pas être exécuté dans une requête
FastAPI de longue durée.

Dépendances injectées :
  - job_store_factory() : nouveau SupabaseCourseJobRepository, service_role ;
  - service_factory(guarded_job_store) : CourseService configuré avec ce store,
    ses repositories et son client fournisseur ;
  - CourseArtifactRenderer : adaptateur leger vers le meme moteur Code-First
    que ORIA Creations (oria.artifact.v1 et create_from_payload), injecte
    seulement si CourseService.renderer est absent ;
  - heartbeat_client_factory() : NOUVEAU client Supabase réservé au thread de
    heartbeat (jamais le même client que le worker principal).

Aucun appel fournisseur sans bail confirmé et heartbeat initial réussi.
Une opération fournisseur commencée mais non terminée doit être rapprochée,
jamais relancée automatiquement, même après expiration du bail.

Avant production, la RPC `begin_call` doit vérifier l'identité, le montant,
le statut et la date d'expiration de la réservation de CRÉDITS associée.
Le bail renouvelé ne renouvelle PAS cette réservation financière.
Le coût fournisseur XAF reste suivi en métadonnées, jamais plafonné par pack.
"""
from __future__ import annotations

from dataclasses import dataclass
import os
from threading import Event, Lock, Thread
from typing import Any, Callable, Mapping
from uuid import UUID


class CourseWorkerError(RuntimeError):
    """Erreur sûre sans transcription ni détails privés."""


class CourseWorkerNotReady(CourseWorkerError):
    """Devis non accepté ou réservation audio non confirmée."""


class CourseWorkerAwaitingCredits(CourseWorkerError):
    """Audio facturé et sauvegardé ; la rédaction attend une recharge.

    Ce statut n'est PAS une incertitude fournisseur et ne doit pas entraîner
    un marquage reconciliation_required. La file durable et les RPC devront
    gérer explicitement une attente persistante AVANT activation du worker.
    """


class CourseWorkerNeedsReconciliation(CourseWorkerError):
    """État financier ou fournisseur incertain : reprise auto interdite."""


@dataclass(frozen=True)
class CourseWorkerResult:
    course_id: str
    status: str
    artifact: dict[str, Any] | None
    already_completed: bool = False


def _uuid(value: str, label: str) -> str:
    try:
        if isinstance(value, bool):
            raise ValueError()
        return str(UUID(str(value)))
    except (ValueError, TypeError, AttributeError) as exc:
        raise ValueError(f"{label} doit être un UUID valide.") from exc


class CourseArtifactPersistenceError(CourseWorkerError):
    """Export ou persistance privée non confirmé(e) ; aucun contenu sensible."""


class CourseArtifactRenderer:
    """Pont leger vers le renderiseur Code-First de CourseService.

    Il n'existe qu'un seul moteur documentaire : ArtifactService.
    OriaCourseArtifactRenderer gere la validation oria.artifact.v1,
    la compilation PDF/DOCX, la transcription TXT privee et les cles
    deterministes. Aucun texte Markdown n'est converti ici.

    Chargement tardif pour conserver les imports du worker independants de
    ceux des modules de facturation et des repositories Supabase pendant
    les tests isoles et le demarrage du serveur.
    """

    def __init__(self, *, artifact_service: Any = None,
                 artifact_repository: Any = None) -> None:
        if artifact_service is None:
            from app.services.artifact_service import ArtifactService
            artifact_service = ArtifactService()
        if artifact_repository is None:
            from app.repositories.supabase_artifact_repository import (
                supabase_artifact_repository,
            )
            artifact_repository = supabase_artifact_repository

        if not all(callable(getattr(artifact_service, name, None))
                   for name in ("create", "create_from_payload")):
            raise ValueError("Moteur ORIA Code-First indisponible.")
        if not all(callable(getattr(artifact_repository, name, None))
                   for name in ("get_artifact", "save_artifact")):
            raise ValueError("Repository de stockage prive non configure.")

        from app.services.course_service import OriaCourseArtifactRenderer
        self._renderer = OriaCourseArtifactRenderer(
            artifact_service=artifact_service,
            artifact_repository=artifact_repository,
        )

    def render_course_code_first(
        self, *, user_id: str, course_id: str, title: str,
        document_format: str, html_source: str, transcript: str,
    ) -> Mapping[str, Any]:
        """Transmet une source HTML validee et conserve les deux artefacts."""
        return self._renderer.render_course_code_first(
            user_id=user_id, course_id=course_id, title=title,
            document_format=document_format, html_source=html_source,
            transcript=transcript,
        )


def _owned_job(job: Any, user_id: str, course_id: str) -> dict[str, Any]:
    if not isinstance(job, dict):
        raise CourseWorkerNotReady("Aucun devis confirmé pour ce cours.")
    if str(job.get("user_id")) != user_id or str(job.get("course_id")) != course_id:
        raise CourseWorkerNeedsReconciliation("Identité du cours incohérente.")
    return job


def _output_result(job: dict[str, Any], course_id: str, *, replay: bool) -> CourseWorkerResult:
    """Expose uniquement les references privees, jamais le texte du cours.

    Le contrat Code-First conserve une reference PDF/DOCX et une reference
    distincte TXT. Une ancienne sortie Markdown ne doit pas etre annoncee
    comme une generation Code-First terminee.
    """
    output = job.get("output")
    if not isinstance(output, dict) or output.get("output_format") != "html_code_first":
        raise CourseWorkerNeedsReconciliation("Sortie du cours incompatible avec le Code-First.")
    artifact = output.get("artifact")
    if not isinstance(artifact, dict):
        raise CourseWorkerNeedsReconciliation("Fichiers prives finaux non confirmes.")
    expected_doc_format = str(output.get("format") or "").lower()
    if expected_doc_format not in {"pdf", "docx"}:
        raise CourseWorkerNeedsReconciliation("Format final du cours invalide.")
    clean: dict[str, dict[str, str]] = {}
    for kind, ext in (("document", expected_doc_format), ("transcription", "txt")):
        item = artifact.get(kind)
        if not isinstance(item, dict):
            raise CourseWorkerNeedsReconciliation("Fichier final manquant : " + kind)
        try:
            artifact_id = _uuid(item.get("artifact_id"), "artifact_id")
        except ValueError as exc:
            raise CourseWorkerNeedsReconciliation("Identifiant de fichier final invalide.") from exc
        if item.get("extension") != ext:
            raise CourseWorkerNeedsReconciliation("Extension de fichier final incoherente.")
        # Le fichier est accessible via son ID dans le depot prive ; le worker
        # ne retourne ni chemin Storage, ni URL signee, ni transcription.
        clean[kind] = {
            "artifact_id": artifact_id,
            "filename": str(item.get("filename") or ""),
            "extension": ext,
            "mime_type": str(item.get("mime_type") or ""),
        }
        if not clean[kind]["filename"] or not clean[kind]["mime_type"]:
            raise CourseWorkerNeedsReconciliation("Metadonnees de fichier final incompletes.")
    return CourseWorkerResult(course_id, "completed", clean, replay)


class _LeaseHeartbeat:
    """Heartbeat indépendant : un client Supabase propre au thread.

    Le tout premier renouvellement doit être acquitté AVANT un appel payant.
    En cas d'échec, l'état est mémorisé et tous les futurs `begin_call` sont
    refusés. Un appel fournisseur déjà engagé ne peut pas être annulé ici.
    """

    RPC = "oria_course_job_command"

    def __init__(
        self, *, user_id: str, course_id: str, lease_token: str,
        client_factory: Callable[[], Any], ttl_seconds: int,
        interval_seconds: float,
    ) -> None:
        self.user_id = user_id
        self.course_id = course_id
        self.lease_token = lease_token
        self.client_factory = client_factory
        self.ttl_seconds = ttl_seconds
        self.interval_seconds = interval_seconds
        self._stop = Event()
        self._first = Event()
        self._lock = Lock()
        self._failure: BaseException | None = None
        self._thread: Thread | None = None

    def _heartbeat_once(self, client: Any) -> None:
        response = client.rpc(self.RPC, {
            "p_user_id": self.user_id,
            "p_course_id": self.course_id,
            "p_command": "heartbeat",
            "p_data": {
                "lease_token": self.lease_token,
                "ttl_seconds": self.ttl_seconds,
            },
        }).execute()
        error = response.get("error") if isinstance(response, dict) else getattr(response, "error", None)
        data = response.get("data") if isinstance(response, dict) else getattr(response, "data", None)
        if isinstance(data, list):
            data = data[0] if len(data) == 1 else None
        if error or not isinstance(data, dict):
            raise CourseWorkerNeedsReconciliation("Heartbeat Supabase non confirmé.")
        if (str(data.get("user_id")) != self.user_id
                or str(data.get("course_id")) != self.course_id
                or str(data.get("lease_token")) != self.lease_token
                or data.get("status") != "processing"
                or not data.get("lease_expires_at")):
            raise CourseWorkerNeedsReconciliation("Bail Supabase incohérent.")

    def _loop(self) -> None:
        try:
            client = self.client_factory()  # construit DANS ce thread
            self._heartbeat_once(client)
            self._first.set()
            while not self._stop.wait(self.interval_seconds):
                self._heartbeat_once(client)
        except BaseException as exc:
            with self._lock:
                self._failure = exc
            self._first.set()
        finally:
            self._first.set()

    def start(self, *, initial_timeout_seconds: float) -> None:
        self._thread = Thread(target=self._loop, name="oria-course-lease-heartbeat", daemon=True)
        self._thread.start()
        if not self._first.wait(initial_timeout_seconds):
            self._stop.set()
            raise CourseWorkerNeedsReconciliation("Premier heartbeat expiré.")
        self.ensure_healthy()

    def ensure_healthy(self) -> None:
        with self._lock:
            failed = self._failure is not None
        if failed or not self._first.is_set():
            raise CourseWorkerNeedsReconciliation("Bail de traitement non confirmé.")
        thread = self._thread
        if thread is None or not thread.is_alive():
            raise CourseWorkerNeedsReconciliation("Surveillance du bail arrêtée.")

    def stop(self, *, timeout_seconds: float = 10.0) -> bool:
        self._stop.set()
        if self._thread is not None:
            self._thread.join(timeout_seconds)
            return not self._thread.is_alive()
        return True


class _GuardedJobStore:
    """Empêche une nouvelle action payante si le heartbeat a échoué.

    Les écritures restent autorisées uniquement par la validation atomique
    du lease_token dans les RPC PostgreSQL du repository sous-jacent.
    """

    def __init__(self, jobs: Any, heartbeat: _LeaseHeartbeat):
        self._jobs = jobs
        self._heartbeat = heartbeat
        self.paid_calls_started = 0

    def __getattr__(self, name: str) -> Any:
        return getattr(self._jobs, name)

    def begin_call(self, **kwargs: Any) -> None:
        self._heartbeat.ensure_healthy()
        self._jobs.begin_call(**kwargs)
        self.paid_calls_started += 1

    def finish_call(self, **kwargs: Any) -> None:
        self._heartbeat.ensure_healthy()
        self._jobs.finish_call(**kwargs)

    def set_settled(self, **kwargs: Any) -> None:
        self._heartbeat.ensure_healthy()
        self._jobs.set_settled(**kwargs)

    def finish(self, **kwargs: Any) -> None:
        self._heartbeat.ensure_healthy()
        self._jobs.finish(**kwargs)


class CourseWorker:
    """Exécute un cours confirmé, avec provision AUDIO uniquement au départ.

    Ne fait aucun retry automatique. Chaque nouvelle tentative `run()`
    revalide l'état SQL ; les checkpoints 'started' non terminés resteront
    bloqués par la contrainte unique de `oria_course_job_calls`.
    """

    def __init__(
        self, *,
        job_store_factory: Callable[[], Any],
        service_factory: Callable[[Any], Any],
        heartbeat_client_factory: Callable[[], Any],
        lease_seconds: int = 900,
        heartbeat_interval_seconds: float = 30.0,
        initial_heartbeat_timeout_seconds: float = 15.0,
        document_renderer_factory: Callable[[], Any] | None = None,
    ) -> None:
        if not all(callable(fn) for fn in (
            job_store_factory, service_factory, heartbeat_client_factory,
        )):
            raise ValueError("Factories du worker obligatoires.")
        if type(lease_seconds) is not int or not 60 <= lease_seconds <= 3600:
            raise ValueError("Bail attendu entre 60 et 3600 secondes.")
        if (isinstance(heartbeat_interval_seconds, bool)
                or not 0 < heartbeat_interval_seconds <= lease_seconds / 3):
            raise ValueError("Intervalle de heartbeat trop long.")
        if (isinstance(initial_heartbeat_timeout_seconds, bool)
                or not 0 < initial_heartbeat_timeout_seconds < lease_seconds / 2):
            raise ValueError("Délai de premier heartbeat invalide.")
        self.job_store_factory = job_store_factory
        self.service_factory = service_factory
        self.heartbeat_client_factory = heartbeat_client_factory
        self.lease_seconds = lease_seconds
        self.interval_seconds = float(heartbeat_interval_seconds)
        self.first_timeout_seconds = float(initial_heartbeat_timeout_seconds)
        if document_renderer_factory is not None and not callable(document_renderer_factory):
            raise ValueError("Factory renderer invalide.")
        self.document_renderer_factory = document_renderer_factory or CourseArtifactRenderer

    @staticmethod
    def _check_ready(job: dict[str, Any]) -> None:
        status = job.get("status")
        if status == "reconciliation_required":
            raise CourseWorkerNeedsReconciliation("Rapprochement manuel du cours requis.")
        if status not in ("queued", "processing"):
            raise CourseWorkerNotReady("Le cours n'est pas prêt pour le traitement.")
        plan = job.get("plan")
        if (not isinstance(plan, dict)
                or not plan.get("transcription_reservation_id")
                or not plan.get("document_reservation_id")
                or plan.get("writing_model") != "luna"
                or plan.get("provider_model") != "gpt-6-luna"):
            raise CourseWorkerNotReady("Devis Luna du cours absent ou incompatible.")
        # Le devis accepté ne bloque QUE l'audio avant de commencer.
        # La provision documentaire peut encore être absente/pending :
        # CourseService la créera seulement lorsque l'audio sera réglé.
        audio = job.get("transcription_reservation_status")
        document = job.get("document_reservation_status")
        if audio not in ("reserved", "settled"):
            raise CourseWorkerNotReady("Réservation audio non confirmée.")
        if document not in (None, "", "pending", "reserved", "settled"):
            raise CourseWorkerNeedsReconciliation("État de réservation documentaire inconnu.")
        if document in ("reserved", "settled") and audio != "settled":
            # Ancien plan doublement réservé ou incohérence de séquencement.
            # Ne démarrer AUCUN appel fournisseur avec une double réservation.
            raise CourseWorkerNotReady("Réservations d'étapes non séquentielles.")

    def run(self, *, user_id: str, course_id: str) -> CourseWorkerResult:
        """Une seule exécution, sans attente artificielle ni réessai fournisseur.

        Retourne les identifiants du PDF/DOCX et du TXT, jamais les textes.
        Les checkpoints 'finished' et les règlements déjà effectués sont
        réutilisés par CourseService selon son contrat d'idempotence.
        """
        uid, cid = _uuid(user_id, "user_id"), _uuid(course_id, "course_id")
        # Dans ORIA Cours, seul le wallet prépayé autorise un appel fournisseur.
        # Éviter tout mélange accidentel avec les anciennes RPC à plafond API.
        if os.getenv("ORIA_ENFORCE_PACK_API_BUDGET", "0") != "0":
            raise CourseWorkerNotReady(
                "Ancien plafond API actif : le worker Cours exige le mode crédits seuls."
            )
        jobs = self.job_store_factory()
        first = _owned_job(jobs.get_job(user_id=uid, course_id=cid), uid, cid)
        if first.get("status") == "completed":
            return _output_result(first, cid, replay=True)
        self._check_ready(first)

        # Cet objet sera injecté dans CourseService, avant d'acquérir le bail.
        # Le heartbeat est démarré plus bas, une fois le lease_token obtenu.
        heartbeat = _LeaseHeartbeat(
            user_id=uid, course_id=cid, lease_token="",  # fixé après claim SQL
            client_factory=self.heartbeat_client_factory,
            ttl_seconds=self.lease_seconds,
            interval_seconds=self.interval_seconds,
        )
        guarded = _GuardedJobStore(jobs, heartbeat)
        service = self.service_factory(guarded)
        if getattr(service, "jobs", None) is not guarded:
            raise CourseWorkerNotReady("CourseService doit utiliser le registre protégé.")
        if getattr(service, "renderer", None) is None:
            # Le service continue d'accepter un renderer personnalisé.
            # En son absence, raccordement natif aux deux services existants.
            try:
                service.renderer = self.document_renderer_factory()
            except Exception as exc:
                raise CourseWorkerNotReady(
                    "Export PDF/DOCX privé indisponible."
                ) from exc
        if not callable(getattr(service.renderer, "render_course_code_first", None)):
            raise CourseWorkerNotReady("Renderer sans méthode render_course_code_first().")
        # Verifier les dependances Code-First AVANT le premier appel fournisseur.
        ai = getattr(service, "ai", None)
        if not callable(getattr(ai, "compose_course_section", None)) or not callable(
            getattr(ai, "_validate_course_html_fragment", None)
        ):
            raise CourseWorkerNotReady("OpenAIService Code-First ORIA Cours absent.")

        lease_acquired = False
        heartbeat_started = False
        completed = False
        error: BaseException | None = None
        try:
            token = jobs.acquire_lease(user_id=uid, course_id=cid,
                                       ttl_seconds=self.lease_seconds)
            heartbeat.lease_token = _uuid(token, "lease_token")
            lease_acquired = True
            heartbeat_started = True
            heartbeat.start(initial_timeout_seconds=self.first_timeout_seconds)
            current = _owned_job(jobs.get_job(user_id=uid, course_id=cid), uid, cid)
            self._check_ready(current)
            heartbeat.ensure_healthy()

            # Phase 1 : réservé et réglé UNIQUEMENT sur l'audio.
            # Si la transcription a déjà été réglée, CourseService réutilise
            # les checkpoints sans ré-exécuter les appels fournisseur.
            service.transcribe_submitted_course(user_id=uid, course_id=cid)
            heartbeat.ensure_healthy()
            # Phase 2 : CourseService réserve maintenant la rédaction Luna.
            # Une insuffisance de crédits à ce stade est une ATTENTE métier,
            # pas un échec fournisseur. Aucun appel de rédaction n'a débuté.
            try:
                service.write_course(user_id=uid, course_id=cid)
            except Exception as exc:
                # Import local pour préserver les tests isolés du worker,
                # sans reconnaissance fragile fondée sur le texte d'erreur.
                from app.services.course_service import CourseInsufficientCredits
                if not isinstance(exc, CourseInsufficientCredits):
                    raise
                heartbeat.ensure_healthy()
                state = _owned_job(jobs.get_job(user_id=uid, course_id=cid), uid, cid)
                if (state.get("transcription_reservation_status") != "settled"
                        or state.get("document_reservation_status") not in (None, "", "pending")):
                    raise CourseWorkerNeedsReconciliation(
                        "Insuffisance de crédits avec état financier incohérent."
                    ) from exc
                # L'étape B suivante rendra cette attente persistante via SQL
                # et fera différer l'élément de file. Avant cela, ne jamais
                # classer ce cas comme une anomalie de facturation du job.
                raise CourseWorkerAwaitingCredits(
                    "Transcription conservée : crédits insuffisants pour la rédaction Luna."
                ) from exc
            # finish_job met normalement completed et supprime le bail.
            final = _owned_job(jobs.get_job(user_id=uid, course_id=cid), uid, cid)
            if final.get("status") != "completed":
                raise CourseWorkerNeedsReconciliation("Export final non confirmé en base.")
            completed = True
            return _output_result(final, cid, replay=False)
        except CourseWorkerAwaitingCredits as exc:
            # Aucune nouvelle dépense lancée pour la rédaction : ne pas
            # imposer de rapprochement manuel au job pour simple manque de
            # crédits. La file durable doit traiter explicitement cette
            # exception AVANT toute activation (elle est encore en 'review').
            error = exc
            raise
        except BaseException as exc:
            error = exc
            # Toute véritable défaillance après acquisition reste à rapprocher.
            # Un appel commencé peut avoir été facturé malgré une panne réseau.
            if lease_acquired:
                try:
                    current = jobs.get_job(user_id=uid, course_id=cid)
                    if not isinstance(current, dict) or current.get("status") != "completed":
                        jobs.flag_reconciliation(
                            user_id=uid, course_id=cid,
                            detail="Exécution interrompue après un appel fournisseur",
                        )
                except Exception:
                    pass  # l'exception initiale garde la priorité
            raise
        finally:
            # Stopper le heartbeat AVANT de libérer le bail.
            stopped = heartbeat.stop() if heartbeat_started else True
            if lease_acquired and stopped:
                try:
                    jobs.release_lease(user_id=uid, course_id=cid)
                except Exception:
                    # Un incident de libération ne justifie jamais un nouveau
                    # traitement. Le bail SQL expirera sans activité.
                    if error is None and not completed:
                        raise CourseWorkerNeedsReconciliation(
                            "Libération du bail non confirmée."
                        )
            # Si le heartbeat est encore bloqué, on ne libère pas son bail
            # sous lui ; il expirera côté SQL.


__all__ = [
    "CourseWorker", "CourseWorkerResult", "CourseWorkerError",
    "CourseWorkerNotReady", "CourseWorkerAwaitingCredits",
    "CourseWorkerNeedsReconciliation",
    "CourseArtifactRenderer", "CourseArtifactPersistenceError",
]
