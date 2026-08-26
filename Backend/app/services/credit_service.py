from dataclasses import dataclass
from datetime import datetime

from app.config.credit_costs import (
    CreditAction,
)
from app.models.credit import CreditWallet


# ============================================================
# RÉSULTAT DE CONSOMMATION
# ============================================================


@dataclass(frozen=True)
class CreditConsumptionResult:
    action: CreditAction
    cost: int

    previous_balance: int
    new_balance: int

    consumed_credits: int
    consumed_percentage: float
    remaining_percentage: float

    requires_warning: bool
    requires_critical_warning: bool
    requires_confirmation: bool


# ============================================================
# ERREURS
# ============================================================


class InsufficientCreditsError(Exception):
    """Levée lorsque le solde est insuffisant."""


class InactivePackError(Exception):
    """Levée lorsque le pack est expiré ou inactif."""


class UnsupportedActionError(Exception):
    """Levée lorsqu'une action n'est pas disponible dans le pack."""


# ============================================================
# SERVICE
# ============================================================


class CreditService:

    # ========================================================
    # SEUILS
    # ========================================================

    LOW_BALANCE_THRESHOLD = 80.0
    CRITICAL_BALANCE_THRESHOLD = 90.0
    LARGE_CONSUMPTION_THRESHOLD = 20.0

    # ========================================================
    # ACTIONS PAR PACK
    # ========================================================

    PACK_ACTION_COSTS: dict[str, dict[CreditAction, int]] = {

        # ====================================================
        # PACK LÉGER
        # ====================================================

        "light_pack": {
            CreditAction.CHAT_LUNA: 6,
            CreditAction.CHAT_LUNA_WEB: 8,

            CreditAction.IMAGE_480: 50,
            CreditAction.IMAGE_720: 75,

            CreditAction.VIDEO_4S: 500,
            CreditAction.VIDEO_8S: 1_000,
        },

        # ====================================================
        # PACK INTERMÉDIAIRE
        # ====================================================

        "intermediate_pack": {
            CreditAction.CHAT_LUNA: 6,
            CreditAction.CHAT_LUNA_WEB: 8,

            CreditAction.CHAT_GPT5: 60,
            CreditAction.CHAT_GPT5_WEB: 86,

            CreditAction.IMAGE_480: 50,
            CreditAction.IMAGE_720: 75,

            CreditAction.VIDEO_LITE: 1_500,
        },

        # ====================================================
        # PACK PRO
        # ====================================================

        "pro_pack": {

            # ----------------------------
            # CHAT
            # ----------------------------

            CreditAction.CHAT_LUNA: 6,
            CreditAction.CHAT_LUNA_WEB: 8,

            CreditAction.CHAT_GPT5: 60,
            CreditAction.CHAT_GPT5_WEB: 86,

            CreditAction.CHAT_TERRA: 75,
            CreditAction.CHAT_TERRA_WEB: 105,

            # ----------------------------
            # IMAGES
            # ----------------------------

            CreditAction.IMAGE_PRO: 100,
            CreditAction.IMAGE_PRO_STANDARD: 180,
            CreditAction.IMAGE_PRO_ULTRA: 270,

            # ----------------------------
            # VIDÉOS
            # ----------------------------

            CreditAction.VIDEO_PRO_FAST: 1_500,
            CreditAction.VIDEO_PRO_STANDARD: 3_000,
            CreditAction.VIDEO_PRO_EXTENSION: 1_500,
        },

        # ====================================================
        # PACK BUSINESS
        # ====================================================

        "business_pack": {

            # ----------------------------
            # CHAT
            # ----------------------------

            CreditAction.CHAT_LUNA: 6,
            CreditAction.CHAT_LUNA_WEB: 8,

            CreditAction.CHAT_GPT5: 60,
            CreditAction.CHAT_GPT5_WEB: 86,

            CreditAction.CHAT_TERRA: 75,
            CreditAction.CHAT_TERRA_WEB: 105,

            CreditAction.CHAT_SOL: 120,
            CreditAction.CHAT_SOL_WEB: 165,

            # ----------------------------
            # IMAGES
            # ----------------------------

            CreditAction.IMAGE_BUSINESS: 250,
            CreditAction.IMAGE_BUSINESS_HD: 400,
            CreditAction.IMAGE_BUSINESS_ULTRA: 600,

            # ----------------------------
            # VIDÉOS
            # ----------------------------

            CreditAction.VIDEO_BUSINESS_FAST: 2_500,
            CreditAction.VIDEO_BUSINESS_STANDARD: 5_000,
            CreditAction.VIDEO_BUSINESS_LONG: 10_000,
        },
    }

    # ========================================================
    # RÉCUPÉRATION DU COÛT DE BASE
    # ========================================================

    @classmethod
    def get_cost(
        cls,
        wallet: CreditWallet,
        action: CreditAction,
    ) -> int:

        pack_costs = cls.PACK_ACTION_COSTS.get(
            wallet.pack_id
        )

        if pack_costs is None:
            raise UnsupportedActionError(
                "Le type de pack associé au portefeuille "
                "n'est pas reconnu."
            )

        cost = pack_costs.get(action)

        if cost is None:
            raise UnsupportedActionError(
                f"L'action '{action.value}' "
                "n'est pas disponible avec ce pack."
            )

        return cost

    # ========================================================
    # RÉSOLUTION DU COÛT FINAL
    # ========================================================

    @classmethod
    def resolve_cost(
        cls,
        wallet: CreditWallet,
        action: CreditAction,
        cost_override: int | None = None,
    ) -> int:
        """
        Détermine le coût final de consommation.

        Sans override :
            coût normal de l'action.

        Avec override :
            coût calculé en amont par la couche supérieure.

        Exemple multimodal :

            CHAT_LUNA = 6
            + analyse image = supplément
            + analyse fichier = supplément

        Le service conserve malgré tout la validation de
        disponibilité de l'action dans le pack.
        """

        # ====================================================
        # VALIDATION DE L'ACTION
        # ====================================================

        base_cost = cls.get_cost(
            wallet,
            action,
        )

        # ====================================================
        # COÛT NORMAL
        # ====================================================

        if cost_override is None:
            return base_cost

        # ====================================================
        # VALIDATION OVERRIDE
        # ====================================================

        if not isinstance(
            cost_override,
            int,
        ):
            raise ValueError(
                "Le coût personnalisé doit être un entier."
            )

        if cost_override <= 0:
            raise ValueError(
                "Le coût personnalisé doit être supérieur à zéro."
            )

        return cost_override

    # ========================================================
    # VÉRIFICATION DE CONSOMMATION
    # ========================================================

    @classmethod
    def can_consume(
        cls,
        wallet: CreditWallet,
        action: CreditAction,
        cost_override: int | None = None,
    ) -> bool:

        if not wallet.is_pack_active:
            return False

        try:
            cost = cls.resolve_cost(
                wallet=wallet,
                action=action,
                cost_override=cost_override,
            )

        except (
            UnsupportedActionError,
            ValueError,
        ):
            return False

        return wallet.balance >= cost

    # ========================================================
    # CONFIRMATION
    # ========================================================

    @classmethod
    def requires_confirmation(
        cls,
        wallet: CreditWallet,
        action: CreditAction,
        cost_override: int | None = None,
    ) -> bool:

        cost = cls.resolve_cost(
            wallet=wallet,
            action=action,
            cost_override=cost_override,
        )

        if wallet.balance <= 0:
            return True

        consumption_percentage = (
            cost / wallet.balance
        ) * 100

        return (
            consumption_percentage
            >= cls.LARGE_CONSUMPTION_THRESHOLD
        )

    # ========================================================
    # VALIDATION AVANT DÉBIT
    # ========================================================

    @classmethod
    def validate_consumption(
        cls,
        wallet: CreditWallet,
        action: CreditAction,
        confirmed: bool = False,
        cost_override: int | None = None,
    ) -> int:
        """
        Valide une consommation avant débit.

        cost_override permet à la couche Chat de transmettre
        le coût final d'une requête multimodale.
        """

        # ====================================================
        # PACK
        # ====================================================

        if not wallet.is_pack_active:
            raise InactivePackError(
                "Le pack de crédits est expiré ou inactif."
            )

        # ====================================================
        # COÛT FINAL
        # ====================================================

        cost = cls.resolve_cost(
            wallet=wallet,
            action=action,
            cost_override=cost_override,
        )

        # ====================================================
        # SOLDE
        # ====================================================

        if wallet.balance < cost:
            raise InsufficientCreditsError(
                "Crédits insuffisants pour effectuer cette action."
            )

        # ====================================================
        # CONFIRMATION
        # ====================================================

        requires_confirmation = (
            cls.requires_confirmation(
                wallet=wallet,
                action=action,
                cost_override=cost,
            )
        )

        if (
            requires_confirmation
            and not confirmed
        ):
            raise ValueError(
                "Cette action nécessite une confirmation "
                "avant la consommation des crédits."
            )

        return cost


    # ========================================================
    # RECHARGE COMPLÉMENTAIRE
    # ========================================================

    @classmethod
    def recharge(
        cls,
        wallet: CreditWallet,
        credits: int,
        repository=None,
        user_id: str | None = None,
        reference_id: str | None = None,
    ) -> CreditWallet:
        """
        Ajoute des crédits complémentaires au portefeuille.

        Une recharge :
        - augmente uniquement le solde disponible ;
        - ne modifie pas le pack actif ;
        - ne modifie pas la durée du pack ;
        - ne modifie pas les crédits initiaux du pack ;
        - doit être exécutée atomiquement via le repository
          en production.

        `reference_id` doit correspondre à l'identifiant unique
        du paiement afin de permettre l'idempotence du webhook.
        """

        if credits <= 0:
            raise ValueError(
                "Le nombre de crédits à recharger doit être supérieur à zéro."
            )

        if repository is None:
            raise ValueError(
                "Un repository est requis pour effectuer une recharge."
            )

        if not user_id:
            raise ValueError(
                "user_id est requis pour une recharge atomique."
            )

        if not reference_id:
            raise ValueError(
                "reference_id est requis pour une recharge."
            )

        return repository.recharge_credits(
            user_id=user_id,
            amount=credits,
            reference_id=reference_id,
        )

    # ========================================================
    # CONSOMMATION
    # ========================================================

    @classmethod
    def consume(
        cls,
        wallet: CreditWallet,
        action: CreditAction,
        confirmed: bool = False,
        cost_override: int | None = None,
        repository=None,
        user_id: str | None = None,
        reference_id: str | None = None,
    ) -> CreditConsumptionResult:
        """
        Valide puis consomme des crédits.

        En production, lorsque `repository` est fourni, le débit réel
        passe par `repository.consume_credits()`, donc par la RPC
        atomique Supabase.

        Sans repository, le comportement local reste disponible pour
        les tests métier unitaires.
        """

        # ====================================================
        # VALIDATION
        # ====================================================

        cost = cls.validate_consumption(
            wallet=wallet,
            action=action,
            confirmed=confirmed,
            cost_override=cost_override,
        )

        # ====================================================
        # SOLDE AVANT
        # ====================================================

        previous_balance = wallet.balance

        # ====================================================
        # CONFIRMATION / SEUILS AVANT DÉBIT
        # ====================================================

        requires_confirmation = cls.requires_confirmation(
            wallet=wallet,
            action=action,
            cost_override=cost,
        )

        # ====================================================
        # DÉBIT
        # ====================================================

        if repository is not None:
            if not user_id:
                raise ValueError(
                    "user_id est requis pour une consommation atomique."
                )

            updated_wallet = repository.consume_credits(
                user_id=user_id,
                amount=cost,
                action=action,
                reference_id=reference_id,
            )

            wallet = updated_wallet

        else:
            # Comportement local réservé aux tests / logique métier.
            wallet.balance -= cost
            wallet.updated_at = datetime.now(
                tz=wallet.updated_at.tzinfo,
            )

        # ====================================================
        # STATISTIQUES APRÈS DÉBIT
        # ====================================================

        consumed_credits = wallet.consumed_credits
        consumed_percentage = wallet.consumed_percentage
        remaining_percentage = wallet.remaining_percentage

        requires_warning = (
            consumed_percentage
            >= cls.LOW_BALANCE_THRESHOLD
        )

        requires_critical_warning = (
            consumed_percentage
            >= cls.CRITICAL_BALANCE_THRESHOLD
        )

        # ====================================================
        # RÉSULTAT
        # ====================================================

        return CreditConsumptionResult(
            action=action,
            cost=cost,
            previous_balance=previous_balance,
            new_balance=wallet.balance,
            consumed_credits=consumed_credits,
            consumed_percentage=consumed_percentage,
            remaining_percentage=remaining_percentage,
            requires_warning=requires_warning,
            requires_critical_warning=requires_critical_warning,
            requires_confirmation=requires_confirmation,
        )