"""API additive ORIA Collaboratif — phase 1 uniquement.

Ne pas importer les routeurs historiques dans ce module : ils continuent
sans changement. Un token Supabase Auth DISTINCT est requis par utilisateur.
"""
import os
from uuid import UUID

from fastapi import APIRouter, Header, HTTPException

from app.core.supabase import supabase
from app.services.oria_collab_service import CollaboratifService


router = APIRouter(prefix="/collaboratif", tags=["ORIA Collaboratif"])


def _enabled() -> bool:
    # OFF par defaut : activer sur staging apres migration SQL.
    return os.getenv("ORIA_COLLABORATIF_ENABLED", "0").strip() == "1"


def _identity(user_id: str | None, authorization: str | None) -> str:
    """On ne fait jamais confiance au header user-id non authentifie."""
    if not user_id or not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(status_code=401, detail="Session ORIA requise.")
    token = authorization[7:].strip()
    if not token:
        raise HTTPException(status_code=401, detail="Session ORIA requise.")
    try:
        user_id = str(UUID(user_id))
        auth_user = supabase.auth.get_user(token).user
        verified = str(UUID(str(auth_user.id))) if auth_user else ""
    except Exception as exc:
        raise HTTPException(status_code=401, detail="Session invalide.") from exc
    if verified != user_id:
        raise HTTPException(status_code=403, detail="Identité non autorisée.")
    return verified


@router.get("/status")
def status(
    user_id: str | None = Header(default=None, alias="user-id"),
    authorization: str | None = Header(default=None, alias="authorization"),
):
    verified_id = _identity(user_id, authorization)
    if not _enabled():
        return {
            "success": True, "enabled": False, "phase": 1,
            "eligible": False, "pack_id": None, "seat_limit": 0,
            "workspace": None, "access_granted": False,
            "can_create_workspace": False,
        }
    return CollaboratifService(supabase).status(verified_id)


@router.post("/workspace", status_code=201)
def create_workspace(
    user_id: str | None = Header(default=None, alias="user-id"),
    authorization: str | None = Header(default=None, alias="authorization"),
):
    verified_id = _identity(user_id, authorization)
    if not _enabled():
        raise HTTPException(status_code=503,
                            detail="ORIA Collaboratif n'est pas encore activé.")
    # Aucun user_id, role, pack ou workspace_id fourni en body n'est accepte.
    return CollaboratifService(supabase).create_workspace(verified_id)
