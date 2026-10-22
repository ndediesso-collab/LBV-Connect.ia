"""Consommateur serveur de la file durable ORIA Cours.

Destination: Backend/app/services/course_queue_consumer.py
Lancement explicite: ``python -m app.services.course_queue_consumer`` depuis Backend.

Ne demarre jamais depuis une requete FastAPI ni a l'import du module.
Deux baux DISTINCTS sont requis : file de livraison et CourseWorker. La perte
 du bail de file interdit tout NOUVEL appel payant via _QueueCheckedJobStore.
Un appel deja commence peut rester facturable: pas de retry implicite.

Activation volontaire, seulement apres tests financiers reels en STAGING:
  ORIA_COURSE_CONSUMER_ENABLED=1 (independant du plafond API par pack).
Les reservations de credits ont une expiration independante des baux.
"""
from __future__ import annotations

from dataclasses import dataclass
import logging
import os
from threading import Event, Lock, Thread
from time import monotonic
from typing import Any, Callable
from uuid import UUID

logger = logging.getLogger(__name__)


class CourseQueueConsumerError(RuntimeError):
    """Erreur generique d'execution serveur sans texte prive du cours."""


class CourseQueueConsumerNotEnabled(CourseQueueConsumerError):
    """Activation explicite du consommateur absente."""


class CourseQueueConsumerLeaseLost(CourseQueueConsumerError):
    """Le bail de la file n'est plus confirme; bloquer les nouveaux appels."""


@dataclass(frozen=True)
class CourseQueueConsumerOutcome:
    status: str  # empty, completed, review, pending_review, pending_ack
    course_id: str | None = None


def _uuid(value: Any, field: str) -> str:
    try:
        if isinstance(value, bool):
            raise ValueError("boolean")
        return str(UUID(str(value)))
    except (TypeError, ValueError, AttributeError) as exc:
        raise CourseQueueConsumerError(f"{field}: identifiant invalide.") from exc


def _require_enabled() -> None:
    # Le consommateur est protege par son propre flag. Les gardes de solde
    # et de reservation sont appliques par les RPC et CourseWorker.
    if os.getenv("ORIA_COURSE_CONSUMER_ENABLED", "0") != "1":
        raise CourseQueueConsumerNotEnabled(
            "Consommateur ORIA Cours desactive."
        )
    # Mêmes conditions que CourseService/CourseWorker : ne pas claimant
    # un cours si l'ancien mode à double plafond a été réactivé par erreur.
    # La valeur 0 autorise ici la facturation exclusivement en crédits ORIA.
    if os.getenv("ORIA_ENFORCE_PACK_API_BUDGET", "0") != "0":
        raise CourseQueueConsumerNotEnabled(
            "Mode credits ORIA uniquement requis pour le consommateur."
        )


