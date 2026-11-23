"""ORIA Collaboratif phase 5A : groupes humains, sans appels IA ni paiements.

Le backend vérifie la session via collab_profiles.require_user. Le service
revalide le statut professionnel, et les RPC revalident l'acteur, l'espace,
le pack, les places, les participants et le compteur sous PostgreSQL.
"""
from __future__ import annotations

from typing import Any
from uuid import UUID

from fastapi import HTTPException

from app.services.oria_collab_profiles_service import CollabProfilesService


def _valid_text(value: str, *, maximum: int, required: bool = True) -> str:
    if not isinstance(value, str):
        raise HTTPException(status_code=422, detail="Texte invalide.")
    clean = value.strip()
    if (required and not clean) or len(clean) > maximum or "\x00" in clean:
        raise HTTPException(status_code=422, detail=f"Texte invalide (maximum {maximum} caractères).")
    return clean


class CollabGroupsService:
    def __init__(self, db: Any) -> None:
        self.db = db
        self.profiles = CollabProfilesService(db)

    def _rpc(self, name: str, arguments: dict[str, object]) -> dict:
        try:
            response = self.db.rpc(name, arguments).execute()
            data = getattr(response, "data", None)
            if not isinstance(data, dict) or data.get("success") is not True:
                raise RuntimeError("collab_group_invalid_response")
            return data
        except Exception as exc:
            detail = str(exc).lower()
            errors: tuple[tuple[str, int, str], ...] = (
                ("collab_group_ai_not_connected", 409,
                 "La mention @ORIA sera disponible lors du raccordement IA des groupes."),
                ("collab_group_message_limit", 409,
                 "Vous avez atteint la limite de messages de cette conversation. Extension à venir."),
                ("collab_group_admin_only", 403, "Action réservée à l'administrateur."),
                ("collab_group_not_participant", 403, "Vous n'êtes pas membre de ce groupe."),
                ("collab_group_member_inactive", 403, "Ce profil est inactif ou extérieur à l'équipe."),
                ("collab_group_unauthorized", 403, "Votre profil professionnel est inaccessible."),
                ("collab_group_pack_inactive", 403, "Pack Pro ou Business actif nécessaire."),
                ("collab_group_seat_limit", 403, "Trop de profils actifs pour le pack."),
                ("collab_group_invalid_owner", 403, "Propriétaire professionnel incohérent."),
                ("collab_group_owner_fixed", 422, "L'administrateur ne peut pas être retiré du groupe."),
                ("collab_group_archived", 409, "Ce salon est archivé : envoi impossible."),
                ("collab_group_idempotency_conflict", 409, "Cet envoi existe avec un autre contenu."),
                ("collab_group_cursor_invalid", 400, "Curseur de pagination invalide."),
                ("collab_group_not_found", 404, "Groupe inexistant ou inaccessible."),
                ("collab_group_space_limit", 409, "Limite de 50 groupes atteinte."),
                ("collab_group_invalid_input", 422, "Données du groupe invalides."),
            )
            for token, status, message in errors:
                if token in detail:
                    raise HTTPException(status_code=status, detail=message) from exc
            raise HTTPException(status_code=503, detail="Service des groupes indisponible.") from exc

    def _context(self, actor_id: str) -> dict:
        return self.profiles._context(actor_id)

    def list_groups(self, actor_id: str) -> dict:
        self._context(actor_id)
        return self._rpc("oria_collab_group_list", {"p_actor_user_id": actor_id})

    def create(self, actor_id: str, title: str, description: str) -> dict:
        self.profiles._context(actor_id, owner_required=True)
        return self._rpc("oria_collab_group_create", {
            "p_actor_user_id": actor_id,
            "p_title": _valid_text(title, maximum=100),
            "p_description": _valid_text(description, maximum=500, required=False),
        })

    def set_participant(self, actor_id: str, group_id: UUID,
                        member_user_id: UUID, add: bool) -> dict:
        self.profiles._context(actor_id, owner_required=True)
        return self._rpc("oria_collab_group_set_participant", {
            "p_actor_user_id": actor_id,
            "p_group_id": str(group_id),
            "p_member_user_id": str(member_user_id),
            "p_add": add,
        })

    def archive(self, actor_id: str, group_id: UUID, archived: bool) -> dict:
        self.profiles._context(actor_id, owner_required=True)
        return self._rpc("oria_collab_group_archive", {
            "p_actor_user_id": actor_id,
            "p_group_id": str(group_id),
            "p_archived": archived,
        })

    def messages(self, actor_id: str, group_id: UUID,
                 before_id: UUID | None, limit: int) -> dict:
        self._context(actor_id)
        if not 1 <= limit <= 100:
            raise HTTPException(status_code=422, detail="Taille de page non autorisée.")
        return self._rpc("oria_collab_group_messages_page", {
            "p_actor_user_id": actor_id,
            "p_group_id": str(group_id),
            "p_before_message_id": str(before_id) if before_id else None,
            "p_limit": limit,
        })

    def post(self, actor_id: str, group_id: UUID,
             client_message_id: UUID, content: str) -> dict:
        self._context(actor_id)
        message = _valid_text(content, maximum=4000)
        return self._rpc("oria_collab_group_post", {
            "p_actor_user_id": actor_id,
            "p_group_id": str(group_id),
            "p_client_message_id": str(client_message_id),
            "p_content": message,
        })
