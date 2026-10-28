"""Availability: the share of games a player can be expected to play.

Two ingredients, multiplied:

1. Durability — games played over the last three seasons, newest weighted
   most, pulled toward the pool average when the history is short.

   - Seasons before a player's first appearance don't count (rookies).
   - A season he mostly missed (fewer than LONG_ABSENCE games, or none)
     counts in full while he is still hurt, but at RECOVERED_SHARE of its
     weight once he is healthy again: one long absence he has come back
     from is a lean signal, not a forecast. Two such seasons still mark
     him as injury-prone.

2. Current status — his injury tag at the time the pool was frozen.
   "Day-To-Day" costs a few games. "Out" costs a share of the season that
   shrinks the more of the current season he has already played: most of
   it if he has barely played (a long-term injury), a tenth of it if he
   has played nearly all of it (a late knock).

Unsigned players are on no roster, so they play nothing until signed.

How missing games turn into value lives in player_values.py: a missed game
is played by a replacement-level pickup, not by nobody.
"""

from __future__ import annotations

from ..domain.model import Player

SEASON_BLEND = (3, 2, 1)  # newest first
SEASON_GAMES = 82
PRIOR_GAMES = 2.0  # pseudo-weight of the pool average in the shrinkage
UNSIGNED_SHARE = 0.3

LONG_ABSENCE = 25  # fewer games than this = a season mostly missed
RECOVERED_SHARE = 0.25  # weight of a mostly-missed season once he is healthy

# Expected share of the coming games, given the current status tag.
STATUS_SHARES = {
    "Day-To-Day": 0.95,
    "Questionable": 0.95,
    "Doubtful": 0.9,
}
# "Out" ranges from a long-term injury (on top of a mostly-missed current
# season) to a late knock (after a nearly full one), interpolated between.
LONG_OUT_SHARE = 0.45
SHORT_OUT_SHARE = 0.9
FULL_GP = 60


def season_rows(players: list[Player]) -> list[str]:
    """The last three seasons any player has games for, newest first."""
    seasons = {s for p in players for s in p.season_gp}
    return sorted(seasons, reverse=True)[: len(SEASON_BLEND)]


def _weighted_games(p: Player, seasons: list[str]) -> tuple[float, float]:
    """(sum of weight x share of games played, sum of weights) over counted seasons."""
    played = [i for i, s in enumerate(seasons) if s in p.season_gp]
    if not played:
        return 0.0, 0.0
    counted = range(max(played) + 1)  # from his first season on
    num = den = 0.0
    for i in counted:
        w = SEASON_BLEND[i]
        g = p.season_gp.get(seasons[i], 0)
        if g < LONG_ABSENCE and not p.status:
            w *= RECOVERED_SHARE
        num += w * g / SEASON_GAMES
        den += w
    return num, den


def status_share(p: Player, seasons: list[str]) -> float:
    """Share of the coming games his current injury tag leaves him."""
    if not p.status:
        return 1.0
    if p.status == "Out":
        current_gp = p.season_gp.get(seasons[0], 0) if seasons else 0
        played = (current_gp - LONG_ABSENCE) / (FULL_GP - LONG_ABSENCE)
        t = min(1.0, max(0.0, played))
        return LONG_OUT_SHARE + t * (SHORT_OUT_SHARE - LONG_OUT_SHARE)
    return STATUS_SHARES.get(p.status, STATUS_SHARES["Day-To-Day"])


def expected_share(players: list[Player]) -> dict[str, float]:
    """Expected share of games (0–1) for every player, by id."""
    seasons = season_rows(players)
    sums = {p.id: _weighted_games(p, seasons) for p in players}
    total_den = sum(d for _, d in sums.values())
    prior = sum(n for n, _ in sums.values()) / total_den if total_den else 1.0
    out: dict[str, float] = {}
    for p in players:
        num, den = sums[p.id]
        durability = min(1.0, (num + PRIOR_GAMES * prior) / (den + PRIOR_GAMES))
        rate = durability * status_share(p, seasons)
        out[p.id] = rate if p.signed else rate * UNSIGNED_SHARE
    return out
