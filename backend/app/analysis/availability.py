"""Availability: the share of games a player can be expected to play.

Built from games played over the last three seasons, newest weighted most:

  - Seasons before a player's first appearance don't count (rookies).
  - A season missed entirely counts as 0 games, unless the player is healthy
    now (no current injury status): one long absence he has come back from
    says little about the coming season (Haliburton's Achilles year).
  - Short histories are pulled toward the pool average, so one healthy or
    injured season doesn't decide everything.
  - Unsigned players are on no roster, so they play nothing until signed.

Values use the square root of availability rather than availability itself:
in head-to-head leagues a missed game is partly made up by streaming a
replacement, so it costs less than a full game.
"""

from __future__ import annotations

from math import sqrt

from ..engine.types import Player

SEASON_WEIGHTS = (3, 2, 1)  # newest first
SEASON_GAMES = 82
PRIOR_WEIGHT = 2.0  # pseudo-weight of the pool average in the shrinkage
UNSIGNED_FACTOR = 0.3


def recent_seasons(players: list[Player]) -> list[str]:
    """The last three seasons any player has games for, newest first."""
    seasons = {s for p in players for s in p.gp_by_season}
    return sorted(seasons, reverse=True)[: len(SEASON_WEIGHTS)]


def _weighted_games(p: Player, seasons: list[str]) -> tuple[float, float]:
    """(sum of weight x share of games played, sum of weights) over counted seasons."""
    played = [i for i, s in enumerate(seasons) if s in p.gp_by_season]
    if not played:
        return 0.0, 0.0
    counted = range(max(played) + 1)  # from his first season on
    pairs = [(SEASON_WEIGHTS[i], p.gp_by_season.get(seasons[i], 0)) for i in counted]
    if not p.injury:
        healthy = [(w, g) for w, g in pairs if g > 0]
        pairs = healthy or pairs
    num = sum(w * g / SEASON_GAMES for w, g in pairs)
    den = sum(w for w, _ in pairs)
    return num, den


def compute_availability(players: list[Player]) -> dict[str, float]:
    """Expected share of games (0–1) for every player, by id."""
    seasons = recent_seasons(players)
    sums = {p.id: _weighted_games(p, seasons) for p in players}
    total_den = sum(d for _, d in sums.values())
    prior = sum(n for n, _ in sums.values()) / total_den if total_den else 1.0
    out: dict[str, float] = {}
    for p in players:
        num, den = sums[p.id]
        rate = min(1.0, (num + PRIOR_WEIGHT * prior) / (den + PRIOR_WEIGHT))
        out[p.id] = rate if p.signed else rate * UNSIGNED_FACTOR
    return out


def production_scale(p: Player, availability: float) -> float:
    """Multiplier on a player's per-game production: softened for signed
    players (replacements cover part of a missed game), full for unsigned."""
    return sqrt(availability) if p.signed else availability
