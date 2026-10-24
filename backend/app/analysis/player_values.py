"""Player valuation.

Each player's contribution in category c is a z-score against the pool:

  - Counting stats (PTS, REB, AST, STL, BLK, 3PM): z of the per-game value.
  - TO: z of the per-game value, negated (positive = helps you).
  - FG% / FT%: z of volume-adjusted impact — makes above a league-average
    shooter on the same attempts (FGM - lg_pct * FGA).

Overall score = weighted sum of category z's; weights come from bot
strategy or the user's punt settings.
"""

from __future__ import annotations

from dataclasses import dataclass

from ..engine.types import CATEGORIES, Category, Player

CategoryZ = dict[Category, float]
CategoryWeights = dict[Category, float]

UNIFORM_WEIGHTS: CategoryWeights = {c: 1.0 for c in CATEGORIES}


@dataclass(frozen=True)
class PoolStats:
    mean: CategoryZ
    std: CategoryZ
    lg_fg_pct: float
    lg_ft_pct: float


def _raw_category_values(
    players: list[Player], lg_fg: float, lg_ft: float
) -> dict[Category, list[float]]:
    raw: dict[Category, list[float]] = {c: [] for c in CATEGORIES}
    for p in players:
        raw["PTS"].append(p.pts)
        raw["REB"].append(p.reb)
        raw["AST"].append(p.ast)
        raw["STL"].append(p.stl)
        raw["BLK"].append(p.blk)
        raw["3PM"].append(p.tpm)
        raw["FG%"].append(p.fgm - lg_fg * p.fga)  # volume-adjusted makes
        raw["FT%"].append(p.ftm - lg_ft * p.fta)
        raw["TO"].append(p.tov)
    return raw


def compute_pool_stats(players: list[Player]) -> PoolStats:
    fgm = sum(p.fgm for p in players)
    fga = sum(p.fga for p in players)
    ftm = sum(p.ftm for p in players)
    fta = sum(p.fta for p in players)
    lg_fg = fgm / fga if fga else 0.0
    lg_ft = ftm / fta if fta else 0.0

    raw = _raw_category_values(players, lg_fg, lg_ft)
    mean: CategoryZ = {}
    std: CategoryZ = {}
    for c in CATEGORIES:
        xs = raw[c]
        m = sum(xs) / len(xs)
        var = sum((x - m) ** 2 for x in xs) / len(xs)
        mean[c] = m
        std[c] = var**0.5 or 1.0
    return PoolStats(mean=mean, std=std, lg_fg_pct=lg_fg, lg_ft_pct=lg_ft)


def compute_player_values(
    players: list[Player],
) -> tuple[dict[str, CategoryZ], PoolStats]:
    """Standardized per-category contributions; higher is always better."""
    pool = compute_pool_stats(players)
    values: dict[str, CategoryZ] = {}
    for p in players:
        z: CategoryZ = {
            "PTS": (p.pts - pool.mean["PTS"]) / pool.std["PTS"],
            "REB": (p.reb - pool.mean["REB"]) / pool.std["REB"],
            "AST": (p.ast - pool.mean["AST"]) / pool.std["AST"],
            "STL": (p.stl - pool.mean["STL"]) / pool.std["STL"],
            "BLK": (p.blk - pool.mean["BLK"]) / pool.std["BLK"],
            "3PM": (p.tpm - pool.mean["3PM"]) / pool.std["3PM"],
            "FG%": (p.fgm - pool.lg_fg_pct * p.fga - pool.mean["FG%"])
            / pool.std["FG%"],
            "FT%": (p.ftm - pool.lg_ft_pct * p.fta - pool.mean["FT%"])
            / pool.std["FT%"],
            "TO": -(p.tov - pool.mean["TO"]) / pool.std["TO"],
        }
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