class _QueueLeaseHeartbeat:
    """Maintient le bail de livraison avec un client Supabase INDEPENDANT.

    Le tout premier heartbeat doit reussir avant la creation du CourseWorker.
    La panne est memorisee et refusee par _QueueCheckedJobStore.begin_call,
    meme si le heartbeat du CourseWorker fonctionne encore.
    """

    def __init__(
        self, *, queue_factory: Callable[[], Any],
        user_id: str, course_id: str, lease_token: str,
        ttl_seconds: int, interval_seconds: float,
    ) -> None:
        self.queue_factory = queue_factory
        self.user_id = user_id
        self.course_id = course_id
        self.lease_token = lease_token
        self.ttl_seconds = ttl_seconds
        self.interval_seconds = interval_seconds
        self._stop = Event()
        self._first = Event()
        self._lock = Lock()
        self._failure: BaseException | None = None
        self._thread: Thread | None = None

    def _loop(self) -> None:
        try:
            # La factory est appelee DANS le thread: jamais de client partage.
            queue = self.queue_factory()
            queue.heartbeat(
                user_id=self.user_id, course_id=self.course_id,
                lease_token=self.lease_token, ttl_seconds=self.ttl_seconds,
            )
            self._first.set()
            while not self._stop.wait(self.interval_seconds):
                queue.heartbeat(
                    user_id=self.user_id, course_id=self.course_id,
                    lease_token=self.lease_token, ttl_seconds=self.ttl_seconds,
                )
        except BaseException as exc:
            with self._lock:
                self._failure = exc
            self._first.set()
        finally:
            self._first.set()

    def start(self, *, timeout_seconds: float) -> None:
        if self._thread is not None:
            raise CourseQueueConsumerError("Heartbeat de file deja lance.")
        self._thread = Thread(
            target=self._loop, name="oria-course-queue-heartbeat", daemon=True
        )
        self._thread.start()
        if not self._first.wait(timeout_seconds):
            self._stop.set()
            raise CourseQueueConsumerLeaseLost("Heartbeat initial de file expire.")
        self.ensure_healthy()

    def ensure_healthy(self) -> None:
        with self._lock:
            failed = self._failure is not None
        if (failed or not self._first.is_set()
                or self._thread is None or not self._thread.is_alive()):
            raise CourseQueueConsumerLeaseLost("Bail de livraison non confirme.")

    def stop(self, timeout_seconds: float = 10.0) -> bool:
        self._stop.set()
        if self._thread is None:
            return True
        self._thread.join(timeout_seconds)
        return not self._thread.is_alive()


class _QueueCheckedJobStore:
    """Garde inter-baux: aucune nouvelle operation fournisseur sans bail queue."""

    def __init__(self, delegate: Any, check_queue_lease: Callable[[], None]):
        self._delegate = delegate
        self._check_queue_lease = check_queue_lease

    def __getattr__(self, name: str) -> Any:
        return getattr(self._delegate, name)

    def begin_call(self, **kwargs: Any) -> None:
        self._check_queue_lease()
        self._delegate.begin_call(**kwargs)


