
from copy import deepcopy

# ============================================================
# PAYLOAD CHARIOW RÉELLEMENT OBSERVÉ — PAIEMENT RÉUSSI
# ============================================================

CHARIOW_PAYLOAD = {
    "event": "successful.sale",
    "sale": {
        "id": "SALEO4U030DWC6TAYIN",
        "amount": {
            "value": 1000,
            "formatted": "FCFA 1,000",
            "short": "1.0K",
            "currency": "XAF",
        },
        "original_amount": {
            "value": 1000,
            "formatted": "FCFA 1,000",
            "short": "1.0K",
            "currency": "XAF",
        },
        "discount_amount": {
            "value": 0,
            "formatted": "FCFA 0",
            "short": "0",
            "currency": "XAF",
        },
        "settlement": {},
        "status": "completed",
        "created_at": "2026-08-30T18:19:53.000000Z",
        "custom_fields": None,
        "custom_metadata": {
            "lbv_user_id": "8fe64090-8378-4c61-b4b7-e4c0704d0e0c",
            "lbv_product_id": "light_pack",
            "lbv_reference_id": "LBV-20260830181953-7AA392EE9E",
        },
        "completed_at": "2026-08-30T18:21:01.000000Z",
        "abandoned_at": None,
        "failed_at": None,
    },
    "product": {
        "id": "prd_v8usp6po",
        "name": "Pack Léger",
        "url": "https://noeflzts.mychariow.online/prd_v8usp6po",
        "metadata": None,
        "price": {
            "value": 1000,
            "formatted": "FCFA 1,000",
            "short": "1.0K",
            "currency": "XAF",
        },
    },
    "customer": {
        "id": "cus_b3i6jhw6",
        "name": "Joel ESSO",
        "first_name": "Joel",
        "last_name": "ESSO",
        "email": "joelesso200@gmail.com",
        "phone": "24177379848",
        "country": "GA",
    },
    "affiliate": None,
    "store": {
        "id": "store_f1yxlb6ryc8r",
        "name": "LBV-Connect",
        "url": "https://noeflzts.mychariow.online",
    },
    "checkout": {},
}


# ============================================================
# MÊME LOGIQUE QUE routes.py
# ============================================================

def _chariow_value(payload, *keys):
    raw = payload if isinstance(payload, dict) else {}
    if not isinstance(raw, dict):
        return None

    def search(container):
        if not isinstance(container, dict):
            return None

        for key in keys:
            value = container.get(key)
            if value not in (None, ""):
                return value

        for source_key in ("metadata", "custom_metadata"):
            source = container.get(source_key)
            if isinstance(source, dict):
                for key in keys:
                    value = source.get(key)
                    if value not in (None, ""):
                        return value

        return None

    value = search(raw)
    if value not in (None, ""):
        return value

    sale = raw.get("sale")
    if isinstance(sale, dict):
        value = search(sale)
        if value not in (None, ""):
            return value

    data = raw.get("data")
    if isinstance(data, dict):
        value = search(data)
        if value not in (None, ""):
            return value

        sale_data = data.get("sale")
        if isinstance(sale_data, dict):
            value = search(sale_data)
            if value not in (None, ""):
                return value

    for nested_key in ("product", "customer", "checkout", "affiliate", "store"):
        nested = raw.get(nested_key)
        if isinstance(nested, dict):
            value = search(nested)
            if value not in (None, ""):
                return value

    return None


def _normalize_chariow_event(payload):
    raw = payload if isinstance(payload, dict) else {}

    event = str(
        _chariow_value(raw, "event", "type") or ""
    ).strip().lower()

    status = str(
        _chariow_value(raw, "status", "payment_status") or ""
    ).strip().lower()

    order_id = _chariow_value(
        raw, "order_id", "transaction_id", "id"
    )

    sale = raw.get("sale")
    if not isinstance(sale, dict):
        sale = {}

    sale_custom_metadata = sale.get("custom_metadata")
    if not isinstance(sale_custom_metadata, dict):
        sale_custom_metadata = {}

    reference = (
        sale_custom_metadata.get("lbv_reference_id")
        or _chariow_value(
            raw,
            "reference",
            "reference_id",
            "payment_reference",
            "metadata_reference",
            "lbv_reference_id",
        )
    )

    product_id = (
        sale_custom_metadata.get("lbv_product_id")
        or _chariow_value(
            raw,
            "product_id",
            "product_reference",
            "lbv_product_id",
        )
    )

    user_id = (
        sale_custom_metadata.get("lbv_user_id")
        or _chariow_value(
            raw,
            "user_id",
            "customer_id",
            "client_id",
            "metadata_user_id",
            "lbv_user_id",
        )
    )

    email = _chariow_value(raw, "customer_email", "email")

    amount = _chariow_value(
        raw, "amount", "paid_amount", "total_amount"
    )

    metadata = _chariow_value(
        raw, "metadata", "custom_metadata"
    )
    if not isinstance(metadata, dict):
        metadata = {}

    metadata = {
        **metadata,
        "sale_custom_metadata": sale_custom_metadata,
    }

    paid_at = (
        sale.get("completed_at")
        or _chariow_value(raw, "paid_at", "completed_at")
    )

    provider_transaction_id = (
        sale.get("id")
        or _chariow_value(
            raw,
            "provider_transaction_id",
            "payment_id",
            "transaction_id",
            "id",
        )
    )

    return {
        "event": event,
        "status": status,
        "order_id": str(order_id) if order_id else None,
        "reference": str(reference).strip() if reference else None,
        "product_id": str(product_id) if product_id else None,
        "user_id": str(user_id) if user_id else None,
        "email": str(email) if email else None,
        "amount": amount,
        "metadata": metadata,
        "paid_at": str(paid_at) if paid_at else None,
        "provider_transaction_id": (
            str(provider_transaction_id)
            if provider_transaction_id else None
        ),
        "raw_payload": raw,
    }


