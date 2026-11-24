"""P15 — Répartition ASSISTÉE du quota maître, sans mouvement implicite.

Une requête = une transaction PostgreSQL, côté service_role uniquement.
Les UUID proviennent du JWT et du chemin explicitement contrôlé.
"""
from __future__ import annotations

import os
from typing import Any
from uuid import UUID

from fastapi import HTTPException


def _uuid(value: str) -> str:
    try:
        return str(UUID(str(value)))
    except (TypeError, ValueError, AttributeError) as exc:
        raise HTTPException(422, "Identifiant d'espace invalide.") from exc


def _enabled() -> bool:
    return (
        os.getenv("ORIA_COLLABORATIF_ENABLED", "0") == "1"
        and os.getenv("ORIA_COLLAB_WORKSPACE_CONTEXT_ENABLED", "0") == "1"
        and os.getenv("ORIA_COLLAB_ALLOCATION_P15_ENABLED", "0") == "1"
    )


class AllocationService:
    def __init__(self, db: Any):
        self.db = db

    def _call(self, function: str, uid: str, workspace: str, **extra: object) -> dict:
        if not _enabled():
            raise HTTPException(503, "Répartition assistée non activée sur le serveur.")
        owner_id, space_id = _uuid(uid), _uuid(workspace)
        payload = {"p_actor_user_id": owner_id, "p_workspace_id": space_id, **extra}
        try:
            response = self.db.rpc(function, payload).execute()
            value = getattr(response, "data", None)
            if isinstance(value, list) and len(value) == 1:
                value = value[0]
            if not isinstance(value, dict) or value.get("success") is not True:
                raise RuntimeError("collab_p15_invalid_rpc_response")
            if str(value.get("workspace_id")) != space_id:
                raise RuntimeError("collab_p15_wrong_workspace")
            return value
        except HTTPException:
            raise
        except Exception as exc:
            msg = str(exc).lower()
            if "collab_allocation_owner_only" in msg or "collab_allocation_forbidden" in msg:
                raise HTTPException(403, "Répartition réservée au propriétaire de l'espace.") from exc
            if "collab_allocation_stale" in msg or "collab_allocation_period_mismatch" in msg:
                raise HTTPException(409, "Les membres ou le pack ont changé. Actualisez la proposition.") from exc
            if "collab_allocation_equal_forbidden" in msg:
                raise HTTPException(409, "Crédits déjà utilisés ou réservés : choisissez la répartition personnalisée.") from exc
            if "collab_allocation_unavailable" in msg:
                raise HTTPException(409, "Pack inactif ou quotas en attente de régularisation.") from exc
            if "collab_allocation_idempotency_conflict" in msg:
                raise HTTPException(409, "Identifiant de décision déjà utilisé avec un autre contenu.") from exc
            if "collab_allocation_" in msg and any(
                tag in msg for tag in ("invalid", "duplicate", "unknown_member", "member_count", "total_mismatch")
            ):
                raise HTTPException(422, "Répartition invalide : montants, participants ou somme incorrects.") from exc
            if "collab_quota_previous_reservations" in msg:
                raise HTTPException(409, "Réservations d'une période précédente à régulariser.") from exc
            raise HTTPException(503, "Contrôle transactionnel des quotas indisponible. Aucun transfert confirmé.") from exc

    def preview(self, uid: str, workspace: str) -> dict:
        return self._call("oria_collab_allocation_preview_v1", uid, workspace)

    def apply(self, uid: str, workspace: str, *, decision_id: str, mode: str,
              allocations: list[dict], fingerprint: str, pack_activated_at: str) -> dict:
        return self._call(
            "oria_collab_allocation_apply_v1", uid, workspace,
            p_decision_id=_uuid(decision_id), p_mode=mode,
            p_allocations=allocations, p_expected_fingerprint=fingerprint,
            p_expected_pack_activated_at=pack_activated_at,
        )
