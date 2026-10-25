"""Player valuation.

Each player's contribution in category c is a z-score against the pool:

  - Counting stats (PTS, REB, AST, STL, BLK, 3PM): z of the per-game value.
  - TO: z of the per-game value, negated (positive = helps you).
  - FG% / FT%: z of volume-adjusted impact — makes above a league-average
    shooter on the same attempts (FGM - lg_pct * FGA) — capped at ±PCT_Z_CAP
    so one extreme shooting line can't outweigh several strong categories.

Per-game production is first scaled by the player's availability
(see availability.py), so a player who misses games is worth less.
Turnovers are the exception and stay per-game (see _raw).

Overall score = weighted sum of category z's; weights come from bot
strategy or the user's punt settings.
"""

from __future__ import annotations

from dataclasses import dataclass

from ..engine.types import CATEGORIES, Category, Player
from .availability import compute_availability, production_scale

CategoryZ = dict[Category, float]
CategoryWeights = dict[Category, float]

UNIFORM_WEIGHTS: CategoryWeights = {c: 1.0 for c in CATEGORIES}

PCT_Z_CAP = 3.0


@dataclass(frozen=True)
class PoolStats:
    mean: CategoryZ
    std: CategoryZ
    lg_fg_pct: float
    lg_ft_pct: float
    availability: dict[str, float]  # player id -> expected share of games


def _raw(p: Player, scale: float, lg_fg: float, lg_ft: float) -> CategoryZ:
    """Availability-scaled raw value per category; higher is better except TO."""
    return {
        "PTS": p.pts * scale,
        "REB": p.reb * scale,
        "AST": p.ast * scale,
        "STL": p.stl * scale,
        "BLK": p.blk * scale,
        "3PM": p.tpm * scale,
        "FG%": (p.fgm - lg_fg * p.fga) * scale,  # volume-adjusted makes
        "FT%": (p.ftm - lg_ft * p.fta) * scale,
        # Not scaled: a missed game doesn't save turnovers — the replacement
        # who plays it commits his own — so absence must never look like a TO edge.
        "TO": p.tov,
    }


def compute_pool_stats(players: list[Player]) -> PoolStats:
    fgm = sum(p.fgm for p in players)
    fga = sum(p.fga for p in players)
    ftm = sum(p.ftm for p in players)
    fta = sum(p.fta for p in players)
    lg_fg = fgm / fga if fga else 0.0
    lg_ft = ftm / fta if fta else 0.0
    availability = compute_availability(players)

    raws = [
        _raw(p, production_scale(p, availability[p.id]), lg_fg, lg_ft) for p in players
    ]
    mean: CategoryZ = {}
    std: CategoryZ = {}
    for c in CATEGORIES:
        xs = [r[c] for r in raws]
        m = sum(xs) / len(xs)
        var = sum((x - m) ** 2 for x in xs) / len(xs)
        mean[c] = m
        std[c] = var**0.5 or 1.0
    return PoolStats(
        mean=mean, std=std, lg_fg_pct=lg_fg, lg_ft_pct=lg_ft, availability=availability
    )


def compute_player_values(
    players: list[Player],
) -> tuple[dict[str, CategoryZ], PoolStats]:
    """Standardized per-category contributions; higher is always better."""
    pool = compute_pool_stats(players)
    values: dict[str, CategoryZ] = {}
    for p in players:
        scale = production_scale(p, pool.availability[p.id])
        raw = _raw(p, scale, pool.lg_fg_pct, pool.lg_ft_pct)
        z: CategoryZ = {c: (raw[c] - pool.mean[c]) / pool.std[c] for c in CATEGORIES}
        z["TO"] = -z["TO"]
        for c in ("FG%", "FT%"):
            z[c] = max(-PCT_Z_CAP, min(PCT_Z_CAP, z[c]))
        values[p.id] = z
    return values, pool


def score_player(z: CategoryZ, w: CategoryWeights) -> float:
    """S(p) = sum_c w_c * v_{p,c} — no noise; callers add epsilon."""
    return sum(w[c] * z[c] for c in CATEGORIES)


def punt_weights(punts: set[Category]) -> CategoryWeights:
    w = dict(UNIFORM_WEIGHTS)
    for c in punts:
        w[c] = 0.0
    return w