def _is_chariow_success(event):
    success_statuses = {
        "success", "successful", "paid", "completed",
        "complete", "succeeded", "approved", "confirmed",
        "successful_payment", "payment_successful",
    }

    success_events = {
        "successful.sale", "successful_sale", "sale_success",
        "sale_successful", "vente_reussie", "vente réussie",
        "payment_success", "payment_succeeded",
        "payment_successful", "purchase_success",
        "purchase_completed", "order_paid", "payment_confirmed",
    }

    normalized_event = str(event.get("event") or "").strip().lower()
    normalized_status = str(event.get("status") or "").strip().lower()

    return (
        normalized_status in success_statuses
        or normalized_event in success_events
    )


# ============================================================
# FAUX SUPABASE : on reproduit les opérations .select/.eq/.update
# ============================================================

class FakeResponse:
    def __init__(self, data):
        self.data = data


class FakeQuery:
    def __init__(self, db, table_name, operation):
        self.db = db
        self.table_name = table_name
        self.operation = operation
        self.filters = {}
        self.payload = None
        self.limit_value = None

    def select(self, *_args):
        return self

    def update(self, payload):
        self.payload = deepcopy(payload)
        return self

    def eq(self, key, value):
        self.filters[key] = value
        return self

    def limit(self, value):
        self.limit_value = value
        return self

    def execute(self):
        rows = self.db[self.table_name]

        matched = [
            row for row in rows
            if all(str(row.get(k)) == str(v) for k, v in self.filters.items())
        ]

        if self.operation == "select":
            return FakeResponse(matched[: self.limit_value] if self.limit_value else matched)

        if self.operation == "update":
            for row in matched:
                row.update(deepcopy(self.payload))
            return FakeResponse(matched)

        raise RuntimeError("Unsupported operation")


class FakeSupabase:
    def __init__(self, rows):
        self.db = {"payment_transactions": deepcopy(rows)}

    def table(self, table_name):
        class TableProxy:
            def __init__(self, outer, name):
                self.outer = outer
                self.name = name

            def select(self, *args):
                return FakeQuery(self.outer.db, self.name, "select").select(*args)

            def update(self, payload):
                return FakeQuery(self.outer.db, self.name, "update").update(payload)

        return TableProxy(self, table_name)


def _find_chariow_payment_transaction(event, supabase):
    candidates = []

    def add_candidate(value):
        if value is None:
            return
        value = str(value).strip()
        if value and value not in candidates:
            candidates.append(value)

    add_candidate(event.get("reference"))
    add_candidate(event.get("order_id"))

    metadata = event.get("metadata")
    if isinstance(metadata, dict):
        for key in (
            "lbv_reference_id",
            "reference",
            "reference_id",
            "payment_reference",
        ):
            add_candidate(metadata.get(key))

    print("LOOKUP CANDIDATES:", candidates)

    for reference in candidates:
        response = (
            supabase
            .table("payment_transactions")
            .select("*")
            .eq("reference", reference)
            .limit(1)
            .execute()
        )

        if response.data:
            return response.data[0]

    return None


