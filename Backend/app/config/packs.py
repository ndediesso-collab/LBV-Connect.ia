from app.models.pack import ModelTier, Pack


PACKS = {
    "light": Pack(
        id="light",
        name="Léger",
        price_xaf=6_500,
        credits=15_000,
        duration_days=35,
        allowed_tiers=(
            ModelTier.STANDARD,
        ),
    ),

    "intermediate": Pack(
        id="intermediate",
        name="Intermédiaire",
        price_xaf=11_500,
        credits=30_000,
        duration_days=35,
        allowed_tiers=(
            ModelTier.STANDARD,
            ModelTier.REASONING,
        ),
    ),

    "pro": Pack(
        id="pro",
        name="Pro",
        price_xaf=18_000,
        credits=60_000,
        duration_days=35,
        allowed_tiers=(
            ModelTier.STANDARD,
            ModelTier.REASONING,
            ModelTier.PREMIUM,
        ),
    ),

    "business": Pack(
        id="business",
        name="Business",
        price_xaf=25_000,
        credits=100_000,
        duration_days=35,
        allowed_tiers=(
            ModelTier.STANDARD,
            ModelTier.REASONING,
            ModelTier.PREMIUM,
        ),
    ),
}