"""ORIA Gratuit Phase 6A: bounded, server-owned capability declaration.

Target policy and current staging availability are intentionally distinct:
allowing a feature in the product plan does not mean the corresponding
provider, ledger action, and artifact pipeline are safely wired yet.
"""
from __future__ import annotations

FREE_WEB_MAX_SITES = 2
FREE_IMAGE_MAX_EDGE_PIXELS = 1024
FREE_ALLOWED_DOCUMENT_FORMATS_TARGET = ("pdf", "docx")
FREE_REASONING_MODES = ("fast", "balanced")
FREE_UPGRADE_PATH = "/packs"
FREE_RECHARGE_PRODUCT_ID = "credits_1000_563"
FREE_RECHARGE_PRICE_XAF = 600
FREE_RECHARGE_CREDITS = 1000


def get_free_feature_catalog() -> dict:
    """Separate product intent from wired functionality; never claims live access."""
    return {
        "role": "free",
        "chat": {"model": "luna", "reasoning_modes": list(FREE_REASONING_MODES),
                 "staging_endpoint": "/ai/free/chat", "wired": True},
        "web": {"max_sites_per_request": FREE_WEB_MAX_SITES,
                "wired": True, "provider": "openrouter", "engine": "exa",
                "staging_only": True, "max_search_calls": 1,
                "blocked_on_openai": False, "openai_max_tool_calls": 1,
                "openai_two_sites_guaranteed": False},
        "documents": {"target_formats": list(FREE_ALLOWED_DOCUMENT_FORMATS_TARGET),
                      "wired": True, "staging_only": True,
                      "reason": "SQL 6C required and end-to-end integration pending"},
        "images": {"max_edge_pixels": FREE_IMAGE_MAX_EDGE_PIXELS, "wired": False,
                   "reason": "Economical OpenRouter model and provider cost ceiling unverified"},
        "video": {"wired": False, "requires_pack": True},
        "oria_courses": {"wired": False, "requires_pack": True},
        "reasoning_deep": {"wired": False, "requires_pack": True},
        "upgrade_path": FREE_UPGRADE_PATH,
        "recharge": {"product_id": FREE_RECHARGE_PRODUCT_ID,
                     "credits": FREE_RECHARGE_CREDITS,
                     "price_xaf": FREE_RECHARGE_PRICE_XAF},
    }
