"""ORIA paid Chat: bounded output ceilings applied identically to quote and API.

This module never reads balances, changes prices or contacts providers. High-risk
artifact output retains a large budget to avoid corrupt/truncated documents.
Default is disabled until explicitly activated with an admin environment flag.
"""
from __future__ import annotations
import os
import re

MAX_OUTPUT = 32_000


def paid_output_tokens(*, message: str, estimated_input_tokens: int,
                       reasoning_mode: str, web: bool, attachment_count: int = 0,
                       document_types: tuple[str, ...] = ()) -> int:
    if os.getenv("ORIA_PAID_CHAT_ADAPTIVE_RESERVATIONS_ENABLED", "0") != "1":
        return MAX_OUTPUT
    if not isinstance(message, str) or type(estimated_input_tokens) is not int or estimated_input_tokens < 0:
        raise ValueError("Contexte de devis Chat invalide")
    if reasoning_mode not in ("fast", "balanced", "deep"):
        raise ValueError("Mode de raisonnement inconnu")
    if type(attachment_count) is not int or attachment_count < 0:
        raise ValueError("Nombre de pieces jointes invalide")
    if document_types:
        # JSON composition + code generation frequently require many output tokens.
        return 28_000
    if attachment_count:
        return 12_288 if reasoning_mode == "deep" else 8_192
    if reasoning_mode == "deep":
        return 16_384
    if web:
        return 8_192
    if re.search(r"\b(code|programme|script|rapport|chapitre|analyse detaillee|développe|developpe|long|complet|dossier|corrigé intégral|corrige integral)\b", message, re.I):
        return 8_192
    if estimated_input_tokens > 10_000 or len(message) > 1800:
        return 8_192
    if reasoning_mode == "balanced" or estimated_input_tokens > 2800:
        return 6_144
    return 4_096


def reserve_for_stream(per_generation_output_tokens: int, *, potentially_steered: bool) -> int:
    """Never decrease the legacy reservation for OpenAI live steering.

    In a WebSocket generation several billed responses can be chained. Until
    each segment is durably metered, retain the existing full reservation.
    """
    if type(per_generation_output_tokens) is not int or not 1 <= per_generation_output_tokens <= MAX_OUTPUT:
        raise ValueError("Plafond de sortie Chat invalide")
    return MAX_OUTPUT if potentially_steered else per_generation_output_tokens
