from app.analysis.fit import fit_weights, needed_categories
from app.analysis.roster_profile import build_roster_profile, rank_teams
from app.analysis.standings import records
from app.engine.draft import apply_pick, create_draft, current_team_id
from app.engine.bots import choose_bot_pick
from app.engine.types import CATEGORIES
from app.suggestions import (
    PUNT_OPTIONS,
    first_pick_options,
    second_pick_options,
    sim_seeds,
    simulate,
)

from .conftest import make_config, run_draft


def _advance_to_user(state, pool, values):
    while current_team_id(state) != state.config.user_slot:
        t = current_team_id(state)
        state = apply_pick(state, pool, choose_bot_pick(state, pool, values, t))
    return state


def _profiles(state, pool, values):
    return [build_roster_profile([pool[i] for i in r], values) for r in state.rosters]


def test_fit_zeroes_punts_and_is_uniform_on_empty_roster(pool, values):
    state = create_draft(make_config(user_slot=3))
    w = fit_weights(_profiles(state, pool, values), 3, {"FT%"})
    assert w["FT%"] == 0.0
    assert all(w[c] == 1.0 for c in CATEGORIES if c != "FT%")


def test_fit_boosts_categories_the_team_trails(pool, values):
    state = run_draft(make_config(user_slot=3), pool, values)
    w = fit_weights(_profiles(state, pool, values), 3, set())
    for c in needed_categories(w):
        assert w[c] > 1.0


def test_records_are_consistent(pool, values):
    state = run_draft(make_config(), pool, values)
    recs = records(rank_teams(_profiles(state, pool, values)))
    assert len(recs) == 12
    for r in recs:
        assert r["wins"] + r["losses"] + r["ties"] == 11
    assert sum(r["wins"] for r in recs) == sum(r["losses"] for r in recs)


def test_simulate_stops_at_requested_user_turn(pool, values):
    config = make_config(user_slot=3)
    state = simulate(config, [], {"AST"}, stop_at_turn=1)
    assert current_team_id(state) == 3
    assert len(state.rosters[3]) == 1


def test_simulate_returns_none_when_fixed_player_is_gone(pool, values):
    config = make_config(user_slot=3)
    first_overall = choose_bot_pick(create_draft(config), pool, values, 0)
    assert simulate(config, [first_overall], set()) is None


def test_first_pick_options(pool, values):
    state = _advance_to_user(create_draft(make_config(user_slot=3)), pool, values)
    opts = first_pick_options(state, seeds=sim_seeds("test-seed", 2))
    assert opts
    assert [o["wins"] for o in opts] == sorted((o["wins"] for o in opts), reverse=True)
    for o in opts:
        assert o["punt"] is None or o["punt"] in PUNT_OPTIONS
        assert 0 <= o["wins"] <= 11
        assert o["playerId"] not in state.rosters[0]
        assert len(o["finishRanks"]) == 9
        assert o["nextOptions"]


def test_second_pick_options_flag_punt_switches(pool, values):
    state = _advance_to_user(create_draft(make_config(user_slot=3)), pool, values)
    first = first_pick_options(state, seeds=sim_seeds("test-seed", 3))[0]
    state = apply_pick(state, pool, first["playerId"])
    state = _advance_to_user(state, pool, values)
    punts = {first["punt"]} if first["punt"] else set()
    result = second_pick_options(state, punts, seeds=sim_seeds("test-seed", 3))
    opts = result["options"]
    assert 0 < len(opts) <= 4
    assert len({o["playerId"] for o in opts}) == len(opts)
    assert result["tested"] >= len(opts)
    assert result["consensus"] is None or 0 <= result["consensus"]["wins"] <= 11
    for o in opts:
        assert o["keepsPunt"] == (o["punt"] == first["punt"])
        assert o["punt"] is None or o["punt"] in PUNT_OPTIONS
        assert len(o["ranksAfter"]) == 9
        assert o["winsRange"][0] <= o["wins"] <= o["winsRange"][1]
        why = o["why"]
        assert set(why) >= {"adds", "patches", "spares", "overlaps", "costs", "availability", "marketRank"}
        assert not (set(why["adds"]) & set(why["overlaps"]))  # a category is one or the other
        assert o["punt"] not in why["adds"] + why["overlaps"] + why["costs"]
        assert 0 < why["availability"] <= 1 and why["marketRank"] >= 1
        assert o["wait"]["runs"] == 3 and 0 <= o["wait"]["stillThere"] <= 3


