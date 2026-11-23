"""Finances en lecture pour un espace explicitement choisi, service_role seul.

Aucune mutation de crédits et aucun checkout : cette tranche ne peut pas
servir à contourner les anciennes règles mono-espace.
"""
from __future__ import annotations

from typing import Any
from uuid import UUID

from fastapi import HTTPException

_RPC = {
    "wallet": "oria_collab_workspace_wallet_snapshot_v4",
    "events": "oria_collab_workspace_wallet_events_v4",
}


def _uuid(value: str) -> str:
    try:
        return str(UUID(str(value)))
    except (TypeError, ValueError, AttributeError) as exc:
        raise HTTPException(422, "Identifiant invalide.") from exc


class WorkspaceFinanceService:
    def __init__(self, db: Any) -> None:
        self.db = db

    def _call(self, operation: str, actor: str, space: str) -> dict:
        actor_id, space_id = _uuid(actor), _uuid(space)
        try:
            response = self.db.rpc(_RPC[operation], {
                "p_actor_user_id": actor_id,
                "p_workspace_id": space_id,
            }).execute()
            result = getattr(response, "data", None)
            if isinstance(result, list) and len(result) == 1:
                result = result[0]
            if not isinstance(result, dict) or result.get("success") is not True:
                raise ValueError("rpc_response_invalid")
            if result.get("workspace_id") != space_id or result.get("member_user_id") != actor_id:
                raise ValueError("rpc_workspace_identity_invalid")
            return result
        except HTTPException:
            raise
        except Exception as exc:
            if "collab_scope_forbidden" in str(exc).lower():
                raise HTTPException(404, "Espace professionnel inaccessible.") from exc
            raise HTTPException(503, "Données financières momentanément indisponibles.") from exc

    def wallet(self, actor: str, space: str) -> dict:
        return self._call("wallet", actor, space)

    def events(self, actor: str, space: str) -> dict:
        return self._call("events", actor, space)
