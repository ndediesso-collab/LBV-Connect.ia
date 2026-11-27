"""ORIA Assistant — déterministic commercial analytics and shared-engine reports.

All numerical truth is computed in Python from owner-scoped persisted records.
Only aggregate values and sanitized keyword frequencies are sent to the AI engine.
"""
from __future__ import annotations

import json
import logging
import re
from collections import Counter, defaultdict
from datetime import date, datetime, time, timedelta, timezone
from decimal import Decimal, InvalidOperation
from typing import Any, Mapping
from uuid import UUID, uuid4
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from fastapi import HTTPException

from app.core.supabase import supabase

logger = logging.getLogger("oria.assistant.commercial")
PAGE_SIZE = 1000
REQUEST_STATUSES = ("new", "in_progress", "treated", "cancelled")
SALE_OUTCOMES = ("open", "won", "lost")
_EMAIL_RE = re.compile(r"\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b", re.I)
_PHONE_RE = re.compile(r"(?<!\w)(?:\+?\d[\d\s()./-]{5,}\d)(?!\w)")
_LONG_NUMBER_RE = re.compile(r"\b\d{7,}\b")
_WORD_RE = re.compile(r"[^\W\d_]{3,}", re.UNICODE)
_STOPWORDS = frozenset({
    "avec", "pour", "dans", "des", "les", "une", "aux", "est", "sur", "par", "que",
    "qui", "quoi", "comment", "quel", "quelle", "quels", "quelles", "mon", "ma", "mes",
    "son", "sa", "ses", "notre", "votre", "leurs", "leur", "mais", "donc", "plus",
    "moins", "pas", "depuis", "bonjour", "merci", "demande", "client", "clients", "souhaite",
    "voudrais", "veux", "avoir", "faire", "etre", "être", "avoir", "entreprise", "assistant",
})


def _rows(data: Any) -> list[dict[str, Any]]:
    if isinstance(data, list):
        return [row for row in data if isinstance(row, dict)]
    return [data] if isinstance(data, dict) else []


def _first(data: Any) -> dict[str, Any] | None:
    items = _rows(data)
    return items[0] if items else None


def _uuid(value: str | None, label: str) -> str | None:
    if value is None:
        return None
    try:
        return str(UUID(str(value)))
    except (ValueError, TypeError, AttributeError) as exc:
        raise HTTPException(422, f"Identifiant {label} invalide.") from exc


def _decimal(value: Any) -> Decimal:
    if value is None or value == "":
        return Decimal("0")
    try:
        number = Decimal(str(value))
        return number if number.is_finite() else Decimal("0")
    except (InvalidOperation, ValueError, TypeError):
        return Decimal("0")


def _money(value: Decimal) -> str:
    return format(value.quantize(Decimal("0.01")), "f")


def _rate(numerator: int, denominator: int) -> float | None:
    if denominator <= 0:
        return None
    return round((numerator / denominator) * 100, 2)


def _period_bounds(start: date, end: date, timezone_name: str) -> tuple[datetime, datetime, ZoneInfo]:
    if end < start:
        raise HTTPException(422, "La date de fin doit être égale ou postérieure à la date de début.")
    try:
        zone = ZoneInfo(timezone_name)
    except (ZoneInfoNotFoundError, ValueError):
        raise HTTPException(409, "Le fuseau horaire de cet assistant est invalide.") from None
    local_start = datetime.combine(start, time.min, tzinfo=zone)
    local_end_exclusive = datetime.combine(end + timedelta(days=1), time.min, tzinfo=zone)
    return local_start.astimezone(timezone.utc), local_end_exclusive.astimezone(timezone.utc), zone


def _fetch_timestamp_rows(
    table_name: str, columns: str, owner_user_id: str, assistant_id: str,
    start_utc: datetime, end_utc: datetime, *, assistant_column: bool = True,
) -> list[dict[str, Any]]:
    collected: list[dict[str, Any]] = []
    offset = 0
    while True:
        try:
            query = supabase.table(table_name).select(columns).eq("owner_user_id", owner_user_id)
            if assistant_column:
                query = query.eq("assistant_id", assistant_id)
            query = (query.gte("created_at", start_utc.isoformat())
                     .lt("created_at", end_utc.isoformat())
                     .order("created_at", desc=False).order("id", desc=False)
                     .range(offset, offset + PAGE_SIZE - 1))
            response = query.execute()
        except Exception as exc:
            logger.exception("Commercial analytics query failed: %s", table_name)
            raise HTTPException(503, f"Impossible de récupérer les données commerciales ({table_name}).") from exc
        page = _rows(getattr(response, "data", None))
        collected.extend(page)
        if len(page) < PAGE_SIZE:
            break
        offset += PAGE_SIZE
    return collected


def _fetch_sales_rows(
    owner_user_id: str, assistant_id: str, start: date, end: date,
    start_utc: datetime, end_utc: datetime,
) -> list[dict[str, Any]]:
    """Fetch both sales dated in the period and opportunities created in it; de-duplicate by id."""
    by_id: dict[str, dict[str, Any]] = {}
    queries = (
        ("sale_date", start.isoformat(), end.isoformat(), False),
        ("created_at", start_utc.isoformat(), end_utc.isoformat(), True),
    )
    for field, lower, upper, exclusive in queries:
        offset = 0
        while True:
            try:
                query = (
                    supabase.table("oria_assistant_sales").select(
                        "id,owner_user_id,assistant_id,request_id,outcome,product_or_service,"
                        "quoted_amount,collected_amount,currency,sale_date,created_at,updated_at"
                    ).eq("owner_user_id", owner_user_id).eq("assistant_id", assistant_id)
                    .gte(field, lower)
                )
                query = query.lt(field, upper) if exclusive else query.lte(field, upper)
                response = query.order("id", desc=False).range(offset, offset + PAGE_SIZE - 1).execute()
            except Exception as exc:
                logger.exception("Commercial sales query failed")
                raise HTTPException(503, "Impossible de récupérer les ventes commerciales.") from exc
            page = _rows(getattr(response, "data", None))
            for row in page:
                if row.get("id"):
                    by_id[str(row["id"])] = row
            if len(page) < PAGE_SIZE:
                break
            offset += PAGE_SIZE
    # A sale with a declared sale_date is attributed to that date; open/unsold
    # opportunities without a sale date are attributed to their creation date.
    kept = []
    for row in by_id.values():
        raw_date = row.get("sale_date") if row.get("outcome") == "won" else None
        raw_date = raw_date or str(row.get("created_at") or "")[:10]
        try:
            attributed = date.fromisoformat(str(raw_date))
        except ValueError:
            continue
        if start <= attributed <= end:
            kept.append(row)
    return kept