class CourseQueueConsumer:
    """Traite une livraison a la fois, sans relancer les cours interrompus.

    ``queue_factory()`` cree un NOUVEAU repository/client Supabase a chaque
    appel; notamment dans le thread de heartbeat. ``worker_factory(check)``
    construit un CourseWorker dont job_store_factory enveloppe le repository
    avec _QueueCheckedJobStore(..., check). ``build_course_queue_consumer``
    fournit ce cablage reel.
    """

    def __init__(
        self, *, queue_factory: Callable[[], Any],
        worker_factory: Callable[[Callable[[], None]], Any],
        lease_seconds: int = 900, heartbeat_interval_seconds: float = 30,
        initial_heartbeat_timeout_seconds: float = 15,
        poll_interval_seconds: float = 5,
        maintenance_interval_seconds: float = 60,
    ) -> None:
        if not callable(queue_factory) or not callable(worker_factory):
            raise ValueError("Factories de file et de worker obligatoires.")
        if type(lease_seconds) is not int or not 60 <= lease_seconds <= 3600:
            raise ValueError("Bail de livraison entre 60 et 3600 secondes.")
        if (isinstance(heartbeat_interval_seconds, bool)
                or not 0 < heartbeat_interval_seconds <= lease_seconds / 3):
            raise ValueError("Frequence heartbeat de file invalide.")
        if (isinstance(initial_heartbeat_timeout_seconds, bool)
                or not 0 < initial_heartbeat_timeout_seconds < lease_seconds / 2):
            raise ValueError("Delai du heartbeat initial invalide.")
        if (isinstance(poll_interval_seconds, bool)
                or not 0 < poll_interval_seconds <= 300):
            raise ValueError("Delai de sondage invalide.")
        if (isinstance(maintenance_interval_seconds, bool)
                or not 0 < maintenance_interval_seconds <= 3600):
            raise ValueError("Delai de maintenance invalide.")
        self.queue_factory = queue_factory
        self.worker_factory = worker_factory
        self.lease_seconds = lease_seconds
        self.heartbeat_interval_seconds = float(heartbeat_interval_seconds)
        self.initial_heartbeat_timeout_seconds = float(initial_heartbeat_timeout_seconds)
        self.poll_interval_seconds = float(poll_interval_seconds)
        self.maintenance_interval_seconds = float(maintenance_interval_seconds)

    def reconcile_stalled(self, *, limit: int = 50) -> int:
        """Ne remet JAMAIS une tache interrompue en attente."""
        _require_enabled()
        return self.queue_factory().reconcile_stalled(limit=limit)

    def run_once(self) -> CourseQueueConsumerOutcome:
        """Une unique tentative claim -> traitement -> ACK, sans retry.

        En cas de doute apres claim, une revue manuelle est demandee. Si ACK
        echoue APRES confirmation du job completed, la maintenance SQL peut
        terminer cette entree sans re-executer le fournisseur.
        """
        _require_enabled()  # ne pas claimant un cours impossible a traiter
        queue = self.queue_factory()
        claim = queue.claim_next(ttl_seconds=self.lease_seconds)
        if claim is None:
            return CourseQueueConsumerOutcome("empty")

        # Repository renvoie deja des UUID valides, mais ne pas faire confiance
        # a un client injecte ni transmettre un owner illisible au worker.
        try:
            uid = _uuid(claim.get("user_id"), "user_id")
            cid = _uuid(claim.get("course_id"), "course_id")
            token = _uuid(claim.get("lease_token"), "lease_token")
        except (AttributeError, CourseQueueConsumerError):
            # Sans identifiants fiables, le bail expirera; reconciliation SQL.
            logger.error("Claim de file invalide; reprise automatique interdite.")
            raise CourseQueueConsumerError("Claim de livraison invalide.") from None

        heartbeat = _QueueLeaseHeartbeat(
            queue_factory=self.queue_factory, user_id=uid, course_id=cid,
            lease_token=token, ttl_seconds=self.lease_seconds,
            interval_seconds=self.heartbeat_interval_seconds,
        )
        completed_by_worker = False
        try:
            heartbeat.start(timeout_seconds=self.initial_heartbeat_timeout_seconds)
            worker = self.worker_factory(heartbeat.ensure_healthy)
            heartbeat.ensure_healthy()
            result = worker.run(user_id=uid, course_id=cid)
            if (getattr(result, "status", None) != "completed"
                    or not isinstance(getattr(result, "artifact", None), dict)
                    or not result.artifact.get("id")):
                raise CourseQueueConsumerError("Worker sans document final confirme.")
            completed_by_worker = True
            heartbeat.ensure_healthy()
            try:
                queue.acknowledge_success(
                    user_id=uid, course_id=cid, lease_token=token,
                )
            except Exception:
                logger.exception("ACK de cours termine incertain course_id=%s", cid)
                return CourseQueueConsumerOutcome("pending_ack", cid)
            return CourseQueueConsumerOutcome("completed", cid)
        except Exception:
            logger.exception("Traitement ORIA Cours interrompu course_id=%s", cid)
            if completed_by_worker:
                # Le job est deja completed: SQL refuse le passage en review.
                # La maintenance validera la sortie apres expiration du bail.
                return CourseQueueConsumerOutcome("pending_ack", cid)
            try:
                queue.flag_for_review(
                    user_id=uid, course_id=cid, lease_token=token,
                    reason="execution_interrompue",
                )
            except Exception:
                # Le bail peut deja etre expire. reconcile_stalled() assurera
                # la revue et interdira tout deuxieme traitement fournisseur.
                logger.exception("Revue SQL indisponible course_id=%s", cid)
                return CourseQueueConsumerOutcome("pending_review", cid)
            return CourseQueueConsumerOutcome("review", cid)
        finally:
            if not heartbeat.stop():
                logger.error("Heartbeat de file non arrete course_id=%s", cid)

    def run_forever(self, *, stop_event: Event | None = None) -> None:
        """Boucle mono-concurrente: processus distinct du serveur HTTP.

        Une exception de la file (avant claim) est loggee; pas de boucle
        agressive. Un job deja claim ne sera JAMAIS rejoue par ce processus.
        """
        _require_enabled()
        stop = stop_event if stop_event is not None else Event()
        last_maintenance = float("-inf")
        while not stop.is_set():
            now = monotonic()
            if now - last_maintenance >= self.maintenance_interval_seconds:
                try:
                    self.reconcile_stalled(limit=50)
                except Exception:
                    logger.exception("Maintenance de file indisponible")
                    if stop.wait(self.poll_interval_seconds):
                        break
                    continue
                last_maintenance = monotonic()
            try:
                outcome = self.run_once()
                if outcome.status != "empty":
                    logger.info("ORIA Cours queue: status=%s course_id=%s",
                                outcome.status, outcome.course_id)
            except Exception:
                logger.exception("Consommation de file indisponible")
            if stop.wait(self.poll_interval_seconds):
                break


