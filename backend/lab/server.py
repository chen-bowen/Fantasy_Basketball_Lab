"""Fantasy Draft Lab API — FastAPI service owning the draft engine,
rival logic, category analysis, and session persistence."""

from __future__ import annotations

import time
from typing import Any

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from . import archive
from .metrics.board import BOARD_WEIGHTS
from .metrics.ratings import score_pool, line_score
from .pool.loader import PLAYERS, PLAYER_POOL
from .domain.autopilot import deal_rivals, autopilot_pick
from .domain.session import (
    DraftSettings,
    Session,
    record_pick,
    open_session,
    on_clock,
    session_from,
    draft_done,
    pause,
    rebuild,
    resume,
    rewind,
    session_dict,
)
from .metrics.concede import advise_concedes
from .metrics.profile import roster_line
from .advisor import gone_by_turn, advise
from .render import rival_json, session_view, player_json, board_preview

app = FastAPI(title="Fantasy Draft Lab API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_methods=["*"],
    allow_headers=["*"],
)

LEAGUE_SIZE = 12
SQUAD_SIZE = 13

# Player z-scores are a pure function of the frozen dataset — compute once.
RATINGS, BASELINE = score_pool(PLAYERS)
# Overall value = market value: where a player goes in a real draft.
VALUE = {
    pid: line_score(z, BOARD_WEIGHTS) for pid, z in RATINGS.items()
}
VALUE_RANK = {
    pid: i + 1 for i, pid in enumerate(sorted(VALUE, key=lambda pid: -VALUE[pid]))
}


# ---------- persistence helpers ----------


def _load(session_id: str) -> tuple[Session, dict[str, Any]]:
    blob = archive.get_session(session_id)
    if blob is None:
        raise HTTPException(404, f"draft {session_id} not found")
    return session_from(blob["draft"], PLAYER_POOL), blob


def _save(
    session_id: str,
    state: Session,
    blob: dict[str, Any],
) -> None:
    archive.put_session(
        session_id,
        {
            **blob,
            "id": session_id,
            "draft": session_dict(state),
        },
    )


def _view(session_id: str, state: Session, blob: dict[str, Any]):
    concedes = blob.get("concedes", [])
    lookahead = None
    if state.phase == "in_progress" and on_clock(state) == state.config.seat:
        lookahead = gone_by_turn(state, set(concedes))
    return session_view(
        session_id,
        state,
        concedes,
        PLAYER_POOL,
        RATINGS,
        concede_mode=blob.get("concedeMode", "auto"),
        lookahead=lookahead,
        market_rank=VALUE_RANK,
        pool_stats=BASELINE,
    )


def _follow_roster(state: Session, blob: dict[str, Any]) -> None:
    """In auto mode, keep the user's concedes in step with the roster."""
    if blob.get("concedeMode", "auto") != "auto":
        return
    profiles = [
        roster_line([PLAYER_POOL[i] for i in r], RATINGS)
        for r in state.squads
    ]
    plan = advise_concedes(profiles, state.config.seat, blob.get("concedes", []))
    blob["concedes"] = plan["concedes"]


def _maybe_save_completed_run(session_id: str, state: Session, blob: dict) -> None:
    """Persist completed drafts as runs once so branches can be compared."""
    if draft_done(state) and not blob.get("runSaved"):
        archive.put_result(
            f"run-{session_id}",
            {
                "label": f"Completed — replay code {state.config.seed}",
                "createdAt": int(time.time() * 1000),
                "draft": session_dict(state),
                "concedes": blob.get("concedes", []),
            },
        )
        blob["runSaved"] = True
        _save(session_id, state, blob)


# ---------- requests ----------


class NewSession(BaseModel):
    seed: str
    seat: int


class SelectReq(BaseModel):
    pid: str


class ConcedesReq(BaseModel):
    concedes: list[str]
    mode: str | None = None  # "auto" lets the roster decide; default (None) means set by hand


class RollbackReq(BaseModel):
    at: int  # selection index to roll back to


# ---------- routes ----------


@app.get("/api/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/api/pool")
def players() -> dict[str, Any]:
    return {
        "players": [
            player_json(
                p,
                VALUE.get(p.id),
                RATINGS.get(p.id),
                VALUE_RANK.get(p.id),
                BASELINE.avail.get(p.id),
            )
            for p in PLAYERS
        ],
        "count": len(PLAYERS),
    }


@app.get("/api/league")
def league_preview(seed: str, seat: int) -> dict[str, Any]:
    """Rival personalities a new session with this seed and seat would get."""
    specs = deal_rivals(seed, LEAGUE_SIZE, seat)
    return {"rivals": [rival_json(s) for s in specs]}


@app.get("/api/sessions")
def drafts() -> list[dict[str, Any]]:
    return archive.session_index()


