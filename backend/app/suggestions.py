"""Build suggestions for the user's first two picks, found by simulation.

The first two picks decide which category a team can punt. For each
candidate (player, punt) we play the rest of the draft out several times
from the actual current state: the candidate is taken on the spot, every
later user pick takes the best Fit under that punt, and bots draft as
usual. Each run is scored by the expected head-to-head record of the user's
final roster (standings.expected_wins — category leads count by margin). The extra runs reuse this league's bot personalities and only vary
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
from .analysis.market import MARKET_WEIGHTS
from .analysis.player_values import compute_player_values, score_player
from .analysis.roster_profile import build_roster_profile, rank_teams
from .analysis.standings import expected_wins
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

SIM_SEEDS = 8  # full drafts per tested option; the on-screen range shows the spread
PUNT_OPTIONS = ("AST", "FG%", "FT%", "TO", "3PM")
FIRST_PICK_CANDIDATES = 4
SECOND_PICK_PER_PUNT = 3
SECOND_PICK_OPTIONS = 4
NEXT_OPTIONS = 3
SHRINK_RUNS = 2  # pseudo-runs at the group mean when ordering second-pick options
MARKET_CANDIDATES = 4  # top of the board as the market sees it, also tried as second picks
MARKET_CANDIDATE_PUNTS = 2  # each tried under his weakest categories, plus the current punt
# Expected wins averaged over the runs still carry a little noise (a 6-run
# average has a standard error of about 0.05 wins). Break near-ties toward
# the player the market rates higher: he is the one who won't still be
# there next turn. One standard error per unit of market value lets the
# market decide only between options the simulations can't separate.
MARKET_TIEBREAK = 0.05  # wins per unit of market value

_VALUES, _STATS = compute_player_values(PLAYERS)
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
            pid = choose_bot_pick(state, PLAYER_POOL, _VALUES, team, _STATS.healthy_values)
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
            pid = choose_bot_pick(state, PLAYER_POOL, _VALUES, team, _STATS.healthy_values)
        state = apply_pick(state, PLAYER_POOL, pid)
    return state


def _wins(job: tuple[dict, str, list[str], str]) -> float | None:
    """Expected matchup wins (0-11) of the user's final roster — the noisy
    head-to-head view, so comfortable category leads count for more than
    narrow ones and the estimate keeps resolving between good options."""
    state_dict, take, punts, seed = job
    state = deserialize_draft(state_dict, PLAYER_POOL)
    if seed != state.config.seed:
        state = replace(state, config=replace(state.config, seed=seed))
    final = continue_draft(state, set(punts), take=take)
    return expected_wins(_profiles(final))[state.config.user_slot]


def _average_wins(
    state: DraftState,
    combos: list[tuple[str, list[str]]],
    seeds: list[str],
    executor: Executor | None,
) -> list[tuple[float | None, int, tuple[float, float] | None]]:
    """(average wins, completed runs, (min, max) over runs) per (take-now,
    punts) combo, playing the real draft forward from its current state
    under different seeds."""
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
        out.append(
            (
                sum(chunk) / len(chunk) if chunk else None,
                len(chunk),
                (min(chunk), max(chunk)) if chunk else None,
            )
        )
    return out


def _shrunk(wins: float, runs: int, pool: dict[str, tuple[float, int, str]]) -> float:
    """Order by wins pulled toward the group mean when a player was only
    available in a few runs, so one lucky run can't top the list."""
    mean = sum(w for w, _, _ in pool.values()) / len(pool)
    return (wins * runs + mean * SHRINK_RUNS) / (runs + SHRINK_RUNS)


def market_value(player_id: str) -> float:
    return score_player(_VALUES[player_id], MARKET_WEIGHTS)


def top_of_board(state: DraftState, n: int) -> list[str]:
    """Best available by market value — what a drafter sees on the clock."""
    ids = available_player_ids(state, PLAYER_POOL)
    return sorted(ids, key=lambda i: -market_value(i))[:n]


STRONG_Z = 0.8  # a category a player clearly brings
WEAK_Z = -0.8  # a category a player clearly hurts


def pairing_reason(
    state: DraftState, player_id: str, punt: str | None
) -> dict[str, Any]:
    """Why this player, next to what the user already has: the categories
    he brings that the roster lacks, the roster weaknesses he offsets, what
    he doubles up on, what he costs, how many games he plays, and what the
    market thinks he is worth. Pure roster arithmetic, no simulation."""
    slot = state.config.user_slot
    roster = [PLAYER_POOL[i] for i in state.rosters[slot]]
    have = build_roster_profile(roster, _VALUES).per_slot_z if roster else None
    z = _VALUES[player_id]
    adds, patches, spares, overlaps, costs = [], [], [], [], []
    for c in CATEGORIES:
        if c == punt:
            continue
        if z[c] >= STRONG_Z:
            if have is not None and have[c] >= STRONG_Z:
                overlaps.append(c)
            else:
                adds.append(c)
        if have is not None and have[c] <= WEAK_Z:
            if z[c] >= 0.5:
                patches.append(c)  # actively offsets a roster weakness
            elif z[c] > -0.3:
                spares.append(c)  # at least doesn't deepen it
        if z[c] <= WEAK_Z:
            costs.append(c)
    ids = available_player_ids(state, PLAYER_POOL)
    board = sorted(ids, key=lambda i: -market_value(i))
    return {
        "adds": adds,
        "patches": patches,
        "spares": spares,
        "overlaps": overlaps,
        "costs": costs,
        "availability": round(_STATS.availability[player_id], 2),
        "marketRank": board.index(player_id) + 1 if player_id in board else None,
    }


