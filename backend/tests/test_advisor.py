from lab.metrics.shape import shape_weights, in_play
from lab.metrics.profile import roster_line, cat_ranks
from lab.metrics.table import table_records
from lab.domain.session import record_pick, undrafted_ids, open_session, on_clock
from lab.domain.autopilot import autopilot_pick
from lab.domain.model import CATEGORIES
from lab.advisor import (
    CONCEDE_OPTIONS,
    LEVEL_MARGIN,
    frame_options,
    sim_seed_list,
    project,
)

from .conftest import make_config, run_draft


def _advance_to_user(state, pool, values):
    while on_clock(state) != state.config.seat:
        t = on_clock(state)
        state = record_pick(state, pool, autopilot_pick(state, pool, values, t))
    return state


def _profiles(state, pool, values):
    return [roster_line([pool[i] for i in r], values) for r in state.squads]


def test_fit_zeroes_punts_and_is_h2h_worth_on_empty_roster(pool, values):
    from lab.metrics.table import WEEK_WEIGHTS
    state = open_session(make_config(seat=3))
    w = shape_weights(_profiles(state, pool, values), 3, {"FT%"})
    assert w["FT%"] == 0.0
    live = [c for c in CATEGORIES if c != "FT%"]
    ratio = {c: w[c] / WEEK_WEIGHTS[c] for c in live}
    assert max(ratio.values()) - min(ratio.values()) < 1e-9
    assert abs(sum(w[c] for c in live) / len(live) - 1.0) < 1e-9


def test_fit_boosts_categories_still_in_play(pool, values):
    from lab.metrics.shape import shape_frame
    state = run_draft(make_config(seat=3), pool, values)
    w, swing = shape_frame(_profiles(state, pool, values), 3, set())
    for c in in_play(swing):
        assert swing[c] >= 1.1 and w[c] > 0


def test_records_are_consistent(pool, values):
    state = run_draft(make_config(), pool, values)
    recs = table_records(cat_ranks(_profiles(state, pool, values)))
    assert len(recs) == 12
    for r in recs:
        assert r["wins"] + r["losses"] + r["ties"] == 11
    assert sum(r["wins"] for r in recs) == sum(r["losses"] for r in recs)


def test_simulate_stops_at_requested_user_turn(pool, values):
    config = make_config(seat=3)
    state = project(config, [], {"AST"}, stop_at_turn=1)
    assert on_clock(state) == 3
    assert len(state.squads[3]) == 1


def test_simulate_returns_none_when_fixed_player_is_gone(pool, values):
    config = make_config(seat=3)
    first_overall = autopilot_pick(open_session(config), pool, values, 0)
    assert project(config, [first_overall], set()) is None


