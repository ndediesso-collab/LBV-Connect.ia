"""Backend-only Supabase RPC gateway for ORIA free-tier staging.

NEVER use an end-user Supabase client for this. The 4 SQL RPCs are service_role only.
"""
from __future__ import annotations

from decimal import Decimal, InvalidOperation
from uuid import UUID


class FreeTierRpcError(RuntimeError):
    pass


def _uuid(value: str) -> str:
    try:
        return str(UUID(str(value)))
    except (TypeError, ValueError, AttributeError) as exc:
        raise FreeTierRpcError("Invalid UUID.") from exc


def _positive_credits(value: int) -> int:
    if type(value) is not int or value <= 0:
        raise FreeTierRpcError("Positive integer credits required.")
    return value


def _nonnegative_credits(value: int) -> int:
    if type(value) is not int or value < 0:
        raise FreeTierRpcError("Nonnegative integer credits required.")
    return value


def _xaf(value: object, *, zero_ok: bool) -> str:
    try:
        result = Decimal(str(value))
    except (InvalidOperation, TypeError, ValueError) as exc:
        raise FreeTierRpcError("Invalid provider cost.") from exc
    if not result.is_finite() or result < 0 or (result == 0 and not zero_ok):
        raise FreeTierRpcError("Invalid provider cost.")
    return format(result, 'f')


class FreeTierGateway:
    def __init__(self, supabase_service_client):
        self.client = supabase_service_client

    def _rpc(self, name: str, params: dict) -> dict:
        response = self.client.rpc(name, params).execute()
        data = getattr(response, "data", None)
        if isinstance(data, list) and len(data) == 1:
            data = data[0]
        if not isinstance(data, dict):
            raise FreeTierRpcError(f"Invalid RPC response: {name}.")
        return data

    def grant(self, user_id: str) -> dict:
        return self._rpc("oria_free_grant_if_eligible", {"p_user_id": _uuid(user_id)})

    def reserve(self, user_id: str, reservation_id: str, credits: int,
                estimated_api_xaf: object, *, action: str = "chat_luna") -> dict:
        if action not in {"chat_luna", "free_pdf_luna", "free_docx_luna", "free_image_recraft"}:
            raise FreeTierRpcError("Unsupported free-tier action.")
        return self._rpc("oria_free_reserve", {
            "p_user_id": _uuid(user_id),
            "p_reservation_id": _uuid(reservation_id),
            "p_amount": _positive_credits(credits),
            "p_api_reservation_xaf": _xaf(estimated_api_xaf, zero_ok=False),
            "p_action": action,
            "p_ttl_seconds": 900,
        })

    def settle(self, user_id: str, reservation_id: str, credits: int,
               actual_api_xaf: object) -> dict:
        return self._rpc("oria_free_settle", {
            "p_user_id": _uuid(user_id),
            "p_reservation_id": _uuid(reservation_id),
            "p_actual_credits": _nonnegative_credits(credits),
            "p_actual_api_xaf": _xaf(actual_api_xaf, zero_ok=True),
        })

    def release_if_definite_failure(self, user_id: str, reservation_id: str) -> dict:
        """Only call after proving provider was NOT charged; never on timeout."""
        return self._rpc("oria_free_release", {
            "p_user_id": _uuid(user_id),
            "p_reservation_id": _uuid(reservation_id),
        })

    def balance(self, user_id: str) -> dict:
        rows = (self.client.table("oria_free_credit_wallets")
                .select("free_balance,purchased_balance,purchased_expires_at,last_grant_day,recharge_frozen")
                .eq("user_id", _uuid(user_id)).limit(1).execute().data or [])
        if not rows:
            return {"free_credits": 0, "purchased_credits": 0, "balance": 0,
                    "purchased_expires_at": None}
        row = rows[0]
        free = row.get("free_balance")
        paid = row.get("purchased_balance")
        if type(free) is not int or type(paid) is not int or free < 0 or paid < 0:
            raise FreeTierRpcError("Invalid free-tier wallet state.")
        return {"free_credits": free, "purchased_credits": paid, "balance": free + paid,
                "last_grant_day": row.get("last_grant_day"),
                "recharge_frozen": row.get("recharge_frozen"),
                "purchased_expires_at": row.get("purchased_expires_at")}
