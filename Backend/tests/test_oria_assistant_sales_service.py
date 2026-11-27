from decimal import Decimal

import pytest
from fastapi import HTTPException

from app.services.oria_assistant_sales_service import (
    normalize_amount,
    normalize_currency,
    validate_sale_values,
)


def test_sale_defaults_to_xaf_and_zero_collected_amount():
    result = validate_sale_values({"outcome": "open"}, creating=True)
    assert result["currency"] == "XAF"
    assert result["collected_amount"] == "0.00"
    assert result["quoted_amount"] is None
    assert result["outcome"] == "open"


def test_partial_payment_keeps_quote_and_collection_separate():
    result = validate_sale_values({
        "outcome": "open",
        "quoted_amount": Decimal("500000.00"),
        "collected_amount": Decimal("200000.00"),
        "currency": "XAF",
    }, creating=True)
    assert result["quoted_amount"] == "500000.00"
    assert result["collected_amount"] == "200000.00"


def test_won_sale_requires_a_sale_date():
    with pytest.raises(HTTPException) as error:
        validate_sale_values({"outcome": "won"}, creating=True)
    assert error.value.status_code == 422


def test_currency_is_normalized_to_uppercase_and_validated():
    assert normalize_currency("xaf") == "XAF"
    with pytest.raises(HTTPException):
        normalize_currency("XAF1")


def test_amount_rejects_negative_values_and_more_than_two_decimals():
    with pytest.raises(HTTPException):
        normalize_amount("-1", label="encaissé")
    with pytest.raises(HTTPException):
        normalize_amount("12.345", label="encaissé")


def test_update_can_change_collected_amount_without_overwriting_quote():
    result = validate_sale_values({"collected_amount": "225000.00"}, creating=False)
    assert result == {"collected_amount": "225000.00"}
    assert "quoted_amount" not in result


def test_sale_date_is_normalized_to_iso_date():
    result = validate_sale_values({"outcome": "won", "sale_date": "2026-11-27"}, creating=True)
    assert result["sale_date"] == "2026-11-27"


class _FakeResponse:
    def __init__(self, data):
        self.data = data


class _FakeQuery:
    def __init__(self, database, table_name):
        self.database = database
        self.table_name = table_name
        self.filters = {}
        self.operation = "select"
        self.payload = None

    def select(self, *_args, **_kwargs):
        return self

    def eq(self, key, value):
        self.filters[key] = str(value)
        return self

    def limit(self, *_args, **_kwargs):
        return self

    def insert(self, payload):
        self.operation = "insert"
        self.payload = dict(payload)
        return self

    def update(self, payload):
        self.operation = "update"
        self.payload = dict(payload)
        return self

    def execute(self):
        rows = self.database.rows.setdefault(self.table_name, [])
        if self.operation == "insert":
            candidate = dict(self.payload)
            if self.table_name == "oria_assistant_sales" and any(
                row.get("request_id") == candidate.get("request_id") for row in rows
            ):
                raise RuntimeError("unique request_id violation")
            candidate.setdefault("id", "sale-generated-id")
            rows.append(candidate)
            return _FakeResponse([candidate])
        matches = [row for row in rows if all(str(row.get(k)) == v for k, v in self.filters.items())]
        if self.operation == "update":
            for row in matches:
                row.update(self.payload)
            return _FakeResponse(matches)
        return _FakeResponse(matches)


class _FakeSupabase:
    def __init__(self, rows):
        self.rows = rows

    def table(self, name):
        return _FakeQuery(self, name)


def _sample_database():
    return {
        "oria_assistant_requests": [{
            "id": "11111111-1111-4111-8111-111111111111", "owner_user_id": "owner-1", "assistant_id": "22222222-2222-4222-8222-222222222222",
        }],
        "oria_assistants": [{"id": "22222222-2222-4222-8222-222222222222", "owner_user_id": "owner-1"}],
        "oria_assistant_sales": [],
    }


def test_sale_creation_derives_assistant_from_owner_scoped_request(monkeypatch):
    from app.services import oria_assistant_sales_service as sales_service

    database = _FakeSupabase(_sample_database())
    monkeypatch.setattr(sales_service, "supabase", database)
    result = sales_service.create_owner_commercial_sale("owner-1", {
        "request_id": "11111111-1111-4111-8111-111111111111",
        "outcome": "open",
        "quoted_amount": "500000",
        "collected_amount": "200000",
    })
    assert result["owner_user_id"] == "owner-1"
    assert result["assistant_id"] == "22222222-2222-4222-8222-222222222222"
    assert result["request_id"] == "11111111-1111-4111-8111-111111111111"


def test_owner_cannot_register_sale_for_another_owners_request(monkeypatch):
    from app.services import oria_assistant_sales_service as sales_service

    monkeypatch.setattr(sales_service, "supabase", _FakeSupabase(_sample_database()))
    with pytest.raises(HTTPException) as error:
        sales_service.create_owner_commercial_sale("owner-2", {
            "request_id": "11111111-1111-4111-8111-111111111111", "outcome": "open",
        })
    assert error.value.status_code == 404


def test_duplicate_sale_for_same_request_is_rejected(monkeypatch):
    from app.services import oria_assistant_sales_service as sales_service

    rows = _sample_database()
    rows["oria_assistant_sales"] = [{
        "id": "33333333-3333-4333-8333-333333333333", "owner_user_id": "owner-1", "assistant_id": "22222222-2222-4222-8222-222222222222",
        "request_id": "11111111-1111-4111-8111-111111111111", "outcome": "open", "currency": "XAF",
        "collected_amount": "0.00",
    }]
    monkeypatch.setattr(sales_service, "supabase", _FakeSupabase(rows))
    with pytest.raises(HTTPException) as error:
        sales_service.create_owner_commercial_sale("owner-1", {
            "request_id": "11111111-1111-4111-8111-111111111111", "outcome": "open",
        })
    assert error.value.status_code == 409


def test_sale_update_is_owner_scoped_and_changes_collection_only(monkeypatch):
    from app.services import oria_assistant_sales_service as sales_service

    rows = _sample_database()
    rows["oria_assistant_sales"] = [{
        "id": "33333333-3333-4333-8333-333333333333", "owner_user_id": "owner-1", "assistant_id": "22222222-2222-4222-8222-222222222222",
        "request_id": "11111111-1111-4111-8111-111111111111", "outcome": "open", "currency": "XAF",
        "quoted_amount": "500000.00", "collected_amount": "100000.00",
        "sale_date": None,
    }]
    monkeypatch.setattr(sales_service, "supabase", _FakeSupabase(rows))
    result = sales_service.update_owner_commercial_sale(
        "owner-1", "33333333-3333-4333-8333-333333333333", {"collected_amount": "250000"},
    )
    assert result["collected_amount"] == "250000.00"
    assert result["quoted_amount"] == "500000.00"

    with pytest.raises(HTTPException) as error:
        sales_service.update_owner_commercial_sale(
            "owner-2", "33333333-3333-4333-8333-333333333333", {"collected_amount": "300000"},
        )
    assert error.value.status_code == 404
