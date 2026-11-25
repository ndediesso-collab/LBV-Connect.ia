"""Persistence, ownership and credit lifecycle for ORIA Assistant v1."""
from __future__ import annotations

import hashlib
import os
import secrets
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any, Mapping

from fastapi import HTTPException

from app.core.supabase import supabase
from app.repositories.supabase_credit_repository import SupabaseCreditRepository
from app.services.oria_assistant_provider_adapter import (
    ASSISTANT_HISTORY_LIMIT,
    ASSISTANT_MAX_MESSAGE_CHARS,
    AssistantBillingUncertainError,
    AssistantProviderError,
    active_assistant_selection,
    build_owner_instructions,
    complete_assistant_turn,
    quote_assistant_request,
)

credit_repository = SupabaseCreditRepository(supabase)


def _first(data: Any) -> dict[str, Any] | None:
    if isinstance(data, list):
        data = data[0] if data else None
    return data if isinstance(data, dict) else None


def _rows(data: Any) -> list[dict[str, Any]]:
    if isinstance(data, list):
        return [item for item in data if isinstance(item, dict)]
    if isinstance(data, dict):
        return [data]
    return []


def _slugify(value: str) -> str:
    import re
    import unicodedata

    normalized = unicodedata.normalize("NFKD", value).encode("ascii", "ignore").decode("ascii")
    slug = re.sub(r"[^a-z0-9]+", "-", normalized.lower()).strip("-")
    return (slug[:48].strip("-") or "assistant")


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _assistant_public_url(slug: str) -> str:
    """Return the canonical, durable public URL for an assistant slug."""
    base_url = os.getenv("ORIA_PUBLIC_BASE_URL", "https://www.myoriaai.com").strip().rstrip("/")
    return f"{base_url}/a/{slug}"


def _with_public_url(assistant: dict[str, Any]) -> dict[str, Any]:
    """Expose the Supabase-persisted slug as a canonical URL to the frontend."""
    return {**assistant, "public_url": _assistant_public_url(str(assistant["slug"]))}


def _new_assistant_slug(name: str) -> str:
    """Generate a fresh public slug; the database UNIQUE constraint is the final guard."""
    return f"{_slugify(name)}-{uuid.uuid4().hex[:16]}"


def _pack_wallet(owner_user_id: str):
    wallet = credit_repository.get_wallet(owner_user_id)
    if wallet is None or not wallet.is_pack_active:
        raise HTTPException(403, "Un pack ORIA actif est nécessaire pour utiliser Assistant ORIA.")
    if wallet.pack_id not in {"pro_pack", "business_pack"}:
        raise HTTPException(403, "Assistant ORIA est réservé aux packs Pro et Business.")
    return wallet


def list_owner_assistants(owner_user_id: str) -> list[dict[str, Any]]:
    response = (
        supabase.table("oria_assistants").select(
            "id,name,description,instructions,welcome_message,slug,is_public,created_at,updated_at"
        ).eq("owner_user_id", owner_user_id).order("created_at", desc=True).execute()
    )
    return [_with_public_url(item) for item in _rows(response.data)]


def get_owner_assistant(owner_user_id: str, assistant_id: str) -> dict[str, Any]:
    response = (
        supabase.table("oria_assistants").select("*")
        .eq("id", assistant_id).eq("owner_user_id", owner_user_id).limit(1).execute()
    )
    item = _first(response.data)
    if item is None:
        raise HTTPException(404, "Assistant introuvable.")
    return _with_public_url(item)