def _fetch_sales_for_requests(
    owner_user_id: str, assistant_id: str, request_ids: list[str],
) -> list[dict[str, Any]]:
    """Load current outcomes for this period's requests, even when entered later."""
    collected: dict[str, dict[str, Any]] = {}
    for chunk_start in range(0, len(request_ids), 100):
        chunk = request_ids[chunk_start:chunk_start + 100]
        offset = 0
        while chunk:
            try:
                response = (
                    supabase.table("oria_assistant_sales").select(
                        "id,owner_user_id,assistant_id,request_id,outcome,quoted_amount,"
                        "collected_amount,currency,sale_date,created_at,updated_at"
                    ).eq("owner_user_id", owner_user_id).eq("assistant_id", assistant_id)
                    .in_("request_id", chunk).order("id", desc=False)
                    .range(offset, offset + PAGE_SIZE - 1).execute()
                )
            except Exception as exc:
                logger.exception("Commercial request outcome query failed")
                raise HTTPException(503, "Impossible de récupérer les résultats des demandes.") from exc
            page = _rows(getattr(response, "data", None))
            for row in page:
                if row.get("id"):
                    collected[str(row["id"])] = row
            if len(page) < PAGE_SIZE:
                break
            offset += PAGE_SIZE
    return list(collected.values())



def _fetch_assistant_messages(
    owner_user_id: str, conversation_ids: list[str], start_utc: datetime, end_utc: datetime,
) -> list[dict[str, Any]]:
    """Messages are scoped through owner-owned conversations; the messages table has no assistant_id."""
    collected: list[dict[str, Any]] = []
    # Keep PostgREST IN clauses small and avoid relying on a non-existent messages.assistant_id column.
    for chunk_start in range(0, len(conversation_ids), 100):
        chunk = conversation_ids[chunk_start:chunk_start + 100]
        offset = 0
        while chunk:
            try:
                response = (
                    supabase.table("oria_assistant_messages")
                    .select("id,conversation_id,role,run_id,created_at")
                    .eq("owner_user_id", owner_user_id).in_("conversation_id", chunk)
                    .gte("created_at", start_utc.isoformat()).lt("created_at", end_utc.isoformat())
                    .order("created_at", desc=False).order("id", desc=False)
                    .range(offset, offset + PAGE_SIZE - 1).execute()
                )
            except Exception as exc:
                logger.exception("Commercial messages query failed")
                raise HTTPException(503, "Impossible de récupérer les messages commerciaux.") from exc
            page = _rows(getattr(response, "data", None))
            collected.extend(page)
            if len(page) < PAGE_SIZE:
                break
            offset += PAGE_SIZE
    return collected


def _sanitize_summary(text: Any, customer_names: list[str]) -> str:
    """Remove known customer identifiers and common direct identifiers before aggregation."""
    value = str(text or "")[:2000]
    # Strip structured contact identifiers before removing known customer names,
    # so a name appearing inside an e-mail cannot leave a partial address behind.
    value = _EMAIL_RE.sub(" ", value)
    value = _PHONE_RE.sub(" ", value)
    value = _LONG_NUMBER_RE.sub(" ", value)
    for name in customer_names:
        cleaned = str(name or "").strip()
        if not cleaned:
            continue
        candidates = [cleaned, *re.split(r"\s+", cleaned)]
        for candidate in candidates:
            candidate = candidate.strip(" .,_-:/")
            if len(candidate) >= 3:
                value = re.sub(rf"(?<![\w]){re.escape(candidate)}(?![\w])", " ", value, flags=re.I)
    return value.lower()


def _extract_themes(requests: list[dict[str, Any]]) -> list[dict[str, Any]]:
    counts: Counter[str] = Counter()
    names = [str(row.get("customer_name") or "") for row in requests]
    for row in requests:
        safe = _sanitize_summary(row.get("summary"), names)
        for word in _WORD_RE.findall(safe):
            if word not in _STOPWORDS and not word.isdigit():
                counts[word] += 1
    return [{"theme": word, "mentions": count} for word, count in counts.most_common(15)]


def _contact_metrics(requests: list[dict[str, Any]]) -> dict[str, Any]:
    names = sum(bool(str(row.get("customer_name") or "").strip()) for row in requests)
    phones = [str(row.get("customer_phone") or "").strip() for row in requests]
    emails = [str(row.get("customer_email") or "").strip() for row in requests]
    provided_phones = [phone for phone in phones if phone]
    valid_phones = [
        phone for phone in provided_phones
        if re.fullmatch(r"[0-9+().\s/-]+", phone)
        and 7 <= len(re.sub(r"\D", "", phone)) <= 15
    ]
    valid_emails = [email for email in emails if email and _EMAIL_RE.fullmatch(email)]
    # A non-empty but malformed phone/email is not an exploitable contact method.
    methods = sum(
        bool(phone and re.fullmatch(r"[0-9+().\s/-]+", phone)
             and 7 <= len(re.sub(r"\D", "", phone)) <= 15)
        or bool(email and _EMAIL_RE.fullmatch(email))
        for phone, email in zip(phones, emails)
    )
    return {
        "with_name": names,
        "with_phone": len(provided_phones),
        "with_email": sum(bool(email) for email in emails),
        "valid_phone_count": len(valid_phones),
        "valid_phone_rate": _rate(len(valid_phones), len(provided_phones)),
        "with_at_least_one_contact_method": methods,
        "contact_method_rate": _rate(methods, len(requests)),
        "valid_email_count": len(valid_emails),
    }


