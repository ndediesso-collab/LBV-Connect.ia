"""ORIA: opt-in memory diagnostics and bounded cleanup after heavy operations.

Call purge_ram() only *after* a heavy function returns or raises, so its
large local buffers have actually gone out of scope. Never clear shared
caches, delete user files or terminate another user's running task.
"""
from __future__ import annotations

import gc
import functools
import inspect
import logging
import os
import re

_LOG = logging.getLogger("oria.memory")
_SAFE_ACTION = re.compile(r"^[a-z0-9_-]{1,50}$")


def _rss_mb() -> float | None:
    """Read current process RSS on Linux (not a peak/high-water mark)."""
    try:
        with open("/proc/self/status", "r", encoding="ascii") as handle:
            for line in handle:
                if line.startswith("VmRSS:"):
                    return int(line.split()[1]) / 1024
    except (OSError, ValueError, IndexError):
        pass
    return None


def _cgroup_mb() -> tuple[float | None, float | None]:
    """Read cgroup v2 memory usage/limit if exposed by the container."""
    try:
        with open("/sys/fs/cgroup/memory.current", encoding="ascii") as f:
            current = int(f.read().strip()) / 1024 / 1024
        with open("/sys/fs/cgroup/memory.max", encoding="ascii") as f:
            raw = f.read().strip()
            limit = None if raw == "max" else int(raw) / 1024 / 1024
        return current, limit
    except (OSError, ValueError):
        return None, None


def _trim_linux_heap() -> bool:
    """Optional glibc-only heap trim. Disabled unless explicitly enabled.

    It may return unused native allocator pages to the OS. It cannot free
    objects that are still referenced and does not guarantee RSS reduction.
    """
    if os.getenv("ORIA_RAM_TRIM_ENABLED", "0") != "1" or os.name != "posix":
        return False
    try:
        import ctypes
        import ctypes.util
        libc_name = ctypes.util.find_library("c")
        if not libc_name:
            return False
        libc = ctypes.CDLL(libc_name)
        trim = getattr(libc, "malloc_trim", None)
        if trim is None:
            return False
        trim.argtypes = [ctypes.c_size_t]
        trim.restype = ctypes.c_int
        return bool(trim(0))
    except (OSError, AttributeError, ValueError):
        return False


def purge_ram(action: str) -> None:
    """Release unreachable Python objects, and log the memory effect.

    Purge is deliberately best-effort; cleanup errors must never overwrite
    the result/exception of an already-paid user operation.
    """
    try:
        label = action if isinstance(action, str) and _SAFE_ACTION.fullmatch(action) else "heavy_action"
        before = _rss_mb()
        collected = gc.collect()
        trimmed = _trim_linux_heap()
        after = _rss_mb()
        cgroup, limit = _cgroup_mb()
        _LOG.info(
            "ram_purge action=%s rss_before_mb=%s rss_after_mb=%s "
            "cgroup_mb=%s cgroup_limit_mb=%s gc_collected=%s heap_trimmed=%s",
            label,
            round(before, 1) if before is not None else "na",
            round(after, 1) if after is not None else "na",
            round(cgroup, 1) if cgroup is not None else "na",
            round(limit, 1) if limit is not None else "na",
            collected, trimmed,
        )
    except Exception:
        _LOG.warning("ram_purge_failed", exc_info=False)


def purge_after(action: str):
    """Decorator for heavy synchronous or asynchronous ORIA operations.

    Use on functions which fully finish their heavy work before returning.
    Never decorate a streaming generator: its result can remain alive.
    """
    def decorate(func):
        if inspect.iscoroutinefunction(func):
            @functools.wraps(func)
            async def async_wrapper(*args, **kwargs):
                try:
                    return await func(*args, **kwargs)
                finally:
                    purge_ram(action)
            return async_wrapper

        @functools.wraps(func)
        def sync_wrapper(*args, **kwargs):
            try:
                return func(*args, **kwargs)
            finally:
                purge_ram(action)
        return sync_wrapper
    return decorate
