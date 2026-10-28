"""Bot drafters.

choose_bot_pick is pure selection: the bot sees only the current draft
state — no future picks leak in.

  S(p,t) = Σ w(t,c)·v(p,c) + ρ_t·[Σ w(t,c)·h(p,c) − Σ w(t,c)·v(p,c)] + ε

w(t,c) starts from the market's category weights (market.py) — bots pay
for categories the way real drafters do, not the way the scoresheet counts
them — and a punt bot zeroes one category, a needs bot tilts toward its
deficits. v is the player's availability-adjusted value, h his value if he
played every game, so the bracket is what injury risk costs him under this
bot's weights (floored at zero: a below-replacement player loses nothing by
sitting, and there is nothing to gamble on). ρ_t is the bot's risk
appetite: a cautious bot (ρ < 0) doubles down on the discount, a bold one
(ρ > 0) shrugs off half of it, like the drafter who always gambles on the
hurt star. Unsigned players get no such treatment — being on no roster is
not injury risk. ε is small noise derived from (seed, pick_index, team,
player).
"""

from __future__ import annotations

from operator import mul

from ..analysis.category_weights import needs_weights, punt_bot_weights
from ..analysis.market import MARKET_WEIGHTS
from ..analysis.player_values import (
    CategoryWeights,
    CategoryZ,
    score_player,
)
from .draft import DraftState, available_player_ids
from .random import centered_random, seeded_pick, unit_random
from .types import BOT_RISKS, CATEGORIES, BotSpec, Player

# Scale of seeded jitter — reorders near-ties without reaching deep.
EPSILON_SCALE = 0.6

# ρ by risk appetite: share of the availability discount a bot adds back
# (bold) or piles on (cautious).
RISK_TILT = {"cautious": -0.5, "neutral": 0.0, "bold": 0.5}


def _epsilon(seed: str, pick_index: int, team_id: int, player_id: str) -> float:
    return centered_random(seed, "eps", pick_index, team_id, player_id) * EPSILON_SCALE


# Category z's as tuples in CATEGORIES order, cached per values dict, so a
# bot pick is a few thousand dot products rather than dict lookups. Keyed by
# identity: the dicts are module-level constants.
_TUPLES: dict[int, tuple[object, dict[str, tuple[float, ...]]]] = {}


def _as_tuples(values: dict[str, CategoryZ]) -> dict[str, tuple[float, ...]]:
    hit = _TUPLES.get(id(values))
    if hit is None or hit[0] is not values:
        hit = (values, {pid: tuple(z[c] for c in CATEGORIES) for pid, z in values.items()})
        _TUPLES[id(values)] = hit
    return hit[1]


_COSTS: dict[tuple[int, int], tuple[object, object, dict[str, tuple[float, ...]]]] = {}


def _cost_tuples(
    values: dict[str, CategoryZ], healthy: dict[str, CategoryZ]
) -> dict[str, tuple[float, ...]]:
    """h - v per category: what availability costs, before weighting."""
    key = (id(values), id(healthy))
    hit = _COSTS.get(key)
    if hit is None or hit[0] is not values or hit[1] is not healthy:
        hit = (
            values,
            healthy,
            {
                pid: tuple(healthy[pid][c] - z[c] for c in CATEGORIES)
                for pid, z in values.items()
                if pid in healthy
            },
        )
        _COSTS[key] = hit
    return hit[2]


class _Shape:
    """What needs_weights reads off a roster: size and per-slot z. Summed
    in roster order from the z tuples, so it equals build_roster_profile's
    per_slot_z to the bit, without the stat totals a bot never looks at."""

    __slots__ = ("size", "per_slot_z")

    def __init__(self, roster: tuple[str, ...], zt: dict[str, tuple[float, ...]]):
        self.size = len(roster)
        sums = [0.0] * len(CATEGORIES)
        for pid in roster:
            z = zt.get(pid)
            if z is None:
                continue
            for i, v in enumerate(z):
                sums[i] += v
        denom = max(self.size, 1)
        self.per_slot_z = {c: sums[i] / denom for i, c in enumerate(CATEGORIES)}


def bot_weights(
    state: DraftState,
    pool: dict[str, Player],
    values: dict[str, CategoryZ],
    team_id: int,
) -> CategoryWeights:
    """The w_{t,c} term for a bot team at the current draft state."""
    spec = state.config.bot_specs[team_id]
    if spec.kind == "value":
        return dict(MARKET_WEIGHTS)
    if spec.kind == "punt":
        return punt_bot_weights(spec.punt_category or "TO", MARKET_WEIGHTS)
    if spec.kind == "needs":
        zt = _as_tuples(values)
        shapes = [_Shape(roster, zt) for roster in state.rosters]
        return needs_weights(shapes, team_id, MARKET_WEIGHTS)  # type: ignore[arg-type]
    raise ValueError(f"unknown bot kind {spec.kind}")


