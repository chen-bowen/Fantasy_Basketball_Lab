"""Headless draft engine.

State is plain JSON-serializable data; all transitions are pure functions
returning a new state. Randomness derives from (seed, draft state) so there
is no RNG state to persist.
"""

from __future__ import annotations

from dataclasses import dataclass, field, replace
from typing import Any

from .snake import build_snake_order, pick_in_round_of_pick, round_of_pick
from .types import BotSpec, Player


@dataclass(frozen=True)
class DraftConfig:
    num_teams: int
    roster_size: int
    user_slot: int  # 0-based
    seed: str
    bot_specs: tuple[BotSpec, ...]  # len == num_teams; user slot is placeholder

    def to_dict(self) -> dict[str, Any]:
        return {
            "numTeams": self.num_teams,
            "rosterSize": self.roster_size,
            "userSlot": self.user_slot,
            "seed": self.seed,
            "botSpecs": [
                {"kind": s.kind, "puntCategory": s.punt_category}
                for s in self.bot_specs
            ],
        }

    @staticmethod
    def from_dict(d: dict[str, Any]) -> "DraftConfig":
        return DraftConfig(
            num_teams=d["numTeams"],
            roster_size=d["rosterSize"],
            user_slot=d["userSlot"],
            seed=d["seed"],
            bot_specs=tuple(
                BotSpec(kind=s["kind"], punt_category=s.get("puntCategory"))
                for s in d["botSpecs"]
            ),
        )


@dataclass(frozen=True)
class PickRecord:
    index: int  # overall pick index (0-based)
    round: int  # 1-based
    team_id: int
    player_id: str

    def to_dict(self) -> dict[str, Any]:
        return {
            "index": self.index,
            "round": self.round,
            "teamId": self.team_id,
            "playerId": self.player_id,
        }


@dataclass(frozen=True)
class DraftState:
    config: DraftConfig
    status: str  # "in_progress" | "paused" | "complete"
    order: tuple[int, ...]  # order[i] = teamId at pick i
    picks: tuple[PickRecord, ...]
    rosters: tuple[tuple[str, ...], ...]


def create_draft(config: DraftConfig) -> DraftState:
    if not 0 <= config.user_slot < config.num_teams:
        raise ValueError(f"user_slot {config.user_slot} out of range")
    if len(config.bot_specs) != config.num_teams:
        raise ValueError("bot_specs must have one entry per team")
    return DraftState(
        config=config,
        status="in_progress",
        order=tuple(build_snake_order(config.num_teams, config.roster_size)),
        picks=(),
        rosters=tuple(() for _ in range(config.num_teams)),
    )


def is_complete(state: DraftState) -> bool:
    return len(state.picks) >= len(state.order)


def current_team_id(state: DraftState) -> int | None:
    if is_complete(state):
        return None
    return state.order[len(state.picks)]


def is_user_turn(state: DraftState) -> bool:
    return current_team_id(state) == state.config.user_slot


def current_round(state: DraftState) -> int:
    return round_of_pick(state.config.num_teams, len(state.picks))


def current_pick_in_round(state: DraftState) -> int:
    return pick_in_round_of_pick(state.config.num_teams, len(state.picks))


def drafted_set(state: DraftState) -> set[str]:
    return {p.player_id for p in state.picks}


def available_player_ids(
    state: DraftState, pool: dict[str, Player]
) -> list[str]:
    taken = drafted_set(state)
    return [pid for pid in pool if pid not in taken]


def available_players(state: DraftState, pool: dict[str, Player]) -> list[Player]:
    return [pool[pid] for pid in available_player_ids(state, pool)]


def apply_pick(
    state: DraftState, pool: dict[str, Player], player_id: str
) -> DraftState:
    """The only way a player enters a roster. Validates legality and
    applies to whichever team is on the clock — bot or user."""
    if state.status != "in_progress":
        raise ValueError(f"Cannot pick while status is {state.status}")
    if is_complete(state):
        raise ValueError("Draft is complete")
    if player_id not in pool:
        raise ValueError(f"Unknown player: {player_id}")
    if player_id in drafted_set(state):
        raise ValueError(f"Player already drafted: {player_id}")
    index = len(state.picks)
    team_id = state.order[index]
    pick = PickRecord(
        index=index,
        round=round_of_pick(state.config.num_teams, index),
        team_id=team_id,
        player_id=player_id,
    )
    rosters = [
        tuple(r) + (player_id,) if i == team_id else r
        for i, r in enumerate(state.rosters)
    ]
    next_state = replace(
        state, rosters=tuple(rosters), picks=state.picks + (pick,)
    )
    if is_complete(next_state):
        next_state = replace(next_state, status="complete")
    return next_state


def pause_draft(state: DraftState) -> DraftState:
    return (
        replace(state, status="paused")
        if state.status == "in_progress"
        else state
    )


def resume_draft(state: DraftState) -> DraftState:
    return (
        replace(state, status="in_progress")
        if state.status == "paused"
        else state
    )


# ---------- Serialization ----------


def serialize_draft(state: DraftState) -> dict[str, Any]:
    return {
        "version": 1,
        "config": state.config.to_dict(),
        "picks": [p.player_id for p in state.picks],
        "status": state.status,
    }


def replay_draft(
    config: DraftConfig,
    pool: dict[str, Player],
    pick_ids: list[str],
    status: str = "in_progress",
) -> DraftState:
    """Rebuild state by replaying the pick log. Bot choices are
    deterministic, so replaying recorded picks reproduces the draft."""
    state = create_draft(config)
    for pid in pick_ids:
        state = apply_pick(state, pool, pid)
    if status == "paused" and state.status == "in_progress":
        state = replace(state, status="paused")
    return state


def deserialize_draft(data: dict[str, Any], pool: dict[str, Player]) -> DraftState:
    if data.get("version") != 1:
        raise ValueError("Unknown save version")
    return replay_draft(
        DraftConfig.from_dict(data["config"]), pool, data["picks"], data["status"]
    )


def rewind_to_pick(
    state: DraftState, pool: dict[str, Player], pick_index: int
) -> DraftState:
    """Restore the state as it was just before pick `pick_index`.
    Faithful restore — bot decisions are pure functions of seed + state."""
    keep = [p.player_id for p in state.picks[: max(0, pick_index)]]
    return replay_draft(state.config, pool, keep, "in_progress")
