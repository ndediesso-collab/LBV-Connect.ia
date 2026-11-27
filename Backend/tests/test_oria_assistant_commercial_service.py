from __future__ import annotations

from datetime import date, datetime, timezone
from decimal import Decimal

import pytest
import json
from fastapi import HTTPException

from app.services import oria_assistant_commercial_service as service


class FakeResponse:
    def __init__(self, data):
        self.data = data


class FakeQuery:
    def __init__(self, db, table):
        self.db = db
        self.table = table
        self.filters = []
        self.op = "select"
        self.payload = None
        self.start = 0
        self.end = 999
        self.order_by = None

    def select(self, *_a, **_k): return self
    def eq(self, key, value): self.filters.append((key, "eq", value)); return self
    def gte(self, key, value): self.filters.append((key, "gte", value)); return self
    def gt(self, key, value): self.filters.append((key, "gt", value)); return self
    def lte(self, key, value): self.filters.append((key, "lte", value)); return self
    def lt(self, key, value): self.filters.append((key, "lt", value)); return self
    def in_(self, key, values): self.filters.append((key, "in", values)); return self
    def order(self, key, desc=False): self.order_by = (key, desc); return self
    def range(self, start, end): self.start, self.end = start, end; return self
    def limit(self, _limit): return self
    def insert(self, payload): self.op, self.payload = "insert", payload; return self
    def update(self, payload): self.op, self.payload = "update", payload; return self

    def _matches(self, row):
        for key, op, value in self.filters:
            actual = row.get(key)
            if op == "eq" and str(actual) != str(value): return False
            if op == "in" and actual not in value: return False
            if op in {"gte", "gt", "lte", "lt"}:
                if actual is None: return False
                left, right = str(actual), str(value)
                if op == "gte" and left < right: return False
                if op == "gt" and left <= right: return False
                if op == "lte" and left > right: return False
                if op == "lt" and left >= right: return False
        return True

    def execute(self):
        rows = self.db.tables.setdefault(self.table, [])
        if self.op == "insert":
            candidate = dict(self.payload)
            candidate.setdefault("id", f"generated-{len(rows)+1}")
            rows.append(candidate)
            return FakeResponse([candidate])
        matches = [dict(row) for row in rows if self._matches(row)]
        if self.order_by:
            key, desc = self.order_by
            matches.sort(key=lambda row: str(row.get(key) or ""), reverse=desc)
        if self.op == "update":
            for original in rows:
                if self._matches(original): original.update(self.payload)
            matches = [dict(row) for row in rows if self._matches(row)]
        return FakeResponse(matches[self.start:self.end + 1])


class FakeSupabase:
    def __init__(self, tables): self.tables = tables
    def table(self, name): return FakeQuery(self, name)


