"""Player valuation.

Each player's contribution in category c is a z-score against the pool:

  - Counting stats (PTS, REB, AST, STL, BLK, 3PM): z of the per-game value.
  - TO: z of the per-game value, negated (positive = helps you).
  - FG% / FT%: z of volume-adjusted impact — makes above a league-average
    shooter on the same attempts (FGM - lg_pct * FGA) — capped at ±RATE_CAP
    so one extreme shooting line can't outweigh several strong categories.

Availability (see availability.py) enters before the z-scores: a game the
player misses is played by a replacement-level pickup, so his expected
line is

    a * his per-game line + (1 - a) * FILL_SHARE * replacement line

where the replacement line is the average of the best players who go
undrafted in a standard league, and FILL_SHARE is how much of it a
streamed game really recovers — moves are limited and the wire thins as
the season goes. A missed star game therefore costs a lot, a missed
12th-man game little, and a player who never plays is worth less than the
healthy 13th man who would have had his roster spot. Turnovers are the
exception and stay per-game (see _expected).

Overall score = weighted sum of category z's; weights come from rival
strategy or the user's concede settings. A player's healthy z's are kept too,
so a drafter's appetite for injury lean can scale the discount.
"""

from __future__ import annotations

from dataclasses import dataclass

from ..domain.model import CATEGORIES, Category, Player
from .durability import expected_share

CatScores = dict[Category, float]
CatWeights = dict[Category, float]

EVEN_WEIGHTS: CatWeights = {c: 1.0 for c in CATEGORIES}

RATE_CAP = 3.0

# Replacement level: the players just outside a 12-team x 13-slot draft are
# who you stream in for a missed game. Averaged over a bracket so one player
# doesn't define it; smaller pools use their bottom half.
WAIVER_RANK = 12 * 13
WAIVER_BAND = 40
FILL_SHARE = 0.85  # share of a replacement line a streamed game recovers


@dataclass(frozen=True)
class Baseline:
    mean: CatScores
    std: CatScores
    lg_fg_pct: float
    lg_ft_pct: float
    avail: dict[str, float]  # player id -> expected share of games
    replacement: CatScores  # raw per-game line of a replacement-level pickup
    healthy_values: dict[str, CatScores]  # z's if he played every game


def _raw(p: Player, lg_fg: float, lg_ft: float) -> CatScores:
    """Per-game raw value per category; higher is better except TO."""
    return {
        "PTS": p.pts,
        "REB": p.reb,
        "AST": p.ast,
        "STL": p.stl,
        "BLK": p.blk,
        "3PM": p.threes,
        "FG%": p.fgm - lg_fg * p.fga,  # volume-adjusted makes
        "FT%": p.ftm - lg_ft * p.fta,
        "TO": p.tov,
    }


def _expected(raw: CatScores, availability: float, replacement: CatScores) -> CatScores:
    """Raw line blended with the replacement line for the games he misses."""
    a = availability
    out = {c: a * raw[c] + (1 - a) * FILL_SHARE * replacement[c] for c in CATEGORIES}
    # Not blended: a missed game doesn't save turnovers — the replacement
    # who plays it commits his own — so absence must never look like a TO edge.
    out["TO"] = raw["TO"]
    return out


def _replacement_line(raws: dict[str, CatScores]) -> CatScores:
    """Average per-game line of the replacement bracket, ranked by a plain
    z-score sum of the full-health lines."""
    mean: CatScores = {}
    std: CatScores = {}
    for c in CATEGORIES:
        xs = [r[c] for r in raws.values()]
        m = sum(xs) / len(xs)
        var = sum((x - m) ** 2 for x in xs) / len(xs)
        mean[c], std[c] = m, var**0.5 or 1.0

    def score(r: CatScores) -> float:
        s = 0.0
        for c in CATEGORIES:
            z = (r[c] - mean[c]) / std[c]
            s += -z if c == "TO" else z
        return s

    ranked = sorted(raws.values(), key=score, reverse=True)
    start = min(WAIVER_RANK, len(ranked) // 2)
    bracket = ranked[start : start + WAIVER_BAND] or ranked[-1:]
    return {c: sum(r[c] for r in bracket) / len(bracket) for c in CATEGORIES}


def _standardize(raw: CatScores, pool_mean: CatScores, pool_std: CatScores) -> CatScores:
    z: CatScores = {c: (raw[c] - pool_mean[c]) / pool_std[c] for c in CATEGORIES}
    z["TO"] = -z["TO"]
    for c in ("FG%", "FT%"):
        z[c] = max(-RATE_CAP, min(RATE_CAP, z[c]))
    return z


def score_pool(
    players: list[Player],
) -> tuple[dict[str, CatScores], Baseline]:
    """Standardized per-category contributions; higher is always better."""
    fgm = sum(p.fgm for p in players)
    fga = sum(p.fga for p in players)
    ftm = sum(p.ftm for p in players)
    fta = sum(p.fta for p in players)
    lg_fg = fgm / fga if fga else 0.0
    lg_ft = ftm / fta if fta else 0.0
    availability = expected_share(players)

    raws = {p.id: _raw(p, lg_fg, lg_ft) for p in players}
    replacement = _replacement_line(raws)
    expected = {
        p.id: _expected(raws[p.id], availability[p.id], replacement) for p in players
    }

    mean: CatScores = {}
    std: CatScores = {}
    for c in CATEGORIES:
        xs = [e[c] for e in expected.values()]
        m = sum(xs) / len(xs)
        var = sum((x - m) ** 2 for x in xs) / len(xs)
        mean[c] = m
        std[c] = var**0.5 or 1.0

    values = {pid: _standardize(e, mean, std) for pid, e in expected.items()}
    healthy = {pid: _standardize(r, mean, std) for pid, r in raws.items()}
    pool = Baseline(
        mean=mean,
        std=std,
        lg_fg_pct=lg_fg,
        lg_ft_pct=lg_ft,
        avail=availability,
        replacement=replacement,
        healthy_values=healthy,
    )
    return values, pool


def pool_baseline(players: list[Player]) -> Baseline:
    return score_pool(players)[1]


def line_score(z: CatScores, w: CatWeights) -> float:
    """S(p) = sum_c w_c * v_{p,c} — no noise; callers add epsilon."""
    return sum(w[c] * z[c] for c in CATEGORIES)


def concede_weights(concedes: set[Category]) -> CatWeights:
    w = dict(EVEN_WEIGHTS)
    for c in concedes:
        w[c] = 0.0
    return w