def _aggregate_one_assistant(
    owner_user_id: str, assistant: dict[str, Any], start: date, end: date,
) -> dict[str, Any]:
    assistant_id = str(assistant["id"])
    timezone_name = str(assistant.get("timezone") or "Africa/Libreville")
    start_utc, end_utc, zone = _period_bounds(start, end, timezone_name)

    conversations = _fetch_timestamp_rows(
        "oria_assistant_conversations", "id,assistant_id,created_at", owner_user_id,
        assistant_id, start_utc, end_utc,
    )
    conversation_ids = [str(row["id"]) for row in conversations if row.get("id")]
    messages = _fetch_assistant_messages(owner_user_id, conversation_ids, start_utc, end_utc)
    runs = _fetch_timestamp_rows(
        "oria_assistant_runs",
        "id,assistant_id,conversation_id,status,provider,model,actual_credits,"
        "actual_api_cost_xaf,total_cost_usd,usage,created_at,settled_at",
        owner_user_id, assistant_id, start_utc, end_utc,
    )
    requests = _fetch_timestamp_rows(
        "oria_assistant_requests",
        "id,assistant_id,conversation_id,request_type,summary,customer_name,customer_phone,"
        "customer_email,status,created_at",
        owner_user_id, assistant_id, start_utc, end_utc,
    )
    sales = _fetch_sales_rows(owner_user_id, assistant_id, start, end, start_utc, end_utc)

    completed_runs = [row for row in runs if row.get("status") == "completed"]
    visitor_messages = [row for row in messages if row.get("role") == "user"]
    assistant_messages = [row for row in messages if row.get("role") == "assistant" and row.get("run_id")]
    technical_confirmations = [row for row in messages if row.get("role") == "assistant" and not row.get("run_id")]
    request_conversation_ids = {
        str(row.get("conversation_id")) for row in requests if row.get("conversation_id")
    }
    status_counts = {status: sum(row.get("status") == status for row in requests) for status in REQUEST_STATUSES}
    customer_names = [str(row.get("customer_name") or "") for row in requests]
    type_counts: Counter[str] = Counter()
    for row in requests:
        safe_type = " ".join(_sanitize_summary(row.get("request_type"), customer_names).split()).strip(" -–—:;/,")[:120]
        type_counts[safe_type or "Autre"] += 1
    request_ids = [str(row["id"]) for row in requests if row.get("id")]
    request_outcomes = _fetch_sales_for_requests(owner_user_id, assistant_id, request_ids)
    tracked_request_outcomes = [row for row in request_outcomes if row.get("outcome") in SALE_OUTCOMES]

    currencies: dict[str, dict[str, Any]] = {}
    mutable: dict[str, dict[str, Any]] = defaultdict(lambda: {
        "sales_won": 0, "sales_lost": 0, "opportunities_open": 0,
        "quoted_total": Decimal("0"), "collected_total": Decimal("0"),
        "outstanding_total": Decimal("0"), "won_quoted": Decimal("0"),
        "won_collected": Decimal("0"), "won_quote_count": 0, "won_collected_count": 0,
    })
    for row in sales:
        currency = str(row.get("currency") or "XAF").upper()
        bucket = mutable[currency]
        outcome = row.get("outcome")
        if outcome == "won": bucket["sales_won"] += 1
        elif outcome == "lost": bucket["sales_lost"] += 1
        elif outcome == "open": bucket["opportunities_open"] += 1
        quoted = _decimal(row.get("quoted_amount"))
        collected = _decimal(row.get("collected_amount"))
        bucket["quoted_total"] += quoted
        bucket["collected_total"] += collected
        if outcome in {"open", "won"}:
            bucket["outstanding_total"] += max(Decimal("0"), quoted - collected)
        if outcome == "won":
            if row.get("quoted_amount") is not None:
                bucket["won_quoted"] += quoted
                bucket["won_quote_count"] += 1
            bucket["won_collected"] += collected
            bucket["won_collected_count"] += 1

    for currency, bucket in mutable.items():
        tracked = bucket["sales_won"] + bucket["sales_lost"] + bucket["opportunities_open"]
        currencies[currency] = {
            "sales_won": bucket["sales_won"],
            "sales_lost": bucket["sales_lost"],
            "opportunities_open": bucket["opportunities_open"],
            "tracked_request_outcomes": tracked,
            "quoted_total": _money(bucket["quoted_total"]),
            "collected_total": _money(bucket["collected_total"]),
            "outstanding_total": _money(bucket["outstanding_total"]),
            "average_won_quoted": _money(bucket["won_quoted"] / bucket["won_quote_count"]) if bucket["won_quote_count"] else None,
            "average_won_collected": _money(bucket["won_collected"] / bucket["won_collected_count"]) if bucket["won_collected_count"] else None,
            "won_quote_count": bucket["won_quote_count"],
            "won_collected_count": bucket["won_collected_count"],
        }

    daily: dict[str, dict[str, int]] = defaultdict(lambda: {"conversations": 0, "confirmed_requests": 0})
    for row in conversations:
        try: key = datetime.fromisoformat(str(row["created_at"]).replace("Z", "+00:00")).astimezone(zone).date().isoformat()
        except Exception: continue
        daily[key]["conversations"] += 1
    for row in requests:
        try: key = datetime.fromisoformat(str(row["created_at"]).replace("Z", "+00:00")).astimezone(zone).date().isoformat()
        except Exception: continue
        daily[key]["confirmed_requests"] += 1

    return {
        "assistant": {"id": assistant_id, "name": str(assistant.get("name") or "Assistant"), "timezone": timezone_name},
        "activity": {
            "conversations_initiated": len(conversations),
            "completed_ai_responses": len(completed_runs),
            "messages_exchanged": len(messages),
            "visitor_messages": len(visitor_messages),
            "ai_messages": len(assistant_messages),
            "technical_confirmations": len(technical_confirmations),
        },
        "leads": {
            "confirmed_requests": len(requests),
            "conversations_with_confirmed_request": len(request_conversation_ids),
            "conversation_to_request_rate": _rate(len(request_conversation_ids), len(conversations)),
            "pipeline": status_counts,
            "contact_quality": _contact_metrics(requests),
            "by_type": [{"request_type": key, "count": value} for key, value in type_counts.most_common()],
            "themes": _extract_themes(requests),
            "open_or_pending_requests": status_counts.get("new", 0) + status_counts.get("in_progress", 0),
        },
        "sales": {
            "tracked_requests": len(tracked_request_outcomes),
            "won_tracked_requests": sum(row.get("outcome") == "won" for row in tracked_request_outcomes),
            "untracked_confirmed_requests": max(0, len(requests) - len(tracked_request_outcomes)),
            "financial_records_in_period": len(sales),
            "by_currency": currencies,
            "sales_conversion_rate_tracked_only": _rate(
                sum(row.get("outcome") == "won" for row in tracked_request_outcomes),
                len(tracked_request_outcomes),
            ),
            "conversion_denominator": (
                "Demandes de la période ayant un résultat commercial renseigné au moment du bilan"
            ),
        },
        "usage": {
            "consumed_credits": sum(int(_decimal(row.get("actual_credits"))) for row in completed_runs),
            "actual_api_cost_xaf": _money(sum((_decimal(row.get("actual_api_cost_xaf")) for row in completed_runs), Decimal("0")))
                if all(row.get("actual_api_cost_xaf") is not None for row in completed_runs) and completed_runs else None,
            "api_cost_available_runs": sum(row.get("actual_api_cost_xaf") is not None for row in completed_runs),
            "api_cost_missing_runs": sum(row.get("actual_api_cost_xaf") is None for row in completed_runs),
        },
        "trends": [{"date": day, **daily[day]} for day in sorted(daily)],
    }


