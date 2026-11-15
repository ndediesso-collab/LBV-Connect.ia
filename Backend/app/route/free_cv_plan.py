"""Non-billable CV preflight for users without a paid pack.

Uses the same CV parsing rules as the paid chat. Does not call a provider,
reserve credits, or store CV personal data. Server ownership and free flag
remain mandatory even for a cost-free questionnaire.
"""
from __future__ import annotations

from fastapi import APIRouter, Header, HTTPException
from pydantic import BaseModel, ConfigDict, Field

from app.core.supabase import supabase
from app.route.free_chat import _enabled, _identity
from app.services.free_tier_gateway import FreeTierGateway
from app.services.oria_cv_flow import analyze_cv_turn

router = APIRouter(prefix="/free", tags=["ORIA Gratuit - CV"])


class CVHistoryLine(BaseModel):
    model_config = ConfigDict(extra="forbid")
    role: str = Field(pattern="^(user|assistant)$")
    content: str = Field(max_length=12000)


class CVPlanRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    message: str = Field(min_length=1, max_length=12000)
    history: list[CVHistoryLine] = Field(default_factory=list, max_length=22)
    explicit_type: str | None = Field(default=None, pattern="^(pdf|docx)$")


@router.post("/cv/plan")
def free_cv_plan(
    payload: CVPlanRequest,
    user_id: str | None = Header(default=None, alias="user-id"),
    authorization: str | None = Header(default=None, alias="authorization"),
):
    _enabled()
    uid = _identity(user_id, authorization)
    grant = FreeTierGateway(supabase).grant(uid)
    if grant.get("enabled") is not True:
        raise HTTPException(503, "Accès gratuit inactif.")
    if grant.get("paid_pack_active") is True:
        raise HTTPException(403, "Ce questionnaire gratuit est réservé aux comptes sans pack actif.")
    decision = analyze_cv_turn(payload.message, [line.model_dump() for line in payload.history],
                               explicit_type=payload.explicit_type)
    if decision is None:
        return {"success": True, "is_cv": False}
    return {
        "success": True, "is_cv": True, "ready": decision.ready,
        "question": decision.question, "style": decision.style,
        "format": decision.fmt, "missing": list(decision.missing),
        "profile_text": decision.profile_text if decision.ready else None,
    }
