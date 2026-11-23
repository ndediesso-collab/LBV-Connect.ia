"""5C. Authenticated owner-only group capacity checkout and read-only status."""
from uuid import UUID

from fastapi import APIRouter, Header
from pydantic import BaseModel, Field

from app.core.supabase import supabase
from app.route.collab_profiles import require_user
from app.services.oria_collab_message_extensions_service import create_checkout, purchase_status

router = APIRouter(prefix='/collaboratif/groups', tags=['ORIA Collaboratif capacité messages'])

class PurchaseMessageExtension(BaseModel):
    billing_email: str = Field(min_length=3, max_length=254)

@router.post('/{group_id}/message-extensions/checkout')
def purchase(group_id: UUID, body: PurchaseMessageExtension,
             user_id: str | None = Header(None, alias='user-id'),
             authorization: str | None = Header(None, alias='authorization')):
    actor = require_user(user_id, authorization)
    return create_checkout(supabase, actor_id=actor, group_id=group_id,
                           email=body.billing_email)

@router.get('/{group_id}/message-extensions')
def status(group_id: UUID,
           user_id: str | None = Header(None, alias='user-id'),
           authorization: str | None = Header(None, alias='authorization')):
    actor = require_user(user_id, authorization)
    return purchase_status(supabase, actor_id=actor, group_id=group_id)
