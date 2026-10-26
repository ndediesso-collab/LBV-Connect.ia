from app.config.credit_costs import (
    LIGHT_PACK_CREDITS,
    INTERMEDIATE_PACK_CREDITS,
    PRO_PACK_CREDITS,
    BUSINESS_PACK_CREDITS,
)

PRIMARY_PACKS = {
    "light_pack": {
        "price": 4000,
        "credits": LIGHT_PACK_CREDITS,
    },

    "intermediate_pack": {
        "price": 8000,
        "credits": INTERMEDIATE_PACK_CREDITS,
    },

    "pro_pack": {
        "price": 12000,
        "credits": PRO_PACK_CREDITS,
    },

    "business_pack": {
        "price": 45000,
        "credits": BUSINESS_PACK_CREDITS,
    },
}