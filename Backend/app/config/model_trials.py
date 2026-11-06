# ============================================================
# DÉCOUVERTE DES MODÈLES SUPÉRIEURS
# ============================================================

# Quotas historiques inchangés pour les packs classiques.
TRIAL_MAX_USES = 5

# Paramètre dédié au Pass Découverte.
# À faire appliquer côté serveur dans model_trial_service.py et ai.py.
# ATTENTION : ce paramètre seul ne limite pas encore les essais.
DISCOVERY_TRIAL_MAX_USES = 2


# Modèle supérieur accessible en découverte
# pour chaque pack inférieur.
TRIAL_MODELS_BY_PACK = {
    "light_pack": "gpt-5",
    "intermediate_pack": "gpt-5.6-terra",
    "pro_pack": "gpt-5.6-sol",
    "business_pack": None,
    "discovery_pack": "gpt-5.6-terra",
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

    # Astra est réservé au pack Business.
    # Il n'est donc pas exposé comme modèle d'essai aux packs inférieurs.
}
