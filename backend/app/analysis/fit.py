"""Fit: which player to take at this pick, for this roster.

Two ideas, both about not wasting a pick.

1. Candidates are the players the draft expects to go around this pick
   (`candidate_window`): market rank within WINDOW_ROUNDS of the current
   pick, and never fewer than MIN_CANDIDATES of the best available. A
   specialist who will still be on the board two rounds from now is never
   the right pick now, however well he fits — take the player who won't be
   there, and pick the specialist up when his turn comes. Fit ranks the
   candidates; everyone else is shown, but not recommended.

2. Fit = sum_c w_c * z_c, where w_c is how much a z-unit in category c
   can still move this team's head-to-head record (`fit_weights`). Under
   the standings model (standings.py) that is the normal density of the
   projected end-of-draft gap against each opponent, divided by the
   category's week-to-week noise, averaged over opponents:

       w_c  ∝  mean_o  φ(gap_{c,o} / s_c) / s_c

   The 1/s_c factor is the worth of a z-unit in a reliable category over
   a noisy one — with an empty roster every gap is zero and Fit is exactly
   market value (market.py), the same yardstick as the Value column. The
   density is the roster's shape: against each opponent the team is
   either in the fight for a category, has it locked up, or is out of
   reach, and only the first is worth spending a pick on. So a roster
   hopeless in steals is not steered into steals specialists, and one
   that owns blocks is not told to keep buying them. The gap is projected
   by the share of the roster drafted so far: after one pick nothing is
   settled and Fit is still market value; by the late rounds it is
   pointed at the categories still up for grabs. Punted categories are
   zeroed and the rest renormalized, so Fit stays on Value's scale and
   "Fit above Value" means this roster makes him worth more than his price.
"""

from __future__ import annotations

from math import exp, pi, sqrt

from ..engine.types import CATEGORIES, Category
from .market import MARKET_WEIGHTS
from .player_values import CategoryWeights, CategoryZ, score_player
from .roster_profile import RosterProfile
from .standings import NOISE

# --- candidate window -----------------------------------------------------

# A candidate's market rank may run this many rounds past the current pick.
WINDOW_ROUNDS = 1.5
# ...but the window always holds at least this many of the best available.
MIN_CANDIDATES = 10

# --- weights ---------------------------------------------------------------

# The gap is judged against this share of the weekly noise: the question
# here is whether a category is still in play for the season, not who wins
# it this week, and Fit should have an opinion by mid-draft.
SWING_SCALE = 2 / 3
# Bounds on the swing multiplier (the shape term, on top of market weight):
# enough to point Fit at the categories in play, not enough to make a
# one-category specialist the best player.
MIN_SWING = 0.5
MAX_SWING = 1.6
# A category counts as a focus / a settled one at these multipliers.
NEED_THRESHOLD = 1.1
SETTLED_THRESHOLD = 0.8


def window_max_rank(pick_number: int, num_teams: int) -> int:
    """Highest market rank a candidate may have at this pick (1-based)."""
    return pick_number + round(WINDOW_ROUNDS * num_teams)


def candidate_window(
    available: list[str],
    values: dict[str, CategoryZ],
    pick_number: int,
    num_teams: int,
    market_rank: dict[str, int] | None = None,
) -> list[str]:
    """Available players the draft expects to go around this pick, best
    market value first. `market_rank` is the pool-wide rank (1 = best);
    without it, ranks are computed from `values` over the pool."""
    if market_rank is None:
        market_rank = market_ranks(values)
    board = sorted(available, key=lambda pid: market_rank.get(pid, 10**9))
    limit = window_max_rank(pick_number, num_teams)
    n = sum(1 for pid in board if market_rank.get(pid, 10**9) <= limit)
    return board[: max(n, MIN_CANDIDATES)]


def market_ranks(values: dict[str, CategoryZ]) -> dict[str, int]:
    mv = {pid: score_player(z, MARKET_WEIGHTS) for pid, z in values.items()}
    return {pid: i + 1 for i, pid in enumerate(sorted(mv, key=lambda p: -mv[p]))}


def _pdf(x: float) -> float:
    return exp(-0.5 * x * x) / sqrt(2 * pi)


def swing_multipliers(
    profiles: list[RosterProfile],
    team_id: int,
    live: list[Category],
    roster_size: int,
) -> dict[Category, float]:
    """The shape term: how contested each live category still is for this
    team, relative to the others (mean 1, clamped). 1 everywhere until the
    roster has a shape."""
    team = profiles[team_id]
    opponents = [p for i, p in enumerate(profiles) if i != team_id and p.size > 0]
    if team.size == 0 or not opponents or not live:
        return {c: 1.0 for c in live}
    share = min(1.0, team.size / roster_size)  # how much of the roster is known
    density: dict[Category, float] = {}
    for c in live:
        s = SWING_SCALE * NOISE[c]
        gaps = ((team.per_slot_z[c] - o.per_slot_z[c]) * share for o in opponents)
        density[c] = sum(_pdf(g / s) for g in gaps) / len(opponents)
    mean = sum(density.values()) / len(live)
    if not mean:
        return {c: 1.0 for c in live}
    return {c: min(MAX_SWING, max(MIN_SWING, density[c] / mean)) for c in live}


def fit_shape(
    profiles: list[RosterProfile],
    team_id: int,
    punts: set[str],
    roster_size: int = 13,
) -> tuple[CategoryWeights, dict[Category, float]]:
    """(weights, swing): market weight × swing multiplier per category, with
    punts zeroed and the rest renormalized to the market's scale (mean 1);
    and the swing multipliers themselves, for explaining the weights."""
    live: list[Category] = [c for c in CATEGORIES if c not in punts]
    w: CategoryWeights = {c: 0.0 for c in CATEGORIES}
    if not live:
        return w, {}
    swing = swing_multipliers(profiles, team_id, live, roster_size)
    raw = {c: MARKET_WEIGHTS[c] * swing[c] for c in live}
    scale = len(live) / sum(raw.values())
    for c in live:
        w[c] = raw[c] * scale
    return w, swing


def fit_weights(
    profiles: list[RosterProfile],
    team_id: int,
    punts: set[str],
    roster_size: int = 13,
) -> CategoryWeights:
    return fit_shape(profiles, team_id, punts, roster_size)[0]


def fit_score(z: CategoryZ, weights: CategoryWeights) -> float:
    return score_player(z, weights)


def needed_categories(swing: dict[Category, float]) -> list[str]:
    """Categories Fit counts more than the market does — still up for grabs."""
    return [c for c in CATEGORIES if swing.get(c, 1.0) >= NEED_THRESHOLD]


def settled_categories(swing: dict[Category, float]) -> list[str]:
    """Categories Fit counts less than the market does — locked up or out of reach."""
    return [c for c in CATEGORIES if c in swing and swing[c] <= SETTLED_THRESHOLD]


def rank_candidates(
    candidates: list[str], values: dict[str, CategoryZ], weights: CategoryWeights
) -> list[str]:
    """Candidates ordered by Fit, best first."""
    return sorted(candidates, key=lambda pid: -fit_score(values[pid], weights))