def test_pairing_reason_reads_the_roster(pool, values):
    """Next to a roster strong in REB/AST/FG% and weak in TO, a low-turnover
    shooter 'adds' 3PM, 'overlaps' nothing he shares, and 'spares' TO."""
    from app.suggestions import pairing_reason
    state = create_draft(make_config(user_slot=0))
    jokic = next(p.id for p in pool.values() if p.name == "Nikola Jokić")
    state = apply_pick(state, pool, jokic)
    white = next(p.id for p in pool.values() if p.name == "Derrick White")
    why = pairing_reason(state, white, None)
    assert "3PM" in why["adds"]
    assert "TO" in why["spares"] or "TO" in why["patches"]
    assert "REB" not in why["adds"] and "AST" not in why["adds"]
    assert why["marketRank"] >= 1
    # Before any pick there is nothing to overlap or patch.
    fresh = pairing_reason(create_draft(make_config(user_slot=0)), jokic, None)
    assert fresh["overlaps"] == [] and fresh["patches"] == [] and "REB" in fresh["adds"]


def test_expected_wins_resolve_between_rosters_that_tie_on_record(pool, values):
    """Two rosters that both lead an opponent in every category get the same
    deterministic record, but the one leading comfortably expects more."""
    from app.analysis.roster_profile import build_roster_profile, rank_teams
    from app.analysis.standings import expected_wins, matchup_win_prob, records
    from app.data.pool import PLAYERS

    strong = build_roster_profile(PLAYERS[:13], values)
    medium = build_roster_profile(PLAYERS[40:53], values)
    weak = build_roster_profile(PLAYERS[150:163], values)
    profiles = [strong, medium, weak]
    assert records(rank_teams(profiles))[0]["wins"] == 2
    assert 0.5 < matchup_win_prob(medium, weak) < matchup_win_prob(strong, weak) < 1.0
    ew = expected_wins(profiles)
    assert ew[0] > ew[1] > ew[2]
    assert abs(sum(ew) - 3) < 1e-9  # each matchup's probability is split between the two teams
    assert abs(matchup_win_prob(strong, strong) - 0.5) < 1e-9


def test_natural_punts_concede_weak_categories_plus_incumbent(pool, values):
    """Next to Jokić (elite FG%/AST) no new plan punts FG% or AST; 'no
    punt' is always on the table, and the incumbent plan is always tested
    even when the roster no longer looks weak in it."""
    from app.suggestions import natural_punts
    state = create_draft(make_config(user_slot=0))
    jokic = next(p.id for p in pool.values() if p.name == "Nikola Jokić")
    state = apply_pick(state, pool, jokic)
    naw = next(p.id for p in pool.values() if p.name == "Nickeil Alexander-Walker")
    plans = natural_punts(state, naw, "FG%")
    assert plans[0] is None
    assert "FG%" in plans  # incumbent plan: the sims decide whether it survives
    assert "AST" not in plans
    assert "TO" in plans  # both turn it over


def test_lookahead_marks_who_is_gone_by_the_next_turn(pool, values):
    from app.suggestions import gone_before_next_turn, top_of_board
    state = _advance_to_user(create_draft(make_config(user_slot=5)), pool, values)
    la = gone_before_next_turn(state, set(), seeds=sim_seeds("test-seed", 2))
    assert la["nextPick"] == 2 * 12 - 5  # snake: slot 6 picks 6th, then 19th
    gone = la["gone"]
    board = top_of_board(state, 40)
    assert all(gone[pid] >= 0.5 for pid in board[:4])  # the board's top goes before you pick again
    assert all(gone[pid] == 0.0 for pid in board[-5:])  # the 36th–40th best can wait
    # The user's own turn is not a pick in between, so on back-to-back picks nobody is gone.
    last = _advance_to_user(create_draft(make_config(user_slot=11)), pool, values)
    la2 = gone_before_next_turn(last, set(), seeds=sim_seeds("test-seed", 2))
    assert la2["nextPick"] == len(last.picks) + 2
    assert all(v == 0.0 for v in la2["gone"].values())
