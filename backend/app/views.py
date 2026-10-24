"""Serialization of engine state into the API view the frontend renders.

The frontend is a thin client: every mutation endpoint returns a fresh
DraftView containing the full draft state plus derived analysis (per-team
profiles, category ranks, player scores under the user's punt settings).
"""

from __future__ import annotations

from typing import Any

from .analysis.player_values import (
    UNIFORM_WEIGHTS,
    punt_weights,
    score_player,
)
from .analysis.roster_profile import build_roster_profile, rank_teams
from .engine.draft import (
    DraftState,
    current_pick_in_round,
    current_round,
    current_team_id,
    drafted_set,
    is_complete,
    is_user_turn,
)
from .engine.types import Player


def player_to_json(p: Player, overall: float | None = None) -> dict[str, Any]:
    return {
        "id": p.id,
        "nbaId": p.nba_id,
        "name": p.name,
        "team": p.team,
        "positions": list(p.positions),
        "asOfSeason": p.as_of_season,
        "gp": p.gp,
        "min": p.min,
        "pts": p.pts,
        "reb": p.reb,
        "ast": p.ast,
        "stl": p.stl,
        "blk": p.blk,
        "tpm": p.tpm,
        "fgm": p.fgm,
        "fga": p.fga,
        "ftm": p.ftm,
        "fta": p.fta,
        "tov": p.tov,
        "overall": overall,
    }


def profile_to_json(profile) -> dict[str, Any]:
    return {
        "size": profile.size,
        "totals": profile.totals,
        "fgPct": profile.fg_pct,
        "ftPct": profile.ft_pct,
        "perSlotZ": profile.per_slot_z,
    }


def draft_view(
    draft_id: str | None,
    state: DraftState,
    user_punts: list[str],
    pool: dict[str, Player],
    values: dict[str, dict[str, float]],
) -> dict[str, Any]:
    profiles = [
        build_roster_profile([pool[i] for i in roster], values)
        for roster in state.rosters
    ]
    ranks = rank_teams(profiles)
    weights = punt_weights(set(user_punts))
    scores = {pid: score_player(z, weights) for pid, z in values.items()}

    n = state.config.num_teams
    pick_index = len(state.picks)
    return {
        "id": draft_id,
        "status": state.status,
        "seed": state.config.seed,
        "numTeams": n,
        "rosterSize": state.config.roster_size,
        "userSlot": state.config.user_slot,
        "botSpecs": [
            {"kind": s.kind, "puntCategory": s.punt_category}
            for s in state.config.bot_specs
        ],
        "pickIndex": pick_index,
        "totalPicks": len(state.order),
        "round": current_round(state) if not is_complete(state) else state.config.roster_size,
        "pickInRound": (
            current_pick_in_round(state) if not is_complete(state) else n
        ),
        "onClock": current_team_id(state),
        "isUserTurn": is_user_turn(state) and state.status == "in_progress",
        "complete": is_complete(state),
        "picks": [p.to_dict() for p in state.picks],
        "rosters": [list(r) for r in state.rosters],
        "draftedIds": sorted(drafted_set(state)),
        "scores": scores,
        "profiles": [profile_to_json(p) for p in profiles],
        "ranks": ranks,
        "userPunts": list(user_punts),
    }


def preview_view(
    state: DraftState,
    pool: dict[str, Player],
    values: dict[str, dict[str, float]],
    player_id: str,
) -> dict[str, Any]:
    """Before/after roster profile for the inspection panel."""
    user_roster_ids = list(state.rosters[state.config.user_slot])
    roster = [pool[i] for i in user_roster_ids]
    before = build_roster_profile(roster, values)
    after = build_roster_profile(roster + [pool[player_id]], values)
    return {"before": profile_to_json(before), "after": profile_to_json(after)}
