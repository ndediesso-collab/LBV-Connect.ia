"""Common artifact bridge: ORIA Collaboratif does NOT have a second generator.

The authoritative detector and compiler remain in app.route.ai / ArtifactService.
This bridge does not execute providers, reserve credits, or write to Storage.
Do not expose a successful generated-file response from a plan or a compile call.
"""
from __future__ import annotations

import asyncio
from typing import Any

from fastapi import HTTPException


_NOT_READY = (
    "La création de fichiers dans ORIA Collaboratif n'est pas encore raccordée "
    "à la livraison privée et à la facturation du groupe. "
    "Aucun crédit n'a été réservé pour cette demande."
)


def shared_artifact_capabilities() -> dict[str, Any]:
    """Return formats from the very same ArtifactService instance as /ai/artifacts."""
    from app.route.ai import ARTIFACT_SERVICE, MAX_ARTIFACTS_PER_TURN

    return {
        "engine": "oria.artifact.v1",
        "formats": ARTIFACT_SERVICE.supported_types(),
        "max_artifacts_per_turn": MAX_ARTIFACTS_PER_TURN,
        "collaborative_delivery_ready": False,
    }


def plan_shared_artifacts(message: str, *, explicit_type: str | None = None) -> list[dict]:
    """Use principal chat's natural-language detector; no independent heuristics."""
    from app.route.ai import _resolve_artifact_requests, ARTIFACT_SERVICE

    requests = _resolve_artifact_requests(message=message, explicit_type=explicit_type)
    supported = {extension for formats in ARTIFACT_SERVICE.supported_types().values()
                 for extension in formats}
    for request in requests:
        if request.get("file_type") not in supported:
            raise HTTPException(422, "Format non pris en charge par le moteur ORIA.")
    return requests


def reject_undeliverable_artifacts(message: str) -> None:
    """Before any charge: do not bill a text answer for a requested binary file."""
    if plan_shared_artifacts(message):
        raise HTTPException(status_code=501, detail=_NOT_READY)


async def compile_shared_document_payload(
    *, artifact_payload: dict[str, Any], artifact_requests: list[dict],
    generation_id: str, reasoning_mode: str, model: str, openai_model: str,
) -> list[Any]:
    """Delegate compilation to the paid chat's proven compiler.

    The caller MUST arrange atomic delivery + settlement before using this in
    the collaborative billing path. Compilation alone is not a delivered file.
    """
    from app.route.ai import _render_document_results

    return await asyncio.to_thread(
        _render_document_results,
        artifact_payload=artifact_payload,
        artifact_requests=artifact_requests,
        generation_id=generation_id,
        attempt_id=None,
        reasoning_mode=reasoning_mode,
        model=model,
        openai_model=openai_model,
    )
