"""One ORIA-style chat interface for spaces, with WhatsApp-like group bubbles."""
from __future__ import annotations

from uuid import UUID
from fastapi import APIRouter, Header, HTTPException, Query, UploadFile, File, Form
from pydantic import BaseModel, Field

from app.core.supabase import supabase
from app.route.collab_profiles import require_user
from app.services.oria_collab_chat_hub_service import ChatHubService, MAX_UPLOAD

router = APIRouter(prefix="/collaboratif/workspaces/{workspace_id}/hub",
                   tags=["ORIA Collaboratif chat unifié"])


def service(user_id: str | None, authorization: str | None) -> tuple[ChatHubService,str]:
    return ChatHubService(supabase), require_user(user_id,authorization)


class OpenDirect(BaseModel):
    other_user_id: UUID


class SendMessage(BaseModel):
    client_message_id: UUID
    content: str = Field(min_length=1,max_length=8000)


@router.get("/boot")
def boot(workspace_id: UUID, user_id: str|None=Header(None,alias="user-id"),
         authorization: str|None=Header(None,alias="authorization")):
    srv,actor=service(user_id,authorization)
    return srv.boot(actor,str(workspace_id))


@router.get("/groups/{group_id}/messages")
def group_messages(workspace_id: UUID,group_id: UUID,before: UUID|None=Query(None),
     limit:int=Query(70,ge=1,le=100),user_id:str|None=Header(None,alias="user-id"),
     authorization:str|None=Header(None,alias="authorization")):
    srv,actor=service(user_id,authorization)
    return srv.group_read(actor,str(workspace_id),str(group_id),str(before) if before else None,limit)


@router.post("/direct/open")
def direct_open(workspace_id:UUID,body:OpenDirect,user_id:str|None=Header(None,alias="user-id"),
    authorization:str|None=Header(None,alias="authorization")):
    srv,actor=service(user_id,authorization)
    return srv.direct_open(actor,str(workspace_id),str(body.other_user_id))


@router.get("/direct")
def direct_list(workspace_id:UUID,user_id:str|None=Header(None,alias="user-id"),
    authorization:str|None=Header(None,alias="authorization")):
    srv,actor=service(user_id,authorization)
    return srv.direct_list(actor,str(workspace_id))


@router.get("/direct/{thread_id}/messages")
def direct_messages(workspace_id:UUID,thread_id:UUID,before:UUID|None=Query(None),
    limit:int=Query(70,ge=1,le=100),user_id:str|None=Header(None,alias="user-id"),
    authorization:str|None=Header(None,alias="authorization")):
    srv,actor=service(user_id,authorization)
    return srv.direct_read(actor,str(workspace_id),str(thread_id),str(before) if before else None,limit)


@router.post("/rooms/{room_type}/{room_id}/messages")
def send(workspace_id:UUID,room_type:str,room_id:UUID,body:SendMessage,
    user_id:str|None=Header(None,alias="user-id"),
    authorization:str|None=Header(None,alias="authorization")):
    srv,actor=service(user_id,authorization)
    max_len = 4000 if room_type=="group" else 8000
    if len(body.content)>max_len:
        raise HTTPException(422,"Message trop long.")
    return srv.send(actor,str(workspace_id),room_type,str(room_id),body.content,str(body.client_message_id))


@router.get("/notifications")
def notices(workspace_id:UUID,user_id:str|None=Header(None,alias="user-id"),
    authorization:str|None=Header(None,alias="authorization")):
    srv,actor=service(user_id,authorization)
    return srv.notices(actor,str(workspace_id))


@router.post("/notifications/read")
def mark_read(workspace_id:UUID,user_id:str|None=Header(None,alias="user-id"),
    authorization:str|None=Header(None,alias="authorization")):
    srv,actor=service(user_id,authorization)
    return srv.mark_read(actor,str(workspace_id))


@router.get("/rooms/{room_type}/{room_id}/files")
def files_list(workspace_id:UUID,room_type:str,room_id:UUID,
    user_id:str|None=Header(None,alias="user-id"),
    authorization:str|None=Header(None,alias="authorization")):
    srv,actor=service(user_id,authorization)
    return srv.files(actor,str(workspace_id),room_type,str(room_id))


@router.post("/rooms/{room_type}/{room_id}/files")
async def upload(workspace_id:UUID,room_type:str,room_id:UUID,
     file:UploadFile=File(...),caption:str=Form(""),
     user_id:str|None=Header(None,alias="user-id"),
     authorization:str|None=Header(None,alias="authorization")):
    srv,actor=service(user_id,authorization)
    try:
        raw=await file.read(MAX_UPLOAD+1)
    finally:
        await file.close()
    return srv.upload(actor,str(workspace_id),room_type,str(room_id),
        file.filename or "",raw,file.content_type,caption)


@router.get("/files/{file_id}/url")
def file_url(workspace_id:UUID,file_id:UUID,
    user_id:str|None=Header(None,alias="user-id"),
    authorization:str|None=Header(None,alias="authorization")):
    srv,actor=service(user_id,authorization)
    return srv.file_url(actor,str(workspace_id),str(file_id))
