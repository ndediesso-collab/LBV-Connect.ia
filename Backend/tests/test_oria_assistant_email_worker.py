from app.services import oria_assistant_email_worker as worker


def _clear(monkeypatch):
    for key in (
        "ORIA_ASSISTANT_EMAIL_WORKER_ENABLED",
        "ORIA_ASSISTANT_BREVO_API_KEY",
        "ORIA_ASSISTANT_EMAIL_FROM",
        "ORIA_ASSISTANT_EMAIL_REPLY_TO",
        "ORIA_ASSISTANT_EMAIL_SENDER_NAME",
        "ORIA_ASSISTANT_EMAIL_DAILY_LIMIT",
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


def test_email_worker_never_reuses_collaboratif_credentials(monkeypatch):
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
