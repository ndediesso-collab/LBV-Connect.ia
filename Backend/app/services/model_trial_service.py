"""Gestion des essais découverte ORIA, avec lectures Supabase résilientes.

IMPORTANT : une contrainte UNIQUE(user_id, model_id) doit exister sur
public.model_trials pour la création concurrente sans doublon.

Pour ORIA Découverte, la cle persistée « discovery_pack:gpt-5.6-terra »
est séparée du compteur Terra historique (5 essais). Aucun compteur
existant n'est renommé, migré ou remis à zéro.
"""
from __future__ import annotations

from datetime import datetime, timezone

from app.config.model_trials import (
    DISCOVERY_TRIAL_MAX_USES,
    TRIAL_COSTS,
    TRIAL_MAX_USES,
    TRIAL_MODELS_BY_PACK,
)
from app.core.supabase import supabase
from app.services.supabase_read_retry import execute_supabase_read


_DISCOVERY_PACK_ID = "discovery_pack"


class ModelTrialService:
    """Essais persistants, non réinitialisés lors d'un changement de pack."""

    @staticmethod
    def get_trial_model(pack_id: str | None) -> str | None:
        if not pack_id:
            return None
        return TRIAL_MODELS_BY_PACK.get(pack_id)

    @staticmethod
    def get_trial_cost(model_id: str, web: bool = False) -> int:
        model_costs = TRIAL_COSTS.get(model_id)
        if not model_costs:
            raise ValueError("Ce modèle ne possède pas de système de découverte.")
        return model_costs["web" if web else "normal"]

    @staticmethod
    def _counter_model_id(model_id: str, pack_id: str | None) -> str:
        """Isoler le quota Découverte sans modifier les compteurs historiques.

        model_trials.model_id est une colonne TEXT avec UNIQUE(user_id,model_id).
        La clé spéciale n'est jamais envoyée à OpenAI / OpenRouter.
        """
        if pack_id == _DISCOVERY_PACK_ID:
            if TRIAL_MODELS_BY_PACK.get(_DISCOVERY_PACK_ID) != model_id:
                raise ValueError("Ce modèle n'est pas un essai du Pass Découverte.")
            return f"{_DISCOVERY_PACK_ID}:{model_id}"
        return model_id

    @staticmethod
    def _expected_maximum(pack_id: str | None) -> int:
        if pack_id == _DISCOVERY_PACK_ID:
            return DISCOVERY_TRIAL_MAX_USES
        return TRIAL_MAX_USES

    @staticmethod
    def _check_discovery_quota(trial: dict, pack_id: str | None) -> None:
        """Refuser toute ligne Découverte mal configurée plutôt que donner 5 essais."""
        if pack_id != _DISCOVERY_PACK_ID:
            return
        try:
            maximum = int(trial["max_trials"])
            used = int(trial["used_trials"])
        except (KeyError, TypeError, ValueError) as exc:
            raise RuntimeError("Compteur du Pass Découverte invalide.") from exc
        if maximum != DISCOVERY_TRIAL_MAX_USES or not 0 <= used <= maximum:
            raise RuntimeError("Quota du Pass Découverte incohérent dans Supabase.")

    @staticmethod
    def get_trial(
        user_id: str, model_id: str, pack_id: str | None = None
    ) -> dict | None:
        stored_model_id = ModelTrialService._counter_model_id(model_id, pack_id)
        # Ne JAMAIS interpréter une erreur réseau comme un compteur inexistant.
        response = execute_supabase_read(
            lambda: (
                supabase.table("model_trials")
                .select("*")
                .eq("user_id", user_id)
                .eq("model_id", stored_model_id)
                .maybe_single()
            ),
            label="model_trials.get",
        )
        if response is None:
            # Compatibilité avec les versions de postgrest qui renvoient None
            # quand maybe_single() ne trouve aucune ligne.
            return None
        trial = response.data
        if trial is not None:
            ModelTrialService._check_discovery_quota(trial, pack_id)
        return trial

    @staticmethod
    def get_or_create_trial(
        user_id: str, model_id: str, pack_id: str | None = None
    ) -> dict:
        existing = ModelTrialService.get_trial(user_id, model_id, pack_id)
        if existing is not None:
            return existing

        # Une création concurrente ne doit ni produire de doublons ni remettre
        # used_trials à zéro. NE PAS réessayer un write automatiquement.
        supabase.table("model_trials").upsert(
            {
                "user_id": user_id,
                "model_id": ModelTrialService._counter_model_id(model_id, pack_id),
                "max_trials": ModelTrialService._expected_maximum(pack_id),
                "used_trials": 0,
            },
            on_conflict="user_id,model_id",
            ignore_duplicates=True,
        ).execute()

        trial = ModelTrialService.get_trial(user_id, model_id, pack_id)
        if trial is None:
            raise RuntimeError("Compteur d'essais introuvable après initialisation")
        return trial

    @staticmethod
    def get_remaining(
        user_id: str, model_id: str, pack_id: str | None = None
    ) -> int:
        trial = ModelTrialService.get_or_create_trial(user_id, model_id, pack_id)
        return max(0, int(trial["max_trials"]) - int(trial["used_trials"]))

    @staticmethod
    def can_use_trial(user_id: str, pack_id: str | None, model_id: str) -> bool:
        if ModelTrialService.get_trial_model(pack_id) != model_id:
            return False
        return ModelTrialService.get_remaining(user_id, model_id, pack_id) > 0

    @staticmethod
    def consume_trial(
        user_id: str, model_id: str, pack_id: str | None = None
    ) -> dict:
        trial = ModelTrialService.get_or_create_trial(user_id, model_id, pack_id)
        used = int(trial["used_trials"])
        maximum = int(trial["max_trials"])
        if used >= maximum:
            raise ValueError("Les essais découverte de ce modèle sont épuisés.")

        # CAS (Compare And Swap) : 2 appels concurrents avec le même 'used'
        # ne peuvent pas valider tous les deux. L'update n'est PAS retenté,
        # car une réponse réseau perdue n'implique pas que le write a échoué.
        response = (
            supabase.table("model_trials")
            .update({
                "used_trials": used + 1,
                "updated_at": datetime.now(timezone.utc).isoformat(),
            })
            .eq("user_id", user_id)
            .eq("model_id", ModelTrialService._counter_model_id(model_id, pack_id))
            .eq("used_trials", used)
            .lt("used_trials", maximum)
            .execute()
        )
        if response is None or not response.data:
            raise RuntimeError(
                "Mise à jour non confirmée : le compteur a peut-être changé. "
                "Relire son état avant toute nouvelle consommation."
            )
        result = response.data[0]
        ModelTrialService._check_discovery_quota(result, pack_id)
        return result
[0]
