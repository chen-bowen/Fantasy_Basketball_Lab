"""The week-to-week view: your week against each team, explained by players."""

import pytest
from fastapi.testclient import TestClient

from app.analysis.matchups import (
    LIKELY_PCT,
    band,
    matchup_breakdown,
    outlook,
    team_line,
    week_pcts,
)
from app.analysis.roster_profile import RosterProfile, build_roster_profile, rank_teams
from app.analysis.standings import (
    MAJORITY,
    NOISE,
    category_win_prob,
    category_win_probs,
    expected_wins,
    matchup_win_prob,
    records,
    win_count_distribution,
)
from app.data.pool import PLAYERS
from app.engine.types import CATEGORIES
from app.main import POOL_STATS, PLAYER_VALUES, app

from .conftest import make_config, run_draft


def _profiles(state, pool, values):
    return [build_roster_profile([pool[i] for i in r], values) for r in state.rosters]


def _rosters(state, pool):
    return [[pool[i] for i in r] for r in state.rosters]


def _punts(state, user_punts):
    return [
        set(user_punts) if t == state.config.user_slot
        else {s.punt_category} if s.kind == "punt" and s.punt_category else set()
        for t, s in enumerate(state.config.bot_specs)
    ]


def _flat(z: float) -> RosterProfile:
    per = {c: z for c in CATEGORIES}
    return RosterProfile(size=13, totals={}, fg_pct=None, ft_pct=None, z_sum=per, per_slot_z=per)


# ---------- standings refactor keeps its numbers ----------


def test_matchup_win_prob_is_the_majority_of_the_category_distribution(pool, values):
    state = run_draft(make_config(), pool, values)
    profiles = _profiles(state, pool, values)
    a, b = profiles[0], profiles[1]
    dist = win_count_distribution(category_win_probs(a, b))
    assert abs(sum(dist) - 1.0) < 1e-9
    assert abs(matchup_win_prob(a, b) - sum(dist[MAJORITY:])) < 1e-12
    # and against itself a team is a coin flip
    assert abs(matchup_win_prob(a, a) - 0.5) < 1e-9


# ---------- the noise stays category-specific ----------


def test_same_lead_is_a_likely_win_in_points_but_a_toss_up_in_steals():
    gap = 0.2  # a typical gap between drafted teams
    pts = round(category_win_prob(gap, NOISE["PTS"]) * 100)
    stl = round(category_win_prob(gap, NOISE["STL"]) * 100)
    assert outlook(pts) == "win"
    assert outlook(stl) == "tossup"
    assert pts > stl


def test_bands_split_on_whole_percents():
    assert outlook(LIKELY_PCT) == "win"
    assert outlook(LIKELY_PCT - 1) == "tossup"
    assert outlook(100 - LIKELY_PCT) == "loss"
    assert outlook(100 - LIKELY_PCT + 1) == "tossup"
    assert band(LIKELY_PCT) == "favored"
    assert band(50) == "tossup"
    assert band(100 - LIKELY_PCT) == "underdog"


# ---------- the breakdown ----------


@pytest.fixture(scope="module")
def finished(pool, values):
    # The user drafts by Fit under an FT% punt, as the room advises.
    from app.engine.draft import create_draft
    from app.suggestions import continue_draft

    state = continue_draft(create_draft(make_config(user_slot=3, seed="matchups")), {"FT%"})
    profiles = _profiles(state, pool, values)
    ranks = rank_teams(profiles)
    bd = matchup_breakdown(
        3, profiles, ranks, _rosters(state, pool), values, POOL_STATS, _punts(state, ["FT%"])
    )
    return state, profiles, ranks, bd


def test_breakdown_covers_every_opponent_best_chance_first(finished):
    state, profiles, ranks, bd = finished
    ids = [m["teamId"] for m in bd["opponents"]]
    assert sorted(ids) == [t for t in range(12) if t != 3]
    assert [m["winPct"] for m in bd["opponents"]] == sorted(
        (m["winPct"] for m in bd["opponents"]), reverse=True
    )
    for m in bd["opponents"]:
        assert 0 <= m["winPct"] <= 100
        assert m["band"] == band(m["winPct"])
        assert [c["cat"] for c in m["categories"]] == CATEGORIES
        for c in m["categories"]:
            assert c["outlook"] == outlook(c["pct"])


def test_chances_match_the_standings_model(finished):
    state, profiles, ranks, bd = finished
    for m in bd["opponents"]:
        assert m["winPct"] == round(matchup_win_prob(profiles[3], profiles[m["teamId"]]) * 100)
    # the headline is the average of the chances shown, and the standings
    # column uses the same arithmetic for every team
    avg = round(sum(m["winPct"] for m in bd["opponents"]) / 11)
    assert bd["winPct"] == avg
    assert week_pcts(profiles)[3] == avg
    assert abs(expected_wins(profiles)[3] / 11 * 100 - avg) < 1.5


