from enum import Enum

class ComplementaryCreditPack(str, Enum):

    CREDIT_1000 = "credit_1000"

    CREDIT_2000 = "credit_2000"

    CREDIT_4000 = "credit_4000"

    CREDIT_10000 = "credit_10000"

class CreditAction(str, Enum):

    # ========================================================

    # CHAT — LUNA

    # ========================================================

    CHAT_LUNA = "chat_luna"

    CHAT_LUNA_WEB = "chat_luna_web"

    # ========================================================

    # CHAT — GPT-5

    # ========================================================

    CHAT_GPT5 = "chat_gpt5"

    CHAT_GPT5_WEB = "chat_gpt5_web"

    # ========================================================

    # CHAT — GPT-5.6 TERRA

    # ========================================================

    CHAT_TERRA = "chat_terra"

    CHAT_TERRA_WEB = "chat_terra_web"

    # ========================================================

    # CHAT — GPT-6 SOL

    # ========================================================

    CHAT_SOL = "chat_sol"

    CHAT_SOL_WEB = "chat_sol_web"

    # ========================================================

    # CHAT — GPT-6 ASTRA

    # ========================================================

    CHAT_ASTRA = "chat_astra"

    CHAT_ASTRA_WEB = "chat_astra_web"

    # ========================================================

    # IMAGES — PACK LÉGER

    # ========================================================

    IMAGE_480 = "image_480"

    IMAGE_720 = "image_720"

    # ========================================================

    # IMAGES — PACK PRO

    # ========================================================

    IMAGE_PRO = "image_pro"

    IMAGE_PRO_STANDARD = "image_pro_standard"

    IMAGE_PRO_ULTRA = "image_pro_ultra"

    # ========================================================

    # IMAGES — PACK BUSINESS

    # ========================================================

    IMAGE_BUSINESS = "image_business"

    IMAGE_BUSINESS_HD = "image_business_hd"

    IMAGE_BUSINESS_ULTRA = "image_business_ultra"

    # ========================================================

    # VIDÉOS — PACK LÉGER

    # ========================================================

    VIDEO_4S = "video_4s"

    VIDEO_8S = "video_8s"

    # ========================================================

    # VIDÉO — PACK INTERMÉDIAIRE

    # ========================================================

    VIDEO_LITE = "video_lite"

    # ========================================================

    # VIDÉO — PACK PRO

    # ========================================================

    VIDEO_PRO_FAST = "video_pro_fast"

    VIDEO_PRO_STANDARD = "video_pro_standard"

    VIDEO_PRO_EXTENSION = "video_pro_extension"

    # ========================================================

    # VIDÉO — PACK BUSINESS

    # ========================================================

    VIDEO_BUSINESS_FAST = "video_business_fast"

    VIDEO_BUSINESS_STANDARD = "video_business_standard"

    VIDEO_BUSINESS_LONG = "video_business_long"

    # ========================================================

    # AUDIO — TRANSCRIPTION DES NOTES VOCALES

    # ========================================================

    # L'audio est facture selon sa duree reelle dans audio_service.py.
    # Le tarif par minute est configure sur le serveur avec la variable
    # ORIA_AUDIO_CREDITS_PER_MINUTE (entier positif).
    # Ne pas ajouter de forfait de transcription par action : la duree varie.

    AUDIO_TRANSCRIPTION = "audio_transcription"

    # ORIA COURS : DEUX PRESTATIONS DISTINCTES.
    # Ne pas reutiliser AUDIO_TRANSCRIPTION des notes vocales classiques.
    # La transcription d'un cours est estimee sur sa duree TOTALE ;
    # la redaction pedagogique est mesuree en tokens OpenAI par le
    # futur raccordement de TokenBillingService.
    COURSE_TRANSCRIPTION = "course_transcription"
    COURSE_DOCUMENT_GENERATION = "course_document_generation"

# ========================================================

# COÛTS DE RÉFÉRENCE

# ============================================================

# ============================================================

# FACTURATION DYNAMIQUE DU CHAT — RÉFÉRENCES ÉCONOMIQUES

# ============================================================

#
# Calcul economique : usage OpenAI -> USD -> XAF -> credits ORIA.
# Les prix ci-dessous sont des TARIFS UNITAIRES, jamais des forfaits fixes
# par appel. Les usages doivent etre mesures et factures par les services.

ORIA_CREDIT_VALUE_XAF = 0.10

ACCOUNTING_USD_XAF = 600.0

PACK_API_SAFETY_RESERVE_RATIO = 0.20

MAX_CHAT_INPUT_TOKENS = 250_000

MAX_CHAT_OUTPUT_TOKENS = 32_000

# ORIA COURS UNIQUEMENT : plafond de génération PAR SECTION pédagogique.
# Le devis CourseService utilise exactement cette même borne que
# OpenAIService.compose_course_section. Inclut les tokens de raisonnement.
# Ne change pas la limite de 32 000 tokens du Chat général.
COURSE_MAX_OUTPUT_TOKENS = 12_288

LONG_CONTEXT_THRESHOLD_TOKENS = 272_000

MAX_WEB_SEARCH_CALLS_PER_ACTION = 3

# 10 USD / 1 000 appels = 0,01 USD par recherche Web.

WEB_SEARCH_COST_USD_PER_CALL = 0.01

# Tarifs Standard OpenAI en USD par million de tokens.

