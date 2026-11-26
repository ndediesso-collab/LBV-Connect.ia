from app.services.oria_assistant_credit_ledger import attach_usage_metadata


def test_attach_company_and_assistant_only_to_matching_usage_transaction():
    rows = [
        {"id": "t1", "transaction_type": "usage", "reference_id": "run-a", "amount": -42},
        {"id": "t2", "transaction_type": "recharge", "reference_id": "run-a", "amount": 1000},
        {"id": "t3", "transaction_type": "usage", "reference_id": "run-b", "amount": -12},
    ]
    metadata = {
        "run-a": {
            "assistant_id": "assistant-a",
            "assistant_name": "Service client",
            "business_name": "Entreprise Exemple",
        }
    }
    result = attach_usage_metadata(rows, metadata)

    assert result[0]["usage_source"] == "oria_assistant"
    assert result[0]["business_name"] == "Entreprise Exemple"
    assert result[0]["assistant_name"] == "Service client"
    assert result[0]["amount"] == -42
    assert "usage_source" not in result[1]
    assert "usage_source" not in result[2]


def test_attach_metadata_uses_safe_labels_when_company_or_assistant_was_removed():
    result = attach_usage_metadata(
        [{"transaction_type": "usage", "reference_id": "run-1"}],
        {"run-1": {"assistant_id": "a1", "assistant_name": None, "business_name": ""}},
    )
    assert result[0]["business_name"] == "Entreprise non renseignée"
    assert result[0]["assistant_name"] == "Assistant supprimé"


def test_attach_metadata_does_not_mutate_original_transaction():
    original = {"transaction_type": "usage", "reference_id": "run-1", "amount": -7}
    result = attach_usage_metadata(
        [original],
        {"run-1": {"assistant_name": "A", "business_name": "B"}},
    )
    assert "business_name" not in original
    assert result[0]["business_name"] == "B"


class _FakeResponse:
    def __init__(self, data):
        self.data = data


class _FakeQuery:
    def __init__(self, db, table):
        self.db = db
        self.table_name = table
        self.filters = []

    def select(self, *_args, **_kwargs):
        return self

    def eq(self, key, value):
        self.filters.append(("eq", key, value))
        return self

    def in_(self, key, values):
        self.filters.append(("in", key, set(values)))
        return self

    def execute(self):
        rows = list(self.db.rows.get(self.table_name, []))
        for kind, key, value in self.filters:
            if kind == "eq":
                rows = [row for row in rows if str(row.get(key)) == str(value)]
            else:
                rows = [row for row in rows if str(row.get(key)) in value]
        return _FakeResponse(rows)


class _FakeDB:
    def __init__(self, rows):
        self.rows = rows

    def table(self, name):
        return _FakeQuery(self, name)


def test_enrichment_reads_only_metadata_owned_by_authenticated_user():
    from app.services.oria_assistant_credit_ledger import enrich_credit_transactions

    db = _FakeDB({
        "oria_assistant_credit_usage_meta_v1": [
            {"run_id": "run-owner", "owner_user_id": "owner-a", "assistant_id": "a1", "assistant_name": "Support", "business_name": "Entreprise A"},
            {"run_id": "run-other", "owner_user_id": "owner-b", "assistant_id": "b1", "assistant_name": "Private", "business_name": "Entreprise B"},
        ]
    })
    rows = [
        {"transaction_type": "usage", "reference_id": "run-owner"},
        {"transaction_type": "usage", "reference_id": "run-other"},
    ]
    result = enrich_credit_transactions(db, "owner-a", rows)

    assert result[0]["business_name"] == "Entreprise A"
    assert "business_name" not in result[1]


def test_enrichment_falls_back_to_owner_scoped_runs_if_snapshot_is_missing():
    from app.services.oria_assistant_credit_ledger import enrich_credit_transactions

    db = _FakeDB({
        "oria_assistant_credit_usage_meta_v1": [],
        "oria_assistant_runs": [
            {"id": "run-a", "owner_user_id": "owner-a", "assistant_id": "assistant-a"},
            {"id": "run-b", "owner_user_id": "owner-b", "assistant_id": "assistant-b"},
        ],
        "oria_assistants": [
            {"id": "assistant-a", "owner_user_id": "owner-a", "name": "Assistant A", "business_name": "Société A"},
            {"id": "assistant-b", "owner_user_id": "owner-b", "name": "Assistant B", "business_name": "Société B"},
        ],
    })
    result = enrich_credit_transactions(
        db,
        "owner-a",
        [
            {"transaction_type": "usage", "reference_id": "run-a"},
            {"transaction_type": "usage", "reference_id": "run-b"},
        ],
    )

    assert result[0]["assistant_name"] == "Assistant A"
    assert result[0]["business_name"] == "Société A"
    assert "business_name" not in result[1]
