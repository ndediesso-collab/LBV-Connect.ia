"""6B2B1: operations explicitement isolees par workspace (lecture + profil).

Aucun appel aux anciennes RPC mono-espace. Aucun credit reserve ou transfere.
"""
from __future__ import annotations

from typing import Any
from uuid import UUID
from fastapi import HTTPException


RPC = {
    "context": "oria_collab_workspace_context_v3",
    "profiles": "oria_collab_workspace_profiles_v3",
    "profile": "oria_collab_workspace_profile_update_v3",
    "groups": "oria_collab_workspace_groups_v3",
    "group_messages": "oria_collab_workspace_group_messages_v3",
    "private": "oria_collab_workspace_private_list_v3",
    "private_messages": "oria_collab_workspace_private_messages_v3",
    "quota": "oria_collab_workspace_quota_read_v3",
}


def _uuid(value: str) -> str:
    try:
        return str(UUID(str(value)))
    except (ValueError, TypeError, AttributeError) as exc:
        raise HTTPException(422, "Identifiant invalide.") from exc


class ScopedWorkspaceService:
    def __init__(self, db: Any):
        self.db = db

    def _rpc(self, label: str, actor: str, workspace: str, **options: object) -> dict:
        params: dict[str, object] = {
            "p_actor_user_id": _uuid(actor),
            "p_workspace_id": _uuid(workspace),
        }
        params.update(options)
        try:
            response = self.db.rpc(RPC[label], params).execute()
            data = getattr(response, "data", None)
            if isinstance(data, list) and len(data) == 1:
                data = data[0]
            if not isinstance(data, dict) or data.get("success") is not True:
                raise RuntimeError("invalid_scoped_rpc_response")
            # Fail closed: never accept data declared for another workspace.
            if str(data.get("workspace_id")) != str(workspace):
                raise RuntimeError("invalid_scoped_workspace_identity")
            return data
        except HTTPException:
            raise
        except Exception as exc:
            message = str(exc).lower()
            if "collab_scope_forbidden" in message:
                raise HTTPException(404, "Espace ou ressource inaccessible.") from exc
            if "collab_scope_profile_invalid" in message:
                raise HTTPException(422, "Profil professionnel invalide.") from exc
            if "collab_scope_invalid" in message:
                raise HTTPException(400, "Paramètres de consultation invalides.") from exc
            raise HTTPException(503, "Espace professionnel momentanément indisponible.") from exc

    def context(self, uid: str, space: str) -> dict:
        return self._rpc("context", uid, space)

    def profiles(self, uid: str, space: str) -> dict:
        return self._rpc("profiles", uid, space)

    def update_profile(self, uid: str, space: str, first: str, last: str, avatar: str) -> dict:
        return self._rpc("profile", uid, space, p_first_name=first, p_last_name=last,
                         p_avatar_key=avatar)

    def groups(self, uid: str, space: str) -> dict:
        return self._rpc("groups", uid, space)

    def group_messages(self, uid: str, space: str, group: str, before: str | None, limit: int) -> dict:
        if not 1 <= limit <= 100:
            raise HTTPException(422, "Pagination non autorisée.")
        return self._rpc("group_messages", uid, space, p_group_id=_uuid(group),
                         p_before_message_id=_uuid(before) if before is not None else None,
                         p_limit=limit)

    def private_list(self, uid: str, space: str, member: str | None = None) -> dict:
        return self._rpc("private", uid, space,
                         p_member_user_id=_uuid(member) if member else None)

    def private_messages(self, uid: str, space: str, conversation: str) -> dict:
        return self._rpc("private_messages", uid, space,
                         p_conversation_id=_uuid(conversation))

    def quota(self, uid: str, space: str) -> dict:
        return self._rpc("quota", uid, space)
