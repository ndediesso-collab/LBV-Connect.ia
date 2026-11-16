"""Durable, fail-closed reconciliation of ORIA free chat reservations.

The database receipt distinguishes 'reserved' (no provider call has started)
from 'started' (provider might have charged). Never auto-release 'started' or
'review'. 'metered' records trusted usage before calling the settle RPC.

This module uses the server's service-role Supabase client; no user request can
set a claimed cost, result or payment status.
"""
from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from typing import Any

from app.core.supabase import supabase
from app.services.free_tier_gateway import FreeTierGateway

LOG = logging.getLogger("oria.free.watchdog")
TABLE = "oria_free_generation_receipts"
NO_CALL_GRACE_SECONDS = 1200  # 20 minutes; SQL reservation TTL is 900s
UNCERTAIN_GRACE_SECONDS = 1200
SETTLEMENT_GRACE_SECONDS = 120


def _rows(query) -> list[dict[str, Any]]:
    value = query.execute().data or []
    if not isinstance(value, list):
        raise RuntimeError("Unexpected free generation receipt DB reply")
    return value


def _age_seconds(row: dict[str, Any]) -> float:
    stamp = str(row.get("updated_at") or row.get("created_at") or "")
    try:
        at = datetime.fromisoformat(stamp.replace("Z", "+00:00"))
        if at.tzinfo is None:
            return 0.0
        return max(0.0, (datetime.now(timezone.utc) - at).total_seconds())
    except (TypeError, ValueError):
        return 0.0


def receipt_for_message(user_id: str, message_id: str) -> dict[str, Any] | None:
    records = _rows(supabase.table(TABLE).select("*")
                    .eq("user_id", user_id).eq("input_message_id", message_id).limit(1))
    return records[0] if records else None


def _change(row: dict[str, Any], *, from_phases: tuple[str, ...],
            new_phase: str, other: dict[str, Any] | None = None) -> bool:
    values = {"phase": new_phase, "updated_at": datetime.now(timezone.utc).isoformat()}
    if other:
        values.update(other)
    result = _rows(supabase.table(TABLE).update(values)
                   .eq("input_message_id", str(row["input_message_id"]))
                   .eq("user_id", str(row["user_id"]))
                   .in_("phase", list(from_phases)))
    return len(result) == 1


def record_intent(*, uid: str, conversation_id: str, message_id: str,
                    reservation_id: str, provider: str, reserved_credits: int) -> None:
    if type(reserved_credits) is not int or reserved_credits <= 0:
        raise ValueError("Invalid reserved credits")
    _rows(supabase.table(TABLE).insert({
        "user_id": uid, "conversation_id": conversation_id,
        "input_message_id": message_id,
        "reservation_id": reservation_id,
        "provider": provider, "reserved_credits": reserved_credits,
        "phase": "intent",
    }))


def mark_reserved(uid: str, message_id: str) -> None:
    receipt = receipt_for_message(uid, message_id)
    if not receipt or not _change(receipt, from_phases=("intent",), new_phase="reserved"):
        raise RuntimeError("Cannot confirm reserved funds before provider")


def mark_provider_started(uid: str, message_id: str) -> None:
    receipt = receipt_for_message(uid, message_id)
    if not receipt or not _change(receipt, from_phases=("reserved",), new_phase="started"):
        raise RuntimeError("Cannot prove exclusive provider-start claim")


def record_metered(*, uid: str, message_id: str,
                   credits: int, api_xaf: Any, answer: str) -> None:
    cost = Decimal(str(api_xaf))
    if (type(credits) is not int or credits < 0 or not cost.is_finite()
            or cost < 0 or not isinstance(answer, str) or not answer.strip()
            or len(answer) > 100_000):
        raise ValueError("Invalid verified provider metering")
    receipt = receipt_for_message(uid, message_id)
    if not receipt or credits > int(receipt["reserved_credits"]):
        raise RuntimeError("Provider cost exceeds held reservation")
    if not _change(receipt, from_phases=("started", "review"), new_phase="metered", other={
        "measured_credits": credits, "measured_api_xaf": str(cost),
        "assistant_text": answer,
    }):
        raise RuntimeError("Cannot persist verified metering before settlement")


def mark_settlement_started(uid: str, message_id: str) -> None:
    receipt = receipt_for_message(uid, message_id)
    if not receipt or not _change(receipt, from_phases=("metered",), new_phase="settling"):
        raise RuntimeError("Cannot claim single settlement owner")


def mark_settled(uid: str, message_id: str) -> None:
    receipt = receipt_for_message(uid, message_id)
    if receipt and receipt["phase"] in ("settling", "settled"):
        _change(receipt, from_phases=("settling",), new_phase="settled")


def mark_uncertain(uid: str, message_id: str) -> None:
    try:
        receipt = receipt_for_message(uid, message_id)
        if receipt and receipt["phase"] == "started":
            _change(receipt, from_phases=("started",), new_phase="review")
    except Exception:
        LOG.exception("Cannot mark uncertain free provider outcome")


def mark_no_call_aborted(uid: str, message_id: str) -> None:
    try:
        receipt = receipt_for_message(uid, message_id)
        if receipt:
            _change(receipt, from_phases=("intent", "reserved", "started"), new_phase="releasing")
    except Exception:
        LOG.exception("Cannot mark free no-call abort")


def _reservation_status(uid: str, rid: str) -> str:
    records = _rows(supabase.table("oria_free_credit_reservations")
                    .select("status").eq("id", rid).eq("user_id", uid).limit(1))
    return str(records[0]["status"]) if len(records) == 1 else "unknown"


