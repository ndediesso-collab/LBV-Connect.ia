from abc import ABC, abstractmethod

from app.models.credit import CreditWallet
from app.models.credit_transaction import CreditTransaction
from app.config.credit_costs import CreditAction

class CreditRepository(ABC):
    """Contrat de persistance des crédits."""

    @abstractmethod
    def get_wallet(self, user_id: str) -> CreditWallet | None:
        """Retourne le portefeuille de crédits d'un utilisateur."""

    @abstractmethod
    def create_wallet(
        self,
        wallet: CreditWallet,
    ) -> CreditWallet:
        """Crée un nouveau portefeuille de crédits."""

    @abstractmethod
    def update_wallet(
        self,
        wallet: CreditWallet,
    ) -> CreditWallet:
        """Met à jour le portefeuille de crédits."""

    @abstractmethod
    def create_transaction(
        self,
        transaction: CreditTransaction,
    ) -> CreditTransaction:
        """Enregistre une transaction de crédits."""

    @abstractmethod
    def get_transactions(
        self,
        user_id: str,
    ) -> list[CreditTransaction]:
        """Retourne l'historique des transactions d'un utilisateur."""

    @abstractmethod
    def consume_credits(
        self,
        user_id: str,
        amount: int,
        action: CreditAction,
        reference_id: str | None = None,
    ) -> CreditWallet:
        """Débite et journalise atomiquement les crédits."""
        raise NotImplementedError