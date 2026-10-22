"""File durable ORIA Cours, pilotee exclusivement par les RPC PostgreSQL.

Destination: Backend/app/repositories/supabase_course_queue_repository.py
SQL associe: ORIA_18_COURSE_QUEUE_STAGING.sql (base de test d'abord).

Ne lance PAS les appels OpenAI: un consommateur distinct utilisera
``claim_next`` puis ``CourseWorker.run`` et ``acknowledge_success``.
Un travail reclame mais interrompu n'est JAMAIS remis automatiquement en queue:
un appel fournisseur a pu etre facture meme en l'absence de checkpoint final.

Le client Supabase injecte doit porter service_role et rester cote serveur.
"""
from __future__ import annotations

from typing import Any
from uuid import UUID, uuid4


class CourseQueueError(RuntimeError):
    """Probleme de file; details prives ou SQL non exposes a l'utilisateur."""


class CourseQueueConflict(CourseQueueError):
    """Etat ou proprietaire incompatible avec la transition demandee."""


class CourseQueueLeaseError(CourseQueueError):
    """Le consommateur ne detient plus le bail PostgreSQL."""


class CourseQueueNeedsReview(CourseQueueError):
    """Un traitement potentiellement facture necessite une revue humaine."""


class SupabaseCourseQueueRepository:
    """Adaptateur strict de la file PostgreSQL, sans stockage local d'etat.

    Les mutations sont atomiques dans PostgreSQL et idempotentes selon
    ``course_id``. Les tokens de bail appartiennent au consommateur de queue;
    ils sont differents du lease_token de ``oria_course_jobs``.
    """

    RPC_ENQUEUE = "oria_course_queue_enqueue"
    RPC_CLAIM = "oria_course_queue_claim"
    RPC_HEARTBEAT = "oria_course_queue_heartbeat"
    RPC_ACK = "oria_course_queue_ack"
    RPC_REVIEW = "oria_course_queue_review"
    RPC_STALLED = "oria_course_queue_reconcile_stalled"
    RPC_GET = "oria_course_queue_get"

    MIN_LEASE_SECONDS = 60
    MAX_LEASE_SECONDS = 3600

    def __init__(self, client: Any) -> None:
        if client is None or not callable(getattr(client, "rpc", None)):
            raise ValueError("Client Supabase service_role requis.")
        self.client = client

    @staticmethod
    def _uuid(value: Any, name: str) -> str:
        try:
            if isinstance(value, bool):
                raise ValueError()
            return str(UUID(str(value)))
        except (TypeError, ValueError, AttributeError) as exc:
            raise ValueError(f"{name} doit etre un UUID valide.") from exc

    @classmethod
    def _ttl(cls, value: int) -> int:
        if type(value) is not int or not cls.MIN_LEASE_SECONDS <= value <= cls.MAX_LEASE_SECONDS:
            raise ValueError("Duree du bail entre 60 et 3600 secondes.")
        return value

    @staticmethod
    def _unpack(result: Any, *, allow_null: bool = False) -> dict[str, Any] | None:
        error = result.get("error") if isinstance(result, dict) else getattr(result, "error", None)
        if error:
            raise CourseQueueError("RPC de queue non confirmee.")
        data = result.get("data") if isinstance(result, dict) else getattr(result, "data", None)
        if isinstance(data, list):
            if len(data) != 1:
                if not data and allow_null:
                    return None
                raise CourseQueueError("Nombre de resultats SQL inattendu.")
            data = data[0]
        if data is None and allow_null:
            return None
        if not isinstance(data, dict):
            raise CourseQueueError("Structure du resultat SQL invalide.")
        return data

    def _rpc(self, name: str, params: dict[str, Any], *, allow_null: bool = False) -> dict[str, Any] | None:
        try:
            response = self.client.rpc(name, params).execute()
        except Exception as exc:
            message = str(exc).lower()
            if "oria_course_queue_lease" in message:
                raise CourseQueueLeaseError("Bail de la queue expire ou perdu.") from exc
            if "oria_course_queue_review" in message:
                raise CourseQueueNeedsReview("Traitement bloque pour rapprochement.") from exc
            if "oria_course_queue_conflict" in message:
                raise CourseQueueConflict("Etat de la queue incompatible.") from exc
            raise CourseQueueError("Operation de file durable indisponible.") from exc
        return self._unpack(response, allow_null=allow_null)

    @staticmethod
    def _expect_owner(row: dict[str, Any], *, user_id: str, course_id: str) -> dict[str, Any]:
        if str(row.get("user_id")) != user_id or str(row.get("course_id")) != course_id:
            raise CourseQueueError("Reponse SQL ne correspondant pas au cours attendu.")
        return row

    @staticmethod
    def _expect_token(row: dict[str, Any], *, token: str) -> dict[str, Any]:
        if str(row.get("lease_token")) != token:
            raise CourseQueueLeaseError("Identite du bail SQL non confirmee.")
        return row

    def enqueue_once(self, user_id: str, course_id: str) -> dict[str, Any]:
        """Dispatcher compatible avec ``configure_course_dispatcher``.

        PostgreSQL verifie la propriete, les deux reservations, et unicite.
        Aucune facture, aucun worker, aucun retry dans cette methode.
        """
        uid = self._uuid(user_id, "user_id")
        cid = self._uuid(course_id, "course_id")
        row = self._rpc(self.RPC_ENQUEUE, {"p_user_id": uid, "p_course_id": cid})
        assert row is not None
        self._expect_owner(row, user_id=uid, course_id=cid)
        if row.get("status") not in {"queued", "running", "completed"}:
            raise CourseQueueNeedsReview("Cours non dispatchable sans revue humaine.")
        return row

    def get_entry(self, *, user_id: str, course_id: str) -> dict[str, Any] | None:
        uid = self._uuid(user_id, "user_id")
        cid = self._uuid(course_id, "course_id")
        row = self._rpc(self.RPC_GET, {"p_user_id": uid, "p_course_id": cid}, allow_null=True)
        return self._expect_owner(row, user_id=uid, course_id=cid) if row is not None else None

    def claim_next(self, *, lease_token: str | None = None, ttl_seconds: int = 900) -> dict[str, Any] | None:
        """Prend un cours en queue sous bail SQL, ou retourne None si vide.

        Le token genere est distinct du bail utilise par CourseWorker et doit
        etre conserve dans le consommateur pour heartbeat/ack/review.
        """
        token = self._uuid(lease_token or str(uuid4()), "lease_token")
        row = self._rpc(self.RPC_CLAIM, {
            "p_lease_token": token,
            "p_ttl_seconds": self._ttl(ttl_seconds),
        }, allow_null=True)
        if row is None:
            return None
        uid = self._uuid(row.get("user_id"), "user_id retourne")
        cid = self._uuid(row.get("course_id"), "course_id retourne")
        self._expect_owner(row, user_id=uid, course_id=cid)
        self._expect_token(row, token=token)
        if row.get("status") != "running" or not row.get("lease_expires_at"):
            raise CourseQueueError("Le bail reclame n'a pas ete confirme.")
        return row

    def heartbeat(self, *, user_id: str, course_id: str, lease_token: str,
                  ttl_seconds: int = 900) -> dict[str, Any]:
        uid, cid = self._uuid(user_id, "user_id"), self._uuid(course_id, "course_id")
        token = self._uuid(lease_token, "lease_token")
        row = self._rpc(self.RPC_HEARTBEAT, {
            "p_user_id": uid, "p_course_id": cid, "p_lease_token": token,
            "p_ttl_seconds": self._ttl(ttl_seconds),
        })
        assert row is not None
        self._expect_owner(row, user_id=uid, course_id=cid)
        self._expect_token(row, token=token)
        if row.get("status") != "running" or not row.get("lease_expires_at"):
            raise CourseQueueLeaseError("Renouvellement du bail non confirme.")
        return row

    def acknowledge_success(self, *, user_id: str, course_id: str, lease_token: str) -> dict[str, Any]:
        """L'ACK SQL verifie que le job Cours est deja completed avec artifact."""
        uid, cid = self._uuid(user_id, "user_id"), self._uuid(course_id, "course_id")
        token = self._uuid(lease_token, "lease_token")
        row = self._rpc(self.RPC_ACK, {
            "p_user_id": uid, "p_course_id": cid, "p_lease_token": token,
        })
        assert row is not None
        self._expect_owner(row, user_id=uid, course_id=cid)
        if row.get("status") != "completed":
            raise CourseQueueError("ACK non confirme.")
        return row

    def flag_for_review(self, *, user_id: str, course_id: str,
                        lease_token: str, reason: str = "execution_interrompue") -> dict[str, Any]:
        """Etape terminale sur erreur: jamais de retry implicite.

        Meme si cette operation echoue (perte reseau), le bail SQL finira par
        expirer et ``reconcile_stalled`` exigera une revue manuelle.
        """
        uid, cid = self._uuid(user_id, "user_id"), self._uuid(course_id, "course_id")
        token = self._uuid(lease_token, "lease_token")
        clean_reason = str(reason or "execution_interrompue").strip()[:120]
        if not clean_reason:
            clean_reason = "execution_interrompue"
        row = self._rpc(self.RPC_REVIEW, {
            "p_user_id": uid, "p_course_id": cid, "p_lease_token": token,
            "p_reason": clean_reason,
        })
        assert row is not None
        self._expect_owner(row, user_id=uid, course_id=cid)
        if row.get("status") != "review":
            raise CourseQueueError("Mise en revue non confirmee.")
        return row

    def reconcile_stalled(self, *, limit: int = 50) -> int:
        """Marque les baux running expires pour revue, sans les re-dispatcher."""
        if type(limit) is not int or not 1 <= limit <= 100:
            raise ValueError("Limite du nettoyage entre 1 et 100.")
        result = self._rpc(self.RPC_STALLED, {"p_limit": limit})
        assert result is not None
        processed = result.get("processed")
        if type(processed) is not int or not 0 <= processed <= limit:
            raise CourseQueueError("Nombre de dossiers rapproches incoherent.")
        return processed


__all__ = [
    "SupabaseCourseQueueRepository", "CourseQueueError", "CourseQueueConflict",
    "CourseQueueLeaseError", "CourseQueueNeedsReview",
]
