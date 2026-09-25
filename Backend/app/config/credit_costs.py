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



# ============================================================



# COÛTS DE RÉFÉRENCE



# ============================================================



# ============================================================



# FACTURATION DYNAMIQUE DU CHAT — RÉFÉRENCES ÉCONOMIQUES



# ============================================================



#



# PHASE DE TRANSITION :



# Ces constantes préparent le futur calcul :



# usage OpenAI -> coût USD -> coût XAF -> crédits Oria.



#



# Elles ne remplacent PAS encore CREDIT_COSTS dans le backend actuel.



# Les coûts fixes CHAT_\\\\\\* restent actifs jusqu'au branchement complet



# via token_billing_service.py + reserve/settle.



#



ORIA_CREDIT_VALUE_XAF = 0.10



ACCOUNTING_USD_XAF = 600.0



PACK_API_SAFETY_RESERVE_RATIO = 0.20



MAX_CHAT_INPUT_TOKENS = 250_000



MAX_CHAT_OUTPUT_TOKENS = 32_000



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



    "light": 20_000,



    "intermediate": 36_000,



    "pro": 48_000,



    "business": 160_000,



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

# en crédits est effectuée par le futur media_billing_service.py.

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
# Oria conserve OpenAI comme fournisseur vidéo.
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

# LEGACY / TRANSITION :



# Les coûts CHAT_\\\\\\* ci-dessous restent actifs uniquement jusqu'à la migration



# du routeur vers le futur token_billing_service.py.



CREDIT_COSTS: dict[CreditAction, int] = {



    # --------------------------------------------------------



    # LUNA



    # --------------------------------------------------------



    # --------------------------------------------------------



    # GPT-5



    # --------------------------------------------------------



    # --------------------------------------------------------



    # TERRA



    # --------------------------------------------------------



    # --------------------------------------------------------



    # SOL



    # --------------------------------------------------------



    # --------------------------------------------------------



    # ASTRA



    # --------------------------------------------------------



    # --------------------------------------------------------



    # IMAGES — LÉGER



    # --------------------------------------------------------



    CreditAction.IMAGE_480: 50,



    CreditAction.IMAGE_720: 75,



    # --------------------------------------------------------



    # VIDÉOS — LÉGER



    # --------------------------------------------------------



    CreditAction.VIDEO_4S: 500,



    CreditAction.VIDEO_8S: 1_000,



    # --------------------------------------------------------



    # VIDÉO — INTERMÉDIAIRE



    # --------------------------------------------------------



    CreditAction.VIDEO_LITE: 1_500,



    # --------------------------------------------------------



    # IMAGES — PRO



    # --------------------------------------------------------



    CreditAction.IMAGE_PRO: 100,



    CreditAction.IMAGE_PRO_STANDARD: 180,



    CreditAction.IMAGE_PRO_ULTRA: 270,



    # --------------------------------------------------------



    # VIDÉOS — PRO



    # --------------------------------------------------------



    CreditAction.VIDEO_PRO_FAST: 1_500,



    CreditAction.VIDEO_PRO_STANDARD: 3_000,



    CreditAction.VIDEO_PRO_EXTENSION: 1_500,



    # --------------------------------------------------------



    # IMAGES — BUSINESS



    # À RECALCULER AVEC LES COÛTS API RÉELS



    # --------------------------------------------------------



    CreditAction.IMAGE_BUSINESS: 250,



    CreditAction.IMAGE_BUSINESS_HD: 400,



    CreditAction.IMAGE_BUSINESS_ULTRA: 600,



    # --------------------------------------------------------



    # VIDÉOS — BUSINESS



    # À RECALCULER AVEC LES COÛTS API RÉELS



    # --------------------------------------------------------



    CreditAction.VIDEO_BUSINESS_FAST: 2_500,



    CreditAction.VIDEO_BUSINESS_STANDARD: 5_000,



    CreditAction.VIDEO_BUSINESS_LONG: 10_000,



}



# ============================================================



# SUPPLÉMENTS D'ANALYSE MULTIMODALE



# ============================================================



#



# Ces coûts NE remplacent PAS le coût du chat.



# Ils sont ajoutés au coût de base du modèle.



#



# Maximum frontend prévu : 3 images/fichiers par message.



#



# LEGACY / TRANSITION :



# À remplacer plus tard par l'impact réel sur l'usage/tokenisation.



IMAGE_ANALYSIS_COSTS: dict[CreditAction, int] = {



    # --------------------------------------------------------



    # LUNA



    # --------------------------------------------------------



    # --------------------------------------------------------



    # GPT-5



    # --------------------------------------------------------



    # --------------------------------------------------------



    # TERRA



    # --------------------------------------------------------



    # --------------------------------------------------------



    # SOL



    # --------------------------------------------------------



    # --------------------------------------------------------



    # ASTRA



    # --------------------------------------------------------



}



# LEGACY / TRANSITION :



# À remplacer plus tard par l'impact réel sur l'usage/tokenisation.



FILE_ANALYSIS_COSTS: dict[CreditAction, int] = {



    # --------------------------------------------------------



    # LUNA



    # --------------------------------------------------------



    # --------------------------------------------------------



    # GPT-5



    # --------------------------------------------------------



    # --------------------------------------------------------



    # TERRA



    # --------------------------------------------------------



    # --------------------------------------------------------



    # SOL



    # --------------------------------------------------------



    # --------------------------------------------------------



    # ASTRA



    # --------------------------------------------------------



}



# ============================================================



# LIMITES MULTIMODALES



# ============================================================



MAX_MULTIMODAL_ATTACHMENTS = 3



# ============================================================



# PACK LÉGER



# ============================================================



# ------------------------------------------------------------



# SOLDES ACTIFS — FACTURATION DYNAMIQUE DU CHAT



# ------------------------------------------------------------



# Cibles actives :

#   Léger         20_000

#   Intermédiaire 36_000

#   Pro           48_000

#   Business     160_000

#

# Budgets API conservés :

#   2_500 / 4_500 / 6_000 / 20_000 XAF



#



LIGHT_PACK_CREDITS = 20_000



LIGHT_PACK_PRICE_XAF = 4_000



LIGHT_PACK_DURATION_DAYS = 35



LIGHT_PACK_API_BUDGET_XAF = 2_500



# ============================================================



# PACK INTERMÉDIAIRE



# ============================================================



INTERMEDIATE_PACK_CREDITS = 36_000



INTERMEDIATE_PACK_PRICE_XAF = 8_000



INTERMEDIATE_PACK_DURATION_DAYS = 35



INTERMEDIATE_PACK_API_BUDGET_XAF = 4_500



# ============================================================



# PACK PRO



# ============================================================



PRO_PACK_CREDITS = 48_000



PRO_PACK_PRICE_XAF = 12_000



PRO_PACK_DURATION_DAYS = 35



PRO_PACK_API_BUDGET_XAF = 6_000



# ============================================================



# PACK BUSINESS



# ============================================================



BUSINESS_PACK_CREDITS = 160_000



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
