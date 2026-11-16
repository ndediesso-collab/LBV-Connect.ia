"""ORIA — Free daily tier: pure policy, NO database mutations or network calls.

This module describes the intended billing contract. It is deliberately NOT
connected to live endpoints. Transactional implementation must use PostgreSQL
row locks, unique idempotency keys, and real provider-usage settlements.
"""
from __future__ import annotations

from dataclasses import dataclass, replace
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal, ROUND_CEILING
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from app.config.credit_costs import (
    ACCOUNTING_USD_XAF,
    MODEL_TOKEN_PRICING_USD_PER_MILLION,
    OPENROUTER_CHAT_RESERVATION_RATES_USD_PER_MILLION,
    ORIA_CREDIT_VALUE_XAF,
    PACK_API_SAFETY_RESERVE_RATIO,
)

FREE_PACK_ID = "oria_free_daily"
FREE_DAILY_CREDITS = 150
FREE_DAILY_TIMEZONE = "Africa/Libreville"
FREE_ALLOWED_CHAT_MODEL = "luna"
FREE_WEB_SEARCH_ENABLED = False
FREE_IMAGE_CREATION_ENABLED = False
FREE_VIDEO_CREATION_ENABLED = False
FREE_ALLOWED_DOCUMENT_FORMATS = frozenset({"pdf"})
FREE_CHAT_INPUT_TOKENS_MAX = 6_000
FREE_CHAT_OUTPUT_TOKENS_MAX = 4_096
FREE_PDF_OUTPUT_TOKENS_MAX = 6_144
FREE_GLOBAL_API_CAP_DEFAULT_XAF = 60_000  # pilot recommendation; not activated here


class FreeTierPolicyError(ValueError):
    """Input/state does not satisfy the free-tier contract."""


def libreville_date(value: datetime) -> date:
    """Calculate local calendar date, not a 24-hour cooldown."""
    if not isinstance(value, datetime) or value.tzinfo is None:
        raise FreeTierPolicyError("An offset-aware datetime is required.")
    # Windows Python may lack the optional tzdata package. Gabon has UTC+1
    # year round; fall back without relying on the PC's timezone setting.
    try:
        gabon_tz = ZoneInfo(FREE_DAILY_TIMEZONE)
    except ZoneInfoNotFoundError:
        gabon_tz = timezone(timedelta(hours=1))
    return value.astimezone(gabon_tz).date()


def _check_count(value: int, name: str) -> None:
    if type(value) is not int or value < 0:
        raise FreeTierPolicyError(f"{name} must be a non-negative integer.")


@dataclass(frozen=True)
class FreeBalance:
    """Separate free and purchased balance; DB will persist each bucket.

    A purchased balance suspends daily grants until purchased credits are zero.
    The recharge_frozen flag records that a recharge occurred; once purchased
    credits are exhausted, the next eligible daily grant clears the flag.
    """
    free_credits: int = 0
    purchased_credits: int = 0
    last_daily_grant: date | None = None
    recharge_frozen: bool = False

    def __post_init__(self) -> None:
        _check_count(self.free_credits, "free_credits")
        _check_count(self.purchased_credits, "purchased_credits")
        # Accepter les attributions anciennes de 200 jusqu’à leur expiration normale.
        # Une nouvelle attribution est toujours limitée à FREE_DAILY_CREDITS (=150).
        if self.free_credits > max(FREE_DAILY_CREDITS, 200):
            raise FreeTierPolicyError("Free credits exceed the daily grant.")
        if self.purchased_credits and not self.recharge_frozen:
            raise FreeTierPolicyError("Purchased free-tier credits require recharge lock.")

    @property
    def balance(self) -> int:
        return self.free_credits + self.purchased_credits


@dataclass(frozen=True)
class DebitBreakdown:
    charged_free: int
    charged_purchased: int

    @property
    def total(self) -> int:
        return self.charged_free + self.charged_purchased


def daily_refresh(
    balance: FreeBalance,
    *,
    now: datetime,
    paid_pack_active: bool,
    has_open_reservation: bool = False,
) -> tuple[FreeBalance, bool]:
    """Lazy midnight refill. No paid credit is erased or silently transformed.

    An active pack blocks free issuance. A purchased balance > 0 blocks all
    new free grants, even across midnight. Once purchased reaches zero, the
    ordinary local-day eligibility check applies. This pure model mirrors the
    currently patched SQL condition; it does NOT establish the day on which
    paid credits were depleted. That extra timestamp/state is needed to
    guarantee a first grant ONLY after the next midnight in all edge cases.
    """
    today = libreville_date(now)
    if paid_pack_active or has_open_reservation:
        # An in-flight charge may refund after midnight. Do not reset the
        # free bucket until that reservation has settled or been released.
        return balance, False
    if balance.purchased_credits > 0:
        return balance, False
    eligible = balance.last_daily_grant is None or balance.last_daily_grant < today
    if not eligible:
        return balance, False
    # Preserve the purchased bucket; daily grants must never reset paid funds.
    return replace(
        balance,
        free_credits=FREE_DAILY_CREDITS,
        last_daily_grant=today,
        recharge_frozen=False,
    ), True


