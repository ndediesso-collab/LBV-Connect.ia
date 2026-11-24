"""P4: read-only private artifact lookup and signed URLs.

Artifact bytes are created by the principal ORIA ArtifactService and staged with
P2's audited storage helper. Never expose a Storage path without validating the
workspace/room RPC under the authenticated actor.
"""
from __future__ import annotations
from typing import Any
from uuid import UUID
from fastapi import HTTPException
from app.services.oria_collab_chat_hub_service import BUCKET


def _rpc(db: Any, function: str, params: dict) -> dict:
    try:
        res=db.rpc(function,params).execute()
        value=getattr(res,'data',None)
        if isinstance(value,list) and len(value)==1:value=value[0]
        if not isinstance(value,dict) or value.get('success') is not True:
            raise ValueError('signed_artifact_rpc_invalid')
        return value
    except Exception as exc:
        raise HTTPException(404,'Fichier professionnel inaccessible dans cet espace.') from exc


def list_private_files(db: Any, actor: str, space: str, conversation: str) -> dict:
    ws,uid,conv=(str(UUID(x)) for x in (space,actor,conversation))
    result=_rpc(db,'oria_collab_private_generated_files_v1',{
        'p_actor_user_id':uid,'p_workspace_id':ws,'p_conversation_id':conv,
    })
    if result.get('workspace_id')!=ws or result.get('conversation_id')!=conv:
        raise HTTPException(503,'Liste des fichiers hors de cet espace.')
    files=result.get('files')
    if not isinstance(files,list):raise HTTPException(503,'Liste documentaire incohérente.')
    return {'success':True,'workspace_id':ws,'conversation_id':conv,'files':files}


def private_file_url(db: Any, actor: str, space: str, file_id: str) -> dict:
    ws,uid,fid=(str(UUID(x)) for x in (space,actor,file_id))
    result=_rpc(db,'oria_collab_private_generated_file_access_v1',{
        'p_actor_user_id':uid,'p_workspace_id':ws,'p_file_id':fid,
    })
    path=result.get('storage_path')
    if (result.get('workspace_id')!=ws or result.get('file_id')!=fid or
        not isinstance(path,str) or not path.startswith(ws+'/')):
        raise HTTPException(503,'Accès au fichier hors de cet espace.')
    try:
        value=db.storage.from_(BUCKET).create_signed_url(path,30)
    except Exception as exc:
        raise HTTPException(503,'Lien privé temporaire indisponible.') from exc
    url=(value.get('signedURL') or value.get('signedUrl') or value.get('signed_url')) if isinstance(value,dict) else None
    if not isinstance(url,str) or not url.startswith('https://'):
        raise HTTPException(503,'Lien privé incohérent.')
    return {'success':True,'workspace_id':ws,'file_id':fid,'url':url,'expires_in':30}
