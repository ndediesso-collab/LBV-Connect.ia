"""Projection non destructive des revisions de conversations ORIA.

La table messages demeure l'historique historique (append-only).
Les revisions deviennent une vue logique des messages actifs, sans effacement.
Ne jamais introduire l'ancienne branche dans le contexte IA actif.
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

PAGE_SIZE = 200
MAX_THREADS = 4000


def _page(client: Any, table: str, columns: str, *, conversation_id: str | None,
          user_id: str, thread_id: str | None = None) -> list[dict]:
    """Scan borne et ordonne, y compris quand la derniere page est pleine."""
    output: list[dict] = []
    for start in range(0, MAX_THREADS, PAGE_SIZE):
        query = client.table(table).select(columns).eq("user_id", user_id)
        if conversation_id is not None:
            query = query.eq("conversation_id", conversation_id)
        if thread_id is not None:
            query = query.eq("thread_id", thread_id)
        page = (query.order("created_at", desc=False).order("id", desc=False)
                .range(start, start + PAGE_SIZE - 1).execute().data or [])
        output.extend(page)
        if len(page) < PAGE_SIZE:
            return output
    probe = client.table(table).select("id").eq("user_id", user_id)
    if conversation_id is not None:
        probe = probe.eq("conversation_id", conversation_id)
    if thread_id is not None:
        probe = probe.eq("thread_id", thread_id)
    if (probe.order("created_at", desc=False).order("id", desc=False)
            .range(MAX_THREADS, MAX_THREADS).execute().data or []):
        raise RuntimeError("Trop de revisions pour projeter la conversation en securite.")
    return output


def active_revision_pairs(client: Any, *, conversation_id: str,
                          user_id: str) -> list[tuple[dict, dict]]:
    threads = _page(client, "oria_chat_edit_threads", "*",
                    conversation_id=conversation_id, user_id=user_id)
    active: list[tuple[dict, dict]] = []
    for thread in threads:
        number = int(thread.get("active_revision") or 0)
        if number <= 0:
            continue
        rows = _page(client, "oria_chat_edit_revisions", "*",
                     conversation_id=None, user_id=user_id,
                     thread_id=str(thread["id"]))
        matching = [r for r in rows if int(r.get("revision_no") or 0) == number
                    and r.get("status") == "ready"
                    and isinstance(r.get("assistant_content"), str)]
        if len(matching) != 1:
            raise RuntimeError("Revision active incoherente : verification de la base necessaire.")
        active.append((thread, matching[0]))
    return active


def _moment(value: Any) -> datetime:
    if isinstance(value, datetime):
        dt = value
    else:
        dt = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    return dt.replace(tzinfo=timezone.utc) if dt.tzinfo is None else dt


def project_active_messages(
    rows: list[dict], active: list[tuple[dict, dict]],
) -> tuple[list[dict], dict[str, Any]]:
    """Applique les versions actives dans l'ordre de leur activation.

    Toute ancienne continuation avant l'activation est masquee. Les messages
    ajoutes APRES la derniere activation restent visibles et reutilisables.
    La DB n'est jamais modifiee ici.
    """
    projected = [dict(row) for row in rows]
    active_artifact_ids: set[str] = set()
    assistant_sources: set[str] = set()
    for thread, revision in active:
        if thread.get("assistant_message_id"):
            assistant_sources.add(str(thread["assistant_message_id"]))
    for thread, revision in sorted(
        active, key=lambda pair: _moment(pair[0].get("updated_at") or pair[1].get("completed_at") or pair[1].get("updated_at"))
    ):
        user_id = str(thread["user_message_id"])
        answer_id = str(thread.get("assistant_message_id") or "")
        idx = next((i for i, item in enumerate(projected)
                    if str(item.get("id")) == user_id), None)
        if idx is None:
            # Une ancre appartenant a une ancienne branche n'est plus active.
            continue
        answer_idx = next((i for i, item in enumerate(projected)
                           if str(item.get("id")) == answer_id), None)
        if answer_idx is None or answer_idx <= idx:
            raise RuntimeError("Reponse originale introuvable dans l'historique.")
        activated_at = _moment(thread.get("updated_at") or revision.get("completed_at") or revision.get("updated_at"))
        # Les echanges de l'ancienne branche, posterieurs au tour modifie,
        # restent en base mais sont masques. Le texte du tour est remplace.
        suffix = [row for row in projected[answer_idx + 1:]
                  if _moment(row.get("created_at")) >= activated_at]
        prefix = projected[:answer_idx + 1]
        prefix[idx] = {**prefix[idx], "content": revision["user_content"],
                       "oria_active_revision": int(revision["revision_no"])}
        prefix[answer_idx] = {**prefix[answer_idx], "content": revision["assistant_content"],
                              "oria_active_revision": int(revision["revision_no"])}
        projected = prefix + suffix
        for ref in revision.get("artifact_refs") or []:
            if isinstance(ref, str):
                active_artifact_ids.add(ref)
            elif isinstance(ref, dict) and ref.get("id"):
                active_artifact_ids.add(str(ref["id"]))
    return projected, {
        "has_active_revisions": bool(active),
        "assistant_source_ids": assistant_sources,
        "active_artifact_ids": active_artifact_ids,
    }