def _db():
    assistant = "11111111-1111-4111-8111-111111111111"
    owner = "owner-1"
    return FakeSupabase({
        "oria_assistants": [
            {"id": assistant, "owner_user_id": owner, "name": "Agence Démo", "timezone": "Africa/Libreville", "created_at": "2026-01-01T00:00:00+00:00"},
            {"id": "99999999-9999-4999-8999-999999999999", "owner_user_id": "owner-2", "name": "Autre", "timezone": "UTC", "created_at": "2026-01-01T00:00:00+00:00"},
        ],
        "oria_assistant_conversations": [
            {"id": "conv-1", "assistant_id": assistant, "owner_user_id": owner, "created_at": "2026-11-05T10:00:00+00:00"},
            {"id": "conv-2", "assistant_id": assistant, "owner_user_id": owner, "created_at": "2026-11-10T10:00:00+00:00"},
            {"id": "foreign-conv", "assistant_id": "99999999-9999-4999-8999-999999999999", "owner_user_id": "owner-2", "created_at": "2026-11-05T10:00:00+00:00"},
        ],
        "oria_assistant_messages": [
            {"id": "m1", "conversation_id": "conv-1", "owner_user_id": owner, "role": "user", "run_id": "run-1", "created_at": "2026-11-05T10:00:00+00:00"},
            {"id": "m2", "conversation_id": "conv-1", "owner_user_id": owner, "role": "assistant", "run_id": "run-1", "created_at": "2026-11-05T10:01:00+00:00"},
            {"id": "m3", "conversation_id": "conv-1", "owner_user_id": owner, "role": "assistant", "run_id": None, "created_at": "2026-11-05T10:02:00+00:00"},
            {"id": "m4", "conversation_id": "conv-2", "owner_user_id": owner, "role": "user", "run_id": "run-2", "created_at": "2026-11-10T10:00:00+00:00"},
            {"id": "m5", "conversation_id": "foreign-conv", "owner_user_id": "owner-2", "role": "user", "run_id": None, "created_at": "2026-11-05T10:00:00+00:00"},
        ],
        "oria_assistant_runs": [
            {"id": "run-1", "assistant_id": assistant, "owner_user_id": owner, "conversation_id": "conv-1", "status": "completed", "provider": "openai", "model": "luna", "actual_credits": 100, "actual_api_cost_xaf": "12.50", "total_cost_usd": "0.02", "created_at": "2026-11-05T10:01:00+00:00"},
            {"id": "run-2", "assistant_id": assistant, "owner_user_id": owner, "conversation_id": "conv-2", "status": "failed", "provider": "openai", "model": "luna", "actual_credits": 999, "actual_api_cost_xaf": "90", "created_at": "2026-11-10T10:01:00+00:00"},
        ],
        "oria_assistant_requests": [
            {"id": "req-1", "assistant_id": assistant, "owner_user_id": owner, "conversation_id": "conv-1", "request_type": "Demande de devis", "summary": "Jules souhaite louer une voiture pour le weekend", "customer_name": "Jules Mba", "customer_phone": "+241 06 12 34 56", "customer_email": "jules@example.com", "status": "new", "created_at": "2026-11-05T11:00:00+00:00"},
            {"id": "req-2", "assistant_id": assistant, "owner_user_id": owner, "conversation_id": "conv-1", "request_type": "Réservation", "summary": "Contact : Paul, +241 74 11 22 33 demande une réservation", "customer_name": "Paul", "customer_phone": "abc", "customer_email": None, "status": "treated", "created_at": "2026-11-06T11:00:00+00:00"},
        ],
        "oria_assistant_sales": [
            {"id": "sale-1", "assistant_id": assistant, "owner_user_id": owner, "request_id": "req-1", "outcome": "won", "quoted_amount": "500000", "collected_amount": "200000", "currency": "XAF", "sale_date": "2026-11-05", "created_at": "2026-11-05T12:00:00+00:00"},
            {"id": "sale-2", "assistant_id": assistant, "owner_user_id": owner, "request_id": "req-2", "outcome": "open", "quoted_amount": "300", "collected_amount": "0", "currency": "USD", "sale_date": None, "created_at": "2026-11-06T12:00:00+00:00"},
        ],
    })


def test_summary_counts_completed_ai_runs_and_distinguishes_technical_confirmations(monkeypatch):
    monkeypatch.setattr(service, "supabase", _db())
    result = service.get_owner_commercial_summary(
        "owner-1", start_date="2026-11-01", end_date="2026-11-30", compare=False,
    )
    assert result["activity"] == {
        "conversations_initiated": 2,
        "completed_ai_responses": 1,
        "messages_exchanged": 4,
        "visitor_messages": 2,
        "ai_messages": 1,
        "technical_confirmations": 1,
    }
    assert result["usage"]["consumed_credits"] == 100
    assert result["usage"]["actual_api_cost_xaf"] == "12.50"


def test_conversion_uses_distinct_conversations_not_request_count(monkeypatch):
    monkeypatch.setattr(service, "supabase", _db())
    result = service.get_owner_commercial_summary("owner-1", start_date="2026-11-01", end_date="2026-11-30", compare=False)
    assert result["leads"]["confirmed_requests"] == 2
    assert result["leads"]["conversations_with_confirmed_request"] == 1
    assert result["leads"]["conversation_to_request_rate"] == 50.0
    assert result["leads"]["pipeline"] == {"new": 1, "in_progress": 0, "treated": 1, "cancelled": 0}