def still_there_next_turn(
    state: DraftState, player_id: str, punt: str | None, seeds: list[str]
) -> dict[str, Any]:
    """In how many runs the player is still on the board at the user's next
    turn if the user passes on him now (taking the best other Fit instead)
    — whether he can wait a round."""
    slot = state.config.user_slot
    punts = {punt} if punt else set()
    alternatives = [i for i in best_fit(state, slot, punts, 2) if i != player_id]
    if not alternatives:
        return {"runs": 0, "stillThere": 0, "pick": None}
    blob = serialize_draft(state)
    still = 0
    pick = None
    for seed in seeds:
        st = deserialize_draft(blob, PLAYER_POOL)
        if seed != st.config.seed:
            st = replace(st, config=replace(st.config, seed=seed))
        st = continue_draft(st, punts, take=alternatives[0], stop_before_user_turn=True)
        pick = len(st.picks) + 1
        if player_id not in drafted_set(st):
            still += 1
    return {"runs": len(seeds), "stillThere": still, "pick": pick}


def _user_ranks(state: DraftState, team_id: int) -> list[int]:
    ranks = rank_teams(_profiles(state))
    return [ranks[c][team_id] for c in CATEGORIES]


def first_pick_options(
    state: DraftState, seeds: list[str] | None = None, executor: Executor | None = None
) -> list[dict[str, Any]]:
    config = state.config
    seeds = seeds or sim_seeds(config.seed)
    # Candidates are the top of the draft board as the market sees it.
    candidates = top_of_board(state, FIRST_PICK_CANDIDATES)

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
        (wins, runs, spread), punt = max(scored, key=lambda x: x[0][0])
        finish = continue_draft(state, {punt}, take=c)
        at_next = continue_draft(state, {punt}, take=c, stop_before_user_turn=True)
        options.append(
            {
                "playerId": c,
                "punt": punt,
                "wins": round(wins, 1),
                "runs": runs,
                "winsRange": [round(spread[0], 1), round(spread[1], 1)] if spread else None,
                "noPlanWins": round(no_plan, 1) if no_plan is not None else None,
                "finishRanks": _user_ranks(finish, config.user_slot),
                "nextOptions": best_fit(at_next, config.user_slot, {punt}, NEXT_OPTIONS),
                "why": pairing_reason(state, c, punt),
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
    # The market's top options, so a star the Fit ranking passes over is
    # still tested — under the current plan and under the punts that suit
    # him (his weakest categories), not just whichever punt comes first.
    for c in top_of_board(state, MARKET_CANDIDATES):
        natural = sorted(PUNT_OPTIONS, key=lambda p: _VALUES[c][p])[:MARKET_CANDIDATE_PUNTS]
        for punt in dict.fromkeys([*([current] if current else []), *natural]):
            if (c, punt) not in combos:
                combos.append((c, punt))

    results = _average_wins(state, [(c, [p]) for c, p in combos], seeds, executor)
    best_by_player: dict[str, tuple[float, int, str]] = {}
    spread_of: dict[tuple[str, str], tuple[float, float] | None] = {}
    for (c, punt), (wins, runs, spread) in zip(combos, results):
        if wins is None:
            continue
        spread_of[(c, punt)] = spread
        if c not in best_by_player or wins > best_by_player[c][0]:
            best_by_player[c] = (wins, runs, punt)

    ranked = sorted(
        best_by_player.items(),
        key=lambda kv: -(
            _shrunk(kv[1][0], kv[1][1], best_by_player) + MARKET_TIEBREAK * market_value(kv[0])
        ),
    )[:SECOND_PICK_OPTIONS]
    # The market's pick here, as a yardstick: what the room would do and
    # what it would expect to win, so the options can be read against it.
    consensus_id = top_of_board(state, 1)[0]
    consensus = None
    if consensus_id in best_by_player:
        c_wins, c_runs, c_punt = best_by_player[consensus_id]
        consensus = {"playerId": consensus_id, "wins": round(c_wins, 1), "punt": c_punt, "runs": c_runs}
    options = []
    for c, (wins, runs, punt) in ranked:
        at_next = continue_draft(state, {punt}, take=c, stop_before_user_turn=True)
        spread = spread_of[(c, punt)]
        options.append(
            {
                "playerId": c,
                "punt": punt,
                "keepsPunt": punt == current,
                "wins": round(wins, 1),
                "runs": runs,
                "winsRange": [round(spread[0], 1), round(spread[1], 1)] if spread else None,
                "ranksAfter": _user_ranks(at_next, slot),
                "nextOptions": best_fit(at_next, slot, {punt}, 2),
                "why": pairing_reason(state, c, punt),
                "wait": still_there_next_turn(state, c, punt, seeds),
            }
        )
    return {"options": options, "consensus": consensus, "tested": len(best_by_player)}


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
                **second_pick_options(state, set(punts), executor=_executor()),
            }
    return _CACHE[key]
