"""ORIA Mini-Film V7: durable multi-scene planning, reuse of paid clip jobs, safe FFmpeg montage.
No new provider calls here: each scene uses the existing authenticated /openrouter-media/quote
and /openrouter-media/video endpoints, with user consent and wallet settlement.
"""
from __future__ import annotations

import base64
import binascii
import os
import shutil
import re
import subprocess
import tempfile
import time
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlsplit, unquote
from uuid import uuid4
from typing import Callable, Any

from fastapi import APIRouter, BackgroundTasks, HTTPException, Header
from pydantic import BaseModel, Field

_P = "oria_video_projects"
_S = "oria_video_project_scenes"
UUID_RE = re.compile(r"^[0-9a-fA-F]{8}-(?:[0-9a-fA-F]{4}-){3}[0-9a-fA-F]{12}$")
MAX_TRACK = 8 * 1024 * 1024
MAX_CLIP = 90 * 1024 * 1024
MAX_FINAL = 180 * 1024 * 1024

class SceneInput(BaseModel):
    prompt: str = Field(min_length=10, max_length=2500)
    duration_seconds: int
    action: str = Field(min_length=3, max_length=80)

class ProjectCreate(BaseModel):
    title: str = Field(min_length=3, max_length=100)
    brief: str = Field(min_length=10, max_length=2500)
    style: str = Field(default="cinématique", max_length=100)
    aspect_ratio: str = "9:16"
    model: str = Field(min_length=3, max_length=200)
    generate_audio: bool = False
    continue_from_previous: bool = False
    scenes: list[SceneInput] = Field(min_length=2, max_length=32)

class SceneEdit(BaseModel):
    prompt: str = Field(min_length=10, max_length=2500)

class RenderRequest(BaseModel):
    music_b64: str | None = None
    voice_b64: str | None = None
    music_volume: float = Field(default=0.16, ge=0, le=0.5)
    transition: str = Field(default="fade", pattern="^(fade|cut)$")
    keep_scene_audio: bool = True
    rights_confirmed: bool = False


def require_id(raw: str) -> str:
    if not UUID_RE.fullmatch(raw):
        raise HTTPException(400, "Identifiant de projet invalide.")
    return raw


def project_payload(project: dict, scenes: list[dict]) -> dict:
    p = {k: project.get(k) for k in (
        "id", "title", "brief", "style", "aspect_ratio", "model", "generate_audio", "pack_id",
        "status", "continue_from_previous", "output_media_id", "output_url", "created_at", "updated_at", "error_message")}
    p["scenes"] = [{k: s.get(k) for k in (
        "id", "position", "prompt", "duration_seconds", "action", "request_id", "status",
        "media_id", "media_url", "error_message")} for s in scenes]
    p["duration_seconds"] = sum(int(s["duration_seconds"]) for s in scenes)
    p["success"] = True
    return p


def normalize_text(text: str) -> str:
    return " ".join(text.strip().split())


