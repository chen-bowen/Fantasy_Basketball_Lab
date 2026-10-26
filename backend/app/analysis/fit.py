"""Fit: a player's value re-weighted for what one team needs right now.

Fit = sum_c w_c * z_c, where w is the draft weights times the needs
multipliers (boost the categories the team trails the field in, capped),
with punted categories zeroed. With an empty roster there are no needs
yet, so Fit is plain value minus the punts.
"""

from __future__ import annotations

from .category_weights import needs_multipliers
from .player_values import DRAFT_WEIGHTS, CategoryWeights, CategoryZ, score_player
from .roster_profile import RosterProfile

# A category counts as "needed" when its needs multiplier is at least this high.
NEED_THRESHOLD = 1.1


def fit_multipliers(profiles: list[RosterProfile], team_id: int) -> CategoryWeights:
    return needs_multipliers(profiles, team_id)


def fit_weights(
    profiles: list[RosterProfile], team_id: int, punts: set[str]
) -> CategoryWeights:
    m = fit_multipliers(profiles, team_id)
    w = {c: DRAFT_WEIGHTS[c] * m[c] for c in DRAFT_WEIGHTS}
    for c in punts:
        w[c] = 0.0
    return w


def fit_score(z: CategoryZ, weights: CategoryWeights) -> float:
    return score_player(z, weights)


def needed_categories(multipliers: CategoryWeights) -> list[str]:
    return [c for c, m in multipliers.items() if m >= NEED_THRESHOLD]
