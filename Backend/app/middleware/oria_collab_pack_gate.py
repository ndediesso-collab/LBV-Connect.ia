"""ORIA Collaboratif - verrouillage HTTP central par pack DU PROPRIETAIRE.

Ce middleware protege les routes modernes /workspaces/{id} et les anciennes
routes mono-espace, avant toute lecture, signature de fichier ou mutation.
Il est monte AVANT CORSMiddleware dans main.py, afin que les erreurs 403
conservent les en-tetes CORS. Aucun credit n'est debite.

Les endpoints de decouverte (annuaire, status, creation) restent disponibles
pour informer l'utilisateur de la suspension et lui permettre de renouveler.
Les endpoints d'acceptation d'invitations sont toujours soumis aux RPC SQL
atomiques existantes, qui doivent revalider l'eligibilite lors de l'acceptation.
"""
from __future__ import annotations

import logging
from dataclasses import dataclass
from uuid import UUID

from fastapi import HTTPException, Request
from fastapi.responses import JSONResponse
from starlette.concurrency import run_in_threadpool
from starlette.middleware.base import BaseHTTPMiddleware

from app.services.oria_collab_entitlements import entitlement_for_wallet

logger = logging.getLogger("oria.collab.pack_gate")

# Ces routes ne fournissent aucun contenu d'espace. Le statut/annuaire
# restent visibles en mode bloque pour proposer une reactivation.
EXEMPT = frozenset({
    "/collaboratif/status",
    "/collaboratif/workspace",
    "/collaboratif/workspaces",
    "/collaboratif/personal-wallet",
    "/collaboratif/personal-wallet/reconcile",
    "/collaboratif/share-invitations/preview",
    "/collaboratif/share-invitations/accept",
    "/collaboratif/email-invitations/preview",
    "/collaboratif/email-invitations/accept",
    "/collaboratif/invitations/accept",  # Acceptation historique: RPC SQL atomique.
})


def classify_path(path: str) -> tuple[str, str | None]:
    """Retourne outside/exempt/scoped/legacy; ne devine jamais un espace."""
    path = path.rstrip("/") or "/"
    if path != "/collaboratif" and not path.startswith("/collaboratif/"):
        return "outside", None
    if path == "/collaboratif" or path in EXEMPT:
        return "exempt", None
    parts = path.strip("/").split("/")
    if len(parts) >= 3 and parts[1] == "workspaces" and parts[2] != "mine":
        try:
            return "scoped", str(UUID(parts[2]))
        except (ValueError, TypeError, AttributeError):
            # Un ID malforme n'ouvre jamais l'acces a une ancienne route.
            return "invalid", None
    return "legacy", None


def _first(response):
    data = getattr(response, "data", None)
    if isinstance(data, dict):
        return data
    return data[0] if isinstance(data, list) and data else None


@dataclass(frozen=True)
class GateDecision:
    allowed: bool
    status: int
    code: str
    is_owner: bool = False


def check_workspace(db, actor: str, workspace_id: str, wallet_getter=None) -> GateDecision:
    """Verifie appartenance active PUIS portefeuille courant du proprietaire.

    Les requetes sont reevaluees a chaque appel, sans cache de droits.
    Si Supabase echoue, le middleware retourne 503 (jamais un succes).
    """
    member = _first(
        db.table("oria_collab_members")
        .select("id,role,status")
        .eq("workspace_id", workspace_id)
        .eq("user_id", actor)
        .eq("status", "active")
        .limit(1).execute()
    )
    if not member:
        return GateDecision(False, 404, "COLLAB_WORKSPACE_NOT_FOUND")

    workspace = _first(
        db.table("oria_collab_workspaces")
        .select("id,owner_user_id")
        .eq("id", workspace_id)
        .limit(1).execute()
    )
    if not workspace or not workspace.get("owner_user_id"):
        return GateDecision(False, 404, "COLLAB_WORKSPACE_NOT_FOUND")

    owner_id = str(workspace["owner_user_id"])
    is_owner = owner_id == actor
    if is_owner != (member.get("role") == "owner"):
        return GateDecision(False, 403, "COLLAB_MEMBERSHIP_INCONSISTENT")

    if wallet_getter is None:
        from app.repositories.supabase_credit_repository import SupabaseCreditRepository
        wallet_getter = SupabaseCreditRepository(db).get_wallet
    rights = entitlement_for_wallet(wallet_getter(owner_id))
    if not rights.eligible:
        return GateDecision(False, 403, "COLLAB_OWNER_PACK_REQUIRED", is_owner)
    # Conserver la regle deja presente dans l'ancienne API : apres un passage
    # Business -> Pro, les membres attendent la regularisation des places.
    # L'admin reste admis pour gerer et suspendre les profils excedentaires.
    if not is_owner:
        active_rows = (
            db.table("oria_collab_members").select("id")
            .eq("workspace_id", workspace_id)
            .eq("status", "active")
            .limit(rights.seat_limit + 1).execute()
        )
        if len(getattr(active_rows, "data", None) or []) > rights.seat_limit:
            return GateDecision(False, 403, "COLLAB_CAPACITY_EXCEEDED", False)
    return GateDecision(True, 200, "OK", is_owner)