MODEL_TOKEN_PRICING_USD_PER_MILLION = {
    "luna": {
        "short_input": 0.10, "short_cached_input": 0.01,
        "short_cache_write": 0.125, "short_output": 0.50,
        "long_input": 0.20, "long_cached_input": 0.02,
        "long_cache_write": 0.25, "long_output": 0.75,
    },
    "gpt-5": {
        "short_input": 1.25, "short_cached_input": 0.125,
        "short_cache_write": 1.25, "short_output": 10.00,
        "long_input": 1.25, "long_cached_input": 0.125,
        "long_cache_write": 1.25, "long_output": 10.00,
    },
    "gpt-5.6-terra": {
        "short_input": 2.00, "short_cached_input": 0.20,
        "short_cache_write": 2.50, "short_output": 12.00,
        "long_input": 4.00, "long_cached_input": 0.40,
        "long_cache_write": 5.00, "long_output": 18.00,
    },
    "gpt-6-sol": {
        "short_input": 2.00, "short_cached_input": 0.20,
        "short_cache_write": 2.50, "short_output": 10.00,
        "long_input": 4.00, "long_cached_input": 0.40,
        "long_cache_write": 5.00, "long_output": 15.00,
    },
    "gpt-6-astra": {
        "short_input": 10.00, "short_cached_input": 1.00,
        "short_cache_write": 12.50, "short_output": 50.00,
        "long_input": 20.00, "long_cached_input": 2.00,
        "long_cache_write": 25.00, "long_output": 75.00,
    },
}

# Soldes cibles à activer UNIQUEMENT avec la facturation dynamique.

TARGET_PACK_CREDITS = {

    "light": 15_000,

    "intermediate": 27_000,

    "pro": 36_000,

    "business": 120_000,

}

# ============================================================

# FACTURATION DYNAMIQUE DES MÉDIAS — RÉFÉRENCES ÉCONOMIQUES

# ============================================================

#

# Principe cible :

#   estimation -> reserve_credits()

#   -> génération média

#   -> calcul du coût réel

#   -> settle_credit_reservation()

#

# En cas d'échec avant génération facturable :

#   release_credit_reservation()

#

# 1 crédit Oria conserve la même valeur économique que pour le Chat.

# Les tarifs ci-dessous sont des références API en USD ; la conversion

# en crédits est effectuée par le service de facturation correspondant.

#

MEDIA_PRICING_REFERENCE_DATE = "2026-09-25"

# ------------------------------------------------------------

# IMAGES — MODÈLE PAR PACK

# ------------------------------------------------------------

#

# Mapping demandé pour la phase actuelle.

# IMPORTANT :

# - gpt-image-1-mini et gpt-image-1.5 sont annoncés en fin de vie

#   API au 2026-12-01.

# - le mapping est volontairement centralisé pour pouvoir remplacer

#   ces modèles sans modifier les routes ni la logique de facturation.

#

IMAGE_MODEL_BY_PACK: dict[str, str] = {
    "light_pack": "gpt-image-2",
    "intermediate_pack": "gpt-image-2",
    "pro_pack": "gpt-image-2.5-flare",
    "business_pack": "gpt-image-2.5-sunburst",
}

IMAGE_MODEL_SHUTDOWN_DATE: dict[str, str | None] = {
    "gpt-image-2": None,
    "gpt-image-2.5-flare": None,
    "gpt-image-2.5-sunburst": None,
}

IMAGE_TOKEN_PRICING_USD_PER_MILLION = {
    "gpt-image-2": {
        "text_input": 2.50, "text_cached_input": 0.625,
        "image_input": 4.00, "image_cached_input": 1.00,
        "image_output": 15.00,
    },
    "gpt-image-2.5-flare": {
        "text_input": 5.00, "text_cached_input": 1.25,
        "image_input": 8.00, "image_cached_input": 2.00,
        "image_output": 30.00,
    },
    "gpt-image-2.5-sunburst": {
        "text_input": 5.00, "text_cached_input": 1.25,
        "image_input": 8.00, "image_cached_input": 2.00,
        "image_output": 30.00,
    },
}

# Qualité logique associée aux actions Oria.

# La taille/résolution API exacte restera définie dans openai_service.py :

# les noms historiques IMAGE_480 / IMAGE_720 sont conservés pour

# compatibilité avec le frontend et les transactions existantes.

IMAGE_ACTION_QUALITY: dict[CreditAction, str] = {
    CreditAction.IMAGE_480: "low",
    CreditAction.IMAGE_720: "medium",
    CreditAction.IMAGE_PRO: "low",
    CreditAction.IMAGE_PRO_STANDARD: "high",
    CreditAction.IMAGE_PRO_ULTRA: "xhigh",
    CreditAction.IMAGE_BUSINESS: "medium",
    CreditAction.IMAGE_BUSINESS_HD: "xhigh",
    CreditAction.IMAGE_BUSINESS_ULTRA: "max",
}

# Références de coût de sortie pour une image 1024x1024.

# Elles servent uniquement d'aide à l'estimation/réservation.

# Le settlement devra privilégier l'usage réel retourné par l'API.

IMAGE_REFERENCE_OUTPUT_COST_USD_1024_SQUARE = {
    "gpt-image-2": {
        "low": 0.006, "medium": 0.053, "high": 0.211,
    },
    # Réserves prudentes uniquement : le settlement 2.5 utilise l'usage réel.
    "gpt-image-2.5-flare": {
        "low": 0.01, "medium": 0.08, "high": 0.30,
        "xhigh": 0.60, "max": 1.20,
    },
    "gpt-image-2.5-sunburst": {
        "low": 0.01, "medium": 0.08, "high": 0.30,
        "xhigh": 0.60, "max": 1.20,
    },
}

