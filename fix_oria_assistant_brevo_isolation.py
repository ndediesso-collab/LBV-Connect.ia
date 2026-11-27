from __future__ import annotations

import shutil
import tempfile
from datetime import datetime, timedelta, timezone
from pathlib import Path


def replace_once(source: str, old: str, new: str, label: str) -> str:
    count = source.count(old)
    if count != 1:
        raise RuntimeError(f"Patch interrompu : bloc {label!r} trouvé {count} fois (attendu : 1).")
    return source.replace(old, new, 1)


def main() -> None:
    root = Path.cwd()
    worker_path = root / "Backend" / "app" / "services" / "oria_assistant_email_worker.py"
    test_path = root / "Backend" / "tests" / "test_oria_assistant_email_worker.py"
    if not worker_path.is_file() or not test_path.is_file():
        raise SystemExit(
            "Lance ce script depuis la racine du dépôt LBV-Connect.ia. "
            "Les fichiers ORIA Assistant Email attendus sont introuvables."
        )

    worker = worker_path.read_text(encoding="utf-8")
    tests = test_path.read_text(encoding="utf-8")

    # Keep a restore copy outside the repository so no backup file is staged by mistake.
    backup_dir = Path(tempfile.mkdtemp(prefix="oria_assistant_brevo_backup_"))
    shutil.copy2(worker_path, backup_dir / worker_path.name)
    shutil.copy2(test_path, backup_dir / test_path.name)

    old_ready = '''def worker_ready() -> bool:
    # Configuration dédiée recommandée ; repli sur les mêmes identifiants
    # Brevo que Collaboratif sans modifier son service d'envoi.
    return bool(
        os.getenv("ORIA_ASSISTANT_EMAIL_WORKER_ENABLED", "0").strip() == "1"
        and (os.getenv("ORIA_ASSISTANT_BREVO_API_KEY") or os.getenv("ORIA_COLLAB_BREVO_API_KEY"))
        and (os.getenv("ORIA_ASSISTANT_EMAIL_FROM") or os.getenv("ORIA_COLLAB_EMAIL_FROM"))
    )
'''
    new_ready = '''def worker_ready() -> bool:
    """Only the dedicated ORIA Assistant Brevo credentials can enable this worker."""
    return bool(
        os.getenv("ORIA_ASSISTANT_EMAIL_WORKER_ENABLED", "0").strip() == "1"
        and os.getenv("ORIA_ASSISTANT_BREVO_API_KEY", "").strip()
        and os.getenv("ORIA_ASSISTANT_EMAIL_FROM", "").strip()
    )
'''
    worker = replace_once(worker, old_ready, new_ready, "worker_ready")

    old_configuration = '''def _configuration() -> tuple[str, str, str]:
    key = (os.getenv("ORIA_ASSISTANT_BREVO_API_KEY") or os.getenv("ORIA_COLLAB_BREVO_API_KEY") or "").strip()
    sender = (os.getenv("ORIA_ASSISTANT_EMAIL_FROM") or os.getenv("ORIA_COLLAB_EMAIL_FROM") or "").strip()
    name = os.getenv("ORIA_ASSISTANT_EMAIL_SENDER_NAME", "ORIA Assistant").strip() or "ORIA Assistant"
    if not key or not sender or "@" not in sender:
        raise RuntimeError("oria_assistant_email_configuration_missing")
    return key, sender, name[:80]
'''
    new_configuration = '''def _configuration() -> tuple[str, str, str]:
    # Never borrow ORIA Collaboratif credentials: Brevo is dedicated to Assistant.
    key = os.getenv("ORIA_ASSISTANT_BREVO_API_KEY", "").strip()
    sender = os.getenv("ORIA_ASSISTANT_EMAIL_FROM", "").strip()
    name = os.getenv("ORIA_ASSISTANT_EMAIL_SENDER_NAME", "ORIA Assistant").strip() or "ORIA Assistant"
    if not key or not sender or "@" not in sender:
        raise RuntimeError("oria_assistant_email_configuration_missing")
    return key, sender, name[:80]
'''
    worker = replace_once(worker, old_configuration, new_configuration, "_configuration")

    old_error_handling = '''                snippet = (response.text or "")[:600].lower()
                quota_error = response.status_code == 429 or (
                    response.status_code in (400, 403)
                    and any(term in snippet for term in ("daily", "quota", "limit", "rate"))
                )
                if quota_error:
                    outcome, error_code, retry_at = "retry", "brevo_daily_quota", _next_local_midnight()
                elif 400 <= response.status_code < 500:
                    outcome, error_code = "failed", f"brevo_http_{response.status_code}"
                else:
                    outcome, error_code = "retry", f"brevo_http_{response.status_code}"
'''
    new_error_handling = '''                snippet = (response.text or "")[:600].lower()
                daily_quota_error = (
                    response.status_code in (400, 403)
                    and any(term in snippet for term in (
                        "daily quota", "daily limit", "quota reached", "daily sending limit",
                        "daily email limit", "reached your daily", "maximum daily emails",
                    ))
                )
                if daily_quota_error:
                    # Actual plan quota: preserve FIFO and resume after the daily reset.
                    outcome, error_code, retry_at = "retry", "brevo_daily_quota", _next_local_midnight()
                elif response.status_code == 429:
                    # Brevo also uses 429 for API rate limiting. Do not block these
                    # transient throttling responses until the next calendar day.
                    retry_header = (response.headers.get("Retry-After") or "").strip()
                    try:
                        retry_seconds = max(1, min(int(float(retry_header)), 3600)) if retry_header else 0
                    except (TypeError, ValueError):
                        retry_seconds = 0
                    if not retry_seconds:
                        retry_seconds = min(3600, 30 * (2 ** min(max(int(item.get("attempt_count") or 1) - 1, 0), 7)))
                    retry_at = (datetime.now(timezone.utc) + timedelta(seconds=retry_seconds)).isoformat()
                    outcome, error_code = "retry", "brevo_api_rate_limit"
                elif 400 <= response.status_code < 500:
                    outcome, error_code = "failed", f"brevo_http_{response.status_code}"
                else:
                    outcome, error_code = "retry", f"brevo_http_{response.status_code}"
'''
    worker = replace_once(worker, old_error_handling, new_error_handling, "Brevo HTTP error handling")

    # Replace the old test that explicitly expected a Collaboratif credential fallback.
    old_test = '''def test_email_worker_can_reuse_existing_brevo_credentials_without_touching_collaboratif(monkeypatch):
    _clear(monkeypatch)
    monkeypatch.setenv("ORIA_ASSISTANT_EMAIL_WORKER_ENABLED", "1")
    monkeypatch.setenv("ORIA_COLLAB_BREVO_API_KEY", "xkeysib-existing")
    monkeypatch.setenv("ORIA_COLLAB_EMAIL_FROM", "contact@oria.example")
    assert worker.worker_ready() is True
    key, sender, display_name = worker._configuration()
    assert key == "xkeysib-existing"
    assert sender == "contact@oria.example"
    assert display_name == "ORIA Assistant"
'''
    new_test = '''def test_email_worker_never_reuses_collaboratif_credentials(monkeypatch):
    _clear(monkeypatch)
    monkeypatch.setenv("ORIA_ASSISTANT_EMAIL_WORKER_ENABLED", "1")
    monkeypatch.setenv("ORIA_COLLAB_BREVO_API_KEY", "xkeysib-collaboratif")
    monkeypatch.setenv("ORIA_COLLAB_EMAIL_FROM", "collab@oria.example")
    assert worker.worker_ready() is False


def test_email_worker_uses_only_dedicated_assistant_credentials(monkeypatch):
    _clear(monkeypatch)
    monkeypatch.setenv("ORIA_ASSISTANT_EMAIL_WORKER_ENABLED", "1")
    monkeypatch.setenv("ORIA_ASSISTANT_BREVO_API_KEY", "xkeysib-assistant")
    monkeypatch.setenv("ORIA_ASSISTANT_EMAIL_FROM", "assistant@oria.example")
    monkeypatch.setenv("ORIA_COLLAB_BREVO_API_KEY", "xkeysib-collaboratif")
    monkeypatch.setenv("ORIA_COLLAB_EMAIL_FROM", "collab@oria.example")
    assert worker.worker_ready() is True
    key, sender, display_name = worker._configuration()
    assert key == "xkeysib-assistant"
    assert sender == "assistant@oria.example"
    assert display_name == "ORIA Assistant"
'''
    tests = replace_once(tests, old_test, new_test, "Collaboratif fallback test")

    # Extend cleanup to avoid leaking dedicated configuration between tests.
    if '"ORIA_ASSISTANT_EMAIL_DAILY_LIMIT",' not in tests:
        tests = replace_once(
            tests,
            '        "ORIA_ASSISTANT_EMAIL_FROM",\n',
            '        "ORIA_ASSISTANT_EMAIL_FROM",\n        "ORIA_ASSISTANT_EMAIL_SENDER_NAME",\n        "ORIA_ASSISTANT_EMAIL_DAILY_LIMIT",\n',
            "test environment cleanup",
        )

    worker_path.write_text(worker, encoding="utf-8", newline="\n")
    test_path.write_text(tests, encoding="utf-8", newline="\n")

    print("Correctif appliqué :")
    print("- Brevo ORIA Assistant n'utilise plus les identifiants ORIA Collaboratif.")
    print("- Le 429 API déclenche une nouvelle tentative progressive, pas une attente jusqu'à minuit.")
    print("- Les erreurs explicites de quota quotidien restent reportées au prochain minuit de Libreville.")
    print(f"- Sauvegardes de restauration : {backup_dir}")
    print("Prochaine étape : exécuter les tests pytest du worker e-mail ORIA Assistant.")


if __name__ == "__main__":
    main()
