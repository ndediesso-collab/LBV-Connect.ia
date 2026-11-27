from __future__ import annotations

"""Correct the ORIA Transcription regression tests so they stay fully offline.

The worker imports the legacy audio service, which imports OpenAIService and
requires OPENAI_API_KEY at module-import time. These tests only need to verify
worker limits; inspect the worker class constants with Python AST instead of
importing the service chain. No application code, secrets, or runtime settings
are modified.
"""

from datetime import datetime
from pathlib import Path
import py_compile
import sys

ROOT = Path(__file__).resolve().parent
TEST_FILE = ROOT / "Backend" / "tests" / "test_oria_transcription_chantier45_regression.py"


def replace_once(source: str, old: str, new: str, label: str) -> str:
    count = source.count(old)
    if count != 1:
        raise RuntimeError(
            f"Ancre '{label}' attendue exactement une fois, trouvée {count}. "
            "Aucun fichier n'a été modifié."
        )
    return source.replace(old, new, 1)


def main() -> int:
    if not TEST_FILE.is_file():
        raise RuntimeError(
            "Le fichier de régression est absent : "
            "Backend/tests/test_oria_transcription_chantier45_regression.py"
        )

    original = TEST_FILE.read_text(encoding="utf-8")
    updated = original

    old_imports = """import inspect
from pathlib import Path

import pytest
"""
    new_imports = """import ast
import inspect
from pathlib import Path

import pytest
"""
    if "from app.services.course_audio_import_worker import CourseAudioImportWorker" in updated:
        updated = replace_once(updated, old_imports, new_imports, "imports des tests")
        updated = replace_once(
            updated,
            "from app.services.course_audio_import_worker import CourseAudioImportWorker\n",
            "",
            "import direct du worker audio",
        )

    helper_anchor = """def _plan(**overrides):
"""
    helper_block = r'''def _worker_constants():
    """Lit les limites du worker sans importer ses dépendances IA/Audio.

    Le module du worker importe CourseAudioPolicy, qui importe historiquement
    OpenAIService. Cela impose OPENAI_API_KEY au chargement du module, alors
    que ces tests ne lancent aucun traitement ni aucun appel fournisseur.
    L'AST permet de vérifier les constantes exactes sans charger cette chaîne.
    """
    worker_file = (
        Path(__file__).resolve().parents[1]
        / "app" / "services" / "course_audio_import_worker.py"
    )
    tree = ast.parse(worker_file.read_text(encoding="utf-8"), filename=str(worker_file))
    worker_class = next(
        (
            node for node in tree.body
            if isinstance(node, ast.ClassDef) and node.name == "CourseAudioImportWorker"
        ),
        None,
    )
    assert worker_class is not None, "Classe CourseAudioImportWorker introuvable."

    def read_integer_constant(node):
        """Évalue seulement les entiers et opérations arithmétiques sûres."""
        if isinstance(node, ast.Constant) and type(node.value) is int:
            return node.value
        if isinstance(node, ast.UnaryOp) and isinstance(node.op, (ast.UAdd, ast.USub)):
            value = read_integer_constant(node.operand)
            return value if isinstance(node.op, ast.UAdd) else -value
        if isinstance(node, ast.BinOp):
            left = read_integer_constant(node.left)
            right = read_integer_constant(node.right)
            if isinstance(node.op, ast.Add):
                return left + right
            if isinstance(node.op, ast.Sub):
                return left - right
            if isinstance(node.op, ast.Mult):
                return left * right
            if isinstance(node.op, ast.FloorDiv) and right != 0:
                return left // right
        raise AssertionError("Expression de constante worker non prise en charge.")

    names = {
        "MAX_SOURCE_BYTES",
        "MAX_DURATION_SECONDS",
        "TARGET_SEGMENT_SECONDS",
        "MAX_SEGMENTS",
        "MAX_SEGMENT_BYTES",
    }
    values = {}
    for node in worker_class.body:
        if isinstance(node, ast.Assign):
            for target in node.targets:
                if isinstance(target, ast.Name) and target.id in names:
                    values[target.id] = read_integer_constant(node.value)
        elif isinstance(node, ast.AnnAssign) and isinstance(node.target, ast.Name):
            if node.target.id in names and node.value is not None:
                values[node.target.id] = read_integer_constant(node.value)

    missing = names.difference(values)
    assert not missing, f"Constantes de limites absentes du worker : {sorted(missing)}"
    return values


'''
    if "def _worker_constants():" not in updated:
        updated = replace_once(updated, helper_anchor, helper_block + helper_anchor, "insertion du lecteur AST")
    else:
        if "ast.literal_eval(node.value)" in updated:
            updated = updated.replace(
                "ast.literal_eval(node.value)",
                "read_integer_constant(node.value)",
            )
            constant_anchor = """    worker_file = (
"""
            constant_reader = """    def read_integer_constant(node):
        \"\"\"Évalue seulement les entiers et opérations arithmétiques sûres.\"\"\"
        if isinstance(node, ast.Constant) and type(node.value) is int:
            return node.value
        if isinstance(node, ast.UnaryOp) and isinstance(node.op, (ast.UAdd, ast.USub)):
            value = read_integer_constant(node.operand)
            return value if isinstance(node.op, ast.UAdd) else -value
        if isinstance(node, ast.BinOp):
            left = read_integer_constant(node.left)
            right = read_integer_constant(node.right)
            if isinstance(node.op, ast.Add):
                return left + right
            if isinstance(node.op, ast.Sub):
                return left - right
            if isinstance(node.op, ast.Mult):
                return left * right
            if isinstance(node.op, ast.FloorDiv) and right != 0:
                return left // right
        raise AssertionError(\"Expression de constante worker non prise en charge.\")

"""
            if "def read_integer_constant(node):" not in updated:
                updated = replace_once(updated, constant_anchor, constant_reader + constant_anchor, "lecteur de constantes arithmétiques")

    old_test = """def test_long_audio_worker_limits_match_product_specification():
    assert CourseAudioImportWorker.MAX_SOURCE_BYTES == 512 * 1024 * 1024
    assert CourseAudioImportWorker.MAX_DURATION_SECONDS == 4 * 60 * 60
    assert CourseAudioImportWorker.TARGET_SEGMENT_SECONDS == 285
    assert CourseAudioImportWorker.MAX_SEGMENTS == 120
    assert CourseAudioImportWorker.MAX_SEGMENT_BYTES == 20 * 1024 * 1024
"""
    new_test = """def test_long_audio_worker_limits_match_product_specification():
    limits = _worker_constants()
    assert limits["MAX_SOURCE_BYTES"] == 512 * 1024 * 1024
    assert limits["MAX_DURATION_SECONDS"] == 4 * 60 * 60
    assert limits["TARGET_SEGMENT_SECONDS"] == 285
    assert limits["MAX_SEGMENTS"] == 120
    assert limits["MAX_SEGMENT_BYTES"] == 20 * 1024 * 1024
"""
    if old_test in updated:
        updated = replace_once(updated, old_test, new_test, "vérification des limites audio")
    elif new_test not in updated:
        raise RuntimeError("Le test des limites worker ne correspond pas à la version attendue.")

    if updated == original:
        print("OK : tests déjà corrigés. Aucun fichier modifié.")
        return 0

    stamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    backup = TEST_FILE.with_name(TEST_FILE.name + f".bak-offline-import-{stamp}")
    backup.write_text(original, encoding="utf-8", newline="\n")
    TEST_FILE.write_text(updated, encoding="utf-8", newline="\n")
    try:
        py_compile.compile(str(TEST_FILE), doraise=True)
    except Exception:
        TEST_FILE.write_text(original, encoding="utf-8", newline="\n")
        raise

    print("OK : suite de régression rendue indépendante de OPENAI_API_KEY.")
    print("Fichier modifié : Backend/tests/test_oria_transcription_chantier45_regression.py")
    print("Sauvegarde : " + backup.relative_to(ROOT).as_posix())
    print("Aucun fichier applicatif, secret, paramètre Render ou connexion Supabase modifié.")
    print("Relance maintenant les trois commandes pytest du chantier 4+5.")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        print(f"ERREUR : {exc}", file=sys.stderr)
        raise SystemExit(1)
