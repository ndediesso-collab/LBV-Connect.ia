from __future__ import annotations

from dataclasses import asdict, dataclass

from decimal import Decimal, ROUND_CEILING

from typing import Any, Mapping

from app.config.credit_costs import (
    ACCOUNTING_USD_XAF,
    CreditAction,
    IMAGE_ACTION_QUALITY,
    IMAGE_MODEL_BY_PACK,
    IMAGE_REFERENCE_OUTPUT_COST_USD_1024_SQUARE,
    IMAGE_TOKEN_PRICING_USD_PER_MILLION,
    LONG_CONTEXT_THRESHOLD_TOKENS,
    MAX_CHAT_OUTPUT_TOKENS,
    MAX_WEB_SEARCH_CALLS_PER_ACTION,
    MODEL_TOKEN_PRICING_USD_PER_MILLION,
    ORIA_CREDIT_VALUE_XAF,
    VIDEO_ACTION_DURATION_SECONDS,
    VIDEO_MODEL_BY_PACK,
    VIDEO_PROVIDER_BY_PACK,
    WEB_SEARCH_COST_USD_PER_CALL,
)

# ============================================================

# CONSTANTES INTERNES

# ============================================================

_ONE_MILLION = Decimal("1000000")

# Alias acceptés afin que le service fonctionne aussi bien avec

# les identifiants Oria qu'avec les identifiants OpenAI.

_MODEL_ALIASES = {

    "luna": "luna",

    "gpt-5.6-luna": "luna",

    "gpt-5": "gpt-5",

    "terra": "gpt-5.6-terra",

    "gpt-5.6-terra": "gpt-5.6-terra",

    "sol": "gpt-5.6-sol",

    "gpt-5.6-sol": "gpt-5.6-sol",

    "astra": "gpt-6-astra",

    "gpt-6-astra": "gpt-6-astra",

}

# Seuls les modèles 1,05 M concernés par notre grille actuelle

# basculent vers le tarif long-context au-delà de 272k tokens.

_LONG_CONTEXT_MODELS = {

    "luna",

    "gpt-5.6-terra",

    "gpt-5.6-sol",

    "gpt-6-astra",

}

# ============================================================

# ERREURS

# ============================================================

class TokenBillingError(ValueError):

    """Erreur de données ou de configuration de facturation."""

class UnsupportedBillingModelError(TokenBillingError):

    """Modèle non pris en charge par le calculateur Oria."""

class InvalidUsageError(TokenBillingError):

    """Objet usage incohérent ou invalide."""

# ============================================================

# RÉSULTAT

# ============================================================

@dataclass(frozen=True)

class TokenBillingResult:

    """

    Résultat complet du calcul d'une requête Chat Oria.

    Les coûts par catégorie permettent de garder une trace précise

    de ce qui a produit la facturation finale.

    """

    model: str

    pricing_context: str

    input_tokens: int

    ordinary_input_tokens: int

    cached_input_tokens: int

    cache_write_tokens: int

    output_tokens: int

    reasoning_tokens: int

    total_tokens: int

    web_search_calls: int

    input_cost_usd: Decimal

    cached_input_cost_usd: Decimal

    cache_write_cost_usd: Decimal

    output_cost_usd: Decimal

    web_search_cost_usd: Decimal

    total_cost_usd: Decimal

    total_cost_xaf: Decimal

    credits: int

    def to_dict(self) -> dict[str, Any]:

        """

        Retourne un dictionnaire sérialisable en JSON.

        Les Decimal sont transformés en chaînes pour éviter les erreurs

        d'arrondi silencieuses liées aux float.

        """

        data = asdict(self)

        decimal_fields = {

            "input_cost_usd",

            "cached_input_cost_usd",

            "cache_write_cost_usd",

            "output_cost_usd",

            "web_search_cost_usd",

            "total_cost_usd",

            "total_cost_xaf",

        }

        for field in decimal_fields:

            data[field] = str(data[field])

        return data

# ============================================================

# SERVICE

# ============================================================

