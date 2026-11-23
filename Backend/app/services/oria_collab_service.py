"""Lecture de l'espace ORIA Collaboratif (phase 1).

L'accès aux tables est exclusivement effectue cote serveur via service_role.
Chaque appel de l'API a DEJA verifie l'identite Supabase de l'appelant.
Aucun collaborateur ne peut choisir un user_id ou un workspace_id arbitraire.
"""
from __future__ import annotations

from typing import Any

from fastapi import HTTPException

from app.repositories.supabase_credit_repository import SupabaseCreditRepository
from app.services.oria_collab_entitlements import entitlement_for_wallet


class CollaboratifService:
    def __init__(self, supabase_client: Any):
        self.db = supabase_client
        self.credits = SupabaseCreditRepository(supabase_client)

    @staticmethod
    def _first(response: Any) -> dict | None:
        rows = getattr(response, "data", None) or []
        return rows[0] if isinstance(rows, list) and rows else None

    def _wallet_rights(self, owner_user_id: str):
        wallet = self.credits.get_wallet(owner_user_id)
        return entitlement_for_wallet(wallet)

    def status(self, verified_user_id: str) -> dict:
        """Aucun parametre d'identite libre cote frontend."""
        try:
            owned = self._first(
                self.db.table("oria_collab_workspaces")
                .select("id,owner_user_id,created_at")
                .eq("owner_user_id", verified_user_id)
                .limit(1).execute()
            )
            membership = None
            workspace = owned
            if workspace is None:
                membership = self._first(
                    self.db.table("oria_collab_members")
                    .select("id,workspace_id,user_id,role,status")
                    .eq("user_id", verified_user_id)
                    .eq("status", "active").limit(1).execute()
                )
                if membership is not None and membership["status"] == "active":
                    workspace = self._first(
                        self.db.table("oria_collab_workspaces")
                        .select("id,owner_user_id,created_at")
                        .eq("id", membership["workspace_id"])
                        .limit(1).execute()
                    )
            else:
                membership = self._first(
                    self.db.table("oria_collab_members")
                    .select("id,workspace_id,user_id,role,status")
                    .eq("workspace_id", workspace["id"])
                    .eq("user_id", verified_user_id)
                    .limit(1).execute()
                )

            # Un compte non membre et non proprietaire peut avoir un pack Pro/Business.
            owner_id = str(workspace["owner_user_id"]) if workspace else verified_user_id
            rights = self._wallet_rights(owner_id)
            is_owner = bool(workspace and owner_id == verified_user_id)
            is_active_member = bool(membership and membership["status"] == "active")
            if is_owner and not is_active_member:
                # Une absence inattendue de profil proprietaire ferme l'acces.
                raise RuntimeError("collab_owner_membership_missing")

            active_members = 0
            if workspace and (is_owner or is_active_member):
                rows = (
                    self.db.table("oria_collab_members")
                    .select("id,status")
                    .eq("workspace_id", workspace["id"]).execute()
                )
                active_members = sum(1 for row in (rows.data or [])
                                     if row.get("status") == "active")

            # Blocage conservateur si un Business est passe Pro : l'admin
            # doit choisir les membres en phase 2. Pas d'exposition de donnees.
            over_limit = bool(rights.eligible and active_members > rights.seat_limit)
            access_granted = bool(
                rights.eligible and is_active_member
                and (not over_limit or is_owner)
            )

            # Un profil suspendu/banni ne recupere aucun identifiant d'espace.
            visible_workspace = workspace if (is_owner or is_active_member) else None
            return {
                "success": True,
                "enabled": True,
                "phase": 1,
                "eligible": rights.eligible,
                "pack_id": rights.pack_id,
                "seat_limit": rights.seat_limit,
                "is_owner": is_owner,
                "member_status": membership["status"] if membership else None,
                "workspace": visible_workspace,
                "active_profiles": active_members if visible_workspace else 0,
                "over_limit": over_limit if visible_workspace else False,
                "access_granted": access_granted,
                "can_create_workspace": bool(rights.eligible and workspace is None
                                             and membership is None),
            }
        except HTTPException:
            raise
        except Exception as exc:
            # Ne pas divulguer les details SQL, les soldes ou les secrets.
            raise HTTPException(
                status_code=503,
                detail="Espace collaboratif indisponible ou migration SQL non installée.",
            ) from exc

    def create_workspace(self, verified_owner_user_id: str) -> dict:
        """Provisionnement atomique via RPC, revalidation SQL du pack incluse."""
        rights = self._wallet_rights(verified_owner_user_id)
        if not rights.eligible:
            raise HTTPException(
                status_code=403,
                detail="Un pack Pro ou Business actif est nécessaire.",
            )
        try:
            result = self.db.rpc("oria_collab_create_workspace", {
                "p_owner_user_id": verified_owner_user_id,
            }).execute()
            data = getattr(result, "data", None)
            if not isinstance(data, dict) or not data.get("workspace_id"):
                raise RuntimeError("collab_invalid_rpc_response")
            return {"success": True, **data}
        except HTTPException:
            raise
        except Exception as exc:
            code = str(exc).lower()
            if "collab_pack_not_eligible" in code:
                raise HTTPException(status_code=403,
                                    detail="Le pack n'est plus éligible.") from exc
            raise HTTPException(status_code=503,
                                detail="Impossible d'activer l'espace collaboratif.") from exc
