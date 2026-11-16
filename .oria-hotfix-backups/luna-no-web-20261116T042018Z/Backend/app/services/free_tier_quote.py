"""Pure free Luna preflight presentation. No credits are reserved here.

The existing TokenBillingService/OpenRouterTokenBillingService remain the
sole billing authority; this module only presents their SERVER-SIDE reserve.
"""
from __future__ import annotations

from decimal import Decimal, InvalidOperation

from app.config.free_tier_access import FREE_UPGRADE_PATH


class FreeQuoteContractError(ValueError):
    pass


def make_free_chat_quote(*, provider: str, reserved_credits: int,
                         reserve_api_xaf: object, balance: dict,
                         max_output_tokens: int, input_token_budget: int,
                         daily_free_credits: int = 200) -> dict:
    if type(reserved_credits) is not int or reserved_credits <= 0:
        raise FreeQuoteContractError("Invalid server reserve.")
    if type(max_output_tokens) is not int or max_output_tokens <= 0:
        raise FreeQuoteContractError("Invalid enforced output cap.")
    if type(input_token_budget) is not int or input_token_budget <= 0:
        raise FreeQuoteContractError("Invalid input-token budget.")
    if type(daily_free_credits) is not int or daily_free_credits != 200:
        raise FreeQuoteContractError("Invalid free grant ceiling.")
    if provider not in {"openai", "openrouter"}:
        raise FreeQuoteContractError("Unrecognized active provider.")
    if not isinstance(balance, dict):
        raise FreeQuoteContractError("Invalid wallet.")
    free, purchased, total = (balance.get("free_credits"),
                              balance.get("purchased_credits"), balance.get("balance"))
    if any(type(x) is not int or x < 0 for x in (free, purchased, total)) or total != free + purchased:
        raise FreeQuoteContractError("Inconsistent free-tier wallet.")
    try:
        cost = Decimal(str(reserve_api_xaf))
    except (ValueError, TypeError, InvalidOperation) as exc:
        raise FreeQuoteContractError("Invalid provider reserve.") from exc
    if not cost.is_finite() or cost <= 0:
        raise FreeQuoteContractError("Invalid provider reserve.")
    within_action_cap = reserved_credits <= daily_free_credits
    can_reserve = within_action_cap and total >= reserved_credits
    reason = None
    if not within_action_cap:
        reason = "ACTION_EXCEEDS_FREE_LIMIT"
    elif not can_reserve:
        reason = "INSUFFICIENT_CREDITS"
    return {
        "action": "chat_luna",
        "model": "luna",
        "provider": provider,
        "quote_kind": "CONSERVATIVE_RESERVATION_MAXIMUM",
        "reserved_credits": reserved_credits,
        "input_token_budget": input_token_budget,
        "max_output_tokens": max_output_tokens,
        "wallet": {"free_credits": free, "purchased_credits": purchased, "balance": total},
        "can_reserve_by_balance": can_reserve,
        "reason": reason,
        "upgrade_path": FREE_UPGRADE_PATH,
        "notice": "Preflight only: the atomic reserve may reject if the balance/budget changes. Actual provider usage is settled afterward.",
    }
