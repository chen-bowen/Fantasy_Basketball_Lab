"""Head-to-head standings from category strengths.

Two views:

  - records(): the deterministic projection. A team "beats" another if it
    ranks better in more of the 9 categories. Equal-games, no variance —
    the standings table in the draft report.

  - expected_wins(): the same matchups with week-to-week noise. A category
    is a coin flip between two even teams and a near-lock when one leads
    by a lot, so the expected record keeps responding to a pick even when
    a team already leads most categories by a hair. This is what the
    suggestion engine optimizes: under the deterministic view a second
    pick that turns five narrow leads into five comfortable ones is worth
    nothing, and every option looks like 11-0.

The noise is not the same in every category. A week of points is hundreds
of events and a per-slot edge there is a real favourite; a week of steals,
free throws or turnovers is a handful, and the same edge is close to a
coin flip. NOISE[c] is the per-slot z gap at which a team is a one-sigma
(84%) favourite in category c, fitted from game-level variance on typical
drafted rosters (scripts/fit_category_noise.py): points about 0.3, steals
and the percentages about 0.9. An earlier version took the noise from the
market's category weights instead (NOISE = 0.75 / w_c); that overstated
the swing in rebounds, threes, FT% and especially turnovers — the market
discounts those for being punted, not for being random — and squeezed
every matchup toward 50%.
"""

from __future__ import annotations

from math import erf, sqrt

from ..engine.types import CATEGORIES, Category
from .roster_profile import RosterProfile

# Per-slot z gap worth one sigma in each category — the output of
# scripts/fit_category_noise.py on the current pool (refit after
# `npm run data:fetch`). Drafted teams sit about 0.3 apart in a typical
# category, which makes a points matchup roughly 85/15 and a steals
# matchup about 64/36.
FITTED_NOISE: dict[Category, float] = {
    "PTS": 0.29,
    "REB": 0.33,
    "AST": 0.30,
    "STL": 0.86,
    "BLK": 0.53,
    "3PM": 0.43,
    "FG%": 0.91,
    "FT%": 0.85,
    "TO": 0.40,
}
NOISE: dict[Category, float] = dict(FITTED_NOISE)
# The average category, for callers that don't name one.
CATEGORY_NOISE = sum(NOISE.values()) / len(NOISE)
# What a z-unit is worth toward winning a week: 1 / noise, scaled to average
# 1.0 like the market weights. The base of the user's Fit (fit.py) — the
# categories a per-slot edge converts into wins most reliably count most.
_inv = {c: 1.0 / NOISE[c] for c in CATEGORIES}
H2H_WEIGHTS: dict[Category, float] = {
    c: _inv[c] * len(CATEGORIES) / sum(_inv.values()) for c in CATEGORIES
}

MAJORITY = len(CATEGORIES) // 2 + 1  # categories needed to win a matchup


def head_to_head(ranks: dict[Category, list[int]], a: int, b: int) -> int:
    """+1 if team a beats b, -1 if b beats a, 0 for a tie."""
    better = sum(1 for c in CATEGORIES if ranks[c][a] < ranks[c][b])
    worse = sum(1 for c in CATEGORIES if ranks[c][a] > ranks[c][b])
    return (better > worse) - (better < worse)


def records(ranks: dict[Category, list[int]]) -> list[dict[str, int]]:
    """Wins / losses / ties for every team against each of the others."""
    n = len(ranks[CATEGORIES[0]])
    out = []
    for a in range(n):
        results = [head_to_head(ranks, a, b) for b in range(n) if b != a]
        out.append(
            {
                "wins": results.count(1),
                "losses": results.count(-1),
                "ties": results.count(0),
            }
        )
    return out


def category_win_prob(gap: float, noise: float = CATEGORY_NOISE) -> float:
    """P(win a category) when leading by `gap` per-slot z (negative = trailing)."""
    return 0.5 * (1 + erf(gap / (noise * sqrt(2))))


def category_win_probs(a: RosterProfile, b: RosterProfile) -> dict[Category, float]:
    """P(a wins each category against b), from the per-slot gap and the
    category's noise — the same z gap is a stronger lead in PTS than in STL."""
    return {
        c: category_win_prob(a.per_slot_z[c] - b.per_slot_z[c], NOISE[c])
        for c in CATEGORIES
    }


def win_count_distribution(probs: dict[Category, float]) -> list[float]:
    """dist[k] = P(exactly k category wins), categories independent."""
    dist = [1.0]
    for c in CATEGORIES:
        p = probs[c]
        nxt = [0.0] * (len(dist) + 1)
        for k, q in enumerate(dist):
            nxt[k] += q * (1 - p)
            nxt[k + 1] += q * p
        dist = nxt
    return dist


def matchup_win_prob(a: RosterProfile, b: RosterProfile) -> float:
    """P(a wins at least MAJORITY of the 9 categories), categories independent."""
    return sum(win_count_distribution(category_win_probs(a, b))[MAJORITY:])


def expected_wins(profiles: list[RosterProfile]) -> list[float]:
    """Expected matchup wins for every team over a round-robin of the others."""
    return [
        sum(matchup_win_prob(a, b) for j, b in enumerate(profiles) if j != i)
        for i, a in enumerate(profiles)
    ]
