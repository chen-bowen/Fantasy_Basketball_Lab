"""The punt plan follows the roster; the API applies it in auto mode."""

from fastapi.testclient import TestClient

from app.analysis.punt_plan import WEAK_RANK, suggest_punts
from app.analysis.roster_profile import build_roster_profile
from app.data.pool import PLAYERS
from app.main import app


def profiles_with_user(values, user_roster, others=11):
    user = build_roster_profile(user_roster, values)
    field = [build_roster_profile(PLAYERS[20 + 13 * i : 20 + 13 * i + len(user_roster)], values) for i in range(others)]
    return [user, *field]


def test_no_plan_before_two_players(values):
    plan = suggest_punts(profiles_with_user(values, PLAYERS[:1]), 0, [])
    assert plan["punts"] == [] and plan["category"] is None


def test_punts_the_category_the_roster_is_worst_in(values):
    """A roster of poor free-throw shooters reads as a FT% punt."""
    bricks = sorted(PLAYERS, key=lambda p: values[p.id]["FT%"])[:4]
    profs = profiles_with_user(values, bricks)
    plan = suggest_punts(profs, 0, [])
    assert plan["punts"] == ["FT%"] and plan["rank"] >= WEAK_RANK
    assert "FT%" in plan["reason"]


def test_existing_punt_kept_while_still_weak_dropped_once_decent(values):
    bricks = sorted(PLAYERS, key=lambda p: values[p.id]["FT%"])[:4]
    assert suggest_punts(profiles_with_user(values, bricks), 0, ["FT%"])["punts"] == ["FT%"]
    snipers = sorted(PLAYERS, key=lambda p: -values[p.id]["FT%"])[:4]
    plan = suggest_punts(profiles_with_user(values, snipers), 0, ["FT%"])
    assert "FT%" not in plan["punts"]  # dropped (or replaced by a real weakness)
    assert plan["punts"] == [] or plan["rank"] >= WEAK_RANK


def test_api_auto_mode_follows_roster_and_manual_opts_out():
    client = TestClient(app)
    d = client.post("/api/drafts", json={"seed": "punt-plan", "userSlot": 0}).json()
    assert d["puntMode"] == "auto" and d["userPunts"] == [] and "reason" in d["puntPlan"]
    assert d["isUserTurn"] and d["nextUserPick"] == 24 and d["gone"]  # look-ahead on the user's turn
    bricks = [p.id for p in sorted(PLAYERS, key=lambda p: p.ftm - 0.78 * p.fta)[:3]]
    for pid in bricks:
        d = client.post(f"/api/drafts/{d['id']}/picks", json={"playerId": pid}).json()
        while not d["isUserTurn"] and not d["complete"]:
            d = client.post(f"/api/drafts/{d['id']}/bot-pick").json()
    followed = d["userPunts"]
    assert followed and d["puntMode"] == "auto" and d["puntPlan"]["punts"] == followed
    # Set by hand: the plan is shown but no longer applied.
    d = client.put(f"/api/drafts/{d['id']}/punts", json={"punts": ["3PM"]}).json()
    assert d["puntMode"] == "manual" and d["userPunts"] == ["3PM"]
    # The plan keeps a hand-set punt only while the roster is weak there too.
    assert d["puntPlan"]["punts"] in (["3PM"], followed)
    # Hand it back: the roster decides again.
    d = client.put(f"/api/drafts/{d['id']}/punts", json={"punts": ["3PM"], "mode": "auto"}).json()
    assert d["puntMode"] == "auto" and d["userPunts"] == d["puntPlan"]["punts"]
    # Off the user's turn no look-ahead is computed (slot 1 picks twice in a row, so pick twice).
    for _ in range(2):
        d = client.post(f"/api/drafts/{d['id']}/picks", json={"playerId": max(d["fit"], key=d["fit"].get)}).json()
    assert not d["isUserTurn"] and d["gone"] == {} and d["nextUserPick"] is None