def test_contact_metrics_and_currency_separation(monkeypatch):
    monkeypatch.setattr(service, "supabase", _db())
    result = service.get_owner_commercial_summary("owner-1", start_date="2026-11-01", end_date="2026-11-30", compare=False)
    contacts = result["leads"]["contact_quality"]
    assert contacts["with_phone"] == 2
    assert contacts["valid_phone_count"] == 1
    assert contacts["valid_phone_rate"] == 50.0
    assert contacts["with_at_least_one_contact_method"] == 1
    assert set(result["sales"]["by_currency"]) == {"XAF", "USD"}
    assert result["sales"]["by_currency"]["XAF"]["quoted_total"] == "500000.00"
    assert result["sales"]["by_currency"]["XAF"]["collected_total"] == "200000.00"
    assert result["sales"]["by_currency"]["USD"]["quoted_total"] == "300.00"


def test_sales_conversion_denominator_is_only_tracked_request_outcomes(monkeypatch):
    monkeypatch.setattr(service, "supabase", _db())
    result = service.get_owner_commercial_summary("owner-1", start_date="2026-11-01", end_date="2026-11-30", compare=False)
    assert result["sales"]["tracked_requests"] == 2
    assert result["sales"]["won_tracked_requests"] == 1
    assert result["sales"]["untracked_confirmed_requests"] == 0
    assert result["sales"]["financial_records_in_period"] == 2
    assert result["sales"]["sales_conversion_rate_tracked_only"] == 50.0


def test_summary_is_owner_scoped(monkeypatch):
    db = _db()
    monkeypatch.setattr(service, "supabase", db)
    result = service.get_owner_commercial_summary("owner-1", start_date="2026-11-01", end_date="2026-11-30", compare=False)
    assert result["assistants_included"] == 1
    assert result["activity"]["conversations_initiated"] == 2


def test_previous_period_has_same_duration(monkeypatch):
    db = _db()
    db.tables["oria_assistant_conversations"].append({
        "id": "prev", "assistant_id": "11111111-1111-4111-8111-111111111111",
        "owner_user_id": "owner-1", "created_at": "2026-10-31T10:00:00+00:00",
    })
    monkeypatch.setattr(service, "supabase", db)
    result = service.get_owner_commercial_summary("owner-1", start_date="2026-11-01", end_date="2026-11-30", compare=True)
    assert result["comparison"]["previous_period"] == {"start": "2026-10-02", "end": "2026-10-31", "timezone": "Africa/Libreville"}
    assert result["comparison"]["metrics"]["conversations_initiated"]["previous"] == 1


def test_empty_period_returns_zeroes_and_null_rates(monkeypatch):
    db = _db()
    monkeypatch.setattr(service, "supabase", db)
    result = service.get_owner_commercial_summary("owner-1", start_date="2025-01-01", end_date="2025-01-07", compare=False)
    assert result["activity"]["conversations_initiated"] == 0
    assert result["leads"]["conversation_to_request_rate"] is None
    assert result["sales"]["by_currency"] == {}


def test_rejects_invalid_period(monkeypatch):
    monkeypatch.setattr(service, "supabase", _db())
    with pytest.raises(HTTPException) as exc:
        service.get_owner_commercial_summary("owner-1", start_date="2026-12-01", end_date="2026-11-01", compare=False)
    assert exc.value.status_code == 422


def test_consolidated_average_uses_only_sales_with_quotes(monkeypatch):
    db = _db()
    db.tables["oria_assistant_assistants"] = []
    # Add another same-owner assistant with one won sale without a quote.
    assistant2 = "22222222-2222-4222-8222-222222222222"
    db.tables["oria_assistants"].append({"id": assistant2, "owner_user_id": "owner-1", "name": "Deuxième", "timezone": "Africa/Libreville", "created_at": "2026-01-02T00:00:00+00:00"})
    db.tables["oria_assistant_requests"].append({"id": "req-3", "assistant_id": assistant2, "owner_user_id": "owner-1", "conversation_id": "conv-x", "request_type": "Achat", "summary": "Achat service", "status": "treated", "created_at": "2026-11-05T11:00:00+00:00"})
    db.tables["oria_assistant_sales"].append({"id": "sale-3", "assistant_id": assistant2, "owner_user_id": "owner-1", "request_id": "req-3", "outcome": "won", "quoted_amount": None, "collected_amount": "100", "currency": "XAF", "sale_date": "2026-11-07", "created_at": "2026-11-07T12:00:00+00:00"})
    monkeypatch.setattr(service, "supabase", db)
    result = service.get_owner_commercial_summary("owner-1", start_date="2026-11-01", end_date="2026-11-30", compare=False)
    assert result["sales"]["by_currency"]["XAF"]["average_won_quoted"] == "500000.00"
    assert result["sales"]["by_currency"]["XAF"]["average_won_collected"] == "100050.00"



