"""Lecture du solde personnel et rapprochement : le checkout reste /payments/checkout."""
from fastapi import APIRouter, Header

from app.core.supabase import supabase
from app.route.collab_profiles import require_user
from app.services.oria_collab_payment_bridge import personal_balance, reconcile_own_paid

router = APIRouter(prefix="/collaboratif", tags=["ORIA Collaboratif recharges"])


@router.get("/personal-wallet")
def get_personal_wallet(user_id: str | None = Header(None, alias="user-id"),
                        authorization: str | None = Header(None, alias="authorization")):
    uid = require_user(user_id, authorization)
    return personal_balance(supabase, uid)


@router.post("/personal-wallet/reconcile")
def reconcile_personal_wallet(user_id: str | None = Header(None, alias="user-id"),
                              authorization: str | None = Header(None, alias="authorization")):
    uid = require_user(user_id, authorization)
    return reconcile_own_paid(supabase, uid)
