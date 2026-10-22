"""Persistence durable et privée des traitements ORIA Cours.

Destination: Backend/app/repositories/supabase_course_job_repository.py

A installer AVEC `ORIA_12_COURSE_JOB_STORE_STAGING.sql` dans une base de test.
Utiliser uniquement un client Supabase côté SERVEUR (service_role) et jamais
transmettre les checkpoints de transcription au navigateur directement.

Le backend `CourseService` exige les méthodes de `CourseJobStore` ; elles sont
implémentées ici. Les trois méthodes de bail (acquire/renew/release) sont
supplémentaires. Un worker DOIT acquérir le bail avant d'appeler les méthodes
payantes `transcribe_submitted_course` et `write_course`. Sans ce bail,
`begin_call` échoue sans jamais appeler le fournisseur.

L'autorité pour l'unicité, l'idempotence, les soldes et les transitions est
PostgreSQL (RPC atomiques), et NON une lecture ou un verrou Python.
"""
from __future__ import annotations

from decimal import Decimal, InvalidOperation, ROUND_HALF_UP
import json
from typing import Any, Mapping
from uuid import UUID, uuid4


class CourseJobStoreError(RuntimeError):
    """Erreur persistante ; ne jamais afficher les détails SQL au client."""


class CourseJobConflict(CourseJobStoreError):
    """Conflit de devis, d'état ou checkpoint non réexécutable."""


class CourseJobLeaseError(CourseJobStoreError):
    """Bail exclusif absent, expiré ou acquis par un autre worker."""


class CourseJobNeedsReconciliation(CourseJobStoreError):
    """L'état de facturation ou un appel fournisseur doit être rapproché."""


