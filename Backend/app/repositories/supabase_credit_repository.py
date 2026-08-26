from datetime import datetime

from app.config.credit_costs import CreditAction
from app.models.credit import CreditWallet
from app.models.credit_transaction import (
    CreditTransaction,
    CreditTransactionType,
)
from app.services.credit_repository import CreditRepository


class SupabaseCreditRepository(CreditRepository):
    """
    Implémentation Supabase du repository de crédits.

    Le client Supabase est injecté depuis l'extérieur afin que
    cette couche reste indépendante de la configuration Supabase.

    La consommation de crédits doit passer par la RPC
    `consume_credits` afin que le débit soit effectué
    atomiquement côté PostgreSQL.
    """

    def __init__(self, supabase_client):
        self.supabase = supabase_client

    # ========================================================
    # UTILITAIRE : CONVERSION WALLET
    # ========================================================

    def _wallet_from_data(
        self,
        data: dict,
    ) -> CreditWallet:

        return CreditWallet(
            user_id=data["user_id"],
            balance=data["balance"],
            initial_credits=data["initial_credits"],

            created_at=datetime.fromisoformat(
                data["created_at"].replace(
                    "Z",
                    "+00:00",
                )
            ),

            updated_at=datetime.fromisoformat(
                data["updated_at"].replace(
                    "Z",
                    "+00:00",
                )
            ),

            pack_id=data.get("pack_id"),

            pack_activated_at=(
                datetime.fromisoformat(
                    data["pack_activated_at"].replace(
                        "Z",
                        "+00:00",
                    )
                )
                if data.get("pack_activated_at")
                else None
            ),

            pack_expires_at=(
                datetime.fromisoformat(
                    data["pack_expires_at"].replace(
                        "Z",
                        "+00:00",
                    )
                )
                if data.get("pack_expires_at")
                else None
            ),
        )

    # ========================================================
    # RÉCUPÉRATION DU WALLET
    # ========================================================

    def get_wallet(
        self,
        user_id: str,
    ) -> CreditWallet | None:

        response = (
            self.supabase
            .table("credit_wallets")
            .select("*")
            .eq("user_id", user_id)
            .maybe_single()
            .execute()
        )

        if not response or not response.data:
            return None

        return self._wallet_from_data(
            response.data
        )

    # ========================================================
    # CRÉATION DU WALLET
    # ========================================================

    def create_wallet(
        self,
        wallet: CreditWallet,
    ) -> CreditWallet:

        response = (
            self.supabase
            .table("credit_wallets")
            .insert(
                {
                    "user_id": wallet.user_id,

                    "balance": wallet.balance,

                    "initial_credits": (
                        wallet.initial_credits
                    ),

                    "pack_id": wallet.pack_id,

                    "pack_activated_at": (
                        wallet.pack_activated_at.isoformat()
                        if wallet.pack_activated_at
                        else None
                    ),

                    "pack_expires_at": (
                        wallet.pack_expires_at.isoformat()
                        if wallet.pack_expires_at
                        else None
                    ),

                    "created_at": (
                        wallet.created_at.isoformat()
                    ),

                    "updated_at": (
                        wallet.updated_at.isoformat()
                    ),
                }
            )
            .execute()
        )

        if not response or not response.data:
            raise RuntimeError(
                "Impossible de créer le portefeuille de crédits."
            )

        return self._wallet_from_data(
            response.data[0]
        )

    # ========================================================
    # MISE À JOUR DU WALLET
    # ========================================================
    #
    # IMPORTANT :
    # Cette méthode ne doit PAS être utilisée pour débiter
    # des crédits en production.
    #
    # Les consommations doivent passer par consume_credits()
    # afin de bénéficier de l'atomicité PostgreSQL.
    #
    # Elle reste utile pour les opérations administratives
    # ou les modifications contrôlées du wallet.
    # ========================================================

    def update_wallet(
        self,
        wallet: CreditWallet,
    ) -> CreditWallet:

        response = (
            self.supabase
            .table("credit_wallets")
            .update(
                {
                    "balance": wallet.balance,

                    "updated_at": (
                        wallet.updated_at.isoformat()
                    ),

                    "pack_id": wallet.pack_id,

                    "pack_activated_at": (
                        wallet.pack_activated_at.isoformat()
                        if wallet.pack_activated_at
                        else None
                    ),

                    "pack_expires_at": (
                        wallet.pack_expires_at.isoformat()
                        if wallet.pack_expires_at
                        else None
                    ),
                }
            )
            .eq("user_id", wallet.user_id)
            .execute()
        )

        if not response or not response.data:
            raise RuntimeError(
                "Impossible de mettre à jour le portefeuille de crédits."
            )

        return self._wallet_from_data(
            response.data[0]
        )

    # ========================================================
    # CONSOMMATION ATOMIQUE
    # ========================================================

    def consume_credits(
        self,
        user_id: str,
        amount: int,
        action: CreditAction,
        reference_id: str | None = None,
    ) -> CreditWallet:

        if amount <= 0:
            raise ValueError(
                "Le montant de consommation doit être supérieur à zéro."
            )

        response = (
            self.supabase
            .rpc(
                "consume_credits",
                {
                    "p_user_id": user_id,
                    "p_amount": amount,
                    "p_action": action.value,
                    "p_reference_id": reference_id,
                },
            )
            .execute()
        )

        if not response or not response.data:
            raise RuntimeError(
                "Impossible de consommer les crédits."
            )

        data = response.data

        if isinstance(data, list):
            if not data:
                raise RuntimeError(
                    "La RPC consume_credits "
                    "n'a retourné aucun portefeuille."
                )

            data = data[0]

        if not isinstance(data, dict):
            raise RuntimeError(
                "Réponse inattendue de la RPC consume_credits."
            )

        return self._wallet_from_data(
            data
        )

    # ========================================================
    # RECHARGE ATOMIQUE
    # ========================================================

    def recharge_credits(
        self,
        user_id: str,
        amount: int,
        reference_id: str,
    ) -> CreditWallet:
        """
        Ajoute des crédits à un portefeuille après confirmation
        d'un paiement de recharge.

        La recharge :
        - augmente uniquement `balance` ;
        - ne modifie pas `initial_credits` ;
        - ne modifie pas `pack_id` ;
        - ne modifie pas `pack_activated_at` ;
        - ne modifie pas `pack_expires_at` ;
        - doit être effectuée atomiquement côté PostgreSQL ;
        - utilise `reference_id` pour l'idempotence du paiement.

        La RPC PostgreSQL `recharge_credits` doit effectuer
        simultanément le crédit du wallet et l'enregistrement
        de la transaction `RECHARGE`.
        """

        if amount <= 0:
            raise ValueError(
                "Le montant de recharge doit être supérieur à zéro."
            )

        if not reference_id:
            raise ValueError(
                "La référence de paiement est obligatoire pour une recharge."
            )

        response = (
            self.supabase
            .rpc(
                "recharge_credits",
                {
                    "p_user_id": user_id,
                    "p_amount": amount,
                    "p_reference_id": reference_id,
                },
            )
            .execute()
        )

        if not response or not response.data:
            raise RuntimeError(
                "Impossible de recharger les crédits."
            )

        data = response.data

        if isinstance(data, list):
            if not data:
                raise RuntimeError(
                    "La RPC recharge_credits "
                    "n'a retourné aucun portefeuille."
                )

            data = data[0]

        if not isinstance(data, dict):
            raise RuntimeError(
                "Réponse inattendue de la RPC recharge_credits."
            )

        return self._wallet_from_data(data)

    # ========================================================
    # CRÉATION D'UNE TRANSACTION
    # ========================================================
    #
    # À utiliser pour les transactions qui ne sont pas déjà
    # créées par la RPC de consommation.
    #
    # Une consommation normale ne doit pas appeler cette
    # méthode après consume_credits() si la RPC journalise
    # déjà la transaction.
    # ========================================================

    def create_transaction(
        self,
        transaction: CreditTransaction,
    ) -> CreditTransaction:

        response = (
            self.supabase
            .table("credit_transactions")
            .insert(
                {
                    "id": transaction.id,

                    "user_id": transaction.user_id,

                    "transaction_type": (
                        transaction.transaction_type.value
                    ),

                    "amount": transaction.amount,

                    "balance_after": (
                        transaction.balance_after
                    ),

                    "created_at": (
                        transaction.created_at.isoformat()
                    ),

                    "action": (
                        transaction.action.value
                        if transaction.action
                        else None
                    ),

                    "reference_id": (
                        transaction.reference_id
                    ),
                }
            )
            .execute()
        )

        if not response or not response.data:
            raise RuntimeError(
                "Impossible d'enregistrer la transaction de crédits."
            )

        data = response.data[0]

        return CreditTransaction(
            id=data["id"],

            user_id=data["user_id"],

            transaction_type=CreditTransactionType(
                data["transaction_type"]
            ),

            amount=data["amount"],

            balance_after=data["balance_after"],

            created_at=datetime.fromisoformat(
                data["created_at"].replace(
                    "Z",
                    "+00:00",
                )
            ),

            action=(
                CreditAction(data["action"])
                if data.get("action")
                else None
            ),

            reference_id=data.get(
                "reference_id"
            ),
        )

    # ========================================================
    # HISTORIQUE DES TRANSACTIONS
    # ========================================================

    def get_transactions(
        self,
        user_id: str,
    ) -> list[CreditTransaction]:

        response = (
            self.supabase
            .table("credit_transactions")
            .select("*")
            .eq("user_id", user_id)
            .order(
                "created_at",
                desc=True,
            )
            .execute()
        )

        transactions: list[
            CreditTransaction
        ] = []

        for data in response.data or []:

            transactions.append(
                CreditTransaction(
                    id=data["id"],

                    user_id=data["user_id"],

                    transaction_type=(
                        CreditTransactionType(
                            data["transaction_type"]
                        )
                    ),

                    amount=data["amount"],

                    balance_after=(
                        data["balance_after"]
                    ),

                    created_at=datetime.fromisoformat(
                        data["created_at"].replace(
                            "Z",
                            "+00:00",
                        )
                    ),

                    action=(
                        CreditAction(
                            data["action"]
                        )
                        if data.get("action")
                        else None
                    ),

                    reference_id=(
                        data.get("reference_id")
                    ),
                )
            )

        return transactions