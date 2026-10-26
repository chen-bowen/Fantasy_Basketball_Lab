"""Player valuation.

Each player's contribution in category c is a z-score against the pool:

  - Counting stats (PTS, REB, AST, STL, BLK, 3PM): z of the per-game value.
  - TO: z of the per-game value, negated (positive = helps you).
  - FG% / FT%: z of volume-adjusted impact — makes above a league-average
    shooter on the same attempts (FGM - lg_pct * FGA) — capped at ±PCT_Z_CAP
    so one extreme shooting line can't outweigh several strong categories.

Availability (see availability.py) enters before the z-scores: a game the
player misses is played by a replacement-level pickup, so his expected
line is

    a * his per-game line + (1 - a) * STREAM_SHARE * replacement line

where the replacement line is the average of the best players who go
undrafted in a standard league, and STREAM_SHARE is how much of it a
streamed game really recovers — moves are limited and the wire thins as
the season goes. A missed star game therefore costs a lot, a missed
12th-man game little, and a player who never plays is worth less than the
healthy 13th man who would have had his roster spot. Turnovers are the
exception and stay per-game (see _expected).

Overall score = weighted sum of category z's. The base weights are
DRAFT_WEIGHTS — how drafters actually price the nine categories — and bot
strategy or the user's punt settings modify them from there. A player's
healthy z's are kept too, so a drafter's appetite for injury risk can
scale the discount.
"""

from __future__ import annotations

from dataclasses import dataclass

from ..engine.types import CATEGORIES, Category, Player
from .availability import compute_availability

CategoryZ = dict[Category, float]
CategoryWeights = dict[Category, float]

UNIFORM_WEIGHTS: CategoryWeights = {c: 1.0 for c in CATEGORIES}

# How the draft room prices the categories. In the standings every category
# is one win, but nobody drafts that way: the per-category z-sum makes a
# low-turnover 3-and-D guard with a good free-throw stroke look like a
# star, because +1 z in steals or turnovers reads the same as +1 z in
# points. Drafters weigh the box-score trio most, blocks about par, the
# percentages a little under, steals and threes half, and all but ignore
# turnovers (they come with usage, and are the usual punt). These weights
# are fitted against aggregated ADP and rounded; fitted on half the pool
# they hold on the other half (rank correlation with ADP ~0.78 -> ~0.88).
DRAFT_WEIGHTS: CategoryWeights = {
    "PTS": 2.0,
    "REB": 1.5,
    "AST": 1.5,
    "STL": 0.5,
    "BLK": 1.0,
    "3PM": 0.5,
    "FG%": 0.75,
    "FT%": 0.75,
    "TO": 0.25,
}

PCT_Z_CAP = 3.0

# Replacement level: the players just outside a 12-team x 13-slot draft are
# who you stream in for a missed game. Averaged over a band so one player
# doesn't define it; smaller pools use their bottom half.
REPLACEMENT_RANK = 12 * 13
REPLACEMENT_BAND = 40
STREAM_SHARE = 0.85  # share of a replacement line a streamed game recovers


@dataclass(frozen=True)
class PoolStats:
    mean: CategoryZ
    std: CategoryZ
    lg_fg_pct: float
    lg_ft_pct: float
    availability: dict[str, float]  # player id -> expected share of games
    replacement: CategoryZ  # raw per-game line of a replacement-level pickup
    healthy_values: dict[str, CategoryZ]  # z's if he played every game


def _raw(p: Player, lg_fg: float, lg_ft: float) -> CategoryZ:
    """Per-game raw value per category; higher is better except TO."""
    return {
        "PTS": p.pts,
        "REB": p.reb,
        "AST": p.ast,
        "STL": p.stl,
        "BLK": p.blk,
        "3PM": p.tpm,
        "FG%": p.fgm - lg_fg * p.fga,  # volume-adjusted makes
        "FT%": p.ftm - lg_ft * p.fta,
        "TO": p.tov,
    }


