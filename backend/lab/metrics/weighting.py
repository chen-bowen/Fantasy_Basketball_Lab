"""Category weight construction for rivals.

Needs-based weighting is deliberately capped: a rival trailing a category
shifts attention toward it but won't reach for extreme picks.

Both builders take a `base` weight vector: uniform (every category is worth
the same — the scoresheet's view) or the market's (what drafters pay, used
by rivals; see board.py). Needs multiply the base, concedes zero it.

The user's Fit does not use these: it weighs categories by what a pick
can still swing, not by the size of the deficit (see shape.py).
"""

from __future__ import annotations

from ..domain.model import CATEGORIES, Category
from .ratings import CatWeights, EVEN_WEIGHTS
from .profile import RosterLine

DEFICIT_GAIN = 0.45  # how strongly a deficit translates into weight
WEIGHT_FLOOR = 0.6
WEIGHT_CAP = 2.0


def _mean_per_slot_z(
    profiles: list[RosterLine], exclude_team: int
) -> dict[Category, float]:
    """League-average per-slot z across the other teams' current rosters."""
    acc = {c: 0.0 for c in CATEGORIES}
    n = 0
    for i, p in enumerate(profiles):
        if i == exclude_team or p.size == 0:
            continue
        n += 1
        for c in CATEGORIES:
            acc[c] += p.per_slot_z[c]
    if n:
        for c in CATEGORIES:
            acc[c] /= n
    return acc


def shortfall_weights(
    profiles: list[RosterLine],
    squad: int,
    base: CatWeights = EVEN_WEIGHTS,
) -> CatWeights:
    """Start from `base`, push weight toward categories where the team's
    per-slot z trails the field — multiplier capped to [WEIGHT_FLOOR, WEIGHT_CAP]."""
    team = profiles[squad]
    if team.size == 0:
        return dict(base)
    field = _mean_per_slot_z(profiles, squad)
    w: CatWeights = {}
    for c in CATEGORIES:
        deficit = field[c] - team.per_slot_z[c]  # >0 means weaker
        w[c] = base[c] * min(WEIGHT_CAP, max(WEIGHT_FLOOR, 1 + DEFICIT_GAIN * deficit))
    return w


def rival_concede_weights(
    concede_cat: Category, base: CatWeights = EVEN_WEIGHTS
) -> CatWeights:
    """Concede drafter: the assigned category is ignored entirely."""
    w = dict(base)
    w[concede_cat] = 0.0
    return w
