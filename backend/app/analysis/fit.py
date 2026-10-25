"""Fit: a player's value re-weighted for what one team needs right now.

Fit = sum_c w_c * z_c, where w starts from the needs weighting (boost the
categories the team trails the field in, capped) and punted categories are
zeroed. With an empty roster there are no needs yet, so Fit is plain value
minus the punts.
"""

from __future__ import annotations

from .category_weights import needs_weights
from .player_values import CategoryWeights, CategoryZ, UNIFORM_WEIGHTS, score_player
from .roster_profile import RosterProfile

# A category counts as "needed" when its needs weight is at least this high.
NEED_THRESHOLD = 1.1


def fit_weights(
    profiles: list[RosterProfile], team_id: int, punts: set[str]
) -> CategoryWeights:
    if profiles[team_id].size == 0:
        w = dict(UNIFORM_WEIGHTS)
    else:
        w = needs_weights(profiles, team_id)
    for c in punts:
        w[c] = 0.0
    return w


def fit_score(z: CategoryZ, weights: CategoryWeights) -> float:
    return score_player(z, weights)


def needed_categories(weights: CategoryWeights) -> list[str]:
    return [c for c, w in weights.items() if w >= NEED_THRESHOLD]
