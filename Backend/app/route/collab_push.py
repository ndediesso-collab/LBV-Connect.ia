"""P16 - API de préférences et appareils Web Push. Jamais de clé VAPID privée en HTTP."""
from __future__ import annotations

from uuid import UUID
from fastapi import APIRouter, Header
from pydantic import BaseModel, Field
from typing import Literal

from app.core.supabase import supabase
from app.route.collab_profiles import require_user
from app.services.oria_collab_push_service import CollabPushService

router=APIRouter(prefix="/collaboratif/workspaces/{workspace_id}/push",
                 tags=["ORIA Collaboratif - notifications P16"])


class Prefs(BaseModel):
    push_enabled: bool
    sound_enabled: bool=True
    mode: Literal["all","important","muted"]="all"


class RoomPrefs(BaseModel):
    mode: Literal["all","important","muted"]


class SubscriptionKeys(BaseModel):
    p256dh: str=Field(min_length=40,max_length=300)
    auth: str=Field(min_length=10,max_length=300)


class Subscription(BaseModel):
    endpoint: str=Field(min_length=20,max_length=2048)
    keys: SubscriptionKeys


class Presence(BaseModel):
    group_id: UUID|None=None
    focused: bool=False


class Unsubscribe(BaseModel):
    endpoint: str=Field(min_length=20,max_length=2048)


def srv(user_id: str|None, authorization:str|None) -> tuple[CollabPushService,str]:
    return CollabPushService(supabase),require_user(user_id,authorization)


@router.get("/config")
def config(workspace_id:UUID, user_id:str|None=Header(None,alias="user-id"),
           authorization:str|None=Header(None,alias="authorization")):
    service,actor=srv(user_id,authorization)
    service.auth(actor,str(workspace_id))
    return service.config()


@router.get("/settings")
def settings(workspace_id:UUID,user_id:str|None=Header(None,alias="user-id"),
             authorization:str|None=Header(None,alias="authorization")):
    service,actor=srv(user_id,authorization)
    return service.settings(actor,str(workspace_id))


@router.patch("/settings")
def update(workspace_id:UUID,body:Prefs,user_id:str|None=Header(None,alias="user-id"),
           authorization:str|None=Header(None,alias="authorization")):
    service,actor=srv(user_id,authorization)
    return service.update(actor,str(workspace_id),push_enabled=body.push_enabled,
                          sound_enabled=body.sound_enabled,notification_mode=body.mode)


@router.patch("/groups/{group_id}/settings")
def group_update(workspace_id:UUID,group_id:UUID,body:RoomPrefs,
             user_id:str|None=Header(None,alias="user-id"),
             authorization:str|None=Header(None,alias="authorization")):
    service,actor=srv(user_id,authorization)
    return service.room_update(actor,str(workspace_id),str(group_id),body.mode)


@router.post("/subscriptions")
def subscribe(workspace_id:UUID,body:Subscription,
              user_id:str|None=Header(None,alias="user-id"),
              authorization:str|None=Header(None,alias="authorization")):
    service,actor=srv(user_id,authorization)
    return service.subscribe(actor,str(workspace_id),body.endpoint,
                             body.keys.p256dh,body.keys.auth)


@router.post("/subscriptions/remove")
def remove(workspace_id:UUID,body:Unsubscribe,
             user_id:str|None=Header(None,alias="user-id"),
             authorization:str|None=Header(None,alias="authorization")):
    service,actor=srv(user_id,authorization)
    return service.unsubscribe(actor,str(workspace_id),body.endpoint)


@router.post("/presence")
def presence(workspace_id:UUID,body:Presence,
             user_id:str|None=Header(None,alias="user-id"),
             authorization:str|None=Header(None,alias="authorization")):
    service,actor=srv(user_id,authorization)
    return service.presence(actor,str(workspace_id),
                            str(body.group_id) if body.group_id else None,body.focused)