def test_contact_method_requires_a_valid_phone_or_email():
    contacts = service._contact_metrics([
        {"customer_phone": "abc", "customer_email": None},
        {"customer_phone": "061234567", "customer_email": None},
        {"customer_phone": None, "customer_email": "not-an-email"},
        {"customer_phone": None, "customer_email": "valid@example.com"},
    ])
    assert contacts["with_at_least_one_contact_method"] == 2
    assert contacts["contact_method_rate"] == 50.0
    assert contacts["valid_phone_count"] == 1
    assert contacts["valid_email_count"] == 1


def test_snapshot_does_not_expose_customer_names_emails_or_phones(monkeypatch):
    db = _db()
    db.tables["oria_assistant_requests"][0]["request_type"] = "Jules Mba +241 06 12 34 56 jules@example.com - Devis"
    db.tables["oria_assistant_requests"][0]["summary"] = (
        "Jules Mba demande un devis, rappeler Jules au +241 06 12 34 56 ou jules@example.com"
    )
    monkeypatch.setattr(service, "supabase", db)
    result = service.get_owner_commercial_summary(
        "owner-1", start_date="2026-11-01", end_date="2026-11-30", compare=False,
    )
    serialized = json.dumps(result, ensure_ascii=False)
    for private_value in ("Jules Mba", "jules@example.com", "+241 06 12 34 56"):
        assert private_value not in serialized
    assert result["leads"]["by_type"][0]["request_type"] == "devis"


def test_outcome_entered_after_request_period_is_still_in_cohort_conversion(monkeypatch):
    db = _db()
    # A November request gets its sale result declared in December.
    db.tables["oria_assistant_sales"][0]["created_at"] = "2026-12-03T12:00:00+00:00"
    db.tables["oria_assistant_sales"][0]["sale_date"] = "2026-12-03"
    monkeypatch.setattr(service, "supabase", db)
    result = service.get_owner_commercial_summary(
        "owner-1", start_date="2026-11-01", end_date="2026-11-30", compare=False,
    )
    assert result["sales"]["tracked_requests"] == 2
    assert result["sales"]["won_tracked_requests"] == 1
    assert result["sales"]["sales_conversion_rate_tracked_only"] == 50.0
    # Financial revenue remains attributed to December, not November.
    assert "XAF" not in result["sales"]["by_currency"]


def test_lost_opportunities_do_not_inflate_outstanding_amount():
    lost = {
        "outcome": "lost", "quoted_amount": "900", "collected_amount": "0",
        "currency": "USD", "sale_date": None, "created_at": "2026-11-05T12:00:00+00:00",
    }
    # A lost opportunity remains visible, but is no longer shown as receivable.
    db = _db()
    db.tables["oria_assistant_sales"][1].update(lost)
    from unittest.mock import patch
    with patch.object(service, "supabase", db):
        result = service.get_owner_commercial_summary(
            "owner-1", start_date="2026-11-01", end_date="2026-11-30", compare=False,
        )
    assert result["sales"]["by_currency"]["USD"]["outstanding_total"] == "0.00"


