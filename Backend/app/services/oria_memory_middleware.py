"""ORIA ASGI memory cleanup: one integration at the FastAPI app level.

Handles HTTP routes defined across ai.py, routes.py, or other routers without
modifying each route. Cleanup occurs ONLY after ASGI processing finishes,
including streamed responses and Starlette background tasks.

Important: this is best-effort cleanup of *unreachable* Python objects.
It cannot prevent an OOM occurring during large allocations, cannot free
objects other requests still use, and must not delete persisted user files.
"""
from __future__ import annotations

import asyncio
import logging
import os
import threading
import time
from typing import Callable, Any

from app.services.oria_memory_management import purge_ram, _rss_mb, _cgroup_mb

LOG = logging.getLogger("oria.memory")

# Avoid forcing full GC on every status, billing or lightweight chat request.
_HEAVY_KEYWORDS = (
    "/image", "/video", "/media", "/creation", "/artifact", "/document",
    "/export", "/audio", "/transcri", "/upload", "/render", "/course",
)
_MUTATIONS = {"POST", "PUT", "PATCH"}


class OriaMemoryCleanupMiddleware:
    """Pure ASGI middleware; no FastAPI or Starlette import needed.

    This middleware covers every HTTP router attached to the ASGI app.
    Set ORIA_RAM_PURGE_MIN_INTERVAL_SECONDS (default 8) to throttle full GC.
    When cgroup usage exceeds 80% or RSS exceeds an optional threshold,
    it performs cleanup immediately (if no other cleanup is running).
    """
    _lock = threading.Lock()
    _last_purge = 0.0

    def __init__(self, app: Callable[..., Any]):
        self.app = app

    @staticmethod
    def _should_check(method: str, path: str) -> bool:
        lower = path.lower()
        return method in _MUTATIONS and any(k in lower for k in _HEAVY_KEYWORDS)

    @staticmethod
    def _memory_pressure() -> bool:
        current, limit = _cgroup_mb()
        if current is not None and limit and limit > 0 and current / limit >= 0.80:
            return True
        threshold = os.getenv("ORIA_RAM_RSS_THRESHOLD_MB", "").strip()
        if threshold:
            try:
                rss = _rss_mb()
                return rss is not None and rss >= max(1, float(threshold))
            except ValueError:
                pass
        return False

    @classmethod
    def _maybe_purge(cls, path: str) -> None:
        # Minimal, nonblocking synchronization: do not hang active requests to
        # wait for other GC. Concurrent tasks share this process, not workers.
        with cls._lock:
            try:
                interval = max(0.0, float(os.getenv("ORIA_RAM_PURGE_MIN_INTERVAL_SECONDS", "8")))
            except ValueError:
                interval = 8.0
            now = time.monotonic()
            if not cls._memory_pressure() and now - cls._last_purge < interval:
                return
            cls._last_purge = now
        # Avoid logging user-supplied URL path or query values.
        purge_ram("http_heavy_action")

    async def __call__(self, scope: dict, receive: Callable, send: Callable) -> None:
        if scope.get("type") != "http":
            await self.app(scope, receive, send)
            return
        path = scope.get("path", "")
        method = scope.get("method", "")
        # Ensure cleanup runs on handler exceptions, too. During a streamed
        # response this finally is only reached after its body has finished.
        try:
            await self.app(scope, receive, send)
        finally:
            if self._should_check(method, path):
                # Full GC can pause Python threads; do not block the ASGI event loop.
                await asyncio.to_thread(self._maybe_purge, path)