def confirm_reserved(uid: str, reservation_id: str) -> bool:
    """Never start a provider call unless the reservation is confirmed in DB."""
    return _reservation_status(uid, reservation_id) == "reserved"


def confirm_settled(uid: str, reservation_id: str) -> bool:
    """Supabase status is authoritative; a successful HTTP reply alone is not."""
    return _reservation_status(uid, reservation_id) in ("settled", "completed")


def _reconcile_one(receipt: dict[str, Any]) -> str:
    uid = str(receipt["user_id"])
    rid = str(receipt["reservation_id"])
    phase = str(receipt["phase"])
    age = _age_seconds(receipt)
    gateway = FreeTierGateway(supabase)
    if phase == "intent" and age >= NO_CALL_GRACE_SECONDS:
        # Reservation RPC may have committed even if the worker died before
        # receiving its reply. No provider call can follow from intent.
        if not _change(receipt, from_phases=("intent",), new_phase="releasing"):
            return "changed_by_other_worker"
        phase = "releasing"
    if phase == "reserved" and age >= NO_CALL_GRACE_SECONDS:
        # The provider cannot be called unless started phase was durably
        # confirmed first. Atomic claim prevents races with a live request.
        if not _change(receipt, from_phases=("reserved",), new_phase="releasing"):
            return "changed_by_other_worker"
        phase = "releasing"
    if phase == "releasing":
        state = _reservation_status(uid, rid)
        if state in ("unknown", "released", "cancelled"):
            _change(receipt, from_phases=("releasing",), new_phase="released")
            return "already_released"
        if state != "reserved":
            return "release_manual_review"
        # Safe only for a receipt proven never to have reached provider.
        gateway.release_if_definite_failure(uid, rid)
        confirmed = _reservation_status(uid, rid)
        if confirmed in ("released", "cancelled"):
            _change(receipt, from_phases=("releasing",), new_phase="released")
            return "released"
        return "release_not_confirmed"
    if phase in ("metered", "settling"):
        credits = receipt.get("measured_credits")
        api_xaf = receipt.get("measured_api_xaf")
        if type(credits) is not int or api_xaf is None:
            return "metering_incomplete_review"
        state = _reservation_status(uid, rid)
        if state in ("settled", "completed"):
            _change(receipt, from_phases=("metered", "settling"), new_phase="settled")
            return "already_settled"
        if state != "reserved":
            return "metering_manual_review"
        if phase == "settling":
            # The settle RPC was already sent; without its SQL definition we
            # cannot assume retry-idempotence. NEVER send it a second time.
            if age >= SETTLEMENT_GRACE_SECONDS:
                LOG.error("Unconfirmed settle RPC; manual DB verification required reservation=%s", rid)
                return "settle_rpc_uncertain"
            return "settlement_in_progress"
        if age < SETTLEMENT_GRACE_SECONDS:
            return "metered_awaiting_original_worker"
        # The first worker cannot settle unless it claims metered->settling.
        if not _change(receipt, from_phases=("metered",), new_phase="settling"):
            return "settlement_claimed_elsewhere"
        gateway.settle(uid, rid, credits, api_xaf)
        confirmed = _reservation_status(uid, rid)
        if confirmed in ("settled", "completed"):
            _change(receipt, from_phases=("settling",), new_phase="settled")
            return "settled"
        return "settlement_unconfirmed"
    if phase == "started" and age >= UNCERTAIN_GRACE_SECONDS:
        # Never refund an upstream call with unknown financial outcome.
        if _change(receipt, from_phases=("started",), new_phase="review"):
            LOG.error("ORIA free generation requires supplier reconciliation: reservation=%s", rid)
            return "review_supplier_outcome"
    return "unchanged"


def reconcile_user(uid: str, *, message_id: str | None = None) -> list[str]:
    query = supabase.table(TABLE).select("*").eq("user_id", uid)
    if message_id:
        query = query.eq("input_message_id", message_id)
    records = _rows(query.in_("phase", ["intent", "reserved", "started", "review", "metered", "settling", "releasing"])
                    .order("created_at", desc=False).limit(30))
    results = []
    for receipt in records:
        try:
            results.append(_reconcile_one(receipt))
        except Exception:
            LOG.exception("Free reservation reconciliation failed id=%s", receipt.get("reservation_id"))
            results.append("reconciliation_error")
    return results


def reconcile_stale_global(*, limit: int = 80) -> dict[str, int]:
    threshold = (datetime.now(timezone.utc) - timedelta(seconds=NO_CALL_GRACE_SECONDS)).isoformat()
    old = _rows(supabase.table(TABLE).select("user_id,input_message_id,phase,updated_at")
                .in_("phase", ["intent", "reserved", "started", "metered", "settling", "releasing"])
                .lt("updated_at", threshold).order("updated_at", desc=False).limit(limit))
    users = {str(item["user_id"]) for item in old}
    counts = {"users": len(users), "flagged": 0}
    for uid in users:
        outcomes = reconcile_user(uid)
        counts["flagged"] += sum(x in ("review_supplier_outcome", "reconciliation_error") for x in outcomes)
    return counts


def recover_metered_response(uid: str, message_id: str) -> str | None:
    row = receipt_for_message(uid, message_id)
    if not row or row.get("phase") not in ("metered", "settled"):
        return None
    if row["phase"] == "metered":
        reconcile_user(uid, message_id=message_id)
        row = receipt_for_message(uid, message_id)
    if row and row.get("phase") == "settled" and isinstance(row.get("assistant_text"), str):
        return str(row["assistant_text"])
    return None
