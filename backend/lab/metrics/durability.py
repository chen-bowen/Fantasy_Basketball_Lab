"""Availability: the share of games a player can be expected to play.

Two ingredients, multiplied:

1. Durability — games played over the last three seasons, newest weighted
   most, pulled toward the pool average when the history is short.

   - Seasons before a player's first appearance don't count (rookies).
   - A season he mostly missed (fewer than LONG_ABSENCE_GP games, or none)
     counts in full while he is still hurt, but at RECOVERED_WEIGHT of its
     weight once he is healthy again: one long absence he has come back
     from (Haliburton's Achilles year) is a risk signal, not a forecast.
     Two such seasons still mark him as injury-prone.

2. Current status — ESPN's injury tag at the time the pool was frozen.
   "Day-To-Day" costs a few games. "Out" costs a share of the season that
   shrinks the more of the current season he has already played: most of
   it if he has barely played (a long-term injury), a tenth of it if he
   has played nearly all of it (a late knock).

Unsigned players are on no roster, so they play nothing until signed.

How missing games turn into value lives in player_values.py: a missed game
is played by a replacement-level pickup, not by nobody.
"""

from __future__ import annotations

from ..engine.types import Player

SEASON_WEIGHTS = (3, 2, 1)  # newest first
SEASON_GAMES = 82
PRIOR_WEIGHT = 2.0  # pseudo-weight of the pool average in the shrinkage
UNSIGNED_FACTOR = 0.3

LONG_ABSENCE_GP = 25  # fewer games than this = a season mostly missed
RECOVERED_WEIGHT = 0.25  # weight of a mostly-missed season once he is healthy

# Expected share of the coming games, given the current status tag.
STATUS_FACTORS = {
    "Day-To-Day": 0.95,
    "Questionable": 0.95,
    "Doubtful": 0.9,
}
# "Out" ranges from a long-term injury (on top of a mostly-missed current
# season) to a late knock (after a nearly full one), interpolated between.
LONG_TERM_OUT_FACTOR = 0.45
SHORT_TERM_OUT_FACTOR = 0.9
FULL_SEASON_GP = 60


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
    num = den = 0.0
    for i in counted:
        w = SEASON_WEIGHTS[i]
        g = p.gp_by_season.get(seasons[i], 0)
        if g < LONG_ABSENCE_GP and not p.injury:
            w *= RECOVERED_WEIGHT
        num += w * g / SEASON_GAMES
        den += w
    return num, den


def status_factor(p: Player, seasons: list[str]) -> float:
    """Share of the coming games his current injury tag leaves him."""
    if not p.injury:
        return 1.0
    if p.injury == "Out":
        current_gp = p.gp_by_season.get(seasons[0], 0) if seasons else 0
        played = (current_gp - LONG_ABSENCE_GP) / (FULL_SEASON_GP - LONG_ABSENCE_GP)
        t = min(1.0, max(0.0, played))
        return LONG_TERM_OUT_FACTOR + t * (SHORT_TERM_OUT_FACTOR - LONG_TERM_OUT_FACTOR)
    return STATUS_FACTORS.get(p.injury, STATUS_FACTORS["Day-To-Day"])


def compute_availability(players: list[Player]) -> dict[str, float]:
    """Expected share of games (0–1) for every player, by id."""
    seasons = recent_seasons(players)
    sums = {p.id: _weighted_games(p, seasons) for p in players}
    total_den = sum(d for _, d in sums.values())
    prior = sum(n for n, _ in sums.values()) / total_den if total_den else 1.0
    out: dict[str, float] = {}
    for p in players:
        num, den = sums[p.id]
        durability = min(1.0, (num + PRIOR_WEIGHT * prior) / (den + PRIOR_WEIGHT))
        rate = durability * status_factor(p, seasons)
        out[p.id] = rate if p.signed else rate * UNSIGNED_FACTOR
    return out