def _check_options(result, state, pool, values, stage):
    from lab.metrics.shape import board_window, board_order, window_ceiling
    ranks = board_order(values)
    pick = len(state.selections) + 1
    window = board_window(undrafted_ids(state, pool), values, pick, 12, ranks)
    opts = result["options"]
    assert result["pick"] == pick and result["tieWins"] == LEVEL_MARGIN
    assert result["tested"] == len(opts) == result["window"] == len(window)
    # Every player in range is evaluated, once, with the full sample — nothing
    # is left for "Browse all players" to find.
    assert {o["pid"] for o in opts} == set(window)
    assert all(ranks[o["pid"]] <= window_ceiling(pick, 12) for o in opts)
    assert all(o["runs"] == len(sim_seed_list("test-seed", 3)) for o in opts)
    # Ordered best first, tiered at the sims' resolution.
    tiers = [o["tier"] for o in opts]
    assert tiers[0] == 1 and tiers == sorted(tiers)
    wins = [o["wins"] for o in opts]
    top = [w for w, t in zip(wins, tiers) if t == 1]
    assert max(top) - min(top) <= LEVEL_MARGIN + 0.05
    for o in opts:
        assert o["concede"] is None or o["concede"] in CONCEDE_OPTIONS
        assert 0 <= o["wins"] <= 11
        assert o["winsRange"][0] <= o["wins"] <= o["winsRange"][1]
        assert o["gone"] is None or 0 <= o["gone"] <= 1
        assert o["finishRanks"] is None or len(o["finishRanks"]) == 9
        assert o["nextOptions"]
        why = o["why"]
        assert set(why) >= {"adds", "patches", "spares", "overlaps", "costs", "availability", "marketRank"}
        assert not (set(why["adds"]) & set(why["overlaps"]))
        assert o["concede"] not in why["adds"] + why["overlaps"] + why["costs"]
    # The build alternatives: the best player under each plan, best first.
    builds = result["builds"]
    assert builds
    assert builds[0]["concede"] == opts[0]["concede"] or abs(builds[0]["wins"] - max(o["wins"] for o in opts)) <= 0.15
    assert len({b["concede"] for b in builds}) == len(builds)
    assert [b["wins"] for b in builds] == sorted((b["wins"] for b in builds), reverse=True)
    for b in builds:
        assert b["pid"] in {o["pid"] for o in opts}
        assert abs((opts[0]["wins"] - b["wins"]) - b["behind"]) < 0.11
    c = result["consensus"]
    assert c is None or (c["pid"] in {o["pid"] for o in opts} and 0 <= c["wins"] <= 11)
    if stage == "first":
        assert all(o["keepsConcede"] == (o["concede"] is None) for o in opts)


def test_first_pick_options_cover_everyone_in_range(pool, values):
    state = _advance_to_user(open_session(make_config(seat=3)), pool, values)
    result = frame_options(state, set(), seeds=sim_seed_list("test-seed", 3))
    _check_options(result, state, pool, values, "first")
    # Slot 4 picks 4th and 21st: the look-ahead says who is gone by then.
    assert result["nextPick"] == 21
    assert any(o["gone"] >= 0.5 for o in result["options"])


def test_second_pick_options_flag_punt_switches(pool, values):
    state = _advance_to_user(open_session(make_config(seat=3)), pool, values)
    first = frame_options(state, set(), seeds=sim_seed_list("test-seed", 3))["options"][0]
    state = record_pick(state, pool, first["pid"])
    state = _advance_to_user(state, pool, values)
    concedes = {first["concede"]} if first["concede"] else set()
    result = frame_options(state, concedes, seeds=sim_seed_list("test-seed", 3))
    _check_options(result, state, pool, values, "second")
    for o in result["options"]:
        assert o["keepsConcede"] == (o["concede"] == first["concede"])
    for b in result["builds"]:
        assert b["keepsConcede"] == (b["concede"] == first["concede"])


def test_back_to_back_picks_leave_nobody_gone(pool, values):
    """The last slot picks twice in a row: the look-ahead has nothing to warn about."""
    state = _advance_to_user(open_session(make_config(seat=11)), pool, values)
    result = frame_options(state, set(), seeds=sim_seed_list("test-seed", 2))
    assert result["nextPick"] == len(state.selections) + 2
    assert all(o["gone"] == 0.0 for o in result["options"])


def _hub_big(pool, values):
    """A playmaking big: elite passing/rebounding/efficiency for a frontcourt
    player, who also turns it over — the build-around archetype."""
    bigs = (
        p for p in pool.values()
        if p.signed and any(pos in p.positions for pos in ("C", "PF"))
        and values[p.id]["TO"] <= -1.0
    )
    return max(bigs, key=lambda p: values[p.id]["AST"]).id


def _deep_shooter(pool, values):
    """A low-turnover floor spacer — the 3-and-D archetype."""
    cands = (
        p for p in pool.values()
        if p.signed and p.tov < 1.8 and values[p.id]["3PM"] >= 0.8
    )
    return max(cands, key=lambda p: values[p.id]["3PM"]).id