def _merge_currency_buckets(items: list[dict[str, Any]]) -> dict[str, dict[str, Any]]:
    merged: dict[str, dict[str, Any]] = {}
    keys_decimal = ("quoted_total", "collected_total", "outstanding_total")
    for item in items:
        for currency, bucket in item.get("sales", {}).get("by_currency", {}).items():
            target = merged.setdefault(currency, {
                "sales_won": 0, "sales_lost": 0, "opportunities_open": 0,
                "tracked_request_outcomes": 0, "quoted_total": Decimal("0"),
                "collected_total": Decimal("0"), "outstanding_total": Decimal("0"),
                "_won_quote_total": Decimal("0"), "_won_quote_count": 0,
                "_won_collected_total": Decimal("0"), "_won_collected_count": 0,
            })
            for key in ("sales_won", "sales_lost", "opportunities_open", "tracked_request_outcomes"):
                target[key] += int(bucket.get(key) or 0)
            for key in keys_decimal:
                target[key] += _decimal(bucket.get(key))
            if bucket.get("average_won_quoted") is not None:
                count = int(bucket.get("won_quote_count") or 0)
                target["_won_quote_total"] += _decimal(bucket["average_won_quoted"]) * count
                target["_won_quote_count"] += count
            if bucket.get("average_won_collected") is not None:
                count = int(bucket.get("won_collected_count") or 0)
                target["_won_collected_total"] += _decimal(bucket["average_won_collected"]) * count
                target["_won_collected_count"] += count
    result: dict[str, dict[str, Any]] = {}
    for currency, bucket in merged.items():
        result[currency] = {
            key: bucket[key] for key in ("sales_won", "sales_lost", "opportunities_open", "tracked_request_outcomes")
        }
        for key in keys_decimal:
            result[currency][key] = _money(bucket[key])
        result[currency]["average_won_quoted"] = _money(bucket["_won_quote_total"] / bucket["_won_quote_count"]) if bucket["_won_quote_count"] else None
        result[currency]["average_won_collected"] = _money(bucket["_won_collected_total"] / bucket["_won_collected_count"]) if bucket["_won_collected_count"] else None
    return result