# ------------------------------------------------------------

# VIDÉO — OPENAI / SORA 2
# ------------------------------------------------------------
#
# Les routes historiques /ai/video utilisent encore OpenAI.
# Le nouveau Mini-Studio /ai/google-media/video utilise Google.
# Sora 2 / Sora 2 Pro sont classés Legacy par OpenAI : mapping centralisé
# afin de permettre une migration rapide dès qu'un successeur est publié.
#
# Facturation finale : durée x tarif USD/seconde -> XAF -> crédits -> settle.

VIDEO_PROVIDER_BY_PACK: dict[str, str | None] = {
    "light_pack": "openai",
    "intermediate_pack": "openai",
    "pro_pack": "openai",
    "business_pack": "openai",
}

VIDEO_MODEL_BY_PACK: dict[str, str | None] = {
    "light_pack": "sora-2",
    "intermediate_pack": "sora-2",
    "pro_pack": "sora-2",
    "business_pack": "sora-2-pro",
}

VIDEO_PRICING_USD_PER_SECOND = {
    "sora-2": {"720p": 0.10},
    "sora-2-pro": {
        "720p": 0.30,
        "1024p": 0.50,
        "1080p": 0.70,
    },
}

LEGACY_SORA_MODEL_BY_PACK = VIDEO_MODEL_BY_PACK
LEGACY_SORA_PRICING_USD_PER_SECOND = VIDEO_PRICING_USD_PER_SECOND

VIDEO_ACTION_DURATION_SECONDS: dict[CreditAction, int | None] = {
    CreditAction.VIDEO_4S: 4,
    CreditAction.VIDEO_8S: 8,
    CreditAction.VIDEO_LITE: 4,
    CreditAction.VIDEO_PRO_FAST: 4,
    CreditAction.VIDEO_PRO_STANDARD: 8,
    CreditAction.VIDEO_PRO_EXTENSION: 4,
    CreditAction.VIDEO_BUSINESS_FAST: 4,
    CreditAction.VIDEO_BUSINESS_STANDARD: 8,
    CreditAction.VIDEO_BUSINESS_LONG: 12,
}


# ============================================================
# FACTURATION DES ACTIONS IA : UNIQUEMENT DYNAMIQUE
# ============================================================
# Aucun montant fixe en credits n'est attribue ici a une action image,
# video, document, audio ou Chat.
# OpenAI : la consommation reelle de tokens et les prix unitaires du modele
# sont traites par TokenBillingService / MediaBillingService.
# Google : les devis et le reglement utilisent la grille Google ci-dessous
# et les informations d'usage renvoyees par le fournisseur.
# Les anciennes actions CreditAction restent des identifiants d'API,
# d'historique et d'autorisations, PAS des prix.
# Ne pas reintroduire de bareme forfaitaire en credits par action.
# Le plafond API par pack est COMMUN aux deux fournisseurs. Son application
# effective necessite un controle atomique du budget dans Supabase.

MAX_MULTIMODAL_ATTACHMENTS = 3

# ============================================================

# PACK LÉGER

# ============================================================

# ------------------------------------------------------------

# SOLDES ACTIFS — FACTURATION DYNAMIQUE DU CHAT

# ------------------------------------------------------------

# Cibles actives :

#   Léger         15_000

#   Intermédiaire 27_000

#   Pro           36_000
#   Business     120_000

#

# Plafonds API communs OpenAI + Google (par pack) :

#   2_500 / 4_500 / 6_000 / 20_000 XAF

#

LIGHT_PACK_CREDITS = 15_000

LIGHT_PACK_PRICE_XAF = 4_000

LIGHT_PACK_DURATION_DAYS = 35

LIGHT_PACK_API_BUDGET_XAF = 2_500

# ============================================================

# PACK INTERMÉDIAIRE

# ============================================================

INTERMEDIATE_PACK_CREDITS = 27_000

INTERMEDIATE_PACK_PRICE_XAF = 8_000

INTERMEDIATE_PACK_DURATION_DAYS = 35

INTERMEDIATE_PACK_API_BUDGET_XAF = 4_500

# ============================================================

# PACK PRO

# ============================================================

PRO_PACK_CREDITS = 36_000

PRO_PACK_PRICE_XAF = 12_000

PRO_PACK_DURATION_DAYS = 35

PRO_PACK_API_BUDGET_XAF = 6_000

# ============================================================

# PACK BUSINESS

# ============================================================

BUSINESS_PACK_CREDITS = 120_000

BUSINESS_PACK_PRICE_XAF = 45_000

BUSINESS_PACK_DURATION_DAYS = 35

BUSINESS_PACK_API_BUDGET_XAF = 20_000

# ============================================================

# PACKS DE CRÉDITS COMPLÉMENTAIRES

# ============================================================

COMPLEMENTARY_CREDIT_PACKS = {

    ComplementaryCreditPack.CREDIT_1000: {

        "credits": 1_000,

        "price_xaf": 563,

    },

    ComplementaryCreditPack.CREDIT_2000: {

        "credits": 2_000,

        "price_xaf": 1_000,

    },

    ComplementaryCreditPack.CREDIT_4000: {

        "credits": 4_000,

        "price_xaf": 2_000,

    },

    ComplementaryCreditPack.CREDIT_10000: {

        "credits": 10_000,

        "price_xaf": 5_000,

    },

}


