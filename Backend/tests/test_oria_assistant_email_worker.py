from app.services import oria_assistant_email_worker as worker


def _clear(monkeypatch):
    for key in (
        "ORIA_ASSISTANT_EMAIL_WORKER_ENABLED",
        "ORIA_ASSISTANT_BREVO_API_KEY",
        "ORIA_ASSISTANT_EMAIL_FROM",
        "ORIA_COLLAB_BREVO_API_KEY",
        "ORIA_COLLAB_EMAIL_FROM",
    ):
        monkeypatch.delenv(key, raising=False)


def test_email_worker_is_disabled_by_default(monkeypatch):
    _clear(monkeypatch)
    assert worker.worker_ready() is False


def test_email_worker_accepts_dedicated_brevo_configuration(monkeypatch):
    _clear(monkeypatch)
    monkeypatch.setenv("ORIA_ASSISTANT_EMAIL_WORKER_ENABLED", "1")
    monkeypatch.setenv("ORIA_ASSISTANT_BREVO_API_KEY", "xkeysib-test")
    monkeypatch.setenv("ORIA_ASSISTANT_EMAIL_FROM", "contact@oria.example")
    assert worker.worker_ready() is True


def test_email_worker_can_reuse_existing_brevo_credentials_without_touching_collaboratif(monkeypatch):
    _clear(monkeypatch)
    monkeypatch.setenv("ORIA_ASSISTANT_EMAIL_WORKER_ENABLED", "1")
    monkeypatch.setenv("ORIA_COLLAB_BREVO_API_KEY", "xkeysib-existing")
    monkeypatch.setenv("ORIA_COLLAB_EMAIL_FROM", "contact@oria.example")
    assert worker.worker_ready() is True
    key, sender, display_name = worker._configuration()
    assert key == "xkeysib-existing"
    assert sender == "contact@oria.example"
    assert display_name == "ORIA Assistant"
