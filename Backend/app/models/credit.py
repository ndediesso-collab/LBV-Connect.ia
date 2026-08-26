from dataclasses import dataclass
from datetime import datetime


@dataclass
class CreditWallet:
    user_id: str
    balance: int
    initial_credits: int
    created_at: datetime
    updated_at: datetime

    pack_id: str | None = None
    pack_activated_at: datetime | None = None
    pack_expires_at: datetime | None = None

    @property
    def consumed_credits(self) -> int:
        return self.initial_credits - self.balance

    @property
    def consumed_percentage(self) -> float:
        if self.initial_credits <= 0:
            return 0.0

        return (
            self.consumed_credits / self.initial_credits
        ) * 100

    @property
    def remaining_percentage(self) -> float:
        if self.initial_credits <= 0:
            return 0.0

        return (
            self.balance / self.initial_credits
        ) * 100

    @property
    def is_pack_active(self) -> bool:
        if (
            self.pack_activated_at is None
            or self.pack_expires_at is None
        ):
            return False

        now = datetime.now(
            tz=self.pack_expires_at.tzinfo
        )

        return (
            self.pack_activated_at
            <= now
            < self.pack_expires_at
        )

    @property
    def is_light_pack(self) -> bool:
        return self.pack_id == "light_pack"

    @property
    def is_intermediate_pack(self) -> bool:
        return self.pack_id == "intermediate_pack"

    @property
    def is_pro_pack(self) -> bool:
        return self.pack_id == "pro_pack"

    @property
    def is_business_pack(self) -> bool:
        return self.pack_id == "business_pack"
