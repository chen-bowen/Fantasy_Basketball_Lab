"""Fit: a player's value re-weighted for what one team needs right now.

Fit = sum_c w_c * z_c. The weight of a category is how much one more
unit of it would move the team's expected head-to-head record — the
gradient of standings.expected_wins, read off the current rosters:

  - Against each opponent, the team's per-slot lead in a category is
    projected to the full roster (the unfilled slots of both teams are
    assumed field-average, so an early deficit is diluted by the picks
    still to come and a late one is nearly final), and the spread of the
    remaining picks widens the matchup noise.
  - The marginal value of the category in that matchup is the density of
    the win probability at that lead — largest when the category is a
    toss-up, small when it is already a lock either way — times the chance
    that it decides the matchup (the other eight split 4–4).
  - Summed over the opponents and normalized to average 1.0, so Fit stays
    on the scale of a plain z sum.

That is what makes Fit neither chase a category the roster can't catch
the pack in (a trailing specialist would move a lost cause by nothing)
nor keep buying one it already owns, while leaning toward the categories
still in play. Punted categories are zeroed. With an empty roster there
is no shape to read, so Fit is plain value minus the punts.

The weights are deliberately *not* sharpened: in simulation the plain
gradient beats every steeper variant (and the old linear needs boost)
on expected wins.
"""

from __future__ import annotations

from math import erf, exp, pi, sqrt

from ..engine.types import CATEGORIES, Category
from .player_values import CategoryWeights, CategoryZ, UNIFORM_WEIGHTS, score_player
from .roster_profile import RosterProfile
from .standings import CATEGORY_NOISE, MAJORITY

# Spread of a single pick's z in a category: one pool standard deviation,
# by construction of the z-scores (drafted players come in at ~1.05).
PICK_SPREAD = 1.0
# Relative weight bounds, so a degenerate league (every matchup decided)
# can't blow a near-zero gradient up into a single-category Fit.
MIN_WEIGHT = 0.5
MAX_WEIGHT = 1.8
# A category counts as "needed" when its weight is at least this high, and
# as one Fit has stopped chasing when it is at most CONCEDE_THRESHOLD.
NEED_THRESHOLD = 1.1
CONCEDE_THRESHOLD = 0.85

_SQRT_2PI = sqrt(2 * pi)


def _pdf(x: float) -> float:
    return exp(-0.5 * x * x) / _SQRT_2PI


def _cdf(x: float) -> float:
    return 0.5 * (1 + erf(x / sqrt(2)))


def _swing_prob(win_probs: list[float]) -> float:
    """P(exactly MAJORITY - 1 wins) among independent categories — the
    chance that one more category win decides the matchup."""
    dist = [1.0]
    for p in win_probs:
        nxt = [0.0] * (len(dist) + 1)
        for k, q in enumerate(dist):
            nxt[k] += q * (1 - p)
            nxt[k + 1] += q * p
        dist = nxt
    k = MAJORITY - 1
    return dist[k] if k < len(dist) else 0.0


def win_gradient(
    profiles: list[RosterProfile], team_id: int, punts: set[str], roster_size: int
) -> dict[Category, float]:
    """d(expected wins) / d(per-pick z) in every category, for the team's
    final roster as projected from the rosters drafted so far."""
    team = profiles[team_id]
    n = team.size
    remaining = max(roster_size - n, 0)
    dilution = n / roster_size
    sigma = sqrt(CATEGORY_NOISE**2 + 2 * remaining * PICK_SPREAD**2 / roster_size**2)
    grad = {c: 0.0 for c in CATEGORIES}
    for j, opp in enumerate(profiles):
        if j == team_id or opp.size == 0:
            continue
        lead = {
            c: (team.per_slot_z[c] - opp.per_slot_z[c]) * dilution / sigma
            for c in CATEGORIES
        }
        p_win = {c: (0.0 if c in punts else _cdf(lead[c])) for c in CATEGORIES}
        for c in CATEGORIES:
            if c in punts:
                continue
            others = [p_win[d] for d in CATEGORIES if d != c]
            grad[c] += _pdf(lead[c]) / sigma * _swing_prob(others)
    return grad


def fit_weights(
    profiles: list[RosterProfile],
    team_id: int,
    punts: set[str],
    roster_size: int = 13,
) -> CategoryWeights:
    w: CategoryWeights
    live = [c for c in CATEGORIES if c not in punts]
    if profiles[team_id].size == 0 or not live:
        w = dict(UNIFORM_WEIGHTS)
    else:
        grad = win_gradient(profiles, team_id, punts, roster_size)
        mean = sum(grad[c] for c in live) / len(live)
        if mean <= 0:
            w = dict(UNIFORM_WEIGHTS)
        else:
            w = {c: min(MAX_WEIGHT, max(MIN_WEIGHT, grad[c] / mean)) for c in CATEGORIES}
    for c in punts:
        w[c] = 0.0
    return w


def fit_score(z: CategoryZ, weights: CategoryWeights) -> float:
    return score_player(z, weights)


def needed_categories(weights: CategoryWeights) -> list[str]:
    return [c for c, w in weights.items() if w >= NEED_THRESHOLD]


def category_stances(
    weights: CategoryWeights, profiles: list[RosterProfile], team_id: int, punts: set[str]
) -> dict[Category, str]:
    """How Fit treats each category right now, for the UI:
    "punt" (zeroed), "lean" (weight above NEED_THRESHOLD — a pick moves the
    record most here), "behind" (weight at most CONCEDE_THRESHOLD while the
    team trails the field — too far back to chase), "ahead" (the same while
    it leads — already owned), or "even"."""
    team = profiles[team_id]
    others = [p for i, p in enumerate(profiles) if i != team_id and p.size > 0]
    field = {
        c: (sum(p.per_slot_z[c] for p in others) / len(others) if others else 0.0)
        for c in CATEGORIES
    }
    out: dict[Category, str] = {}
    for c in CATEGORIES:
        if c in punts:
            out[c] = "punt"
        elif weights[c] >= NEED_THRESHOLD:
            out[c] = "lean"
        elif weights[c] <= CONCEDE_THRESHOLD and team.size > 0:
            out[c] = "ahead" if team.per_slot_z[c] >= field[c] else "behind"
        else:
            out[c] = "even"
    return out
