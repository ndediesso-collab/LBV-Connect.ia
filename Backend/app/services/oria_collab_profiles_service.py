"""Phase 2 — serveur uniquement. Toutes les mutations passent par des RPC SQL atomiques.

Aucune confiance dans un workspace_id / role / telephone fourni par le navigateur.
Le token est vérifié en amont via _identity() dans la route.
"""
from __future__ import annotations

import hashlib
import re
import secrets
from typing import Any
from uuid import UUID

from fastapi import HTTPException

from app.repositories.supabase_credit_repository import SupabaseCreditRepository
from app.services.oria_collab_entitlements import entitlement_for_wallet

PHONE = re.compile(r"^\+[1-9][0-9]{7,14}$")
AVATARS = {"ink", "stone", "paper", "slate", "silver", "carbon"}


def valid_phone(value: str) -> str:
    phone = re.sub(r"[\s().-]", "", value or "")
    if not PHONE.fullmatch(phone):
        raise HTTPException(422, "Numéro international invalide (+241XXXXXXXX, par exemple).")
    return phone


def valid_name(value: str) -> str:
    name = (value or "").strip()
    if not 1 <= len(name) <= 60 or any(ord(c) < 32 for c in name):
        raise HTTPException(422, "Le prénom et le nom doivent contenir 1 à 60 caractères.")
    return name


def valid_avatar(value: str) -> str:
    if value not in AVATARS:
        raise HTTPException(422, "Avatar non autorisé.")
    return value


def _first(resp: Any) -> dict | None:
    rows = getattr(resp, "data", None) or []
    return rows[0] if isinstance(rows, list) and rows else None


