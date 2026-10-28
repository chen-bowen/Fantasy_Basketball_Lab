"""Milestones 4 & 5 acceptance: rival personalities, reproducibility,
rewind and branch."""

from lab.metrics.board import BOARD_WEIGHTS
from lab.domain.autopilot import RivalSpec, autopilot_weights, autopilot_pick
from lab.domain.session import (
    record_pick,
    undrafted_players,
    open_session,
    on_clock,
    draft_done,
    rewind,
    session_dict,
)

from .conftest import LEAGUE_SIZE, make_config, run_draft


def all_value() -> tuple[RivalSpec, ...]:
    return tuple(RivalSpec(style="value") for _ in range(LEAGUE_SIZE))


class TestBotPersonalities:
    def test_same_seed_reproduces_selections(self, pool, values):
        a = run_draft(make_config(seed="rivals-seed"), pool, values)
        b = run_draft(make_config(seed="rivals-seed"), pool, values)
        assert session_dict(a) == session_dict(b)

    def test_strategy_change_changes_selections(self, pool, values):
        with_punt = tuple(
            RivalSpec(style="concede", concede_cat="AST") if i == 1 else s
            for i, s in enumerate(all_value())
        )
        a = run_draft(make_config(seed="s", rivals=all_value()), pool, values)
        b = run_draft(make_config(seed="s", rivals=with_punt), pool, values)
        assert b.squads[1] != a.squads[1]
        ast_of = lambda ids: sum(pool[i].ast for i in ids)
        assert ast_of(b.squads[1]) < ast_of(a.squads[1])

    def test_punt_bot_zeroes_assigned_category(self, pool, values):
        specs = (RivalSpec(style="concede", concede_cat="BLK"),) + all_value()[1:]
        state = open_session(make_config(rivals=specs))
        w = autopilot_weights(state, pool, values, 0)
        assert w["BLK"] == 0.0
        assert w["PTS"] == BOARD_WEIGHTS["PTS"]  # everything else at the market rate

    def test_needs_weights_within_cap(self, pool, values):
        specs = tuple(RivalSpec(style="needs") for _ in range(LEAGUE_SIZE))
        state = open_session(make_config(rivals=specs))
        for _ in range(LEAGUE_SIZE):
            t = on_clock(state)
            state = record_pick(state, pool, autopilot_pick(state, pool, values, t))
        w = autopilot_weights(state, pool, values, 1)
        assert all(0.6 <= w[c] / BOARD_WEIGHTS[c] <= 2.0 for c in w)

    def test_bots_never_pick_unavailable(self, pool, values):
        state = run_draft(make_config(), pool, values)
        ids = {p.pid for p in state.selections}
        assert len(ids) == 156
        for p in state.selections:
            assert p.pid in pool


class TestRewind:
    def test_rewinds_to_state_before_pick(self, pool, values):
        full = run_draft(make_config(seat=2), pool, values)
        rewound = rewind(full, pool, 2)
        assert len(rewound.selections) == 2
        assert len(rewound.squads[2]) == 0
        assert rewound.phase == "in_progress"
        assert on_clock(rewound) == 2

    def test_branch_diverges_legally(self, pool, values):
        full = run_draft(make_config(), pool, values)
        rewound = rewind(full, pool, 23)
        original = full.selections[23].pid
        alternative = next(
            p for p in undrafted_players(rewound, pool) if p.id != original
        )
        branch = record_pick(rewound, pool, alternative.id)
        while not draft_done(branch):
            t = on_clock(branch)
            branch = record_pick(
                branch, pool, autopilot_pick(branch, pool, values, t)
            )
        assert len(branch.selections) == 156
        assert len({p.pid for p in branch.selections}) == 156
        assert branch.selections[23].pid == alternative.id
        assert [p.pid for p in branch.selections[24:]] != [
            p.pid for p in full.selections[24:]
        ]

    def test_replay_after_rewind_reproduces_original(self, pool, values):
        full = run_draft(make_config(seat=4), pool, values)
        replayed = rewind(full, pool, 30)
        for pick in full.selections[30:]:
            replayed = record_pick(replayed, pool, pick.pid)
        assert session_dict(replayed) == session_dict(full)
