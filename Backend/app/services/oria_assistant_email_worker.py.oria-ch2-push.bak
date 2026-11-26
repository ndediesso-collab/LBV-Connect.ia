from __future__ import annotations

import logging
import os
from datetime import datetime, timedelta, timezone
from typing import Any
from zoneinfo import ZoneInfo

import requests

logger = logging.getLogger("oria.assistant.email")
BREVO_URL = "https://api.brevo.com/v3/smtp/email"
LOCAL_TZ = ZoneInfo("Africa/Libreville")


def worker_ready() -> bool:
    # Configuration dédiée recommandée ; repli sur les mêmes identifiants
    # Brevo que Collaboratif sans modifier son service d'envoi.
    return bool(
        os.getenv("ORIA_ASSISTANT_EMAIL_WORKER_ENABLED", "0").strip() == "1"
        and (os.getenv("ORIA_ASSISTANT_BREVO_API_KEY") or os.getenv("ORIA_COLLAB_BREVO_API_KEY"))
        and (os.getenv("ORIA_ASSISTANT_EMAIL_FROM") or os.getenv("ORIA_COLLAB_EMAIL_FROM"))
    )


def _configuration() -> tuple[str, str, str]:
    key = (os.getenv("ORIA_ASSISTANT_BREVO_API_KEY") or os.getenv("ORIA_COLLAB_BREVO_API_KEY") or "").strip()
    sender = (os.getenv("ORIA_ASSISTANT_EMAIL_FROM") or os.getenv("ORIA_COLLAB_EMAIL_FROM") or "").strip()
    name = os.getenv("ORIA_ASSISTANT_EMAIL_SENDER_NAME", "ORIA Assistant").strip() or "ORIA Assistant"
    if not key or not sender or "@" not in sender:
        raise RuntimeError("oria_assistant_email_configuration_missing")
    return key, sender, name[:80]


def _rpc(db: Any, name: str, args: dict[str, Any]) -> Any:
    response = db.rpc(name, args).execute()
    return getattr(response, "data", None)


def _next_local_midnight() -> str:
    now = datetime.now(LOCAL_TZ)
    tomorrow = (now + timedelta(days=1)).date()
    reset = datetime.combine(tomorrow, datetime.min.time(), tzinfo=LOCAL_TZ)
    return reset.astimezone(timezone.utc).isoformat()


def _retry_after(attempt_count: int) -> str:
    seconds = min(6 * 60 * 60, 60 * (2 ** min(max(attempt_count - 1, 0), 8)))
    return (datetime.now(timezone.utc) + timedelta(seconds=seconds)).isoformat()


def dispatch_batch(db: Any, batch_size: int = 10) -> dict[str, int]:
    if not worker_ready():
        return {"claimed": 0, "sent": 0, "retry": 0, "failed": 0, "disabled": 1}
    key, sender, sender_name = _configuration()
    try:
        daily_limit = int(os.getenv("ORIA_ASSISTANT_EMAIL_DAILY_LIMIT", "300"))
    except ValueError:
        daily_limit = 300
    daily_limit = max(1, min(daily_limit, 300))

    claimed = _rpc(db, "oria_assistant_email_claim_v1", {
        "p_limit": max(1, min(int(batch_size), 30)),
        "p_daily_limit": daily_limit,
    })
    if not isinstance(claimed, list):
        claimed = []
    result = {"claimed": len(claimed), "sent": 0, "retry": 0, "failed": 0}

    for item in claimed:
        if not isinstance(item, dict):
            continue
        email_id = str(item.get("id") or "")
        lease_token = str(item.get("lease_token") or "")
        outcome = "retry"
        error_code = "email_delivery_unknown"
        provider_message_id = None
        retry_at = _retry_after(int(item.get("attempt_count") or 1))
        try:
            response = requests.post(
                BREVO_URL,
                json={
                    "sender": {"email": sender, "name": sender_name},
                    "to": [{"email": str(item.get("to_email") or "")}],
                    "subject": str(item.get("subject") or "Notification ORIA"),
                    "htmlContent": str(item.get("html_content") or ""),
                    "textContent": str(item.get("text_content") or ""),
                },
                headers={
                    "api-key": key,
                    "accept": "application/json",
                    "content-type": "application/json",
                },
                timeout=15,
                allow_redirects=False,
            )
            if response.status_code in (200, 201, 202):
                body = response.json() if response.content else {}
                provider_message_id = str(body.get("messageId") or "")[:200] or None
                outcome, error_code = "sent", ""
            else:
                snippet = (response.text or "")[:600].lower()
                quota_error = response.status_code == 429 or (
                    response.status_code in (400, 403)
                    and any(term in snippet for term in ("daily", "quota", "limit", "rate"))
                )
                if quota_error:
                    outcome, error_code, retry_at = "retry", "brevo_daily_quota", _next_local_midnight()
                elif 400 <= response.status_code < 500:
                    outcome, error_code = "failed", f"brevo_http_{response.status_code}"
                else:
                    outcome, error_code = "retry", f"brevo_http_{response.status_code}"
        except requests.RequestException as exc:
            # Ne jamais loguer le corps d'e-mail ni l'adresse destinataire.
            outcome, error_code = "retry", type(exc).__name__[:80]
        except Exception as exc:
            outcome, error_code = "retry", type(exc).__name__[:80]
            logger.exception("ORIA Assistant email provider call failed; email_id=%s", email_id)

        try:
            final = _rpc(db, "oria_assistant_email_finish_v1", {
                "p_email_id": email_id,
                "p_lease_token": lease_token,
                "p_outcome": outcome,
                "p_error": error_code or None,
                "p_provider_message_id": provider_message_id,
                "p_retry_after": retry_at if outcome == "retry" else None,
            })
            if isinstance(final, list) and final:
                final = final[0]
            if not isinstance(final, dict) or final.get("success") is not True:
                logger.warning("ORIA Assistant email finalization not confirmed; email_id=%s", email_id)
            else:
                result[outcome] += 1
        except Exception:
            # Le bail est libéré par la prochaine récupération des envois bloqués.
            logger.exception("ORIA Assistant email queue finalization failed; email_id=%s", email_id)

    return result
