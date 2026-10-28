"""Punt plan that follows the roster.

A concede is a decision to concede a category and spend nothing on it. The
build screens pick one by simulation for the first two picks; after that
the roster keeps changing shape, and a plan set by hand on pick two is
stale by pick six. This module reads the plan off the roster instead:

  - With fewer than MIN_SQUAD players there is no shape to read.
  - A concede is suggested when the team sits in the bottom third of the
    league in one of the concedable categories (CONCEDE_OPTIONS — the ones a
    build can actually do without), by per-slot z against every other
    roster at this point in the draft.
  - A concede already in place is kept while the team is still weak there.
    It is replaced only when the team has in fact become decent in it
    (HOLD_RANK or better — the picks went elsewhere after all) and a clear
    weakness exists somewhere else.

`advise_concedes` is the recommendation; the API applies it automatically
for drafts in "auto" concede mode and shows it as a hint in "manual" mode.
"""

from __future__ import annotations

from typing import Any

from ..domain.model import Category
from .profile import RosterLine, cat_ranks

CONCEDE_OPTIONS: tuple[Category, ...] = ("AST", "FG%", "FT%", "TO", "3PM")
MIN_SQUAD = 2
SOFT_RANK = 9  # bottom third of a 12-team league
HOLD_RANK = 7  # a current concede is dropped only once the team is this good in it


def advise_concedes(
    profiles: list[RosterLine], squad: int, current: list[Category]
) -> dict[str, Any]:
    """{"concedes": [...], "category": c | None, "rank": r | None, "reason": str}."""
    team = profiles[squad]
    if team.size < MIN_SQUAD:
        return {"concedes": list(current), "category": None, "rank": None,
                "reason": "Not enough picks yet to read a build from."}
    ranks = cat_ranks(profiles)
    rank_of = {c: ranks[c][squad] for c in CONCEDE_OPTIONS}
    worst = max(CONCEDE_OPTIONS, key=lambda c: rank_of[c])
    kept = [c for c in current if c in CONCEDE_OPTIONS]
    if kept and rank_of[kept[0]] > HOLD_RANK:
        c = kept[0]
        return {"concedes": [c], "category": c, "rank": rank_of[c],
                "reason": f"Still weakest in {c} ({_ord(rank_of[c])} of {len(profiles)}), so the concede stands."}
    if rank_of[worst] >= SOFT_RANK:
        if kept:
            return {"concedes": [worst], "category": worst, "rank": rank_of[worst],
                    "reason": f"Your picks made you {_ord(rank_of[kept[0]])} in {kept[0]} but "
                              f"{_ord(rank_of[worst])} in {worst} — the roster is conceding {worst}."}
        return {"concedes": [worst], "category": worst, "rank": rank_of[worst],
                "reason": f"You sit {_ord(rank_of[worst])} of {len(profiles)} in {worst}: "
                          f"concede it and spend the picks elsewhere."}
    if kept:
        c = kept[0]
        return {"concedes": [], "category": None, "rank": rank_of[c],
                "reason": f"You're {_ord(rank_of[c])} in {c} now, so there is nothing to concede."}
    return {"concedes": [], "category": None, "rank": None,
            "reason": "No category is weak enough to concede yet."}


def _ord(n: int) -> str:
    suffix = "th" if 11 <= n % 100 <= 13 else {1: "st", 2: "nd", 3: "rd"}.get(n % 10, "th")
    return f"{n}{suffix}"
