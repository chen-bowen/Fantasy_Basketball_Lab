"""Head-to-head standings from category ranks.

A team "beats" another if it ranks better in more of the 9 categories.
Equal-games projection, not a weekly forecast — the same caveat as the
ranks it is built from.
"""

from __future__ import annotations

from ..engine.types import CATEGORIES, Category


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
