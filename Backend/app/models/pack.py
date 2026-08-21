from dataclasses import dataclass
from enum import Enum


class ModelTier(str, Enum):
    STANDARD = "standard"
    REASONING = "reasoning"
    PREMIUM = "premium"


@dataclass(frozen=True)
class Pack:
    id: str
    name: str
    price_xaf: int
    credits: int
    duration_days: int
    allowed_tiers: tuple[ModelTier, ...]