@app.post("/api/sessions")
def create(req: NewSession):
    config = DraftSettings(
        teams=LEAGUE_SIZE,
        squad_size=SQUAD_SIZE,
        seat=req.seat,
        seed=req.seed,
        rivals=deal_rivals(req.seed, LEAGUE_SIZE, req.seat),
    )
    state = open_session(config)
    session_id = archive.mint_id("draft")
    blob: dict[str, Any] = {
        "createdAt": int(time.time() * 1000),
        "concedes": [],
        "concedeMode": "auto",
        "runSaved": False,
    }
    _save(session_id, state, blob)
    return _view(session_id, state, blob)


@app.get("/api/sessions/{session_id}")
def get_draft(session_id: str):
    state, blob = _load(session_id)
    return _view(session_id, state, blob)


@app.post("/api/sessions/{session_id}/pick")
def make_pick(session_id: str, req: SelectReq):
    state, blob = _load(session_id)
    try:
        state = record_pick(state, PLAYER_POOL, req.pid)
    except ValueError as e:
        raise HTTPException(400, str(e)) from e
    _follow_roster(state, blob)
    _save(session_id, state, blob)
    _maybe_save_completed_run(session_id, state, blob)
    return _view(session_id, state, blob)


@app.post("/api/sessions/{session_id}/autopilot")
def auto_pick(session_id: str):
    state, blob = _load(session_id)
    if state.phase != "in_progress" or draft_done(state):
        return _view(session_id, state, blob)
    team = on_clock(state)
    if team is None or team == state.config.seat:
        return _view(session_id, state, blob)  # user's turn — no-op
    pid = autopilot_pick(
        state, PLAYER_POOL, RATINGS, team, BASELINE.healthy_values
    )
    state = record_pick(state, PLAYER_POOL, pid)
    _save(session_id, state, blob)
    _maybe_save_completed_run(session_id, state, blob)
    return _view(session_id, state, blob)


@app.post("/api/sessions/{session_id}/pause")
def pause_session(session_id: str):
    state, blob = _load(session_id)
    state = pause(state)
    _save(session_id, state, blob)
    return _view(session_id, state, blob)


@app.post("/api/sessions/{session_id}/resume")
def resume_session(session_id: str):
    state, blob = _load(session_id)
    state = resume(state)
    _save(session_id, state, blob)
    return _view(session_id, state, blob)


@app.put("/api/sessions/{session_id}/concedes")
def set_concedes(session_id: str, req: ConcedesReq):
    """Set concedes by hand (switches the draft to manual mode), or hand the
    decision back to the roster with mode "auto"."""
    state, blob = _load(session_id)
    if req.mode == "auto":
        blob["concedeMode"] = "auto"
        blob["concedes"] = req.concedes
        _follow_roster(state, blob)
    else:
        blob["concedeMode"] = "manual"
        blob["concedes"] = req.concedes
    _save(session_id, state, blob)
    return _view(session_id, state, blob)


@app.get("/api/sessions/{session_id}/advise")
def get_advice(session_id: str):
    """Simulated build options for the user's first or second pick."""
    state, blob = _load(session_id)
    return advise(state, blob.get("concedes", []))


@app.post("/api/sessions/{session_id}/inspect")
def preview(session_id: str, req: SelectReq):
    state, _ = _load(session_id)
    if req.pid not in PLAYER_POOL:
        raise HTTPException(404, "unknown player")
    return board_preview(state, PLAYER_POOL, RATINGS, req.pid)


@app.post("/api/sessions/{session_id}/rewind")
def rewind_session(session_id: str, req: RollbackReq):
    state, blob = _load(session_id)
    # Preserve the abandoned branch as a saved run before rewinding.
    archive.put_result(
        f"branch-{session_id}-{req.at}-{int(time.time())}",
        {
            "label": (
                f"Branch before pick {req.at + 1} — "
                f"replay code {state.config.seed}"
            ),
            "createdAt": int(time.time() * 1000),
            "draft": session_dict(state),
            "concedes": blob.get("concedes", []),
        },
    )
    state = rewind(state, PLAYER_POOL, req.at)
    blob["runSaved"] = False  # this branch should save its own completed run
    _follow_roster(state, blob)
    _save(session_id, state, blob)
    return _view(session_id, state, blob)


@app.get("/api/results")
def runs() -> list[dict[str, Any]]:
    return archive.result_index()


@app.get("/api/results/{result_id}")
def get_run(result_id: str):
    blob = archive.get_result(result_id)
    if blob is None:
        raise HTTPException(404, "run not found")
    state = session_from(blob["draft"], PLAYER_POOL)
    return session_view(
        None, state, blob.get("concedes", []), PLAYER_POOL, RATINGS,
        market_rank=VALUE_RANK, pool_stats=BASELINE,
    )