def create_owner_assistant(owner_user_id: str, payload: Mapping[str, Any]) -> dict[str, Any]:
    _pack_wallet(owner_user_id)
    assistant_id = str(uuid.uuid4())
    slug = _new_assistant_slug(str(payload["name"]))
    clean_name = str(payload["name"]).strip()
    clean_instructions = str(payload["instructions"]).strip()
    if len(clean_name) < 2 or not 10 <= len(clean_instructions) <= 12000:
        raise HTTPException(422, "Le nom ou les instructions de l'assistant ne sont pas valides.")
    data = {
        "id": assistant_id,
        "owner_user_id": owner_user_id,
        "name": clean_name,
        "description": str(payload.get("description") or "").strip(),
        "instructions": clean_instructions,
        "welcome_message": str(payload.get("welcome_message") or "Bonjour ! Comment puis-je vous aider ?").strip(),
        "slug": slug,
        "is_public": bool(payload.get("is_public", False)),
    }
    response = supabase.table("oria_assistants").insert(data).select("*").execute()
    item = _first(response.data)
    if item is None:
        raise HTTPException(500, "Impossible d'enregistrer l'assistant.")
    return _with_public_url(item)


def update_owner_assistant(owner_user_id: str, assistant_id: str, payload: Mapping[str, Any]) -> dict[str, Any]:
    existing = get_owner_assistant(owner_user_id, assistant_id)
    allowed = {"name", "description", "instructions", "welcome_message", "is_public"}
    data = {key: value for key, value in payload.items() if key in allowed}
    if not data:
        raise HTTPException(400, "Aucune modification valide.")
    for key in ("name", "description", "instructions", "welcome_message"):
        if key in data and isinstance(data[key], str):
            data[key] = data[key].strip()
    if "name" in data and len(data["name"]) < 2:
        raise HTTPException(422, "Le nom de l'assistant doit contenir au moins deux caractères.")
    if "instructions" in data and not 10 <= len(data["instructions"]) <= 12000:
        raise HTTPException(422, "Les instructions doivent contenir entre 10 et 12 000 caractères.")
    # Un dé-publication révoque l'ancien lien : le slug change et l'ancienne URL renvoie 404.
    if payload.get("is_public") is False and bool(existing.get("is_public")):
        data["slug"] = _new_assistant_slug(str(data.get("name") or existing["name"]))
    data["updated_at"] = _now()
    response = (
        supabase.table("oria_assistants").update(data)
        .eq("id", assistant_id).eq("owner_user_id", owner_user_id).select("*").execute()
    )
    item = _first(response.data)
    if item is None:
        raise HTTPException(500, "Impossible d'enregistrer les modifications.")
    return _with_public_url(item)


def regenerate_owner_assistant_link(owner_user_id: str, assistant_id: str) -> dict[str, Any]:
    """Rotate the public URL and immediately invalidate the previous slug."""
    current = get_owner_assistant(owner_user_id, assistant_id)
    new_slug = _new_assistant_slug(str(current["name"]))
    response = (
        supabase.table("oria_assistants").update({"slug": new_slug, "updated_at": _now()})
        .eq("id", assistant_id).eq("owner_user_id", owner_user_id)
        .select("*").execute()
    )
    item = _first(response.data)
    if item is None:
        raise HTTPException(500, "Impossible de renouveler le lien public.")
    return _with_public_url(item)


def delete_owner_assistant(owner_user_id: str, assistant_id: str) -> None:
    get_owner_assistant(owner_user_id, assistant_id)
    pending = (
        supabase.table("oria_assistant_runs").select("id")
        .eq("assistant_id", assistant_id)
        .in_("status", ["preparing", "reserved", "provider_complete", "settled", "settled_pending_persist", "reconciliation_required"])
        .limit(1).execute()
    )
    if _rows(pending.data):
        raise HTTPException(409, "Cet assistant a une génération ou un règlement à terminer. Réessaie après rapprochement.")
    supabase.table("oria_assistants").delete().eq("id", assistant_id).eq("owner_user_id", owner_user_id).execute()


def get_public_assistant(slug: str) -> dict[str, Any]:
    response = (
        supabase.table("oria_assistants").select(
            "id,name,description,welcome_message,slug,is_public,owner_user_id"
        ).eq("slug", slug).eq("is_public", True).limit(1).execute()
    )
    item = _first(response.data)
    if item is None:
        raise HTTPException(404, "Cet assistant n'est pas disponible publiquement.")
    return item


