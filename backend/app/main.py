"""Fantasy Draft Lab API — FastAPI service owning the draft engine,
bot logic, category analysis, and session persistence."""

from __future__ import annotations

import time
from typing import Any

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from . import store
from .analysis.market import MARKET_WEIGHTS
from .analysis.player_values import compute_player_values, score_player
from .data.pool import PLAYERS, PLAYER_POOL
from .engine.bots import assign_bot_specs, choose_bot_pick
from .engine.draft import (
    DraftConfig,
    DraftState,
    apply_pick,
    create_draft,
    current_team_id,
    deserialize_draft,
    is_complete,
    pause_draft,
    replay_draft,
    resume_draft,
    rewind_to_pick,
    serialize_draft,
)
from .suggestions import suggestions
from .views import bot_spec_to_json, draft_view, player_to_json, preview_view

app = FastAPI(title="Fantasy Draft Lab API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_methods=["*"],
    allow_headers=["*"],
)

NUM_TEAMS = 12
ROSTER_SIZE = 13

# Player z-scores are a pure function of the frozen dataset — compute once.
PLAYER_VALUES, POOL_STATS = compute_player_values(PLAYERS)
# Overall value = market value: where a player goes in a real draft.
OVERALL = {
    pid: score_player(z, MARKET_WEIGHTS) for pid, z in PLAYER_VALUES.items()
}
OVERALL_RANK = {
    pid: i + 1 for i, pid in enumerate(sorted(OVERALL, key=lambda pid: -OVERALL[pid]))
}


# ---------- persistence helpers ----------


def _load(draft_id: str) -> tuple[DraftState, dict[str, Any]]:
    blob = store.load_draft(draft_id)
    if blob is None:
        raise HTTPException(404, f"draft {draft_id} not found")
    return deserialize_draft(blob["draft"], PLAYER_POOL), blob


def _save(
    draft_id: str,
    state: DraftState,
    blob: dict[str, Any],
) -> None:
    store.save_draft(
        draft_id,
        {
            **blob,
            "id": draft_id,
            "draft": serialize_draft(state),
        },
    )


def _view(draft_id: str, state: DraftState, blob: dict[str, Any]):
    return draft_view(
        draft_id, state, blob.get("userPunts", []), PLAYER_POOL, PLAYER_VALUES
    )


def _maybe_save_completed_run(draft_id: str, state: DraftState, blob: dict) -> None:
    """Persist completed drafts as runs once so branches can be compared."""
    if is_complete(state) and not blob.get("runSaved"):
        store.save_run(
            f"run-{draft_id}",
            {
                "label": f"Completed — replay code {state.config.seed}",
                "createdAt": int(time.time() * 1000),
                "draft": serialize_draft(state),
                "userPunts": blob.get("userPunts", []),
            },
        )
        blob["runSaved"] = True
        _save(draft_id, state, blob)


# ---------- requests ----------


class CreateDraftReq(BaseModel):
    seed: str
    userSlot: int


class PickReq(BaseModel):
    playerId: str


class PuntsReq(BaseModel):
    punts: list[str]


class RewindReq(BaseModel):
    pickIndex: int


# ---------- routes ----------


@app.get("/api/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/api/players")
def players() -> dict[str, Any]:
    return {
        "players": [
            player_to_json(
                p,
                OVERALL.get(p.id),
                PLAYER_VALUES.get(p.id),
                OVERALL_RANK.get(p.id),
                POOL_STATS.availability.get(p.id),
            )
            for p in PLAYERS
        ],
        "count": len(PLAYERS),
    }


@app.get("/api/league-preview")
def league_preview(seed: str, userSlot: int) -> dict[str, Any]:
    """Bot personalities a new draft with this seed and slot would get."""
    specs = assign_bot_specs(seed, NUM_TEAMS, userSlot)
    return {"botSpecs": [bot_spec_to_json(s) for s in specs]}


@app.get("/api/drafts")
def drafts() -> list[dict[str, Any]]:
    return store.list_drafts()


