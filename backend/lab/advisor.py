"""Build advise for the user's first two picks, found by simulation.

The first two picks decide which category a team can concede. For every
player in range at the pick (the candidate window) and every concede that
suits the roster-plus-him, we play the rest of the draft out several times
from the actual current state: the candidate is taken on the spot, every
later user pick takes the best Fit under that concede, and rivals draft as
usual. Each run is scored by the expected head-to-head record of the user's
final roster (standings.win_expectation — category leads count by margin). The extra runs reuse this league's rival personalities and only vary
the seed (rival pick noise), so the estimate describes this league, not
drafting in general.

Simulations are CPU-bound and independent, so they fan out over a process
pool; results are cached per draft position.
"""

from __future__ import annotations

import os
from concurrent.futures import Executor, ProcessPoolExecutor
from dataclasses import replace
from typing import Any

from .metrics.shape import board_window, shape_weights, board_order, order_candidates
from .metrics.board import BOARD_WEIGHTS
from .metrics.ratings import score_pool, line_score
from .metrics.profile import roster_line, cat_ranks
from .metrics.table import win_expectation
from .pool.loader import PLAYERS, PLAYER_POOL
from .domain.autopilot import autopilot_pick
from .domain.session import (
    DraftSettings,
    Session,
    record_pick,
    undrafted_ids,
    open_session,
    on_clock,
    session_from,
    taken_ids,
    draft_done,
    session_dict,
)
from .domain.model import CATEGORIES

CONCEDE_OPTIONS = ("AST", "FG%", "FT%", "TO", "3PM")
NEXT_SHORTLIST = 3
SHRUNK_RUNS = 2  # pseudo-runs at the group mean when ordering options

# Every candidate at the pick is tested, in two stages. The screen plays a
# couple of drafts for each (player, concede) combination; then each player's
# best plan, and the best player under each plan, get the full sample. A
# draft costs the same whoever is picked, so this is what lets the
# candidate set be the whole window rather than a shortlist.
SCREEN_RUNS = 2
SIM_RUNS = 8  # drafts per refined option; the on-screen range shows the spread
CANDIDATE_CONCEDES = 2  # concedes tried per candidate, besides no concede
CONCEDE_Z = 0.3  # per-slot z below which a category is weak enough to concede
LOOKAHEAD_RUNS = 10  # quick runs (x2 assumed picks) to the user's next turn, for who will still be there
# Expected wins averaged over the runs still carry a little noise (a 6-run
# average has a standard error of about 0.05 wins). Break near-ties toward
# the player the market rates higher: he is the one who won't still be
# there next turn. Two standard errors per unit of market value means a
# lower-valued option has to win by a margin the sims can actually resolve,
# not by noise — the market only decides what the sims can't separate.
BOARD_TIEBREAK = 0.10  # wins per unit of market value
# Options within this many wins of each other are a toss-up: the sims can
# rank them, but the ranking is not worth a decision. The screen says so.
LEVEL_MARGIN = 0.3

_VALUES, _STATS = score_pool(PLAYERS)
_MARKET_RANK = board_order(_VALUES)
_EXECUTOR: Executor | None = None
_CACHE: dict[tuple, dict[str, Any]] = {}


def _executor() -> Executor:
    global _EXECUTOR
    if _EXECUTOR is None:
        _EXECUTOR = ProcessPoolExecutor(max_workers=min(8, os.cpu_count() or 2))
    return _EXECUTOR


def sim_seed_list(seed: str, n: int = SIM_RUNS) -> list[str]:
    return [seed] + [f"{seed}#sim{i}" for i in range(1, n)]


def _profiles(state: Session):
    return [
        roster_line([PLAYER_POOL[i] for i in r], _VALUES)
        for r in state.squads
    ]


def top_shape(state: Session, squad: int, concedes: set[str], n: int = 1) -> list[str]:
    """The user's pick policy: best Fit among the players the draft expects
    to go around this pick (the candidate window) — the same list the
    draft room recommends, so the simulations play the way the room advises."""
    w = shape_weights(_profiles(state), squad, concedes, state.config.squad_size)
    ids = undrafted_ids(state, PLAYER_POOL)
    window = board_window(
        ids, _VALUES, len(state.selections) + 1, state.config.teams, _MARKET_RANK
    )
    return order_candidates(window, _VALUES, w)[:n]


