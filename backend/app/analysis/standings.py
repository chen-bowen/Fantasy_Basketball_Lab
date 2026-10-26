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
"""

from __future__ import annotations

from math import erf, sqrt

from ..engine.types import CATEGORIES, Category
from .roster_profile import RosterProfile

# Per-slot z gap at which a category is a one-sigma (84%) favourite. Drafted
# teams sit about 0.3 apart in a typical category, which makes that matchup
# roughly 65/35; the strongest and weakest teams (~1.2 apart) about 95/5.
CATEGORY_NOISE = 0.75

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


def category_win_prob(gap: float) -> float:
    """P(win a category) when leading by `gap` per-slot z (negative = trailing)."""
    return 0.5 * (1 + erf(gap / (CATEGORY_NOISE * sqrt(2))))


def matchup_win_prob(a: RosterProfile, b: RosterProfile) -> float:
    """P(a wins at least MAJORITY of the 9 categories), categories independent."""
    dist = [1.0]  # dist[k] = P(k category wins so far)
    for c in CATEGORIES:
        p = category_win_prob(a.per_slot_z[c] - b.per_slot_z[c])
        nxt = [0.0] * (len(dist) + 1)
        for k, q in enumerate(dist):
            nxt[k] += q * (1 - p)
            nxt[k + 1] += q * p
        dist = nxt
    return sum(dist[MAJORITY:])


def expected_wins(profiles: list[RosterProfile]) -> list[float]:
    """Expected matchup wins for every team over a round-robin of the others."""
    return [
        sum(matchup_win_prob(a, b) for j, b in enumerate(profiles) if j != i)
        for i, a in enumerate(profiles)
    ]
