"""The week-to-week view: your week against each team, explained by players."""

import pytest
from fastapi.testclient import TestClient

from lab.metrics.weekly import (
    EDGE_PCT,
    bracket,
    week_board,
    verdict,
    week_totals,
    week_rates,
)
from lab.metrics.profile import RosterLine, roster_line, cat_ranks
from lab.metrics.table import (
    CATS_NEEDED,
    NOISE,
    cat_prob,
    cat_probs,
    win_expectation,
    duel_prob,
    table_records,
    win_dist,
)
from lab.pool.loader import PLAYERS
from lab.domain.model import CATEGORIES
from lab.server import BASELINE, RATINGS, app

from .conftest import make_config, run_draft


def _profiles(state, pool, values):
    return [roster_line([pool[i] for i in r], values) for r in state.squads]


def _rosters(state, pool):
    return [[pool[i] for i in r] for r in state.squads]


def _punts(state, user_concedes):
    return [
        set(user_concedes) if t == state.config.seat
        else {s.concede_cat} if s.style == "concede" and s.concede_cat else set()
        for t, s in enumerate(state.config.rivals)
    ]


def _flat(z: float) -> RosterLine:
    per = {c: z for c in CATEGORIES}
    return RosterLine(size=13, totals={}, fg_pct=None, ft_pct=None, z_sum=per, per_slot_z=per)


# ---------- standings refactor keeps its numbers ----------


def test_matchup_win_prob_is_the_majority_of_the_category_distribution(pool, values):
    state = run_draft(make_config(), pool, values)
    profiles = _profiles(state, pool, values)
    a, b = profiles[0], profiles[1]
    dist = win_dist(cat_probs(a, b))
    assert abs(sum(dist) - 1.0) < 1e-9
    assert abs(duel_prob(a, b) - sum(dist[CATS_NEEDED:])) < 1e-12
    # and against itself a team is a coin flip
    assert abs(duel_prob(a, a) - 0.5) < 1e-9


# ---------- the noise stays category-specific ----------


def test_same_lead_is_a_likely_win_in_points_but_a_toss_up_in_steals():
    gap = 0.15  # a modest edge between drafted teams
    pts = round(cat_prob(gap, NOISE["PTS"]) * 100)
    stl = round(cat_prob(gap, NOISE["STL"]) * 100)
    assert verdict(pts) == "win"
    assert verdict(stl) == "tossup"
    assert pts > stl


def test_bands_split_on_whole_percents():
    assert verdict(EDGE_PCT) == "win"
    assert verdict(EDGE_PCT - 1) == "tossup"
    assert verdict(100 - EDGE_PCT) == "loss"
    assert verdict(100 - EDGE_PCT + 1) == "tossup"
    assert bracket(EDGE_PCT) == "favored"
    assert bracket(50) == "tossup"
    assert bracket(100 - EDGE_PCT) == "underdog"


# ---------- the breakdown ----------


@pytest.fixture(scope="module")
def finished(pool, values):
    # The user drafts by Fit under a 3PM concede, as the room advises.
    from lab.domain.session import open_session
    from lab.advisor import play_out

    state = play_out(open_session(make_config(seat=3, seed="board")), {"3PM"})
    profiles = _profiles(state, pool, values)
    ranks = cat_ranks(profiles)
    bd = week_board(
        3, profiles, ranks, _rosters(state, pool), values, BASELINE, _punts(state, ["3PM"])
    )
    return state, profiles, ranks, bd


def test_breakdown_covers_every_opponent_best_chance_first(finished):
    state, profiles, ranks, bd = finished
    ids = [m["squad"] for m in bd["opponents"]]
    assert sorted(ids) == [t for t in range(12) if t != 3]
    assert [m["winPct"] for m in bd["opponents"]] == sorted(
        (m["winPct"] for m in bd["opponents"]), reverse=True
    )
    for m in bd["opponents"]:
        assert 0 <= m["winPct"] <= 100
        assert m["bracket"] == bracket(m["winPct"])
        assert [c["cat"] for c in m["categories"]] == CATEGORIES
        for c in m["categories"]:
            assert c["verdict"] == verdict(c["pct"])