# ============================================================
# ORIA COURS — CONFIGURATION ET ESTIMATION ECONOMIQUE
# ============================================================
# Ces valeurs concernent UNIQUEMENT le mode d'enregistrement de cours.
# Elles ne modifient pas les actions, prix, quotas ou durees des 4 packs,
# ni la facturation des notes vocales AUDIO_TRANSCRIPTION.
#
# Le fonctionnement cible est :
#   1. Enregistrement local, jusqu'a quatre heures ;
#   2. Upload des fragments puis bouton « Envoyer » ;
#   3. Controle du manifeste COMPLET et estimation des credits ;
#   4. Reservation audio, transcription, reglement et liberation du surplus ;
#   5. Reservation de la redaction Luna, puis appels pedagogiques ;
#   6. Reglement de la redaction, export par ArtifactService et sauvegarde ;
#      reprise/reconciliation sans double debit (orchestration dans CourseService).
#
# IMPORTANT : le present module ne reserve, ne debite, ni ne rembourse
# aucun credit. Le prix de transcription ci-dessous est une estimation
# fournisseur, PAS un tarif commercial final. Le prix de redaction depend
# des tokens et doit venir du TokenBillingService (pas d'un forfait fictif).

from dataclasses import dataclass
from decimal import Decimal, InvalidOperation, ROUND_CEILING

COURSE_MAX_DURATION_MS = 4 * 60 * 60 * 1000
COURSE_MAX_SEGMENT_DURATION_SECONDS = 5 * 60
COURSE_MAX_SEGMENTS = 120
COURSE_MAX_SEGMENT_BYTES = 20 * 1024 * 1024
COURSE_MAX_TOTAL_BYTES = 512 * 1024 * 1024
COURSE_DEFAULT_DOCUMENT_FORMAT = "pdf"
COURSE_DOCUMENT_FORMATS = frozenset({"pdf", "docx"})

# Aligne sur audio_service.py : CourseAudioPolicy.MAX_*.
# Le backend doit maintenir les deux definitions concordantes.
# Le choix du format n'applique aucun surcout arbitraire.

# Prix de REFERENCE publies par OpenAI (USD/minute, couts estimes).
# Date de verification : 21/10/2026.
# Source : https://developers.openai.com/api/docs/pricing
# Une estimation de facturation ne doit jamais etre traitee comme
# mesure finale si la facture/usage effectif differe.
COURSE_TRANSCRIPTION_REFERENCE_DATE = "2026-10-21"
COURSE_TRANSCRIPTION_USD_PER_MINUTE = {
    "gpt-4o-mini-transcribe": Decimal("0.003"),
    "gpt-4o-transcribe": Decimal("0.006"),
    "gpt-transcribe": Decimal("0.0045"),
}

# Choix conservateur pour commencer : le modele deja utilise par
# app.services.audio_service.AudioService. Le futur CourseService peut
# passer a gpt-transcribe apres validation de l'integration OpenAI.
COURSE_TRANSCRIPTION_DEFAULT_MODEL = "gpt-4o-mini-transcribe"

# La redaction pedagogique utilise le systeme de cout dynamique du Chat :
#   usage OpenAI -> cout USD -> cout XAF -> credits ORIA.
# Le redacteur pedagogique ORIA Cours est TOUJOURS Luna, pour les quatre
# packs actifs. Cette exception est STRICTEMENT limitee au service Cours :
# les droits du Chat restent controles separement par PACK_ALLOWED_MODELS.
# Le serveur recontrole le pack reel depuis le wallet avant de reserver.
# Ne jamais importer config/openai.py ici : son import exige une cle API.
COURSE_DOCUMENT_BILLING_ACTION = CreditAction.COURSE_DOCUMENT_GENERATION

# Le modele de redaction pedagogique est fixe cote serveur.
# Luna n'est pas pour autant debloque dans le Chat general du pack.
COURSE_DEFAULT_WRITING_MODEL = "luna"
COURSE_WRITING_MODEL_IDS: tuple[str, ...] = (COURSE_DEFAULT_WRITING_MODEL,)
COURSE_WRITING_MODELS_BY_PACK: dict[str, tuple[str, ...]] = {
    "light_pack": (COURSE_DEFAULT_WRITING_MODEL,),
    "intermediate_pack": (COURSE_DEFAULT_WRITING_MODEL,),
    "pro_pack": (COURSE_DEFAULT_WRITING_MODEL,),
    "business_pack": (COURSE_DEFAULT_WRITING_MODEL,),
}


def available_course_writing_models(pack_id: str) -> tuple[str, ...]:
    """Modeles affichables sur l'interface Cours selon le pack.

    Une valeur de pack inconnue n'accorde aucun modele : la route doit
    ensuite rejeter la tentative de generation, sans contournement.
    """
    if not isinstance(pack_id, str):
        return ()
    return COURSE_WRITING_MODELS_BY_PACK.get(pack_id.strip(), ())


def validate_course_writing_model(pack_id: str, model: str | None = None) -> str:
    """Fixe Luna uniquement pour ORIA Cours, sans debloquer le Chat.

    None ou une chaine vide indiquent que l'interface laisse le serveur
    choisir le modele par defaut. Un autre modele explicitement transmis
    est rejete et ne declenche aucune reservation.

    La couche metier doit fournir le pack REEL issu du wallet, jamais un
    pack declare par le client. Le choix valide reste fige avec le devis.
    """
    allowed = available_course_writing_models(pack_id)
    if not allowed:
        raise ValueError("Pack non autorise pour ORIA Cours.")
    if model is not None and not isinstance(model, str):
        raise ValueError("Modele de redaction ORIA invalide.")
    chosen = (model.strip().lower() if model is not None else "") or COURSE_DEFAULT_WRITING_MODEL
    if chosen not in COURSE_WRITING_MODEL_IDS or chosen not in allowed:
        raise ValueError("Seul GPT-6 Luna est disponible pour ORIA Cours.")
    if chosen not in MODEL_TOKEN_PRICING_USD_PER_MILLION:
        raise ValueError("Le modele de redaction ne possede aucun tarif configure.")
    return chosen