def test_paper_result_matches_records(finished):
    state, profiles, ranks, bd = finished
    rec = records(ranks)[3]
    results = [m["paper"]["result"] for m in bd["opponents"]]
    assert results.count("win") == rec["wins"]
    assert results.count("loss") == rec["losses"]
    for m in bd["opponents"]:
        p = m["paper"]
        assert p["won"] + p["lost"] + p["tied"] == 9
        assert p["result"] == ("win" if p["won"] > p["lost"] else "loss" if p["lost"] > p["won"] else "tie")
    assert bd["oneCategoryWins"] <= rec["wins"]
    assert bd["favored"] + bd["tossup"] + bd["underdog"] == 11


def test_punted_category_shows_as_a_likely_loss_and_is_marked(finished):
    state, profiles, ranks, bd = finished
    for m in bd["opponents"]:
        ft = next(c for c in m["categories"] if c["cat"] == "FT%")
        assert ft["puntedByYou"]
        if not ft["puntedByThem"]:
            assert ft["outlook"] != "win"
    assert bd["categories"]["FT%"]["punted"]
    # A punt is a likely loss against most of the league — not all of it:
    # free throws are few per week, and a team nearly as bad is a toss-up.
    assert bd["categories"]["FT%"]["loss"] >= 8


def test_drivers_come_from_the_side_that_decides_the_category(finished):
    state, profiles, ranks, bd = finished
    yours = set(state.rosters[3])
    for m in bd["opponents"]:
        theirs = set(state.rosters[m["teamId"]])
        for c in m["categories"]:
            sides = [d["side"] for d in c["drivers"]]
            for d in c["drivers"]:
                assert d["playerId"] in (yours if d["side"] == "you" else theirs)
            if c["outlook"] == "tossup":
                assert sides == ["you", "them"]
            elif c["cat"] == "TO":
                # the side losing the turnover battle is named
                assert set(sides) == ({"them"} if c["outlook"] == "win" else {"you"})
            else:
                assert set(sides) == ({"you"} if c["outlook"] == "win" else {"them"})
            if c["cat"] in ("FG%", "FT%"):
                assert all(d["att"] is not None for d in c["drivers"])
                assert c["youAtt"] is not None and c["themAtt"] is not None


def test_totals_are_availability_adjusted_like_the_model(pool, values):
    healthy = [p for p in PLAYERS if POOL_STATS.availability[p.id] >= 0.9][:13]
    hurt = [p for p in PLAYERS if POOL_STATS.availability[p.id] <= 0.6][:13]
    line = team_line(healthy, POOL_STATS)
    raw = team_line(healthy, None)
    # a roster of full-season players is close to its per-game sums, never above them
    assert 0.85 * raw["PTS"] <= line["PTS"] <= raw["PTS"] + 1e-9
    # a roster of players expected to miss games is marked down a lot more
    assert team_line(hurt, POOL_STATS)["PTS"] < 0.85 * team_line(hurt, None)["PTS"]
    # turnovers stay per game
    assert line["TO"] == raw["TO"]
    # percentages are over the games actually played
    assert 0.3 < line["FG%"] < 0.7 and 0.5 < line["FT%"] < 1.0


def test_category_summary_counts_every_opponent(finished):
    state, profiles, ranks, bd = finished
    for c in CATEGORIES:
        s = bd["categories"][c]
        assert s["win"] + s["tossup"] + s["loss"] == 11
        assert s["best"] is not None and s["best"]["side"] == "you"
        assert s["you"] is not None and s["leagueMedian"] is not None


# ---------- API ----------


def test_views_carry_the_week_to_week_numbers(pool, values):
    client = TestClient(app)
    v = client.post("/api/drafts", json={"seed": "mk", "userSlot": 0}).json()
    assert v["matchups"] is None  # no rosters yet
    assert len(v["weekPct"]) == 12
    # play the draft out through the API
    while not v["complete"]:
        if v["isUserTurn"]:
            v = client.post(f"/api/drafts/{v['id']}/picks", json={"playerId": v["candidates"][0]}).json()
        else:
            v = client.post(f"/api/drafts/{v['id']}/bot-pick").json()
    assert v["matchups"] is not None
    assert len(v["matchups"]["opponents"]) == 11
    assert v["matchups"]["winPct"] == v["weekPct"][0]
    # the completed draft is saved as a run, with the same breakdown
    runs = client.get("/api/runs").json()
    run = client.get(f"/api/runs/{runs[-1]['id']}").json()
    assert run["matchups"]["winPct"] == v["matchups"]["winPct"]
    assert run["matchups"]["opponents"][0]["categories"][0]["drivers"]