def project(
    config: DraftSettings,
    fixed: list[str],
    concedes: set[str],
    stop_at_turn: int | None = None,
) -> Session | None:
    """Play a draft out. The user's first picks are `fixed`, later ones take
    the best Fit. Returns None if a fixed player is gone before his turn;
    with stop_at_turn, returns the state when that user turn comes up."""
    state = open_session(config)
    turn = 0
    while not draft_done(state):
        team = on_clock(state)
        if team == config.seat:
            if stop_at_turn is not None and turn == stop_at_turn:
                return state
            if turn < len(fixed):
                if fixed[turn] in taken_ids(state):
                    return None
                pid = fixed[turn]
            else:
                pid = top_shape(state, team, concedes)[0]
            turn += 1
        else:
            pid = autopilot_pick(state, PLAYER_POOL, _VALUES, team, _STATS.healthy_values)
        state = record_pick(state, PLAYER_POOL, pid)
    return state


def play_out(
    state: Session,
    concedes: set[str],
    take: str | None = None,
    stop_before_user_turn: bool = False,
) -> Session:
    """Play out the rest of an in-progress draft. `take` is the user's pick
    on the clock; later user picks take the best Fit under `concedes`, and rivals
    draft as usual. With stop_before_user_turn, returns the state when the
    user's next turn comes up.

    Unlike project(), this starts from the actual draft state, so it works
    even when stored picks were made under different rival logic or player
    values."""
    if take is not None:
        assert on_clock(state) == state.config.seat
        state = record_pick(state, PLAYER_POOL, take)
    while not draft_done(state):
        team = on_clock(state)
        if team == state.config.seat:
            if stop_before_user_turn:
                return state
            pid = top_shape(state, team, concedes)[0]
        else:
            pid = autopilot_pick(state, PLAYER_POOL, _VALUES, team, _STATS.healthy_values)
        state = record_pick(state, PLAYER_POOL, pid)
    return state


def _wins(job: tuple[dict, str, list[str], str]) -> tuple[float, list[int]] | None:
    """Expected duel_card wins (0-11) of the user's final roster — the noisy
    head-to-head view, so comfortable category leads count for more than
    narrow ones and the estimate keeps resolving between good options —
    and the roster's final category ranks."""
    state_dict, take, concedes, seed = job
    state = session_from(state_dict, PLAYER_POOL)
    if seed != state.config.seed:
        state = replace(state, config=replace(state.config, seed=seed))
    final = play_out(state, set(concedes), take=take)
    profiles = _profiles(final)
    slot = state.config.seat
    ranks = cat_ranks(profiles)
    return win_expectation(profiles)[slot], [ranks[c][slot] for c in CATEGORIES]


Combo = tuple[str, tuple[str, ...]]  # (take, concedes)
Runs = dict[Combo, list[float]]  # wins per run
Finals = dict[Combo, list[int]]  # the user's final category ranks in the draft's own seed


def _run_wins(
    state: Session,
    combos: list[tuple[str, list[str]]],
    seeds: list[str],
    executor: Executor | None,
    into: Runs | None = None,
    finals: Finals | None = None,
) -> Runs:
    """Play the real draft forward from its current state under each seed for
    every (take-now, concedes) combo; wins per completed run, merged into `into`.
    With `finals`, the final ranks from the draft's own seed are kept too."""
    blob = session_dict(state)
    jobs = [(blob, take, concedes, s) for take, concedes in combos for s in seeds]
    mapper = executor.map if executor else map
    results = list(mapper(_wins, jobs))
    out: Runs = into if into is not None else {}
    for i, (take, concedes) in enumerate(combos):
        chunk = results[i * len(seeds):(i + 1) * len(seeds)]
        key = (take, tuple(concedes))
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


def roster_concedes(
    state: Session, pid: str, current: str | None
) -> list[str | None]:
    """The plans worth testing for a candidate: no concede, plus the concedable
    categories the roster-plus-him would be genuinely weak in (per-slot z
    below CONCEDE_Z — a concede concedes a category you can't win, not one
    you merely own less than another), and the current plan while it is
    still a legal concede. The incumbent is always tested: two players are a
    poor read on a category's fate, so the simulations — not the weakness
    gate — decide whether the plan survives."""
    slot = state.config.seat
    roster = [*state.squads[slot], pid]
    per_slot = {
        c: sum(_VALUES[pid][c] for pid in roster) / len(roster) for c in CATEGORIES
    }
    weak = sorted((p for p in CONCEDE_OPTIONS if per_slot[p] < CONCEDE_Z), key=lambda p: per_slot[p])
    out: list[str | None] = [None, *weak[:CANDIDATE_CONCEDES]]
    if current in CONCEDE_OPTIONS and current not in out:
        out.append(current)
    return out