class TokenBillingService:

    """

    Source de vérité du coût réel d'un Chat Oria.

    Ce service NE :

        - modifie pas le wallet ;

        - n'écrit pas dans Supabase ;

        - ne crée pas de transaction ;

        - ne décide pas si un modèle est autorisé par un pack.

    Son unique responsabilité est :

        usage OpenAI

            -> coût USD

            -> coût XAF

            -> crédits Oria

    """

    @staticmethod

    def _decimal(value: Any, field_name: str) -> Decimal:

        try:

            result = Decimal(str(value))

        except Exception as error:

            raise TokenBillingError(

                f"Valeur invalide pour '{field_name}' : {value!r}"

            ) from error

        if result < 0:

            raise TokenBillingError(

                f"'{field_name}' ne peut pas être négatif."

            )

        return result

    @staticmethod

    def _non_negative_int(value: Any, field_name: str) -> int:

        try:

            result = int(value or 0)

        except (TypeError, ValueError) as error:

            raise InvalidUsageError(

                f"Valeur invalide pour '{field_name}' : {value!r}"

            ) from error

        if result < 0:

            raise InvalidUsageError(

                f"'{field_name}' ne peut pas être négatif."

            )

        return result

    @classmethod

    def normalize_model(cls, model: str) -> str:

        normalized = str(model or "").strip().lower()

        canonical = _MODEL_ALIASES.get(normalized)

        if canonical is None:

            raise UnsupportedBillingModelError(

                f"Modèle non pris en charge pour la facturation : {model!r}"

            )

        if canonical not in MODEL_TOKEN_PRICING_USD_PER_MILLION:

            raise UnsupportedBillingModelError(

                f"Aucune grille tarifaire configurée pour : {canonical}"

            )

        return canonical

    @classmethod

    def _normalize_usage(

        cls,

        usage: Mapping[str, Any],

    ) -> dict[str, int]:

        if not isinstance(usage, Mapping):

            raise InvalidUsageError(

                "usage doit être un dictionnaire ou un objet Mapping."

            )

        input_tokens = cls._non_negative_int(

            usage.get("input_tokens", 0),

            "input_tokens",

        )

        cached_input_tokens = cls._non_negative_int(

            usage.get("cached_input_tokens", 0),

            "cached_input_tokens",

        )

        cache_write_tokens = cls._non_negative_int(

            usage.get("cache_write_tokens", 0),

            "cache_write_tokens",

        )

        output_tokens = cls._non_negative_int(

            usage.get("output_tokens", 0),

            "output_tokens",

        )

        reasoning_tokens = cls._non_negative_int(

            usage.get("reasoning_tokens", 0),

            "reasoning_tokens",

        )

        total_tokens = cls._non_negative_int(

            usage.get("total_tokens", 0),

            "total_tokens",

        )

        # OpenAI inclut les tokens cached et cache-write dans input_tokens.

        # On les soustrait donc pour déterminer uniquement l'entrée ordinaire.

        if cached_input_tokens + cache_write_tokens > input_tokens:

            raise InvalidUsageError(

                "cached_input_tokens + cache_write_tokens "

                "ne peut pas dépasser input_tokens."

            )

        # OpenAI inclut les tokens de raisonnement dans output_tokens.

        if reasoning_tokens > output_tokens:

            raise InvalidUsageError(

                "reasoning_tokens ne peut pas dépasser output_tokens."

            )

        computed_total = input_tokens + output_tokens

        # total_tokens est informatif. S'il est absent, on le reconstitue.

        if total_tokens == 0:

            total_tokens = computed_total

        # Une légère divergence de total ne doit pas créer une sous-facturation :

        # le calcul repose toujours sur input_tokens et output_tokens séparés.

        return {

            "input_tokens": input_tokens,

            "cached_input_tokens": cached_input_tokens,

            "cache_write_tokens": cache_write_tokens,

            "output_tokens": output_tokens,

            "reasoning_tokens": reasoning_tokens,

            "total_tokens": total_tokens,

        }

    @classmethod

    def _pricing_context(

        cls,

        model: str,

        input_tokens: int,

    ) -> str:

        if (

            model in _LONG_CONTEXT_MODELS

            and input_tokens > LONG_CONTEXT_THRESHOLD_TOKENS

        ):

            return "long"

        return "short"

    @classmethod

    def calculate(

        cls,

        *,

        model: str,

        usage: Mapping[str, Any],

        web_search_calls: int = 0,

    ) -> TokenBillingResult:

        """

        Calcule le coût réel d'une requête Chat Oria.

        Paramètres

        ----------

        model:

            Identifiant Oria ("luna", "gpt-5.6-terra"...)

            ou identifiant OpenAI correspondant.

        usage:

            Dictionnaire produit par OpenAIService, par exemple :

            {

                "input_tokens": 5000,

                "cached_input_tokens": 1000,

                "cache_write_tokens": 0,

                "output_tokens": 2000,

                "reasoning_tokens": 500,

                "total_tokens": 7000,

            }

        web_search_calls:

            Nombre d'appels Web réellement exécutés par OpenAI.

        Retour

        ------

        TokenBillingResult

            Coût détaillé USD, XAF et crédits Oria.

        """

        canonical_model = cls.normalize_model(model)

        normalized_usage = cls._normalize_usage(usage)

        web_search_calls = cls._non_negative_int(

            web_search_calls,

            "web_search_calls",

        )

        input_tokens = normalized_usage["input_tokens"]

        cached_input_tokens = normalized_usage[

            "cached_input_tokens"

        ]

        cache_write_tokens = normalized_usage[

            "cache_write_tokens"

        ]

        output_tokens = normalized_usage["output_tokens"]

        reasoning_tokens = normalized_usage[

            "reasoning_tokens"

        ]

        total_tokens = normalized_usage["total_tokens"]

        ordinary_input_tokens = (

            input_tokens

            - cached_input_tokens

            - cache_write_tokens

        )

        pricing_context = cls._pricing_context(

            canonical_model,

            input_tokens,

        )

        pricing = MODEL_TOKEN_PRICING_USD_PER_MILLION[

            canonical_model

        ]

        input_rate = cls._decimal(

            pricing[f"{pricing_context}_input"],

            "input_rate",

        )

        cached_input_rate = cls._decimal(

            pricing[f"{pricing_context}_cached_input"],

            "cached_input_rate",

        )

        cache_write_rate = cls._decimal(

            pricing[f"{pricing_context}_cache_write"],

            "cache_write_rate",

        )

        output_rate = cls._decimal(

            pricing[f"{pricing_context}_output"],

            "output_rate",

        )

        input_cost_usd = (

            Decimal(ordinary_input_tokens)

            * input_rate

            / _ONE_MILLION

        )

        cached_input_cost_usd = (

            Decimal(cached_input_tokens)

            * cached_input_rate

            / _ONE_MILLION

        )

        cache_write_cost_usd = (

            Decimal(cache_write_tokens)

            * cache_write_rate

            / _ONE_MILLION

        )

        # reasoning_tokens est déjà inclus dans output_tokens.

        # On facture donc output_tokens une seule fois.

        output_cost_usd = (

            Decimal(output_tokens)

            * output_rate

            / _ONE_MILLION

        )

        web_search_cost_usd = (

            Decimal(web_search_calls)

            * cls._decimal(

                WEB_SEARCH_COST_USD_PER_CALL,

                "WEB_SEARCH_COST_USD_PER_CALL",

            )

        )

        total_cost_usd = (

            input_cost_usd

            + cached_input_cost_usd

            + cache_write_cost_usd

            + output_cost_usd

            + web_search_cost_usd

        )

        total_cost_xaf = (

            total_cost_usd

            * cls._decimal(

                ACCOUNTING_USD_XAF,

                "ACCOUNTING_USD_XAF",

            )

        )

        credit_value_xaf = cls._decimal(

            ORIA_CREDIT_VALUE_XAF,

            "ORIA_CREDIT_VALUE_XAF",

        )

        if credit_value_xaf <= 0:

            raise TokenBillingError(

                "ORIA_CREDIT_VALUE_XAF doit être supérieur à zéro."

            )

        # Arrondi supérieur obligatoire :

        # Oria ne doit jamais arrondir un coût API vers le bas.

        credits_decimal = (

            total_cost_xaf / credit_value_xaf

        ).to_integral_value(

            rounding=ROUND_CEILING

        )

        credits = int(credits_decimal)

        return TokenBillingResult(

            model=canonical_model,

            pricing_context=pricing_context,

            input_tokens=input_tokens,

            ordinary_input_tokens=ordinary_input_tokens,

            cached_input_tokens=cached_input_tokens,

            cache_write_tokens=cache_write_tokens,

            output_tokens=output_tokens,

            reasoning_tokens=reasoning_tokens,

            total_tokens=total_tokens,

            web_search_calls=web_search_calls,

            input_cost_usd=input_cost_usd,

            cached_input_cost_usd=cached_input_cost_usd,

            cache_write_cost_usd=cache_write_cost_usd,

            output_cost_usd=output_cost_usd,

            web_search_cost_usd=web_search_cost_usd,

            total_cost_usd=total_cost_usd,

            total_cost_xaf=total_cost_xaf,

            credits=credits,

        )

    @classmethod

    def calculate_from_openai_result(

        cls,

        result: Mapping[str, Any],

    ) -> TokenBillingResult:

        """

        Raccourci prévu pour le dictionnaire renvoyé par OpenAIService.

        Exemple :

            billing = TokenBillingService.calculate_from_openai_result(

                {

                    "model": "gpt-5.6-terra",

                    "usage": {...},

                    "web_search_calls": 1,

                }

            )

        """

        if not isinstance(result, Mapping):

            raise TokenBillingError(

                "Le résultat OpenAI doit être un objet Mapping."

            )

        model = (

            result.get("model")

            or result.get("openai_model")

        )

        usage = result.get("usage")

        if not model:

            raise TokenBillingError(

                "Le résultat OpenAI ne contient aucun modèle."

            )

        if not isinstance(usage, Mapping):

            raise TokenBillingError(

                "Le résultat OpenAI ne contient aucun usage exploitable."

            )

        return cls.calculate(

            model=str(model),

            usage=usage,

            web_search_calls=result.get(

                "web_search_calls",

                0,

            ),

        )

    @classmethod

    def estimate_reservation(

        cls,

        *,

        model: str,

        estimated_input_tokens: int,

        max_output_tokens: int = MAX_CHAT_OUTPUT_TOKENS,

        web_enabled: bool = False,

    ) -> int:

        """

        Estime le nombre de crédits à réserver AVANT l'appel OpenAI.

        L'estimation est prudente :

        - l'entrée utilise le tarif le plus élevé entre input,

          cached_input et cache_write ;

        - la sortie réserve jusqu'à max_output_tokens ;

        - si le Web est activé, le plafond complet d'appels Web

          autorisés est inclus.

        Le coût réel reste calculé après l'appel par calculate().

        Le settlement libère ensuite l'excédent réservé.

        """

        canonical_model = cls.normalize_model(model)

        input_tokens = cls._non_negative_int(

            estimated_input_tokens,

            "estimated_input_tokens",

        )

        output_tokens = cls._non_negative_int(

            max_output_tokens,

            "max_output_tokens",

        )

        if output_tokens <= 0:

            raise TokenBillingError(

                "max_output_tokens doit être supérieur à zéro."

            )

        pricing_context = cls._pricing_context(

            canonical_model,

            input_tokens,

        )

        pricing = MODEL_TOKEN_PRICING_USD_PER_MILLION[

            canonical_model

        ]

        input_rate = cls._decimal(

            pricing[f"{pricing_context}_input"],

            "input_rate",

        )

        cached_input_rate = cls._decimal(

            pricing[f"{pricing_context}_cached_input"],

            "cached_input_rate",

        )

        cache_write_rate = cls._decimal(

            pricing[f"{pricing_context}_cache_write"],

            "cache_write_rate",

        )

        output_rate = cls._decimal(

            pricing[f"{pricing_context}_output"],

            "output_rate",

        )

        conservative_input_rate = max(

            input_rate,

            cached_input_rate,

            cache_write_rate,

        )

        estimated_input_cost_usd = (

            Decimal(input_tokens)

            * conservative_input_rate

            / _ONE_MILLION

        )

        estimated_output_cost_usd = (

            Decimal(output_tokens)

            * output_rate

            / _ONE_MILLION

        )

        reserved_web_calls = (

            MAX_WEB_SEARCH_CALLS_PER_ACTION

            if web_enabled

            else 0

        )

        estimated_web_cost_usd = (

            Decimal(reserved_web_calls)

            * cls._decimal(

                WEB_SEARCH_COST_USD_PER_CALL,

                "WEB_SEARCH_COST_USD_PER_CALL",

            )

        )

        estimated_total_cost_usd = (

            estimated_input_cost_usd

            + estimated_output_cost_usd

            + estimated_web_cost_usd

        )

        estimated_total_cost_xaf = (

            estimated_total_cost_usd

            * cls._decimal(

                ACCOUNTING_USD_XAF,

                "ACCOUNTING_USD_XAF",

            )

        )

        credit_value_xaf = cls._decimal(

            ORIA_CREDIT_VALUE_XAF,

            "ORIA_CREDIT_VALUE_XAF",

        )

        if credit_value_xaf <= 0:

            raise TokenBillingError(

                "ORIA_CREDIT_VALUE_XAF doit être supérieur à zéro."

            )

        credits = int(

            (

                estimated_total_cost_xaf

                / credit_value_xaf

            ).to_integral_value(

                rounding=ROUND_CEILING

            )

        )

        return max(1, credits)

    @classmethod

    def validate_web_search_limit(

        cls,

        web_search_calls: int,

    ) -> None:

        """

        Validation séparée du garde-fou Web.

        Important :

        calculate() facture TOUJOURS tous les appels réellement exécutés.

        Cette méthode ne plafonne jamais un coût après coup.

        """

        calls = cls._non_negative_int(

            web_search_calls,

            "web_search_calls",

        )

        if calls > MAX_WEB_SEARCH_CALLS_PER_ACTION:

            raise TokenBillingError(

                "Le nombre d'appels Web dépasse la limite Oria "

                f"de {MAX_WEB_SEARCH_CALLS_PER_ACTION} par action."

            )

