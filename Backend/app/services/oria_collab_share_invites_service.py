"""Invitations ORIA Collaboratif par lien WhatsApp, sans Brevo.

Seul le backend détient la clef service_role. Le jeton brut est rendu UNE FOIS
à l'administrateur; seule son empreinte SHA-256 est enregistrée dans Supabase.
"""
from __future__ import annotations

import hashlib
import os
import re
import secrets
from typing import Any
from uuid import UUID

from fastapi import HTTPException

TOKEN_PATTERN = re.compile(r"^[A-Za-z0-9_-]{32,128}$")
AVATARS = {"ink", "stone", "paper", "slate", "silver", "carbon"}


def require_share_enabled() -> None:
    if os.getenv("ORIA_COLLAB_SHARE_INVITES_ENABLED", "0").strip() != "1":
        raise HTTPException(503, "Invitations par lien désactivées.")


def validated_uuid(value: Any) -> str:
    try:
        return str(UUID(str(value)))
    except (ValueError, TypeError, AttributeError) as exc:
        raise HTTPException(422, "Identifiant invalide.") from exc


def token_digest(token: str) -> str:
    if not isinstance(token, str) or not TOKEN_PATTERN.fullmatch(token):
        raise HTTPException(422, "Lien d'invitation invalide.")
    return hashlib.sha256(token.encode("ascii")).hexdigest()


def validate_profile(first: str, last: str, avatar: str, consent: bool) -> tuple[str, str, str]:
    if not consent:
        raise HTTPException(422, "L'accord de supervision professionnelle est obligatoire.")
    first, last = str(first or "").strip(), str(last or "").strip()
    if (not all(1 <= len(x) <= 60 and all(ord(c) >= 32 for c in x) for x in (first, last))
            or avatar not in AVATARS):
        raise HTTPException(422, "Profil professionnel invalide.")
    return first, last, avatar


def rpc(db: Any, name: str, args: dict[str, Any]) -> dict[str, Any]:
    try:
        response = db.rpc(name, args).execute()
        result = getattr(response, "data", None)
        if isinstance(result, list) and len(result) == 1:
            result = result[0]
        if not isinstance(result, dict) or result.get("success") is not True:
            raise ValueError("Réponse RPC invalide")
        return result
    except HTTPException:
        raise
    except Exception as exc:
        error = str(exc).lower()
        codes = {
            "collab_link_owner_only": (403, "Seul le propriétaire peut gérer les invitations."),
            "collab_link_pack_inactive": (403, "Un pack Pro ou Business actif est nécessaire."),
            "collab_link_seats_full": (409, "Toutes les places sont occupées ou réservées."),
            "collab_link_unavailable": (410, "Lien expiré, déjà utilisé ou révoqué."),
            "collab_link_invalid": (422, "Lien invalide."),
            "collab_link_profile_invalid": (422, "Profil incomplet ou invalide."),
            "collab_link_account_unverified": (403, "Vérifiez votre compte ORIA avant de rejoindre."),
            "collab_link_multi_inactive": (409, "Vous faites déjà partie d'un espace. Le mode multi-espaces n'est pas encore activé."),
            "collab_link_already_member": (409, "Ce compte appartient déjà à cet espace."),
            "collab_link_member_inactive": (403, "Votre profil professionnel n'est plus actif."),
        }
        for marker, (status, message) in codes.items():
            if marker in error:
                raise HTTPException(status, message) from exc
        # Ne pas renvoyer d'informations SQL ni de secret au navigateur.
        raise HTTPException(503, "Le service d'invitations est momentanément indisponible.") from exc


class ShareInvitesService:
    def __init__(self, db: Any):
        self.db = db

    def issue(self, owner: str, workspace: str) -> dict[str, Any]:
        secret = secrets.token_urlsafe(32)  # 256 bits; jamais stocké tel quel
        space = validated_uuid(workspace)
        result = rpc(self.db, "oria_collab_share_issue_v1", {
            "p_workspace_id": space,
            "p_actor_user_id": validated_uuid(owner),
            "p_secret_sha256": token_digest(secret),
        })
        # Fragment URL, absent de la requête HTTP initiale au frontend.
        # Le frontend ajoute son origin réel (staging ou production) pour
        # éviter une URL hardcodée vers le mauvais environnement.
        return {"success": True, "invite_id": result["invite_id"],
                "expires_at": result["expires_at"],
                "join_path": "/collaboratif/rejoindre-lien#invitation=" + secret}

    def list(self, owner: str, workspace: str) -> dict[str, Any]:
        result = rpc(self.db, "oria_collab_share_list_v1", {
            "p_workspace_id": validated_uuid(workspace),
            "p_actor_user_id": validated_uuid(owner),
        })
        if not isinstance(result.get("invitations"), list):
            raise HTTPException(503, "Liste d'invitations invalide.")
        return result

    def revoke(self, owner: str, workspace: str, invitation: str) -> dict[str, Any]:
        return rpc(self.db, "oria_collab_share_revoke_v1", {
            "p_workspace_id": validated_uuid(workspace),
            "p_actor_user_id": validated_uuid(owner),
            "p_invite_id": validated_uuid(invitation),
        })

    def preview(self, token: str) -> dict[str, Any]:
        return rpc(self.db, "oria_collab_share_preview_v1", {
            "p_secret_sha256": token_digest(token),
        })

    def accept(self, actor: str, token: str, first: str, last: str,
               avatar: str, consent: bool) -> dict[str, Any]:
        first, last, avatar = validate_profile(first, last, avatar, consent)
        return rpc(self.db, "oria_collab_share_accept_v1", {
            "p_secret_sha256": token_digest(token),
            "p_actor_user_id": validated_uuid(actor),
            "p_first_name": first,
            "p_last_name": last,
            "p_avatar_key": avatar,
            "p_supervision_accepted": consent,
            "p_allow_multi": os.getenv("ORIA_COLLAB_MULTI_ACTIVE", "0").strip() == "1",
        })
