"""File durable ORIA Cours, pilotée exclusivement par les RPC PostgreSQL.

Les appels fournisseurs sont exécutés par CourseWorker, jamais ici. Les
reprises sont exclusivement autorisées par les contrôles atomiques SQL.
"""
from __future__ import annotations

from typing import Any
from uuid import UUID, uuid4


class CourseQueueError(RuntimeError):
    """Problème de file ; aucune donnée privée ou SQL n'est rendue publique."""


class CourseQueueConflict(CourseQueueError):
    """État ou propriétaire incompatible avec la transition demandée."""


class CourseQueueLeaseError(CourseQueueError):
    """Le consommateur ne détient plus le bail PostgreSQL."""


class CourseQueueNeedsReview(CourseQueueError):
    """Un traitement potentiellement facturé nécessite une revue humaine."""


class SupabaseCourseQueueRepository:
    """Adaptateur strict SQL, jamais de file locale ou de réessai implicite.

    delivery_attempts=1 : premier traitement audio.
    delivery_attempts=2 : reprise explicitement permise par SQL après audio
    réglé et sous réservation documentaire validée. Les appels « started »
    ne sont jamais relancés. Une troisième livraison reste refusée.
    """

    RPC_ENQUEUE = "oria_course_queue_enqueue"
    RPC_CLAIM = "oria_course_queue_claim"
    RPC_HEARTBEAT = "oria_course_queue_heartbeat"
    RPC_ACK = "oria_course_queue_ack"
    RPC_REVIEW = "oria_course_queue_review"
    RPC_PAUSE_CREDITS = "oria_course_queue_pause_for_credits"
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
            raise ValueError(f"{name} doit être un UUID valide.") from exc

    @classmethod
    def _ttl(cls, value: int) -> int:
        if type(value) is not int or not cls.MIN_LEASE_SECONDS <= value <= cls.MAX_LEASE_SECONDS:
            raise ValueError("Durée du bail entre 60 et 3600 secondes.")
        return value

    @staticmethod
    def _unpack(result: Any, *, allow_null: bool = False) -> dict[str, Any] | None:
        error = result.get("error") if isinstance(result, dict) else getattr(result, "error", None)
        if error:
            SupabaseCourseQueueRepository._raise_rpc_error(error)
        data = result.get("data") if isinstance(result, dict) else getattr(result, "data", None)
        if isinstance(data, list):
            if len(data) != 1:
                if not data and allow_null:
                    return None
                raise CourseQueueError("Nombre de résultats SQL inattendu.")
            data = data[0]
        if data is None and allow_null:
            return None
        if not isinstance(data, dict):
            raise CourseQueueError("Structure du résultat SQL invalide.")
        return data

    @staticmethod
    def _raise_rpc_error(error: Any) -> None:
        value = str(error).lower()
        if "oria_course_queue_lease" in value:
            raise CourseQueueLeaseError("Bail de la file perdu ou expiré.")
        if "oria_course_queue_review" in value:
            raise CourseQueueNeedsReview("Traitement bloqué pour revue manuelle.")
        if "oria_course_queue_conflict" in value:
            raise CourseQueueConflict("Transition de file incompatible.")
        raise CourseQueueError("Opération de file durable non confirmée.")

    def _rpc(self, name: str, params: dict[str, Any], *, allow_null: bool = False) -> dict[str, Any] | None:
        try:
            response = self.client.rpc(name, params).execute()
        except Exception as exc:
            try:
                self._raise_rpc_error(exc)
            except CourseQueueError as typed:
                raise typed from exc
            raise CourseQueueError("Opération de file durable non confirmée.") from exc
        return self._unpack(response, allow_null=allow_null)

    @staticmethod
    def _expect_owner(row: dict[str, Any], *, user_id: str, course_id: str) -> dict[str, Any]:
        if str(row.get("user_id")) != user_id or str(row.get("course_id")) != course_id:
            raise CourseQueueError("Réponse SQL ne correspondant pas au cours attendu.")
        return row

    @staticmethod
    def _expect_token(row: dict[str, Any], *, token: str) -> dict[str, Any]:
        if str(row.get("lease_token")) != token:
            raise CourseQueueLeaseError("Identité du bail SQL non confirmée.")
        return row

    @staticmethod
    def _expect_no_lease(row: dict[str, Any], *, operation: str) -> None:
        if row.get("lease_token") is not None or row.get("lease_expires_at") is not None:
            raise CourseQueueLeaseError(f"Bail de file non libéré après {operation}.")

    @staticmethod
    def _expect_supported_delivery(row: dict[str, Any]) -> None:
        """Les deux parcours prévus par les RPC, sans réessai illimité."""
        attempts = row.get("delivery_attempts")
        if type(attempts) is not int or attempts not in (1, 2):
            raise CourseQueueNeedsReview("Livraison hors protocole : revue nécessaire.")

    @staticmethod
    def _expect_first_delivery(row: dict[str, Any]) -> None:
        # La pause awaiting_credits n'est possible qu'après la première passe.
        if type(row.get("delivery_attempts")) is not int or row["delivery_attempts"] != 1:
            raise CourseQueueNeedsReview("Pause de crédits hors première livraison.")

    def enqueue_once(self, user_id: str, course_id: str) -> dict[str, Any]:
        uid = self._uuid(user_id, "user_id")
        cid = self._uuid(course_id, "course_id")
        row = self._rpc(self.RPC_ENQUEUE, {"p_user_id": uid, "p_course_id": cid})
        assert row is not None
        self._expect_owner(row, user_id=uid, course_id=cid)
        status = row.get("status")
        if status not in {"queued", "running", "completed"}:
            raise CourseQueueNeedsReview("Cours non dispatchable sans revue humaine.")
        if status in {"queued", "completed"}:
            self._expect_no_lease(row, operation="dispatch")
        elif not row.get("lease_token") or not row.get("lease_expires_at"):
            raise CourseQueueLeaseError("Livraison running sans bail confirmé.")
        return row

    def get_entry(self, *, user_id: str, course_id: str) -> dict[str, Any] | None:
        uid = self._uuid(user_id, "user_id")
        cid = self._uuid(course_id, "course_id")
        row = self._rpc(self.RPC_GET, {"p_user_id": uid, "p_course_id": cid}, allow_null=True)
        return self._expect_owner(row, user_id=uid, course_id=cid) if row is not None else None

    def claim_next(self, *, lease_token: str | None = None, ttl_seconds: int = 900) -> dict[str, Any] | None:
        token = self._uuid(lease_token or str(uuid4()), "lease_token")
        row = self._rpc(self.RPC_CLAIM, {
            "p_lease_token": token, "p_ttl_seconds": self._ttl(ttl_seconds),
        }, allow_null=True)
        if row is None:
            return None
        uid = self._uuid(row.get("user_id"), "user_id retourné")
        cid = self._uuid(row.get("course_id"), "course_id retourné")
        self._expect_owner(row, user_id=uid, course_id=cid)
        self._expect_token(row, token=token)
        if row.get("status") != "running" or not row.get("lease_expires_at"):
            raise CourseQueueError("Le bail réclamé n'a pas été confirmé.")
        self._expect_supported_delivery(row)
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
            raise CourseQueueLeaseError("Renouvellement du bail non confirmé.")
        self._expect_supported_delivery(row)
        return row

    def acknowledge_success(self, *, user_id: str, course_id: str, lease_token: str) -> dict[str, Any]:
        uid, cid = self._uuid(user_id, "user_id"), self._uuid(course_id, "course_id")
        token = self._uuid(lease_token, "lease_token")
        row = self._rpc(self.RPC_ACK, {
            "p_user_id": uid, "p_course_id": cid, "p_lease_token": token,
        })
        assert row is not None
        self._expect_owner(row, user_id=uid, course_id=cid)
        if row.get("status") != "completed":
            raise CourseQueueError("ACK non confirmé.")
        self._expect_no_lease(row, operation="ACK")
        return row

    def pause_for_credits(self, *, user_id: str, course_id: str,
                          lease_token: str) -> dict[str, Any]:
        """RPC atomique après transcription réglée, aucun redébit."""
        uid = self._uuid(user_id, "user_id")
        cid = self._uuid(course_id, "course_id")
        token = self._uuid(lease_token, "lease_token")
        row = self._rpc(self.RPC_PAUSE_CREDITS, {
            "p_user_id": uid, "p_course_id": cid, "p_lease_token": token,
        })
        assert row is not None
        self._expect_owner(row, user_id=uid, course_id=cid)
        if (row.get("status") != "awaiting_credits"
                or row.get("job_status") != "awaiting_credits"):
            raise CourseQueueError("Pause de crédits non confirmée pour la file et le job.")
        self._expect_no_lease(row, operation="pause crédits")
        self._expect_first_delivery(row)
        return row

    def flag_for_review(self, *, user_id: str, course_id: str,
                        lease_token: str, reason: str = "execution_interrompue") -> dict[str, Any]:
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
            raise CourseQueueError("Mise en revue non confirmée.")
        self._expect_no_lease(row, operation="revue")
        return row

    def reconcile_stalled(self, *, limit: int = 50) -> int:
        if type(limit) is not int or not 1 <= limit <= 100:
            raise ValueError("Limite du nettoyage entre 1 et 100.")
        result = self._rpc(self.RPC_STALLED, {"p_limit": limit})
        assert result is not None
        processed = result.get("processed")
        if type(processed) is not int or not 0 <= processed <= limit:
            raise CourseQueueError("Nombre de dossiers rapprochés incohérent.")
        return processed


__all__ = [
    "SupabaseCourseQueueRepository", "CourseQueueError", "CourseQueueConflict",
    "CourseQueueLeaseError", "CourseQueueNeedsReview",
]
