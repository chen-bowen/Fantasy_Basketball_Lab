"""Serialization of engine state into the API view the frontend renders.

The frontend is a thin client: every mutation endpoint returns a fresh
DraftView containing the full draft state plus derived analysis (per-team
profiles, category ranks, player scores under the user's concede settings).
"""

from __future__ import annotations

from typing import Any

from .metrics.ratings import concede_weights, line_score
from .metrics.shape import (
    board_window,
    shape_score,
    shape_frame,
    board_order,
    in_play,
    order_candidates,
    decided,
    window_ceiling,
)
from .metrics.weekly import week_board, week_rates
from .metrics.ratings import Baseline
from .metrics.concede import advise_concedes
from .metrics.profile import roster_line, cat_ranks
from .metrics.table import table_records
from .domain.session import (
    Session,
    slot_now,
    round_now,
    on_clock,
    taken_ids,
    draft_done,
    user_turn,
)
from .domain.model import CATEGORIES, RivalSpec, Player


def rival_json(s: RivalSpec) -> dict[str, Any]:
    return {"style": s.style, "concede": s.concede_cat, "lean": s.lean}


def player_json(
    p: Player,
    overall: float | None = None,
    z: dict[str, float] | None = None,
    overall_rank: int | None = None,
    availability: float | None = None,
) -> dict[str, Any]:
    return {
        "id": p.id,
        "refId": p.ref_id,
        "name": p.name,
        "team": p.team,
        "signed": p.signed,
        "status": p.status,
        "availability": availability,  # expected share of games, 0–1
        "positions": list(p.positions),
        "season": p.season,
        "gp": p.gp,
        "seasonGp": p.season_gp,
        "mpg": p.mpg,
        "pts": p.pts,
        "reb": p.reb,
        "ast": p.ast,
        "stl": p.stl,
        "blk": p.blk,
        "threes": p.threes,
        "fgm": p.fgm,
        "fga": p.fga,
        "ftm": p.ftm,
        "fta": p.fta,
        "tov": p.tov,
        "adp": p.adp,
        "market": overall,  # market value: a draft-table price, not a scoresheet sum
        "marketRank": overall_rank,  # 1 = highest market value in the pool
        "z": z,
    }


def line_json(profile) -> dict[str, Any]:
    return {
        "size": profile.size,
        "totals": profile.totals,
        "fgPct": profile.fg_pct,
        "ftPct": profile.ft_pct,
        "perSlotZ": profile.per_slot_z,
    }


def session_view(
    session_id: str | None,
    state: Session,
    user_concedes: list[str],
    pool: dict[str, Player],
    values: dict[str, dict[str, float]],
    concede_mode: str = "auto",
    lookahead: dict[str, Any] | None = None,
    market_rank: dict[str, int] | None = None,
    pool_stats: Baseline | None = None,
) -> dict[str, Any]:
    profiles = [
        roster_line([pool[i] for i in roster], values)
        for roster in state.squads
    ]
    concede_plan = advise_concedes(profiles, state.config.seat, list(user_concedes))
    ranks = cat_ranks(profiles)
    weights = concede_weights(set(user_concedes))
    scores = {pid: line_score(z, weights) for pid, z in values.items()}
    drafted = taken_ids(state)
    fit_w, swing = shape_frame(
        profiles, state.config.seat, set(user_concedes), state.config.squad_size
    )
    fit = {
        pid: shape_score(z, fit_w) for pid, z in values.items() if pid not in drafted
    }

    n = state.config.teams
    pick_index = len(state.selections)
    # Who Fit actually recommends: the players the draft expects to go
    # around this pick, ordered by Fit. The rest of `fit` is for browsing.
    if market_rank is None:
        market_rank = board_order(values)
    candidates = order_candidates(
        board_window(list(fit), values, pick_index + 1, n, market_rank), values, fit_w
    )
    user_ranks = {c: ranks[c][state.config.seat] for c in CATEGORIES}
    complete = draft_done(state)
    # The week-to-week view (analysis/matchups.py): every team's win rate
    # over a round against the league, and the user's week against each
    # team — the latter only once rosters are complete.
    concedes_by_team = [
        set(user_concedes) if t == state.config.seat
        else {s.concede_cat} if s.style == "concede" and s.concede_cat else set()
        for t, s in enumerate(state.config.rivals)
    ]
    matchups = (
        week_board(
            state.config.seat,
            profiles,
            ranks,
            [[pool[i] for i in r] for r in state.squads],
            values,
            pool_stats,
            concedes_by_team,
        )
        if complete
        else None
    )
    return {
        "id": session_id,
        "phase": state.phase,
        "seed": state.config.seed,
        "teams": n,
        "squadSize": state.config.squad_size,
        "seat": state.config.seat,
        "rivals": [rival_json(s) for s in state.config.rivals],
        "atPick": pick_index,
        "span": len(state.order),
        "round": round_now(state) if not draft_done(state) else state.config.squad_size,
        "slot": (
            slot_now(state) if not draft_done(state) else n
        ),
        "onClock": on_clock(state),
        "yourPick": user_turn(state) and state.phase == "in_progress",
        "complete": complete,
        "selections": [p.to_dict() for p in state.selections],
        "squads": [list(r) for r in state.squads],
        "taken": sorted(drafted),
        "scores": scores,
        "fit": fit,
        "shape": fit_w,
        # Fit's focus: the categories still up for grabs, which it counts most...
        "inPlay": in_play(swing),
        # ...and the ones it counts least, split by why: locked up or out of reach.
        "settled": {
            "ahead": [c for c in decided(swing) if user_ranks[c] <= n // 2],
            "behind": [c for c in decided(swing) if user_ranks[c] > n // 2],
        },
        # The players Fit recommends at this pick, best Fit first: market rank
        # within the window of the current pick (see analysis/fit.py).
        "candidates": candidates,
        "window": {
            "pick": pick_index + 1,
            "maxRank": window_ceiling(pick_index + 1, n),
            "size": len(candidates),
        },
        "profiles": [line_json(p) for p in profiles],
        "ranks": ranks,
        "records": table_records(ranks),  # on paper: ranks higher in more categories
        "weekPct": week_rates(profiles),  # week to week: share of matchups won in a typical week
        "board": matchups,
        "concedes": list(user_concedes),
        "concedeMode": concede_mode,  # "auto": concedes follow the roster; "manual": set by hand
        "concedePlan": concede_plan,  # what the roster says to concede, and why
        # Look-ahead to the user's next turn (only on the user's turn):
        # share of quick runs in which each available player is gone by then.
        "nextTurn": (lookahead or {}).get("nextPick"),
        "gone": (lookahead or {}).get("gone", {}),
    }


def board_preview(
    state: Session,
    pool: dict[str, Player],
    values: dict[str, dict[str, float]],
    pid: str,
) -> dict[str, Any]:
    """Before/after roster profile and category ranks for the inspection panel."""
    slot = state.config.seat
    roster = [pool[i] for i in state.squads[slot]]
    before = roster_line(roster, values)
    after = roster_line(roster + [pool[pid]], values)

    # Only the user's profile changes; re-rank the league with the pick added.
    profiles = [
        roster_line([pool[i] for i in r], values)
        for r in state.squads
    ]
    ranks_before = cat_ranks(profiles)
    profiles[slot] = after
    ranks_after = cat_ranks(profiles)

    return {
        "before": line_json(before),
        "after": line_json(after),
        "ranks": {
            c: {"before": ranks_before[c][slot], "after": ranks_after[c][slot]}
            for c in CATEGORIES
        },
    }