def test_report_uses_chat_principal_engine_and_existing_credit_ledger(monkeypatch):
    import sys
    import types
    from enum import Enum
    from types import SimpleNamespace

    calls = {"reserve": None, "settle": None, "openai": None}
    class ChatProvider(Enum):
        OPENAI = "openai"
        OPENROUTER = "openrouter"

    selection = SimpleNamespace(
        provider=ChatProvider.OPENAI,
        oria_model="luna",
        api_model="gpt-6-luna",
    )
    wallet = SimpleNamespace(is_pack_active=True, pack_id="pro_pack")
    action = "chat_luna"
    repository = object()
    snapshot = {
        "period": {"start": "2026-11-01", "end": "2026-11-30", "timezone": "Africa/Libreville"},
        "activity": {"conversations_initiated": 10, "completed_ai_responses": 12},
        "leads": {"confirmed_requests": 2, "themes": [{"theme": "location", "mentions": 2}]},
        "sales": {"by_currency": {"XAF": {"collected_total": "200000.00"}}},
    }
    monkeypatch.setattr(service, "get_owner_commercial_summary", lambda *a, **k: snapshot)
    monkeypatch.setattr(service, "_resolve_billable_selection", lambda *a, **k: (selection, wallet, action, repository))

    class FakeOpenAIService:
        def chat(self, **kwargs):
            calls["openai"] = kwargs
            return {"message": "## Synthèse\nLes demandes progressent.", "usage": {"input_tokens": 100, "output_tokens": 200}, "web_search_calls": 0}

    def reserve(**kwargs):
        calls["reserve"] = kwargs
        return "reservation-chat-principal", 50, 2048

    def settle(**kwargs):
        calls["settle"] = kwargs
        return SimpleNamespace(cost=42), None

    class FakeBilling:
        total_cost_usd = Decimal("0.012")
        total_cost_xaf = Decimal("7.25")
        credits = 42

    route_module = types.ModuleType("app.route.ai")
    route_module.ChatProvider = ChatProvider
    route_module.MODEL_OPENAI_IDS = {"luna": "gpt-6-luna"}
    route_module.OpenAIService = FakeOpenAIService
    route_module._reserve_chat_credits = reserve
    route_module._extract_classic_chat_result = lambda **kwargs: (kwargs["response"]["message"], 42, Decimal("7.25"))
    route_module._calculate_real_chat_billing = lambda **kwargs: FakeBilling()
    route_module._settle_chat_reservation = settle
    route_module._release_chat_reservation = lambda **kwargs: None
    route_module._oria_openrouter_execute_classic = None
    route_module._oria_openrouter_preflight = None
    route_module._oria_openrouter_reserve = None
    route_module._oria_openrouter_service = None
    route_module.OpenRouterTokenBillingService = None
    monkeypatch.setitem(sys.modules, "app.route.ai", route_module)

    db = FakeSupabase({"oria_assistant_commercial_reports": []})
    monkeypatch.setattr(service, "supabase", db)
    result = run_report_generation_for_test(service, "owner-1")

    assert result["success"] is True
    assert calls["openai"]["model"] == "gpt-6-luna"
    assert calls["openai"]["message"].find('"conversations_initiated":10') >= 0
    assert calls["reserve"]["action"] == action
    assert calls["reserve"]["model"] == "luna"
    assert calls["settle"]["cost"] == 42
    assert calls["settle"]["reservation_id"] == "reservation-chat-principal"
    assert result["report"]["source_snapshot"] == snapshot
    assert result["report"]["analysis_content"]["markdown"].startswith("## Synthèse")


def run_report_generation_for_test(service_module, owner_id):
    import asyncio
    return asyncio.run(service_module.generate_owner_commercial_report(
        owner_id, start_date="2026-11-01", end_date="2026-11-30", model="luna",
    ))