@dataclass(frozen=True)
class CourseTranscriptionEstimate:
    """Devis indicatif pour la seule transcription du cours.

    estimated_credits ne comprend PAS la redaction pedagogique, ni
    stockage/hebergement ni eventuelle facturation additionnelle.
    reservation_credits contient une marge de securite provisoire ;
    il ne constitue PAS le debit final.
    """

    model: str
    duration_ms: int
    billable_minutes: int
    estimated_provider_usd: Decimal
    estimated_xaf: Decimal
    estimated_credits: int
    reservation_credits: int


def normalize_course_document_format(value: str | None = None) -> str:
    """PDF par defaut ; DOCX uniquement sur choix explicite valide."""
    if value is None:
        return COURSE_DEFAULT_DOCUMENT_FORMAT
    if not isinstance(value, str):
        raise ValueError("Le format du cours doit etre PDF ou DOCX.")
    normalized = value.strip().lower()
    if normalized not in COURSE_DOCUMENT_FORMATS:
        raise ValueError("Format de cours invalide : PDF et DOCX uniquement.")
    return normalized


def _course_positive_decimal(value: object, name: str) -> Decimal:
    try:
        number = Decimal(str(value))
    except (InvalidOperation, ValueError, TypeError) as error:
        raise ValueError(f"Valeur economique invalide : {name}.") from error
    if not number.is_finite() or number <= 0:
        raise ValueError(f"La valeur {name} doit etre finie et positive.")
    return number


def _course_nonnegative_decimal(value: object, name: str) -> Decimal:
    try:
        number = Decimal(str(value))
    except (InvalidOperation, ValueError, TypeError) as error:
        raise ValueError(f"Valeur economique invalide : {name}.") from error
    if not number.is_finite() or number < 0:
        raise ValueError(f"La valeur {name} doit etre finie et non negative.")
    return number


def estimate_course_transcription_credits(
    duration_ms: int,
    *,
    model: str = COURSE_TRANSCRIPTION_DEFAULT_MODEL,
    usd_xaf: object | None = None,
    credit_value_xaf: object | None = None,
    reserve_ratio: object | None = None,
) -> CourseTranscriptionEstimate:
    """Estime les credits de transcription pour une session ENTIERE.

    Arrondit la duree une seule fois, pas pour chaque fragment.
    Ce devis seul ne suffit PAS a autoriser un traitement : CourseService
    doit controler le wallet/pack actif, obtenir l'accord puis reserver
    la transcription avant l'appel audio. La redaction sera reservee
    ulterieurement, apres reglement de la transcription.

    Ne jamais utiliser cette fonction comme debit definitif sans verifier
    les regles fournisseur et les consommations effectivement relevees.
    """
    if type(duration_ms) is not int or not 400 <= duration_ms <= COURSE_MAX_DURATION_MS:
        raise ValueError("La duree du cours doit etre comprise entre 0,4 seconde et 4 heures.")
    if model not in COURSE_TRANSCRIPTION_USD_PER_MINUTE:
        raise ValueError("Modele de transcription de cours non tarife.")

    fx = _course_positive_decimal(
        ACCOUNTING_USD_XAF if usd_xaf is None else usd_xaf,
        "usd_xaf",
    )
    value = _course_positive_decimal(
        ORIA_CREDIT_VALUE_XAF if credit_value_xaf is None else credit_value_xaf,
        "credit_value_xaf",
    )
    margin = _course_nonnegative_decimal(
        PACK_API_SAFETY_RESERVE_RATIO if reserve_ratio is None else reserve_ratio,
        "reserve_ratio",
    )
    # Evite les marges aberrantes dues a une mauvaise configuration.
    if margin > Decimal("1"):
        raise ValueError("reserve_ratio ne peut pas depasser 100 %.")

    minutes = (duration_ms + 60_000 - 1) // 60_000
    provider_usd = COURSE_TRANSCRIPTION_USD_PER_MINUTE[model] * minutes
    estimated_xaf = provider_usd * fx
    estimated_credits = max(
        1,
        int((estimated_xaf / value).to_integral_value(rounding=ROUND_CEILING)),
    )
    reservation_credits = max(
        estimated_credits,
        int(
            ((estimated_xaf / value) * (Decimal("1") + margin)).to_integral_value(
                rounding=ROUND_CEILING
            )
        ),
    )
    return CourseTranscriptionEstimate(
        model=model,
        duration_ms=duration_ms,
        billable_minutes=minutes,
        estimated_provider_usd=provider_usd,
        estimated_xaf=estimated_xaf,
        estimated_credits=estimated_credits,
        reservation_credits=reservation_credits,
    )