# ============================================================
# FACTURATION MÉDIA
# ============================================================

class MediaBillingError(ValueError):
    """Erreur de données ou de configuration de facturation média."""

class UnsupportedMediaBillingModelError(MediaBillingError):
    """Modèle/fournisseur média non pris en charge."""

class InvalidMediaUsageError(MediaBillingError):
    """Usage média incohérent ou invalide."""

@dataclass(frozen=True)
class ImageBillingResult:
    """Résultat détaillé d'une génération d'image Oria."""

    model: str
    action: str
    quality: str
    pricing_mode: str

    input_tokens: int
    text_input_tokens: int
    ordinary_text_input_tokens: int
    cached_text_input_tokens: int

    image_input_tokens: int
    ordinary_image_input_tokens: int
    cached_image_input_tokens: int

    unclassified_input_tokens: int
    ordinary_unclassified_input_tokens: int
    cached_unclassified_input_tokens: int

    image_output_tokens: int
    count: int

    text_input_cost_usd: Decimal
    text_cached_input_cost_usd: Decimal
    image_input_cost_usd: Decimal
    image_cached_input_cost_usd: Decimal
    unclassified_input_cost_usd: Decimal
    image_output_cost_usd: Decimal

    total_cost_usd: Decimal
    total_cost_xaf: Decimal
    credits: int

    def to_dict(self) -> dict[str, Any]:
        data = asdict(self)

        for field in (
            "text_input_cost_usd",
            "text_cached_input_cost_usd",
            "image_input_cost_usd",
            "image_cached_input_cost_usd",
            "unclassified_input_cost_usd",
            "image_output_cost_usd",
            "total_cost_usd",
            "total_cost_xaf",
        ):
            data[field] = str(data[field])

        return data

