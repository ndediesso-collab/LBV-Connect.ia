"""ORIA gratuit: conservative, usage-sensitive reservations for Luna text and files.

One output budget is used for BOTH server-side quote and provider max output.
Not a fixed credit charge. The SQL settlement remains the sole billing authority.
"""
from __future__ import annotations

import re
from dataclasses import dataclass
from decimal import Decimal

from app.config.free_tier_policy import FREE_CHAT_OUTPUT_TOKENS_MAX
from app.services.chat_provider_router import ChatProvider
from app.services.token_billing_service import TokenBillingService, OpenRouterTokenBillingService

MIN_OUTPUT_TOKENS = 512
MAX_ADAPTIVE_OUTPUT_TOKENS = min(FREE_CHAT_OUTPUT_TOKENS_MAX, 3072)


class AdaptiveQuoteUnavailable(ValueError):
    def __init__(self, minimum_required: int, available: int):
        self.minimum_required = minimum_required
        self.available = available
        super().__init__(
            f"Crédits insuffisants : il faut au moins {minimum_required} crédits "
            f"pour cette demande courte, solde disponible : {available}. "
            "Réduis le texte ou consulte les packs et recharges."
        )


@dataclass(frozen=True)
class AdaptiveLunaQuote:
    reserved_credits: int
    reserve_api_xaf: Decimal
    output_tokens: int
    preferred_output_tokens: int
    estimated_input_tokens: int
    constrained_by_balance: bool


def preferred_output_tokens(message: str, reasoning_mode: str, *, has_files: bool) -> int:
    """Quality cap; NOT a token-price estimate or a fixed credit charge."""
    text = message.casefold()
    detailed = bool(re.search(
        r"(?:exercice|corrig|résou|resou|démontr|demonstr|étape|etape|"
        r"analyse|détaill|detaill|développ|developp|rapport|cours|"
        r"document|fichier|tableau|calcule|calculer|expliqu)", text
    ))
    if has_files or len(message) > 1800:
        cap = 2560 if reasoning_mode == "balanced" else 2048
    elif detailed or len(message) > 450:
        cap = 2048 if reasoning_mode == "balanced" else 1536
    else:
        cap = 1536 if reasoning_mode == "balanced" else 1024
    return min(MAX_ADAPTIVE_OUTPUT_TOKENS, cap)


def _provider_quote(provider: ChatProvider, quoted_input: int, quoted_output: int,
                    *, model: str = "luna") -> tuple[int, Decimal]:
    if provider is ChatProvider.OPENAI:
        if model != "luna":
            raise ValueError("Ce modèle n'est pas disponible chez OpenAI direct.")
        credits, xaf = TokenBillingService.estimate_reservation(
            model="luna", estimated_input_tokens=quoted_input,
            max_output_tokens=quoted_output, web_enabled=False,
            include_api_cost=True,
        )
    elif provider is ChatProvider.OPENROUTER:
        quote = OpenRouterTokenBillingService.estimate_reservation(
            provider_model=("anthropic/claude-haiku-5.5" if model == "claude-haiku-5.5"
                            else "openai/gpt-6-luna"), estimated_input_tokens=quoted_input,
            max_output_tokens=quoted_output, web_enabled=False,
        )
        credits, xaf = quote.reserved_credits, quote.reserved_api_cost_xaf
    else:
        raise ValueError("Fournisseur IA non disponible")
    amount = Decimal(str(xaf))
    if type(credits) is not int or credits < 1 or not amount.is_finite() or amount <= 0:
        raise ValueError("Devis fournisseur invalide")
    return credits, amount


def choose_luna_quote(*, provider: ChatProvider, input_tokens: int,
                      user_message: str, reasoning_mode: str,
                      available_credits: int, image_count: int = 0,
                      has_files: bool = False,
                      model: str = "luna") -> AdaptiveLunaQuote:
    if type(input_tokens) is not int or input_tokens <= 0:
        raise ValueError("Budget d'entrée invalide")
    if type(available_credits) is not int or available_credits < 0:
        raise ValueError("Solde gratuit invalide")
    if type(image_count) is not int or not 0 <= image_count <= 2:
        raise ValueError("Nombre d'images invalide")
    if reasoning_mode not in ("fast", "balanced"):
        raise ValueError("Mode de raisonnement invalide")
    # The context estimate may differ from actual provider usage, especially images.
    # Reserve conservatively for input tokens and a larger possible image encoding.
    quoted_input = input_tokens + max(256, (input_tokens + 3)//4) + 7000*image_count
    target = preferred_output_tokens(user_message, reasoning_mode, has_files=has_files or image_count > 0)

    def price(output_cap: int) -> tuple[int, Decimal]:
        # Deliberately quote MORE output tokens than actually permitted to provider.
        quoted_output = min(FREE_CHAT_OUTPUT_TOKENS_MAX,
                            output_cap + max(128, (output_cap + 4)//5))
        return _provider_quote(provider, quoted_input, quoted_output, model=model)

    minimum, _ = price(MIN_OUTPUT_TOKENS)
    if minimum > available_credits:
        raise AdaptiveQuoteUnavailable(minimum, available_credits)

    desired_credits, desired_xaf = price(target)
    if desired_credits <= available_credits:
        return AdaptiveLunaQuote(desired_credits, desired_xaf, target,
                                 target, quoted_input, False)

    # Provider request becomes smaller when funds are low; the credit estimate
    # is NEVER artificially reduced while leaving a bigger upstream max_output.
    lo, hi = MIN_OUTPUT_TOKENS, target
    best_output, best_price = lo, price(lo)
    while lo <= hi:
        mid = (lo + hi)//2
        quote = price(mid)
        if quote[0] <= available_credits:
            best_output, best_price = mid, quote
            lo = mid + 1
        else:
            hi = mid - 1
    return AdaptiveLunaQuote(best_price[0], best_price[1], best_output,
                             target, quoted_input, True)
