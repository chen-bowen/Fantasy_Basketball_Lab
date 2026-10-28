import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from lab.metrics.ratings import score_pool  # noqa: E402
from lab.pool.loader import PLAYERS, PLAYER_POOL  # noqa: E402
from lab.domain.autopilot import deal_rivals, autopilot_pick  # noqa: E402
from lab.domain.session import (  # noqa: E402
    DraftSettings,
    Session,
    record_pick,
    open_session,
    on_clock,
    draft_done,
)

LEAGUE_SIZE = 12
SQUAD_SIZE = 13


@pytest.fixture(autouse=True)
def _isolated_store(tmp_path, monkeypatch):
    """API tests write drafts/runs through the real store module; point it
    at a temp dir so test sessions never appear in the app's draft list."""
    import lab.archive as store

    monkeypatch.setattr(store, "SESSIONS_DIR", tmp_path / "drafts")
    monkeypatch.setattr(store, "RESULTS_DIR", tmp_path / "runs")


@pytest.fixture(scope="session")
def players():
    return PLAYERS


@pytest.fixture(scope="session")
def pool():
    return PLAYER_POOL


@pytest.fixture(scope="session")
def values():
    vals, _ = score_pool(PLAYERS)
    return vals


@pytest.fixture(scope="session")
def healthy_values():
    _, stats = score_pool(PLAYERS)
    return stats.healthy_values


def make_config(seat=0, seed="test-seed", rivals=None) -> DraftSettings:
    return DraftSettings(
        teams=LEAGUE_SIZE,
        squad_size=SQUAD_SIZE,
        seat=seat,
        seed=seed,
        rivals=rivals or deal_rivals(seed, LEAGUE_SIZE, seat),
    )


def run_draft(config, pool, values, user_pick=None, healthy_values=None) -> Session:
    """Run a full draft; the user slot picks via user_pick(state) or rivals."""
    state = open_session(config)
    while not draft_done(state):
        t = on_clock(state)
        if t == config.seat and user_pick:
            pid = user_pick(state)
        else:
            pid = autopilot_pick(state, pool, values, t, healthy_values)
        state = record_pick(state, pool, pid)
    return state
