"""Milestones 4 & 5 acceptance: bot personalities, reproducibility,
rewind and branch."""

from app.engine.bots import BotSpec, bot_weights, choose_bot_pick
from app.engine.draft import (
    apply_pick,
    available_players,
    create_draft,
    current_team_id,
    is_complete,
    rewind_to_pick,
    serialize_draft,
)

from .conftest import NUM_TEAMS, make_config, run_draft


def all_value() -> tuple[BotSpec, ...]:
    return tuple(BotSpec(kind="value") for _ in range(NUM_TEAMS))


class TestBotPersonalities:
    def test_same_seed_reproduces_selections(self, pool, values):
        a = run_draft(make_config(seed="bots-seed"), pool, values)
        b = run_draft(make_config(seed="bots-seed"), pool, values)
        assert serialize_draft(a) == serialize_draft(b)

    def test_strategy_change_changes_selections(self, pool, values):
        with_punt = tuple(
            BotSpec(kind="punt", punt_category="AST") if i == 1 else s
            for i, s in enumerate(all_value())
        )
        a = run_draft(make_config(seed="s", bot_specs=all_value()), pool, values)
        b = run_draft(make_config(seed="s", bot_specs=with_punt), pool, values)
        assert b.rosters[1] != a.rosters[1]
        ast_of = lambda ids: sum(pool[i].ast for i in ids)
        assert ast_of(b.rosters[1]) < ast_of(a.rosters[1])

    def test_punt_bot_zeroes_assigned_category(self, pool, values):
        specs = (BotSpec(kind="punt", punt_category="BLK"),) + all_value()[1:]
        state = create_draft(make_config(bot_specs=specs))
        w = bot_weights(state, pool, values, 0)
        assert w["BLK"] == 0.0
        assert w["PTS"] == 1.0

    def test_needs_weights_within_cap(self, pool, values):
        specs = tuple(BotSpec(kind="needs") for _ in range(NUM_TEAMS))
        state = create_draft(make_config(bot_specs=specs))
        for _ in range(NUM_TEAMS):
            t = current_team_id(state)
            state = apply_pick(state, pool, choose_bot_pick(state, pool, values, t))
        w = bot_weights(state, pool, values, 1)
        assert all(0.6 <= w[c] <= 2.0 for c in w)

    def test_bots_never_pick_unavailable(self, pool, values):
        state = run_draft(make_config(), pool, values)
        ids = {p.player_id for p in state.picks}
        assert len(ids) == 156
        for p in state.picks:
            assert p.player_id in pool


class TestRewind:
    def test_rewinds_to_state_before_pick(self, pool, values):
        full = run_draft(make_config(user_slot=2), pool, values)
        rewound = rewind_to_pick(full, pool, 2)
        assert len(rewound.picks) == 2
        assert len(rewound.rosters[2]) == 0
        assert rewound.status == "in_progress"
        assert current_team_id(rewound) == 2

    def test_branch_diverges_legally(self, pool, values):
        full = run_draft(make_config(), pool, values)
        rewound = rewind_to_pick(full, pool, 23)
        original = full.picks[23].player_id
        alternative = next(
            p for p in available_players(rewound, pool) if p.id != original
        )
        branch = apply_pick(rewound, pool, alternative.id)
        while not is_complete(branch):
            t = current_team_id(branch)
            branch = apply_pick(
                branch, pool, choose_bot_pick(branch, pool, values, t)
            )
        assert len(branch.picks) == 156
        assert len({p.player_id for p in branch.picks}) == 156
        assert branch.picks[23].player_id == alternative.id
        assert [p.player_id for p in branch.picks[24:]] != [
            p.player_id for p in full.picks[24:]
        ]

    def test_replay_after_rewind_reproduces_original(self, pool, values):
        full = run_draft(make_config(user_slot=4), pool, values)
        replayed = rewind_to_pick(full, pool, 30)
        for pick in full.picks[30:]:
            replayed = apply_pick(replayed, pool, pick.player_id)
        assert serialize_draft(replayed) == serialize_draft(full)