def _update_payment_transaction_from_chariow(
    payment_transaction,
    event,
    success,
    supabase,
):
    reference = str(payment_transaction["reference"]).strip()

    existing_metadata = payment_transaction.get("metadata")
    if not isinstance(existing_metadata, dict):
        existing_metadata = {}

    chariow_metadata = event.get("metadata")
    if not isinstance(chariow_metadata, dict):
        chariow_metadata = {}

    merged_metadata = {
        **existing_metadata,
        "chariow": {
            "event": event.get("event"),
            "status": event.get("status"),
            "order_id": event.get("order_id"),
            "provider_transaction_id": event.get(
                "provider_transaction_id"
            ),
            "product_id": event.get("product_id"),
            "email": event.get("email"),
            "amount": event.get("amount"),
            "paid_at": event.get("paid_at"),
            "metadata": chariow_metadata,
        },
    }

    update_payload = {
        "status": "paid" if success else (event.get("status") or "pending"),
        "metadata": merged_metadata,
        "provider": payment_transaction.get("provider") or "chariow",
    }

    provider_transaction_id = event.get("provider_transaction_id")
    if provider_transaction_id:
        update_payload["provider_transaction_id"] = str(provider_transaction_id)

    if success:
        paid_at = event.get("paid_at")
        if paid_at:
            update_payload["paid_at"] = str(paid_at)

    print("UPDATE PAYLOAD:", update_payload)

    response = (
        supabase
        .table("payment_transactions")
        .update(update_payload)
        .eq("reference", reference)
        .execute()
    )

    if not response.data:
        raise RuntimeError("Aucune ligne mise à jour.")

    return response.data[0]


# ============================================================
# SIMULATION DE LA LIGNE QUI EXISTE AVANT LE PAIEMENT
# ============================================================

LOCAL_TRANSACTION = {
    "id": "474315d3-05bd-4ace-8c19-923bfc53c52e",
    "user_id": "8fe64090-8378-4c61-b4b7-e4c0704d0e0c",
    "reference": "LBV-20260830181953-7AA392EE9E",
    "payment_type": "primary_pack",
    "pack_id": "light_pack",
    "addon_id": None,
    "provider": "chariow",
    "amount": 4000,
    "currency": "XAF",
    "credits": 3000,
    "status": "pending",
    "provider_transaction_id": None,
    "metadata": {
        "source": "lbv_connect",
        "version": "v1",
        "endpoint": "/payments/checkout",
        "lbv_reference_id": "LBV-20260830181953-7AA392EE9E",
        "lbv_user_id": "8fe64090-8378-4c61-b4b7-e4c0704d0e0c",
        "lbv_product_id": "light_pack",
        "lbv_payment_type": "primary_pack",
        "lbv_credits": 3000,
    },
    "created_at": "2026-08-30T18:19:53.000000Z",
    "paid_at": None,
}


# ============================================================
# TEST
# ============================================================

if __name__ == "__main__":
    supabase = FakeSupabase([LOCAL_TRANSACTION])

    print("\n=== 1. NORMALISATION ===")
    event = _normalize_chariow_event(CHARIOW_PAYLOAD)

    print("event       =", event["event"])
    print("status      =", event["status"])
    print("reference   =", event["reference"])
    print("paid_at     =", event["paid_at"])
    print("provider_id =", event["provider_transaction_id"])
    print("product_id  =", event["product_id"])
    print("user_id     =", event["user_id"])

    assert event["event"] == "successful.sale"
    assert event["status"] == "completed"
    assert event["reference"] == "LBV-20260830181953-7AA392EE9E"
    assert event["paid_at"] == "2026-08-30T18:21:01.000000Z"
    assert event["provider_transaction_id"] == "SALEO4U030DWC6TAYIN"

    success = _is_chariow_success(event)
    print("payment_success =", success)
    assert success is True

    print("\n=== 2. RECHERCHE payment_transactions ===")
    transaction = _find_chariow_payment_transaction(event, supabase)

    assert transaction is not None
    print("FOUND reference =", transaction["reference"])
    print("FOUND status    =", transaction["status"])
    print("FOUND paid_at   =", transaction["paid_at"])

    print("\n=== 3. UPDATE SUPABASE ===")
    updated = _update_payment_transaction_from_chariow(
        payment_transaction=transaction,
        event=event,
        success=success,
        supabase=supabase,
    )

    print("AFTER status                  =", updated["status"])
    print("AFTER paid_at                 =", updated["paid_at"])
    print("AFTER provider_transaction_id =", updated["provider_transaction_id"])

    assert updated["status"] == "paid"
    assert updated["paid_at"] == "2026-08-30T18:21:01.000000Z"
    assert updated["provider_transaction_id"] == "SALEO4U030DWC6TAYIN"

    print("\n=== 4. ÉTAT FINAL DE payment_transactions ===")
    print(updated)

    print("\n✅ TEST RÉUSSI : le payload Chariow est correctement")
    print("   normalisé → retrouvé par référence → écrit dans Supabase.")