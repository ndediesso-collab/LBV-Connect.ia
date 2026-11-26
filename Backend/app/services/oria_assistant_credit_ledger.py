"""Owner-scoped credit-history enrichment for ORIA Assistant.

This module only annotates already persisted credit transactions. It never
creates, reserves, settles, refunds, or changes a credit amount.
"""
from __future__ import annotations

import logging
from typing import Any

logger = logging.getLogger("oria.assistant.credit_ledger")
META_TABLE = "oria_assistant_credit_usage_meta_v1"
BATCH_SIZE = 100


def _rows(data: Any) -> list[dict[str, Any]]:
    if isinstance(data, list):
        return [row for row in data if isinstance(row, dict)]
    if isinstance(data, dict):
        return [data]
    return []


def _chunks(values: list[str], size: int = BATCH_SIZE):
    for start in range(0, len(values), size):
        yield values[start : start + size]


def _as_metadata(row: dict[str, Any]) -> dict[str, Any]:
    return {
        "usage_source": "oria_assistant",
        "assistant_id": row.get("assistant_id"),
        "assistant_name": str(row.get("assistant_name") or "Assistant supprimé"),
        "business_name": str(row.get("business_name") or "Entreprise non renseignée"),
    }


def attach_usage_metadata(
    transactions: list[dict[str, Any]],
    metadata_by_run: dict[str, dict[str, Any]],
) -> list[dict[str, Any]]:
    """Pure helper used by the API and unit tests."""
    enriched: list[dict[str, Any]] = []
    for transaction in transactions:
        item = dict(transaction)
        reference_id = str(item.get("reference_id") or "")
        if item.get("transaction_type") == "usage" and reference_id in metadata_by_run:
            item.update(_as_metadata(metadata_by_run[reference_id]))
        enriched.append(item)
    return enriched


def _fetch_snapshot_rows(db: Any, owner_user_id: str, run_ids: list[str]) -> list[dict[str, Any]]:
    found: list[dict[str, Any]] = []
    for batch in _chunks(run_ids):
        response = (
            db.table(META_TABLE)
            .select("run_id,owner_user_id,assistant_id,business_name,assistant_name")
            .eq("owner_user_id", owner_user_id)
            .in_("run_id", batch)
            .execute()
        )
        found.extend(_rows(getattr(response, "data", None)))
    return found


def _fetch_legacy_run_rows(db: Any, owner_user_id: str, run_ids: list[str]) -> list[dict[str, Any]]:
    found: list[dict[str, Any]] = []
    for batch in _chunks(run_ids):
        response = (
            db.table("oria_assistant_runs")
            .select("id,owner_user_id,assistant_id,model,provider,actual_credits,settled_at")
            .eq("owner_user_id", owner_user_id)
            .in_("id", batch)
            .execute()
        )
        found.extend(_rows(getattr(response, "data", None)))
    return found


def _fetch_assistants(db: Any, owner_user_id: str, assistant_ids: list[str]) -> dict[str, dict[str, Any]]:
    by_id: dict[str, dict[str, Any]] = {}
    for batch in _chunks(assistant_ids):
        response = (
            db.table("oria_assistants")
            .select("id,owner_user_id,name,business_name")
            .eq("owner_user_id", owner_user_id)
            .in_("id", batch)
            .execute()
        )
        for assistant in _rows(getattr(response, "data", None)):
            assistant_id = str(assistant.get("id") or "")
            if assistant_id:
                by_id[assistant_id] = assistant
    return by_id


def enrich_credit_transactions(
    db: Any,
    owner_user_id: str,
    transactions: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    """Annotate the owner's existing ledger rows with assistant/company names.

    All database reads are owner-scoped. If the metadata table is not present
    yet, the function falls back to the already-existing runs/assistants tables.
    Any enrichment failure leaves the original credit history usable.
    """
    owner = str(owner_user_id or "")
    if not owner:
        return transactions
    run_ids = list(dict.fromkeys(
        str(item.get("reference_id"))
        for item in transactions
        if item.get("transaction_type") == "usage" and item.get("reference_id")
    ))
    if not run_ids:
        return transactions

    metadata_by_run: dict[str, dict[str, Any]] = {}
    try:
        for row in _fetch_snapshot_rows(db, owner, run_ids):
            run_id = str(row.get("run_id") or "")
            if run_id and str(row.get("owner_user_id") or "") == owner:
                metadata_by_run[run_id] = row
    except Exception:
        # Fallback keeps the old ledger endpoint compatible until migration runs.
        logger.info("ORIA Assistant credit snapshot table unavailable; using run records", exc_info=True)

    # If a snapshot was created before the owner filled in the company name,
    # enrich its still-empty label from the current owner-scoped assistant row.
    blank_company_assistant_ids = list(dict.fromkeys(
        str(row.get("assistant_id"))
        for row in metadata_by_run.values()
        if row.get("assistant_id") and not str(row.get("business_name") or "").strip()
    ))
    if blank_company_assistant_ids:
        try:
            current_assistants = _fetch_assistants(db, owner, blank_company_assistant_ids)
            for row in metadata_by_run.values():
                assistant_id = str(row.get("assistant_id") or "")
                current = current_assistants.get(assistant_id, {})
                if not str(row.get("business_name") or "").strip() and current.get("business_name"):
                    row["business_name"] = current["business_name"]
        except Exception:
            logger.info("Could not resolve current company labels for legacy assistant ledger rows", exc_info=True)

    missing = [run_id for run_id in run_ids if run_id not in metadata_by_run]
    if missing:
        try:
            runs = _fetch_legacy_run_rows(db, owner, missing)
            safe_runs = [
                row for row in runs
                if str(row.get("owner_user_id") or "") == owner
                and row.get("assistant_id")
            ]
            assistant_ids = list(dict.fromkeys(str(row["assistant_id"]) for row in safe_runs))
            assistants = _fetch_assistants(db, owner, assistant_ids)
            for run in safe_runs:
                run_id = str(run.get("id") or "")
                assistant = assistants.get(str(run.get("assistant_id") or ""), {})
                if run_id:
                    metadata_by_run[run_id] = {
                        "run_id": run_id,
                        "owner_user_id": owner,
                        "assistant_id": run.get("assistant_id"),
                        "assistant_name": assistant.get("name") or "Assistant supprimé",
                        "business_name": assistant.get("business_name") or "Entreprise non renseignée",
                    }
        except Exception:
            logger.warning("ORIA Assistant legacy credit enrichment failed", exc_info=True)

    return attach_usage_metadata(transactions, metadata_by_run)


def record_assistant_usage_metadata(
    db: Any,
    *,
    run_id: str,
    owner_user_id: str,
    assistant_id: str,
    assistant_name: str,
    business_name: str | None,
    credits: int,
) -> None:
    """Best-effort immutable snapshot after settlement; never affects billing."""
    amount = int(credits)
    if amount <= 0:
        return
    payload = {
        "run_id": str(run_id),
        "owner_user_id": str(owner_user_id),
        "assistant_id": str(assistant_id),
        "assistant_name": str(assistant_name or "Assistant")[:80],
        "business_name": str(business_name or "").strip()[:120],
        "credits": amount,
    }
    try:
        db.table(META_TABLE).upsert(
            payload, on_conflict="run_id", ignore_duplicates=True,
        ).execute()
    except Exception:
        # The settled response must never be rolled back or failed by a ledger label.
        logger.warning("ORIA Assistant usage metadata snapshot failed for run %s", run_id, exc_info=True)
