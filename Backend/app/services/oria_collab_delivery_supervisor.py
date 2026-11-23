"""Keep a billable collaborative request running if its HTTP viewer disconnects.

The job continues only while this Render process remains alive. This does NOT
make jobs durable across process restarts. Provider retries are forbidden when
financial outcome is ambiguous. This module never bills or releases credits.
"""
from __future__ import annotations
import asyncio
import logging
from collections.abc import Callable, Awaitable
from typing import Any
from fastapi import HTTPException

LOG = logging.getLogger(__name__)
_INFLIGHT: dict[str, asyncio.Task] = {}


def _finished(key: str, task: asyncio.Task) -> None:
    _INFLIGHT.pop(key, None)
    try:
        task.result()
    except asyncio.CancelledError:
        LOG.error("ORIA_COLLAB_BACKGROUND_CANCELLED request_ref=%s", key)
    except Exception:
        LOG.exception("ORIA_COLLAB_BACKGROUND_FINISHED_WITH_ERROR request_ref=%s", key)


async def await_independent_delivery(key: str, fn: Callable[[], Awaitable[dict]]) -> dict:
    """One server task, shielded from client navigation/cancellation."""
    if not key or len(key)>250:
        raise HTTPException(422, "Référence de demande invalide.")
    # The DB reservation remains authoritative across replicas; this guard is
    # only in-process and is NEVER a replacement for SQL idempotency.
    if key in _INFLIGHT:
        raise HTTPException(409, "Cette demande est déjà en cours. Aucun appel IA supplémentaire.")
    task=asyncio.create_task(fn(), name="oria-collab:"+key)
    _INFLIGHT[key]=task
    task.add_done_callback(lambda finished: _finished(key, finished))
    return await asyncio.shield(task)
