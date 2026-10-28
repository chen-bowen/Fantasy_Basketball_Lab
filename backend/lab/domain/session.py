"""Headless draft engine.

State is plain JSON-serializable data; all transitions are pure functions
returning a new state. Randomness derives from (seed, draft state) so there
is no RNG state to persist.
"""

from __future__ import annotations

from dataclasses import dataclass, field, replace
from typing import Any

from .snake import build_snake_order, pick_in_round_of_pick, round_of_pick
from .model import RivalSpec, Player


@dataclass(frozen=True)
class DraftSettings:
    teams: int
    squad_size: int
    seat: int  # 0-based index of the user's team in the snake order
    seed: str
    rivals: tuple[RivalSpec, ...]  # len == teams; the seat's entry is a placeholder

    def to_dict(self) -> dict[str, Any]:
        return {
            "numTeams": self.teams,
            "rosterSize": self.squad_size,
            "userSlot": self.seat,
            "seed": self.seed,
            "botSpecs": [
                {"style": s.style, "puntCategory": s.concede_cat, "lean": s.lean}
                for s in self.rivals
            ],
        }

    @staticmethod
    def from_dict(d: dict[str, Any]) -> "DraftSettings":
        return DraftSettings(
            teams=d["numTeams"],
            squad_size=d["rosterSize"],
            seat=d["userSlot"],
            seed=d["seed"],
            rivals=tuple(
                RivalSpec(
                    style="concede" if s.get("style", s.get("kind")) == "punt" else s.get("style", s.get("kind")),
                    concede_cat=s.get("puntCategory"),
                    lean=s.get("lean", s.get("risk", "neutral")),  # saves before lean existed
                )
                for s in d["botSpecs"]
            ),
        )


@dataclass(frozen=True)
class Selection:
    index: int  # overall pick index (0-based)
    round: int  # 1-based
    squad: int
    pid: str

    def to_dict(self) -> dict[str, Any]:
        return {
            "at": self.index,
            "round": self.round,
            "squad": self.squad,
            "pid": self.pid,
        }


@dataclass(frozen=True)
class Session:
    config: DraftSettings
    phase: str  # "in_progress" | "paused" | "complete"
    order: tuple[int, ...]  # order[i] = squad id picking at selection i
    selections: tuple[Selection, ...]
    squads: tuple[tuple[str, ...], ...]


def open_session(config: DraftSettings) -> Session:
    if not 0 <= config.seat < config.teams:
        raise ValueError(f"seat {config.seat} out of range")
    if len(config.rivals) != config.teams:
        raise ValueError("rivals must have one entry per team")
    return Session(
        config=config,
        phase="in_progress",
        order=tuple(build_snake_order(config.teams, config.squad_size)),
        selections=(),
        squads=tuple(() for _ in range(config.teams)),
    )


def draft_done(state: Session) -> bool:
    return len(state.selections) >= len(state.order)


def on_clock(state: Session) -> int | None:
    if draft_done(state):
        return None
    return state.order[len(state.selections)]


def user_turn(state: Session) -> bool:
    return on_clock(state) == state.config.seat


def round_now(state: Session) -> int:
    return round_of_pick(state.config.teams, len(state.selections))


def slot_now(state: Session) -> int:
    return pick_in_round_of_pick(state.config.teams, len(state.selections))


def taken_ids(state: Session) -> set[str]:
    return {p.pid for p in state.selections}


def undrafted_ids(
    state: Session, pool: dict[str, Player]
) -> list[str]:
    taken = taken_ids(state)
    return [pid for pid in pool if pid not in taken]


def undrafted_players(state: Session, pool: dict[str, Player]) -> list[Player]:
    return [pool[pid] for pid in undrafted_ids(state, pool)]


def record_pick(
    state: Session, pool: dict[str, Player], pid: str
) -> Session:
    """The only way a player enters a roster. Validates legality and
    applies to whichever team is on the clock — rival or user."""
    if state.phase != "in_progress":
        raise ValueError(f"Cannot pick while status is {state.phase}")
    if draft_done(state):
        raise ValueError("Draft is complete")
    if pid not in pool:
        raise ValueError(f"Unknown player: {pid}")
    if pid in taken_ids(state):
        raise ValueError(f"Player already drafted: {pid}")
    index = len(state.selections)
    squad = state.order[index]
    pick = Selection(
        index=index,
        round=round_of_pick(state.config.teams, index),
        squad=squad,
        pid=pid,
    )
    squads = [
        tuple(r) + (pid,) if i == squad else r
        for i, r in enumerate(state.squads)
    ]
    next_state = replace(
        state, squads=tuple(squads), selections=state.selections + (pick,)
    )
    if draft_done(next_state):
        next_state = replace(next_state, phase="complete")
    return next_state


def pause(state: Session) -> Session:
    return (
        replace(state, phase="paused")
        if state.phase == "in_progress"
        else state
    )


def resume(state: Session) -> Session:
    return (
        replace(state, phase="in_progress")
        if state.phase == "paused"
        else state
    )


# ---------- Serialization ----------


def session_dict(state: Session) -> dict[str, Any]:
    return {
        "version": 1,
        "config": state.config.to_dict(),
        "picks": [p.pid for p in state.selections],
        "status": state.phase,
    }


def rebuild(
    config: DraftSettings,
    pool: dict[str, Player],
    pick_ids: list[str],
    phase: str = "in_progress",
) -> Session:
    """Rebuild state by replaying the pick log. Rival choices are
    deterministic, so replaying recorded picks reproduces the draft."""
    state = open_session(config)
    for pid in pick_ids:
        state = record_pick(state, pool, pid)
    if phase == "paused" and state.phase == "in_progress":
        state = replace(state, phase="paused")
    return state


def session_from(data: dict[str, Any], pool: dict[str, Player]) -> Session:
    if data.get("version") != 1:
        raise ValueError("Unknown save version")
    return rebuild(
        DraftSettings.from_dict(data["config"]), pool, data["picks"], data["status"]
    )


def rewind(
    state: Session, pool: dict[str, Player], pick_index: int
) -> Session:
    """Restore the state as it was just before pick `pick_index`.
    Faithful restore — rival decisions are pure functions of seed + state."""
    keep = [p.pid for p in state.selections[: max(0, pick_index)]]
    return rebuild(state.config, pool, keep, "in_progress")
