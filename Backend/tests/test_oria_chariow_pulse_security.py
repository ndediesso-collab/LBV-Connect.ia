from __future__ import annotations

import ast
import hashlib
import hmac
import pathlib
import sys
import unittest

BACKEND = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND))
from app.services.chariow_pulse_security import (  # noqa: E402
    verify_pulse_signature, MAX_PULSE_BODY_BYTES
)


class ChariowPulseSecurityTests(unittest.TestCase):
    secret = "whsec_TEST_only_for_local_unit_tests"
    raw = b'{"event":"successful.sale","sale":{"id":"sal_1","url":"https:\\/\\/example.com"}}'

    def signature(self, payload=None):
        return "sha256=" + hmac.new(
            self.secret.encode(), self.raw if payload is None else payload, hashlib.sha256
        ).hexdigest()

    def test_valid_raw_signature(self):
        self.assertTrue(verify_pulse_signature(
            raw_body=self.raw, received_signature=self.signature(), signing_secret=self.secret
        ))

    def test_modified_raw_body_rejected(self):
        self.assertFalse(verify_pulse_signature(
            raw_body=self.raw.replace(b"sal_1", b"sal_2"), received_signature=self.signature(), signing_secret=self.secret
        ))

    def test_reencoded_json_rejected(self):
        self.assertFalse(verify_pulse_signature(
            raw_body=self.raw.replace(b"\\/", b"/"), received_signature=self.signature(), signing_secret=self.secret
        ))

    def test_wrong_secret_rejected(self):
        self.assertFalse(verify_pulse_signature(
            raw_body=self.raw, received_signature=self.signature(), signing_secret="whsec_WRONG_example_secret"
        ))

    def test_missing_secret_rejected(self):
        self.assertFalse(verify_pulse_signature(
            raw_body=self.raw, received_signature=self.signature(), signing_secret=""
        ))

    def test_wrong_prefix_rejected(self):
        self.assertFalse(verify_pulse_signature(
            raw_body=self.raw, received_signature=self.signature().replace("sha256=", "sha1="), signing_secret=self.secret
        ))

    def test_uppercase_signature_rejected(self):
        self.assertFalse(verify_pulse_signature(
            raw_body=self.raw, received_signature=self.signature().upper(), signing_secret=self.secret
        ))

    def test_empty_body_rejected(self):
        self.assertFalse(verify_pulse_signature(
            raw_body=b"", received_signature=self.signature(), signing_secret=self.secret
        ))

    def test_big_body_rejected(self):
        self.assertFalse(verify_pulse_signature(
            raw_body=b"x" * (MAX_PULSE_BODY_BYTES + 1), received_signature=self.signature(), signing_secret=self.secret
        ))

    def test_routes_parse_and_use_verification(self):
        source = (BACKEND / "app" / "routes.py").read_text(encoding="utf-8")
        tree = ast.parse(source)
        funcs = [n for n in ast.walk(tree) if isinstance(n, ast.AsyncFunctionDef) and n.name == "chariow_webhook"]
        self.assertEqual(len(funcs), 1)
        self.assertIn('verify_pulse_signature(', source)
        self.assertIn('await request.body()', source)
        self.assertIn('x-chariow-signature', source)
        self.assertIn('CHARIOW_PULSE_SECRET', source)
        self.assertNotIn('def chariow_webhook(\n    payload: dict', source)


if __name__ == "__main__":
    unittest.main()