def _merge_summaries(items: list[dict[str, Any]], start: date, end: date) -> dict[str, Any]:
    if not items:
        return {
            "period": {"start": start.isoformat(), "end": end.isoformat(), "timezone": "aucun assistant"},
            "activity": {"conversations_initiated": 0, "completed_ai_responses": 0, "messages_exchanged": 0, "visitor_messages": 0, "ai_messages": 0, "technical_confirmations": 0},
            "leads": {"confirmed_requests": 0, "conversations_with_confirmed_request": 0, "conversation_to_request_rate": None, "pipeline": {key: 0 for key in REQUEST_STATUSES}, "contact_quality": _contact_metrics([]), "by_type": [], "themes": [], "open_or_pending_requests": 0},
            "sales": {"tracked_requests": 0, "won_tracked_requests": 0, "untracked_confirmed_requests": 0, "financial_records_in_period": 0, "by_currency": {}, "sales_conversion_rate_tracked_only": None, "conversion_denominator": "Demandes de la période ayant un résultat commercial renseigné au moment du bilan"},
            "usage": {"consumed_credits": 0, "actual_api_cost_xaf": None, "api_cost_available_runs": 0, "api_cost_missing_runs": 0},
            "trends": [], "assistants_included": 0,
        }
    total_activity = {key: sum(item["activity"].get(key, 0) for item in items) for key in items[0]["activity"]}
    total_requests = sum(item["leads"]["confirmed_requests"] for item in items)
    conv_with_request = sum(item["leads"]["conversations_with_confirmed_request"] for item in items)
    pipeline = {key: sum(item["leads"]["pipeline"].get(key, 0) for item in items) for key in REQUEST_STATUSES}
    contact_counts = {key: sum(item["leads"]["contact_quality"].get(key, 0) for item in items) for key in (
        "with_name", "with_phone", "with_email", "valid_phone_count", "with_at_least_one_contact_method", "valid_email_count",
    )}
    with_phone = contact_counts["with_phone"]
    contact_counts["valid_phone_rate"] = _rate(contact_counts["valid_phone_count"], with_phone)
    contact_counts["contact_method_rate"] = _rate(contact_counts["with_at_least_one_contact_method"], total_requests)
    type_counter: Counter[str] = Counter()
    theme_counter: Counter[str] = Counter()
    trend_map: dict[str, dict[str, int]] = defaultdict(lambda: {"conversations": 0, "confirmed_requests": 0})
    for item in items:
        for row in item["leads"]["by_type"]: type_counter[row["request_type"]] += row["count"]
        for row in item["leads"]["themes"]: theme_counter[row["theme"]] += row["mentions"]
        for row in item["trends"]:
            trend_map[row["date"]]["conversations"] += row["conversations"]
            trend_map[row["date"]]["confirmed_requests"] += row["confirmed_requests"]
    completed = sum(item["usage"]["api_cost_available_runs"] for item in items)
    missing = sum(item["usage"]["api_cost_missing_runs"] for item in items)
    cost_sum = sum((_decimal(item["usage"].get("actual_api_cost_xaf")) for item in items), Decimal("0"))
    sales = [row for row in items]
    tracked = sum(item["sales"]["tracked_requests"] for item in sales)
    won = sum(item["sales"].get("won_tracked_requests", 0) for item in sales)
    financial_records = sum(item["sales"].get("financial_records_in_period", 0) for item in sales)
    usage = {"consumed_credits": sum(item["usage"]["consumed_credits"] for item in items),
             "actual_api_cost_xaf": _money(cost_sum) if completed > 0 and missing == 0 else None,
             "api_cost_available_runs": completed, "api_cost_missing_runs": missing}
    return {
        "period": {
            "start": start.isoformat(), "end": end.isoformat(),
            "timezone": (str(items[0]["assistant"].get("timezone") or "Africa/Libreville")
                         if len(items) == 1 else "fuseau de chaque assistant"),
        },
        "activity": total_activity,
        "leads": {
            "confirmed_requests": total_requests,
            "conversations_with_confirmed_request": conv_with_request,
            "conversation_to_request_rate": _rate(conv_with_request, total_activity["conversations_initiated"]),
            "pipeline": pipeline, "contact_quality": contact_counts,
            "by_type": [{"request_type": k, "count": v} for k, v in type_counter.most_common()],
            "themes": [{"theme": k, "mentions": v} for k, v in theme_counter.most_common(15)],
            "open_or_pending_requests": pipeline["new"] + pipeline["in_progress"],
        },
        "sales": {
            "tracked_requests": tracked,
            "won_tracked_requests": won,
            "untracked_confirmed_requests": sum(item["sales"]["untracked_confirmed_requests"] for item in sales),
            "financial_records_in_period": financial_records,
            "by_currency": _merge_currency_buckets(items),
            "sales_conversion_rate_tracked_only": _rate(won, tracked),
            "conversion_denominator": "Demandes de la période ayant un résultat commercial renseigné au moment du bilan",
        },
        "usage": usage,
        "trends": [{"date": day, **trend_map[day]} for day in sorted(trend_map)],
        "assistants_included": len(items),
    }


def _comparison(current: dict[str, Any], previous: dict[str, Any]) -> dict[str, Any]:
    fields = (
        ("conversations_initiated", "activity"),
        ("completed_ai_responses", "activity"),
        ("confirmed_requests", "leads"),
        ("conversations_with_confirmed_request", "leads"),
        ("tracked_requests", "sales"),
        ("won_tracked_requests", "sales"),
        ("financial_records_in_period", "sales"),
    )
    result: dict[str, Any] = {"previous_period": previous["period"], "metrics": {}, "financial_by_currency": {}}
    for metric, group in fields:
        current_value = int(current[group].get(metric) or 0)
        previous_value = int(previous[group].get(metric) or 0)
        result["metrics"][metric] = {
            "current": current_value, "previous": previous_value,
            "absolute_change": current_value - previous_value,
            "percentage_change": round((current_value - previous_value) / previous_value * 100, 2) if previous_value else None,
        }

    # Finance comparisons remain separated by ISO currency; never sum XAF and USD.
    current_currencies = current.get("sales", {}).get("by_currency", {})
    previous_currencies = previous.get("sales", {}).get("by_currency", {})
    monetary_fields = ("quoted_total", "collected_total", "outstanding_total")
    count_fields = ("sales_won", "sales_lost", "opportunities_open")
    for currency in sorted(set(current_currencies) | set(previous_currencies)):
        now = current_currencies.get(currency, {})
        before = previous_currencies.get(currency, {})
        currency_result: dict[str, Any] = {"counts": {}, "amounts": {}}
        for metric in count_fields:
            current_value = int(now.get(metric) or 0)
            previous_value = int(before.get(metric) or 0)
            currency_result["counts"][metric] = {
                "current": current_value, "previous": previous_value,
                "absolute_change": current_value - previous_value,
                "percentage_change": round((current_value - previous_value) / previous_value * 100, 2) if previous_value else None,
            }
        for metric in monetary_fields:
            current_value = _decimal(now.get(metric))
            previous_value = _decimal(before.get(metric))
            change = current_value - previous_value
            currency_result["amounts"][metric] = {
                "current": _money(current_value), "previous": _money(previous_value),
                "absolute_change": _money(change),
                "percentage_change": round(float(change / previous_value * 100), 2) if previous_value else None,
                "currency": currency,
            }
        result["financial_by_currency"][currency] = currency_result
    return result


