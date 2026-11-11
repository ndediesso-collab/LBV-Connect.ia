"""Tests unitaires autonomes : pas de Supabase, pas de réseau, pas d'appel API."""
from __future__ import annotations

from pathlib import Path
import subprocess
import sys
import tempfile

from install_oria_knowledge import OPENAI_NEEDLE, OPENROUTER_NEEDLE
from oria_product_knowledge import oria_product_context_for_message, _is_oria_subject


def test_trigger():
    samples = [
        ("Que peut faire ORIA ?", True),
        ("Comment fonctionnes-tu ?", True),
        ("Je veux connaître mon solde de crédits", True),
        ("Quels modèles sont disponibles dans mon pack ORIA ?", True),
        ("Explique la photosynthèse", False),
        ("Les traitements thermiques de l'acier", False),
    ]
    for query, expected in samples:
        assert _is_oria_subject(query) is expected, query
        assert bool(oria_product_context_for_message(query)) is expected, query
    assert "www.myoriaai.com" in oria_product_context_for_message("Qu'est-ce qu'ORIA ?")
    assert oria_product_context_for_message("Quel est mon pack ORIA ?", web_enabled=True) == oria_product_context_for_message("Quel est mon pack ORIA ?", web_enabled=False)


def make_fake_repo(root):
    services = root / 'Backend' / 'app' / 'services'
    services.mkdir(parents=True)
    (root / 'Frontend').mkdir()
    (services / 'openai_service.py').write_text('from typing import Any\nclass A:\n    def _build_input(self, message, web, artifact_types):\n' + OPENAI_NEEDLE + '\n        return input_data\n', encoding='utf-8')
    (services / 'openrouter_chat_service.py').write_text('from typing import Any\nclass B:\n    def _build_messages(self, message, web, artifact_types):\n' + OPENROUTER_NEEDLE + '\n        return msgs\n', encoding='utf-8')


def test_installer():
    installer = Path(__file__).with_name('install_oria_knowledge.py')
    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp) / 'LBV-Connect.ia'
        make_fake_repo(root)
        files = list((root/'Backend/app/services').glob('*.py'))
        before = {f.name: f.read_bytes() for f in files}
        def call(*extra):
            return subprocess.run([sys.executable, str(installer), '--repo', str(root), *extra], text=True, capture_output=True)
        v = call('--dry-run')
        assert v.returncode == 0, v.stderr
        assert {f.name: f.read_bytes() for f in files} == before
        assert call().returncode == 0
        a = (root/'Backend/app/services/openai_service.py').read_text()
        b = (root/'Backend/app/services/openrouter_chat_service.py').read_text()
        assert '"role": "developer"' in a and '"role": "developer"' in b
        assert 'from app.services.oria_product_knowledge import' in a and 'from app.services.oria_product_knowledge import' in b
        assert (root/'Backend/app/services/oria_product_knowledge.py').is_file()
        assert call().returncode == 0
        assert a == (root/'Backend/app/services/openai_service.py').read_text()
        assert b == (root/'Backend/app/services/openrouter_chat_service.py').read_text()
        bad = (root/'Backend/app/services/openai_service.py')
        bad.write_text('broken', encoding='utf-8')
        fail = call('--dry-run')
        assert fail.returncode != 0


if __name__ == '__main__':
    test_trigger()
    test_installer()
    print('OK : tests connaissances et installateur')