def apply_purchased_addon(
    balance: FreeBalance, *, credits: int, paid_pack_active: bool
) -> FreeBalance:
    """Policy-only operation. Production requires verified, idempotent payment."""
    if type(credits) is not int or credits <= 0:
        raise FreeTierPolicyError("Addon must be a positive integer amount.")
    if paid_pack_active:
        raise FreeTierPolicyError("Route active-pack add-ons through paid billing.")
    return replace(
        balance,
        purchased_credits=balance.purchased_credits + credits,
        recharge_frozen=True,
    )


def charge_credits(balance: FreeBalance, amount: int) -> tuple[FreeBalance, DebitBreakdown]:
    """Consume free bucket before purchased bucket; never allow overdraft.

    SQL reservation/settlement must retain the bucket breakdown per request
    so unused reservations can be refunded to their ORIGINAL buckets.
    """
    if type(amount) is not int or amount <= 0:
        raise FreeTierPolicyError("Charge must be a positive integer amount.")
    if amount > balance.balance:
        raise FreeTierPolicyError("Insufficient free-tier credits.")
    free = min(balance.free_credits, amount)
    purchased = amount - free
    remaining = replace(
        balance,
        free_credits=balance.free_credits - free,
        purchased_credits=balance.purchased_credits - purchased,
    )
    return remaining, DebitBreakdown(charged_free=free, charged_purchased=purchased)


def restore_unused_reservation(
    balance: FreeBalance, *, reserved: DebitBreakdown, actual_credits: int
) -> FreeBalance:
    """Restore a bounded settlement to source buckets (no extra charge).

    When actual_credits > reserved.total, caller MUST use a separate atomic
    extra-debit or debt/reconciliation protocol. Never just drop the overrun.
    """
    _check_count(actual_credits, "actual_credits")
    if actual_credits > reserved.total:
        raise FreeTierPolicyError("Actual usage exceeds reservation; reconcile separately.")
    _check_count(reserved.charged_free, "charged_free")
    _check_count(reserved.charged_purchased, "charged_purchased")
    spent_free = min(actual_credits, reserved.charged_free)
    spent_paid = actual_credits - spent_free
    free_back = reserved.charged_free - spent_free
    paid_back = reserved.charged_purchased - spent_paid
    return replace(
        balance,
        free_credits=balance.free_credits + free_back,
        purchased_credits=balance.purchased_credits + paid_back,
    )


def luna_free_reservation_credits(
    *, input_tokens: int, output_limit: int, provider: str, is_pdf: bool = False
) -> int:
    """Conservative *credit* quote for a physically enforced output cap.

    This helper MUST be called using the SAME output_limit sent to the real
    provider request. It is not a substitute for measured usage or API budget.
    """
    if type(input_tokens) is not int or not 1 <= input_tokens <= FREE_CHAT_INPUT_TOKENS_MAX:
        raise FreeTierPolicyError("Free Luna input exceeds allowed token count.")
    maximum = FREE_PDF_OUTPUT_TOKENS_MAX if is_pdf else FREE_CHAT_OUTPUT_TOKENS_MAX
    if type(output_limit) is not int or not 1 <= output_limit <= maximum:
        raise FreeTierPolicyError("Free Luna output limit is unsupported.")
    if provider == "openai":
        rate = MODEL_TOKEN_PRICING_USD_PER_MILLION[FREE_ALLOWED_CHAT_MODEL]
        input_usd = max(Decimal(str(rate[k])) for k in
                        ("short_input", "short_cached_input", "short_cache_write"))
        output_usd = Decimal(str(rate["short_output"]))
        margin = Decimal("0")  # Existing OpenAI preauthorization uses no margin.
    elif provider == "openrouter":
        rate = OPENROUTER_CHAT_RESERVATION_RATES_USD_PER_MILLION["openai/gpt-6-luna"]
        input_usd = max(Decimal(str(rate["input"])), Decimal(str(rate["cache_write"])))
        output_usd = Decimal(str(rate["output"]))
        margin = Decimal(str(PACK_API_SAFETY_RESERVE_RATIO))
    else:
        raise FreeTierPolicyError("Unknown Luna provider.")
    fx = Decimal(str(ACCOUNTING_USD_XAF))
    credit_xaf = Decimal(str(ORIA_CREDIT_VALUE_XAF))
    if fx <= 0 or credit_xaf <= 0 or margin < 0:
        raise FreeTierPolicyError("Invalid economic configuration.")
    usd = (input_usd * input_tokens + output_usd * output_limit) / Decimal("1000000")
    estimated_xaf = usd * fx * (Decimal("1") + margin)
    return max(1, int((estimated_xaf / credit_xaf).to_integral_value(rounding=ROUND_CEILING)))


def free_action_permitted(*, model: str, web: bool, document_format: str | None = None,
                          image: bool = False, video: bool = False) -> bool:
    if model != FREE_ALLOWED_CHAT_MODEL or web or image or video:
        return False
    if document_format and document_format.lower() not in FREE_ALLOWED_DOCUMENT_FORMATS:
        return False
    return True
