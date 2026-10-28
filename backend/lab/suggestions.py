"""Build suggestions for the user's first two picks, found by simulation.

The first two picks decide which category a team can punt. For every
player in range at the pick (the candidate window) and every punt that
suits the roster-plus-him, we play the rest of the draft out several times
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

from .analysis.fit import candidate_window, fit_weights, market_ranks, rank_candidates
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

PUNT_OPTIONS = ("AST", "FG%", "FT%", "TO", "3PM")
NEXT_OPTIONS = 3
SHRINK_RUNS = 2  # pseudo-runs at the group mean when ordering options

# Every candidate at the pick is tested, in two stages. The screen plays a
# couple of drafts for each (player, punt) combination; then each player's
# best plan, and the best player under each plan, get the full sample. A
# draft costs the same whoever is picked, so this is what lets the
# candidate set be the whole window rather than a shortlist.
SCREEN_SEEDS = 2
SIM_SEEDS = 8  # drafts per refined option; the on-screen range shows the spread
CANDIDATE_PUNTS = 2  # punts tried per candidate, besides no punt
PUNTABLE_Z = 0.3  # per-slot z below which a category is weak enough to concede
LOOKAHEAD_SEEDS = 10  # quick runs (x2 assumed picks) to the user's next turn, for who will still be there
# Expected wins averaged over the runs still carry a little noise (a 6-run
# average has a standard error of about 0.05 wins). Break near-ties toward
# the player the market rates higher: he is the one who won't still be
# there next turn. Two standard errors per unit of market value means a
# lower-valued option has to win by a margin the sims can actually resolve,
# not by noise — the market only decides what the sims can't separate.
MARKET_TIEBREAK = 0.10  # wins per unit of market value
# Options within this many wins of each other are a toss-up: the sims can
# rank them, but the ranking is not worth a decision. The screen says so.
TIE_WINS = 0.3

_VALUES, _STATS = compute_player_values(PLAYERS)
_MARKET_RANK = market_ranks(_VALUES)
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
    """The user's pick policy: best Fit among the players the draft expects
    to go around this pick (the candidate window) — the same list the
    draft room recommends, so the simulations play the way the room advises."""
    w = fit_weights(_profiles(state), team_id, punts, state.config.roster_size)
    ids = available_player_ids(state, PLAYER_POOL)
    window = candidate_window(
        ids, _VALUES, len(state.picks) + 1, state.config.num_teams, _MARKET_RANK
    )
    return rank_candidates(window, _VALUES, w)[:n]


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


def _wins(job: tuple[dict, str, list[str], str]) -> tuple[float, list[int]] | None:
    """Expected matchup wins (0-11) of the user's final roster — the noisy
    head-to-head view, so comfortable category leads count for more than
    narrow ones and the estimate keeps resolving between good options —
    and the roster's final category ranks."""
    state_dict, take, punts, seed = job
    state = deserialize_draft(state_dict, PLAYER_POOL)
    if seed != state.config.seed:
        state = replace(state, config=replace(state.config, seed=seed))
    final = continue_draft(state, set(punts), take=take)
    profiles = _profiles(final)
    slot = state.config.user_slot
    ranks = rank_teams(profiles)
    return expected_wins(profiles)[slot], [ranks[c][slot] for c in CATEGORIES]


Combo = tuple[str, tuple[str, ...]]  # (take, punts)
Runs = dict[Combo, list[float]]  # wins per run
Finals = dict[Combo, list[int]]  # the user's final category ranks in the draft's own seed


def _run_wins(
    state: DraftState,
    combos: list[tuple[str, list[str]]],
    seeds: list[str],
    executor: Executor | None,
    into: Runs | None = None,
    finals: Finals | None = None,
) -> Runs:
    """Play the real draft forward from its current state under each seed for
    every (take-now, punts) combo; wins per completed run, merged into `into`.
    With `finals`, the final ranks from the draft's own seed are kept too."""
    blob = serialize_draft(state)
    jobs = [(blob, take, punts, s) for take, punts in combos for s in seeds]
    mapper = executor.map if executor else map
    results = list(mapper(_wins, jobs))
    out: Runs = into if into is not None else {}
    for i, (take, punts) in enumerate(combos):
        chunk = results[i * len(seeds):(i + 1) * len(seeds)]
        key = (take, tuple(punts))
        out.setdefault(key, []).extend(w for w, _ in chunk if w is not None)
        if finals is not None:
            for s, r in zip(seeds, chunk):
                if s == state.config.seed and r is not None:
                    finals[key] = r[1]
    return out


def _summary(runs: list[float]) -> tuple[float | None, int, tuple[float, float] | None]:
    """(average wins, completed runs, (min, max) over runs)."""
    if not runs:
        return None, 0, None
    return sum(runs) / len(runs), len(runs), (min(runs), max(runs))