# Base scores per player for a fixed (weights, tilt) — value and punt bots
# use the same weights all draft, so their scores are computed once.
_SCORES: dict[tuple, dict[str, float]] = {}
_SCORES_MAX = 64


def _base_scores(
    wt: tuple[float, ...],
    tilt: float,
    pool: dict[str, Player],
    zt: dict[str, tuple[float, ...]],
    ct: dict[str, tuple[float, ...]] | None,
    cache: bool,
) -> dict[str, float]:
    key = (wt, tilt, id(zt), id(ct))
    hit = _SCORES.get(key) if cache else None
    if hit is not None:
        return hit
    scores: dict[str, float] = {}
    for pid, z in zt.items():
        s = sum(map(mul, wt, z))
        if ct is not None and pool[pid].signed:
            c = ct.get(pid)
            if c is not None:
                s += tilt * max(0.0, sum(map(mul, wt, c)))
        scores[pid] = s
    if cache:
        if len(_SCORES) >= _SCORES_MAX:
            _SCORES.clear()
        _SCORES[key] = scores
    return scores


def risk_adjustment(
    spec: BotSpec,
    z: CategoryZ,
    healthy: CategoryZ | None,
    w: CategoryWeights,
) -> float:
    """ρ_t times what availability costs this player under weights w."""
    tilt = RISK_TILT.get(spec.risk, 0.0)
    if not tilt or healthy is None:
        return 0.0
    cost = max(0.0, score_player(healthy, w) - score_player(z, w))
    return tilt * cost


def choose_bot_pick(
    state: DraftState,
    pool: dict[str, Player],
    values: dict[str, CategoryZ],
    team_id: int,
    healthy_values: dict[str, CategoryZ] | None = None,
) -> str:
    """Best available player for this bot. Without healthy_values (the
    full-health z's from PoolStats) every bot drafts risk-neutral."""
    spec = state.config.bot_specs[team_id]
    w = bot_weights(state, pool, values, team_id)
    wt = tuple(w[c] for c in CATEGORIES)
    zt = _as_tuples(values)
    tilt = RISK_TILT.get(spec.risk, 0.0) if healthy_values is not None else 0.0
    ct = _cost_tuples(values, healthy_values) if tilt else None

    # Base score for everyone; the seeded jitter only for players close
    # enough to the leader that it could change the answer (it is bounded
    # by ±EPSILON_SCALE/2), which is the same pick with far fewer hashes.
    scores = _base_scores(wt, tilt, pool, zt, ct, cache=spec.kind != "needs")
    base: list[tuple[float, str]] = []
    for pid in available_player_ids(state, pool):
        s = scores.get(pid)
        if s is None:
            continue
        base.append((s, pid))
    if not base:
        raise RuntimeError("No available players to draft")
    lead = max(base)[0]
    pick_index = len(state.picks)
    seed = state.config.seed
    best_id: str | None = None
    best_score = float("-inf")
    for s, pid in base:
        if s < lead - EPSILON_SCALE:
            continue
        s += _epsilon(seed, pick_index, team_id, pid)
        if s > best_score:
            best_score = s
            best_id = pid
    assert best_id is not None
    return best_id


def _seeded_split(seed: str, tag: str, options: list[str], n: int) -> list[str]:
    """n labels, as evenly split over options as possible, in a seeded order."""
    labels = [options[i % len(options)] for i in range(n)]
    # Deterministic Fisher-Yates shuffle.
    for i in range(len(labels) - 1, 0, -1):
        j = int(unit_random(seed, tag, i) * (i + 1))
        labels[i], labels[j] = labels[j], labels[i]
    return labels


def assign_bot_specs(seed: str, num_teams: int, user_slot: int) -> tuple[BotSpec, ...]:
    """Deterministically assign personalities to all non-user slots —
    roughly even split of strategies and of risk appetites, independently;
    punt bots get a seeded category up front."""
    bot_slots = [t for t in range(num_teams) if t != user_slot]
    kinds = _seeded_split(seed, "kindshuffle", ["value", "needs", "punt"], len(bot_slots))
    risks = _seeded_split(seed, "riskshuffle", BOT_RISKS, len(bot_slots))

    specs: list[BotSpec] = [BotSpec(kind="value")] * num_teams
    for team_id, kind, risk in zip(bot_slots, kinds, risks):
        if kind == "punt":
            cat = seeded_pick(list(CATEGORIES), seed, "puntcat", team_id)
            specs[team_id] = BotSpec(kind="punt", punt_category=cat, risk=risk)
        else:
            specs[team_id] = BotSpec(kind=kind, risk=risk)
    return tuple(specs)
