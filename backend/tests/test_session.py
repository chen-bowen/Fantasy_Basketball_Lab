"""Milestone 1 acceptance: snake order, legal picks, completion,
reproducibility, serialization."""

import pytest

from lab.domain.autopilot import autopilot_pick
from lab.domain.session import (
    record_pick,
    undrafted_players,
    open_session,
    on_clock,
    session_from,
    draft_done,
    user_turn,
    session_dict,
)
from lab.domain.snake import build_snake_order

from .conftest import LEAGUE_SIZE, make_config, run_draft


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
        assert draft_done(state)
        assert len(state.selections) == 156
        ids = {p.pid for p in state.selections}
        assert len(ids) == 156
        for roster in state.squads:
            assert len(roster) == 13
        for i, pick in enumerate(state.selections):
            assert pick.index == i
            assert pick.squad == state.order[i]
            assert pick.round == i // LEAGUE_SIZE + 1

    def test_rejects_illegal_picks(self, pool, values):
        state = open_session(make_config())
        first = autopilot_pick(state, pool, values, 0)
        state = record_pick(state, pool, first)
        with pytest.raises(ValueError, match="already drafted"):
            record_pick(state, pool, first)
        with pytest.raises(ValueError, match="Unknown player"):
            record_pick(state, pool, "not-a-player")

    def test_reproducible_same_seed(self, pool, values):
        a = run_draft(make_config(seat=3), pool, values)
        b = run_draft(make_config(seat=3), pool, values)
        assert session_dict(a) == session_dict(b)

    def test_different_seeds_differ(self, pool, values):
        a = run_draft(make_config(seed="seed-a"), pool, values)
        b = run_draft(make_config(seed="seed-b"), pool, values)
        assert [p.pid for p in a.selections] != [
            p.pid for p in b.selections
        ]

    def test_serialize_restore_roundtrip(self, pool, values):
        state = open_session(make_config(seat=5))
        for _ in range(40):
            t = on_clock(state)
            pid = autopilot_pick(state, pool, values, t)
            state = record_pick(state, pool, pid)
        restored = session_from(session_dict(state), pool)
        assert restored == state

    def test_seat_positioning(self, pool, values):
        state = open_session(make_config(seat=11))
        assert not user_turn(state)
        assert list(state.order).index(11) == 11
        assert list(state.order).index(11, 12) == 12  # snake wrap

    def test_available_pool_shrinks(self, pool, values):
        state = open_session(make_config())
        before = len(undrafted_players(state, pool))
        pid = autopilot_pick(state, pool, values, 0)
        state = record_pick(state, pool, pid)
        assert len(undrafted_players(state, pool)) == before - 1
