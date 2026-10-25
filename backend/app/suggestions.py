"""Build suggestions for the user's first two picks, found by simulation.

The first two picks decide which category a team can punt. For each
candidate (player, punt) we play the rest of the draft out several times
from the actual current state: the candidate is taken on the spot, every
later user pick takes the best Fit under that punt, and bots draft as
usual. Each run is scored by the head-to-head record of the user's final
roster. The extra runs reuse this league's bot personalities and only vary
the seed (bot pick noise), so the estimate describes this league, not
drafting in general.

Simulations are CPU-bound and independent, so they fan out over a process
pool; results are cached per draft position.
"""

from __future__ import annotations

import os
from concurrent.futures import Executor, ProcessPoolExecutor
from dataclasses import replace
from typing import Any

from .analysis.fit import fit_weights
from .analysis.player_values import (
    UNIFORM_WEIGHTS,
    compute_player_values,
    score_player,
)
from .analysis.roster_profile import build_roster_profile, rank_teams
from .analysis.standings import records
from .data.pool import PLAYERS, PLAYER_POOL
from .engine.bots import choose_bot_pick
from .engine.draft import (
    DraftConfig,
    DraftState,
    apply_pick,
    available_player_ids,
    create_draft,
    current_team_id,
    deserialize_draft,
    drafted_set,
    is_complete,
    serialize_draft,
)
from .engine.types import CATEGORIES

SIM_SEEDS = 6
PUNT_OPTIONS = ("AST", "FG%", "FT%", "TO", "3PM")
FIRST_PICK_CANDIDATES = 4
SECOND_PICK_PER_PUNT = 3
SECOND_PICK_OPTIONS = 4
NEXT_OPTIONS = 3
SHRINK_RUNS = 2  # pseudo-runs at the group mean when ordering second-pick options

_VALUES, _ = compute_player_values(PLAYERS)
_EXECUTOR: Executor | None = None
_CACHE: dict[tuple, dict[str, Any]] = {}


def _executor() -> Executor:
    global _EXECUTOR
    if _EXECUTOR is None:
        _EXECUTOR = ProcessPoolExecutor(max_workers=min(8, os.cpu_count() or 2))
    return _EXECUTOR


def sim_seeds(seed: str, n: int = SIM_SEEDS) -> list[str]:
    return [seed] + [f"{seed}#sim{i}" for i in range(1, n)]


def _profiles(state: DraftState):
    return [
        build_roster_profile([PLAYER_POOL[i] for i in r], _VALUES)
        for r in state.rosters
    ]


def best_fit(state: DraftState, team_id: int, punts: set[str], n: int = 1) -> list[str]:
    w = fit_weights(_profiles(state), team_id, punts)
    ids = available_player_ids(state, PLAYER_POOL)
    return sorted(ids, key=lambda i: -score_player(_VALUES[i], w))[:n]


def simulate(
    config: DraftConfig,
    fixed: list[str],
    punts: set[str],
    stop_at_turn: int | None = None,
) -> DraftState | None:
    """Play a draft out. The user's first picks are `fixed`, later ones take
    the best Fit. Returns None if a fixed player is gone before his turn;
    with stop_at_turn, returns the state when that user turn comes up."""
    state = create_draft(config)
    turn = 0
    while not is_complete(state):
        team = current_team_id(state)
        if team == config.user_slot:
            if stop_at_turn is not None and turn == stop_at_turn:
                return state
            if turn < len(fixed):
                if fixed[turn] in drafted_set(state):
                    return None
                pid = fixed[turn]
            else:
                pid = best_fit(state, team, punts)[0]
            turn += 1
        else:
            pid = choose_bot_pick(state, PLAYER_POOL, _VALUES, team)
        state = apply_pick(state, PLAYER_POOL, pid)
    return state


def continue_draft(
    state: DraftState,
    punts: set[str],
    take: str | None = None,
    stop_before_user_turn: bool = False,
) -> DraftState:
    """Play out the rest of an in-progress draft. `take` is the user's pick
    on the clock; later user picks take the best Fit under `punts`, and bots
    draft as usual. With stop_before_user_turn, returns the state when the
    user's next turn comes up.

    Unlike simulate(), this starts from the actual draft state, so it works
    even when stored picks were made under different bot logic or player
    values."""
    if take is not None:
        assert current_team_id(state) == state.config.user_slot
        state = apply_pick(state, PLAYER_POOL, take)
    while not is_complete(state):
        team = current_team_id(state)
        if team == state.config.user_slot:
            if stop_before_user_turn:
                return state
            pid = best_fit(state, team, punts)[0]
        else:
            pid = choose_bot_pick(state, PLAYER_POOL, _VALUES, team)
        state = apply_pick(state, PLAYER_POOL, pid)
    return state


def _wins(job: tuple[dict, str, list[str], str]) -> int | None:
    state_dict, take, punts, seed = job
    state = deserialize_draft(state_dict, PLAYER_POOL)
    if seed != state.config.seed:
        state = replace(state, config=replace(state.config, seed=seed))
    final = continue_draft(state, set(punts), take=take)
    return records(rank_teams(_profiles(final)))[state.config.user_slot]["wins"]


