"""Category weight construction for bots.

Needs-based weighting is deliberately capped: a bot trailing a category
shifts attention toward it but won't reach for extreme picks.

Both builders take a `base` weight vector: uniform (every category is worth
the same — the scoresheet's view) or the market's (what drafters pay, used
by bots; see market.py). Needs multiply the base, punts zero it.

The user's Fit does not use these: it weighs categories by what a pick
can still swing, not by the size of the deficit (see fit.py).
"""

from __future__ import annotations

from ..engine.types import CATEGORIES, Category
from .player_values import CategoryWeights, UNIFORM_WEIGHTS
from .roster_profile import RosterProfile

NEEDS_GAIN = 0.45  # how strongly a deficit translates into weight
MIN_WEIGHT = 0.6
MAX_WEIGHT = 2.0


def _mean_per_slot_z(
    profiles: list[RosterProfile], exclude_team: int
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


def needs_weights(
    profiles: list[RosterProfile],
    team_id: int,
    base: CategoryWeights = UNIFORM_WEIGHTS,
) -> CategoryWeights:
    """Start from `base`, push weight toward categories where the team's
    per-slot z trails the field — multiplier capped to [MIN_WEIGHT, MAX_WEIGHT]."""
    team = profiles[team_id]
    if team.size == 0:
        return dict(base)
    field = _mean_per_slot_z(profiles, team_id)
    w: CategoryWeights = {}
    for c in CATEGORIES:
        deficit = field[c] - team.per_slot_z[c]  # >0 means weaker
        w[c] = base[c] * min(MAX_WEIGHT, max(MIN_WEIGHT, 1 + NEEDS_GAIN * deficit))
    return w


def punt_bot_weights(
    punt_category: Category, base: CategoryWeights = UNIFORM_WEIGHTS
) -> CategoryWeights:
    """Punt drafter: the assigned category is ignored entirely."""
    w = dict(base)
    w[punt_category] = 0.0
    return w
