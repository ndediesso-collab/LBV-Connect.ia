"""ORIA Collaboratif 4B : droits de quota sur le wallet EXISTANT du propriétaire.

Les mutations se font exclusivement dans les RPC PostgreSQL transactionnelles.
Le token Supabase et le rôle sont vérifiés en amont, puis le SQL les revalide.
Ce module NE débite PAS le wallet historique et N'AUTORISE PAS le chat
à consommer les quotas du pack tant que la phase de raccordement 4C n'existe pas.
"""
from __future__ import annotations

import os
from typing import Any
from uuid import UUID

from fastapi import HTTPException

from app.services.oria_collab_profiles_service import CollabProfilesService


def quotas_enabled() -> bool:
    return os.getenv("ORIA_COLLAB_QUOTAS_ENABLED", "0").strip() == "1"


def _rpc(db: Any, function: str, params: dict) -> dict:
    try:
        response = db.rpc(function, params).execute()
        value = getattr(response, "data", None)
        if isinstance(value, list) and len(value) == 1:
            value = value[0]
        if not isinstance(value, dict) or value.get("success") is not True:
            raise RuntimeError("collab_quota_rpc_invalid_response")
        return value
    except Exception as exc:
        error = str(exc).lower()
        for key, code, message in (
            ("collab_quota_needs_reconciliation", 409,
             "Les quotas dépassent le solde du pack. Réduisez les quotas excédentaires avant un transfert."),
            ("collab_quota_no_deficit", 409, "Aucun déficit de quota à régulariser ou montant excessif."),
            ("collab_quota_previous_reservations", 409,
             "Des réservations de la période précédente restent à régulariser."),
            ("collab_quota_insufficient", 402, "Crédits disponibles insuffisants pour ce transfert."),
            ("collab_quota_pack_inactive", 403, "Pack professionnel expiré ou inactif."),
            ("collab_quota_member_inactive", 403, "Profil source ou destinataire non autorisé."),
            ("collab_quota_personal_direction_invalid", 422,
             "Les crédits personnels récupérés ne peuvent être redistribués que par l'administrateur."),
            ("collab_quota_transfer_invalid", 422, "Montant ou type de transfert invalide."),
            ("collab_quota_forbidden", 403, "Accès aux quotas interdit."),
        ):
            if key in error:
                raise HTTPException(code, message) from exc
        raise HTTPException(503, "Gestion des quotas indisponible ; ne réessayez pas un transfert sans consulter le solde.") from exc


class CollabQuotaService:
    def __init__(self, db: Any):
        self.db = db
        self.profiles = CollabProfilesService(db)

    def _context(self, uid: str, *, owner: bool = False) -> dict:
        if not quotas_enabled():
            raise HTTPException(503, "La gestion des quotas est désactivée sur cet environnement.")
        ctx = self.profiles._context(uid, owner_required=owner, eligible_required=False)
        if not ctx["is_owner"] and not ctx["eligible"]:
            raise HTTPException(403, "Abonnement professionnel expiré.")
        return ctx

    def snapshot(self, uid: str) -> dict:
        self._context(uid)
        data = _rpc(self.db, "oria_collab_quota_snapshot", {"p_actor_user_id": uid})
        if not isinstance(data.get("profiles"), list):
            raise HTTPException(503, "Répartition indisponible.")
        return data

    def movements(self, uid: str) -> dict:
        self._context(uid, owner=True)
        data = _rpc(self.db, "oria_collab_quota_movements_for_owner", {
            "p_actor_user_id": uid, "p_limit": 60,
        })
        if not isinstance(data.get("events"), list):
            raise HTTPException(503, "Historique des transferts indisponible.")
        return data

    def transfer(self, uid: str, *, from_user_id: str, to_user_id: str,
                 credits: int, source: str) -> dict:
        ctx = self._context(uid, owner=True)
        try:
            from_uid = str(UUID(from_user_id))
            to_uid = str(UUID(to_user_id))
        except (ValueError, TypeError) as exc:
            raise HTTPException(422, "Profil source ou destinataire invalide.") from exc
        if from_uid == to_uid or type(credits) is not int or not 1 <= credits <= 1_200_000_000:
            raise HTTPException(422, "Montant de transfert invalide.")
        if source not in ("pack", "personal"):
            raise HTTPException(422, "Source de crédits inconnue.")
        if source == "personal" and from_uid != ctx["owner_user_id"]:
            raise HTTPException(403, "Seul le solde personnel récupéré de l'administrateur est redistribuable.")
        return _rpc(self.db, "oria_collab_quota_transfer", {
            "p_owner_user_id": ctx["owner_user_id"],
            "p_from_user_id": from_uid,
            "p_to_user_id": to_uid,
            "p_amount": credits,
            "p_kind": source,
        })

    def reconcile(self, uid: str, *, source_user_id: str, credits: int) -> dict:
        ctx = self._context(uid, owner=True)
        try:
            source_uid = str(UUID(source_user_id))
        except (ValueError, TypeError) as exc:
            raise HTTPException(422, "Profil à régulariser invalide.") from exc
        if type(credits) is not int or not 1 <= credits <= 1_200_000_000:
            raise HTTPException(422, "Montant de rapprochement invalide.")
        return _rpc(self.db, "oria_collab_quota_reconcile_deficit", {
            "p_owner_user_id": ctx["owner_user_id"],
            "p_source_user_id": source_uid,
            "p_amount": credits,
        })