def _expected(raw: CategoryZ, availability: float, replacement: CategoryZ) -> CategoryZ:
    """Raw line blended with the replacement line for the games he misses."""
    a = availability
    out = {c: a * raw[c] + (1 - a) * STREAM_SHARE * replacement[c] for c in CATEGORIES}
    # Not blended: a missed game doesn't save turnovers — the replacement
    # who plays it commits his own — so absence must never look like a TO edge.
    out["TO"] = raw["TO"]
    return out


def _replacement_line(raws: dict[str, CategoryZ]) -> CategoryZ:
    """Average per-game line of the replacement band, ranked by a plain
    z-score sum of the full-health lines."""
    mean: CategoryZ = {}
    std: CategoryZ = {}
    for c in CATEGORIES:
        xs = [r[c] for r in raws.values()]
        m = sum(xs) / len(xs)
        var = sum((x - m) ** 2 for x in xs) / len(xs)
        mean[c], std[c] = m, var**0.5 or 1.0

    def score(r: CategoryZ) -> float:
        s = 0.0
        for c in CATEGORIES:
            z = (r[c] - mean[c]) / std[c]
            s += -z if c == "TO" else z
        return s

    ranked = sorted(raws.values(), key=score, reverse=True)
    start = min(REPLACEMENT_RANK, len(ranked) // 2)
    band = ranked[start : start + REPLACEMENT_BAND] or ranked[-1:]
    return {c: sum(r[c] for r in band) / len(band) for c in CATEGORIES}


def _standardize(raw: CategoryZ, pool_mean: CategoryZ, pool_std: CategoryZ) -> CategoryZ:
    z: CategoryZ = {c: (raw[c] - pool_mean[c]) / pool_std[c] for c in CATEGORIES}
    z["TO"] = -z["TO"]
    for c in ("FG%", "FT%"):
        z[c] = max(-PCT_Z_CAP, min(PCT_Z_CAP, z[c]))
    return z


def compute_player_values(
    players: list[Player],
) -> tuple[dict[str, CategoryZ], PoolStats]:
    """Standardized per-category contributions; higher is always better."""
    fgm = sum(p.fgm for p in players)
    fga = sum(p.fga for p in players)
    ftm = sum(p.ftm for p in players)
    fta = sum(p.fta for p in players)
    lg_fg = fgm / fga if fga else 0.0
    lg_ft = ftm / fta if fta else 0.0
    availability = compute_availability(players)

    raws = {p.id: _raw(p, lg_fg, lg_ft) for p in players}
    replacement = _replacement_line(raws)
    expected = {
        p.id: _expected(raws[p.id], availability[p.id], replacement) for p in players
    }

    mean: CategoryZ = {}
    std: CategoryZ = {}
    for c in CATEGORIES:
        xs = [e[c] for e in expected.values()]
        m = sum(xs) / len(xs)
        var = sum((x - m) ** 2 for x in xs) / len(xs)
        mean[c] = m
        std[c] = var**0.5 or 1.0

    values = {pid: _standardize(e, mean, std) for pid, e in expected.items()}
    healthy = {pid: _standardize(r, mean, std) for pid, r in raws.items()}
    pool = PoolStats(
        mean=mean,
        std=std,
        lg_fg_pct=lg_fg,
        lg_ft_pct=lg_ft,
        availability=availability,
        replacement=replacement,
        healthy_values=healthy,
    )
    return values, pool


def compute_pool_stats(players: list[Player]) -> PoolStats:
    return compute_player_values(players)[1]


def score_player(z: CategoryZ, w: CategoryWeights) -> float:
    """S(p) = sum_c w_c * v_{p,c} — no noise; callers add epsilon."""
    return sum(w[c] * z[c] for c in CATEGORIES)


def punt_weights(punts: set[Category]) -> CategoryWeights:
    """Draft weights with the punted categories zeroed."""
    w = dict(DRAFT_WEIGHTS)
    for c in punts:
        w[c] = 0.0
    return w
