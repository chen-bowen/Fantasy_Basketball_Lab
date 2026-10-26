import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.analysis.player_values import compute_player_values  # noqa: E402
from app.data.pool import PLAYERS, PLAYER_POOL  # noqa: E402
from app.engine.bots import assign_bot_specs, choose_bot_pick  # noqa: E402
from app.engine.draft import (  # noqa: E402
    DraftConfig,
    DraftState,
    apply_pick,
    create_draft,
    current_team_id,
    is_complete,
)

NUM_TEAMS = 12
ROSTER_SIZE = 13


@pytest.fixture(autouse=True)
def _isolated_store(tmp_path, monkeypatch):
    """API tests write drafts/runs through the real store module; point it
    at a temp dir so test sessions never appear in the app's draft list."""
    import app.store as store

    monkeypatch.setattr(store, "DRAFTS_DIR", tmp_path / "drafts")
    monkeypatch.setattr(store, "RUNS_DIR", tmp_path / "runs")


@pytest.fixture(scope="session")
def players():
    return PLAYERS


@pytest.fixture(scope="session")
def pool():
    return PLAYER_POOL


@pytest.fixture(scope="session")
def values():
    vals, _ = compute_player_values(PLAYERS)
    return vals


@pytest.fixture(scope="session")
def healthy_values():
    _, stats = compute_player_values(PLAYERS)
    return stats.healthy_values


def make_config(user_slot=0, seed="test-seed", bot_specs=None) -> DraftConfig:
    return DraftConfig(
        num_teams=NUM_TEAMS,
        roster_size=ROSTER_SIZE,
        user_slot=user_slot,
        seed=seed,
        bot_specs=bot_specs or assign_bot_specs(seed, NUM_TEAMS, user_slot),
    )


def run_draft(config, pool, values, user_pick=None, healthy_values=None) -> DraftState:
    """Run a full draft; the user slot picks via user_pick(state) or bots."""
    state = create_draft(config)
    while not is_complete(state):
        t = current_team_id(state)
        if t == config.user_slot and user_pick:
            pid = user_pick(state)
        else:
            pid = choose_bot_pick(state, pool, values, t, healthy_values)
        state = apply_pick(state, pool, pid)
    return state