def _anonymize_commercial_snapshot(snapshot: dict[str, Any]) -> dict[str, Any]:
    """Remove assistant identity fields before report persistence and AI transmission."""
    safe = json.loads(json.dumps(snapshot, ensure_ascii=False))
    assistant = safe.get("assistant")
    if isinstance(assistant, dict):
        assistant.pop("id", None)
        assistant.pop("name", None)
    return safe


def get_owner_commercial_summary(
    owner_user_id: str, *, start_date: str, end_date: str,
    assistant_id: str | None = None, compare: bool = True,
) -> dict[str, Any]:
    try:
        start = date.fromisoformat(start_date)
        end = date.fromisoformat(end_date)
    except (TypeError, ValueError):
        raise HTTPException(422, "Format de date invalide. Utilisez AAAA-MM-JJ.") from None
    if end < start:
        raise HTTPException(422, "La date de fin doit être égale ou postérieure à la date de début.")
    assistant_uuid = _uuid(assistant_id, "assistant")
    try:
        assistants = _rows(
            supabase.table("oria_assistants").select("id,name,timezone")
            .eq("owner_user_id", owner_user_id).order("created_at", desc=False).execute().data
        )
    except Exception as exc:
        logger.exception("Commercial assistant list failed")
        raise HTTPException(503, "Impossible de vérifier les assistants du propriétaire.") from exc
    if assistant_uuid:
        assistants = [row for row in assistants if str(row.get("id")) == assistant_uuid]
        if not assistants:
            raise HTTPException(404, "Assistant introuvable dans votre espace.")
    current_items = [_aggregate_one_assistant(owner_user_id, assistant, start, end) for assistant in assistants]
    current = _merge_summaries(current_items, start, end)
    if compare:
        duration = (end - start).days + 1
        prev_end = start - timedelta(days=1)
        prev_start = prev_end - timedelta(days=duration - 1)
        previous_items = [_aggregate_one_assistant(owner_user_id, assistant, prev_start, prev_end) for assistant in assistants]
        previous = _merge_summaries(previous_items, prev_start, prev_end)
        current["comparison"] = _comparison(current, previous)
    else:
        current["comparison"] = None
    current["scope"] = "assistant" if assistant_uuid else "consolidated"
    return current


def get_owner_commercial_model_options(owner_user_id: str) -> dict[str, Any]:
    """Mirror the main Chat provider/pack catalogue, but expose only models with a real billing action."""
    from app.repositories.supabase_credit_repository import SupabaseCreditRepository
    from app.services.chat_provider_router import active_chat_provider, ChatProvider
    from app.route.ai import (
        MODEL_ACTIONS, MODEL_OPENAI_IDS, OPENROUTER_CHAT_MODEL_IDS,
        OPENROUTER_CHAT_ALLOWED_MODELS_BY_PACK, PACK_ALLOWED_MODELS,
        _ORIA_CHAT_DISPLAY_NAMES,
    )

    wallet = SupabaseCreditRepository(supabase).get_wallet(owner_user_id)
    if wallet is None or not wallet.is_pack_active:
        raise HTTPException(403, "Un pack ORIA actif est nécessaire pour générer un bilan commercial.")
    try:
        provider = active_chat_provider()
    except Exception as exc:
        raise HTTPException(503, "Le fournisseur IA du Chat principal n'est pas configuré correctement.") from exc
    if wallet.pack_id == "discovery_pack":
        from app.route.ai import _discovery_require_enabled
        _discovery_require_enabled(wallet.pack_id)
    rights = PACK_ALLOWED_MODELS if provider is ChatProvider.OPENAI else OPENROUTER_CHAT_ALLOWED_MODELS_BY_PACK
    allowed = rights.get(wallet.pack_id)
    catalog = MODEL_OPENAI_IDS if provider is ChatProvider.OPENAI else OPENROUTER_CHAT_MODEL_IDS
    if allowed is None:
        raise HTTPException(403, "Aucun catalogue de modèles n'est défini pour ce pack.")
    models = []
    unsupported = []
    for key, label in _ORIA_CHAT_DISPLAY_NAMES.items():
        if key not in allowed or key not in catalog:
            continue
        if key not in MODEL_ACTIONS or "normal" not in MODEL_ACTIONS[key]:
            unsupported.append({"id": key, "label": label, "reason": "Action de facturation Chat non configurée"})
            continue
        models.append({"id": key, "label": label})
    return {"success": True, "provider": provider.value, "pack_id": wallet.pack_id,
            "models": models, "unavailable_due_to_billing_config": unsupported}


def _resolve_billable_selection(owner_user_id: str, model: str):
    """Resolve a model through the exact Chat principal allow-list and wallet."""
    from app.repositories.supabase_credit_repository import SupabaseCreditRepository
    from app.route.ai import MODEL_ACTIONS, _oria_chat_selection

    repository = SupabaseCreditRepository(supabase)
    wallet = repository.get_wallet(owner_user_id)
    if wallet is None or not wallet.is_pack_active:
        raise HTTPException(403, "Un pack ORIA actif est nécessaire pour générer un bilan commercial.")
    try:
        selected = _oria_chat_selection(model, wallet, False)
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(403, "Ce modèle n'est pas autorisé par votre fournisseur ou votre pack.") from exc
    action = MODEL_ACTIONS.get(model, {}).get("normal")
    if action is None:
        raise HTTPException(403, "Ce modèle ne dispose pas encore d'une action de facturation Chat compatible.")
    return selected, wallet, action, repository


def _analysis_instructions() -> str:
    return (
        "Tu es l'analyste commercial d'ORIA Assistant. Analyse uniquement les indicateurs et tendances fournis. "
        "Ne recalcule pas les chiffres, ne les modifie pas et n'invente aucune vente, paiement, origine de trafic, "
        "satisfaction client ou cause non mesurée. Le chiffre d'affaires encaissé est exclusivement celui déclaré "
        "dans les agrégats. Distingue toujours devis, opportunités et encaissements. Les montants de devises différentes "
        "ne doivent jamais être additionnés. Explique les limites lorsque des données sont absentes. "
        "Réponds en français avec Markdown structuré : synthèse exécutive, diagnostic, tendances observées, "
        "opportunités fondées sur les chiffres et recommandations hiérarchisées et justifiées."
    )


