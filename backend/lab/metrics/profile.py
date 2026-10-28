"""Roster profile: what a team's drafted players project to produce.

Two views kept distinct:
  - totals / fg_pct / ft_pct: raw per-game sums across the roster.
  - per_slot_z: mean z-score per filled roster slot — used to compare
    teams fairly while they have different numbers of players mid-draft.

All figures are per game, equal games played — not weekly forecasts.
"""

from __future__ import annotations

from dataclasses import dataclass

from ..engine.types import CATEGORIES, Category, Player
from .player_values import CategoryZ

TOTAL_KEYS = (
    "pts", "reb", "ast", "stl", "blk", "tpm", "fgm", "fga", "ftm", "fta", "tov",
)
CountingTotals = dict[str, float]


@dataclass(frozen=True)
class RosterProfile:
    size: int
    totals: CountingTotals
    fg_pct: float | None
    ft_pct: float | None
    z_sum: CategoryZ
    per_slot_z: CategoryZ


def build_roster_profile(
    roster: list[Player], values: dict[str, CategoryZ]
) -> RosterProfile:
    totals: CountingTotals = {k: 0.0 for k in TOTAL_KEYS}
    z_sum: CategoryZ = {c: 0.0 for c in CATEGORIES}
    zero: CategoryZ = {c: 0.0 for c in CATEGORIES}
    for p in roster:
        for k in TOTAL_KEYS:
            totals[k] += getattr(p, k)
        z = values.get(p.id, zero)
        for c in CATEGORIES:
            z_sum[c] += z[c]
    denom = max(len(roster), 1)
    per_slot_z: CategoryZ = {c: z_sum[c] / denom for c in CATEGORIES}
    return RosterProfile(
        size=len(roster),
        totals=totals,
        fg_pct=totals["fgm"] / totals["fga"] if totals["fga"] else None,
        ft_pct=totals["ftm"] / totals["fta"] if totals["fta"] else None,
        z_sum=z_sum,
        per_slot_z=per_slot_z,
    )


def rank_teams(profiles: list[RosterProfile]) -> dict[Category, list[int]]:
    """Rank every team within each category by per-slot z (1 = strongest).
    TO z is already sign-flipped upstream, so higher is always better."""
    ranks: dict[Category, list[int]] = {}
    for c in CATEGORIES:
        order = sorted(
            range(len(profiles)),
            key=lambda i: profiles[i].per_slot_z[c],
            reverse=True,
        )
        r = [1] * len(profiles)
        last_v = float("inf")
        last_rank = 0
        for idx, i in enumerate(order):
            v = profiles[i].per_slot_z[c]
            rank = last_rank if v == last_v else idx + 1
            r[i] = rank
            last_v, last_rank = v, rank
        ranks[c] = r
    return ranks
