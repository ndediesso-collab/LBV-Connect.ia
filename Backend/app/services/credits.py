from dataclasses import dataclass


@dataclass
class CreditWallet:
    user_id: str
    balance: int
    reserved: int = 0

    @property
    def available(self) -> int:
        """Crédits réellement disponibles."""
        return max(0, self.balance - self.reserved)

    def reserve(self, amount: int) -> None:
        """Réserve temporairement des crédits."""
        if amount <= 0:
            raise ValueError(
                "Le nombre de crédits à réserver doit être positif."
            )

        if self.available < amount:
            raise ValueError(
                "Solde de crédits insuffisant."
            )

        self.reserved += amount

    def settle(
        self,
        reserved_amount: int,
        actual_cost: int,
    ) -> None:
        """
        Transforme une réservation en consommation réelle.

        Exemple :
        réservation = 300
        coût réel = 137

        137 crédits sont consommés.
        163 crédits sont libérés.
        """

        if reserved_amount <= 0:
            raise ValueError("Réservation invalide.")

        if actual_cost < 0:
            raise ValueError("Coût réel invalide.")

        if actual_cost > reserved_amount:
            raise ValueError(
                "Le coût réel ne peut pas dépasser "
                "le montant réservé."
            )

        if self.reserved < reserved_amount:
            raise ValueError(
                "Crédits réservés insuffisants."
            )

        self.balance -= actual_cost
        self.reserved -= reserved_amount

    def release(self, amount: int) -> None:
        """Libère une réservation sans consommation."""
        if amount <= 0:
            raise ValueError(
                "Le montant à libérer doit être positif."
            )

        if self.reserved < amount:
            raise ValueError(
                "Crédits réservés insuffisants."
            )

        self.reserved -= amount