def test_chances_match_the_standings_model(finished):
    state, profiles, ranks, bd = finished
    for m in bd["opponents"]:
        assert m["winPct"] == round(duel_prob(profiles[3], profiles[m["squad"]]) * 100)
    # the headline is the average of the chances shown, and the standings
    # column uses the same arithmetic for every team
    avg = round(sum(m["winPct"] for m in bd["opponents"]) / 11)
    assert bd["winPct"] == avg
    assert week_rates(profiles)[3] == avg
    assert abs(win_expectation(profiles)[3] / 11 * 100 - avg) < 1.5


def test_paper_result_matches_records(finished):
    state, profiles, ranks, bd = finished
    rec = table_records(ranks)[3]
    results = [m["paper"]["result"] for m in bd["opponents"]]
    assert results.count("win") == rec["wins"]
    assert results.count("loss") == rec["losses"]
    for m in bd["opponents"]:
        p = m["paper"]
        assert p["won"] + p["lost"] + p["tied"] == 9
        assert p["result"] == ("win" if p["won"] > p["lost"] else "loss" if p["lost"] > p["won"] else "tie")
    assert bd["oneCategoryWins"] <= rec["wins"]
    assert bd["favored"] + bd["tossup"] + bd["underdog"] == 11


def test_conceded_category_shows_as_a_likely_loss_and_is_marked(finished):
    state, profiles, ranks, bd = finished
    for m in bd["opponents"]:
        pm = next(c for c in m["categories"] if c["cat"] == "3PM")
        assert pm["concededByYou"]
        if not pm["concededByThem"]:
            assert pm["verdict"] != "win"
    assert bd["categories"]["3PM"]["conceded"]
    # A concede is a likely loss against most of the league.
    assert bd["categories"]["3PM"]["loss"] >= 8


def test_drivers_come_from_the_side_that_decides_the_category(finished):
    state, profiles, ranks, bd = finished
    yours = set(state.squads[3])
    for m in bd["opponents"]:
        theirs = set(state.squads[m["squad"]])
        for c in m["categories"]:
            sides = [d["side"] for d in c["deciders"]]
            for d in c["deciders"]:
                assert d["pid"] in (yours if d["side"] == "you" else theirs)
            if c["verdict"] == "tossup":
                assert sides == ["you", "them"]
            elif c["cat"] == "TO":
                # the side losing the turnover battle is named
                assert set(sides) == ({"them"} if c["verdict"] == "win" else {"you"})
            else:
                assert set(sides) == ({"you"} if c["verdict"] == "win" else {"them"})
            if c["cat"] in ("FG%", "FT%"):
                assert all(d["att"] is not None for d in c["deciders"])
                assert c["youAtt"] is not None and c["themAtt"] is not None


def test_totals_are_availability_adjusted_like_the_model(pool, values):
    healthy = [p for p in PLAYERS if BASELINE.avail[p.id] >= 0.9][:13]
    hurt = [p for p in PLAYERS if BASELINE.avail[p.id] <= 0.5][:13]
    line = week_totals(healthy, BASELINE)
    raw = week_totals(healthy, None)
    # a roster of full-season players is close to its per-game sums, never above them
    assert 0.85 * raw["PTS"] <= line["PTS"] <= raw["PTS"] + 1e-9
    # a roster of players expected to miss games is marked down a lot more
    assert week_totals(hurt, BASELINE)["PTS"] < 0.85 * week_totals(hurt, None)["PTS"]
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
    v = client.post("/api/sessions", json={"seed": "mk", "seat": 0}).json()
    assert v["board"] is None  # no rosters yet
    assert len(v["weekPct"]) == 12
    # play the draft out through the API
    while not v["complete"]:
        if v["yourPick"]:
            v = client.post(f"/api/sessions/{v['id']}/pick", json={"pid": v["candidates"][0]}).json()
        else:
            v = client.post(f"/api/sessions/{v['id']}/autopilot").json()
    assert v["board"] is not None
    assert len(v["board"]["opponents"]) == 11
    assert v["board"]["winPct"] == v["weekPct"][0]
    # the completed draft is saved as a run, with the same breakdown
    runs = client.get("/api/results").json()
    run = client.get(f"/api/results/{runs[-1]['id']}").json()
    assert run["board"]["winPct"] == v["board"]["winPct"]
    assert run["board"]["opponents"][0]["categories"][0]["deciders"]
