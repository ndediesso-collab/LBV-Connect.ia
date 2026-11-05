"""Reprises limitées pour les lectures Supabase/PostgREST uniquement.

Une lecture peut être rejouée après une erreur réseau sans modifier la base.
NE PAS utiliser ce helper pour des insert/update/delete/RPC à effets de bord.
"""
from __future__ import annotations

import logging
import random
import time
from typing import Any, Callable

import httpx

logger = logging.getLogger(__name__)

# Exceptions réseau transitoires observées ou attendues pendant une lecture.
_RETRIABLE_READ_ERRORS = (
    httpx.ReadError,
    httpx.ReadTimeout,
    httpx.ConnectError,
    httpx.ConnectTimeout,
    httpx.RemoteProtocolError,
    httpx.PoolTimeout,
)


def execute_supabase_read(
    query_factory: Callable[[], Any],
    *,
    label: str,
    attempts: int = 3,
) -> Any:
    """Exécute une requête READ reconstruite à chaque tentative.

    N'intercepte PAS les erreurs HTTP applicatives (RLS, authentification,
    schema/SQL, etc.) et ne masque jamais un échec persistant.
    """
    if not (1 <= attempts <= 5):
        raise ValueError("attempts doit être compris entre 1 et 5")

    for n in range(1, attempts + 1):
        try:
            return query_factory().execute()
        except _RETRIABLE_READ_ERRORS as exc:
            if n == attempts:
                logger.error(
                    "Lecture Supabase impossible (%s), tentative %d/%d : %s",
                    label, n, attempts, type(exc).__name__,
                )
                raise
            delay = 0.20 * (2 ** (n - 1)) + random.uniform(0, 0.10)
            logger.warning(
                "Lecture Supabase à réessayer (%s), tentative %d/%d : %s",
                label, n, attempts, type(exc).__name__,
            )
            time.sleep(delay)

    raise AssertionError("Boucle de reprise inattendue")
