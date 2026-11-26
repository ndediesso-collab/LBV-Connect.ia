from datetime import datetime

from app.services.oria_assistant_push_service import build_credit_threshold_events


def test_credit_threshold_crossing_emits_each_crossed_level():
    now = datetime.fromisoformat("2026-11-26T10:00:00+01:00")
    events = build_credit_threshold_events("owner-1", 6200, 800, now=now)
    assert [event["tag"] for event in events] == [
        "oria-assistant-credits-5000",
        "oria-assistant-credits-3000",
        "oria-assistant-credits-1000",
    ]
    assert all(event["url"] == "/packs" for event in events)
    assert all("6200" not in event["body"] for event in events)
    assert all(event["dedupe_key"].endswith("2026-11-26") for event in events)


def test_zero_balance_emits_zero_alert():
    events = build_credit_threshold_events(
        "owner-1", 1200, 0,
        now=datetime.fromisoformat("2026-11-26T10:00:00+01:00"),
    )
    assert [event["tag"] for event in events] == [
        "oria-assistant-credits-1000", "oria-assistant-credits-0"
    ]
    assert events[-1]["title"] == "Crédits ORIA épuisés"
    assert events[-1]["url"] == "/packs"


def test_no_event_without_threshold_crossing_or_when_balance_increases():
    now = datetime.fromisoformat("2026-11-26T10:00:00+01:00")
    assert build_credit_threshold_events("owner-1", 4500, 4000, now=now) == []
    assert build_credit_threshold_events("owner-1", 1000, 900, now=now) == []
    assert build_credit_threshold_events("owner-1", 900, 5000, now=now) == []