def board_value(pid: str) -> float:
    return line_score(_VALUES[pid], BOARD_WEIGHTS)


def board_head(state: Session, n: int) -> list[str]:
    """Best available by market value — what a drafter sees on the clock."""
    ids = undrafted_ids(state, PLAYER_POOL)
    return sorted(ids, key=lambda i: -board_value(i))[:n]


BRINGS_Z = 0.8  # a category a player clearly brings
HURTS_Z = -0.8  # a category a player clearly hurts


def pairing_notes(
    state: Session, pid: str, concede: str | None
) -> dict[str, Any]:
    """Why this player, next to what the user already has: the categories
    he brings that the roster lacks, the roster weaknesses he offsets, what
    he doubles up on, what he costs, how many games he plays, and what the
    market thinks he is worth. Pure roster arithmetic, no simulation."""
    slot = state.config.seat
    roster = [PLAYER_POOL[i] for i in state.squads[slot]]
    have = roster_line(roster, _VALUES).per_slot_z if roster else None
    z = _VALUES[pid]
    adds, patches, spares, overlaps, costs = [], [], [], [], []
    for c in CATEGORIES:
        if c == concede:
            continue
        if z[c] >= BRINGS_Z:
            if have is not None and have[c] >= BRINGS_Z:
                overlaps.append(c)
            else:
                adds.append(c)
        if have is not None and have[c] <= HURTS_Z:
            if z[c] >= 0.5:
                patches.append(c)  # actively offsets a roster weakness
            elif z[c] > -0.3:
                spares.append(c)  # at least doesn't deepen it
        if z[c] <= HURTS_Z:
            costs.append(c)
    ids = undrafted_ids(state, PLAYER_POOL)
    board = sorted(ids, key=lambda i: -board_value(i))
    return {
        "adds": adds,
        "patches": patches,
        "spares": spares,
        "overlaps": overlaps,
        "costs": costs,
        "availability": round(_STATS.avail[pid], 2),
        "marketRank": board.index(pid) + 1 if pid in board else None,
    }


def _user_ranks(state: Session, squad: int) -> list[int]:
    ranks = cat_ranks(_profiles(state))
    return [ranks[c][squad] for c in CATEGORIES]


def _refine(
    state: Session,
    combos: list[tuple[str, str | None]],
    seeds: list[str],
    executor: Executor | None,
    finals: Finals | None = None,
) -> Runs:
    """Stage one plays SCREEN_RUNS drafts per (player, concede) combo; stage
    two plays the remaining seeds for every player's best plan and for the
    best player under each plan, so everything shown has the full sample."""
    as_list = [(c, [p] if p else []) for c, p in combos]
    screen, rest = seeds[:SCREEN_RUNS], seeds[SCREEN_RUNS:]
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
        score = w + BOARD_TIEBREAK * board_value(c)
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
    return (wins * runs + mean * SHRUNK_RUNS) / (runs + SHRUNK_RUNS)


def _tiers(wins: list[float], tie: float = LEVEL_MARGIN) -> list[int]:
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


