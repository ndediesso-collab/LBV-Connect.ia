"""P2 offline tests: no Supabase traffic, no provider calls, no credits."""
from __future__ import annotations

import hashlib
import importlib.util
from pathlib import Path
import sys
import types
from dataclasses import dataclass
from uuid import uuid4
import unittest

ROOT = Path(__file__).resolve().parents[2]
MODULE = ROOT / 'Backend/app/services/oria_collab_artifact_delivery.py'
SQL = ROOT / 'ORIA_COLLAB_P2_LIVRAISON_ATOMIQUE.sql'

old = {name: sys.modules.get(name) for name in (
    'app', 'app.services', 'app.services.oria_collab_chat_hub_service',
)}
sys.modules['app'] = types.ModuleType('app')
sys.modules['app.services'] = types.ModuleType('app.services')
stub = types.ModuleType('app.services.oria_collab_chat_hub_service')
stub.BUCKET = 'oria-collab-private'
sys.modules[stub.__name__] = stub
spec = importlib.util.spec_from_file_location('oria_collab_artifact_delivery_test', MODULE)
M = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = M
spec.loader.exec_module(M)


@dataclass
class Result:
    filename: str
    data: bytes
    mime_type: str = 'application/pdf'
    size_bytes: int = 0
    sha256: str = ''

    def __post_init__(self):
        self.size_bytes = len(self.data)
        self.sha256 = hashlib.sha256(self.data).hexdigest()


class Storage:
    def __init__(self):
        self.objects = {}
        self.uploads = 0

    def upload(self, path, binary, options):
        self.uploads += 1
        if path in self.objects:
            raise FileExistsError('duplicate')
        self.objects[path] = bytes(binary)

    def download(self, path):
        return self.objects[path]


class Db:
    def __init__(self):
        self.bucket = Storage()
        self.storage = self

    def from_(self, bucket):
        assert bucket == 'oria-collab-private'
        return self.bucket


class DeliveryTests(unittest.TestCase):
    def setUp(self):
        self.ws = str(uuid4())
        self.req = str(uuid4())
        self.db = Db()

    def test_exact_principal_document_contract_allowlist(self):
        self.assertTrue(M.supported_document_requests([
            {'file_type': 'pdf'}, {'file_type': 'xlsx'}, {'file_type': 'epub'}]))
        self.assertFalse(M.supported_document_requests([{'file_type': 'zip'}]))
        self.assertFalse(M.supported_document_requests([{'file_type': 'py'}]))
        self.assertFalse(M.supported_document_requests([]))
        self.assertFalse(M.supported_document_requests([{'file_type': 'pdf'}] * 4))

    def test_stage_hash_verified(self):
        a = Result('expose.pdf', b'%PDF-1.7\n...')
        staged = M.stage_group_artifacts(self.db, workspace_id=self.ws, request_id=self.req, results=[a])
        self.assertEqual(len(staged), 1)
        self.assertEqual(staged[0]['size_bytes'], len(a.data))
        self.assertEqual(self.db.bucket.download(staged[0]['storage_path']), a.data)
        self.assertIn(self.ws + '/' + self.req + '/', staged[0]['storage_path'])
        self.assertEqual(staged[0]['sha256'], a.sha256)

    def test_replay_same_id_only_when_bytes_identical(self):
        data = Result('rapport.pdf', b'%PDF-1.7-OK')
        first = M.stage_group_artifacts(self.db, workspace_id=self.ws, request_id=self.req, results=[data])
        second = M.stage_group_artifacts(self.db, workspace_id=self.ws, request_id=self.req, results=[data])
        self.assertEqual(first, second)
        with self.assertRaises(M.CollabArtifactDeliveryError):
            M.stage_group_artifacts(self.db, workspace_id=self.ws, request_id=self.req,
                                    results=[Result('rapport.pdf', b'%PDF-1.7-OTHER')])

    def test_reject_invalid_hash_and_empty_binary(self):
        data = Result('rapport.pdf', b'%PDF-1.7')
        data.sha256 = '0' * 64
        with self.assertRaises(M.CollabArtifactDeliveryError):
            M.stage_group_artifacts(self.db, workspace_id=self.ws, request_id=self.req, results=[data])
        with self.assertRaises(M.CollabArtifactDeliveryError):
            M.stage_group_artifacts(self.db, workspace_id=self.ws, request_id=self.req,
                                    results=[Result('empty.pdf', b'')])

    def test_reject_cross_workspace_or_path_malformed(self):
        a, b = str(uuid4()), str(uuid4())
        path = M.staged_file_path(self.ws, self.req, a, '../rapport.pdf')
        self.assertTrue(path.startswith(self.ws + '/'))
        self.assertNotIn('../', path)
        with self.assertRaises(ValueError):
            M.staged_file_path('another-group', self.req, b, 'rapport.pdf')

    def test_compiler_response_is_only_a_confirmation_not_a_signed_url(self):
        answer = M.group_document_confirmation([Result('expose.epub', b'x')])
        self.assertIn('expose.epub', answer)
        self.assertNotIn('https://', answer)

    def test_atomic_sql_calls_existing_v3_and_links_files(self):
        text = SQL.read_text(encoding='utf-8')
        self.assertIn('oria_collab_group_ai_settle_v3(', text)
        self.assertIn('INSERT INTO public.oria_collab_chat_files', text)
        self.assertIn('storage.objects', text)
        self.assertIn('REVOKE ALL ON FUNCTION', text)
        self.assertIn('TO service_role;', text)
        self.assertIn('v_message_id', text)


if __name__ == '__main__':
    try:
        unittest.main(verbosity=2, exit=False)
    finally:
        for name, previous in old.items():
            if previous is None:
                sys.modules.pop(name, None)
            else:
                sys.modules[name] = previous
