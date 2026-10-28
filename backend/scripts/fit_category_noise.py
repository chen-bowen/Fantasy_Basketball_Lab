#!/usr/bin/env python3
"""fit_category_noise — how much each category swings from week to week.

The standings model (app/analysis/standings.py) turns a per-slot z gap
between two rosters into the chance of winning the category that week:
P = Φ(gap / NOISE[c]). NOISE[c] is the gap at which a team is a one-sigma
favourite, and it should come from how many events a week actually holds
— a week of points is hundreds of shots and a lead there is safe; a week
of steals is a few dozen and the same lead is closer to a coin flip.

This script derives the nine numbers from the frozen pool and prints them
to paste into standings.py as FITTED_VARIANCE:

  1. Draft a few leagues with the rivals, so the rosters are typical.
  2. For every roster, the variance of its weekly total in each category:
     each player plays GAMES_PER_WEEK games (his availability-adjusted
     line, like the model), and his game-to-game variance is
     OVERDISPERSION[c] × his per-game mean — Poisson for steals, blocks,
     threes and turnovers, more for points, rebounds and assists, whose
     game lines vary with minutes and pace. FG% and FT% are scored as makes
     above a league-average shooter on the same attempts; their variance is
     binomial in the makes plus the swing in attempts (ATTEMPT_CV).
  3. The difference between two rosters' weekly totals has the sum of
     their variances; its standard deviation, divided by roster slots ×
     games and by the pool's per-game standard deviation, is the per-slot z
     gap worth one sigma. Averaged over every pair of rosters.

Refit after `npm run data:gen`.

Usage:
    python backend/scripts/fit_category_noise.py [--seeds N]
"""

from __future__ import annotations

import argparse
import statistics
import sys
from math import sqrt
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from lab.metrics.ratings import FILL_SHARE, score_pool  # noqa: E402
from lab.pool.loader import PLAYER_POOL, PLAYERS  # noqa: E402
from lab.domain.autopilot import deal_rivals, autopilot_pick  # noqa: E402
from lab.domain.session import DraftSettings, record_pick, open_session, on_clock, draft_done  # noqa: E402
from lab.domain.model import CATEGORIES, Player  # noqa: E402

LEAGUE_SIZE, SQUAD_SIZE = 12, 13
GAMES_PER_WEEK = 3.5
# Game-to-game variance as a multiple of the per-game mean (1.0 = Poisson).
# A 25-point scorer varies by about ±7.5 a night, a 10-rebounder by ±3.6,
# an 8-assist guard by ±3; steals, blocks, threes and turnovers are counts
# of a few events and sit at Poisson.
OVERDISPERSION = {"PTS": 2.2, "REB": 1.3, "AST": 1.2, "STL": 1.0, "BLK": 1.1, "3PM": 1.1, "TO": 1.1}
# Night-to-night swing in attempts, as a share of the per-game mean.
ATTEMPT_CV = {"FG%": 0.3, "FT%": 0.6}
STAT = {"PTS": "pts", "REB": "reb", "AST": "ast", "STL": "stl", "BLK": "blk", "3PM": "threes", "TO": "tov"}


def weekly_variance(roster: list[Player], availability, replacement, lg_fg, lg_ft) -> dict[str, float]:
    var = {c: 0.0 for c in CATEGORIES}
    for p in roster:
        a = availability[p.id]
        g = GAMES_PER_WEEK
        for c in OVERDISPERSION:
            own = getattr(p, STAT[c])
            # the model's expected line: his games plus a replacement's share of the rest
            mean = own if c == "TO" else a * own + (1 - a) * FILL_SHARE * replacement[c]
            var[c] += g * OVERDISPERSION[c] * mean
        for c, makes, att, lg in (("FG%", p.fgm, p.fga, lg_fg), ("FT%", p.ftm, p.fta, lg_ft)):
            if not att:
                continue
            pct = makes / att
            var[c] += g * (att * pct * (1 - pct) + (pct - lg) ** 2 * (ATTEMPT_CV[c] * att) ** 2)
    return var


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--seeds", type=int, default=6)
    args = ap.parse_args()

    values, stats = score_pool(PLAYERS)
    rosters: list[list[Player]] = []
    for i in range(args.seeds):
        seed = f"noise-{i}"
        config = DraftSettings(LEAGUE_SIZE, SQUAD_SIZE, i % LEAGUE_SIZE, seed, deal_rivals(seed, LEAGUE_SIZE, i % LEAGUE_SIZE))
        state = open_session(config)
        while not draft_done(state):
            t = on_clock(state)
            state = record_pick(state, PLAYER_POOL, autopilot_pick(state, PLAYER_POOL, values, t, stats.healthy_values))
        rosters += [[PLAYER_POOL[i] for i in r] for r in state.squads]

    variances = [
        weekly_variance(r, stats.avail, stats.replacement, stats.lg_fg_pct, stats.lg_ft_pct)
        for r in rosters
    ]
    noise = {}
    for c in CATEGORIES:
        per_pair = [
            sqrt(va[c] + vb[c]) / (SQUAD_SIZE * GAMES_PER_WEEK) / stats.std[c]
            for i, va in enumerate(variances)
            for vb in variances[:i]
        ]
        noise[c] = statistics.mean(per_pair)

    print(f"# {len(rosters)} rival-drafted rosters, {GAMES_PER_WEEK} games per player per week")
    print("FITTED_VARIANCE: dict[Category, float] = {")
    for c in CATEGORIES:
        print(f'    "{c}": {noise[c]:.2f},')
    print("}")


if __name__ == "__main__":
    main()