class SupabaseCourseJobRepository:
    """`CourseJobStore` basé sur des RPC PostgreSQL serveur atomiques.

    Une instance est destinée à un seul worker, sans partage inter-tâches :
    les jetons de bail sont conservés sur cette instance. La vérification du
    bail est toujours refaite dans les transactions SQL.
    """

    RPC_COMMAND = "oria_course_job_command"
    RPC_GET = "oria_course_job_get"
    RPC_GET_CALL = "oria_course_job_get_call"
    STAGES = frozenset({"transcription", "document"})
    RESERVATION_STATES = frozenset({"reserved"})
    MAX_CALL_INDEX = 119
    MAX_CHECKPOINT_BYTES = 1_000_000
    MAX_OUTPUT_BYTES = 6_000_000
    MIN_LEASE_SECONDS = 60
    MAX_LEASE_SECONDS = 3600

    def __init__(self, client: Any):
        if client is None or not callable(getattr(client, "rpc", None)):
            raise ValueError("Client Supabase serveur obligatoire.")
        self.client = client
        self._lease_tokens: dict[tuple[str, str], str] = {}

    @staticmethod
    def _uuid(value: str, name: str) -> str:
        try:
            if isinstance(value, bool):
                raise ValueError()
            return str(UUID(str(value)))
        except (ValueError, TypeError, AttributeError) as exc:
            raise ValueError(f"{name} doit être un UUID valide.") from exc

    @classmethod
    def _ids(cls, user_id: str, course_id: str) -> tuple[str, str]:
        return cls._uuid(user_id, "user_id"), cls._uuid(course_id, "course_id")

    @classmethod
    def _stage(cls, stage: str) -> str:
        if stage not in cls.STAGES:
            raise ValueError("Etape du cours invalide.")
        return stage

    @classmethod
    def _index(cls, index: int) -> int:
        if type(index) is not int or not 0 <= index <= cls.MAX_CALL_INDEX:
            raise ValueError("Index d'appel hors limites.")
        return index

    @staticmethod
    def _positive_credits(credits: int) -> int:
        if type(credits) is not int or credits <= 0 or credits > 2_147_483_647:
            raise ValueError("Crédits réglés invalides.")
        return credits

    @staticmethod
    def _nonnegative_amount(value: str) -> str:
        try:
            x = Decimal(str(value))
        except (TypeError, ValueError, InvalidOperation) as exc:
            raise ValueError("Coût API non numérique.") from exc
        if not x.is_finite() or x < 0 or x >= Decimal("1e14"):
            raise ValueError("Coût API hors limites.")
        # Le schema budget stocke NUMERIC(16,6) : PostgreSQL arrondit le
        # montant a 6 decimales. Reproduire ce format pour que la verification
        # de settlement entre les deux tables compare exactement les memes
        # valeurs, y compris lorsque le calcul de tokens a plus de 6 chiffres.
        normalized = x.quantize(Decimal("0.000001"), rounding=ROUND_HALF_UP)
        return str(normalized)

    @staticmethod
    def _json_object(value: Mapping[str, Any], *, limit: int) -> dict[str, Any]:
        if not isinstance(value, dict):
            raise ValueError("Objet JSON obligatoire.")
        try:
            encoded = json.dumps(value, ensure_ascii=False, sort_keys=True,
                                 separators=(",", ":"), allow_nan=False)
            decoded = json.loads(encoded)
        except (TypeError, ValueError, OverflowError) as exc:
            raise ValueError("Données non sérialisables en JSON.") from exc
        if len(encoded.encode("utf-8")) > limit:
            raise ValueError("Données de checkpoint trop volumineuses.")
        return decoded

    @staticmethod
    def _response_data(response: Any, *, allow_null: bool = False) -> dict[str, Any] | None:
        error = (response.get("error") if isinstance(response, dict)
                 else getattr(response, "error", None))
        if error:
            raise CourseJobStoreError("RPC ORIA Cours refusée.")
        data = response.get("data") if isinstance(response, dict) else getattr(response, "data", None)
        if isinstance(data, list):
            if len(data) > 1:
                raise CourseJobStoreError("Plusieurs réponses SQL inattendues.")
            data = data[0] if data else None
        if data is None and allow_null:
            return None
        if not isinstance(data, dict):
            raise CourseJobStoreError("Résultat Supabase inattendu.")
        return data

    def _rpc(self, rpc_name: str, payload: dict[str, Any], *, allow_null: bool = False) -> dict[str, Any] | None:
        try:
            result = self.client.rpc(rpc_name, payload).execute()
        except Exception as exc:
            # Les codes remontés par PostgreSQL n'exposent aucune donnée privée.
            msg = str(exc).lower()
            if "oria_course_job_lease" in msg:
                raise CourseJobLeaseError("Bail du worker indisponible ou expiré.") from exc
            if "oria_course_job_call_started" in msg or "oria_course_job_conflict" in msg:
                raise CourseJobConflict("Opération déjà engagée ou état incompatible.") from exc
            if "oria_course_job_reconciliation" in msg:
                raise CourseJobNeedsReconciliation("Rapprochement du cours nécessaire.") from exc
            raise CourseJobStoreError("Opération du registre ORIA Cours non confirmée.") from exc
        return self._response_data(result, allow_null=allow_null)

    def _command(self, uid: str, cid: str, command: str, data: dict[str, Any]) -> dict[str, Any]:
        answer = self._rpc(self.RPC_COMMAND, {
            "p_user_id": uid, "p_course_id": cid,
            "p_command": command, "p_data": data,
        })
        assert answer is not None
        if str(answer.get("user_id") or "") != uid or str(answer.get("course_id") or "") != cid:
            raise CourseJobStoreError("La RPC a retourné le mauvais propriétaire ou cours.")
        return answer

    def get_job(self, *, user_id: str, course_id: str) -> dict[str, Any] | None:
        uid, cid = self._ids(user_id, course_id)
        row = self._rpc(self.RPC_GET, {"p_user_id": uid, "p_course_id": cid}, allow_null=True)
        if row is None:
            return None
        if str(row.get("user_id") or "") != uid or str(row.get("course_id") or "") != cid:
            raise CourseJobStoreError("Réponse SQL incohérente : propriétaire du cours.")
        return row

    def ensure_job(self, *, user_id: str, course_id: str,
                   plan: dict[str, Any]) -> dict[str, Any]:
        uid, cid = self._ids(user_id, course_id)
        validated = self._json_object(plan, limit=40_000)
        if validated.get("user_id") != uid or validated.get("course_id") != cid:
            raise ValueError("Le plan ne correspond pas au cours et à son propriétaire.")
        return self._command(uid, cid, "ensure", {"plan": validated})

    def update_reservation(self, *, user_id: str, course_id: str,
                           stage: str, status: str) -> None:
        uid, cid = self._ids(user_id, course_id)
        if status not in self.RESERVATION_STATES:
            raise ValueError("Le statut de réservation est fixé par la base SQL.")
        self._command(uid, cid, "mark_reserved", {"stage": self._stage(stage)})

    def begin_call(self, *, user_id: str, course_id: str, stage: str, index: int) -> None:
        uid, cid = self._ids(user_id, course_id)
        self._command(uid, cid, "begin_call", {
            "stage": self._stage(stage), "index": self._index(index),
            "lease_token": self._require_lease(uid, cid),
        })

    def finish_call(self, *, user_id: str, course_id: str, stage: str,
                    index: int, result: dict[str, Any]) -> None:
        uid, cid = self._ids(user_id, course_id)
        saved = self._json_object(result, limit=self.MAX_CHECKPOINT_BYTES)
        self._command(uid, cid, "finish_call", {
            "stage": self._stage(stage), "index": self._index(index),
            "result": saved, "lease_token": self._require_lease(uid, cid),
        })

    def get_call(self, *, user_id: str, course_id: str,
                 stage: str, index: int) -> dict[str, Any] | None:
        uid, cid = self._ids(user_id, course_id)
        row = self._rpc(self.RPC_GET_CALL, {
            "p_user_id": uid, "p_course_id": cid,
            "p_stage": self._stage(stage), "p_call_index": self._index(index),
        }, allow_null=True)
        return row

    def set_settled(self, *, user_id: str, course_id: str, stage: str,
                    credits: int, api_cost_xaf: str) -> None:
        uid, cid = self._ids(user_id, course_id)
        self._command(uid, cid, "mark_settled", {
            "stage": self._stage(stage),
            "credits": self._positive_credits(credits),
            "api_cost_xaf": self._nonnegative_amount(api_cost_xaf),
            "lease_token": self._require_lease(uid, cid),
        })

    def finish(self, *, user_id: str, course_id: str,
               result: dict[str, Any]) -> None:
        uid, cid = self._ids(user_id, course_id)
        saved = self._json_object(result, limit=self.MAX_OUTPUT_BYTES)
        if not isinstance(saved.get("artifact"), dict) or not saved["artifact"]:
            raise ValueError("Un artifact privé réel est obligatoire avant completion.")
        self._command(uid, cid, "finish_job", {
            "output": saved, "lease_token": self._require_lease(uid, cid),
        })

    def flag_reconciliation(self, *, user_id: str, course_id: str,
                            detail: str) -> None:
        uid, cid = self._ids(user_id, course_id)
        # Un texte de diagnostic interne court, jamais d'audio, de transcript
        # ou de réponse brute du fournisseur dans ce champ.
        description = " ".join(str(detail or "").split())[:400]
        if not description:
            raise ValueError("Motif de rapprochement obligatoire.")
        self._command(uid, cid, "flag_reconciliation", {"detail": description})

    def _require_lease(self, uid: str, cid: str) -> str:
        token = self._lease_tokens.get((uid, cid))
        if not token:
            raise CourseJobLeaseError("Acquérir le bail avant un traitement payant.")
        return token

    @classmethod
    def _ttl(cls, ttl_seconds: int) -> int:
        if type(ttl_seconds) is not int or not cls.MIN_LEASE_SECONDS <= ttl_seconds <= cls.MAX_LEASE_SECONDS:
            raise ValueError("Le TTL du bail doit être compris entre 60 et 3600 s.")
        return ttl_seconds

    def acquire_lease(self, *, user_id: str, course_id: str,
                      ttl_seconds: int = 900) -> str:
        """Acquiert un bail exclusif. Ne relance JAMAIS un appel 'started'."""
        uid, cid = self._ids(user_id, course_id)
        ttl = self._ttl(ttl_seconds)
        token = self._lease_tokens.get((uid, cid)) or str(uuid4())
        self._command(uid, cid, "claim", {"lease_token": token, "ttl_seconds": ttl})
        self._lease_tokens[(uid, cid)] = token
        return token

    def renew_lease(self, *, user_id: str, course_id: str,
                    ttl_seconds: int = 900) -> None:
        uid, cid = self._ids(user_id, course_id)
        self._command(uid, cid, "heartbeat", {
            "lease_token": self._require_lease(uid, cid),
            "ttl_seconds": self._ttl(ttl_seconds),
        })

    def release_lease(self, *, user_id: str, course_id: str) -> None:
        uid, cid = self._ids(user_id, course_id)
        token = self._require_lease(uid, cid)
        self._command(uid, cid, "release_lease", {"lease_token": token})
        self._lease_tokens.pop((uid, cid), None)


__all__ = [
    "SupabaseCourseJobRepository", "CourseJobStoreError", "CourseJobConflict",
    "CourseJobLeaseError", "CourseJobNeedsReconciliation",
]
