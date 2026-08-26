from dataclasses import dataclass
from datetime import datetime
from enum import Enum

from app.config.credit_costs import CreditAction


class CreditTransactionType(str, Enum):
    PACK_PURCHASE = "pack_purchase"
    USAGE = "usage"
    RECHARGE = "recharge"
    REFUND = "refund"
    ADJUSTMENT = "adjustment"


@dataclass(frozen=True)
class CreditTransaction:
    id: str
    user_id: str
    transaction_type: CreditTransactionType
    amount: int
    balance_after: int
    created_at: datetime
    action: CreditAction | None = None
    reference_id: str | None = None
