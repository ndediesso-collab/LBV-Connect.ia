from __future__ import annotations

"""Correct one assertion setup in the ORIA Transcription regression suite.

The legacy-default-profile test expected the optional 'Cours :' title label,
while omitting the optional course_title argument. The production behavior is
correct: no title suffix is added when no title was supplied. This patch makes
the test supply a title so it can verify the legacy label intentionally.
Only the regression test file is changed; no application code, API key,
billing, database, Supabase, Render, or GitHub content is touched.
"""

from datetime import datetime
from pathlib import Path
import py_compile
import sys

ROOT = Path(__file__).resolve().parent
TEST_FILE = ROOT / "Backend" / "tests" / "test_oria_transcription_chantier45_regression.py"

OLD = '''def test_default_profile_remains_course_for_legacy_callers():
    messages = build_course_section_messages(
        transcript="Cours historique.", section_index=1, total_sections=1,
        output_format="html_fragment",
    )
    assert get_transcription_instructions() == ORIA_COURSE_INSTRUCTIONS
    assert ORIA_COURSE_INSTRUCTIONS in messages[0]["content"]
    assert "Cours :" in messages[1]["content"]
'''

NEW = '''def test_default_profile_remains_course_for_legacy_callers():
    messages = build_course_section_messages(
        transcript="Cours historique.", section_index=1, total_sections=1,
        course_title="Cours historique",
        output_format="html_fragment",
    )
    assert get_transcription_instructions() == ORIA_COURSE_INSTRUCTIONS
    assert ORIA_COURSE_INSTRUCTIONS in messages[0]["content"]
    assert "Cours : Cours historique" in messages[1]["content"]
'''


def main() -> int:
    if not TEST_FILE.is_file():
        raise RuntimeError(
            "Fichier introuvable : Backend/tests/test_oria_transcription_chantier45_regression.py"
        )

    original = TEST_FILE.read_text(encoding="utf-8")
    if NEW in original:
        print("OK : le test de compatibilité Cours est déjà corrigé. Aucun changement nécessaire.")
        return 0

    count = original.count(OLD)
    if count != 1:
        raise RuntimeError(
            f"Bloc de test attendu exactement une fois, trouvé {count}. Aucun fichier modifié."
        )

    updated = original.replace(OLD, NEW, 1)
    stamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    backup = TEST_FILE.with_name(TEST_FILE.name + f".bak-legacy-course-test-{stamp}")
    backup.write_text(original, encoding="utf-8", newline="\n")
    TEST_FILE.write_text(updated, encoding="utf-8", newline="\n")
    try:
        py_compile.compile(str(TEST_FILE), doraise=True)
    except Exception:
        TEST_FILE.write_text(original, encoding="utf-8", newline="\n")
        raise

    print("OK : le test de profil Cours historique est corrigé.")
    print("Fichier modifié : Backend/tests/test_oria_transcription_chantier45_regression.py")
    print("Sauvegarde : " + backup.relative_to(ROOT).as_posix())
    print("Aucun fichier applicatif ni aucune configuration n'a été modifié.")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        print(f"ERREUR : {exc}", file=sys.stderr)
        raise SystemExit(1)