def combine_course_reservation_credits(
    transcription: CourseTranscriptionEstimate,
    document_reservation_credits: int,
) -> int:
    """Somme indicative des plafonds de deux phases, NON simultanees.

    Conserve le contrat numerique historique de calcul du devis ; ce total
    ne doit PAS etre exige comme solde disponible lors de la confirmation.
    CourseService reserve d'abord l'audio, le regle, puis reserve la
    redaction Luna dans la limite des credits disponibles.
    """
    if not isinstance(transcription, CourseTranscriptionEstimate):
        raise TypeError("Une estimation audio de cours est obligatoire.")
    if type(document_reservation_credits) is not int or document_reservation_credits <= 0:
        raise ValueError("Une provision de redaction strictement positive est requise.")
    return transcription.reservation_credits + document_reservation_credits


@dataclass(frozen=True)
class CourseCreditQuote:
    """Devis indicatif prepare cote serveur pour le redacteur Luna.

    total_reservation_credits conserve pour compatibilite la SOMME des
    plafonds des deux phases ; il ne decrit pas leur blocage simultane.
    Aucun debit n'est declenche par la construction du devis.
    """
    pack_id: str
    writing_model: str
    transcription_model: str
    document_format: str
    duration_ms: int
    transcription_estimated_credits: int
    transcription_reservation_credits: int
    document_estimated_credits: int
    document_reservation_credits: int
    total_estimated_credits: int
    total_reservation_credits: int

    @property
    def maximum_simultaneous_reservation_credits(self) -> int:
        """Pic theorique en deux phases NON simultanees."""
        return max(self.transcription_reservation_credits,
                   self.document_reservation_credits)


def build_course_credit_quote(
    *,
    pack_id: str,
    writing_model: str,
    duration_ms: int,
    document_estimated_credits: int,
    document_reservation_credits: int,
    document_format: str | None = None,
) -> CourseCreditQuote:
    """Assemble le devis audio + redaction Luna, sans prix fictif.

    L'appelant (backend uniquement) doit :
    - lire et verifier le pack reel de l'utilisateur depuis son wallet ;
    - estimer les tokens Luna avec TokenBillingService ;
    - obtenir le consentement avant tout appel OpenAI facturable ;
    - reserver / regler l'audio, puis reserver / regler la redaction ;
    - ne pas reexecuter les appels deja regles ;
    - ne jamais utiliser comme argent bloque le total de deux phases.
    Les prix ne doivent PAS provenir de l'interface utilisateur.
    """
    chosen = validate_course_writing_model(pack_id, writing_model)
    fmt = normalize_course_document_format(document_format)
    for label, value in (
        ("document_estimated_credits", document_estimated_credits),
        ("document_reservation_credits", document_reservation_credits),
    ):
        if type(value) is not int or value <= 0:
            raise ValueError(f"{label} doit etre un entier positif calcule cote serveur.")
    if document_reservation_credits < document_estimated_credits:
        raise ValueError("La provision document doit couvrir son estimation.")

    transcription = estimate_course_transcription_credits(duration_ms)
    reserved = combine_course_reservation_credits(
        transcription, document_reservation_credits,
    )
    return CourseCreditQuote(
        pack_id=pack_id.strip(),
        writing_model=chosen,
        transcription_model=transcription.model,
        document_format=fmt,
        duration_ms=transcription.duration_ms,
        transcription_estimated_credits=transcription.estimated_credits,
        transcription_reservation_credits=transcription.reservation_credits,
        document_estimated_credits=document_estimated_credits,
        document_reservation_credits=document_reservation_credits,
        total_estimated_credits=transcription.estimated_credits + document_estimated_credits,
        total_reservation_credits=reserved,
    )

# ============================================================
# GOOGLE — CONFIGURATION MEDIA ET TARIFS DYNAMIQUES
# ============================================================
# Ce fichier est la source des droits commerciaux ORIA et du catalogue
# de prix Google. Il n'appelle aucune API et n'effectue aucun debit.
# Les services et routes historiques OpenAI restent inchanges :
# IMAGE_MODEL_BY_PACK / VIDEO_PROVIDER_BY_PACK pointent encore vers OpenAI.
# Les routes Google s'activent uniquement lorsque les controles backend
# et la verification du stockage / de la facturation sont termines.
# Source des tarifs STANDARD (non Batch) :
# https://ai.google.dev/gemini-api/docs/pricing
# Identifiants officiels : https://ai.google.dev/gemini-api/docs/models
# Les tarifs sont en USD; les devis doivent aussi prendre en compte
# les tokens en entree, les sorties texte/reflexion et le montage.

GOOGLE_MEDIA_PRICING_REFERENCE_DATE = "2026-10-25"

# Prix de SORTIE pour UNE image, selon le modele et la resolution.
# Les options non repertoriees ne sont pas tarifees et sont donc refusees.
GOOGLE_IMAGE_OUTPUT_USD_BY_MODEL: dict[str, dict[str, str]] = {
    "gemini-3.1-flash-lite-image": {"1K": "0.0336"},
    "gemini-nano-banana-2.1": {
        "1K": "0.0336", "2K": "0.0504", "4K": "0.113"
    },
    "gemini-3-pro-image": {
        "1K": "0.134", "2K": "0.134", "4K": "0.24"
    },
}
GOOGLE_IMAGE_INPUT_USD_PER_MILLION: dict[str, str] = {
    "gemini-3.1-flash-lite-image": "0.25",
    "gemini-nano-banana-2.1": "1.50",
    "gemini-3-pro-image": "2.00",
}
GOOGLE_IMAGE_TEXT_OUTPUT_USD_PER_MILLION: dict[str, str] = {
    "gemini-3.1-flash-lite-image": "1.50",
    "gemini-nano-banana-2.1": "7.50",
    "gemini-3-pro-image": "12.00",
}