def decode_track(raw: str | None, label: str) -> bytes | None:
    if not raw:
        return None
    if len(raw) > (MAX_TRACK * 4 // 3 + 1024):
        raise HTTPException(413, f"{label} trop volumineuse (8 Mo max).")
    try:
        data = base64.b64decode(raw, validate=True)
    except (ValueError, binascii.Error) as exc:
        raise HTTPException(400, f"{label} invalide.") from exc
    if not 0 < len(data) <= MAX_TRACK:
        raise HTTPException(413, f"{label} trop volumineuse.")
    return data


def _run(args: list[str], *, timeout: int = 150) -> bytes:
    try:
        p = subprocess.run(args, capture_output=True, timeout=timeout, check=False)
    except (FileNotFoundError, subprocess.TimeoutExpired) as exc:
        raise RuntimeError("Moteur FFmpeg indisponible ou délai de montage dépassé.") from exc
    if p.returncode:
        # Do not persist raw ffmpeg stderr, which may include user or storage paths.
        raise RuntimeError("FFmpeg n'a pas pu traiter ce média (codec, format ou fichier).");
    return p.stdout


def _has_audio(path: Path) -> bool:
    result = _run(["ffprobe", "-v", "error", "-select_streams", "a:0", "-show_entries",
                   "stream=codec_type", "-of", "default=noprint_wrappers=1:nokey=1", str(path)], timeout=20)
    return b"audio" in result


def _is_audio(path: Path) -> bool:
    try:
        return _has_audio(path)
    except Exception:
        return False


def _verified_storage_object(db: Any, uid: str, media_id: str, url: str) -> tuple[str, str]:
    """Never fetch URLs from user input; download ONLY user's known Supabase storage objects."""
    record = (db.table("generated_media").select("*").eq("id", media_id)
              .eq("user_id", uid).limit(1).execute().data or [])
    if not record:
        raise RuntimeError("Média privé ou introuvable dans le compte.")
    storage_path = record[0].get("storage_path")
    if not isinstance(storage_path, str) or not storage_path.startswith(uid + "/") or ".." in storage_path:
        raise RuntimeError("Chemin du média non autorisé.")
    parsed = urlsplit(url)
    expected = urlsplit(os.getenv("SUPABASE_URL", ""))
    if not expected.hostname or parsed.scheme != "https" or parsed.hostname != expected.hostname or parsed.port not in (None, 443):
        raise RuntimeError("URL de stockage différente du Supabase ORIA.")
    m = re.match(r"^/storage/v1/object/(?:public|sign)/([^/]+)/(.+)$", parsed.path)
    if not m:
        raise RuntimeError("Stockage média non reconnu.")
    bucket, actual_path = unquote(m.group(1)), unquote(m.group(2))
    if actual_path != storage_path or not re.fullmatch(r"[a-zA-Z0-9_-]{1,80}", bucket):
        raise RuntimeError("Le média ne correspond pas à son chemin enregistré.")
    return bucket, storage_path


def _download_owned_media(db: Any, uid: str, media_id: str, url: str, to: Path) -> None:
    bucket, object_path = _verified_storage_object(db, uid, media_id, url)
    payload = db.storage.from_(bucket).download(object_path)
    if not isinstance(payload, bytes) or not (0 < len(payload) <= MAX_CLIP):
        raise RuntimeError("Taille du clip invalide ou excessive.")
    to.write_bytes(payload)


def render_montage(paths: list[Path], out: Path, *, aspect: str,
                   music: bytes | None = None, voice: bytes | None = None,
                   music_volume: float = 0.16, keep_scene_audio: bool = True,
                   transition: str = "cut") -> None:
    """Normalize every clip to a common stream; then concat, then optional licensed audio mix."""
    if not paths or len(paths) > 32:
        raise RuntimeError("Nombre de scènes invalide.")
    w,h = (720,1280) if aspect == "9:16" else (1280,720)
    with tempfile.TemporaryDirectory(prefix="oria-v7-mix-") as t:
        d = Path(t)
        normalized: list[Path] = []
        for idx, original in enumerate(paths):
            clean = d / f"scene_{idx:02}.mp4"
            visual = f"scale={w}:{h}:force_original_aspect_ratio=decrease,pad={w}:{h}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=24"
            if transition == "fade":
                meta = _run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "default=nokey=1:noprint_wrappers=1", str(original)], timeout=20)
                try:
                    duration = float(meta.decode().strip())
                except (ValueError, UnicodeError):
                    duration = 0
                if duration >= 0.7:
                    visual += f",fade=t=in:st=0:d=0.2,fade=t=out:st={max(0.3,duration-0.2):.3f}:d=0.2"
            src_has_audio = _has_audio(original) if keep_scene_audio else False
            args = ["ffmpeg", "-hide_banner", "-loglevel", "error", "-nostdin", "-y", "-i", str(original)]
            if not src_has_audio:
                args += ["-f", "lavfi", "-i", "anullsrc=channel_layout=stereo:sample_rate=44100"]
            args += ["-map", "0:v:0", "-map", "0:a:0" if src_has_audio else "1:a:0", "-vf",
                     visual,
                     "-c:v", "libx264", "-preset", "veryfast", "-crf", "24", "-pix_fmt", "yuv420p",
                     "-c:a", "aac", "-ac", "2", "-ar", "44100", "-b:a", "128k",
                     "-shortest", "-movflags", "+faststart", str(clean)]
            _run(args, timeout=120)
            normalized.append(clean)
        playlist = d / "playlist.txt"
        playlist.write_text("ffconcat version 1.0\n" + "".join(f"file '{p.name}'\n" for p in normalized))
        joined = d / "joined.mp4"
        _run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-nostdin", "-y", "-f", "concat", "-safe", "1",
              "-i", str(playlist), "-c", "copy", "-movflags", "+faststart", str(joined)], timeout=120)
        layers: list[Path] = []
        for idx, blob in enumerate((music, voice)):
            if blob:
                path = d / f"track_{idx}.audio"
                path.write_bytes(blob)
                if not _is_audio(path):
                    raise RuntimeError("Fichier sonore non reconnu par FFmpeg.")
                layers.append(path)
        if not layers:
            out.write_bytes(joined.read_bytes()); return
        args = ["ffmpeg", "-hide_banner", "-loglevel", "error", "-nostdin", "-y", "-i", str(joined)]
        for p in layers:
            args += ["-stream_loop", "-1" if p == layers[0] and music else "0", "-i", str(p)]
        audio_filters = ["[0:a]volume=1.0[original]"]
        tags = ["[original]"]
        for i, p in enumerate(layers):
            audio_filters.append(f"[{i+1}:a]volume={music_volume if music and i == 0 else 0.85}[track{i}]")
            tags.append(f"[track{i}]")
        audio_filters.append("".join(tags) + f"amix=inputs={len(tags)}:duration=first:dropout_transition=2[aout]")
        args += ["-filter_complex", ";".join(audio_filters), "-map", "0:v:0", "-map", "[aout]",
                 "-c:v", "copy", "-c:a", "aac", "-b:a", "160k", "-shortest",
                 "-movflags", "+faststart", str(out)]
        _run(args, timeout=150)


