"""Tests de récupération OpenRouter, sans réseau et sans crédits.

Depuis backend/ :
  python test_oria_openrouter_recuperation.py

Lit app/services/openrouter_media_service.py sans appeler OpenRouter.
"""
from __future__ import annotations

import base64
import importlib.util
import io
import json
import logging
import sys
import tempfile
import unittest
from pathlib import Path

SERVICE = Path(__file__).resolve().parent / "app" / "services" / "openrouter_media_service.py"
if not SERVICE.is_file():
    # Also supports running this test directly against the delivered file.
    SERVICE = Path(__file__).resolve().parent / "openrouter_media_service_recuperation_corrige.py"
if not SERVICE.is_file():
    raise SystemExit("Fichier du service introuvable. Placer ce test dans backend/.")
spec = importlib.util.spec_from_file_location("oria_openrouter_recovery_under_test", SERVICE)
assert spec and spec.loader
module = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = module
spec.loader.exec_module(module)

PNG = b"\x89PNG\r\n\x1a\n" + b"fake-image-png-content"
JPEG = b"\xff\xd8\xff" + b"fake-image-jpeg-content"
WEBP = b"RIFF" + (18).to_bytes(4, "little") + b"WEBP" + b"fake-webp-content"

class FakeResponse:
    status = 200
    def __init__(self, raw: bytes):
        self.buffer = io.BytesIO(raw)
    def read(self, count):
        return self.buffer.read(count)
    def __enter__(self):
        return self
    def __exit__(self, *args):
        return False

class FakeOpenRouter:
    def __init__(self, reply, *, error=None):
        self.reply = reply
        self.error = error
        self.calls = 0
        self.method = None
    def __call__(self, request, timeout=0):
        self.calls += 1
        self.method = request.get_method()
        if self.error is not None:
            raise self.error
        return FakeResponse(json.dumps(self.reply).encode())

class Service(module.OpenRouterMediaService):
    def list_image_models(self):
        return [{"id": "google/gemini-3.1-flash-image", "supported_parameters": {
            "resolution": {"values": ["1K"]},
            "aspect_ratio": {"values": ["1:1"]},
        }}]

class ImageRetrievalTests(unittest.TestCase):
    def generate(self, reply, *, error=None):
        opener = FakeOpenRouter(reply, error=error)
        client = Service(api_key="test-key-no-network", opener=opener)
        with tempfile.TemporaryDirectory() as directory:
            file = client.create_image(
                model="google/gemini-3.1-flash-image", prompt="un arbre",
                destination=Path(directory) / "out", request_id="offline-request-01")
            self.assertEqual(Path(file.file_path).read_bytes(), self.expected_image)
            self.assertEqual(opener.calls, 1)  # Never retry a paid POST.
            self.assertEqual(opener.method, "POST")
            return file
    @staticmethod
    def item(content, mime=None):
        entry = {"b64_json": base64.b64encode(content).decode("ascii")}
        if mime is not None:
            entry["media_type"] = mime
        return entry
    def test_01_png_standard_and_cost(self):
        self.expected_image = PNG
        result = self.generate({"data": [self.item(PNG, "image/png")], "usage": {"cost": 0.151}})
        self.assertEqual(result.mime_type, "image/png")
        self.assertEqual(result.usage["cost"], 0.151)
    def test_02_jpeg_without_media_type(self):
        self.expected_image = JPEG
        result = self.generate({"data": [self.item(JPEG)]})
        self.assertEqual(result.mime_type, "image/jpeg")
        self.assertIsNone(result.usage["cost"])
    def test_03_webp_without_media_type(self):
        self.expected_image = WEBP
        result = self.generate({"data": [self.item(WEBP)]})
        self.assertEqual(result.mime_type, "image/webp")
    def test_04_incorrect_mime_label_uses_verified_bytes(self):
        self.expected_image = JPEG
        result = self.generate({"data": [self.item(JPEG, "image/png")]})
        self.assertEqual(result.mime_type, "image/jpeg")
    def test_05_first_missing_second_valid(self):
        self.expected_image = JPEG
        result = self.generate({"data": [{"b64_json": None}, self.item(JPEG)]})
        self.assertEqual(result.mime_type, "image/jpeg")
    def test_06_data_url_supported(self):
        self.expected_image = PNG
        uri = "data:image/png;base64," + base64.b64encode(PNG).decode()
        result = self.generate({"data": [{"b64_json": uri}]})
        self.assertEqual(result.mime_type, "image/png")
    def test_07_bad_base64_fails_without_retry(self):
        opener = FakeOpenRouter({"data": [{"b64_json": "!!!"}]})
        client = Service(api_key="secret", opener=opener)
        with tempfile.TemporaryDirectory() as directory:
            with self.assertRaises(module.OpenRouterMediaError) as exc:
                client.create_image(model="google/gemini-3.1-flash-image", prompt="secret prompt",
                                    destination=Path(directory) / "out")
            self.assertEqual(exc.exception.phase, "base64_decode")
            self.assertEqual(opener.calls, 1)
            self.assertFalse(list(Path(directory).iterdir()))
    def test_08_invalid_image_signature_fails_closed(self):
        opener = FakeOpenRouter({"data": [self.item(b"not-an-image", "image/jpeg")]})
        client = Service(api_key="secret", opener=opener)
        with tempfile.TemporaryDirectory() as directory:
            with self.assertRaises(module.OpenRouterMediaError) as exc:
                client.create_image(model="google/gemini-3.1-flash-image", prompt="p",
                                    destination=Path(directory) / "out")
            self.assertEqual(exc.exception.phase, "image_signature")
    def test_09_no_data_fails_closed(self):
        opener = FakeOpenRouter({"data": []})
        client = Service(api_key="secret", opener=opener)
        with tempfile.TemporaryDirectory() as directory:
            with self.assertRaises(module.OpenRouterMediaError) as exc:
                client.create_image(model="google/gemini-3.1-flash-image", prompt="p",
                                    destination=Path(directory) / "out")
            self.assertEqual(exc.exception.phase, "image_list_empty")
    def test_10_socket_error_does_not_retry(self):
        opener = FakeOpenRouter({}, error=TimeoutError("timed out"))
        client = Service(api_key="secret", opener=opener)
        with tempfile.TemporaryDirectory() as directory:
            with self.assertRaises(module.OpenRouterMediaError):
                client.create_image(model="google/gemini-3.1-flash-image", prompt="p",
                                    destination=Path(directory) / "out")
            self.assertEqual(opener.calls, 1)
    def test_11_logs_only_metadata(self):
        blob = base64.b64encode(JPEG).decode()
        handler = RecordingHandler()
        log = logging.getLogger("oria.openrouter.recovery")
        log.addHandler(handler)
        old = log.level
        log.setLevel(logging.INFO)
        try:
            self.expected_image = JPEG
            self.generate({"data": [{"b64_json": blob}]})
        finally:
            log.removeHandler(handler)
            log.setLevel(old)
        text = " ".join(handler.messages)
        self.assertIn("temporary_file_saved", text)
        self.assertIn("offline-request-01", text)
        self.assertNotIn(blob, text)
        self.assertNotIn("un arbre", text)
        self.assertNotIn("test-key", text)

class RecordingHandler(logging.Handler):
    def __init__(self):
        super().__init__(); self.messages = []
    def emit(self, record):
        self.messages.append(record.getMessage())

if __name__ == "__main__":
    print("ORIA - Test de récupération OpenRouter (simulation locale, 0 appel payant)")
    print(f"Service : {SERVICE}")
    unittest.main(verbosity=2)