def natural_punts(
    state: DraftState, player_id: str, current: str | None
) -> list[str | None]:
    """The plans worth testing for a candidate: no punt, plus the puntable
    categories the roster-plus-him would be genuinely weak in (per-slot z
    below PUNTABLE_Z — a punt concedes a category you can't win, not one
    you merely own less than another), and the current plan while it is
    still a legal punt. The incumbent is always tested: two players are a
    poor read on a category's fate, so the simulations — not the weakness
    gate — decide whether the plan survives."""
    slot = state.config.user_slot
    roster = [*state.rosters[slot], player_id]
    per_slot = {
        c: sum(_VALUES[pid][c] for pid in roster) / len(roster) for c in CATEGORIES
    }
    weak = sorted((p for p in PUNT_OPTIONS if per_slot[p] < PUNTABLE_Z), key=lambda p: per_slot[p])
    out: list[str | None] = [None, *weak[:CANDIDATE_PUNTS]]
    if current in PUNT_OPTIONS and current not in out:
        out.append(current)
    return out


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


def _user_ranks(state: DraftState, team_id: int) -> list[int]:
    ranks = rank_teams(_profiles(state))
    return [ranks[c][team_id] for c in CATEGORIES]


def _refine(
    state: DraftState,
    combos: list[tuple[str, str | None]],
    seeds: list[str],
    executor: Executor | None,
    finals: Finals | None = None,
) -> Runs:
    """Stage one plays SCREEN_SEEDS drafts per (player, punt) combo; stage
    two plays the remaining seeds for every player's best plan and for the
    best player under each plan, so everything shown has the full sample."""
    as_list = [(c, [p] if p else []) for c, p in combos]
    screen, rest = seeds[:SCREEN_SEEDS], seeds[SCREEN_SEEDS:]
    runs = _run_wins(state, as_list, screen, executor, finals=finals)
    if not rest:
        return runs

    def mean(key):
        r = runs.get(key)
        return sum(r) / len(r) if r else None

    keep: set[tuple[str, tuple[str, ...]]] = set()
    by_player: dict[str, tuple[float, tuple]] = {}
    by_plan: dict[str | None, tuple[float, tuple]] = {}
    for c, p in combos:
        key = (c, (p,) if p else ())
        w = mean(key)
        if w is None:
            continue
        score = w + MARKET_TIEBREAK * market_value(c)
        if c not in by_player or score > by_player[c][0]:
            by_player[c] = (score, key)
        if p not in by_plan or score > by_plan[p][0]:
            by_plan[p] = (score, key)
    keep.update(k for _, k in by_player.values())
    keep.update(k for _, k in by_plan.values())
    _run_wins(state, [(k[0], list(k[1])) for k in keep], rest, executor, into=runs, finals=finals)
    return runs


def _shrunk(wins: float, runs: int, pool: dict[str, tuple]) -> float:
    """Order by wins pulled toward the group mean when a player was only
    available in a few runs, so one lucky run can't top the list."""
    mean = sum(v[0] for v in pool.values()) / len(pool)
    return (wins * runs + mean * SHRINK_RUNS) / (runs + SHRINK_RUNS)


def _tiers(wins: list[float], tie: float = TIE_WINS) -> list[int]:
    """Tier per option (1 = top), for options sorted best first: a new tier
    starts when an option is more than `tie` behind the best of the current one."""
    tiers: list[int] = []
    tier, head = 0, None
    for w in wins:
        if head is None or head - w > tie:
            tier += 1
            head = w
        head = max(head, w)  # the order is by shrunk wins, so a later option can lead its tier
        tiers.append(tier)
    return tiers