def install(router: APIRouter, *, db: Any, authenticate: Callable, wallet_for_quote: Callable,
            rights_for_pack: Callable, short_actions: dict, config: Any,
            verify_video: Callable, video_models_for_pack: Callable,
            catalog_for_video: Callable, video_service: Callable,
            get_job: Callable, get_job_status: Callable, media_service: Callable,
            video_reservation: Callable):
    def identify(user_id: str | None, authorization: str | None) -> str:
        return authenticate(user_id=user_id, authorization=authorization)

    def get_project(uid: str, pid: str) -> dict:
        rows = (db.table(_P).select("*").eq("id", require_id(pid)).eq("user_id", uid).limit(1).execute().data or [])
        if not rows:
            raise HTTPException(404, "Projet vidéo introuvable.")
        return rows[0]

    def scenes_for(uid: str, pid: str) -> list[dict]:
        return (db.table(_S).select("*").eq("user_id", uid).eq("project_id", pid)
                .order("position").execute().data or [])

    def require_active(user_id: str | None, auth: str | None) -> tuple[str, Any]:
        wallet = wallet_for_quote(user_id=user_id, authorization=auth)
        if not wallet.is_pack_active:
            raise HTTPException(403, "Pack ORIA inactif.")
        return identify(user_id, auth), wallet

    def validate_project(payload: ProjectCreate, wallet: Any) -> dict:
        rights = rights_for_pack(wallet.pack_id)
        if "multi_scene" not in rights["video_modes"]:
            raise HTTPException(403, "Ce pack ne comprend pas les films multi-scènes.")
        if payload.aspect_ratio not in ("9:16", "16:9"):
            raise HTTPException(400, "Format de film invalide.")
        if len(payload.scenes) > int(rights["max_video_scenes"]):
            raise HTTPException(403, "Nombre de scènes supérieur au pack.")
        if sum(s.duration_seconds for s in payload.scenes) > int(rights["max_video_project_seconds"]):
            raise HTTPException(403, "Durée du film supérieure au pack.")
        catalog = catalog_for_video(video_service(), "video")
        models = video_models_for_pack(wallet.pack_id, catalog)
        selected = next((m for m in models if m["id"] == payload.model), None)
        if not selected:
            raise HTTPException(403, "Modèle non autorisé par ce pack.")
        if payload.generate_audio and selected.get("generate_audio") is not True:
            raise HTTPException(400, "Audio non disponible sur le modèle.")
        if payload.continue_from_previous:
            frames = selected.get("supported_frame_images") or []
            values = [(v if isinstance(v,str) else v.get("frame_type")) for v in frames if isinstance(v,(str,dict))]
            if "first_frame" not in values or "image_to_video" not in rights["video_modes"]:
                raise HTTPException(400, "Ce modèle ne permet pas une continuité via l'image précédente.")
        if payload.aspect_ratio not in (selected.get("supported_aspect_ratios") or []) or "720p" not in (selected.get("supported_resolutions") or []):
            raise HTTPException(400,"Format ou résolution non pris en charge par le modèle choisi.")
        # Validate against the ONE catalog response, avoiding N network requests for N scenes.
        from app.config.credit_costs import CreditAction
        for scene in payload.scenes:
            if scene.action not in short_actions.get(wallet.pack_id, ()):
                raise HTTPException(403, "Offre vidéo non autorisée.")
            if scene.duration_seconds not in (4,6,8) or scene.duration_seconds not in (selected.get("supported_durations") or []):
                raise HTTPException(400, "Durée de scène non supportée par le modèle.")
            try:
                action = CreditAction(scene.action)
            except ValueError as exc:
                raise HTTPException(400, "Offre vidéo inconnue.") from exc
            maximum=config.VIDEO_ACTION_DURATION_SECONDS.get(action)
            if maximum is None or scene.duration_seconds > maximum:
                raise HTTPException(403,"Cette durée dépasse le plafond de l'offre vidéo.")
        return selected

    @router.post("/openrouter-media/projects/quote")
    async def quote_project(payload: ProjectCreate,
                            user_id: str | None = Header(None, alias="user-id"),
                            authorization: str | None = Header(None, alias="authorization")):
        uid, wallet = require_active(user_id, authorization)
        selected=validate_project(payload,wallet)
        detailed=[]; estimate=0; maximum=0
        for i, scene in enumerate(payload.scenes, 1):
            est,limit,_usd,known=video_reservation(selected,scene.duration_seconds,payload.generate_audio)
            estimate+=est;maximum+=limit
            detailed.append({"scene":i,"estimated_credits":est,"reservation_credits":limit,
                             "provider_price_known":known})
        return {"success":True,"quote_only":True,"scene_count":len(detailed),
                "total_estimated_credits":estimate,"maximum_total_reservation_credits":maximum,
                "current_wallet_credits":int(wallet.balance),"credits_sufficient_for_all":int(wallet.balance)>=maximum,
                "project_duration_seconds":sum(s.duration_seconds for s in payload.scenes),
                "scenes":detailed,
                "note":"Estimation non contractuelle. Chaque scène est devisée et approuvée séparément. Aucun débit ici."}

    @router.post("/openrouter-media/projects")
    async def new_project(payload: ProjectCreate, user_id: str | None = Header(None, alias="user-id"),
                          authorization: str | None = Header(None, alias="authorization")):
        uid, wallet = require_active(user_id, authorization)
        selected=validate_project(payload,wallet)
        pid = str(uuid4())
        row = {"id": pid, "user_id": uid, "pack_id": wallet.pack_id,
               "title": normalize_text(payload.title), "brief": normalize_text(payload.brief),
               "style": normalize_text(payload.style), "aspect_ratio": payload.aspect_ratio,
               "model": payload.model, "generate_audio": payload.generate_audio, "continue_from_previous":payload.continue_from_previous, "status": "draft"}
        db.table(_P).insert(row).execute()
        data = [{"project_id": pid, "user_id": uid, "position": idx + 1,
                 "prompt": normalize_text(s.prompt), "duration_seconds": s.duration_seconds,
                 "action": s.action, "status": "draft"} for idx,s in enumerate(payload.scenes)]
        try:
            db.table(_S).insert(data).execute()
        except Exception:
            db.table(_P).delete().eq("id",pid).eq("user_id",uid).execute()
            raise HTTPException(503, "Enregistrement des scènes impossible.")
        return project_payload(row, scenes_for(uid,pid))

    @router.get("/openrouter-media/projects")
    async def list_projects(user_id: str | None = Header(None, alias="user-id"),
                            authorization: str | None = Header(None, alias="authorization")):
        uid = identify(user_id, authorization)
        rows = (db.table(_P).select("id,title,status,aspect_ratio,model,created_at,output_url")
                .eq("user_id",uid).order("created_at", desc=True).limit(30).execute().data or [])
        return {"success": True, "projects": rows}

    @router.get("/openrouter-media/projects/{project_id}")
    async def project_detail(project_id: str, user_id: str | None = Header(None, alias="user-id"),
                             authorization: str | None = Header(None, alias="authorization")):
        uid = identify(user_id, authorization)
        return project_payload(get_project(uid,project_id), scenes_for(uid,project_id))

    @router.patch("/openrouter-media/projects/{project_id}/scenes/{position}")
    async def edit_scene(project_id: str, position: int, payload: SceneEdit,
                         user_id: str | None = Header(None, alias="user-id"),
                         authorization: str | None = Header(None, alias="authorization")):
        uid = identify(user_id, authorization)
        proj = get_project(uid,project_id)
        if proj["status"] in ("rendering", "completed"):
            raise HTTPException(409, "Un rendu finalisé ne peut plus être modifié.")
        rows = (db.table(_S).select("*").eq("project_id",project_id).eq("user_id",uid)
                .eq("position",position).limit(1).execute().data or [])
        if not rows:
            raise HTTPException(404, "Scène introuvable.")
        scene = rows[0]
        if scene.get("request_id"):
            job = get_job(uid,scene["request_id"])
            if job and job["status"] not in ("refunded", "failed"):
                raise HTTPException(409, "Cette scène a été commandée : ne pas perdre une génération payante.")
        db.table(_S).update({"prompt":normalize_text(payload.prompt), "status":"draft",
                             "request_id":None,"media_id":None,"media_url":None,"error_message":None})\
           .eq("id",scene["id"]).eq("user_id",uid).execute()
        return {"success":True}

    @router.get("/openrouter-media/projects/{project_id}/scenes/{position}/first-frame")
    async def previous_final_frame(project_id: str, position: int,
              user_id: str | None = Header(None, alias="user-id"),
              authorization: str | None = Header(None, alias="authorization")):
        uid=identify(user_id,authorization)
        p=get_project(uid,project_id)
        if not p.get("continue_from_previous") or position<=1:
            raise HTTPException(403,"Continuité non activée ou scène initiale.")
        earlier=next((s for s in scenes_for(uid,project_id) if s["position"]==position-1),None)
        if not earlier or earlier["status"]!="completed" or not earlier.get("media_id") or not earlier.get("media_url"):
            raise HTTPException(409,"La scène précédente doit être terminée pour conserver la continuité.")
        try:
            with tempfile.TemporaryDirectory(prefix="oria-frame-v7-") as t:
                src=Path(t)/"previous.mp4"
                _download_owned_media(db,uid,earlier["media_id"],earlier["media_url"],src)
                frame=Path(t)/"frame.jpg"
                _run(["ffmpeg","-hide_banner","-loglevel","error","-nostdin","-y",
                      "-sseof","-0.20","-i",str(src),"-frames:v","1","-q:v","4",str(frame)],timeout=30)
                content=frame.read_bytes()
                if not 0<len(content)<2*1024*1024:
                    raise RuntimeError("Image finale trop volumineuse.")
                return {"success":True,"mime_type":"image/jpeg","base64":base64.b64encode(content).decode("ascii")}
        except Exception as exc:
            raise HTTPException(503,"Impossible d'extraire la dernière image de la scène précédente.") from exc

    @router.post("/openrouter-media/projects/{project_id}/scenes/{position}/claim")
    async def claim_scene(project_id: str, position: int,
                          user_id: str | None = Header(None, alias="user-id"),
                          authorization: str | None = Header(None, alias="authorization")):
        uid, wallet = require_active(user_id, authorization)
        p = get_project(uid,project_id)
        if p["status"] != "draft":
            raise HTTPException(409, "Projet déjà en rendu ou terminé.")
        if p["pack_id"] != wallet.pack_id:
            raise HTTPException(403, "Le pack a changé : recréez le projet avec ses nouveaux droits.")
        rows = (db.table(_S).select("*").eq("project_id",project_id).eq("user_id",uid)
                .eq("position",position).limit(1).execute().data or [])
        if not rows:
            raise HTTPException(404,"Scène introuvable.")
        s=rows[0]
        old=s.get("request_id")
        if old:
            job=get_job(uid,old)
            if job and job["status"] == "completed":
                raise HTTPException(409,"Scène déjà payée et terminée.")
            if not job or job["status"] not in ("failed","refunded"):
                return {"success": True, "request_id": old, "scene":s,
                        "note":"Réutilisez le même identifiant : jamais un second paiement automatique."}
        new=str(uuid4())
        query=db.table(_S).update({"request_id":new,"status":"claimed","error_message":None})\
                .eq("id",s["id"]).eq("user_id",uid)
        query=(query.is_("request_id","null") if not old else query.eq("request_id",old))
        result=query.execute().data or []
        if not result:
            current=(db.table(_S).select("*").eq("id",s["id"]).eq("user_id",uid).single().execute()).data
            return {"success":True,"request_id":current["request_id"],"scene":current}
        return {"success": True,"request_id":new,"scene":result[0]}

    @router.post("/openrouter-media/projects/{project_id}/sync")
    async def sync_project(project_id: str,
                           user_id: str | None = Header(None, alias="user-id"),
                           authorization: str | None = Header(None, alias="authorization")):
        uid=identify(user_id,authorization)
        p=get_project(uid,project_id)
        updated=[]
        for s in scenes_for(uid,project_id):
            req=s.get("request_id")
            if not req: continue
            job=get_job(uid,req)
            if job and job["status"] == "submitted":
                # Only a limited number of polls per user-initiated action.
                if len(updated)<3:
                    await get_job_status(req,user_id=user_id,authorization=authorization)
                    job=get_job(uid,req)
            if job:
                mapped={"completed":"completed","refunded":"refunded","failed":"failed"}.get(job["status"],"processing")
                patch={"status":mapped,"error_message":job.get("error_message")}
                if mapped=="completed" and job.get("media_id") and job.get("media_url"):
                    patch.update({"media_id":job["media_id"],"media_url":job["media_url"]})
                db.table(_S).update(patch).eq("id",s["id"]).eq("user_id",uid).execute()
                updated.append(req)
        return project_payload(get_project(uid,project_id),scenes_for(uid,project_id))

    def background_render(uid: str, pid: str, music: bytes | None, voice: bytes | None,
                          music_volume: float, keep_scene_audio: bool, transition: str) -> None:
        try:
            p=get_project(uid,pid)
            scenes=scenes_for(uid,pid)
            if not scenes or not all(s.get("status")=="completed" and s.get("media_id") and s.get("media_url") for s in scenes):
                raise RuntimeError("Le montage exige tous les clips finalisés.")
            with tempfile.TemporaryDirectory(prefix="oria-film-v7-") as d:
                directory=Path(d)
                paths=[]
                for idx,s in enumerate(scenes):
                    path=directory / f"original_{idx:02}.mp4"
                    _download_owned_media(db,uid,s["media_id"],s["media_url"],path)
                    paths.append(path)
                result=directory/"film.mp4"
                render_montage(paths,result,aspect=p["aspect_ratio"],music=music,voice=voice,
                               music_volume=music_volume,keep_scene_audio=keep_scene_audio,transition=transition)
                if result.stat().st_size>MAX_FINAL:
                    raise RuntimeError("Le montage dépasse le plafond de 180 Mo.")
                saved=media_service().save_video(user_id=uid,video_bytes=result.read_bytes(),
                            action="oria_video_montage",model="oria/ffmpeg-montage-v7",
                            prompt=p["brief"],credits_cost=0,mime_type="video/mp4",
                            seconds=sum(int(s["duration_seconds"]) for s in scenes))
                db.table(_P).update({"status":"completed","output_media_id":saved.get("id"),
                            "output_url":saved.get("media_url") or saved.get("url"),"error_message":None})\
                    .eq("id",pid).eq("user_id",uid).execute()
        except Exception as err:
            # Keep error generic. No personal prompts, paths, or credentials.
            db.table(_P).update({"status":"render_failed", "error_message":str(err)[:220]})\
                .eq("id",pid).eq("user_id",uid).execute()

    @router.post("/openrouter-media/projects/{project_id}/render")
    async def request_render(project_id: str, payload: RenderRequest, tasks: BackgroundTasks,
                             user_id: str | None = Header(None, alias="user-id"),
                             authorization: str | None = Header(None, alias="authorization")):
        uid, wallet=require_active(user_id,authorization)
        p=get_project(uid,project_id)
        rights=rights_for_pack(wallet.pack_id)
        scenes=scenes_for(uid,project_id)
        if p["pack_id"]!=wallet.pack_id or len(scenes)>rights["max_video_scenes"] or sum(s["duration_seconds"] for s in scenes)>rights["max_video_project_seconds"]:
            raise HTTPException(403,"Projet hors droits du pack actif.")
        if not all(s["status"]=="completed" and s.get("media_id") for s in scenes):
            raise HTTPException(409,"Toutes les scènes doivent être terminées avant le montage.")
        if not payload.rights_confirmed and (payload.music_b64 or payload.voice_b64):
            raise HTTPException(400,"Confirmez les droits sur les fichiers audio fournis.")
        music=decode_track(payload.music_b64,"Musique")
        voice=decode_track(payload.voice_b64,"Voix")
        if not shutil.which("ffmpeg") or not shutil.which("ffprobe"):
            raise HTTPException(503,"FFmpeg et ffprobe doivent être installés sur Render pour assembler les vidéos.")
        eligible=("draft","render_failed")
        if p["status"] == "rendering":
            # A Render restart may kill a BackgroundTask. Explicit manual resumption
            # after 20 min, never a new paid OpenRouter request.
            updated=p.get("updated_at")
            try:
                elapsed=(datetime.now(timezone.utc)-datetime.fromisoformat(str(updated).replace("Z","+00:00"))).total_seconds()
            except (TypeError,ValueError):
                elapsed=0
            if elapsed <= 20*60:
                raise HTTPException(409,"Montage déjà en cours. Actualisez le projet.")
        elif p["status"] not in eligible:
            raise HTTPException(409,"Montage déjà lancé ou terminé.")
        res=db.table(_P).update({"status":"rendering","error_message":None})\
            .eq("id",project_id).eq("user_id",uid).eq("status",p["status"])\
            .eq("updated_at",p["updated_at"]).execute().data or []
        if not res:
            raise HTTPException(409,"Un autre montage est en cours.")
        tasks.add_task(background_render,uid,project_id,music,voice,payload.music_volume,payload.keep_scene_audio,payload.transition)
        return {"success":True,"status":"rendering","note":"Montage non payant lancé. Consultez ce projet pour le résultat."}
