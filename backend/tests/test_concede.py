"""The concede plan follows the roster; the API applies it in auto mode."""

from fastapi.testclient import TestClient

from lab.metrics.concede import SOFT_RANK, advise_concedes
from lab.metrics.profile import roster_line
from lab.pool.loader import PLAYERS
from lab.server import app


def profiles_with_user(values, user_roster, others=11):
    user = roster_line(user_roster, values)
    field = [roster_line(PLAYERS[20 + 13 * i : 20 + 13 * i + len(user_roster)], values) for i in range(others)]
    return [user, *field]


def test_no_plan_before_two_players(values):
    plan = advise_concedes(profiles_with_user(values, PLAYERS[:1]), 0, [])
    assert plan["concedes"] == [] and plan["category"] is None


def test_punts_the_category_the_roster_is_worst_in(values):
    """A roster of poor free-throw shooters reads as a FT% concede."""
    bricks = sorted(PLAYERS, key=lambda p: values[p.id]["FT%"])[:4]
    profs = profiles_with_user(values, bricks)
    plan = advise_concedes(profs, 0, [])
    assert plan["concedes"] == ["FT%"] and plan["rank"] >= SOFT_RANK
    assert "FT%" in plan["reason"]


def test_existing_punt_kept_while_still_weak_dropped_once_decent(values):
    bricks = sorted(PLAYERS, key=lambda p: values[p.id]["FT%"])[:4]
    assert advise_concedes(profiles_with_user(values, bricks), 0, ["FT%"])["concedes"] == ["FT%"]
    snipers = sorted(PLAYERS, key=lambda p: -values[p.id]["FT%"])[:4]
    plan = advise_concedes(profiles_with_user(values, snipers), 0, ["FT%"])
    assert "FT%" not in plan["concedes"]  # dropped (or replaced by a real weakness)
    assert plan["concedes"] == [] or plan["rank"] >= SOFT_RANK


def test_api_auto_mode_follows_roster_and_manual_opts_out():
    client = TestClient(app)
    d = client.post("/api/sessions", json={"seed": "concede-plan", "seat": 0}).json()
    assert d["concedeMode"] == "auto" and d["concedes"] == [] and "reason" in d["concedePlan"]
    assert d["yourPick"] and d["nextTurn"] == 24 and d["gone"]  # look-ahead on the user's turn
    bricks = [p.id for p in sorted(PLAYERS, key=lambda p: p.ftm - 0.78 * p.fta)]
    for _ in range(3):
        pid = next(pid for pid in bricks if pid not in d["taken"])
        d = client.post(f"/api/sessions/{d['id']}/pick", json={"pid": pid}).json()
        while not d["yourPick"] and not d["complete"]:
            d = client.post(f"/api/sessions/{d['id']}/autopilot").json()
    followed = d["concedes"]
    assert followed and d["concedeMode"] == "auto" and d["concedePlan"]["concedes"] == followed
    # Set by hand: the plan is shown but no longer applied.
    d = client.put(f"/api/sessions/{d['id']}/concedes", json={"concedes": ["3PM"]}).json()
    assert d["concedeMode"] == "manual" and d["concedes"] == ["3PM"]
    # The plan keeps a hand-set concede only while the roster is weak there too.
    assert d["concedePlan"]["concedes"] in (["3PM"], followed)
    # Hand it back: the roster decides again.
    d = client.put(f"/api/sessions/{d['id']}/concedes", json={"concedes": ["3PM"], "mode": "auto"}).json()
    assert d["concedeMode"] == "auto" and d["concedes"] == d["concedePlan"]["concedes"]
    # Off the user's turn no look-ahead is computed (slot 1 picks twice in a row, so pick twice).
    for _ in range(2):
        d = client.post(f"/api/sessions/{d['id']}/pick", json={"pid": max(d["fit"], key=d["fit"].get)}).json()
    assert not d["yourPick"] and d["gone"] == {} and d["nextTurn"] is None