def test_openrouter_report_uses_chat_principal_execution_and_billing(monkeypatch):
    import sys
    import types
    import asyncio
    from enum import Enum
    from types import SimpleNamespace

    calls = {"preflight": None, "reserve": None, "execute": None}
    class ChatProvider(Enum):
        OPENAI = "openai"
        OPENROUTER = "openrouter"

    selection = SimpleNamespace(provider=ChatProvider.OPENROUTER, oria_model="claude-haiku-5.5", api_model="anthropic/claude-haiku-5.5")
    wallet = SimpleNamespace(is_pack_active=True, pack_id="light_pack")
    action = "chat_claude_haiku"
    repository = object()
    snapshot = {"activity": {"conversations_initiated": 2}, "sales": {"by_currency": {}}}
    monkeypatch.setattr(service, "get_owner_commercial_summary", lambda *a, **k: snapshot)
    monkeypatch.setattr(service, "_resolve_billable_selection", lambda *a, **k: (selection, wallet, action, repository))

    response = {
        "message": "## Diagnostic\nLes données sont encore limitées.",
        "provider_usage": {"provider": "openrouter", "reported_cost_usd": "0.01", "input_tokens": 100, "output_tokens": 100, "cached_input_tokens": 0, "cache_write_tokens": 0, "reasoning_tokens": 0, "total_tokens": 200, "request_id": "or-123"},
        "provider_cost_usd": "0.01", "model": "anthropic/claude-haiku-5.5", "response_id": "or-123",
    }
    route_module = types.ModuleType("app.route.ai")
    route_module.ChatProvider = ChatProvider
    route_module.MODEL_OPENAI_IDS = {}
    route_module.OpenAIService = None
    route_module._calculate_real_chat_billing = None
    route_module._extract_classic_chat_result = None
    route_module._reserve_chat_credits = None
    route_module._settle_chat_reservation = None
    route_module._release_chat_reservation = None
    route_module._oria_openrouter_service = lambda: "openrouter-service"
    route_module._oria_openrouter_preflight = lambda **kwargs: (calls.update(preflight=kwargs) or SimpleNamespace(max_output_tokens=2048, reserved_credits=100, reserved_api_cost_xaf=Decimal("6")), [])
    route_module._oria_openrouter_reserve = lambda **kwargs: (calls.update(reserve=kwargs) or "or-reservation-1")
    async def execute(**kwargs):
        calls["execute"] = kwargs
        return response, SimpleNamespace(cost=60), None
    route_module._oria_openrouter_execute_classic = execute
    route_module.OpenRouterTokenBillingService = SimpleNamespace(calculate=lambda _response: SimpleNamespace(
        to_dict=lambda: {"provider": "openrouter", "input_tokens": 100, "output_tokens": 100},
        total_cost_xaf=Decimal("6.00"), total_cost_usd=Decimal("0.01"), credits=60,
    ))
    monkeypatch.setitem(sys.modules, "app.route.ai", route_module)

    db = FakeSupabase({"oria_assistant_commercial_reports": []})
    monkeypatch.setattr(service, "supabase", db)
    result = asyncio.run(service.generate_owner_commercial_report(
        "owner-1", start_date="2026-11-01", end_date="2026-11-30", model="claude-haiku-5.5",
    ))
    assert result["success"] is True
    assert calls["preflight"]["selection"] is selection
    assert calls["reserve"]["action"] == action
    assert calls["execute"]["reservation_id"] == "or-reservation-1"
    assert calls["execute"]["history"] == []
    assert result["report"]["analysis_content"]["provider"] == "openrouter"
    assert result["report"]["analysis_content"]["credits_consumed"] == 60


def test_api_cost_is_not_inferred_from_credits_when_provider_cost_is_missing(monkeypatch):
    db = _db()
    db.tables["oria_assistant_runs"][0]["actual_api_cost_xaf"] = None
    monkeypatch.setattr(service, "supabase", db)
    result = service.get_owner_commercial_summary(
        "owner-1", start_date="2026-11-01", end_date="2026-11-30", compare=False,
    )
    assert result["usage"]["consumed_credits"] == 100
    assert result["usage"]["actual_api_cost_xaf"] is None
    assert result["usage"]["api_cost_missing_runs"] == 1