def test_pairing_reason_reads_the_roster(pool, values):
    """Next to a roster strong in REB/AST/FG% and weak in TO, a low-turnover
    shooter 'adds' 3PM, 'overlaps' nothing he shares, and 'spares' TO."""
    from lab.advisor import pairing_notes
    state = open_session(make_config(seat=0))
    hub = _hub_big(pool, values)
    state = record_pick(state, pool, hub)
    spacer = _deep_shooter(pool, values)
    why = pairing_notes(state, spacer, None)
    assert "3PM" in why["adds"]
    assert "TO" in why["spares"] or "TO" in why["patches"]
    assert "REB" not in why["adds"] and "AST" not in why["adds"]
    assert why["marketRank"] >= 1
    # Before any pick there is nothing to overlap or patch.
    fresh = pairing_notes(open_session(make_config(seat=0)), hub, None)
    assert fresh["overlaps"] == [] and fresh["patches"] == [] and "REB" in fresh["adds"]


def test_expected_wins_resolve_between_rosters_that_tie_on_record(pool, values):
    """Two rosters that both lead an opponent in every category get the same
    deterministic record, but the one leading comfortably expects more."""
    from lab.metrics.profile import roster_line, cat_ranks
    from lab.metrics.table import win_expectation, duel_prob, table_records
    from lab.pool.loader import PLAYERS

    strong = roster_line(PLAYERS[:13], values)
    medium = roster_line(PLAYERS[40:53], values)
    weak = roster_line(PLAYERS[150:163], values)
    profiles = [strong, medium, weak]
    assert table_records(cat_ranks(profiles))[0]["wins"] == 2
    assert 0.5 < duel_prob(medium, weak) < duel_prob(strong, weak) < 1.0
    ew = win_expectation(profiles)
    assert ew[0] > ew[1] > ew[2]
    assert abs(sum(ew) - 3) < 1e-9  # each duel_card's probability is split between the two teams
    assert abs(duel_prob(strong, strong) - 0.5) < 1e-9


def test_natural_punts_concede_weak_categories_plus_incumbent(pool, values):
    """Next to a playmaking big (elite FG%/AST) no new plan concedes FG% or AST;
    'no concede' is always on the table, and the incumbent plan is always tested
    even when the roster no longer looks weak in it."""
    from lab.advisor import roster_concedes
    state = open_session(make_config(seat=0))
    hub = _hub_big(pool, values)
    state = record_pick(state, pool, hub)
    # A steady secondary: turnover-averse, passable shooting — his presence
    # leaves turnovers and free throws as the roster's soft spots.
    steady = min(
        (
            p for p in pool.values()
            if p.signed and values[p.id]["TO"] <= 0 and values[p.id]["AST"] > -0.5
            and values[p.id]["3PM"] >= 0.6
        ),
        key=lambda p: values[p.id]["AST"],
    )
    plans = roster_concedes(state, steady.id, "FG%")
    assert plans[0] is None
    assert "FG%" in plans  # incumbent plan: the sims decide whether it survives
    assert "AST" not in plans
    assert "TO" in plans  # the hub turns it over enough to concede it


def test_lookahead_marks_who_is_gone_by_the_next_turn(pool, values):
    from lab.advisor import gone_by_turn, board_head
    state = _advance_to_user(open_session(make_config(seat=5)), pool, values)
    la = gone_by_turn(state, set(), seeds=sim_seed_list("test-seed", 2))
    assert la["nextPick"] == 2 * 12 - 5  # snake: slot 6 picks 6th, then 19th
    gone = la["gone"]
    board = board_head(state, 40)
    assert all(gone[pid] >= 0.5 for pid in board[:4])  # the board's top goes before you pick again
    assert all(gone[pid] == 0.0 for pid in board[-5:])  # the 36th–40th best can wait
    # The user's own turn is not a pick in between, so on back-to-back picks nobody is gone.
    last = _advance_to_user(open_session(make_config(seat=11)), pool, values)
    la2 = gone_by_turn(last, set(), seeds=sim_seed_list("test-seed", 2))
    assert la2["nextPick"] == len(last.selections) + 2
    assert all(v == 0.0 for v in la2["gone"].values())
