import hashlib
import sys
import types

import pytest
from fastapi import HTTPException

# The read-only source diagnostic intentionally omits credentials/config modules.
# Install a harmless import stub so service/route unit tests can run without secrets.
if "app.core.supabase" not in sys.modules:
    core_module = types.ModuleType("app.core")
    core_module.__path__ = []
    supabase_module = types.ModuleType("app.core.supabase")
    supabase_module.supabase = object()
    sys.modules.setdefault("app.core", core_module)
    sys.modules["app.core.supabase"] = supabase_module

from app.route import oria_assistant as assistant_routes
from app.services import oria_assistant_service as assistant_service


class _Response:
    def __init__(self, data):
        self.data = data


class _Query:
    def __init__(self, db, table):
        self.db = db
        self.table = table
        self.filters = []
        self.ordering = None
        self.maximum = None
        self.selected = None

    def select(self, fields):
        self.selected = fields
        self.db.selects.setdefault(self.table, []).append(fields)
        return self

    def eq(self, key, value):
        self.filters.append(("eq", key, value))
        return self

    def in_(self, key, values):
        self.filters.append(("in", key, set(values)))
        return self

    def order(self, key, desc=False):
        self.ordering = (key, bool(desc))
        return self

    def limit(self, maximum):
        self.maximum = maximum
        return self

    def execute(self):
        rows = list(self.db.rows.get(self.table, []))
        for kind, key, value in self.filters:
            if kind == "eq":
                rows = [row for row in rows if str(row.get(key)) == str(value)]
            else:
                rows = [row for row in rows if str(row.get(key)) in value]
        if self.ordering:
            key, desc = self.ordering
            rows.sort(key=lambda row: str(row.get(key) or ""), reverse=desc)
        if self.maximum is not None:
            rows = rows[: self.maximum]
        return _Response(rows)


class _DB:
    def __init__(self, rows):
        self.rows = rows
        self.selects = {}

    def table(self, name):
        return _Query(self, name)


def test_visitor_history_restores_settled_runs_and_returns_chronological_messages(monkeypatch):
    token = "visitor-session-token"
    conversation_id = "conversation-1"
    db = _DB({
        "oria_assistant_conversations": [{
            "id": conversation_id,
            "assistant_id": "assistant-1",
            "visitor_token_hash": hashlib.sha256(token.encode()).hexdigest(),
        }],
        "oria_assistant_runs": [{"id": "run-settled", "conversation_id": conversation_id, "status": "settled_pending_persist"}],
        "oria_assistant_messages": [
            {"id": "m2", "conversation_id": conversation_id, "role": "assistant", "content": "Deuxième", "created_at": "2026-01-02T00:00:00Z"},
            {"id": "m1", "conversation_id": conversation_id, "role": "user", "content": "Premier", "created_at": "2026-01-01T00:00:00Z"},
        ],
    })
    restored = []
    monkeypatch.setattr(assistant_service, "supabase", db)
    monkeypatch.setattr(assistant_service, "_complete_saved_run", lambda run: restored.append(run["id"]))

    messages = assistant_service.visitor_messages("assistant-1", conversation_id, token)

    assert restored == ["run-settled"]
    assert [row["id"] for row in messages] == ["m1", "m2"]
    assert db.selects["oria_assistant_messages"] == ["id,role,content,created_at"]


def test_visitor_cannot_read_history_with_another_session_token(monkeypatch):
    db = _DB({
        "oria_assistant_conversations": [{
            "id": "conversation-1",
            "assistant_id": "assistant-1",
            "visitor_token_hash": hashlib.sha256(b"right-token").hexdigest(),
        }],
    })
    monkeypatch.setattr(assistant_service, "supabase", db)

    with pytest.raises(HTTPException) as error:
        assistant_service.visitor_messages("assistant-1", "conversation-1", "wrong-token")

    assert error.value.status_code == 403


def test_public_assistant_endpoint_exposes_only_the_public_allowlist(monkeypatch):
    monkeypatch.setattr(assistant_routes, "get_public_assistant", lambda _slug: {
        "id": "private-id",
        "name": "Support",
        "description": "Aide les visiteurs.",
        "welcome_message": "Bonjour.",
        "slug": "support-abc",
        "owner_user_id": "owner-secret",
        "instructions": "Consignes privées du propriétaire.",
        "business_email": "private@example.test",
        "business_name": "Entreprise Exemple",
    })

    result = assistant_routes.public_assistant_info("support-abc")

    assert set(result["assistant"]) == {"name", "description", "welcome_message", "slug"}
    assert "owner_user_id" not in result["assistant"]
    assert "instructions" not in result["assistant"]
    assert "business_email" not in result["assistant"]
