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
        assert o["punt"] in PUNT_OPTIONS
        assert 0 <= o["wins"] <= 11
        assert o["playerId"] not in state.rosters[0]
        assert len(o["finishRanks"]) == 9
        assert o["nextOptions"]


def test_second_pick_options_flag_punt_switches(pool, values):
    state = _advance_to_user(create_draft(make_config(user_slot=3)), pool, values)
    first = first_pick_options(state, seeds=sim_seeds("test-seed", 1))[0]
    state = apply_pick(state, pool, first["playerId"])
    state = _advance_to_user(state, pool, values)
    opts = second_pick_options(state, {first["punt"]}, seeds=sim_seeds("test-seed", 1))
    assert 0 < len(opts) <= 4
    assert len({o["playerId"] for o in opts}) == len(opts)
    for o in opts:
        assert o["keepsPunt"] == (o["punt"] == first["punt"])
        assert len(o["ranksAfter"]) == 9