class CollabProfilesService:
    def __init__(self, db: Any):
        self.db = db
        self.credits = SupabaseCreditRepository(db)

    def _context(self, user_id: str, owner_required: bool = False,
                 eligible_required: bool = True) -> dict:
        """Vérifie l'appartenance + le statut à chaque requête."""
        try:
            owner = _first(self.db.table("oria_collab_workspaces")
                           .select("id,owner_user_id")
                           .eq("owner_user_id", user_id).limit(1).execute())
            member = None
            if owner:
                member = _first(self.db.table("oria_collab_members")
                                .select("id,workspace_id,user_id,role,status")
                                .eq("workspace_id", owner["id"])
                                .eq("user_id", user_id).limit(1).execute())
                workspace = owner
            else:
                member = _first(self.db.table("oria_collab_members")
                                .select("id,workspace_id,user_id,role,status")
                                .eq("user_id", user_id).limit(1).execute())
                workspace = (_first(self.db.table("oria_collab_workspaces")
                                    .select("id,owner_user_id")
                                    .eq("id", member["workspace_id"]).limit(1).execute())
                             if member else None)
            if not workspace or not member:
                raise HTTPException(403, "Aucun profil professionnel autorisé.")
            is_owner = workspace["owner_user_id"] == user_id
            if is_owner != (member["role"] == "owner"):
                raise HTTPException(403, "Identité professionnelle incohérente.")
            if member["status"] != "active":
                raise HTTPException(403, "Ce profil professionnel est suspendu ou banni.")
            if owner_required and not is_owner:
                raise HTTPException(403, "Action réservée à l'administrateur.")
            rights = entitlement_for_wallet(self.credits.get_wallet(str(workspace["owner_user_id"])))
            if eligible_required and not rights.eligible:
                raise HTTPException(403, "Pack Pro ou Business actif nécessaire.")
            # Lors d'un downgrade Business -> Pro, seuls les admins peuvent
            # gérer et suspendre les profils excédentaires. Aucun membre ne
            # peut accéder au contenu collaboratif tant que le quota est dépassé.
            active_rows = (self.db.table("oria_collab_members")
                           .select("id,status")
                           .eq("workspace_id", workspace["id"])
                           .eq("status", "active").execute()).data or []
            if not is_owner and rights.eligible and len(active_rows) > rights.seat_limit:
                raise HTTPException(403, "Trop de profils actifs pour ce pack : régularisation nécessaire.")
            return {
                "workspace_id": str(workspace["id"]),
                "owner_user_id": str(workspace["owner_user_id"]),
                "is_owner": is_owner,
                "seat_limit": rights.seat_limit,
                "pack_id": rights.pack_id,
                "eligible": rights.eligible,
                "user_id": user_id,
            }
        except HTTPException:
            raise
        except Exception as exc:
            raise HTTPException(503, "Lecture des profils indisponible.") from exc

    def _rpc(self, name: str, params: dict) -> dict:
        try:
            res = self.db.rpc(name, params).execute()
            value = getattr(res, "data", None)
            if not isinstance(value, dict):
                raise RuntimeError("collab_bad_rpc_response")
            return value
        except Exception as exc:
            error = str(exc).lower()
            mapping = (
                ("collab_seat_limit_reached", 409, "Toutes les places sont occupées ou réservées."),
                ("collab_phone_already_member", 409, "Ce numéro possède déjà un profil dans cet espace."),
                ("collab_invitation_unavailable", 410, "Cette invitation est expirée, révoquée ou utilisée."),
                ("collab_invitation_invalid", 404, "Invitation introuvable."),
                ("collab_phone_not_verified", 403, "Le téléphone authentifié ne correspond pas à l'invitation ou n'est pas vérifié."),
                ("collab_user_already_member", 409, "Ce compte est déjà lié à un espace professionnel."),
                ("collab_member_banned", 403, "Ce collaborateur a été banni."),
                ("collab_pack_not_eligible", 403, "Pack Pro ou Business actif nécessaire."),
                ("collab_member_not_found", 404, "Profil professionnel introuvable."),
                ("collab_member_inactive", 403, "Profil inactif."),
                ("collab_forbidden", 403, "Action non autorisée."),
                ("collab_accept_invalid", 422, "Profil incomplet ou consentement de supervision absent."),
                ("collab_profile_invalid", 422, "Données du profil invalides."),
                ("collab_status_invalid", 422, "Statut non autorisé."),
                ("collab_invite_invalid", 422, "Invitation invalide."),
            )
            for needle, status, message in mapping:
                if needle in error:
                    raise HTTPException(status, message) from exc
            raise HTTPException(503, "Opération professionnelle indisponible.") from exc

    def list_profiles(self, user_id: str) -> dict:
        ctx = self._context(user_id, eligible_required=False)
        # Le collaborateur ne peut plus accéder à la liste si le pack a expiré.
        if not ctx["is_owner"] and not ctx["eligible"]:
            raise HTTPException(403, "Abonnement professionnel expiré.")
        try:
            rows = (self.db.table("oria_collab_members")
                    .select("id,user_id,role,status,first_name,last_name,avatar_key,phone_e164,joined_at")
                    .eq("workspace_id", ctx["workspace_id"])
                    .order("joined_at").execute()).data or []
            invites = (self.db.table("oria_collab_invitations")
                       .select("id,phone_e164,status,created_at,expires_at")
                       .eq("workspace_id", ctx["workspace_id"])
                       .eq("status", "pending").execute()).data or []
            from datetime import datetime, timezone
            now = datetime.now(timezone.utc)
            pending = [i for i in invites if datetime.fromisoformat(
                str(i["expires_at"]).replace("Z", "+00:00")) > now]
            profiles = []
            for row in rows:
                p = {k: row.get(k) for k in (
                    "id", "user_id", "role", "status", "first_name", "last_name", "avatar_key", "joined_at")}
                # L'admin a la liste des numéros pour la gestion. Les collaborateurs ne la voient pas.
                if ctx["is_owner"]:
                    p["phone_e164"] = row.get("phone_e164")
                profiles.append(p)
            return {
                "success": True, "workspace_id": ctx["workspace_id"],
                "my_user_id": user_id, "is_owner": ctx["is_owner"],
                "eligible": ctx["eligible"], "pack_id": ctx["pack_id"],
                "seat_limit": ctx["seat_limit"],
                "active_count": sum(p["status"] == "active" for p in profiles),
                "pending_count": len(pending),
                "profiles": profiles,
                "invitations": pending if ctx["is_owner"] else [],
            }
        except HTTPException:
            raise
        except Exception as exc:
            raise HTTPException(503, "Liste des profils indisponible.") from exc

    def issue_invite(self, user_id: str, phone: str) -> dict:
        ctx = self._context(user_id, owner_required=True)
        phone = valid_phone(phone)
        secret = secrets.token_urlsafe(32)
        digest = hashlib.sha256(secret.encode("utf-8")).hexdigest()
        result = self._rpc("oria_collab_issue_invite", {
            "p_owner_user_id": ctx["owner_user_id"],
            "p_phone_e164": phone, "p_secret_sha256": digest,
        })
        # Le secret n'est jamais enregistré en clair dans les tables ni les audits.
        return {"success": True, "token": secret, **result}

    def accept_invite(self, user_id: str, token: str, first: str, last: str,
                      avatar: str, accepted: bool) -> dict:
        if not accepted:
            raise HTTPException(422, "L'information sur la supervision doit être acceptée.")
        if not (32 <= len(token or "") <= 128 and
                re.fullmatch(r"[A-Za-z0-9_-]+", token or "")):
            raise HTTPException(422, "Invitation invalide.")
        digest = hashlib.sha256(token.encode("utf-8")).hexdigest()
        return {"success": True, **self._rpc("oria_collab_accept_invite", {
            "p_secret_sha256": digest, "p_member_user_id": user_id,
            "p_first_name": valid_name(first), "p_last_name": valid_name(last),
            "p_avatar_key": valid_avatar(avatar),
            "p_supervision_accepted": accepted,
        })}

    def revoke(self, user_id: str, invite_id: UUID) -> dict:
        ctx = self._context(user_id, owner_required=True, eligible_required=False)
        return {"success": True, **self._rpc("oria_collab_revoke_invite", {
            "p_owner_user_id": ctx["owner_user_id"], "p_invite_id": str(invite_id),
        })}

    def set_status(self, user_id: str, target: UUID, status: str) -> dict:
        ctx = self._context(user_id, owner_required=True, eligible_required=False)
        if status not in ("active", "suspended", "banned"):
            raise HTTPException(422, "Statut inconnu.")
        return {"success": True, **self._rpc("oria_collab_set_member_status", {
            "p_owner_user_id": ctx["owner_user_id"],
            "p_target_user_id": str(target), "p_new_status": status,
        })}

    def update_profile(self, user_id: str, first: str, last: str, avatar: str) -> dict:
        self._context(user_id, eligible_required=False)
        return {"success": True, **self._rpc("oria_collab_update_profile", {
            "p_user_id": user_id, "p_first_name": valid_name(first),
            "p_last_name": valid_name(last), "p_avatar_key": valid_avatar(avatar),
        })}