def test_model_options_follow_openrouter_pack_but_hide_unbillable_models(monkeypatch):
    import sys
    import types
    from enum import Enum
    from types import SimpleNamespace

    class ChatProvider(Enum):
        OPENAI = "openai"
        OPENROUTER = "openrouter"

    class FakeRepository:
        def __init__(self, _db): pass
        def get_wallet(self, _owner): return SimpleNamespace(is_pack_active=True, pack_id="pro_pack")

    repo_module = types.ModuleType("app.repositories.supabase_credit_repository")
    repo_module.SupabaseCreditRepository = FakeRepository
    provider_module = types.ModuleType("app.services.chat_provider_router")
    provider_module.ChatProvider = ChatProvider
    provider_module.active_chat_provider = lambda: ChatProvider.OPENROUTER
    route_module = types.ModuleType("app.route.ai")
    route_module.MODEL_ACTIONS = {
        "luna": {"normal": "chat_luna"},
        "claude-haiku-5.5": {"normal": "chat_claude_haiku"},
    }
    route_module.MODEL_OPENAI_IDS = {}
    route_module.OPENROUTER_CHAT_MODEL_IDS = {
        "luna": "openai/gpt-6-luna",
        "claude-haiku-5.5": "anthropic/claude-haiku-5.5",
        "gemini-3.8-flash": "google/gemini-3.8-flash",
    }
    route_module.OPENROUTER_CHAT_ALLOWED_MODELS_BY_PACK = {
        "pro_pack": {"luna", "claude-haiku-5.5", "gemini-3.8-flash"},
    }
    route_module.PACK_ALLOWED_MODELS = {}
    route_module._ORIA_CHAT_DISPLAY_NAMES = {
        "luna": "Luna", "claude-haiku-5.5": "Claude Haiku", "gemini-3.8-flash": "Gemini Flash",
    }
    monkeypatch.setitem(sys.modules, "app.repositories.supabase_credit_repository", repo_module)
    monkeypatch.setitem(sys.modules, "app.services.chat_provider_router", provider_module)
    monkeypatch.setitem(sys.modules, "app.route.ai", route_module)
    monkeypatch.setattr(service, "supabase", _db())

    result = service.get_owner_commercial_model_options("owner-1")
    assert result["provider"] == "openrouter"
    assert result["pack_id"] == "pro_pack"
    assert {item["id"] for item in result["models"]} == {"luna", "claude-haiku-5.5"}
    assert result["unavailable_due_to_billing_config"] == [{
        "id": "gemini-3.8-flash", "label": "Gemini Flash",
        "reason": "Action de facturation Chat non configurée",
    }]


def test_comparison_includes_financials_by_currency_without_mixing(monkeypatch):
    db = _db()
    db.tables["oria_assistant_sales"].append({
        "id": "sale-prev-xaf", "assistant_id": "11111111-1111-4111-8111-111111111111",
        "owner_user_id": "owner-1", "request_id": "req-prev-xaf", "outcome": "won",
        "quoted_amount": "100000", "collected_amount": "50000", "currency": "XAF",
        "sale_date": "2026-10-15", "created_at": "2026-10-14T12:00:00+00:00",
    })
    db.tables["oria_assistant_sales"].append({
        "id": "sale-prev-usd", "assistant_id": "11111111-1111-4111-8111-111111111111",
        "owner_user_id": "owner-1", "request_id": "req-prev-usd", "outcome": "won",
        "quoted_amount": "100", "collected_amount": "40", "currency": "USD",
        "sale_date": "2026-10-20", "created_at": "2026-10-19T12:00:00+00:00",
    })
    monkeypatch.setattr(service, "supabase", db)
    result = service.get_owner_commercial_summary(
        "owner-1", start_date="2026-11-01", end_date="2026-11-30", compare=True,
    )
    financial = result["comparison"]["financial_by_currency"]
    assert set(financial) == {"XAF", "USD"}
    assert financial["XAF"]["amounts"]["collected_total"] == {
        "current": "200000.00", "previous": "50000.00",
        "absolute_change": "150000.00", "percentage_change": 300.0, "currency": "XAF",
    }
    assert financial["USD"]["amounts"]["collected_total"]["current"] == "0.00"
    assert financial["USD"]["amounts"]["collected_total"]["previous"] == "40.00"


def test_report_snapshot_removes_assistant_identity_before_ai(monkeypatch):
    from unittest.mock import patch
    raw = {
        "assistant": {"id": "private-assistant-id", "name": "Entreprise confidentielle", "timezone": "Africa/Libreville"},
        "activity": {"conversations_initiated": 3},
    }
    safe = service._anonymize_commercial_snapshot(raw)
    assert safe == {"assistant": {"timezone": "Africa/Libreville"}, "activity": {"conversations_initiated": 3}}
    assert "private-assistant-id" not in json.dumps(safe)
    assert "Entreprise confidentielle" not in json.dumps(safe)
