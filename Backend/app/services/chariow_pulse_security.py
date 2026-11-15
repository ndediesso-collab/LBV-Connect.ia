"""Chariow Pulse HMAC verification. Pure, no network, no database writes.

Official signing contract: HMAC SHA256 of exact raw body bytes using the
Pulse-specific whsec_... secret, header sha256=<64 lowercase hex chars>.
No timestamp is included by the provider. Never re-serialize the JSON.
"""
from __future__ import annotations

import hashlib
import hmac
import re

_SIGNATURE = re.compile(r"sha256=[0-9a-f]{64}\Z", re.ASCII)
MAX_PULSE_BODY_BYTES = 131_072


def verify_pulse_signature(*, raw_body: bytes, received_signature: str, signing_secret: str) -> bool:
    """Return True only when the raw Chariow Pulse signature matches.

    A missing or malformed secret is treated as invalid, never as a bypass.
    """
    if not isinstance(raw_body, bytes) or not 0 < len(raw_body) <= MAX_PULSE_BODY_BYTES:
        return False
    if not isinstance(signing_secret, str) or not signing_secret.startswith("whsec_") or len(signing_secret) < 12:
        return False
    if not isinstance(received_signature, str) or not _SIGNATURE.fullmatch(received_signature):
        return False
    expected = "sha256=" + hmac.new(
        signing_secret.encode("utf-8"), raw_body, hashlib.sha256
    ).hexdigest()
    return hmac.compare_digest(expected, received_signature)
