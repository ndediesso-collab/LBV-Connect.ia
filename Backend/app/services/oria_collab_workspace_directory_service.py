"""ORIA 6B1 - repertoire d'espaces et renommage, sans credit ni mutation d'adhesion.

Toutes les identites sont validees dans la route via Supabase Auth.
Toutes les RPC restent privees au service_role. La liste filtre par acteur
VERIFIE, jamais par un id de workspace choisi par le navigateur.
"""
from __future__ import annotations

import os
import re
from typing import Any
from uuid import UUID

from fastapi import HTTPException


def _valid_user_id(user_id: str) -> str:
    try:
        return str(UUID(user_id))
    except (TypeError, ValueError, AttributeError) as exc:
        raise HTTPException(401, "Identité ORIA invalide.") from exc


def _rpc(db: Any, function: str, params: dict[str, object]) -> dict:
    try:
        response = db.rpc(function, params).execute()
        result = getattr(response, "data", None)
        if isinstance(result, list) and len(result) == 1:
            result = result[0]
        if not isinstance(result, dict) or result.get("success") is not True:
            raise RuntimeError("collab_workspace_invalid_rpc_response")
        return result
    except HTTPException:
        raise
    except Exception as exc:
        error = str(exc).lower()
        if "collab_workspace_owner_only" in error:
            raise HTTPException(403, "Action réservée au propriétaire de l'espace.") from exc
        if "collab_workspace_name_invalid" in error:
            raise HTTPException(422, "Le nom de l'espace doit compter de 3 à 80 caractères.") from exc
        if "collab_identity_invalid" in error:
            raise HTTPException(401, "Session ORIA invalide.") from exc
        raise HTTPException(503, "Répertoire des espaces indisponible.") from exc


class WorkspaceDirectoryService:
    def __init__(self, db: Any):
        self.db = db

    def list_mine(self, verified_user_id: str) -> dict:
        actor = _valid_user_id(verified_user_id)
        result = _rpc(self.db,
            "oria_collab_workspace_directory_v3" if os.getenv("ORIA_COLLAB_MULTI_ACTIVE", "0") == "1"
            else "oria_collab_workspace_directory_v2", {
            "p_actor_user_id": actor,
        })
        if not isinstance(result.get("workspaces"), list):
            raise HTTPException(503, "Répertoire des espaces invalide.")
        return result

    def rename_mine(self, verified_user_id: str, name: str) -> dict:
        actor = _valid_user_id(verified_user_id)
        cleaned = name.strip() if isinstance(name, str) else ""
        if not 3 <= len(cleaned) <= 80 or re.search(r"[\x00-\x1f\x7f]", cleaned):
            raise HTTPException(422, "Le nom de l'espace doit compter de 3 à 80 caractères.")
        return _rpc(self.db, "oria_collab_workspace_rename_v2", {
            "p_actor_user_id": actor,
            "p_display_name": cleaned,
        })
