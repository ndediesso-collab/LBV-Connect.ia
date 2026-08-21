from dataclasses import dataclass
from datetime import datetime


@dataclass
class Wallet:
    user_id: str
    pack_id: str
    balance: int
    reserved: int
    expires_at: datetime

    @property
    def available(self) -> int:
        return max(0, self.balance - self.reserved)

    @property
    def is_expired(self) -> bool:
        return datetime.utcnow() >= self.expires_at