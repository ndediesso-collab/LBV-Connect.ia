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
    # ACTIONS CHAT — FACTURATION DYNAMIQUE
    # ========================================================

    CHAT_ACTIONS: set[CreditAction] = {
        CreditAction.CHAT_LUNA,
        CreditAction.CHAT_LUNA_WEB,
        CreditAction.CHAT_GPT5,
        CreditAction.CHAT_GPT5_WEB,
        CreditAction.CHAT_TERRA,
        CreditAction.CHAT_TERRA_WEB,
        CreditAction.CHAT_SOL,
        CreditAction.CHAT_SOL_WEB,
        CreditAction.CHAT_ASTRA,
        CreditAction.CHAT_ASTRA_WEB,
    }

    # Le coût du Chat n'est plus stocké ici.
    # Cette table sert uniquement à conserver une validation métier
    # supplémentaire au niveau de CreditService.
    PACK_ALLOWED_CHAT_ACTIONS: dict[
        str,
        set[CreditAction],
    ] = {
        "light_pack": {
            CreditAction.CHAT_LUNA,
            CreditAction.CHAT_LUNA_WEB,
        },

        "intermediate_pack": {
            CreditAction.CHAT_LUNA,
            CreditAction.CHAT_LUNA_WEB,
            CreditAction.CHAT_GPT5,
            CreditAction.CHAT_GPT5_WEB,
        },

        "pro_pack": {
            CreditAction.CHAT_LUNA,
            CreditAction.CHAT_LUNA_WEB,
            CreditAction.CHAT_GPT5,
            CreditAction.CHAT_GPT5_WEB,
            CreditAction.CHAT_TERRA,
            CreditAction.CHAT_TERRA_WEB,
        },

        "business_pack": {
            CreditAction.CHAT_SOL,
            CreditAction.CHAT_SOL_WEB,
            CreditAction.CHAT_ASTRA,
            CreditAction.CHAT_ASTRA_WEB,
        },
    }

    # ========================================================
    # MÉDIAS — COÛTS FIXES TEMPORAIRES
    # ========================================================
    #
    # Les images/vidéos restent volontairement sur l'ancien système
    # jusqu'à leur audit tarifaire séparé.
    #

    MEDIA_ACTION_COSTS: dict[
        str,
        dict[CreditAction, int],
    ] = {

        "light_pack": {
            CreditAction.IMAGE_480: 50,
            CreditAction.IMAGE_720: 75,

            CreditAction.VIDEO_4S: 500,
            CreditAction.VIDEO_8S: 1_000,
        },

        "intermediate_pack": {
            CreditAction.IMAGE_480: 50,
            CreditAction.IMAGE_720: 75,

            CreditAction.VIDEO_LITE: 1_500,
        },

        "pro_pack": {
            CreditAction.IMAGE_PRO: 100,
            CreditAction.IMAGE_PRO_STANDARD: 180,
            CreditAction.IMAGE_PRO_ULTRA: 270,

            CreditAction.VIDEO_PRO_FAST: 1_500,
            CreditAction.VIDEO_PRO_STANDARD: 3_000,
            CreditAction.VIDEO_PRO_EXTENSION: 1_500,
        },

        "business_pack": {
            CreditAction.IMAGE_BUSINESS: 250,
            CreditAction.IMAGE_BUSINESS_HD: 400,
            CreditAction.IMAGE_BUSINESS_ULTRA: 600,

            CreditAction.VIDEO_BUSINESS_FAST: 2_500,
            CreditAction.VIDEO_BUSINESS_STANDARD: 5_000,
            CreditAction.VIDEO_BUSINESS_LONG: 10_000,
        },
    }


    # ========================================================
    # COÛT FIXE — MÉDIAS UNIQUEMENT
    # ========================================================

    @classmethod
    def get_cost(
        cls,
        wallet: CreditWallet,
        action: CreditAction,
    ) -> int:
        """
        Retourne le coût fixe d'une action média.

        Les actions Chat n'ont plus de coût prédéfini.
        Elles doivent obligatoirement fournir un cost_override calculé
        par TokenBillingService à partir de l'usage OpenAI réel.
        """

        if action in cls.CHAT_ACTIONS:
            raise UnsupportedActionError(
                "Une action Chat ne possède plus de coût fixe. "
                "Un coût dynamique calculé depuis l'usage OpenAI "
                "doit être fourni."
            )

        pack_costs = cls.MEDIA_ACTION_COSTS.get(
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

        CHAT
        ----
        Le coût est obligatoirement dynamique :
            TokenBillingService -> cost_override

        MÉDIA
        -----
        Sans override :
            coût fixe temporaire de MEDIA_ACTION_COSTS.

        Avec override :
            le coût transmis par une couche supérieure peut être utilisé,
            tout en conservant la validation de disponibilité de l'action.
        """

        # ====================================================
        # CHAT — COÛT DYNAMIQUE OBLIGATOIRE
        # ====================================================

        if action in cls.CHAT_ACTIONS:

            allowed_actions = (
                cls.PACK_ALLOWED_CHAT_ACTIONS.get(
                    wallet.pack_id
                )
            )

            if allowed_actions is None:
                raise UnsupportedActionError(
                    "Le type de pack associé au portefeuille "
                    "n'est pas reconnu."
                )

            if action not in allowed_actions:
                raise UnsupportedActionError(
                    f"L'action '{action.value}' "
                    "n'est pas disponible avec ce pack."
                )

            if cost_override is None:
                raise ValueError(
                    "Une action Chat nécessite désormais "
                    "un coût dynamique calculé depuis l'usage OpenAI."
                )

            return cls._validate_cost_override(
                cost_override
            )

        # ====================================================
        # MÉDIA — COÛT FIXE OU OVERRIDE
        # ====================================================

        base_cost = cls.get_cost(
            wallet,
            action,
        )

        if cost_override is None:
            return base_cost

        return cls._validate_cost_override(
            cost_override
        )


    @staticmethod
    def _validate_cost_override(
        cost_override: int,
    ) -> int:
        """
        Valide un coût calculé en amont.

        Le coût doit être un entier strictement positif.
        """

        if isinstance(
            cost_override,
            bool,
        ) or not isinstance(
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