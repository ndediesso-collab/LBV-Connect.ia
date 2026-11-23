"""Server-side persistence of group text streaming & immutable provider receipts.

Every read must be preceded by workspace/group authorization in the route.
Never expose `receipt` or financial provider metadata in user-facing API data.
"""
from __future__ import annotations

import logging
import time
from datetime import datetime, timezone
from typing import Any
from fastapi import HTTPException

TABLE = 'oria_collab_group_ai_delivery_progress'
LOG = logging.getLogger(__name__)


def preflight(db: Any) -> None:
    """Fail closed *before the credit reservation* if migration is absent."""
    try:
        db.table(TABLE).select('request_id').limit(1).execute()
    except Exception as exc:
        raise HTTPException(503, 'Migration P8 de livraison non installée.') from exc


class ProgressWriter:
    def __init__(self, db: Any, *, request: str, workspace: str, group: str, caller: str):
        self.db, self.request, self.workspace = db, request, workspace
        self.group, self.caller = group, caller
        self.preview = ''
        self.last_persist = 0.0
        self.last_length = 0
        self.seq = 0
        self.receipt_ready = False

    def start(self) -> None:
        record = {'request_id': self.request, 'workspace_id': self.workspace,
                  'group_id': self.group, 'caller_user_id': self.caller,
                  'phase': 'running', 'preview': '', 'seq': 0}
        # A write is required before the provider boundary. Never overwrite a
        # prior receipt on a retry or lose idempotency metadata.
        self.db.table(TABLE).insert(record).execute()

    def _update(self, data: dict) -> None:
        data = {**data, 'updated_at': datetime.now(timezone.utc).isoformat()}
        result = (self.db.table(TABLE).update(data)
                  .eq('request_id', self.request).eq('workspace_id', self.workspace)
                  .eq('group_id', self.group).execute())
        if not getattr(result, 'data', None):
            raise RuntimeError('Progression P8 non enregistrée.')

    def delta(self, addition: str) -> None:
        self.preview += addition
        if len(self.preview) > 4000:
            raise RuntimeError('Réponse collaborative supérieure au plafond autorisé.')
        now = time.monotonic()
        # DB snapshots at most ~2 / second or every 180 chars.
        if now - self.last_persist >= .45 or len(self.preview) - self.last_length >= 180:
            try:
                self.flush()
            except Exception:
                # A transient progress-store outage must not abandon an otherwise
                # billable provider response. A final receipt is still mandatory.
                LOG.exception('ORIA_P8_PROGRESS_TRANSIENT_ERROR request_id=%s', self.request)

    def flush(self) -> None:
        if len(self.preview) == self.last_length:
            return
        self.seq += 1
        self._update({'preview': self.preview, 'seq': self.seq})
        self.last_length = len(self.preview)
        self.last_persist = time.monotonic()

    def receipt(self, *, response: str, credits: int, provider_id: str,
                cost_usd: str, cost_xaf: str, artifacts: list[dict],
                web_images: list[dict] | None = None,
                citations: list[dict] | None = None) -> None:
        if len(response) > 4000 or not response or credits < 1 or not provider_id:
            raise RuntimeError('Reçu fournisseur invalide.')
        # Immutable authoritative receipt, BEFORE existing SQL settle.
        # In case of process interruption, a no-provider retry can settle it.
        from app.services.oria_collab_rich_meta_v1 import safe_images, safe_sources
        proof = {'web_images': safe_images(web_images), 'sources': safe_sources(citations),
                 'response': response, 'actual_credits': credits,
                 'provider_response_id': provider_id, 'provider_cost_usd': cost_usd,
                 'actual_api_cost_xaf': cost_xaf, 'artifacts': artifacts}
        self.seq += 1
        self._update({'preview': response, 'phase': 'provider_complete',
                      'receipt': proof, 'seq': self.seq,
                      })
        self.receipt_ready = True

    def settled(self) -> None:
        self.seq += 1
        self._update({'phase': 'settled', 'seq': self.seq})

    def uncertain(self) -> None:
        try:
            self.seq += 1
            self._update({'phase': 'uncertain', 'seq': self.seq})
        except Exception:
            LOG.exception('ORIA_P8_UNCERTAIN_PROGRESS_FAILED request_id=%s', self.request)


