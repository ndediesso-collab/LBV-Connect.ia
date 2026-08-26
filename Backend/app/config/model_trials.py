# ============================================================
# DÉCOUVERTE DES MODÈLES SUPÉRIEURS
# ============================================================

TRIAL_MAX_USES = 5


# Modèle supérieur accessible en découverte
# pour chaque pack inférieur.
TRIAL_MODELS_BY_PACK = {
    "light_pack": "gpt-5",

    "intermediate_pack": "gpt-5.6-terra",

    "pro_pack": "gpt-5.6-sol",

    "business_pack": None,
}


# ============================================================
# COÛTS DES ESSAIS
# ============================================================

TRIAL_COSTS = {
    "gpt-5": {
        "normal": 60,
        "web": 86,
    },

    "gpt-5.6-terra": {
        "normal": 75,
        "web": 105,
    },

    "gpt-5.6-sol": {
        "normal": 120,
        "web": 165,
    },
}