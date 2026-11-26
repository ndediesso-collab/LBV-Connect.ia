from __future__ import annotations

import json
import re
import unicodedata
from typing import Any, Mapping, Sequence

MARKER = "<!--ORIA_ASSISTANT_REQUEST_DRAFT:"
_MARKER_RE = re.compile(r"<!--ORIA_ASSISTANT_REQUEST_DRAFT:(.*?)-->", re.DOTALL)
_FORBIDDEN_DETAIL_KEY = re.compile(
    r"(password|mot.?de.?passe|pin|otp|code.?secret|secret|carte.?bancaire|numero.?carte|"
    r"compte.?bancaire|numero.?compte|iban|rib|piece.?identite|identite|passeport|document|cni)",
    re.IGNORECASE,
)
_EMAIL_RE = re.compile(r"^[^\s@]+@[^\s@]+\.[^\s@]+$")
_DETAIL_KEY_RE = re.compile(r"^[A-Za-zÀ-ÿ0-9 _.-]{1,64}$")


def _normalized(value: str) -> str:
    return unicodedata.normalize("NFKD", value).encode("ascii", "ignore").decode("ascii").casefold()


def _assistant_asked_for_consent(visible_message: str) -> bool:
    value = _normalized(visible_message)
    asks = any(term in value for term in (
        "acceptez-vous", "etes-vous d'accord", "autorisez-vous", "m'autorisez-vous",
        "donnez-vous votre accord", "votre accord", "souhaitez-vous que je transmette",
        "puis-je transmettre", "puis-je communiquer", "consentez-vous", "etes vous d'accord",
    ))
    shares = any(term in value for term in ("transmett", "transmis", "communiqu", "partag"))
    recipient = any(term in value for term in (
        "entreprise", "societe", "service", "equipe", "banque", "assurance",
        "etablissement", "agence", "organisation", "boutique", "commerce",
    ))
    return asks and shares and recipient


def _clean_details(value: Any) -> dict[str, str]:
    if not isinstance(value, dict):
        return {}
    result: dict[str, str] = {}
    for raw_key, raw_value in list(value.items())[:30]:
        if not isinstance(raw_key, str):
            continue
        key = raw_key.strip()
        if not _DETAIL_KEY_RE.fullmatch(key) or _FORBIDDEN_DETAIL_KEY.search(_normalized(key)):
            continue
        if isinstance(raw_value, bool):
            rendered = "Oui" if raw_value else "Non"
        elif isinstance(raw_value, (str, int, float)):
            rendered = str(raw_value).strip()
        else:
            continue
        rendered = re.sub(r"[\x00-\x1f\x7f]", " ", rendered).strip()
        if not rendered or len(rendered) > 500 or "data:" in rendered.casefold():
            continue
        if re.search(r"(?i)(pin|otp|mot.?de.?passe|cvv|cryptogramme|code.?secret|numero.?de.?carte|numero.?de.?compte)", rendered):
            continue
        # Les longues suites numériques ressemblant à un numéro bancaire ou un OTP sont exclues.
        digits = re.sub(r"\D", "", rendered)
        if len(digits) >= 13 and len(digits) >= len(rendered.strip()) * 0.75:
            continue
        result[key] = rendered
    return result


def extract_request_draft(
    response_text: str, *, collection_enabled: bool,
    history: Sequence[Mapping[str, Any]] = (),
) -> tuple[str, dict[str, Any] | None]:
    """Strip the invisible model marker and return a validated, unconsented draft.

    The model only proposes a draft. The visitor's separate explicit confirmation
    button is the consent event and is verified server-side before persistence.
    """
    text = response_text if isinstance(response_text, str) else ""
    matches = list(_MARKER_RE.finditer(text))
    visible = _MARKER_RE.sub("", text).strip()
    if not collection_enabled or len(matches) != 1 or not _assistant_asked_for_consent(visible):
        return visible, None

    try:
        payload = json.loads(matches[0].group(1).strip())
    except (ValueError, TypeError):
        return visible, None
    if not isinstance(payload, dict):
        return visible, None

    request_type = str(payload.get("request_type") or "Demande de recontact").strip()[:120]
    summary = str(payload.get("summary") or "").strip()[:1200]
    summary = re.sub(r"(?<!\w)(?:\d[ -]?){13,19}(?!\w)", "[information sensible masquée]", summary)
    summary = re.sub(r"[\x00-\x1f\x7f]", " ", summary).strip()
    customer_name = re.sub(r"[\x00-\x1f\x7f]", " ", str(payload.get("customer_name") or "")).strip()[:120]
    customer_phone = re.sub(r"[\x00-\x1f\x7f]", " ", str(payload.get("customer_phone") or "")).strip()[:40]
    digits = re.sub(r"\D", "", customer_phone)
    customer_email = str(payload.get("customer_email") or "").strip().lower()[:254]

    if len(request_type) < 2 or len(summary) < 5 or len(customer_name) < 2:
        return visible, None
    if not 7 <= len(digits) <= 15:
        return visible, None

    # Le modèle ne peut pas créer une demande avec des coordonnées qu'il aurait
    # lui-même inventées : nom et téléphone doivent apparaître dans les messages
    # du visiteur. Les champs complémentaires sont conservés seulement si leur
    # valeur exacte a été donnée par le visiteur.
    user_messages = [
        str(item.get("content") or "") for item in history
        if isinstance(item, Mapping) and item.get("role") == "user"
    ]
    user_context = " ".join(user_messages)
    normalized_context = _normalized(user_context)
    context_digits = re.sub(r"\D", "", user_context)
    if _normalized(customer_name) not in normalized_context or digits not in context_digits:
        return visible, None

    if customer_email and (
        len(customer_email) > 254 or not _EMAIL_RE.fullmatch(customer_email)
        or customer_email.casefold() not in user_context.casefold()
    ):
        customer_email = ""

    details = _clean_details(payload.get("details"))
    details = {
        key: value for key, value in details.items()
        if _normalized(value) in normalized_context
    }

    return visible, {
        "request_type": request_type,
        "summary": summary,
        "customer_name": customer_name,
        "customer_phone": customer_phone,
        "customer_email": customer_email or None,
        "details": details,
    }
