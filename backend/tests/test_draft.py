"""Milestone 1 acceptance: snake order, legal picks, completion,
reproducibility, serialization."""

import pytest

from app.engine.bots import choose_bot_pick
from app.engine.draft import (
    apply_pick,
    available_players,
    create_draft,
    current_team_id,
    deserialize_draft,
    is_complete,
    is_user_turn,
    serialize_draft,
)
from app.engine.snake import build_snake_order

from .conftest import NUM_TEAMS, make_config, run_draft


class TestSnakeOrder:
    def test_serpentine_sequence(self):
        order = build_snake_order(12, 13)
        assert len(order) == 156
        assert order[:12] == list(range(12))
        assert order[12:24] == list(range(11, -1, -1))
        assert order[24:36] == list(range(12))
        for t in range(12):
            assert order.count(t) == 13


class TestDraftEngine:
    def test_full_draft_156_unique_picks(self, pool, values):
        state = run_draft(make_config(), pool, values)
        assert is_complete(state)
        assert len(state.picks) == 156
        ids = {p.player_id for p in state.picks}
        assert len(ids) == 156
        for roster in state.rosters:
            assert len(roster) == 13
        for i, pick in enumerate(state.picks):
            assert pick.index == i
            assert pick.team_id == state.order[i]
            assert pick.round == i // NUM_TEAMS + 1

    def test_rejects_illegal_picks(self, pool, values):
        state = create_draft(make_config())
        first = choose_bot_pick(state, pool, values, 0)
        state = apply_pick(state, pool, first)
        with pytest.raises(ValueError, match="already drafted"):
            apply_pick(state, pool, first)
        with pytest.raises(ValueError, match="Unknown player"):
            apply_pick(state, pool, "not-a-player")

    def test_reproducible_same_seed(self, pool, values):
        a = run_draft(make_config(user_slot=3), pool, values)
        b = run_draft(make_config(user_slot=3), pool, values)
        assert serialize_draft(a) == serialize_draft(b)

    def test_different_seeds_differ(self, pool, values):
        a = run_draft(make_config(seed="seed-a"), pool, values)
        b = run_draft(make_config(seed="seed-b"), pool, values)
        assert [p.player_id for p in a.picks] != [
            p.player_id for p in b.picks
        ]

    def test_serialize_restore_roundtrip(self, pool, values):
        state = create_draft(make_config(user_slot=5))
        for _ in range(40):
            t = current_team_id(state)
            pid = choose_bot_pick(state, pool, values, t)
            state = apply_pick(state, pool, pid)
        restored = deserialize_draft(serialize_draft(state), pool)
        assert restored == state

    def test_user_slot_positioning(self, pool, values):
        state = create_draft(make_config(user_slot=11))
        assert not is_user_turn(state)
        assert list(state.order).index(11) == 11
        assert list(state.order).index(11, 12) == 12  # snake wrap

    def test_available_pool_shrinks(self, pool, values):
        state = create_draft(make_config())
        before = len(available_players(state, pool))
        pid = choose_bot_pick(state, pool, values, 0)
        state = apply_pick(state, pool, pid)
        assert len(available_players(state, pool)) == before - 1
