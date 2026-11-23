"""ORIA Collaboratif P2: private staging of artifacts from the PRINCIPAL compiler.

There is deliberately no spreadsheet/PDF/EPUB generator here. The compiler is
app.route.ai._render_document_results / ArtifactService. Uploads happen BEFORE
the authoritative collaborative SQL settlement. All paths are scoped and
idempotent; no URL from a model response is trusted.
"""
from __future__ import annotations

import hashlib
import re
from dataclasses import dataclass
from typing import Any
from uuid import UUID, uuid5

from app.services.oria_collab_chat_hub_service import BUCKET

MAX_GROUP_FILE_BYTES = 8 * 1024 * 1024  # Existing collab chat file constraint.
MAX_FILES = 3
SAFE_NAME = re.compile(r"[^A-Za-z0-9._-]")

# Only formats which use the principal 'oria.artifact.v1' document contract.
# Code/ZIP/media go through other existing principal-chat paths in subsequent phases.
DOCUMENT_CONTRACT_FORMATS = frozenset({
    'pdf', 'docx', 'rtf', 'odt', 'epub', 'pptx', 'odp',
    'xlsx', 'ods', 'csv', 'tsv', 'json', 'jsonl', 'ndjson', 'sqlite',
})


class CollabArtifactDeliveryError(RuntimeError):
    pass


def supported_document_requests(requests: list[dict]) -> bool:
    return (bool(requests) and len(requests) <= MAX_FILES and all(
        isinstance(item, dict) and item.get('file_type') in DOCUMENT_CONTRACT_FORMATS
        for item in requests
    ))


def _uuid(value: str) -> str:
    return str(UUID(str(value)))


def _read_bytes(binary: Any) -> bytes:
    if isinstance(binary, bytes):
        return binary
    if isinstance(binary, bytearray):
        return bytes(binary)
    # No arbitrary object coercion; byte verification is mandatory.
    raise CollabArtifactDeliveryError('Résultat documentaire binaire invalide.')


def staged_file_path(workspace_id: str, request_id: str, file_id: str, name: str) -> str:
    ws, job, fid = (_uuid(part) for part in (workspace_id, request_id, file_id))
    safe = SAFE_NAME.sub('_', name.strip().replace('/', '_').replace('\\', '_'))[:120]
    if safe in {'', '.', '..'}:
        raise CollabArtifactDeliveryError('Nom de fichier invalide.')
    value = f'{ws}/{job}/{fid}/{safe}'
    if len(value) > 300:
        raise CollabArtifactDeliveryError('Chemin documentaire trop long.')
    return value


def stage_group_artifacts(db: Any, *, workspace_id: str, request_id: str,
                          results: list[Any]) -> list[dict[str, Any]]:
    """Upload + read-back hash check; does NOT settle credits or publish links.

    Existing identical object can be replayed after an ambiguous upload result;
    differing bytes at a deterministic path always fail closed.
    """
    ws, job = _uuid(workspace_id), _uuid(request_id)
    if not 1 <= len(results) <= MAX_FILES:
        raise CollabArtifactDeliveryError('Nombre de documents non autorisé.')
    staged: list[dict[str, Any]] = []
    storage = db.storage.from_(BUCKET)
    for index, result in enumerate(results):
        filename = str(getattr(result, 'filename', '') or '').strip()
        mime = str(getattr(result, 'mime_type', '') or '').split(';', 1)[0].strip()
        raw = _read_bytes(getattr(result, 'data', None))
        if not filename or len(filename) > 150 or not mime or len(mime) > 150:
            raise CollabArtifactDeliveryError('Métadonnées documentaires invalides.')
        if not 1 <= len(raw) <= MAX_GROUP_FILE_BYTES:
            raise CollabArtifactDeliveryError('Fichier supérieur à 8 Mo ou vide.')
        declared_sha = getattr(result, 'sha256', None)
        digest = hashlib.sha256(raw).hexdigest()
        if getattr(result, 'size_bytes', None) != len(raw) or declared_sha != digest:
            raise CollabArtifactDeliveryError('Empreinte ou taille du fichier incohérente.')
        file_id = str(uuid5(UUID(job), f'oria-collab-generated-file:{index}'))
        path = staged_file_path(ws, job, file_id, filename)
        try:
            storage.upload(path, raw, {'content-type': mime, 'upsert': 'false'})
        except Exception:
            # Upload may have actually succeeded. Replay only when the exact
            # bytes match. Never overwrite a private object after ambiguity.
            try:
                previously_saved = storage.download(path)
                if not isinstance(previously_saved, (bytes, bytearray)) or bytes(previously_saved) != raw:
                    raise CollabArtifactDeliveryError('Collision de fichier privé.')
            except Exception as exc:
                raise CollabArtifactDeliveryError('Stockage privé non confirmé.') from exc
        try:
            checked = storage.download(path)
        except Exception as exc:
            raise CollabArtifactDeliveryError('Relecture privée indisponible.') from exc
        if not isinstance(checked, (bytes, bytearray)) or hashlib.sha256(bytes(checked)).hexdigest() != digest:
            raise CollabArtifactDeliveryError('Intégrité du fichier stocké non confirmée.')
        staged.append({
            'file_id': file_id, 'storage_path': path, 'original_name': filename,
            'mime_type': mime, 'size_bytes': len(raw), 'sha256': digest,
        })
    return staged


def group_document_confirmation(results: list[Any]) -> str:
    """Text of the ORIA group message: links are resolved by the authorized API."""
    if not results:
        raise CollabArtifactDeliveryError('Aucun document prêt.')
    names = [str(getattr(x, 'filename', '')).strip() for x in results]
    return ('Fichier prêt : ' if len(names) == 1 else 'Fichiers prêts : ') + ', '.join(names) + '. Aperçu et téléchargement dans les pièces jointes du message.'
