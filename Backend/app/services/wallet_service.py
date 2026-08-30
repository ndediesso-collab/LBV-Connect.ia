from datetime import datetime, timedelta, timezone
from uuid import uuid4

from app.config.credit_costs import (
    LIGHT_PACK_CREDITS,
    LIGHT_PACK_DURATION_DAYS,
    INTERMEDIATE_PACK_CREDITS,
    INTERMEDIATE_PACK_DURATION_DAYS,
    PRO_PACK_CREDITS,
    PRO_PACK_DURATION_DAYS,
    BUSINESS_PACK_CREDITS,
    BUSINESS_PACK_DURATION_DAYS,
)
from app.models.credit import CreditWallet
from app.models.credit_transaction import (
    CreditTransaction,
    CreditTransactionType,
)
from app.services.credit_repository import CreditRepository


class WalletService:

    def __init__(self, repository: CreditRepository):
        self.repository = repository

    def _create_wallet(
        self,
        user_id: str,
        pack_id: str,
        credits: int,
        duration_days: int,
        reference_id: str,
    ) -> CreditWallet:

        now = datetime.now(timezone.utc)

        expires_at = (
            now
            + timedelta(days=duration_days)
        )

        wallet = CreditWallet(
            user_id=user_id,
            balance=credits,
            initial_credits=credits,
            created_at=now,
            updated_at=now,
            pack_id=pack_id,
            pack_activated_at=now,
            pack_expires_at=expires_at,
        )

        wallet = self.repository.create_wallet(wallet)

        transaction = CreditTransaction(
            id=str(uuid4()),
            user_id=user_id,
            transaction_type=CreditTransactionType.PACK_PURCHASE,
            amount=credits,
            balance_after=wallet.balance,
            created_at=now,
            action=None,
            reference_id=reference_id,
        )

        self.repository.create_transaction(transaction)

        return wallet

    # ========================================================
    # RECHARGE COMPLÉMENTAIRE
    # ========================================================

    def recharge(
        self,
        user_id: str,
        credits: int,
        reference_id: str,
    ) -> CreditWallet:
        """
        Ajoute des crédits complémentaires au portefeuille.

        La recharge :
        - ne modifie pas initial_credits ;
        - ne modifie pas pack_id ;
        - ne modifie pas pack_activated_at ;
        - ne modifie pas pack_expires_at ;
        - utilise la référence du paiement pour l'idempotence.

        L'opération réelle et atomique est déléguée au repository.
        """

        if credits <= 0:
            raise ValueError(
                "Le nombre de crédits à recharger doit être supérieur à zéro."
            )

        if not reference_id:
            raise ValueError(
                "La référence de paiement est obligatoire pour une recharge."
            )

        return self.repository.recharge_credits(
            user_id=user_id,
            amount=credits,
            reference_id=reference_id,
        )

    # ========================================================
    # PACK LÉGER
    # ========================================================

    def create_light_wallet(
        self,
        user_id: str,
        reference_id: str = "light_pack",
    ) -> CreditWallet:

        return self._create_wallet(
            user_id=user_id,
            pack_id="light_pack",
            credits=LIGHT_PACK_CREDITS,
            duration_days=LIGHT_PACK_DURATION_DAYS,
            reference_id=reference_id,
        )

    # ========================================================
    # PACK INTERMÉDIAIRE
    # ========================================================

    def create_intermediate_wallet(
        self,
        user_id: str,
        reference_id: str = "intermediate_pack",
    ) -> CreditWallet:

        return self._create_wallet(
            user_id=user_id,
            pack_id="intermediate_pack",
            credits=INTERMEDIATE_PACK_CREDITS,
            duration_days=INTERMEDIATE_PACK_DURATION_DAYS,
            reference_id=reference_id,
        )

    # ========================================================
    # PACK PRO
    # ========================================================

    def create_pro_wallet(
        self,
        user_id: str,
        reference_id: str = "pro_pack",
    ) -> CreditWallet:

        return self._create_wallet(
            user_id=user_id,
            pack_id="pro_pack",
            credits=PRO_PACK_CREDITS,
            duration_days=PRO_PACK_DURATION_DAYS,
            reference_id=reference_id,
        )

    # ========================================================
    # PACK BUSINESS
    # ========================================================

    def create_business_wallet(
        self,
        user_id: str,
        reference_id: str = "business_pack",
    ) -> CreditWallet:

        return self._create_wallet(
            user_id=user_id,
            pack_id="business_pack",
            credits=BUSINESS_PACK_CREDITS,
            duration_days=BUSINESS_PACK_DURATION_DAYS,
            reference_id=reference_id,
        )