def legacy_workspace_for_actor(db, actor: str) -> str | None:
    """Routes historiques: jamais selectionner arbitrairement un espace."""
    rows = (
        db.table("oria_collab_members")
        .select("workspace_id")
        .eq("user_id", actor)
        .eq("status", "active")
        .limit(2).execute()
    )
    items = getattr(rows, "data", None) or []
    if len(items) > 1:
        raise HTTPException(409, "Selectionnez un espace precis pour continuer.")
    return str(items[0]["workspace_id"]) if items else None


def _decision_response(decision: GateDecision, workspace_id: str | None = None):
    if decision.code == "COLLAB_OWNER_PACK_REQUIRED":
        detail = (
            "Votre espace ORIA Collaboratif est suspendu : un pack Pro ou Business actif est requis. "
            "Vos groupes, messages et fichiers restent conserves."
            if decision.is_owner else
            "Cet espace ORIA Collaboratif est temporairement suspendu : "
            "le proprietaire doit activer un pack Pro ou Business."
        )
    elif decision.code == "COLLAB_CAPACITY_EXCEEDED":
        detail = "Le nombre de profils actifs dépasse la capacité de ce pack. Contactez le propriétaire."
    elif decision.code == "COLLAB_WORKSPACE_NOT_FOUND":
        detail = "Espace ou profil professionnel inaccessible."
    else:
        detail = "Autorisation professionnelle invalide."
    payload = {
        "detail": detail,
        "code": decision.code,
        "is_owner": decision.is_owner,
        "workspace_id": workspace_id,
    }
    return JSONResponse(status_code=decision.status, content=payload,
                        headers={"Cache-Control": "no-store"})


class OriaCollabOwnerPackGateMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        kind, workspace = classify_path(request.url.path)
        if kind in ("outside", "exempt") or request.method == "OPTIONS":
            return await call_next(request)
        if kind == "invalid":
            return _decision_response(GateDecision(False, 404, "COLLAB_WORKSPACE_NOT_FOUND"))

        # L'identite provient TOUJOURS du JWT Supabase valide, jamais du body.
        from app.route.collaboratif import _identity
        from app.core.supabase import supabase
        try:
            actor = await run_in_threadpool(
                _identity, request.headers.get("user-id"),
                request.headers.get("authorization"),
            )
            if workspace is None:
                workspace = await run_in_threadpool(legacy_workspace_for_actor, supabase, actor)
                if workspace is None:
                    return _decision_response(
                        GateDecision(False, 403, "COLLAB_NO_ACTIVE_MEMBERSHIP"))
            decision = await run_in_threadpool(check_workspace, supabase, actor, workspace)
        except HTTPException as exc:
            return JSONResponse(status_code=exc.status_code,
                                content={"detail": str(exc.detail)},
                                headers={"Cache-Control": "no-store"})
        except Exception:
            logger.exception("Pack gate: verification Supabase impossible")
            return JSONResponse(status_code=503,
                                content={"detail": "Verification des droits collaboratifs indisponible.",
                                         "code": "COLLAB_GATE_UNAVAILABLE"},
                                headers={"Cache-Control": "no-store"})

        if not decision.allowed:
            return _decision_response(decision, workspace)
        return await call_next(request)
