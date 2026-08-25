from dataclasses import dataclass
from datetime import datetime

from app.config.credit_costs import (
    CreditAction,
)
from app.models.credit import CreditWallet


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


class InsufficientCreditsError(Exception):
    """Levée lorsque le solde est insuffisant."""


class InactivePackError(Exception):
    """Levée lorsque le pack est expiré ou inactif."""


class UnsupportedActionError(Exception):
    """Levée lorsqu'une action n'est pas disponible dans le pack."""


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

            CreditAction.VIDEO_5S: 500,
            CreditAction.VIDEO_10S: 1_000,
        },

        # ====================================================
        # PACK INTERMÉDIAIRE
        # ====================================================

        "intermediate_pack": {
            CreditAction.CHAT_LUNA: 6,
            CreditAction.CHAT_LUNA_WEB: 8,

            CreditAction.CHAT_GPT5: 60,
            CreditAction.CHAT_GPT5_WEB: 86,

            CreditAction.IMAGE_480: 190,
            CreditAction.IMAGE_720: 290,

            CreditAction.VIDEO_LITE: 1_300,
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

            CreditAction.VIDEO_PRO_FAST: 700,
            CreditAction.VIDEO_PRO_STANDARD: 2_000,
            CreditAction.VIDEO_PRO_EXTENSION: 700,
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

            CreditAction.VIDEO_BUSINESS_FAST: 1_100,
            CreditAction.VIDEO_BUSINESS_STANDARD: 3_000,
            CreditAction.VIDEO_BUSINESS_LONG: 6_000,
        },
    }

    # ========================================================
    # RÉCUPÉRATION DU COÛT
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
    # VÉRIFICATION DE CONSOMMATION
    # ========================================================

    @classmethod
    def can_consume(
        cls,
        wallet: CreditWallet,
        action: CreditAction,
    ) -> bool:

        if not wallet.is_pack_active:
            return False

        try:
            cost = cls.get_cost(
                wallet,
                action,
            )
        except UnsupportedActionError:
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
    ) -> bool:

        cost = cls.get_cost(
            wallet,
            action,
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
    ) -> int:

        if not wallet.is_pack_active:
            raise InactivePackError(
                "Le pack de crédits est expiré ou inactif."
            )

        cost = cls.get_cost(
            wallet,
            action,
        )

        if wallet.balance < cost:
            raise InsufficientCreditsError(
                "Crédits insuffisants pour effectuer cette action."
            )

        requires_confirmation = cls.requires_confirmation(
            wallet,
            action,
        )

        if requires_confirmation and not confirmed:
            raise ValueError(
                "Cette action nécessite une confirmation "
                "avant la consommation des crédits."
            )

        return cost

    # ========================================================
    # CONSOMMATION LOCALE
    #
    # Cette méthode reste utile pour les tests métier locaux.
    #
    # IMPORTANT :
    # La route de production doit utiliser la RPC atomique
    # via CreditRepository.consume_credits().
    # ========================================================

    @classmethod
    def consume(
        cls,
        wallet: CreditWallet,
        action: CreditAction,
        confirmed: bool = False,
    ) -> CreditConsumptionResult:

        cost = cls.validate_consumption(
            wallet=wallet,
            action=action,
            confirmed=confirmed,
        )

        previous_balance = wallet.balance

        wallet.balance -= cost

        wallet.updated_at = datetime.now(
            tz=wallet.updated_at.tzinfo,
        )

        consumed_credits = (
            wallet.consumed_credits
        )

        consumed_percentage = (
            wallet.consumed_percentage
        )

        remaining_percentage = (
            wallet.remaining_percentage
        )

        requires_confirmation = (
            cls.requires_confirmation(
                wallet=CreditWallet(
                    user_id=wallet.user_id,
                    balance=previous_balance,
                    initial_credits=wallet.initial_credits,
                    created_at=wallet.created_at,
                    updated_at=wallet.updated_at,
                    pack_id=wallet.pack_id,
                    pack_activated_at=wallet.pack_activated_at,
                    pack_expires_at=wallet.pack_expires_at,
                ),
                action=action,
            )
        )

        requires_warning = (
            consumed_percentage
            >= cls.LOW_BALANCE_THRESHOLD
        )

        requires_critical_warning = (
            consumed_percentage
            >= cls.CRITICAL_BALANCE_THRESHOLD
        )

        return CreditConsumptionResult(
            action=action,
            cost=cost,
            previous_balance=previous_balance,
            new_balance=wallet.balance,
            consumed_credits=consumed_credits,
            consumed_percentage=consumed_percentage,
            remaining_percentage=remaining_percentage,
            requires_warning=requires_warning,
            requires_critical_warning=(
                requires_critical_warning
            ),
            requires_confirmation=(
                requires_confirmation
            ),
        )