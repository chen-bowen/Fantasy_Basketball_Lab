"""Market value: what a player is worth at the draft table.

The z-scores in player_values.py say what a player produces in each of the
nine categories, and the league scores all nine equally. Drafters don't
pay for them equally, though. The consensus board rewards points and
assists far above steals, free-throw percentage or turnovers — which is
why a plain z sum puts low-turnover, high-FT%, 3-and-D guards in the
first two rounds while drafts take them in the fourth or fifth, and drops
high-usage stars with an ugly FT% or turnover line out of the first round
entirely.

BOARD_FIT are the category weights that best reproduce the board's
consensus (`adp`) from the engine's own z-scores
(scripts/fit_market_weights.py: ridge regression shrunk toward uniform,
normalized to average 1.0, rounded).

BOARD_WEIGHTS, what the engine actually uses, keep BOARD_BLEND of that
fit and blend the scoresheet's uniform weights back in for the rest. Pure
board-following drafters all but ignore steals, FT% and turnovers, and a
user who simply follows Fit would then win 10 of 11 matchups on average —
a league with no resistance teaches nothing. At 0.75 the rank correlation
with the board is unchanged to two decimals while the same user averages
9 of 11.

Market weights drive where rivals take players and the "value" rank the UI
shows, so both look like a real draft. They are also the base of the
user's Fit (fit.py). The per-category noise of the standings' expected
wins (standings.NOISE) used to be derived from them too; it is now fitted
from game-level variance, which ranks the categories much the same way
but without the market's concede discount on turnovers and FT%. The
deterministic league table (table_records) stays uniform — a category is a
category on the scoresheet.

Refit when players.json is regenerated (the `adp` column is the target).
"""

from __future__ import annotations

from ..domain.model import CATEGORIES
from .ratings import CatWeights
BOARD_FIT: CatWeights = {
    "PTS": 2.40,
    "REB": 1.15,
    "AST": 1.75,
    "STL": 0.35,
    "BLK": 1.10,
    "3PM": 0.85,
    "FG%": 0.90,
    "FT%": 0.20,
    "TO": 0.30,
}

BOARD_BLEND = 0.75

BOARD_WEIGHTS: CatWeights = {
    c: 1.0 + BOARD_BLEND * (BOARD_FIT[c] - 1.0) for c in CATEGORIES
}
