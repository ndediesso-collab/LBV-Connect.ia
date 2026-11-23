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
        # Advertise ready only when ops explicitly enabled the migration.
        "collaborative_delivery_ready": __import__('os').getenv(
            'ORIA_COLLAB_GROUP_DOCUMENTS_ENABLED', '0').strip() == '1',
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


def supported_shared_legacy_requests(requests: list[dict]) -> bool:
    """Only text/code/ZIP extensions provided by the *principal* engine."""
    from app.route.ai import ARTIFACT_SERVICE, _document_artifact_selection
    if not isinstance(requests, list) or not 1 <= len(requests) <= 3:
        return False
    document_types, other = _document_artifact_selection(requests)
    if document_types or len(other) != len(requests):
        return False
    available = ARTIFACT_SERVICE.supported_types()
    legacy = set(available.get('web_and_code', ())) | set(available.get('archives', ()))
    return all(isinstance(v, dict) and v.get('file_type') in legacy for v in requests)


async def compile_shared_legacy_files(
    *, artifact_requests: list[dict], response_text: str, requested_text: str,
    generation_id: str, reasoning_mode: str, model: str, openai_model: str,
) -> list[Any]:
    """Delegates code and ZIP to SAME paid-chat content adapter + ArtifactService.

    No arbitrary executable code is evaluated, no file path is trusted from an LLM,
    and all files are checked *before* staged private upload + SQL settle.
    """
    if not supported_shared_legacy_requests(artifact_requests):
        raise HTTPException(422, 'Fichier source/ZIP non reconnu dans ORIA.')
    if not isinstance(response_text, str) or not response_text.strip():
        raise HTTPException(422, 'Contenu de code absent : aucun fichier créé.')
    from app.route.ai import (
        ARTIFACT_SERVICE, _artifact_content_from_response,
        _assert_code_fences_closed, _is_code_task, _CODE_SOURCE_EXTENSIONS,
    )

    def _compile() -> list[Any]:
        results = []
        code_project = _is_code_task(requested_text, [])
        for request in artifact_requests:
            ext = request['file_type']
            if ext in _CODE_SOURCE_EXTENSIONS or (ext == 'zip' and code_project):
                _assert_code_fences_closed(response_text)
            value = _artifact_content_from_response(
                file_type=ext, response_text=response_text,
                strict_code_project=(ext == 'zip' and code_project),
                requested_text=requested_text,
            )
            results.append(ARTIFACT_SERVICE.create(
                file_type=ext, content=value, filename=request.get('filename'),
                metadata={
                    'source': 'oria-chat', 'generation_id': generation_id,
                    'reasoning_mode': reasoning_mode, 'oria_model': model,
                    'openai_model': openai_model,
                },
            ))
        if len(results) != len(artifact_requests):
            raise RuntimeError('Nombre de fichiers source non conforme.')
        return results

    return await asyncio.to_thread(_compile)
