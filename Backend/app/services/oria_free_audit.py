"""Journal idempotent des COUTS CONFIRMES de ORIA gratuit.

Le debit appartient uniquement a oria_free_settle, jamais a cette fonction.
"""
from __future__ import annotations
import logging
from decimal import Decimal
from uuid import UUID

log = logging.getLogger(__name__)
ACTIONS = frozenset(("chat_luna", "free_pdf_luna", "free_docx_luna", "free_image_recraft"))


def record_free_usage(client, *, user_id: str, reservation_id: str,
                      action: str, credits: int, api_xaf) -> bool:
    if action not in ACTIONS or type(credits) is not int or credits < 0:
        return False
    try:
        uid = str(UUID(str(user_id)))
        rid = str(UUID(str(reservation_id)))
        xaf = Decimal(str(api_xaf))
        if not xaf.is_finite() or xaf < 0:
            return False
        payload = dict(id=rid, user_id=uid, action=action,
                       charged_credits=credits, actual_api_xaf=str(xaf))
        try:
            client.table("oria_free_usage_events").insert(payload).execute()
        except Exception:
            rows = (client.table("oria_free_usage_events").select("user_id,action,charged_credits,actual_api_xaf")
                    .eq("id", rid).eq("user_id", uid).limit(1).execute().data or [])
            if not rows:
                raise
            row = rows[0]
            if (row.get("action") != action or row.get("charged_credits") != credits
                    or Decimal(str(row.get("actual_api_xaf"))) != xaf):
                log.error("ORIA free audit conflict existing reservation=%s", rid)
                return False
        return True
    except Exception as exc:
        # Le debit est deja regle. Pas de retry du fournisseur ni double debit.
        log.warning("ORIA free audit deferred reservation=%s type=%s",
                    reservation_id, type(exc).__name__)
        return False
