from abc import ABC, abstractmethod

from app.models.credit import CreditWallet
from app.models.credit_transaction import CreditTransaction
from app.config.credit_costs import CreditAction


class CreditRepository(ABC):
    """
    Contrat de persistance des crédits Oria.

    Ce repository est générique : Chat, images, vidéos et autres
    actions facturables utilisent le même portefeuille.

    La couche métier calcule le coût.
    Le repository applique les opérations atomiques sur le wallet
    et journalise les transactions.
    """

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
        """
        Débite atomiquement un montant déjà définitif.

        Les actions à coût variable doivent utiliser de préférence :
        reserve_credits() -> settle_credit_reservation().
        """
        raise NotImplementedError

    @abstractmethod
    def reserve_credits(
        self,
        user_id: str,
        amount: int,
        action: CreditAction,
        reference_id: str,
    ) -> CreditWallet:
        """
        Réserve atomiquement des crédits avant une action facturable.

        Cette méthode est commune au Chat, aux images et aux vidéos.
        """
        raise NotImplementedError

    @abstractmethod
    def settle_credit_reservation(
        self,
        user_id: str,
        reference_id: str,
        actual_amount: int,
    ) -> CreditWallet:
        """
        Finalise une réservation avec le coût réel.

        Le surplus réservé est restitué automatiquement. Si le coût réel
        dépasse la réservation, le complément est débité si possible.
        """
        raise NotImplementedError

    @abstractmethod
    def release_credit_reservation(
        self,
        user_id: str,
        reference_id: str,
    ) -> CreditWallet:
        """
        Libère une réservation lorsqu'une action échoue avant qu'un coût
        définitif doive être consommé.
        """
        raise NotImplementedError

    @abstractmethod
    def recharge_credits(
        self,
        user_id: str,
        amount: int,
        reference_id: str,
    ) -> CreditWallet:
        """
        Ajoute et journalise atomiquement des crédits complémentaires.

        `reference_id` correspond à la référence unique du paiement
        et permet de garantir l'idempotence d'une recharge.
        """
        raise NotImplementedError