def _average_wins(
    state: DraftState,
    combos: list[tuple[str, list[str]]],
    seeds: list[str],
    executor: Executor | None,
) -> list[tuple[float | None, int]]:
    """(average wins, completed runs) per (take-now, punts) combo, playing
    the real draft forward from its current state under different seeds."""
    blob = serialize_draft(state)
    jobs = [
        (blob, take, punts, s)
        for take, punts in combos
        for s in seeds
    ]
    mapper = executor.map if executor else map
    results = list(mapper(_wins, jobs))
    out = []
    for i in range(len(combos)):
        chunk = [w for w in results[i * len(seeds):(i + 1) * len(seeds)] if w is not None]
        out.append((sum(chunk) / len(chunk) if chunk else None, len(chunk)))
    return out


def _shrunk(wins: float, runs: int, pool: dict[str, tuple[float, int, str]]) -> float:
    """Order by wins pulled toward the group mean when a player was only
    available in a few runs, so one lucky run can't top the list."""
    mean = sum(w for w, _, _ in pool.values()) / len(pool)
    return (wins * runs + mean * SHRINK_RUNS) / (runs + SHRINK_RUNS)


def _user_ranks(state: DraftState, team_id: int) -> list[int]:
    ranks = rank_teams(_profiles(state))
    return [ranks[c][team_id] for c in CATEGORIES]


def first_pick_options(
    state: DraftState, seeds: list[str] | None = None, executor: Executor | None = None
) -> list[dict[str, Any]]:
    config = state.config
    seeds = seeds or sim_seeds(config.seed)
    available = available_player_ids(state, PLAYER_POOL)
    overall = lambda i: score_player(_VALUES[i], UNIFORM_WEIGHTS)
    candidates = sorted(available, key=lambda i: -overall(i))[:FIRST_PICK_CANDIDATES]

    combos = [
        (c, [p] if p else [])
        for c in candidates
        for p in (None, *PUNT_OPTIONS)
    ]
    results = _average_wins(state, combos, seeds, executor)
    per = len(PUNT_OPTIONS) + 1

    options = []
    for k, c in enumerate(candidates):
        block = results[k * per:(k + 1) * per]
        no_plan = block[0][0]
        scored = [
            (block[j + 1], PUNT_OPTIONS[j])
            for j in range(len(PUNT_OPTIONS))
            if block[j + 1][0] is not None
        ]
        if not scored:
            continue
        (wins, runs), punt = max(scored, key=lambda x: x[0][0])
        finish = continue_draft(state, {punt}, take=c)
        at_next = continue_draft(state, {punt}, take=c, stop_before_user_turn=True)
        options.append(
            {
                "playerId": c,
                "punt": punt,
                "wins": round(wins, 1),
                "runs": runs,
                "noPlanWins": round(no_plan, 1) if no_plan is not None else None,
                "finishRanks": _user_ranks(finish, config.user_slot),
                "nextOptions": best_fit(at_next, config.user_slot, {punt}, NEXT_OPTIONS),
            }
        )
    return sorted(options, key=lambda o: -o["wins"])


def second_pick_options(
    state: DraftState,
    punts: set[str],
    seeds: list[str] | None = None,
    executor: Executor | None = None,
) -> list[dict[str, Any]]:
    config = state.config
    slot = config.user_slot
    seeds = seeds or sim_seeds(config.seed)
    current = next(iter(punts), None)

    combos: list[tuple[str, str]] = []
    for punt in dict.fromkeys([*([current] if current else []), *PUNT_OPTIONS]):
        for c in best_fit(state, slot, {punt}, SECOND_PICK_PER_PUNT):
            if (c, punt) not in combos:
                combos.append((c, punt))

    results = _average_wins(state, [(c, [p]) for c, p in combos], seeds, executor)
    best_by_player: dict[str, tuple[float, int, str]] = {}
    for (c, punt), (wins, runs) in zip(combos, results):
        if wins is None:
            continue
        if c not in best_by_player or wins > best_by_player[c][0]:
            best_by_player[c] = (wins, runs, punt)

    ranked = sorted(
        best_by_player.items(), key=lambda kv: -_shrunk(kv[1][0], kv[1][1], best_by_player)
    )[:SECOND_PICK_OPTIONS]
    options = []
    for c, (wins, runs, punt) in ranked:
        at_next = continue_draft(state, {punt}, take=c, stop_before_user_turn=True)
        options.append(
            {
                "playerId": c,
                "punt": punt,
                "keepsPunt": punt == current,
                "wins": round(wins, 1),
                "runs": runs,
                "ranksAfter": _user_ranks(at_next, slot),
                "nextOptions": best_fit(at_next, slot, {punt}, 2),
            }
        )
    return options


def suggestions(state: DraftState, punts: list[str]) -> dict[str, Any]:
    """Pick suggestions for the user's current turn, if it is one of the
    first two. Cached per (seed, slot, user picks, punts, pick index)."""
    slot = state.config.user_slot
    mine = [p.player_id for p in state.picks if p.team_id == slot]
    if current_team_id(state) != slot or len(mine) >= 2:
        return {"stage": None, "options": []}
    key = (state.config.seed, slot, tuple(mine), tuple(sorted(punts)), len(state.picks))
    if key not in _CACHE:
        if not mine:
            _CACHE[key] = {"stage": "first", "options": first_pick_options(state, executor=_executor())}
        else:
            _CACHE[key] = {
                "stage": "second",
                "options": second_pick_options(state, set(punts), executor=_executor()),
            }
    return _CACHE[key]
