"""Fit: which player to take at this pick, for this roster.

Two ideas, both about not wasting a pick.

1. Candidates are the players the draft expects to go around this pick
   (`board_window`): market rank within WINDOW_DEPTH of the current
   pick, and never fewer than MIN_BOARD of the best available. A
   specialist who will still be on the board two rounds from now is never
   the right pick now, however well he fits — take the player who won't be
   there, and pick the specialist up when his turn comes. Fit ranks the
   candidates; everyone else is shown, but not recommended.

2. Fit = sum_c w_c * z_c, where w_c is how much a z-unit in category c
   can still move this team's head-to-head record (`shape_weights`). Under
   the standings model (standings.py) that is the normal density of the
   projected end-of-draft gap against each opponent, divided by the
   category's week-to-week noise, averaged over opponents:

       w_c  ∝  mean_o  φ(gap_{c,o} / s_c) / s_c

   The 1/s_c factor is the worth of a z-unit in a reliable category over
   a noisy one (standings.WEEK_WEIGHTS): with an empty roster every gap is
   zero and Fit is that worth alone — what wins weeks, which is not quite
   what the draft table pays for. The market (market.py, the Value column
   and the candidate window) discounts turnovers and FT% for being the
   classic concedes; the week-to-week noise says a turnover lead is about as
   safe as a rebounding lead. The window keeps the difference honest:
   Fit only ever chooses among the players the draft expects to go here,
   so "Fit above Value" means the room underprices what he does for a
   head-to-head record, never that a late-round specialist belongs in
   round one. The density is the roster's shape: against each opponent
   the team is either in the fight for a category, has it locked up, or
   is out of reach, and only the first is worth spending a pick on. So a
   roster hopeless in steals is not steered into steals specialists, and
   one that owns blocks is not told to keep buying them. The gap is
   projected by the share of the roster drafted so far: after one pick
   nothing is settled; by the late rounds Fit is pointed at the
   categories still up for grabs. Punted categories are zeroed and the
   rest renormalized, so Fit stays on Value's scale.
"""

from __future__ import annotations

from math import exp, pi, sqrt

from ..domain.model import CATEGORIES, Category
from .board import BOARD_WEIGHTS
from .ratings import CatWeights, CatScores, line_score
from .profile import RosterLine
from .table import WEEK_WEIGHTS, NOISE

# --- candidate window -----------------------------------------------------

# A candidate's market rank may run this many rounds past the current pick.
WINDOW_DEPTH = 1.5
# ...but the window always holds at least this many of the best available.
MIN_BOARD = 10

# --- weights ---------------------------------------------------------------

# The gap is judged against this multiple of the weekly noise: the question
# here is whether a category is still in play for the season, not who wins
# it this week, and Fit should have an opinion by mid-draft. (Tuned at 2/3
# when the noise averaged 1.0 per category; the fitted noise averages about
# half that, so the multiple doubled to keep Fit's resolution where it was.)
SWING_WIDTH = 1.2
# Bounds on the swing multiplier (the shape term, on top of market weight):
# enough to point Fit at the categories in play, not enough to make a
# one-category specialist the best player.
SWING_FLOOR = 0.5
SWING_CAP = 1.6
# A category counts as a focus / a settled one at these multipliers.
LIVE_LINE = 1.1
DECIDED_LINE = 0.8


def window_ceiling(pick_number: int, teams: int) -> int:
    """Highest market rank a candidate may have at this pick (1-based)."""
    return pick_number + round(WINDOW_DEPTH * teams)


def board_window(
    available: list[str],
    values: dict[str, CatScores],
    pick_number: int,
    teams: int,
    market_rank: dict[str, int] | None = None,
) -> list[str]:
    """Available players the draft expects to go around this pick, best
    market value first. `market_rank` is the pool-wide rank (1 = best);
    without it, ranks are computed from `values` over the pool."""
    if market_rank is None:
        market_rank = board_order(values)
    board = sorted(available, key=lambda pid: market_rank.get(pid, 10**9))
    limit = window_ceiling(pick_number, teams)
    n = sum(1 for pid in board if market_rank.get(pid, 10**9) <= limit)
    return board[: max(n, MIN_BOARD)]


def board_order(values: dict[str, CatScores]) -> dict[str, int]:
    mv = {pid: line_score(z, BOARD_WEIGHTS) for pid, z in values.items()}
    return {pid: i + 1 for i, pid in enumerate(sorted(mv, key=lambda p: -mv[p]))}


def _pdf(x: float) -> float:
    return exp(-0.5 * x * x) / sqrt(2 * pi)


def swing(
    profiles: list[RosterLine],
    squad: int,
    live: list[Category],
    squad_size: int,
) -> dict[Category, float]:
    """The shape term: how contested each live category still is for this
    team, relative to the others (mean 1, clamped). 1 everywhere until the
    roster has a shape."""
    team = profiles[squad]
    opponents = [p for i, p in enumerate(profiles) if i != squad and p.size > 0]
    if team.size == 0 or not opponents or not live:
        return {c: 1.0 for c in live}
    share = min(1.0, team.size / squad_size)  # how much of the roster is known
    density: dict[Category, float] = {}
    for c in live:
        s = SWING_WIDTH * NOISE[c]
        gaps = ((team.per_slot_z[c] - o.per_slot_z[c]) * share for o in opponents)
        density[c] = sum(_pdf(g / s) for g in gaps) / len(opponents)
    mean = sum(density.values()) / len(live)
    if not mean:
        return {c: 1.0 for c in live}
    return {c: min(SWING_CAP, max(SWING_FLOOR, density[c] / mean)) for c in live}


def shape_frame(
    profiles: list[RosterLine],
    squad: int,
    concedes: set[str],
    squad_size: int = 13,
) -> tuple[CatWeights, dict[Category, float]]:
    """(weights, swing): head-to-head worth × swing multiplier per category,
    with concedes zeroed and the rest renormalized to the market's scale (mean 1);
    and the swing multipliers themselves, for explaining the weights."""
    live: list[Category] = [c for c in CATEGORIES if c not in concedes]
    w: CatWeights = {c: 0.0 for c in CATEGORIES}
    if not live:
        return w, {}
    multi = swing(profiles, squad, live, squad_size)
    raw = {c: WEEK_WEIGHTS[c] * multi[c] for c in live}
    scale = len(live) / sum(raw.values())
    for c in live:
        w[c] = raw[c] * scale
    return w, multi


def shape_weights(
    profiles: list[RosterLine],
    squad: int,
    concedes: set[str],
    squad_size: int = 13,
) -> CatWeights:
    return shape_frame(profiles, squad, concedes, squad_size)[0]


def shape_score(z: CatScores, weights: CatWeights) -> float:
    return line_score(z, weights)


def in_play(swing: dict[Category, float]) -> list[str]:
    """Categories Fit counts more than the market does — still up for grabs."""
    return [c for c in CATEGORIES if swing.get(c, 1.0) >= LIVE_LINE]


def decided(swing: dict[Category, float]) -> list[str]:
    """Categories Fit counts less than the market does — locked up or out of reach."""
    return [c for c in CATEGORIES if c in swing and swing[c] <= DECIDED_LINE]


def order_candidates(
    candidates: list[str], values: dict[str, CatScores], weights: CatWeights
) -> list[str]:
    """Candidates ordered by Fit, best first."""
    return sorted(candidates, key=lambda pid: -shape_score(values[pid], weights))
