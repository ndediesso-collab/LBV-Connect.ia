from enum import Enum


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
    # CHAT — GPT-5.6 SOL
    # ========================================================
    CHAT_SOL = "chat_sol"
    CHAT_SOL_WEB = "chat_sol_web"

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

CREDIT_COSTS: dict[CreditAction, int] = {
    # --------------------------------------------------------
    # LUNA
    # --------------------------------------------------------
    CreditAction.CHAT_LUNA: 6,
    CreditAction.CHAT_LUNA_WEB: 8,

    # --------------------------------------------------------
    # GPT-5
    # --------------------------------------------------------
    CreditAction.CHAT_GPT5: 60,
    CreditAction.CHAT_GPT5_WEB: 86,

    # --------------------------------------------------------
    # TERRA
    # --------------------------------------------------------
    CreditAction.CHAT_TERRA: 75,
    CreditAction.CHAT_TERRA_WEB: 105,

    # --------------------------------------------------------
    # SOL
    # --------------------------------------------------------
    CreditAction.CHAT_SOL: 120,
    CreditAction.CHAT_SOL_WEB: 165,

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
    # --------------------------------------------------------
    CreditAction.IMAGE_BUSINESS: 250,
    CreditAction.IMAGE_BUSINESS_HD: 400,
    CreditAction.IMAGE_BUSINESS_ULTRA: 600,

    # --------------------------------------------------------
    # VIDÉOS — BUSINESS
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
#
# Exemple :
#
#   Luna + texte
#       → 6 crédits
#
#   Luna + texte + 1 image
#       → 6 + 1 = 7 crédits
#
#   Luna + texte + 1 fichier
#       → 6 + 2 = 8 crédits
#
# Les coûts sont appliqués PAR élément.
#
# Maximum frontend prévu : 3 images/fichiers par message.
#

IMAGE_ANALYSIS_COSTS: dict[CreditAction, int] = {
    # --------------------------------------------------------
    # LUNA
    # --------------------------------------------------------
    CreditAction.CHAT_LUNA: 1,
    CreditAction.CHAT_LUNA_WEB: 1,

    # --------------------------------------------------------
    # GPT-5
    # --------------------------------------------------------
    CreditAction.CHAT_GPT5: 5,
    CreditAction.CHAT_GPT5_WEB: 5,

    # --------------------------------------------------------
    # TERRA
    # --------------------------------------------------------
    CreditAction.CHAT_TERRA: 8,
    CreditAction.CHAT_TERRA_WEB: 8,

    # --------------------------------------------------------
    # SOL
    # --------------------------------------------------------
    CreditAction.CHAT_SOL: 12,
    CreditAction.CHAT_SOL_WEB: 12,
}


FILE_ANALYSIS_COSTS: dict[CreditAction, int] = {
    # --------------------------------------------------------
    # LUNA
    # --------------------------------------------------------
    CreditAction.CHAT_LUNA: 2,
    CreditAction.CHAT_LUNA_WEB: 2,

    # --------------------------------------------------------
    # GPT-5
    # --------------------------------------------------------
    CreditAction.CHAT_GPT5: 10,
    CreditAction.CHAT_GPT5_WEB: 10,

    # --------------------------------------------------------
    # TERRA
    # --------------------------------------------------------
    CreditAction.CHAT_TERRA: 15,
    CreditAction.CHAT_TERRA_WEB: 15,

    # --------------------------------------------------------
    # SOL
    # --------------------------------------------------------
    CreditAction.CHAT_SOL: 20,
    CreditAction.CHAT_SOL_WEB: 20,
}


# ============================================================
# LIMITES MULTIMODALES
# ============================================================

MAX_MULTIMODAL_ATTACHMENTS = 3


# ============================================================
# PACK LÉGER
# ============================================================

LIGHT_PACK_CREDITS = 3_000
LIGHT_PACK_PRICE_XAF = 6_500
LIGHT_PACK_DURATION_DAYS = 35
LIGHT_PACK_API_BUDGET_XAF = 2_500


# ============================================================
# PACK INTERMÉDIAIRE
# ============================================================

INTERMEDIATE_PACK_CREDITS = 28_500
INTERMEDIATE_PACK_PRICE_XAF = 11_500
INTERMEDIATE_PACK_DURATION_DAYS = 35
INTERMEDIATE_PACK_API_BUDGET_XAF = 4_500


# ============================================================
# PACK PRO
# ============================================================

PRO_PACK_CREDITS = 45_000
PRO_PACK_PRICE_XAF = 17_500
PRO_PACK_DURATION_DAYS = 35
PRO_PACK_API_BUDGET_XAF = 6_000


# ============================================================
# PACK BUSINESS
# ============================================================

BUSINESS_PACK_CREDITS = 96_000
BUSINESS_PACK_PRICE_XAF = 25_000
BUSINESS_PACK_DURATION_DAYS = 35
BUSINESS_PACK_API_BUDGET_XAF = 10_000