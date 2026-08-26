from app.config.model_trials import (
    TRIAL_COSTS,
    TRIAL_MAX_USES,
    TRIAL_MODELS_BY_PACK,
)
from app.core.supabase import supabase


class ModelTrialService:
    """
    Gestion centralisée des essais des modèles supérieurs.

    Les essais sont persistants dans Supabase.

    Ils ne sont jamais réinitialisés automatiquement
    lorsqu'un utilisateur change de pack.
    """

    # ========================================================
    # MODÈLE SUPÉRIEUR
    # ========================================================

    @staticmethod
    def get_trial_model(
        pack_id: str | None,
    ) -> str | None:

        if not pack_id:
            return None

        return TRIAL_MODELS_BY_PACK.get(
            pack_id
        )

    # ========================================================
    # COÛT
    # ========================================================

    @staticmethod
    def get_trial_cost(
        model_id: str,
        web: bool = False,
    ) -> int:

        model_costs = TRIAL_COSTS.get(
            model_id
        )

        if not model_costs:
            raise ValueError(
                "Ce modèle ne possède pas "
                "de système de découverte."
            )

        return model_costs[
            "web" if web else "normal"
        ]

    # ========================================================
    # RÉCUPÉRATION DU COMPTEUR
    # ========================================================

    @staticmethod
    def get_trial(
        user_id: str,
        model_id: str,
    ) -> dict | None:
        """
        Retourne le compteur d'essais d'un utilisateur.

        Si aucun compteur n'existe encore, retourne None.

        Une réponse Supabase absente est également traitée
        comme une absence de compteur afin d'éviter une
        erreur AttributeError sur response.data.
        """

        response = (
            supabase
            .table("model_trials")
            .select("*")
            .eq("user_id", user_id)
            .eq("model_id", model_id)
            .maybe_single()
            .execute()
        )

        if response is None:
            return None

        return response.data

    # ========================================================
    # INITIALISATION DU COMPTEUR
    # ========================================================

    @staticmethod
    def get_or_create_trial(
        user_id: str,
        model_id: str,
    ) -> dict:
        """
        Retourne le compteur existant ou crée le compteur
        initial de 5 essais pour le modèle concerné.
        """

        existing = (
            ModelTrialService.get_trial(
                user_id,
                model_id,
            )
        )

        if existing:
            return existing

        response = (
            supabase
            .table("model_trials")
            .insert(
                {
                    "user_id": user_id,
                    "model_id": model_id,
                    "max_trials": TRIAL_MAX_USES,
                    "used_trials": 0,
                }
            )
            .execute()
        )

        if response is None:
            raise RuntimeError(
                "Supabase n'a retourné aucune réponse "
                "lors de la création du compteur d'essais."
            )

        if not response.data:
            raise RuntimeError(
                "Impossible de créer le compteur "
                "d'essais du modèle."
            )

        return response.data[0]

    # ========================================================
    # ESSAIS RESTANTS
    # ========================================================

    @staticmethod
    def get_remaining(
        user_id: str,
        model_id: str,
    ) -> int:
        """
        Retourne le nombre d'essais encore disponibles.
        """

        trial = (
            ModelTrialService.get_or_create_trial(
                user_id,
                model_id,
            )
        )

        return max(
            0,
            trial["max_trials"]
            - trial["used_trials"],
        )

    # ========================================================
    # AUTORISATION
    # ========================================================

    @staticmethod
    def can_use_trial(
        user_id: str,
        pack_id: str | None,
        model_id: str,
    ) -> bool:
        """
        Vérifie que le modèle correspond au modèle d'essai
        du pack et qu'il reste au moins un essai.
        """

        expected_model = (
            ModelTrialService.get_trial_model(
                pack_id
            )
        )

        if expected_model != model_id:
            return False

        remaining = (
            ModelTrialService.get_remaining(
                user_id,
                model_id,
            )
        )

        return remaining > 0

    # ========================================================
    # CONSOMMATION D'UN ESSAI
    # ========================================================

    @staticmethod
    def consume_trial(
        user_id: str,
        model_id: str,
    ) -> dict:
        """
        Consomme exactement un essai.

        La condition used_trials == ancienne valeur
        protège contre une consommation concurrente.
        """

        trial = (
            ModelTrialService.get_or_create_trial(
                user_id,
                model_id,
            )
        )

        used = trial["used_trials"]
        maximum = trial["max_trials"]

        if used >= maximum:
            raise ValueError(
                "Les essais découverte de ce modèle "
                "sont épuisés."
            )

        new_used = used + 1

        response = (
            supabase
            .table("model_trials")
            .update(
                {
                    "used_trials": new_used,
                    "updated_at": "now()",
                }
            )
            .eq("user_id", user_id)
            .eq("model_id", model_id)
            .eq("used_trials", used)
            .execute()
        )

        if response is None:
            raise RuntimeError(
                "Supabase n'a retourné aucune réponse "
                "lors de la consommation de l'essai."
            )

        if not response.data:
            raise RuntimeError(
                "Impossible de mettre à jour "
                "le compteur d'essais. "
                "Le compteur a peut-être été modifié "
                "par une autre requête."
            )

        return response.data[0]