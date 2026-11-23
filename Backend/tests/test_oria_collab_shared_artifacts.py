"""Offline tests: no network, no Supabase, no billable provider call."""
import asyncio
import importlib.util
import pathlib
import sys
import types
import unittest

HERE = pathlib.Path(__file__).resolve().parents[1]
PATH = HERE / 'app/services/oria_collab_shared_artifacts.py'


class DummyHTTPException(Exception):
    def __init__(self, status_code, detail):
        super().__init__(detail)
        self.status_code = status_code
        self.detail = detail


class BridgeTests(unittest.TestCase):
    def setUp(self):
        self.previous = {key: sys.modules.get(key) for key in
                         ('fastapi', 'app', 'app.route', 'app.route.ai')}
        sys.modules['fastapi'] = types.SimpleNamespace(HTTPException=DummyHTTPException)
        sys.modules['app'] = types.ModuleType('app')
        sys.modules['app.route'] = types.ModuleType('app.route')
        ai = types.ModuleType('app.route.ai')
        self.calls = []

        class Engine:
            def supported_types(self):
                return {'documents': ['pdf', 'docx', 'epub'],
                        'spreadsheets': ['xlsx'], 'web_and_code': ['py']}

        def detect(*, message, explicit_type=None):
            self.calls.append(('detect', message, explicit_type))
            if message.startswith('Fais un Excel'):
                return [{'file_type': 'xlsx', 'filename': 'exemple.xlsx'}]
            return []

        def compile_payload(**kwargs):
            self.calls.append(('compile', kwargs))
            return ['generated-with-main-engine']

        ai.ARTIFACT_SERVICE = Engine()
        ai.MAX_ARTIFACTS_PER_TURN = 3
        ai._resolve_artifact_requests = detect
        ai._render_document_results = compile_payload
        sys.modules['app.route.ai'] = ai
        spec = importlib.util.spec_from_file_location('collab_shared_artifacts_test', PATH)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        self.bridge = module

    def tearDown(self):
        for key, value in self.previous.items():
            if value is None:
                sys.modules.pop(key, None)
            else:
                sys.modules[key] = value

    def test_capabilities_are_from_main_engine(self):
        info = self.bridge.shared_artifact_capabilities()
        self.assertEqual(info['formats']['documents'], ['pdf', 'docx', 'epub'])
        self.assertEqual(info['max_artifacts_per_turn'], 3)
        self.assertFalse(info['collaborative_delivery_ready'])

    def test_detector_is_identical_to_main(self):
        planned = self.bridge.plan_shared_artifacts('Fais un Excel sur le Gabon')
        self.assertEqual(planned[0]['file_type'], 'xlsx')
        self.assertIn(('detect', 'Fais un Excel sur le Gabon', None), self.calls)

    def test_binary_request_fails_closed_before_billing(self):
        with self.assertRaises(DummyHTTPException) as error:
            self.bridge.reject_undeliverable_artifacts('Fais un Excel sur le Gabon')
        self.assertEqual(error.exception.status_code, 501)
        self.assertIn('Aucun crédit', error.exception.detail)

    def test_normal_chat_is_unchanged(self):
        self.assertIsNone(self.bridge.reject_undeliverable_artifacts('Bonjour ORIA'))

    def test_delegate_compilation_same_helper(self):
        value = asyncio.run(self.bridge.compile_shared_document_payload(
            artifact_payload={'schema_version': 'oria.artifact.v1'},
            artifact_requests=[{'file_type': 'pdf'}], generation_id='g',
            reasoning_mode='deep', model='gpt-6-luna', openai_model='gpt-6',
        ))
        self.assertEqual(value, ['generated-with-main-engine'])
        self.assertEqual(self.calls[-1][0], 'compile')
        self.assertEqual(self.calls[-1][1]['reasoning_mode'], 'deep')


if __name__ == '__main__':
    unittest.main()