GOOGLE_VIDEO_MODEL = "gemini-omni-1.1-flash"
GOOGLE_VIDEO_PRICING_STANDARD: dict[str, str | int] = {
    "input_usd_per_million": "1.50",
    "video_output_usd_per_million": "17.50",
    "text_output_usd_per_million": "9.00",
    "video_output_tokens_per_second_720p": 5792,
}
# Le tarif de 720p est documente. Un cout 1080p/4K ne peut pas
# etre extrapole a partir de ce taux pour autoriser une transaction.
GOOGLE_VIDEO_BILLABLE_RESOLUTIONS = ("720p",)
GOOGLE_VIDEO_PROVIDER_MIN_CLIP_SECONDS = 3
GOOGLE_VIDEO_PROVIDER_MAX_CLIP_SECONDS = 10

# ------------------------------------------------------------
# DROITS COMMERCIAUX DES QUATRE PACKS (35 jours inchanges)
# ------------------------------------------------------------
# Identifiants de packs provenant du wallet, jamais de la requete client.
# Image : "image_edit" couvre la retouche d'une photo importee;
# "multi_reference" la creation/retouche avec plusieurs references;
# "advanced_edit" indique les outils plus complets du Mini-studio.
# Ces modes sont des droits ORIA, pas des noms de taches Google.
GOOGLE_IMAGE_MODELS_ALLOWED_BY_PACK: dict[str, tuple[str, ...]] = {
    "light_pack": ("gemini-3.1-flash-lite-image",),
    "intermediate_pack": (
        "gemini-3.1-flash-lite-image", "gemini-nano-banana-2.1"
    ),
    "pro_pack": (
        "gemini-3.1-flash-lite-image", "gemini-nano-banana-2.1",
        "gemini-3-pro-image",
    ),
    "business_pack": (
        "gemini-3.1-flash-lite-image", "gemini-nano-banana-2.1",
        "gemini-3-pro-image",
    ),
}
GOOGLE_IMAGE_RESOLUTIONS_ALLOWED_BY_PACK: dict[str, tuple[str, ...]] = {
    "light_pack": ("1K",),
    "intermediate_pack": ("1K", "2K"),
    "pro_pack": ("1K", "2K", "4K"),
    "business_pack": ("1K", "2K", "4K"),
}
GOOGLE_IMAGE_MAX_REFERENCE_IMAGES_BY_PACK: dict[str, int] = {
    "light_pack": 1,
    "intermediate_pack": 3,
    "pro_pack": 6,
    "business_pack": 10,
}
# Plafond d'usage prudent PAR MODELE (restriction ORIA, pas limite API) :
# Lite reste reserve a l'edition avec une reference; pour les montages
# complexes, le Mini-studio devra choisir Nano Banana 2.1 ou Pro.
GOOGLE_IMAGE_MAX_REFERENCE_IMAGES_BY_MODEL: dict[str, int] = {
    "gemini-3.1-flash-lite-image": 1,
    "gemini-nano-banana-2.1": 14,
    "gemini-3-pro-image": 14,
}

GOOGLE_IMAGE_CREATION_MODES_BY_PACK: dict[str, tuple[str, ...]] = {
    "light_pack": ("text_to_image", "image_edit"),
    "intermediate_pack": ("text_to_image", "image_edit", "multi_reference"),
    "pro_pack": (
        "text_to_image", "image_edit", "multi_reference", "advanced_edit"
    ),
    "business_pack": (
        "text_to_image", "image_edit", "multi_reference", "advanced_edit"
    ),
}

# Duration maximum = duree du PROJET final, et non duree d'un appel Google.
# Au-dela de 10s : prolongation ou montage de plusieurs appels payants.
GOOGLE_VIDEO_MAX_PROJECT_SECONDS_BY_PACK: dict[str, int] = {
    "light_pack": 8,
    "intermediate_pack": 20,
    "pro_pack": 40,
    "business_pack": 120,
}
GOOGLE_VIDEO_DURATION_CHOICES_BY_PACK: dict[str, tuple[int, ...]] = {
    "light_pack": (4, 8),
    "intermediate_pack": (4, 8, 10, 20),
    "pro_pack": (4, 8, 10, 20, 40),
    "business_pack": (4, 8, 10, 20, 40, 60, 120),
}
GOOGLE_VIDEO_MODES_ALLOWED_BY_PACK: dict[str, tuple[str, ...]] = {
    "light_pack": ("text_to_video", "image_to_video"),
    "intermediate_pack": (
        "text_to_video", "image_to_video", "multi_scene", "extend_video"
    ),
    "pro_pack": (
        "text_to_video", "image_to_video", "multi_scene", "extend_video",
        "first_last_frame", "edit_video",
    ),
    "business_pack": (
        "text_to_video", "image_to_video", "multi_scene", "extend_video",
        "first_last_frame", "edit_video",
    ),
}
GOOGLE_VIDEO_MAX_SCENES_BY_PACK: dict[str, int] = {
    "light_pack": 1,
    "intermediate_pack": 2,
    "pro_pack": 16,
    "business_pack": 32,
}
# Pendant cette etape, seuls les clips 720p sont chiffrables.
# Les sorties 1080p (Pro) et 4K (Business) restent des objectifs a
# activer plus tard avec leurs vrais tarifs et le moteur de montage.
GOOGLE_VIDEO_RESOLUTIONS_ALLOWED_BY_PACK: dict[str, tuple[str, ...]] = {
    "light_pack": ("720p",),
    "intermediate_pack": ("720p",),
    "pro_pack": ("720p",),
    "business_pack": ("720p",),
}
GOOGLE_VIDEO_FUTURE_EXPORT_RESOLUTIONS_BY_PACK: dict[str, tuple[str, ...]] = {
    "light_pack": ("720p",),
    "intermediate_pack": ("720p",),
    "pro_pack": ("720p", "1080p"),
    "business_pack": ("720p", "1080p", "4K"),
}


