"""Tests unitaires isolables: pytest -q Backend/tests/test_oria_collab_owner_pack_gate.py."""
from types import SimpleNamespace

from app.middleware.oria_collab_pack_gate import check_workspace, classify_path, legacy_workspace_for_actor


class Result:
    def __init__(self, data):
        self.data = data


class Query:
    def __init__(self, data):
        self.data = data
        self.filters = []

    def select(self, *_): return self
    def eq(self, key, value):
        self.filters.append((key, value)); return self
    def limit(self, count): self.count = count; return self
    def execute(self):
        rows = [row for row in self.data if all(row.get(k) == v for k, v in self.filters)]
        return Result(rows[:getattr(self, "count", 100)])


class Db:
    def __init__(self):
        self.data = {
            "oria_collab_members": [
                {"id":"m1", "workspace_id":"space", "user_id":"owner", "role":"owner", "status":"active"},
                {"id":"m2", "workspace_id":"space", "user_id":"guest", "role":"member", "status":"active"},
            ],
            "oria_collab_workspaces": [{"id":"space", "owner_user_id":"owner"}],
        }

    def table(self, name): return Query(self.data[name])


def wallet(kind="pro_pack", active=True):
    return lambda owner: SimpleNamespace(pack_id=kind, is_pack_active=active)


def test_pro_business_active_allows_owner_and_guest():
    for kind in ("pro_pack", "business_pack"):
        for actor in ("owner", "guest"):
            assert check_workspace(Db(), actor, "space", wallet(kind)).allowed


def test_expired_or_downgraded_denies_everyone():
    for kind, active in (("pro_pack", False), ("business_pack", False),
                         ("light_pack", True), ("intermediate_pack", True),
                         ("discovery_pack", True), ("", True)):
        for actor in ("owner", "guest"):
            result = check_workspace(Db(), actor, "space", wallet(kind, active))
            assert result.allowed is False
            assert result.status == 403
            assert result.code == "COLLAB_OWNER_PACK_REQUIRED"
            assert result.is_owner == (actor == "owner")


def test_membership_revoked_denies_before_pack_lookup():
    db = Db()
    db.data["oria_collab_members"][1]["status"] = "suspended"
    assert check_workspace(db, "guest", "space", wallet()).status == 404
    assert check_workspace(db, "unknown", "space", wallet()).status == 404


def test_legacy_does_not_guess_between_two_spaces():
    db = Db()
    db.data["oria_collab_members"].append(
        {"workspace_id":"other", "user_id":"guest", "status":"active"})
    from fastapi import HTTPException
    try:
        legacy_workspace_for_actor(db, "guest")
        assert False, "Legacy route should not select a space"
    except HTTPException as e:
        assert e.status_code == 409


def test_explicit_workspace_and_safe_routes_classification():
    uid = "867c591b-73b2-4000-a51b-23adb0c5a387"
    assert classify_path(f"/collaboratif/workspaces/{uid}/hub/boot") == ("scoped", uid)
    assert classify_path("/collaboratif/workspaces") == ("exempt", None)
    assert classify_path("/collaboratif/workspaces/mine") == ("legacy", None)
    assert classify_path("/collaboratif/groups") == ("legacy", None)
    assert classify_path("/collaboratif/workspaces/not-a-uuid/hub/boot") == ("invalid", None)
    assert classify_path("/ai/chat") == ("outside", None)
    assert classify_path("/collaboratif/share-invitations/accept") == ("exempt", None)


def test_business_to_pro_requires_capacity_regularization():
    db = Db()
    for k in range(3):
        db.data["oria_collab_members"].append(
            {"id": f"m{k+3}", "workspace_id": "space",
             "user_id": f"guest{k+2}", "role": "member", "status": "active"})
    assert check_workspace(db, "owner", "space", wallet("pro_pack")).allowed
    guest = check_workspace(db, "guest", "space", wallet("pro_pack"))
    assert guest.code == "COLLAB_CAPACITY_EXCEEDED"
    assert guest.status == 403
    assert check_workspace(db, "guest", "space", wallet("business_pack")).allowed
