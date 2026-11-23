"""Space-explicit write APIs, never rely on a global selected workspace."""
from uuid import UUID

from fastapi import APIRouter, Header, HTTPException
from pydantic import BaseModel, Field

from app.core.supabase import supabase
from app.route.collab_profiles import require_user
from app.services.oria_collab_scoped_actions_service import ScopedActionsService

router = APIRouter(prefix="/collaboratif/workspaces/{workspace_id}/actions",
                   tags=["ORIA Collaboratif opérations contextualisées"])


def client(user_id: str | None, authorization: str | None) -> tuple[ScopedActionsService, str]:
    # Authentication must happen before any privileged service_role RPC.
    return ScopedActionsService(supabase), require_user(user_id, authorization)


class CreateConversation(BaseModel):
    title: str = Field(min_length=1, max_length=120)


class CreateGroup(BaseModel):
    title: str = Field(min_length=1, max_length=100)
    description: str = Field(default="", max_length=500)


class Participant(BaseModel):
    member_user_id: UUID
    add: bool


class Archive(BaseModel):
    archived: bool


class Post(BaseModel):
    client_message_id: UUID
    content: str = Field(min_length=1, max_length=4000)


class Transfer(BaseModel):
    from_user_id: UUID
    to_user_id: UUID
    credits: int = Field(ge=1, le=1200000000)
    kind: str = Field(pattern=r"^(pack|personal)$")


class Checkout(BaseModel):
    billing_email: str = Field(min_length=3, max_length=254)
    addon_id: str


class ExtensionCheckout(BaseModel):
    billing_email: str = Field(min_length=3, max_length=254)


@router.post("/private/conversations")
def create_private(workspace_id: UUID, body: CreateConversation,
                   user_id: str | None = Header(None, alias="user-id"),
                   authorization: str | None = Header(None, alias="authorization")):
    client(user_id, authorization)
    raise HTTPException(410, "Conversations privées supprimées d’ORIA Collaboratif. Créez un groupe depuis le chat.")


@router.post("/groups")
def create_group(workspace_id: UUID, body: CreateGroup,
                 user_id: str | None = Header(None, alias="user-id"),
                 authorization: str | None = Header(None, alias="authorization")):
    service, actor = client(user_id, authorization)
    return service.call("group_create", actor, str(workspace_id),
                        p_title=body.title, p_description=body.description)


@router.post("/groups/{group_id}/participants")
def participant(workspace_id: UUID, group_id: UUID, body: Participant,
                user_id: str | None = Header(None, alias="user-id"),
                authorization: str | None = Header(None, alias="authorization")):
    service, actor = client(user_id, authorization)
    return service.call("group_participant", actor, str(workspace_id),
                        p_group_id=str(group_id), p_member_user_id=str(body.member_user_id), p_add=body.add)


@router.patch("/groups/{group_id}/archive")
def archive_group(workspace_id: UUID, group_id: UUID, body: Archive,
                  user_id: str | None = Header(None, alias="user-id"),
                  authorization: str | None = Header(None, alias="authorization")):
    service, actor = client(user_id, authorization)
    return service.call("group_archive", actor, str(workspace_id),
                        p_group_id=str(group_id), p_archived=body.archived)


@router.post("/groups/{group_id}/messages")
def post_message(workspace_id: UUID, group_id: UUID, body: Post,
                 user_id: str | None = Header(None, alias="user-id"),
                 authorization: str | None = Header(None, alias="authorization")):
    service, actor = client(user_id, authorization)
    return service.call("group_post", actor, str(workspace_id),
                        p_group_id=str(group_id), p_client_message_id=str(body.client_message_id),
                        p_content=body.content)


@router.post("/quotas/transfer")
def transfer(workspace_id: UUID, body: Transfer,
             user_id: str | None = Header(None, alias="user-id"),
             authorization: str | None = Header(None, alias="authorization")):
    service, actor = client(user_id, authorization)
    return service.call("quota_transfer", actor, str(workspace_id),
                        p_from_user_id=str(body.from_user_id), p_to_user_id=str(body.to_user_id),
                        p_amount=body.credits, p_kind=body.kind)


@router.post("/recharges/checkout")
def recharge_checkout(workspace_id: UUID, body: Checkout,
                      user_id: str | None = Header(None, alias="user-id"),
                      authorization: str | None = Header(None, alias="authorization")):
    service, actor = client(user_id, authorization)
    return service.checkout(actor, str(workspace_id), product_id=body.addon_id,
                            email=body.billing_email)


@router.post("/groups/{group_id}/extensions/checkout")
def extension_checkout(workspace_id: UUID, group_id: UUID, body: ExtensionCheckout,
                       user_id: str | None = Header(None, alias="user-id"),
                       authorization: str | None = Header(None, alias="authorization")):
    service, actor = client(user_id, authorization)
    return service.checkout(actor, str(workspace_id), product_id="oria_collab_messages_5000",
                            group_id=str(group_id), email=body.billing_email)