def get_public_assistant_for_generation(slug: str) -> dict[str, Any]:
    response = (
        supabase.table("oria_assistants").select("*")
        .eq("slug", slug).eq("is_public", True).limit(1).execute()
    )
    item = _first(response.data)
    if item is None:
        raise HTTPException(404, "Cet assistant n'est pas disponible publiquement.")
    return item


def start_visitor_conversation(assistant: Mapping[str, Any]) -> dict[str, str]:
    _pack_wallet(str(assistant["owner_user_id"]))
    conversation_id = str(uuid.uuid4())
    visitor_token = secrets.token_urlsafe(32)
    token_hash = hashlib.sha256(visitor_token.encode("utf-8")).hexdigest()
    response = supabase.table("oria_assistant_conversations").insert({
        "id": conversation_id,
        "assistant_id": assistant["id"],
        "owner_user_id": assistant["owner_user_id"],
        "visitor_token_hash": token_hash,
    }).select("id").execute()
    if _first(response.data) is None:
        raise HTTPException(500, "Impossible de démarrer cette conversation.")
    return {"conversation_id": conversation_id, "visitor_token": visitor_token}


def _visitor_conversation(assistant_id: str, conversation_id: str, visitor_token: str) -> dict[str, Any]:
    if not visitor_token or len(visitor_token) > 256:
        raise HTTPException(401, "Session visiteur invalide.")
    token_hash = hashlib.sha256(visitor_token.encode("utf-8")).hexdigest()
    response = (
        supabase.table("oria_assistant_conversations").select("*")
        .eq("id", conversation_id).eq("assistant_id", assistant_id)
        .eq("visitor_token_hash", token_hash).limit(1).execute()
    )
    item = _first(response.data)
    if item is None:
        raise HTTPException(403, "Cette conversation n'appartient pas à cette session visiteur.")
    return item


def visitor_messages(assistant_id: str, conversation_id: str, visitor_token: str) -> list[dict[str, Any]]:
    _visitor_conversation(assistant_id, conversation_id, visitor_token)
    # Restore a response already settled before the process stopped, without
    # calling the provider or charging a second time.
    settled_runs = (
        supabase.table("oria_assistant_runs").select("*")
        .eq("conversation_id", conversation_id)
        .in_("status", ["settled", "settled_pending_persist"])
        .limit(5).execute()
    )
    for run in _rows(settled_runs.data):
        _complete_saved_run(run)
    response = (
        supabase.table("oria_assistant_messages").select("id,role,content,created_at")
        .eq("conversation_id", conversation_id).order("created_at", desc=True)
        .limit(100).execute()
    )
    return list(reversed(_rows(response.data)))


def _get_run(request_id: str) -> dict[str, Any] | None:
    response = (
        supabase.table("oria_assistant_runs").select("*")
        .eq("request_id", request_id).limit(1).execute()
    )
    return _first(response.data if response is not None else None)


def _update_run(run_id: str, values: Mapping[str, Any]) -> None:
    supabase.table("oria_assistant_runs").update({**dict(values), "updated_at": _now()}).eq("id", run_id).execute()


