from datetime import datetime
from decimal import Decimal, InvalidOperation
from uuid import UUID
import os



from app.config.credit_costs import (
    CreditAction,
    LIGHT_PACK_API_BUDGET_XAF,
    INTERMEDIATE_PACK_API_BUDGET_XAF,
    PRO_PACK_API_BUDGET_XAF,
    BUSINESS_PACK_API_BUDGET_XAF,
)

from app.models.credit import CreditWallet

from app.models.credit_transaction import (

    CreditTransaction,

    CreditTransactionType,

)

from app.services.credit_repository import CreditRepository





# ============================================================
# MODE HISTORIQUE OPTIONNEL : BUDGET FOURNISSEUR EN PLUS DES CRÉDITS
# ============================================================
# Les plafonds API historiques ne doivent PAS conditionner l'usage de crédits
# achetés, notamment les compléments. Garder le flag à 0 pour le parcours
# crédits seuls jusqu'à la migration SQL et la revue des autres routes.
# Les limites API de credit_costs.py sont les plafonds PAR PACK actif.
# Elles ne représentent pas la dépense réelle : cette dépense et les
# réservations encore ouvertes doivent être conservées en PostgreSQL.
#
# ORIA_ENFORCE_PACK_API_BUDGET=1 active les RPC de réservation budgétée
# APRÈS installation et audit de leur migration SQL. Sans elle, le
# fonctionnement Chat/media historique est inchangé. Les nouvelles
# actions Cours sont bloquées tant que la migration n'est pas active.
# Le mode budget=1 bloque toute ancienne route qui omet le coût API
# fournisseur. Les routeurs et services doivent être raccordés en staging
# AVANT le déploiement du flag en production.
#
# Contrat SQL : voir ORIA_API_BUDGET_SQL_CONTRACT.md livré avec ce fichier.

_PACK_API_LIMIT_XAF = {
    "light_pack": LIGHT_PACK_API_BUDGET_XAF,
    "intermediate_pack": INTERMEDIATE_PACK_API_BUDGET_XAF,
    "pro_pack": PRO_PACK_API_BUDGET_XAF,
    "business_pack": BUSINESS_PACK_API_BUDGET_XAF,
}
_COURSE_ACTIONS = frozenset({
    getattr(CreditAction, "COURSE_TRANSCRIPTION", None),
    getattr(CreditAction, "COURSE_DOCUMENT_GENERATION", None),
}) - {None}

INSUFFICIENT_ACTION_CREDITS_MESSAGE = "Crédits insuffisants pour cette action."


class InsufficientCreditsForActionError(RuntimeError):
    """Code stable pour les routes; message d'interface sans détail API."""

    code = "insufficient_credits"

    def __init__(self) -> None:
        # Les routes actuelles reconnaissent « insufficient_credits » dans
        # str(error) ; elles seront harmonisées à ce message dans ai.py.
        super().__init__(f"{self.code}: {INSUFFICIENT_ACTION_CREDITS_MESSAGE}")


class ApiBudgetConfigurationError(RuntimeError):
    """RPC manquante, snapshot incohérent ou migration SQL non activée."""