def google_media_capabilities_for_pack(pack_id: str) -> dict[str, object]:
    """Decrit les droits proposes pour un pack connu, sinon refuse.

    Cette fonction ne verifie PAS l'abonnement ni le wallet : le routeur
    doit lire le pack ACTIF en base avant de l'appeler.
    """
    if pack_id not in GOOGLE_IMAGE_MODELS_ALLOWED_BY_PACK:
        raise ValueError("Pack ORIA inconnu pour les creations Google.")
    return {
        "image_models": GOOGLE_IMAGE_MODELS_ALLOWED_BY_PACK[pack_id],
        "image_resolutions": GOOGLE_IMAGE_RESOLUTIONS_ALLOWED_BY_PACK[pack_id],
        "image_modes": GOOGLE_IMAGE_CREATION_MODES_BY_PACK[pack_id],
        "max_reference_images": GOOGLE_IMAGE_MAX_REFERENCE_IMAGES_BY_PACK[pack_id],
        "video_model": GOOGLE_VIDEO_MODEL,
        "video_modes": GOOGLE_VIDEO_MODES_ALLOWED_BY_PACK[pack_id],
        "video_duration_choices": GOOGLE_VIDEO_DURATION_CHOICES_BY_PACK[pack_id],
        "max_video_project_seconds": GOOGLE_VIDEO_MAX_PROJECT_SECONDS_BY_PACK[pack_id],
        "max_video_scenes": GOOGLE_VIDEO_MAX_SCENES_BY_PACK[pack_id],
        "video_billable_resolutions": GOOGLE_VIDEO_RESOLUTIONS_ALLOWED_BY_PACK[pack_id],
    }


def validate_google_image_configuration(
    *, pack_id: str, model: str, resolution: str,
    mode: str, reference_count: int = 0,
) -> None:
    """Refuse les combinaisons non configurees, avant tout appel payant."""
    rights = google_media_capabilities_for_pack(pack_id)
    if model not in rights["image_models"]:
        raise ValueError("Modele Google interdit pour ce pack ORIA.")
    if resolution not in rights["image_resolutions"]:
        raise ValueError("Resolution image indisponible pour ce pack.")
    if resolution not in GOOGLE_IMAGE_OUTPUT_USD_BY_MODEL[model]:
        raise ValueError("Resolution indisponible pour le modele Google choisi.")
    if mode not in rights["image_modes"]:
        raise ValueError("Mode de creation image interdit pour ce pack.")
    if type(reference_count) is not int or not 0 <= reference_count <= rights["max_reference_images"]:
        raise ValueError("Nombre de photos de reference hors limite du pack.")
    if reference_count > GOOGLE_IMAGE_MAX_REFERENCE_IMAGES_BY_MODEL[model]:
        raise ValueError("Trop de references pour cette configuration de modele Google.")
    if mode == "text_to_image" and reference_count != 0:
        raise ValueError("Une creation texte vers image ne prend pas de photo de reference.")
    if mode in {"image_edit", "multi_reference", "advanced_edit"} and reference_count < 1:
        raise ValueError("Une retouche necessite une photo de reference.")
    if mode == "multi_reference" and reference_count < 2:
        raise ValueError("Le mode multi-reference necessite au moins deux images.")


def validate_google_video_configuration(
    *, pack_id: str, mode: str, duration_seconds: int,
    scene_count: int = 1, resolution: str = "720p",
) -> None:
    """Verifie les droits commerciaux, PAS le devis ou le wallet.

    Les videos >10s exigent une extension ou un projet multi-scenes.
    Chaque appel de generation reste borne a 3-10s par Google.
    """
    rights = google_media_capabilities_for_pack(pack_id)
    if mode not in rights["video_modes"]:
        raise ValueError("Mode video interdit pour ce pack ORIA.")
    if type(duration_seconds) is not int or duration_seconds not in rights["video_duration_choices"]:
        raise ValueError("Duree video indisponible pour ce pack ORIA.")
    if type(scene_count) is not int or not 1 <= scene_count <= rights["max_video_scenes"]:
        raise ValueError("Nombre de scenes hors limite du pack.")
    if resolution not in rights["video_billable_resolutions"]:
        raise ValueError("Resolution video non tarifee ou non autorisee.")
    if duration_seconds > GOOGLE_VIDEO_PROVIDER_MAX_CLIP_SECONDS and mode not in {
        "multi_scene", "extend_video"
    }:
        raise ValueError("Video longue : montage ou prolongation requis.")
    if mode == "multi_scene" and scene_count < 2:
        raise ValueError("Un montage multi-scenes requiert au moins deux scenes.")
    if mode != "multi_scene" and scene_count != 1:
        raise ValueError("Le nombre de scenes n'est applicable qu'au montage.")
    if mode == "multi_scene" and scene_count * GOOGLE_VIDEO_PROVIDER_MAX_CLIP_SECONDS < duration_seconds:
        raise ValueError("Les scenes prevues ne couvrent pas la duree finale.")
