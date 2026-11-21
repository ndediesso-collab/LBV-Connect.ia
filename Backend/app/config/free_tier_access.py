"""ORIA Gratuit Phase 6A: bounded, server-owned capability declaration.

Target policy and current staging availability are intentionally distinct:
allowing a feature in the product plan does not mean the corresponding
provider, ledger action, and artifact pipeline are safely wired yet.
"""
from __future__ import annotations

FREE_WEB_MAX_SITES = 2
FREE_IMAGE_MAX_EDGE_PIXELS = 1024
FREE_ALLOWED_DOCUMENT_FORMATS_TARGET = ("pdf", "docx", "xlsx")
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
                 "models": (["luna", "claude-haiku-5.5"] if
                            __import__("app.services.chat_provider_router", fromlist=["active_chat_provider"]).active_chat_provider().value == "openrouter"
                            else ["luna"]),
                 "staging_endpoint": "/ai/free/chat", "wired": True},
        "web": {"max_sites_per_request": 0, "wired": False,
                "requires_pack": True, "upgrade_path": FREE_UPGRADE_PATH,
                "max_search_calls": 0, "staging_only": False},
        "documents": {"target_formats": list(FREE_ALLOWED_DOCUMENT_FORMATS_TARGET),
                      "wired": True, "staging_only": True,
                      "reason": "SQL 6C required and end-to-end integration pending"},
        "images": {"max_edge_pixels": FREE_IMAGE_MAX_EDGE_PIXELS,
                   "wired": __import__("os").getenv("ORIA_FREE_IMAGES_ENABLED", "0") == "1" and bool(__import__("os").getenv("OPENROUTER_API_KEY")),
                   "reason": "Economical OpenRouter model and provider cost ceiling unverified"},
        "attachments": {"wired": True, "max_files": 2, "max_bytes": 2000000},
        "video": {"wired": False, "requires_pack": True},
        "oria_courses": {"wired": False, "requires_pack": True},
        "reasoning_deep": {"wired": False, "requires_pack": True},
        "upgrade_path": FREE_UPGRADE_PATH,
        "recharge": {"product_id": FREE_RECHARGE_PRODUCT_ID,
                     "credits": FREE_RECHARGE_CREDITS,
                     "price_xaf": FREE_RECHARGE_PRICE_XAF},
    }