def _complete_saved_run(run: Mapping[str, Any]) -> dict[str, Any]:
    response = (
        supabase.table("oria_assistant_messages").select("id,role,content,created_at")
        .eq("conversation_id", run["conversation_id"]).eq("run_id", run["id"])
        .eq("role", "assistant").limit(1).execute()
    )
    saved = _first(response.data)
    status = str(run.get("status") or "")
    if status in {"settled", "settled_pending_persist", "completed"}:
        answer = str(run.get("assistant_response") or (saved or {}).get("content") or "").strip()
        if not answer:
            raise HTTPException(409, "Le règlement est effectué, mais la réponse doit être rapprochée.")
        if not saved:
            try:
                supabase.table("oria_assistant_messages").insert({
                    "conversation_id": run["conversation_id"],
                    "owner_user_id": run["owner_user_id"],
                    "run_id": run["id"],
                    "role": "assistant",
                    "content": answer,
                }).execute()
            except Exception:
                # A previous repair may have committed the unique (run, role) row.
                check = (
                    supabase.table("oria_assistant_messages").select("id")
                    .eq("run_id", run["id"]).eq("role", "assistant").limit(1).execute()
                )
                if _first(check.data) is None:
                    raise HTTPException(503, "Le transcript doit être synchronisé avant un nouvel envoi.")
        _update_run(str(run["id"]), {"status": "completed", "error_code": None})
        return {
            "success": True,
            "message": answer,
            "request_id": run["request_id"],
            "replayed": True,
        }
    raise HTTPException(409, "Cette demande est déjà en cours de traitement ou nécessite un rapprochement. Réessaie après vérification.")