async def generate_owner_commercial_report(
    owner_user_id: str, *, start_date: str, end_date: str,
    model: str, assistant_id: str | None = None,
) -> dict[str, Any]:
    """Use the same Chat principal provider, quote, reservation and settlement helpers."""
    from app.route.ai import (
        ChatProvider, MODEL_OPENAI_IDS, OpenAIService, OpenRouterTokenBillingService,
        _calculate_real_chat_billing, _extract_classic_chat_result,
        _oria_openrouter_execute_classic, _oria_openrouter_preflight,
        _oria_openrouter_reserve, _oria_openrouter_service,
        _release_chat_reservation, _reserve_chat_credits,
        _settle_chat_reservation,
    )

    snapshot = _anonymize_commercial_snapshot(get_owner_commercial_summary(
        owner_user_id, start_date=start_date, end_date=end_date,
        assistant_id=assistant_id, compare=True,
    ))
    selection, wallet, action, repository = _resolve_billable_selection(owner_user_id, model)
    report_id = str(uuid4())
    prompt_data = json.dumps(snapshot, ensure_ascii=False, separators=(",", ":"))
    prompt = (
        "Voici les agrégats commerciaux calculés par ORIA. Ils sont la seule source de vérité. "
        "Fais le diagnostic sans inventer et respecte les devises séparément.\n\n" + prompt_data
    )

    openrouter_service = None
    openrouter_quote = None
    provider_attachments: list[Any] = []
    if selection.provider is ChatProvider.OPENROUTER:
        try:
            openrouter_service = _oria_openrouter_service()
            openrouter_quote, provider_attachments = _oria_openrouter_preflight(
                service=openrouter_service, selection=selection, message=prompt,
                history=[], attachments=[], web=False, reasoning_mode="balanced",
                visual_mode=False, document_types=(), stream=False,
            )
        except HTTPException:
            raise
        except Exception as exc:
            raise HTTPException(503, "Le contrôle préalable OpenRouter du bilan a échoué.") from exc

    report_row = {
        "id": report_id,
        "owner_user_id": owner_user_id,
        "assistant_id": _uuid(assistant_id, "assistant"),
        "period_start": start_date,
        "period_end": end_date,
        "source_snapshot": snapshot,
        "analysis_content": {
            "status": "generating", "provider": selection.provider.value,
            "model": selection.oria_model,
        },
    }
    try:
        inserted = _first(
            supabase.table("oria_assistant_commercial_reports")
            .insert(report_row).select("id").execute().data
        )
        if inserted is None:
            raise RuntimeError("commercial_report_preinsert_missing")
    except Exception as exc:
        logger.exception("Commercial report pre-insert failed")
        raise HTTPException(503, "Impossible de préparer l'enregistrement du bilan.") from exc

    response_text = ""
    usage_payload: dict[str, Any] = {}
    actual_api_cost_xaf: Any = None
    total_cost_usd: Any = None
    credits_consumed = 0
    billing_reference_id: str | None = None

    if selection.provider is ChatProvider.OPENROUTER:
        try:
            # Reserve through the Chat principal helper and bind its reference to this report.
            billing_reference_id = _oria_openrouter_reserve(
                repository=repository, uid=owner_user_id, action=action, quote=openrouter_quote,
            )
            _update_report_status(owner_user_id, report_id, {
                "status": "generating", "provider": selection.provider.value,
                "model": selection.oria_model, "billing_reference_id": billing_reference_id,
            })
            provider_response, settlement, _ = await _oria_openrouter_execute_classic(
                service=openrouter_service, selection=selection, repository=repository,
                wallet=wallet, uid=owner_user_id, action=action, quote=openrouter_quote,
                attachments=provider_attachments, message=prompt, history=[], web=False,
                reasoning_mode="balanced", visual_mode=False, is_trial_model=False,
                reservation_id=billing_reference_id, document_types=(),
            )
            billing = OpenRouterTokenBillingService.calculate(provider_response)
            response_text = str(provider_response.get("message") or "").strip()
            usage_payload = billing.to_dict()
            actual_api_cost_xaf = str(billing.total_cost_xaf)
            total_cost_usd = str(billing.total_cost_usd)
            credits_consumed = int(settlement.cost)
        except HTTPException as exc:
            status = (
                "provider_rejected" if exc.status_code == 502 else
                "reservation_failed" if exc.status_code == 402 else
                "reconciliation_required"
            )
            _update_report_status(owner_user_id, report_id, {
                "status": status, "provider": selection.provider.value,
                "model": selection.oria_model,
                "billing_reference_id": billing_reference_id,
                "error": str(exc.detail)[:300],
            })
            raise
        except Exception as exc:
            logger.exception("OpenRouter commercial report execution failed")
            _update_report_status(owner_user_id, report_id, {
                "status": "reconciliation_required", "provider": selection.provider.value,
                "model": selection.oria_model, "billing_reference_id": billing_reference_id,
                "error": "usage fournisseur ou règlement à rapprocher",
            })
            raise HTTPException(503, "Résultat OpenRouter incertain ; la réservation est conservée pour rapprochement.") from exc
    else:
        try:
            billing_reference_id, _reserved_credits, output_cap = _reserve_chat_credits(
                repository=repository, authenticated_user_id=owner_user_id,
                action=action, model=model, message=prompt, history=[], attachments=[],
                web=False, reasoning_mode="balanced", document_types=(), streaming=False,
            )
            _update_report_status(owner_user_id, report_id, {
                "status": "generating", "provider": selection.provider.value,
                "model": selection.oria_model, "billing_reference_id": billing_reference_id,
            })
        except HTTPException as exc:
            _update_report_status(owner_user_id, report_id, {
                "status": "reservation_failed", "provider": selection.provider.value,
                "model": selection.oria_model, "error": str(exc.detail)[:300],
            })
            raise
        except Exception as exc:
            logger.exception("OpenAI commercial report credit reservation failed")
            _update_report_status(owner_user_id, report_id, {"status": "reservation_failed"})
            raise HTTPException(402, "Réservation des crédits impossible pour ce bilan commercial.") from exc

        try:
            provider_response = OpenAIService().chat(
                model=MODEL_OPENAI_IDS[model], message=prompt, web=False,
                attachments=[], history=[], reasoning_mode="balanced", visual_mode=False,
                artifact_types=(), max_output_tokens=output_cap,
            )
        except Exception as exc:
            try:
                _release_chat_reservation(
                    repository=repository, authenticated_user_id=owner_user_id,
                    reservation_id=billing_reference_id,
                )
            except Exception:
                logger.exception("Commercial report reservation release failed")
            _update_report_status(owner_user_id, report_id, {
                "status": "provider_rejected", "provider": selection.provider.value,
                "model": selection.oria_model, "billing_reference_id": billing_reference_id,
                "error": "appel OpenAI refusé",
            })
            raise HTTPException(502, "Le fournisseur OpenAI n'a pas pu générer le bilan commercial.") from exc

        try:
            response_text, credits, actual_api_cost_xaf = _extract_classic_chat_result(
                response=provider_response, model=model, web=False, document_types=(),
            )
            billing = _calculate_real_chat_billing(
                model=model, usage=provider_response.get("usage"),
                web_search_calls=int(provider_response.get("web_search_calls") or 0),
            )
            usage_payload = provider_response.get("usage") or {}
            total_cost_usd = str(billing.total_cost_usd)
            actual_api_cost_xaf = str(actual_api_cost_xaf)
        except Exception as exc:
            _update_report_status(owner_user_id, report_id, {
                "status": "reconciliation_required", "provider": selection.provider.value,
                "model": selection.oria_model, "billing_reference_id": billing_reference_id,
                "error": "usage OpenAI manquant ou inexploitable",
            })
            raise HTTPException(503, "La réponse OpenAI est reçue, mais son coût réel doit être rapproché.") from exc

        try:
            settlement, _ = _settle_chat_reservation(
                repository=repository, wallet_before_reservation=wallet,
                authenticated_user_id=owner_user_id, reservation_id=billing_reference_id,
                action=action, cost=int(credits), api_cost_xaf=actual_api_cost_xaf,
                is_trial_model=False, model_id=model,
            )
            credits_consumed = int(settlement.cost)
        except Exception as exc:
            _update_report_status(owner_user_id, report_id, {
                "status": "settlement_required", "provider": selection.provider.value,
                "model": selection.oria_model, "billing_reference_id": billing_reference_id,
                "error": "règlement des crédits à rapprocher",
            })
            raise HTTPException(503, "Le bilan a été généré, mais son règlement doit être rapproché.") from exc

    final_content = {
        "status": "completed",
        "markdown": response_text,
        "provider": selection.provider.value,
        "model": selection.oria_model,
        "provider_model": selection.api_model,
        "usage": usage_payload,
        "credits_consumed": credits_consumed,
        "actual_api_cost_xaf": str(actual_api_cost_xaf) if actual_api_cost_xaf is not None else None,
        "total_cost_usd": str(total_cost_usd) if total_cost_usd is not None else None,
        "billing_reference_id": billing_reference_id,
        "generated_at": datetime.now(timezone.utc).isoformat(),
    }
    try:
        updated = _first(
            supabase.table("oria_assistant_commercial_reports")
            .update({"analysis_content": final_content, "generated_at": datetime.now(timezone.utc).isoformat()})
            .eq("id", report_id).eq("owner_user_id", owner_user_id).select("*").execute().data
        )
        if updated is None:
            raise RuntimeError("commercial_report_final_update_missing")
        return {"success": True, "report": updated}
    except Exception as exc:
        logger.exception("Commercial report final persistence failed after settlement")
        raise HTTPException(503, "Le bilan a été réglé, mais son enregistrement final doit être rapproché. Ne relance pas immédiatement.") from exc