@dataclass(frozen=True)
class VideoBillingResult:
    """Résultat générique d'une génération vidéo Oria."""

    provider: str
    model: str
    action: str
    pricing_mode: str

    seconds: int | None
    unit_rate_usd: Decimal | None

    total_cost_usd: Decimal
    total_cost_xaf: Decimal
    credits: int

    def to_dict(self) -> dict[str, Any]:
        data = asdict(self)

        if self.unit_rate_usd is not None:
            data["unit_rate_usd"] = str(self.unit_rate_usd)

        data["total_cost_usd"] = str(self.total_cost_usd)
        data["total_cost_xaf"] = str(self.total_cost_xaf)

        return data

class MediaBillingService:
    """
    Source de vérité du coût des générations média Oria.

    Même philosophie que TokenBillingService :

        coût fournisseur USD
            -> coût XAF
            -> crédits Oria

    Ce service NE :
    - modifie pas le wallet ;
    - n'écrit pas dans Supabase ;
    - ne réserve pas lui-même les crédits ;
    - ne settle pas une réservation.

    ai_route.py orchestre ensuite :
        estimate_*_reservation()
            -> reserve_credits()
            -> génération
            -> calculate_*()
            -> settle_credit_reservation()
    """

    @staticmethod
    def _decimal(value: Any, field_name: str) -> Decimal:
        try:
            result = Decimal(str(value))
        except Exception as error:
            raise MediaBillingError(
                f"Valeur invalide pour '{field_name}' : {value!r}"
            ) from error

        if result < 0:
            raise MediaBillingError(
                f"'{field_name}' ne peut pas être négatif."
            )

        return result

    @staticmethod
    def _non_negative_int(value: Any, field_name: str) -> int:
        try:
            result = int(value or 0)
        except (TypeError, ValueError) as error:
            raise InvalidMediaUsageError(
                f"Valeur invalide pour '{field_name}' : {value!r}"
            ) from error

        if result < 0:
            raise InvalidMediaUsageError(
                f"'{field_name}' ne peut pas être négatif."
            )

        return result

    @classmethod
    def _credits_from_usd(
        cls,
        total_cost_usd: Decimal,
    ) -> tuple[Decimal, int]:
        total_cost_xaf = (
            total_cost_usd
            * cls._decimal(
                ACCOUNTING_USD_XAF,
                "ACCOUNTING_USD_XAF",
            )
        )

        credit_value_xaf = cls._decimal(
            ORIA_CREDIT_VALUE_XAF,
            "ORIA_CREDIT_VALUE_XAF",
        )

        if credit_value_xaf <= 0:
            raise MediaBillingError(
                "ORIA_CREDIT_VALUE_XAF doit être supérieur à zéro."
            )

        credits = int(
            (
                total_cost_xaf / credit_value_xaf
            ).to_integral_value(
                rounding=ROUND_CEILING
            )
        )

        return total_cost_xaf, credits

    @staticmethod
    def _normalize_action(
        action: CreditAction | str,
    ) -> CreditAction:
        if isinstance(action, CreditAction):
            return action

        try:
            return CreditAction(str(action))
        except ValueError as error:
            raise MediaBillingError(
                f"Action média Oria inconnue : {action!r}"
            ) from error

    # --------------------------------------------------------
    # IMAGE — CONFIGURATION
    # --------------------------------------------------------

    @classmethod
    def resolve_image_model(cls, pack_id: str) -> str:
        model = IMAGE_MODEL_BY_PACK.get(str(pack_id))

        if not model:
            raise UnsupportedMediaBillingModelError(
                f"Aucun modèle image configuré pour le pack {pack_id!r}."
            )

        if model not in IMAGE_TOKEN_PRICING_USD_PER_MILLION:
            raise UnsupportedMediaBillingModelError(
                f"Aucune grille tarifaire image configurée pour {model!r}."
            )

        return model

    @classmethod
    def normalize_image_model(cls, model: str) -> str:
        normalized = str(model or "").strip().lower()

        if normalized not in IMAGE_TOKEN_PRICING_USD_PER_MILLION:
            raise UnsupportedMediaBillingModelError(
                f"Modèle image non pris en charge : {model!r}"
            )

        return normalized

    @classmethod
    def resolve_image_quality(
        cls,
        action: CreditAction | str,
    ) -> tuple[CreditAction, str]:
        normalized_action = cls._normalize_action(action)
        quality = IMAGE_ACTION_QUALITY.get(normalized_action)

        if not quality:
            raise MediaBillingError(
                f"L'action {normalized_action.value!r} "
                "n'est pas une action image configurée."
            )

        return normalized_action, str(quality)

    # --------------------------------------------------------
    # IMAGE — USAGE
    # --------------------------------------------------------

    @classmethod
    def _normalize_image_usage(
        cls,
        usage: Mapping[str, Any],
    ) -> dict[str, int]:
        if not isinstance(usage, Mapping):
            raise InvalidMediaUsageError(
                "usage doit être un dictionnaire ou un objet Mapping."
            )

        input_tokens = cls._non_negative_int(
            usage.get("input_tokens", 0),
            "input_tokens",
        )
        text_input_tokens = cls._non_negative_int(
            usage.get("text_input_tokens", 0),
            "text_input_tokens",
        )
        image_input_tokens = cls._non_negative_int(
            usage.get("image_input_tokens", 0),
            "image_input_tokens",
        )

        cached_input_tokens = cls._non_negative_int(
            usage.get("cached_input_tokens", 0),
            "cached_input_tokens",
        )
        cached_text_input_tokens = cls._non_negative_int(
            usage.get("cached_text_input_tokens", 0),
            "cached_text_input_tokens",
        )
        cached_image_input_tokens = cls._non_negative_int(
            usage.get("cached_image_input_tokens", 0),
            "cached_image_input_tokens",
        )

        output_tokens = cls._non_negative_int(
            usage.get("output_tokens", 0),
            "output_tokens",
        )
        image_output_tokens = cls._non_negative_int(
            usage.get("image_output_tokens", 0),
            "image_output_tokens",
        )

        classified_input_tokens = (
            text_input_tokens + image_input_tokens
        )

        if input_tokens == 0 and classified_input_tokens > 0:
            input_tokens = classified_input_tokens

        if classified_input_tokens > input_tokens:
            raise InvalidMediaUsageError(
                "text_input_tokens + image_input_tokens "
                "ne peut pas dépasser input_tokens."
            )

        detailed_cached_tokens = (
            cached_text_input_tokens
            + cached_image_input_tokens
        )

        if cached_input_tokens == 0 and detailed_cached_tokens > 0:
            cached_input_tokens = detailed_cached_tokens

        if detailed_cached_tokens > cached_input_tokens:
            raise InvalidMediaUsageError(
                "Les tokens cache détaillés dépassent cached_input_tokens."
            )

        if cached_text_input_tokens > text_input_tokens:
            raise InvalidMediaUsageError(
                "cached_text_input_tokens ne peut pas dépasser "
                "text_input_tokens."
            )

        if cached_image_input_tokens > image_input_tokens:
            raise InvalidMediaUsageError(
                "cached_image_input_tokens ne peut pas dépasser "
                "image_input_tokens."
            )

        unclassified_input_tokens = (
            input_tokens - classified_input_tokens
        )

        cached_unclassified_input_tokens = (
            cached_input_tokens - detailed_cached_tokens
        )

        if (
            cached_unclassified_input_tokens
            > unclassified_input_tokens
        ):
            raise InvalidMediaUsageError(
                "Les tokens cache non classifiés dépassent "
                "les tokens d'entrée non classifiés."
            )

        ordinary_text_input_tokens = (
            text_input_tokens - cached_text_input_tokens
        )
        ordinary_image_input_tokens = (
            image_input_tokens - cached_image_input_tokens
        )
        ordinary_unclassified_input_tokens = (
            unclassified_input_tokens
            - cached_unclassified_input_tokens
        )

        if image_output_tokens == 0:
            image_output_tokens = output_tokens

        return {
            "input_tokens": input_tokens,
            "text_input_tokens": text_input_tokens,
            "ordinary_text_input_tokens": ordinary_text_input_tokens,
            "cached_text_input_tokens": cached_text_input_tokens,
            "image_input_tokens": image_input_tokens,
            "ordinary_image_input_tokens": ordinary_image_input_tokens,
            "cached_image_input_tokens": cached_image_input_tokens,
            "unclassified_input_tokens": unclassified_input_tokens,
            "ordinary_unclassified_input_tokens": (
                ordinary_unclassified_input_tokens
            ),
            "cached_unclassified_input_tokens": (
                cached_unclassified_input_tokens
            ),
            "image_output_tokens": image_output_tokens,
        }

    @classmethod
    def calculate_image(
        cls,
        *,
        model: str,
        action: CreditAction | str,
        usage: Mapping[str, Any],
        count: int = 1,
        allow_reference_fallback: bool = True,
    ) -> ImageBillingResult:
        """
        Calcule le coût final d'une génération image.

        Priorité :
        1. usage tokenisé réel du fournisseur ;
        2. coût de sortie de référence si aucun usage exploitable
           n'est disponible.
        """
        canonical_model = cls.normalize_image_model(model)
        normalized_action, quality = cls.resolve_image_quality(action)

        count = cls._non_negative_int(count, "count")

        if count <= 0:
            raise MediaBillingError(
                "count doit être supérieur à zéro."
            )

        normalized_usage = cls._normalize_image_usage(usage)
        pricing = IMAGE_TOKEN_PRICING_USD_PER_MILLION[
            canonical_model
        ]

        text_input_rate = cls._decimal(
            pricing["text_input"],
            "text_input_rate",
        )
        text_cached_rate = cls._decimal(
            pricing["text_cached_input"],
            "text_cached_input_rate",
        )
        image_input_rate = cls._decimal(
            pricing["image_input"],
            "image_input_rate",
        )
        image_cached_rate = cls._decimal(
            pricing["image_cached_input"],
            "image_cached_input_rate",
        )
        image_output_rate = cls._decimal(
            pricing["image_output"],
            "image_output_rate",
        )

        ordinary_text = normalized_usage[
            "ordinary_text_input_tokens"
        ]
        cached_text = normalized_usage[
            "cached_text_input_tokens"
        ]
        ordinary_image = normalized_usage[
            "ordinary_image_input_tokens"
        ]
        cached_image = normalized_usage[
            "cached_image_input_tokens"
        ]
        ordinary_unclassified = normalized_usage[
            "ordinary_unclassified_input_tokens"
        ]
        cached_unclassified = normalized_usage[
            "cached_unclassified_input_tokens"
        ]
        image_output = normalized_usage[
            "image_output_tokens"
        ]

        text_input_cost_usd = (
            Decimal(ordinary_text)
            * text_input_rate
            / _ONE_MILLION
        )
        text_cached_input_cost_usd = (
            Decimal(cached_text)
            * text_cached_rate
            / _ONE_MILLION
        )
        image_input_cost_usd = (
            Decimal(ordinary_image)
            * image_input_rate
            / _ONE_MILLION
        )
        image_cached_input_cost_usd = (
            Decimal(cached_image)
            * image_cached_rate
            / _ONE_MILLION
        )

        # Si le provider ne sépare pas les catégories d'entrée,
        # les tokens non classifiés sont facturés au tarif le plus élevé
        # afin de ne jamais sous-facturer l'appel API.
        unclassified_input_cost_usd = (
            Decimal(ordinary_unclassified)
            * max(text_input_rate, image_input_rate)
            / _ONE_MILLION
            + Decimal(cached_unclassified)
            * max(text_cached_rate, image_cached_rate)
            / _ONE_MILLION
        )

        image_output_cost_usd = (
            Decimal(image_output)
            * image_output_rate
            / _ONE_MILLION
        )

        total_cost_usd = (
            text_input_cost_usd
            + text_cached_input_cost_usd
            + image_input_cost_usd
            + image_cached_input_cost_usd
            + unclassified_input_cost_usd
            + image_output_cost_usd
        )

        pricing_mode = "actual_usage"

        if total_cost_usd == 0:
            if not allow_reference_fallback:
                raise InvalidMediaUsageError(
                    "Aucun usage image exploitable n'a été fourni."
                )

            try:
                reference_cost = (
                    IMAGE_REFERENCE_OUTPUT_COST_USD_1024_SQUARE[
                        canonical_model
                    ][quality]
                )
            except KeyError as error:
                raise MediaBillingError(
                    "Aucun coût image de référence configuré pour "
                    f"{canonical_model!r} / {quality!r}."
                ) from error

            image_output_cost_usd = (
                cls._decimal(
                    reference_cost,
                    "image_reference_output_cost_usd",
                )
                * Decimal(count)
            )
            total_cost_usd = image_output_cost_usd
            pricing_mode = "reference_output_fallback"

        total_cost_xaf, credits = cls._credits_from_usd(
            total_cost_usd
        )

        return ImageBillingResult(
            model=canonical_model,
            action=normalized_action.value,
            quality=quality,
            pricing_mode=pricing_mode,
            input_tokens=normalized_usage["input_tokens"],
            text_input_tokens=normalized_usage[
                "text_input_tokens"
            ],
            ordinary_text_input_tokens=ordinary_text,
            cached_text_input_tokens=cached_text,
            image_input_tokens=normalized_usage[
                "image_input_tokens"
            ],
            ordinary_image_input_tokens=ordinary_image,
            cached_image_input_tokens=cached_image,
            unclassified_input_tokens=normalized_usage[
                "unclassified_input_tokens"
            ],
            ordinary_unclassified_input_tokens=(
                ordinary_unclassified
            ),
            cached_unclassified_input_tokens=cached_unclassified,
            image_output_tokens=image_output,
            count=count,
            text_input_cost_usd=text_input_cost_usd,
            text_cached_input_cost_usd=(
                text_cached_input_cost_usd
            ),
            image_input_cost_usd=image_input_cost_usd,
            image_cached_input_cost_usd=(
                image_cached_input_cost_usd
            ),
            unclassified_input_cost_usd=(
                unclassified_input_cost_usd
            ),
            image_output_cost_usd=image_output_cost_usd,
            total_cost_usd=total_cost_usd,
            total_cost_xaf=total_cost_xaf,
            credits=credits,
        )

    @classmethod
    def calculate_image_from_provider_result(
        cls,
        result: Mapping[str, Any],
    ) -> ImageBillingResult:
        """Calcule directement depuis le futur résultat openai_service."""
        if not isinstance(result, Mapping):
            raise MediaBillingError(
                "Le résultat image doit être un objet Mapping."
            )

        model = result.get("model")
        action = result.get("action")
        usage = result.get("usage")

        if not model:
            raise MediaBillingError(
                "Le résultat image ne contient aucun modèle."
            )

        if not action:
            raise MediaBillingError(
                "Le résultat image ne contient aucune action."
            )

        if not isinstance(usage, Mapping):
            usage = {}

        count = result.get("count")

        if count is None:
            images = result.get("images")
            count = len(images) if isinstance(images, list) else 1

        return cls.calculate_image(
            model=str(model),
            action=str(action),
            usage=usage,
            count=count,
        )

    @classmethod
    def estimate_image_reservation(
        cls,
        *,
        pack_id: str,
        action: CreditAction | str,
        count: int = 1,
        estimated_text_input_tokens: int = 2_048,
        estimated_image_input_tokens: int = 0,
    ) -> int:
        """
        Estime les crédits à réserver AVANT l'appel de génération image.

        Aucun markup supplémentaire n'est appliqué.
        """
        model = cls.resolve_image_model(pack_id)
        normalized_action, quality = cls.resolve_image_quality(action)

        count = cls._non_negative_int(count, "count")
        text_tokens = cls._non_negative_int(
            estimated_text_input_tokens,
            "estimated_text_input_tokens",
        )
        image_tokens = cls._non_negative_int(
            estimated_image_input_tokens,
            "estimated_image_input_tokens",
        )

        if count <= 0:
            raise MediaBillingError(
                "count doit être supérieur à zéro."
            )

        pricing = IMAGE_TOKEN_PRICING_USD_PER_MILLION[model]

        estimated_input_cost_usd = (
            Decimal(text_tokens)
            * cls._decimal(
                pricing["text_input"],
                "text_input_rate",
            )
            / _ONE_MILLION
            + Decimal(image_tokens)
            * cls._decimal(
                pricing["image_input"],
                "image_input_rate",
            )
            / _ONE_MILLION
        )

        try:
            reference_output_cost = (
                IMAGE_REFERENCE_OUTPUT_COST_USD_1024_SQUARE[
                    model
                ][quality]
            )
        except KeyError as error:
            raise MediaBillingError(
                "Aucun coût de réservation image configuré pour "
                f"{model!r} / {normalized_action.value!r}."
            ) from error

        estimated_output_cost_usd = (
            cls._decimal(
                reference_output_cost,
                "reference_output_cost_usd",
            )
            * Decimal(count)
        )

        estimated_total_cost_usd = (
            estimated_input_cost_usd
            + estimated_output_cost_usd
        )

        _, credits = cls._credits_from_usd(
            estimated_total_cost_usd
        )

        return max(1, credits)

    # --------------------------------------------------------
    # VIDÉO — FOURNISSEUR AGNOSTIQUE
    # --------------------------------------------------------

    @classmethod
    def resolve_video_backend(
        cls,
        pack_id: str,
    ) -> tuple[str, str]:
        provider = VIDEO_PROVIDER_BY_PACK.get(str(pack_id))
        model = VIDEO_MODEL_BY_PACK.get(str(pack_id))

        if not provider or not model:
            raise UnsupportedMediaBillingModelError(
                "Aucun fournisseur/modèle vidéo actif n'est "
                f"configuré pour le pack {pack_id!r}."
            )

        return str(provider), str(model)

    @classmethod
    def _normalize_video_action(
        cls,
        action: CreditAction | str,
    ) -> CreditAction:
        normalized_action = cls._normalize_action(action)

        if normalized_action not in VIDEO_ACTION_DURATION_SECONDS:
            raise MediaBillingError(
                f"L'action {normalized_action.value!r} "
                "n'est pas une action vidéo configurée."
            )

        return normalized_action

    @classmethod
    def calculate_video(
        cls,
        *,
        provider: str,
        model: str,
        action: CreditAction | str,
        total_cost_usd: Any | None = None,
        seconds: int | None = None,
        rate_usd_per_second: Any | None = None,
    ) -> VideoBillingResult:
        """
        Calcule le coût final d'une vidéo.

        Deux modes :
        - coût total renvoyé directement par le fournisseur ;
        - coût = secondes × tarif par seconde.
        """
        normalized_action = cls._normalize_video_action(action)

        provider_name = str(provider or "").strip()
        model_name = str(model or "").strip()

        if not provider_name:
            raise MediaBillingError(
                "Le fournisseur vidéo est obligatoire."
            )

        if not model_name:
            raise MediaBillingError(
                "Le modèle vidéo est obligatoire."
            )

        configured_seconds = VIDEO_ACTION_DURATION_SECONDS.get(
            normalized_action
        )

        if seconds is None:
            seconds = configured_seconds

        normalized_seconds: int | None = None

        if seconds is not None:
            normalized_seconds = cls._non_negative_int(
                seconds,
                "seconds",
            )

            if normalized_seconds <= 0:
                raise MediaBillingError(
                    "seconds doit être supérieur à zéro."
                )

        unit_rate: Decimal | None = None

        if total_cost_usd is not None:
            final_cost_usd = cls._decimal(
                total_cost_usd,
                "total_cost_usd",
            )
            pricing_mode = "provider_total"
        else:
            if normalized_seconds is None:
                raise MediaBillingError(
                    "La durée vidéo est nécessaire lorsque "
                    "total_cost_usd n'est pas fourni."
                )

            if rate_usd_per_second is None:
                raise MediaBillingError(
                    "rate_usd_per_second est nécessaire lorsque "
                    "total_cost_usd n'est pas fourni."
                )

            unit_rate = cls._decimal(
                rate_usd_per_second,
                "rate_usd_per_second",
            )
            final_cost_usd = (
                Decimal(normalized_seconds)
                * unit_rate
            )
            pricing_mode = "per_second"

        total_cost_xaf, credits = cls._credits_from_usd(
            final_cost_usd
        )

        return VideoBillingResult(
            provider=provider_name,
            model=model_name,
            action=normalized_action.value,
            pricing_mode=pricing_mode,
            seconds=normalized_seconds,
            unit_rate_usd=unit_rate,
            total_cost_usd=final_cost_usd,
            total_cost_xaf=total_cost_xaf,
            credits=credits,
        )

    @classmethod
    def estimate_video_reservation(
        cls,
        *,
        pack_id: str,
        action: CreditAction | str,
        estimated_total_cost_usd: Any | None = None,
        seconds: int | None = None,
        rate_usd_per_second: Any | None = None,
    ) -> int:
        """
        Estime les crédits à réserver avant une génération vidéo.

        Tant que credit_costs.py n'a pas de backend vidéo actif,
        cette méthode refuse la réservation au lieu d'inventer un prix.
        """
        provider, model = cls.resolve_video_backend(pack_id)

        result = cls.calculate_video(
            provider=provider,
            model=model,
            action=action,
            total_cost_usd=estimated_total_cost_usd,
            seconds=seconds,
            rate_usd_per_second=rate_usd_per_second,
        )

        return max(1, result.credits)