@app.post("/api/drafts")
def create(req: CreateDraftReq):
    config = DraftConfig(
        num_teams=NUM_TEAMS,
        roster_size=ROSTER_SIZE,
        user_slot=req.userSlot,
        seed=req.seed,
        bot_specs=assign_bot_specs(req.seed, NUM_TEAMS, req.userSlot),
    )
    state = create_draft(config)
    draft_id = store.new_id("draft")
    blob: dict[str, Any] = {
        "createdAt": int(time.time() * 1000),
        "userPunts": [],
        "runSaved": False,
    }
    _save(draft_id, state, blob)
    return _view(draft_id, state, blob)


@app.get("/api/drafts/{draft_id}")
def get_draft(draft_id: str):
    state, blob = _load(draft_id)
    return _view(draft_id, state, blob)


@app.post("/api/drafts/{draft_id}/picks")
def make_pick(draft_id: str, req: PickReq):
    state, blob = _load(draft_id)
    try:
        state = apply_pick(state, PLAYER_POOL, req.playerId)
    except ValueError as e:
        raise HTTPException(400, str(e)) from e
    _save(draft_id, state, blob)
    _maybe_save_completed_run(draft_id, state, blob)
    return _view(draft_id, state, blob)


@app.post("/api/drafts/{draft_id}/bot-pick")
def bot_pick(draft_id: str):
    state, blob = _load(draft_id)
    if state.status != "in_progress" or is_complete(state):
        return _view(draft_id, state, blob)
    team = current_team_id(state)
    if team is None or team == state.config.user_slot:
        return _view(draft_id, state, blob)  # user's turn — no-op
    pid = choose_bot_pick(
        state, PLAYER_POOL, PLAYER_VALUES, team, POOL_STATS.healthy_values
    )
    state = apply_pick(state, PLAYER_POOL, pid)
    _save(draft_id, state, blob)
    _maybe_save_completed_run(draft_id, state, blob)
    return _view(draft_id, state, blob)


@app.post("/api/drafts/{draft_id}/pause")
def pause(draft_id: str):
    state, blob = _load(draft_id)
    state = pause_draft(state)
    _save(draft_id, state, blob)
    return _view(draft_id, state, blob)


@app.post("/api/drafts/{draft_id}/resume")
def resume(draft_id: str):
    state, blob = _load(draft_id)
    state = resume_draft(state)
    _save(draft_id, state, blob)
    return _view(draft_id, state, blob)


@app.put("/api/drafts/{draft_id}/punts")
def set_punts(draft_id: str, req: PuntsReq):
    state, blob = _load(draft_id)
    blob["userPunts"] = req.punts
    _save(draft_id, state, blob)
    return _view(draft_id, state, blob)


@app.get("/api/drafts/{draft_id}/suggestions")
def get_suggestions(draft_id: str):
    """Simulated build options for the user's first or second pick."""
    state, blob = _load(draft_id)
    return suggestions(state, blob.get("userPunts", []))


@app.post("/api/drafts/{draft_id}/preview")
def preview(draft_id: str, req: PickReq):
    state, _ = _load(draft_id)
    if req.playerId not in PLAYER_POOL:
        raise HTTPException(404, "unknown player")
    return preview_view(state, PLAYER_POOL, PLAYER_VALUES, req.playerId)


@app.post("/api/drafts/{draft_id}/rewind")
def rewind(draft_id: str, req: RewindReq):
    state, blob = _load(draft_id)
    # Preserve the abandoned branch as a saved run before rewinding.
    store.save_run(
        f"branch-{draft_id}-{req.pickIndex}-{int(time.time())}",
        {
            "label": (
                f"Branch before pick {req.pickIndex + 1} — "
                f"replay code {state.config.seed}"
            ),
            "createdAt": int(time.time() * 1000),
            "draft": serialize_draft(state),
            "userPunts": blob.get("userPunts", []),
        },
    )
    state = rewind_to_pick(state, PLAYER_POOL, req.pickIndex)
    blob["runSaved"] = False  # this branch should save its own completed run
    _save(draft_id, state, blob)
    return _view(draft_id, state, blob)


@app.get("/api/runs")
def runs() -> list[dict[str, Any]]:
    return store.list_runs()


@app.get("/api/runs/{run_id}")
def get_run(run_id: str):
    blob = store.load_run(run_id)
    if blob is None:
        raise HTTPException(404, "run not found")
    state = deserialize_draft(blob["draft"], PLAYER_POOL)
    return draft_view(
        None, state, blob.get("userPunts", []), PLAYER_POOL, PLAYER_VALUES
    )