def _update_report_status(owner_user_id: str, report_id: str, content: dict[str, Any]) -> None:
    try:
        supabase.table("oria_assistant_commercial_reports").update({"analysis_content": content}).eq(
            "id", report_id
        ).eq("owner_user_id", owner_user_id).execute()
    except Exception:
        logger.exception("Commercial report status persistence failed")



def list_owner_commercial_reports(
    owner_user_id: str, *, assistant_id: str | None = None, limit: int = 20, offset: int = 0,
) -> list[dict[str, Any]]:
    normalized_assistant = _uuid(assistant_id, "assistant")
    safe_limit = max(1, min(int(limit), 100))
    safe_offset = max(0, int(offset))
    try:
        query = (
            supabase.table("oria_assistant_commercial_reports").select(
                "id,owner_user_id,assistant_id,period_start,period_end,analysis_content,generated_at,created_at"
            ).eq("owner_user_id", owner_user_id)
        )
        if normalized_assistant:
            query = query.eq("assistant_id", normalized_assistant)
        response = query.order("generated_at", desc=True).range(
            safe_offset, safe_offset + safe_limit - 1
        ).execute()
        return _rows(getattr(response, "data", None))
    except Exception as exc:
        logger.exception("Commercial report history query failed")
        raise HTTPException(503, "Impossible de charger l'historique des bilans.") from exc

def get_owner_commercial_report(owner_user_id: str, report_id: str) -> dict[str, Any]:
    normalized = str(UUID(str(report_id)))
    try:
        row = _first(
            supabase.table("oria_assistant_commercial_reports").select("*")
            .eq("id", normalized).eq("owner_user_id", owner_user_id).limit(1).execute().data
        )
    except Exception as exc:
        logger.exception("Commercial report fetch failed")
        raise HTTPException(503, "Impossible de charger ce bilan commercial.") from exc
    if row is None:
        raise HTTPException(404, "Bilan commercial introuvable.")
    return row