def frame_options(
    state: Session,
    concedes: set[str],
    seeds: list[str] | None = None,
    executor: Executor | None = None,
) -> dict[str, Any]:
    """Every candidate at this pick, evaluated: the players the draft expects
    to go around here (the window), each under no concede and the concedes that
    suit the roster-plus-him, played out by simulation. One option per
    player (his best plan), tiered at the sims' resolution; the best player
    under each plan as the build alternatives; and the look-ahead's verdict
    on who is gone before the user's next turn. Nothing in range is left
    for 'Browse all players' to find."""
    config = state.config
    slot = config.seat
    seeds = seeds or sim_seed_list(config.seed)
    current = next(iter(concedes), None)
    pick = len(state.selections) + 1

    candidates = board_window(
        undrafted_ids(state, PLAYER_POOL), _VALUES, pick, config.teams, _MARKET_RANK
    )
    combos: list[tuple[str, str | None]] = [
        (c, p) for c in candidates for p in roster_concedes(state, c, current)
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
        key=lambda kv: -(_shrunk(kv[1][0], kv[1][1], best) + BOARD_TIEBREAK * board_value(kv[0])),
    )
    tiers = _tiers([wins for _, (wins, _, _, _) in ranked])
    lookahead = gone_by_turn(state, concedes)
    gone = lookahead["gone"]

    options = []
    for (c, (wins, n, spread, concede)), tier in zip(ranked, tiers):
        concedes_ = {concede} if concede else set()
        at_next = play_out(state, concedes_, take=c, stop_before_user_turn=True)
        options.append(
            {
                "pid": c,
                "concede": concede,  # None: no concede
                "keepsConcede": concede == current,
                "wins": round(wins, 1),
                "runs": n,
                "winsRange": [round(spread[0], 1), round(spread[1], 1)] if spread else None,
                "tier": tier,  # 1 = within LEVEL_MARGIN of the best
                "gone": gone.get(c),  # share of look-ahead runs in which he is drafted before the user's next turn
                "finishRanks": finals.get((c, (concede,) if concede else ())),  # in the draft's own seed
                "nextOptions": top_shape(at_next, slot, concedes_, NEXT_SHORTLIST),
                "why": pairing_notes(state, c, concede),
            }
        )

    # The best player under each plan, as the build alternatives.
    top_wins = ranked[0][1][0] if ranked else 0.0
    builds = []
    for p in [None, *CONCEDE_OPTIONS]:
        if p not in plan_best:
            continue
        wins, n, spread, c = plan_best[p]
        builds.append(
            {
                "concede": p,
                "pid": c,
                "wins": round(wins, 1),
                "runs": n,
                "winsRange": [round(spread[0], 1), round(spread[1], 1)] if spread else None,
                "behind": round(top_wins - wins, 1),  # wins given up against the best option
                "keepsConcede": p == current,
            }
        )
    builds.sort(key=lambda b: -b["wins"])

    # The market's pick here, as a yardstick.
    consensus = None
    consensus_id = board_head(state, 1)[0]
    if consensus_id in best:
        c_wins, c_runs, _, c_punt = best[consensus_id]
        consensus = {"pid": consensus_id, "wins": round(c_wins, 1), "concede": c_punt, "runs": c_runs}

    return {
        "pick": pick,
        "nextPick": lookahead["nextPick"],
        "tieWins": LEVEL_MARGIN,
        "tested": len(best),
        "window": len(candidates),
        "consensus": consensus,
        "options": options,
        "builds": builds,
    }


def gone_by_turn(
    state: Session, concedes: set[str], seeds: list[str] | None = None
) -> dict[str, Any]:
    """For every available player, the share of quick look-ahead runs in
    which he is drafted before the user's next turn if the user takes the
    best Fit now (or the runner-up, when he is the best Fit himself). The
    draft room uses it to separate players who must be taken now from
    players who can wait a round."""
    slot = state.config.seat
    if on_clock(state) != slot or draft_done(state):
        return {"nextPick": None, "gone": {}}
    seeds = seeds or sim_seed_list(state.config.seed, LOOKAHEAD_RUNS)
    first_choices = top_shape(state, slot, concedes, 2)
    available = undrafted_ids(state, PLAYER_POOL)
    taken_count: dict[str, int] = {pid: 0 for pid in available}
    runs_for: dict[str, int] = {pid: 0 for pid in available}
    blob = session_dict(state)
    next_pick = None
    for choice in first_choices:
        for seed in seeds:
            st = session_from(blob, PLAYER_POOL)
            if seed != st.config.seed:
                st = replace(st, config=replace(st.config, seed=seed))
            st = play_out(st, concedes, take=choice, stop_before_user_turn=True)
            next_pick = len(st.selections) + 1
            gone = taken_ids(st)
            for pid in available:
                if pid == choice:
                    continue  # his own fate is read from the other choice's runs
                runs_for[pid] += 1
                taken_count[pid] += pid in gone
    return {
        "nextPick": next_pick,
        "gone": {pid: taken_count[pid] / runs_for[pid] for pid in available if runs_for[pid]},
    }


def advise(state: Session, concedes: list[str]) -> dict[str, Any]:
    """Build options for the user's current turn, if it is one of the first
    two. Cached per (seed, slot, user picks, concedes, pick index)."""
    slot = state.config.seat
    mine = [p.pid for p in state.selections if p.squad == slot]
    if on_clock(state) != slot or len(mine) >= 2:
        return {"stage": None, "options": []}
    key = (state.config.seed, slot, tuple(mine), tuple(sorted(concedes)), len(state.selections))
    if key not in _CACHE:
        _CACHE[key] = {
            "stage": "first" if not mine else "second",
            **frame_options(state, set(concedes), executor=_executor()),
        }
    return _CACHE[key]
