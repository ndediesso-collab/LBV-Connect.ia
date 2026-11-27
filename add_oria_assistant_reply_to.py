from __future__ import annotations

import re
import shutil
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parent
BACKEND = ROOT / "Backend"
WORKER = BACKEND / "app" / "services" / "oria_assistant_email_worker.py"
TESTS = BACKEND / "tests" / "test_oria_assistant_email_worker.py"


def backup(path: Path) -> Path:
    stamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    target = path.with_name(f"{path.name}.bak-reply-to-{stamp}")
    shutil.copy2(path, target)
    return target


def main() -> int:
    if not WORKER.is_file() or not TESTS.is_file():
        print("ERREUR : lance ce script depuis la racine du dépôt LBV-Connect.ia.")
        print(f"Worker attendu : {WORKER}")
        print(f"Tests attendus : {TESTS}")
        return 1

    worker_text = WORKER.read_text(encoding="utf-8")
    test_text = TESTS.read_text(encoding="utf-8")

    helper_marker = "def _build_brevo_payload("
    if helper_marker in worker_text:
        print("Le support Reply-To est déjà présent dans le worker. Aucun changement effectué.")
        return 0

    # Insérer un constructeur de payload dédié afin de préserver les modifications
    # déjà appliquées au worker (isolation Brevo et gestion spécifique des 429).
    rpc_marker = "def _rpc(db: Any, name: str, args: dict[str, Any]) -> Any:"
    if rpc_marker not in worker_text:
        print("ERREUR : point d'insertion introuvable dans le worker ; aucun fichier modifié.")
        return 1

    helper = '''def _build_brevo_payload(item: dict[str, Any], sender: str, sender_name: str) -> dict[str, Any]:
    """Construit le message Brevo et applique l'adresse Reply-To dédiée à Assistant."""
    payload: dict[str, Any] = {
        "sender": {"email": sender, "name": sender_name},
        "to": [{"email": str(item.get("to_email") or "")}],
        "subject": str(item.get("subject") or "Notification ORIA"),
        "htmlContent": str(item.get("html_content") or ""),
        "textContent": str(item.get("text_content") or ""),
    }
    reply_to = (os.getenv("ORIA_ASSISTANT_EMAIL_REPLY_TO") or "").strip()
    if reply_to:
        if len(reply_to) > 254 or "@" not in reply_to or any(ch.isspace() for ch in reply_to):
            raise RuntimeError("oria_assistant_email_reply_to_invalid")
        payload["replyTo"] = {"email": reply_to}
    return payload


'''
    worker_text = worker_text.replace(rpc_marker, helper + rpc_marker, 1)

    # Remplacer uniquement le dictionnaire JSON de requests.post par le helper.
    pattern = re.compile(
        r"(?P<indent>\s*)json=\{\n.*?\n(?P=indent)\},\n(?P<headers>\s*headers=)",
        re.DOTALL,
    )
    matches = list(pattern.finditer(worker_text))
    if len(matches) != 1:
        print(
            "ERREUR : impossible d'identifier de façon unique le payload requests.post "
            f"(occurrences trouvées : {len(matches)}). Aucun fichier modifié."
        )
        return 1
    match = matches[0]
    indent = match.group("indent")
    replacement = f"{indent}json=_build_brevo_payload(item, sender, sender_name),\n{match.group('headers')}"
    worker_text = worker_text[: match.start()] + replacement + worker_text[match.end() :]

    # Ajouter l'environnement Reply-To au nettoyage des variables des tests.
    if '"ORIA_ASSISTANT_EMAIL_REPLY_TO"' not in test_text:
        clear_key = '        "ORIA_ASSISTANT_EMAIL_FROM",\n'
        if clear_key in test_text:
            test_text = test_text.replace(
                clear_key,
                clear_key + '        "ORIA_ASSISTANT_EMAIL_REPLY_TO",\n',
                1,
            )

    test_marker = "\ndef test_brevo_payload_includes_assistant_reply_to(monkeypatch):"
    if test_marker.strip() not in test_text:
        test_text += '''


def test_brevo_payload_includes_assistant_reply_to(monkeypatch):
    monkeypatch.setenv("ORIA_ASSISTANT_EMAIL_REPLY_TO", "lbv.connect01@gmail.com")
    payload = worker._build_brevo_payload(
        {
            "to_email": "contact@entreprise.example",
            "subject": "Nouvelle demande client",
            "html_content": "<p>Demande de test</p>",
            "text_content": "Demande de test",
        },
        "assistant@myoriaai.com",
        "ORIA Assistant",
    )
    assert payload["sender"] == {
        "email": "assistant@myoriaai.com",
        "name": "ORIA Assistant",
    }
    assert payload["to"] == [{"email": "contact@entreprise.example"}]
    assert payload["replyTo"] == {"email": "lbv.connect01@gmail.com"}


def test_brevo_payload_omits_reply_to_when_not_configured(monkeypatch):
    monkeypatch.delenv("ORIA_ASSISTANT_EMAIL_REPLY_TO", raising=False)
    payload = worker._build_brevo_payload(
        {"to_email": "contact@entreprise.example"},
        "assistant@myoriaai.com",
        "ORIA Assistant",
    )
    assert "replyTo" not in payload
'''

    worker_backup = backup(WORKER)
    tests_backup = backup(TESTS)
    WORKER.write_text(worker_text, encoding="utf-8", newline="\n")
    TESTS.write_text(test_text, encoding="utf-8", newline="\n")

    print("Support Reply-To ajouté au worker ORIA Assistant.")
    print("- L'expéditeur reste assistant@myoriaai.com (variable Render déjà configurée).")
    print("- Les réponses seront dirigées vers ORIA_ASSISTANT_EMAIL_REPLY_TO.")
    print("- La configuration Brevo et la file d'attente existantes sont conservées.")
    print(f"Sauvegarde worker : {worker_backup}")
    print(f"Sauvegarde tests : {tests_backup}")
    print("Tests à exécuter : python -m pytest tests\\test_oria_assistant_email_worker.py -q")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