class SupabaseCreditRepository(CreditRepository):

    """

    Implémentation Supabase du repository de crédits.



    Le client Supabase est injecté depuis l'extérieur afin que

    cette couche reste indépendante de la configuration Supabase.



    La consommation de crédits doit passer par une RPC atomique PostgreSQL.

    Quand ORIA_ENFORCE_PACK_API_BUDGET=1, tous les appels fournisseur
    doivent fournir DEUX montants indépendants : crédits ORIA et coût API
    estimé/réel en XAF. Aucun coût API n'est déduit du prix en crédits.
    Les anciennes routes non raccordées sont volontairement refusées.

    """



    def __init__(self, supabase_client):

        self.supabase = supabase_client



    @staticmethod
    def _api_budget_enabled() -> bool:
        flag = os.getenv("ORIA_ENFORCE_PACK_API_BUDGET", "0").strip()
        if flag not in ("0", "1"):
            raise ApiBudgetConfigurationError(
                "ORIA_ENFORCE_PACK_API_BUDGET doit valoir 0 ou 1."
            )
        return flag == "1"

    @staticmethod
    def _valid_positive_decimal(value, name: str) -> Decimal:
        try:
            parsed = Decimal(str(value))
        except (InvalidOperation, ValueError, TypeError) as error:
            raise ApiBudgetConfigurationError(
                f"Montant budgétaire invalide : {name}."
            ) from error
        if not parsed.is_finite() or parsed <= 0:
            raise ApiBudgetConfigurationError(
                f"Montant budgétaire non positif ou non fini : {name}."
            )
        return parsed

    @staticmethod
    def _explicit_api_cost_xaf(
        amount: Decimal | str | int | None,
        field: str,
        *,
        allow_zero: bool = False,
    ) -> str:
        """Valide un coût fournisseur XAF, sans le déduire des crédits ORIA.

        Le backend transmet le coût *API* obtenu à partir des tarifs du
        fournisseur (ou de l'usage retourné par celui-ci), converti en XAF.
        Un prix en crédits ne prouve jamais un coût réel de fournisseur.

        Decimal et str sont préférés pour éviter toute erreur de float.
        L'absence de mesure bloque l'action en mode budget, sans repli.
        """
        if amount is None:
            raise ApiBudgetConfigurationError(
                f"Coût fournisseur obligatoire : {field}."
            )
        if isinstance(amount, (bool, float)):
            raise ApiBudgetConfigurationError(
                f"{field} doit être un nombre décimal exact (Decimal, str ou int)."
            )
        try:
            parsed = Decimal(str(amount))
        except (InvalidOperation, ValueError, TypeError) as error:
            raise ApiBudgetConfigurationError(
                f"Coût fournisseur invalide : {field}."
            ) from error
        if not parsed.is_finite() or parsed < 0 or (parsed == 0 and not allow_zero):
            raise ApiBudgetConfigurationError(
                f"Coût fournisseur hors limites : {field}."
            )
        return str(parsed)

    @classmethod
    def _pack_budget_limit(cls, pack_id: str) -> str:
        if pack_id not in _PACK_API_LIMIT_XAF:
            raise ApiBudgetConfigurationError("Plafond API du pack inconnu.")
        return str(cls._valid_positive_decimal(
            _PACK_API_LIMIT_XAF[pack_id], "pack_api_limit_xaf"
        ))

    def _current_budget_pack(self, user_id: str) -> tuple[str, str]:
        # Prélecture indicative ; seule la RPC verrouillant le wallet peut
        # décider définitivement du pack et de son epoch d'activation.
        wallet = self.get_wallet(user_id)
        if wallet is None or not wallet.is_pack_active:
            raise InsufficientCreditsForActionError()
        pack_id = str(wallet.pack_id or "")
        return pack_id, self._pack_budget_limit(pack_id)

    @staticmethod
    def _valid_reference_id(reference_id: str) -> str:
        if not isinstance(reference_id, str):
            raise ValueError("Référence de réservation UUID obligatoire.")
        try:
            return str(UUID(reference_id))
        except (ValueError, AttributeError) as error:
            raise ValueError("Référence de réservation UUID obligatoire.") from error

    @staticmethod
    def _normalize_rpc_data(result, rpc: str) -> dict:
        data = getattr(result, "data", None)
        if isinstance(data, list):
            data = data[0] if len(data) == 1 else None
        if not isinstance(data, dict):
            raise ApiBudgetConfigurationError(
                f"Réponse invalide de la RPC {rpc}."
            )
        return data

    def _checked_budget_rpc_result(
        self, response, *, name: str, user_id: str
    ) -> CreditWallet:
        data = self._normalize_rpc_data(response, name)
        # Le résultat budgété doit attester les deux opérations atomiques
        # (wallet et compteur API), jamais uniquement un solde wallet.
        budget = data.get("api_budget")
        wallet_data = data.get("wallet")
        if not isinstance(wallet_data, dict) or not isinstance(budget, dict):
            raise ApiBudgetConfigurationError(
                f"La RPC {name} n'a pas confirmé le budget et le wallet."
            )
        if str(budget.get("user_id")) != str(user_id):
            raise ApiBudgetConfigurationError(
                "La RPC a renvoyé un budget appartenant à un autre utilisateur."
            )
        pack_id = str(wallet_data.get("pack_id") or "")
        if str(budget.get("pack_id") or "") != pack_id:
            raise ApiBudgetConfigurationError(
                "La RPC n'a pas confirmé le pack actif du budget."
            )
        # Un nouveau pack est une NOUVELLE période comptable : aucun report
        # automatique des réservations/de la dépense du pack précédent.
        if str(budget.get("pack_activated_at") or "") != str(
            wallet_data.get("pack_activated_at") or ""
        ):
            raise ApiBudgetConfigurationError(
                "La RPC n'a pas confirmé la période du pack actif."
            )
        cap = self._valid_positive_decimal(
            budget.get("limit_xaf"), "api_budget.limit_xaf"
        )
        if cap != self._valid_positive_decimal(
            self._pack_budget_limit(pack_id), "pack_limit_xaf"
        ):
            raise ApiBudgetConfigurationError("Le plafond API renvoyé est incohérent.")
        for field in ("spent_xaf", "reserved_xaf"):
            try:
                amount = Decimal(str(budget.get(field)))
            except (ValueError, TypeError, InvalidOperation) as error:
                raise ApiBudgetConfigurationError(
                    f"Etat de budget incomplet : {field}."
                ) from error
            if not amount.is_finite() or amount < 0:
                raise ApiBudgetConfigurationError(
                    f"Etat de budget invalide : {field}."
                )
        # La BD doit empêcher spent+reserved>cap au moment de RÉSERVER.
        # Après SETTLE, si l'usage API réel a dépassé la provision, la BD
        # conserve tout le coût réel (jamais de sous-comptabilisation).
        return self._checked_reservation_wallet(wallet_data, user_id)

    def _execute_budget_rpc(self, name: str, params: dict, user_id: str) -> CreditWallet:
        try:
            response = self.supabase.rpc(name, params).execute()
        except Exception as error:
            # Supabase/PostgreSQL doit utiliser ces codes stables.
            # Ne pas exposer la facture fournisseur ni un message SQL brut.
            msg = str(error).lower()
            if "insufficient_credits" in msg or "insufficient_api_budget" in msg:
                raise InsufficientCreditsForActionError() from error
            if "inactive_pack" in msg:
                raise InsufficientCreditsForActionError() from error
            raise ApiBudgetConfigurationError(
                f"Impossible de confirmer l'opération atomique ({name})."
            ) from error
        return self._checked_budget_rpc_result(response, name=name, user_id=user_id)

    def get_api_budget_snapshot(self, user_id: str) -> dict:
        """Lecture du budget XAF persistant, provenant uniquement de SQL.

        Sans migration, aucun budget restant ne doit être déduit d'un
        solde de crédits : ces deux compteurs sont indépendants.
        """
        if not str(user_id or "").strip():
            raise ValueError("user_id obligatoire.")
        if not self._api_budget_enabled():
            raise ApiBudgetConfigurationError(
                "Le suivi du budget API n'est pas encore activé."
            )
        name = "oria_get_api_budget_snapshot"
        try:
            response = self.supabase.rpc(name, {"p_user_id": user_id}).execute()
        except Exception as error:
            raise ApiBudgetConfigurationError(
                "Impossible de lire le budget API confirmé par Supabase."
            ) from error
        self._checked_budget_rpc_result(response, name=name, user_id=user_id)
        data = self._normalize_rpc_data(response, name)
        return data["api_budget"].copy()

    @staticmethod
    def _course_requires_budget(action: CreditAction) -> bool:
        return action in _COURSE_ACTIONS

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



    # Vérification défensive des réponses RPC reserve / settle / release.
    # La sécurité des écritures (propriétaire + idempotence) doit rester
    # garantie atomiquement dans les fonctions PostgreSQL correspondantes.
    def _checked_reservation_wallet(
        self,
        wallet_data: dict,
        user_id: str,
    ) -> CreditWallet:
        if str(wallet_data.get("user_id") or "") != str(user_id).strip():
            raise RuntimeError(
                "La RPC de crédits a retourné un portefeuille qui "
                "n'appartient pas à l'utilisateur demandé."
            )
        return self._wallet_from_data(wallet_data)

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
    # CRÉATION / RÉACTIVATION DU WALLET
    # ========================================================

    def create_wallet(
        self,
        wallet: CreditWallet,
    ) -> CreditWallet:
        """
        Active un pack principal.

        Premier achat :
            création du wallet.

        Réactivation / nouvel achat de pack principal :
            remplacement du pack actuellement stocké dans le wallet.

        Le nouveau pack repart avec :
        - balance = crédits du nouveau pack ;
        - initial_credits = crédits du nouveau pack ;
        - nouveau pack_id ;
        - nouvelle date d'activation ;
        - nouvelle date d'expiration.

        Les anciennes lignes de credit_transactions sont conservées.
        """

        if self._api_budget_enabled():
            # Renouvellement et budget API remis à zéro dans UNE transaction.
            # Le contrôle anti-double paiement doit rester dans la RPC SQL.
            payload = {
                "user_id": wallet.user_id,
                "balance": wallet.balance,
                "initial_credits": wallet.initial_credits,
                "pack_id": wallet.pack_id,
                "pack_activated_at": (
                    wallet.pack_activated_at.isoformat()
                    if wallet.pack_activated_at else None
                ),
                "pack_expires_at": (
                    wallet.pack_expires_at.isoformat()
                    if wallet.pack_expires_at else None
                ),
                "updated_at": wallet.updated_at.isoformat(),
                "created_at": wallet.created_at.isoformat(),
            }
            return self._execute_budget_rpc(
                "oria_activate_pack_with_api_budget",
                {"p_wallet": payload,
                 "p_api_limit_xaf": self._pack_budget_limit(wallet.pack_id)},
                wallet.user_id,
            )

        existing_wallet = self.get_wallet(
            wallet.user_id
        )

        payload = {
            "balance": wallet.balance,
            "initial_credits": wallet.initial_credits,
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
            "updated_at": wallet.updated_at.isoformat(),
        }

        # ----------------------------------------------------
        # WALLET EXISTANT -> RÉACTIVATION / REMPLACEMENT
        # ----------------------------------------------------

        if existing_wallet is not None:
            response = (
                self.supabase
                .table("credit_wallets")
                .update(payload)
                .eq("user_id", wallet.user_id)
                .execute()
            )

            if not response or not response.data:
                raise RuntimeError(
                    "Impossible de réactiver le portefeuille de crédits."
                )

            return self._wallet_from_data(
                response.data[0]
            )

        # ----------------------------------------------------
        # AUCUN WALLET -> PREMIER PACK
        # ----------------------------------------------------

        create_payload = {
            "user_id": wallet.user_id,
            **payload,
            "created_at": wallet.created_at.isoformat(),
        }

        response = (
            self.supabase
            .table("credit_wallets")
            .insert(create_payload)
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



        if self._api_budget_enabled():
            raise ApiBudgetConfigurationError(
                "Modification directe du wallet interdite avec budget API actif : "
                "utiliser une RPC administrative atomique auditee."
            )

        response = (

            self.supabase

            .table("credit_wallets")

            .update(

                {

                    "balance": wallet.balance,




                    "initial_credits": (
                        wallet.initial_credits
                    ),

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
        *,
        api_cost_xaf: Decimal | str | int | None = None,

    ) -> CreditWallet:



        if type(amount) is not int or amount <= 0:

            raise ValueError(

                "Le montant de consommation doit être un entier positif."

            )



        if self._api_budget_enabled():
            if not isinstance(action, CreditAction):
                raise ValueError("Action de crédits invalide.")
            # Pas de débit non idempotent sous le nouveau système.
            # Coût fournisseur explicite obligatoire, même si les crédits
            # ORIA sont disponibles : l'enveloppe API est indépendante.
            actual_api_xaf = self._explicit_api_cost_xaf(
                api_cost_xaf, "api_cost_xaf"
            )
            reservation_id = self._valid_reference_id(reference_id)
            pack_id, cap = self._current_budget_pack(user_id)
            return self._execute_budget_rpc(
                "oria_consume_credits_with_api_budget",
                {
                    "p_user_id": user_id,
                    "p_amount": amount,
                    "p_action": action.value,
                    "p_reservation_id": reservation_id,
                    "p_expected_pack_id": pack_id,
                    "p_api_limit_xaf": cap,
                    "p_api_cost_xaf": actual_api_xaf,
                },
                user_id,
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





    # ========================================================

    # RÉSERVATION / SETTLE DES CRÉDITS

    # ========================================================



    def reserve_credits(

        self,

        user_id: str,

        amount: int,

        action: CreditAction,

        reference_id: str,

        *,

        ttl_seconds: int | None = None,
        api_reservation_xaf: Decimal | str | int | None = None,

    ) -> CreditWallet:

        """Réserve atomiquement des crédits avant l'appel IA.

        Le chat et les médias existants conservent le TTL SQL par défaut
        (900 secondes). AUDIO_TRANSCRIPTION utilise 3600 secondes ;
        ORIA Cours peut fournir un TTL plus long (21600 s par défaut).
        IMPORTANT: ce délai doit être accepté par la RPC PostgreSQL réelle.
        """

        if not str(user_id or "").strip():
            raise ValueError("user_id est obligatoire pour réserver des crédits.")

        if isinstance(amount, bool) or not isinstance(amount, int) or amount <= 0:
            raise ValueError("Le montant à réserver doit être un entier positif.")

        if not isinstance(action, CreditAction):
            raise ValueError("L'action de crédits doit être une CreditAction valide.")

        if not isinstance(reference_id, str) or not reference_id.strip():
            raise ValueError("La référence de réservation est obligatoire.")

        if self._api_budget_enabled():
            # Coût fournisseur estimé, distinct du nombre de crédits.
            # Une route non raccordée n'a pas le droit de consommer l'API.
            estimated_api_xaf = self._explicit_api_cost_xaf(
                api_reservation_xaf, "api_reservation_xaf"
            )
            # La RPC revalide le pack, sa période, le solde ET le budget
            # fournisseur sous verrou PostgreSQL.
            reference_uuid = self._valid_reference_id(reference_id)
            pack_id, cap = self._current_budget_pack(user_id)
            audio_action = getattr(CreditAction, "AUDIO_TRANSCRIPTION", None)
            if action == audio_action:
                raw = (str(ttl_seconds) if ttl_seconds is not None else
                       os.getenv("ORIA_AUDIO_RESERVATION_TTL_SECONDS", "3600"))
                min_ttl, max_ttl = 900, 7200
            elif action in _COURSE_ACTIONS:
                raw = (str(ttl_seconds) if ttl_seconds is not None else
                       os.getenv("ORIA_COURSE_RESERVATION_TTL_SECONDS", "21600"))
                min_ttl, max_ttl = 3600, 86400
            else:
                if ttl_seconds is not None:
                    raise ValueError("TTL personnalisé réservé aux actions audio/cours.")
                raw, min_ttl, max_ttl = "900", 900, 900
            try:
                resolved_ttl = int(raw)
            except (TypeError, ValueError) as error:
                raise ValueError("TTL de réservation invalide.") from error
            if isinstance(ttl_seconds, bool) or not min_ttl <= resolved_ttl <= max_ttl:
                raise ValueError("TTL de réservation hors limites.")
            return self._execute_budget_rpc(
                "oria_reserve_credits_with_api_budget",
                {
                    "p_user_id": user_id,
                    "p_amount": amount,
                    "p_action": action.value,
                    "p_reservation_id": reference_uuid,
                    "p_expected_pack_id": pack_id,
                    "p_api_limit_xaf": cap,
                    "p_api_reservation_xaf": estimated_api_xaf,
                    "p_ttl_seconds": resolved_ttl,
                },
                user_id,
            )
        # ORIA Cours utilise le même wallet prépayé que le Chat et les médias.
        # Les coûts fournisseur transmis restent informatifs : ils figurent
        # également dans le plan et le registre SQL du cours. Aucun second
        # plafond par pack n'est appliqué en mode crédits seuls.
        if action in _COURSE_ACTIONS:
            self._valid_reference_id(reference_id)
            if api_reservation_xaf is not None:
                self._explicit_api_cost_xaf(api_reservation_xaf, "api_reservation_xaf")

        # Le défaut SQL (15 min) reste intact pour toutes les autres actions.
        # La RPC existante accepte déjà p_ttl_seconds avec valeur par défaut 900.
        rpc_params = {
            "p_user_id": user_id,
            "p_amount": amount,
            "p_action": action.value,
            "p_reservation_id": reference_id,
        }
        audio_action = getattr(CreditAction, "AUDIO_TRANSCRIPTION", None)
        if action == audio_action:
            if ttl_seconds is None:
                raw_ttl = os.getenv("ORIA_AUDIO_RESERVATION_TTL_SECONDS", "3600")
                try:
                    resolved_ttl = int(raw_ttl)
                except (TypeError, ValueError) as exc:
                    raise ValueError(
                        "ORIA_AUDIO_RESERVATION_TTL_SECONDS doit être un entier."
                    ) from exc
            else:
                resolved_ttl = ttl_seconds

            if (isinstance(resolved_ttl, bool)
                    or not isinstance(resolved_ttl, int)
                    or not 900 <= resolved_ttl <= 7200):
                raise ValueError(
                    "Le délai audio doit être un entier entre 900 et 7200 secondes."
                )
            rpc_params["p_ttl_seconds"] = resolved_ttl
        elif action in _COURSE_ACTIONS:
            if ttl_seconds is None:
                raw_ttl = os.getenv("ORIA_COURSE_RESERVATION_TTL_SECONDS", "21600")
                try:
                    resolved_ttl = int(raw_ttl)
                except (TypeError, ValueError) as exc:
                    raise ValueError("TTL de réservation Cours invalide.") from exc
            else:
                resolved_ttl = ttl_seconds
            if (isinstance(resolved_ttl, bool)
                    or not isinstance(resolved_ttl, int)
                    or not 3600 <= resolved_ttl <= 86400):
                raise ValueError("TTL Cours attendu entre 3600 et 86400 secondes.")
            rpc_params["p_ttl_seconds"] = resolved_ttl
        elif ttl_seconds is not None:
            raise ValueError(
                "Le délai personnalisé est réservé aux actions audio et Cours."
            )

        response = (

            self.supabase

            .rpc(

                "reserve_credits",

                rpc_params,

            )

            .execute()

        )



        if not response or not response.data:

            raise RuntimeError("Impossible de réserver les crédits.")



        data = response.data

        if isinstance(data, list):

            if not data:

                raise RuntimeError(

                    "La RPC reserve_credits n'a retourné aucun portefeuille."

                )

            data = data[0]



        if not isinstance(data, dict):

            raise RuntimeError("Réponse inattendue de la RPC reserve_credits.")



        wallet_data = data.get("wallet")

        if not isinstance(wallet_data, dict):

            raise RuntimeError(

                "La RPC de réservation n'a retourné aucun wallet exploitable."

            )



        return self._checked_reservation_wallet(wallet_data, user_id)



    def settle_credit_reservation(

        self,

        user_id: str,

        reference_id: str,

        actual_amount: int,
        *,
        actual_api_cost_xaf: Decimal | str | int | None = None,

    ) -> CreditWallet:

        """Finalise le coût en crédits ET la dépense fournisseur réelle.

        Ne jamais inventer la facture fournisseur en multipliant les crédits
        par leur valeur comptable : les deux comptabilités sont séparées.
        """

        if not str(user_id or "").strip():
            raise ValueError("user_id est obligatoire pour régler des crédits.")

        if (isinstance(actual_amount, bool)
                or not isinstance(actual_amount, int)
                or actual_amount <= 0):
            raise ValueError("Le coût réel doit être un entier positif.")

        if not isinstance(reference_id, str) or not reference_id.strip():
            raise ValueError("La référence de réservation est obligatoire.")



        if self._api_budget_enabled():
            real_api_xaf = self._explicit_api_cost_xaf(
                actual_api_cost_xaf, "actual_api_cost_xaf", allow_zero=True
            )
            # Ne pas relire le pack courant comme autorité : une tâche
            # démarrée avant renouvellement/expiration doit pouvoir régler
            # sa réservation D'ORIGINE sans toucher au budget du nouveau pack.
            return self._execute_budget_rpc(
                "oria_settle_credit_reservation_with_api_budget",
                {
                    "p_user_id": user_id,
                    "p_reservation_id": self._valid_reference_id(reference_id),
                    "p_actual_amount": actual_amount,
                    "p_actual_api_cost_xaf": real_api_xaf,
                },
                user_id,
            )

        response = (

            self.supabase

            .rpc(

                "settle_credit_reservation",

                {

                    "p_reservation_id": reference_id,

                    "p_actual_amount": actual_amount,

                },

            )

            .execute()

        )



        if not response or not response.data:

            raise RuntimeError("Impossible de finaliser la réservation de crédits.")



        data = response.data

        if isinstance(data, list):

            if not data:

                raise RuntimeError(

                    "La RPC settle_credit_reservation "

                    "n'a retourné aucun portefeuille."

                )

            data = data[0]



        if not isinstance(data, dict):

            raise RuntimeError(

                "Réponse inattendue de la RPC settle_credit_reservation."

            )



        wallet_data = data.get("wallet")

        if not isinstance(wallet_data, dict):

            raise RuntimeError(

                "La RPC de réservation n'a retourné aucun wallet exploitable."

            )



        return self._checked_reservation_wallet(wallet_data, user_id)



    def release_credit_reservation(

        self,

        user_id: str,

        reference_id: str,

    ) -> CreditWallet:

        """Libère une réservation lorsque l'appel IA échoue."""

        if not str(user_id or "").strip():
            raise ValueError("user_id est obligatoire pour libérer des crédits.")

        if not isinstance(reference_id, str) or not reference_id.strip():
            raise ValueError("La référence de réservation est obligatoire.")



        if self._api_budget_enabled():
            # La RPC vérifie le propriétaire et la période d'origine de
            # la réservation ; l'ancien pack n'est jamais remboursé dans
            # le nouveau budget lors d'un renouvellement.
            return self._execute_budget_rpc(
                "oria_release_credit_reservation_with_api_budget",
                {
                    "p_user_id": user_id,
                    "p_reservation_id": self._valid_reference_id(reference_id),
                },
                user_id,
            )

        response = (

            self.supabase

            .rpc(

                "release_credit_reservation",

                {

                    "p_reservation_id": reference_id,

                },

            )

            .execute()

        )



        if not response or not response.data:

            raise RuntimeError("Impossible de libérer la réservation de crédits.")



        data = response.data

        if isinstance(data, list):

            if not data:

                raise RuntimeError(

                    "La RPC release_credit_reservation "

                    "n'a retourné aucun portefeuille."

                )

            data = data[0]



        if not isinstance(data, dict):

            raise RuntimeError(

                "Réponse inattendue de la RPC release_credit_reservation."

            )



        wallet_data = data.get("wallet")

        if not isinstance(wallet_data, dict):

            raise RuntimeError(

                "La RPC de réservation n'a retourné aucun wallet exploitable."

            )



        return self._checked_reservation_wallet(wallet_data, user_id)



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