def snapshot(db: Any, workspace: str, group: str, request: str) -> dict:
    rows = (db.table(TABLE)
            .select('phase,seq,preview,receipt,updated_at')
            .eq('workspace_id', workspace).eq('group_id', group)
            .eq('request_id', request).limit(1).execute().data or [])
    if not rows:
        return {'phase': 'not_started', 'seq': 0, 'preview': '', 'receipt_ready': False}
    row = rows[0]
    return {'phase': str(row.get('phase') or 'unknown'),
            'seq': int(row.get('seq') or 0),
            'preview': str(row.get('preview') or ''),
            'receipt_ready': isinstance(row.get('receipt'), dict),
            'updated_at': str(row.get('updated_at') or '')}


def settle_saved_receipt(db: Any, *, actor: str, workspace: str, group: str,
                         request: str) -> dict:
    """Recover delivery, never repeat a paid provider call, only saved SQL settle."""
    job = (db.table('oria_collab_group_ai_jobs')
           .select('id,state,caller_user_id,group_id,workspace_id')
           .eq('id', request).eq('workspace_id',workspace)
           .eq('group_id', group).limit(1).execute().data or [])
    if not job or str(job[0]['caller_user_id']) != actor:
        raise HTTPException(403, 'Seul l’auteur peut rapprocher sa génération.')
    if job[0]['state'] == 'settled':
        return {'success': True, 'workspace_id':workspace, 'group_id':group,
                'request_id':request, 'state':'settled', 'replayed':True}
    if job[0]['state'] != 'reserved':
        raise HTTPException(409, 'Demande déjà rapprochée ou nécessitant une vérification humaine.')
    rows = (db.table(TABLE).select('phase,receipt').eq('request_id',request)
            .eq('workspace_id',workspace).eq('group_id',group)
            .limit(1).execute().data or [])
    proof = rows[0].get('receipt') if rows else None
    if not isinstance(proof, dict) or rows[0].get('phase') not in ('provider_complete','uncertain'):
        raise HTTPException(409,'Aucun reçu fournisseur complet : impossible de reprendre sans risque.')
    expected = {'response','actual_credits','provider_response_id','provider_cost_usd',
                'actual_api_cost_xaf','artifacts'}
    if not expected.issubset(proof) or not set(proof).issubset(expected | {'web_images','sources'}) or not isinstance(proof['artifacts'], list):
        raise HTTPException(503, 'Reçu fournisseur non conforme.')
    args = {'p_actor_user_id': actor, 'p_request_id':request,
            'p_actual_credits':proof['actual_credits'],
            'p_provider_response_id':proof['provider_response_id'],
            'p_provider_cost_usd':proof['provider_cost_usd'],
            'p_actual_api_cost_xaf':proof['actual_api_cost_xaf'],
            'p_response':proof['response'], 'p_workspace_id':workspace}
    if proof['artifacts']:
        args['p_artifacts'] = proof['artifacts']
    rpc = ('oria_collab_group_ai_settle_artifacts_v1' if proof['artifacts']
           else 'oria_collab_group_ai_settle_v3')
    from app.services.oria_collab_group_ai_service import _safe_rpc
    result = _safe_rpc(db,rpc,args)
    try:
        db.table(TABLE).update({'phase':'settled'}).eq('request_id',request).execute()
    except Exception:
        LOG.exception('ORIA_P8_RECOVERY_STATUS_UPDATE_FAILED request_id=%s',request)
    return {'success':True,'workspace_id':workspace,'group_id':group,
            'request_id':request,'state':'settled','replayed':True,
            'cost':result.get('cost')}