def build_course_queue_consumer(*, client_factory: Callable[[], Any]) -> CourseQueueConsumer:
    """Assemblage explicite avec les classes EXISTANTES, aucun nouveau module.

    Le client_factory DOIT retourner un client Supabase service_role NEUF a
    chaque appel et ne doit jamais reutiliser une session utilisateur.
    """
    if not callable(client_factory):
        raise ValueError("Factory client Supabase serveur obligatoire.")
    from app.repositories.supabase_course_queue_repository import SupabaseCourseQueueRepository
    from app.repositories.supabase_course_job_repository import SupabaseCourseJobRepository
    from app.repositories.supabase_audio_repository import SupabaseCourseAudioRepository
    from app.repositories.supabase_credit_repository import SupabaseCreditRepository
    from app.services.course_service import CourseService
    from app.services.openai_service import OpenAIService
    from app.services.course_worker import CourseWorker

    def queue_factory() -> Any:
        return SupabaseCourseQueueRepository(client_factory())

    def worker_factory(check_queue_lease: Callable[[], None]) -> Any:
        def job_factory() -> Any:
            return _QueueCheckedJobStore(
                SupabaseCourseJobRepository(client_factory()), check_queue_lease
            )

        def service_factory(jobs: Any) -> Any:
            client = client_factory()
            return CourseService(
                course_repository=SupabaseCourseAudioRepository(client),
                job_store=jobs,
                credit_repository=SupabaseCreditRepository(client),
                openai_service=OpenAIService(),
                renderer=None,  # CourseWorker injecte CourseArtifactRenderer existant.
            )

        return CourseWorker(
            job_store_factory=job_factory,
            service_factory=service_factory,
            heartbeat_client_factory=client_factory,
        )

    return CourseQueueConsumer(queue_factory=queue_factory, worker_factory=worker_factory)


def main() -> int:
    """Point d'entree volontaire; exige le secret service_role cote serveur."""
    _require_enabled()
    url = os.getenv("SUPABASE_URL", "").strip()
    key = os.getenv("SUPABASE_SERVICE_ROLE_KEY", "").strip()
    if not url or not key:
        raise CourseQueueConsumerError(
            "SUPABASE_URL et SUPABASE_SERVICE_ROLE_KEY requis cote serveur."
        )
    # SDK importe uniquement au demarrage du processus de consommation.
    from supabase import create_client

    def new_client() -> Any:
        return create_client(url, key)

    consumer = build_course_queue_consumer(client_factory=new_client)
    try:
        consumer.run_forever()
    except KeyboardInterrupt:
        logger.info("Arret demande pour le consommateur ORIA Cours.")
    return 0


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    raise SystemExit(main())


__all__ = [
    "CourseQueueConsumer", "CourseQueueConsumerOutcome",
    "CourseQueueConsumerError", "CourseQueueConsumerNotEnabled",
    "CourseQueueConsumerLeaseLost", "build_course_queue_consumer",
]
