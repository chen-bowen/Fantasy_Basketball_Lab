"""Rival drafters.

autopilot_pick is pure selection: the rival sees only the current draft
state — no future picks leak in.

  S(p,t) = Σ w(t,c)·v(p,c) + ρ_t·[Σ w(t,c)·h(p,c) − Σ w(t,c)·v(p,c)] + ε

w(t,c) starts from the market's category weights (market.py) — rivals pay
for categories the way real drafters do, not the way the scoresheet counts
them — and a concede rival zeroes one category, a needs rival tilts toward its
deficits. v is the player's availability-adjusted value, h his value if he
played every game, so the bracket is what injury lean costs him under this
rival's weights (floored at zero: a below-replacement player loses nothing by
sitting, and there is nothing to gamble on). ρ_t is the rival's lean
appetite: a cautious rival (ρ < 0) doubles down on the discount, a bold one
(ρ > 0) shrugs off half of it, like the drafter who always gambles on the
hurt star. Unsigned players get no such treatment — being on no roster is
not injury lean. ε is small noise derived from (seed, pick_index, team,
player).
"""

from __future__ import annotations

from operator import mul

from ..metrics.weighting import shortfall_weights, rival_concede_weights
from ..metrics.board import BOARD_WEIGHTS
from ..metrics.ratings import (
    CatWeights,
    CatScores,
    line_score,
)
from .session import Session, undrafted_ids
from .entropy import centered_u, draw_seeded, unit_u
from .model import RIVAL_LEANS, CATEGORIES, RivalSpec, Player

# Scale of seeded jitter — reorders near-ties without reaching deep.
JITTER_SCALE = 0.6

# ρ by lean appetite: share of the availability discount a rival adds back
# (bold) or piles on (cautious).
LEAN_OF_RISK = {"cautious": -0.5, "neutral": 0.0, "bold": 0.5}


def _epsilon(seed: str, pick_index: int, squad: int, pid: str) -> float:
    return centered_u(seed, "eps", pick_index, squad, pid) * JITTER_SCALE


# Category z's as tuples in CATEGORIES order, cached per values dict, so a
# rival pick is a few thousand dot products rather than dict lookups. Keyed by
# identity: the dicts are module-level constants.
_TUPLES: dict[int, tuple[object, dict[str, tuple[float, ...]]]] = {}


def _as_tuples(values: dict[str, CatScores]) -> dict[str, tuple[float, ...]]:
    hit = _TUPLES.get(id(values))
    if hit is None or hit[0] is not values:
        hit = (values, {pid: tuple(z[c] for c in CATEGORIES) for pid, z in values.items()})
        _TUPLES[id(values)] = hit
    return hit[1]


_COSTS: dict[tuple[int, int], tuple[object, object, dict[str, tuple[float, ...]]]] = {}


def _cost_tuples(
    values: dict[str, CatScores], healthy: dict[str, CatScores]
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
    """What shortfall_weights reads off a roster: size and per-slot z. Summed
    in roster order from the z tuples, so it equals roster_line's
    per_slot_z to the bit, without the stat totals a rival never looks at."""

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


def autopilot_weights(
    state: Session,
    pool: dict[str, Player],
    values: dict[str, CatScores],
    squad: int,
) -> CatWeights:
    """The w_{t,c} term for a rival team at the current draft state."""
    spec = state.config.rivals[squad]
    if spec.style == "value":
        return dict(BOARD_WEIGHTS)
    if spec.style == "concede":
        return rival_concede_weights(spec.concede_cat or "TO", BOARD_WEIGHTS)
    if spec.style == "needs":
        zt = _as_tuples(values)
        shapes = [_Shape(roster, zt) for roster in state.squads]
        return shortfall_weights(shapes, squad, BOARD_WEIGHTS)  # type: ignore[arg-type]
    raise ValueError(f"unknown rival style {spec.style}")


# Base scores per player for a fixed (weights, tilt) — value and concede rivals
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


def risk_lean(
    spec: RivalSpec,
    z: CatScores,
    healthy: CatScores | None,
    w: CatWeights,
) -> float:
    """ρ_t times what availability costs this player under weights w."""
    tilt = LEAN_OF_RISK.get(spec.lean, 0.0)
    if not tilt or healthy is None:
        return 0.0
    cost = max(0.0, line_score(healthy, w) - line_score(z, w))
    return tilt * cost


def autopilot_pick(
    state: Session,
    pool: dict[str, Player],
    values: dict[str, CatScores],
    squad: int,
    healthy_values: dict[str, CatScores] | None = None,
) -> str:
    """Best available player for this rival. Without healthy_values (the
    full-health z's from Baseline) every rival drafts lean-neutral."""
    spec = state.config.rivals[squad]
    w = autopilot_weights(state, pool, values, squad)
    wt = tuple(w[c] for c in CATEGORIES)
    zt = _as_tuples(values)
    tilt = LEAN_OF_RISK.get(spec.lean, 0.0) if healthy_values is not None else 0.0
    ct = _cost_tuples(values, healthy_values) if tilt else None

    # Base score for everyone; the seeded jitter only for players close
    # enough to the leader that it could change the answer (it is bounded
    # by ±JITTER_SCALE/2), which is the same pick with far fewer hashes.
    scores = _base_scores(wt, tilt, pool, zt, ct, cache=spec.style != "needs")
    base: list[tuple[float, str]] = []
    for pid in undrafted_ids(state, pool):
        s = scores.get(pid)
        if s is None:
            continue
        base.append((s, pid))
    if not base:
        raise RuntimeError("No available players to draft")
    lead = max(base)[0]
    pick_index = len(state.selections)
    seed = state.config.seed
    best_id: str | None = None
    best_score = float("-inf")
    for s, pid in base:
        if s < lead - JITTER_SCALE:
            continue
        s += _epsilon(seed, pick_index, squad, pid)
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
        j = int(unit_u(seed, tag, i) * (i + 1))
        labels[i], labels[j] = labels[j], labels[i]
    return labels


def deal_rivals(seed: str, teams: int, seat: int) -> tuple[RivalSpec, ...]:
    """Deterministically assign personalities to all non-user slots —
    roughly even split of strategies and of lean appetites, independently;
    concede rivals get a seeded category up front."""
    rival_seats = [t for t in range(teams) if t != seat]
    styles = _seeded_split(seed, "kindshuffle", ["value", "needs", "concede"], len(rival_seats))
    leans = _seeded_split(seed, "riskshuffle", RIVAL_LEANS, len(rival_seats))

    specs: list[RivalSpec] = [RivalSpec(style="value")] * teams
    for squad, style, lean in zip(rival_seats, styles, leans):
        if style == "concede":
            cat = draw_seeded(list(CATEGORIES), seed, "puntcat", squad)
            specs[squad] = RivalSpec(style="concede", concede_cat=cat, lean=lean)
        else:
            specs[squad] = RivalSpec(style=style, lean=lean)
    return tuple(specs)