def build_options(
    state: DraftState,
    punts: set[str],
    seeds: list[str] | None = None,
    executor: Executor | None = None,
) -> dict[str, Any]:
    """Every candidate at this pick, evaluated: the players the draft expects
    to go around here (the window), each under no punt and the punts that
    suit the roster-plus-him, played out by simulation. One option per
    player (his best plan), tiered at the sims' resolution; the best player
    under each plan as the build alternatives; and the look-ahead's verdict
    on who is gone before the user's next turn. Nothing in range is left
    for 'Browse all players' to find."""
    config = state.config
    slot = config.user_slot
    seeds = seeds or sim_seeds(config.seed)
    current = next(iter(punts), None)
    pick = len(state.picks) + 1

    candidates = candidate_window(
        available_player_ids(state, PLAYER_POOL), _VALUES, pick, config.num_teams, _MARKET_RANK
    )
    combos: list[tuple[str, str | None]] = [
        (c, p) for c in candidates for p in natural_punts(state, c, current)
    ]
    finals: Finals = {}
    runs = _refine(state, combos, seeds, executor, finals)

    # One option per player: his best plan among those with the full sample
    # (or the screen, if nothing was refined for him).
    best: dict[str, tuple[float, int, tuple[float, float] | None, str | None]] = {}
    plan_best: dict[str | None, tuple[float, int, tuple[float, float] | None, str]] = {}
    for c, p in combos:
        wins, n, spread = _summary(runs.get((c, (p,) if p else ()), []))
        if wins is None:
            continue
        if c not in best or (n, wins) > (best[c][1], best[c][0]):
            best[c] = (wins, n, spread, p)
        if p not in plan_best or (n, wins) > (plan_best[p][1], plan_best[p][0]):
            plan_best[p] = (wins, n, spread, c)

    ranked = sorted(
        best.items(),
        key=lambda kv: -(_shrunk(kv[1][0], kv[1][1], best) + MARKET_TIEBREAK * market_value(kv[0])),
    )
    tiers = _tiers([wins for _, (wins, _, _, _) in ranked])
    lookahead = gone_before_next_turn(state, punts)
    gone = lookahead["gone"]

    options = []
    for (c, (wins, n, spread, punt)), tier in zip(ranked, tiers):
        punts_ = {punt} if punt else set()
        at_next = continue_draft(state, punts_, take=c, stop_before_user_turn=True)
        options.append(
            {
                "playerId": c,
                "punt": punt,  # None: no punt
                "keepsPunt": punt == current,
                "wins": round(wins, 1),
                "runs": n,
                "winsRange": [round(spread[0], 1), round(spread[1], 1)] if spread else None,
                "tier": tier,  # 1 = within TIE_WINS of the best
                "gone": gone.get(c),  # share of look-ahead runs in which he is drafted before the user's next turn
                "finishRanks": finals.get((c, (punt,) if punt else ())),  # in the draft's own seed
                "nextOptions": best_fit(at_next, slot, punts_, NEXT_OPTIONS),
                "why": pairing_reason(state, c, punt),
            }
        )

    # The best player under each plan, as the build alternatives.
    top_wins = ranked[0][1][0] if ranked else 0.0
    builds = []
    for p in [None, *PUNT_OPTIONS]:
        if p not in plan_best:
            continue
        wins, n, spread, c = plan_best[p]
        builds.append(
            {
                "punt": p,
                "playerId": c,
                "wins": round(wins, 1),
                "runs": n,
                "winsRange": [round(spread[0], 1), round(spread[1], 1)] if spread else None,
                "behind": round(top_wins - wins, 1),  # wins given up against the best option
                "keepsPunt": p == current,
            }
        )
    builds.sort(key=lambda b: -b["wins"])

    # The market's pick here, as a yardstick.
    consensus = None
    consensus_id = top_of_board(state, 1)[0]
    if consensus_id in best:
        c_wins, c_runs, _, c_punt = best[consensus_id]
        consensus = {"playerId": consensus_id, "wins": round(c_wins, 1), "punt": c_punt, "runs": c_runs}

    return {
        "pick": pick,
        "nextPick": lookahead["nextPick"],
        "tieWins": TIE_WINS,
        "tested": len(best),
        "window": len(candidates),
        "consensus": consensus,
        "options": options,
        "builds": builds,
    }


def gone_before_next_turn(
    state: DraftState, punts: set[str], seeds: list[str] | None = None
) -> dict[str, Any]:
    """For every available player, the share of quick look-ahead runs in
    which he is drafted before the user's next turn if the user takes the
    best Fit now (or the runner-up, when he is the best Fit himself). The
    draft room uses it to separate players who must be taken now from
    players who can wait a round."""
    slot = state.config.user_slot
    if current_team_id(state) != slot or is_complete(state):
        return {"nextPick": None, "gone": {}}
    seeds = seeds or sim_seeds(state.config.seed, LOOKAHEAD_SEEDS)
    first_choices = best_fit(state, slot, punts, 2)
    available = available_player_ids(state, PLAYER_POOL)
    taken_count: dict[str, int] = {pid: 0 for pid in available}
    runs_for: dict[str, int] = {pid: 0 for pid in available}
    blob = serialize_draft(state)
    next_pick = None
    for choice in first_choices:
        for seed in seeds:
            st = deserialize_draft(blob, PLAYER_POOL)
            if seed != st.config.seed:
                st = replace(st, config=replace(st.config, seed=seed))
            st = continue_draft(st, punts, take=choice, stop_before_user_turn=True)
            next_pick = len(st.picks) + 1
            gone = drafted_set(st)
            for pid in available:
                if pid == choice:
                    continue  # his own fate is read from the other choice's runs
                runs_for[pid] += 1
                taken_count[pid] += pid in gone
    return {
        "nextPick": next_pick,
        "gone": {pid: taken_count[pid] / runs_for[pid] for pid in available if runs_for[pid]},
    }


def suggestions(state: DraftState, punts: list[str]) -> dict[str, Any]:
    """Build options for the user's current turn, if it is one of the first
    two. Cached per (seed, slot, user picks, punts, pick index)."""
    slot = state.config.user_slot
    mine = [p.player_id for p in state.picks if p.team_id == slot]
    if current_team_id(state) != slot or len(mine) >= 2:
        return {"stage": None, "options": []}
    key = (state.config.seed, slot, tuple(mine), tuple(sorted(punts)), len(state.picks))
    if key not in _CACHE:
        _CACHE[key] = {
            "stage": "first" if not mine else "second",
            **build_options(state, set(punts), executor=_executor()),
        }
    return _CACHE[key]