def send_visitor_message(
    *, assistant: Mapping[str, Any], conversation_id: str,
    visitor_token: str, request_id: str, message: str,
) -> dict[str, Any]:
    conversation = _visitor_conversation(str(assistant["id"]), conversation_id, visitor_token)
    clean_message = message.strip()
    if not clean_message or len(clean_message) > ASSISTANT_MAX_MESSAGE_CHARS:
        raise HTTPException(422, f"Le message doit contenir entre 1 et {ASSISTANT_MAX_MESSAGE_CHARS} caractères.")
    try:
        request_uuid = str(uuid.UUID(request_id))
    except (ValueError, TypeError, AttributeError) as exc:
        raise HTTPException(422, "Identifiant de demande invalide.") from exc
    content_hash = hashlib.sha256(clean_message.encode("utf-8")).hexdigest()

    existing = _get_run(request_uuid)
    if existing is not None:
        if existing.get("input_sha256") != content_hash or existing.get("conversation_id") != conversation_id:
            raise HTTPException(409, "Cet identifiant de demande a déjà été utilisé.")
        return _complete_saved_run(existing)

    pending = (
        supabase.table("oria_assistant_runs").select("id,status")
        .eq("conversation_id", conversation_id)
        .in_("status", ["preparing", "reserved", "provider_complete", "settled", "settled_pending_persist", "reconciliation_required"])
        .limit(1).execute()
    )
    if _rows(pending.data):
        raise HTTPException(409, "Une réponse précédente doit être terminée ou rapprochée avant un nouvel envoi.")

    owner_user_id = str(conversation["owner_user_id"])
    now = datetime.now(timezone.utc)
    recent_minute = (
        supabase.table("oria_assistant_runs").select("id")
        .eq("conversation_id", conversation_id)
        .gte("created_at", (now - timedelta(minutes=1)).isoformat())
        .limit(4).execute()
    )
    if len(_rows(recent_minute.data)) >= 4:
        raise HTTPException(429, "Trop de demandes rapprochées. Patiente avant de réessayer.")
    assistant_recent = (
        supabase.table("oria_assistant_runs").select("id")
        .eq("assistant_id", assistant["id"])
        .gte("created_at", (now - timedelta(minutes=1)).isoformat())
        .limit(13).execute()
    )
    if len(_rows(assistant_recent.data)) >= 12:
        raise HTTPException(429, "Cet assistant reçoit trop de demandes simultanées. Réessaie dans une minute.")
    recent_day = (
        supabase.table("oria_assistant_runs").select("id")
        .eq("conversation_id", conversation_id)
        .gte("created_at", (now - timedelta(hours=24)).isoformat())
        .limit(31).execute()
    )
    if len(_rows(recent_day.data)) >= 30:
        raise HTTPException(429, "La limite de 30 réponses par conversation sur 24 heures est atteinte.")
    wallet = _pack_wallet(owner_user_id)
    if wallet.balance <= 0:
        raise HTTPException(402, "Le portefeuille du propriétaire n'a plus de crédits disponibles.")
    try:
        selection = active_assistant_selection()
    except AssistantProviderError as exc:
        raise HTTPException(503, "Le fournisseur Assistant ORIA n'est pas correctement configuré.") from exc
    if wallet.pack_id == "pro_pack" and selection.logical_model not in {
        "gpt-5.6-terra", "claude-sonnet-5.5"
    }:
        raise HTTPException(403, "Le modèle Assistant ORIA n'est pas autorisé pour ce pack.")

    history_response = (
        supabase.table("oria_assistant_messages").select("role,content")
        .eq("conversation_id", conversation_id).order("created_at", desc=True)
        .limit(ASSISTANT_HISTORY_LIMIT).execute()
    )
    history_rows = list(reversed(_rows(history_response.data)))
    history = [
        {"role": row["role"], "content": row["content"]}
        for row in history_rows if row.get("role") in {"user", "assistant"}
    ]
    system_instructions = build_owner_instructions(
        name=str(assistant["name"]),
        description=str(assistant.get("description") or ""),
        instructions=str(assistant["instructions"]),
    )
    try:
        quote = quote_assistant_request(
            selection, system_instructions=system_instructions,
            message=clean_message, history=history,
        )
    except Exception as exc:
        raise HTTPException(409, "Le devis de cette réponse n'est pas disponible. Aucun crédit n'a été réservé.") from exc

    run_id = str(uuid.uuid4())
    try:
        insert = supabase.table("oria_assistant_runs").insert({
            "id": run_id,
            "request_id": request_uuid,
            "owner_user_id": owner_user_id,
            "assistant_id": assistant["id"],
            "conversation_id": conversation_id,
            "provider": selection.provider.value,
            "model": selection.logical_model,
            "status": "preparing",
            "input_sha256": content_hash,
        }).select("id").execute()
        if _first(insert.data) is None:
            raise RuntimeError("Insertion de requête incomplète.")
    except Exception as exc:
        # A unique request_id conflict is treated as an idempotency conflict.
        duplicate = _get_run(request_uuid)
        if duplicate:
            if duplicate.get("input_sha256") != content_hash:
                raise HTTPException(409, "Cet identifiant de demande a déjà été utilisé.") from exc
            return _complete_saved_run(duplicate)
        active_run = (
            supabase.table("oria_assistant_runs").select("id")
            .eq("conversation_id", conversation_id)
            .in_("status", ["preparing", "reserved", "provider_complete", "settled", "settled_pending_persist", "reconciliation_required"])
            .limit(1).execute()
        )
        if _rows(active_run.data):
            raise HTTPException(409, "Une autre réponse de cette conversation est déjà en cours.") from exc
        raise HTTPException(503, "Impossible d'initialiser cette génération.") from exc

    try:
        credit_repository.reserve_credits(
            user_id=owner_user_id,
            amount=quote.reserved_credits,
            action=selection.credit_action,
            reference_id=run_id,
            api_reservation_xaf=quote.reserved_api_cost_xaf,
        )
    except Exception as exc:
        # The reservation RPC may have committed before a network failure.
        # Preserve the run for reconciliation instead of assuming no hold exists.
        try:
            _update_run(run_id, {"status": "reconciliation_required", "error_code": "credit_reservation_outcome_uncertain"})
        finally:
            raise HTTPException(503, "La réservation de crédits n'a pas pu être confirmée. Aucun appel IA n'a été lancé ; vérification nécessaire avant de réessayer.") from exc
    try:
        _update_run(run_id, {
            "status": "reserved",
            "reserved_credits": quote.reserved_credits,
            "reserved_api_cost_xaf": str(quote.reserved_api_cost_xaf),
            "estimated_input_tokens": quote.estimated_input_tokens,
        })
    except Exception as exc:
        try:
            _update_run(run_id, {"status": "reconciliation_required", "error_code": "reservation_state_persist_failed"})
        finally:
            raise HTTPException(503, "Les crédits ont été réservés, mais l'état doit être rapproché. Aucun appel IA n'a été lancé.") from exc

    try:
        supabase.table("oria_assistant_messages").insert({
            "conversation_id": conversation_id,
            "owner_user_id": owner_user_id,
            "run_id": run_id,
            "role": "user",
            "content": clean_message,
        }).execute()
    except Exception as exc:
        try:
            credit_repository.release_credit_reservation(owner_user_id, run_id)
            _update_run(run_id, {"status": "failed", "error_code": "message_persist_failed"})
        except Exception:
            _update_run(run_id, {"status": "reconciliation_required", "error_code": "message_persist_failed"})
        raise HTTPException(503, "Impossible d'enregistrer le message avant génération.") from exc

    try:
        result = complete_assistant_turn(
            selection, system_instructions=system_instructions,
            message=clean_message, history=history,
        )
    except AssistantBillingUncertainError as exc:
        _update_run(run_id, {"status": "reconciliation_required", "error_code": "provider_usage_uncertain"})
        raise HTTPException(503, "La réponse est en cours de rapprochement. Les crédits réservés ne sont pas libérés automatiquement.") from exc
    except (AssistantProviderError, ValueError) as exc:
        try:
            credit_repository.release_credit_reservation(owner_user_id, run_id)
            supabase.table("oria_assistant_messages").delete().eq("run_id", run_id).eq("role", "user").execute()
            _update_run(run_id, {"status": "failed", "error_code": "provider_rejected"})
        except Exception:
            _update_run(run_id, {"status": "reconciliation_required", "error_code": "provider_rejected_release_failed"})
        raise HTTPException(502, "Le fournisseur IA n'a pas accepté la requête. Aucun débit définitif ne doit être appliqué.") from exc
    except Exception as exc:
        _update_run(run_id, {"status": "reconciliation_required", "error_code": "unexpected_provider_error"})
        raise HTTPException(503, "Résultat fournisseur incertain. La réservation est conservée pour rapprochement.") from exc

    # Save provider proof before settlement. A crash after this point is
    # visible as provider_complete and can be reconciled without a second call.
    try:
        _update_run(run_id, {
            "status": "provider_complete",
            "assistant_response": result["message"],
            "provider_request_id": result["response_id"],
            "actual_credits": result["credits"],
            "total_cost_usd": str(result["total_cost_usd"]),
            "actual_api_cost_xaf": str(result["total_cost_xaf"]),
            "usage": result.get("usage") or {},
        })
    except Exception as exc:
        # Provider response exists in memory but cannot safely be settled or retried.
        raise HTTPException(503, "Le fournisseur a répondu, mais la preuve d'usage n'a pas pu être enregistrée. La réservation est conservée pour rapprochement.") from exc

    try:
        credit_repository.settle_credit_reservation(
            user_id=owner_user_id,
            reference_id=run_id,
            actual_amount=int(result["credits"]),
            actual_api_cost_xaf=result["total_cost_xaf"],
        )
    except Exception as exc:
        _update_run(run_id, {"status": "reconciliation_required", "error_code": "settlement_failed"})
        raise HTTPException(503, "La réponse a été générée, mais le règlement doit être rapproché avant un nouvel essai.") from exc

    _update_run(run_id, {"status": "settled", "settled_at": _now()})
    try:
        supabase.table("oria_assistant_messages").insert({
            "conversation_id": conversation_id,
            "owner_user_id": owner_user_id,
            "run_id": run_id,
            "role": "assistant",
            "content": result["message"],
        }).execute()
        _update_run(run_id, {"status": "completed"})
    except Exception as exc:
        # Response and settlement are both durable in the run record. Do not
        # regenerate: reconciliation can restore the visible transcript.
        _update_run(run_id, {"status": "settled_pending_persist", "error_code": "assistant_message_persist_failed"})
        raise HTTPException(503, "Réponse réglée mais transcript en cours de synchronisation. Ne renvoie pas le même message.") from exc

    return {
        "success": True,
        "message": result["message"],
        "request_id": request_uuid,
    }
