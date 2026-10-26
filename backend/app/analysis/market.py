"""Market value: what a player is worth at the draft table.

The z-scores in player_values.py say what a player produces in each of the
nine categories, and the league scores all nine equally. Drafters don't
pay for them equally, though. Real ADP rewards points and assists far above
steals, free-throw percentage or turnovers — which is why a plain z sum
puts low-turnover, high-FT%, 3-and-D guards in the first two rounds while
real drafts take them in the fourth or fifth, and drops high-usage stars
with an ugly FT% or turnover line out of the first round entirely.

FITTED_WEIGHTS are the category weights that best reproduce ADP from the
engine's own z-scores (scripts/fit_market_weights.py: ridge regression
shrunk toward uniform, normalized to average 1.0, rounded).

MARKET_WEIGHTS, what the engine actually uses, keep MARKET_SHARE of that
fit and blend the scoresheet's uniform weights back in for the rest. Pure
ADP drafters all but ignore steals, FT% and turnovers, and a user who
simply follows Fit would then win 10 of 11 matchups on average — a league
with no resistance teaches nothing. At 0.75 the rank correlation with ADP
is unchanged to two decimals (0.89) while the same user averages 9 of 11.

Market weights drive where bots take players and the "value" rank the UI
shows, so both look like a real draft. They do not touch the standings —
a category is a category on the scoresheet — nor the user's Fit, which is
where the lab shows you what the market underrates for your build.

Refit when players.json is regenerated (the ADP column is the target).
"""

from __future__ import annotations

from ..engine.types import CATEGORIES
from .player_values import CategoryWeights

# Fitted on the 2025-26 pool: rank correlation with ADP 0.89 (uniform 0.78).
FITTED_WEIGHTS: CategoryWeights = {
    "PTS": 2.35,
    "REB": 1.20,
    "AST": 1.80,
    "STL": 0.30,
    "BLK": 1.15,
    "3PM": 0.85,
    "FG%": 0.90,
    "FT%": 0.20,
    "TO": 0.25,
}

MARKET_SHARE = 0.75

MARKET_WEIGHTS: CategoryWeights = {
    c: 1.0 + MARKET_SHARE * (FITTED_WEIGHTS[c] - 1.0) for c in CATEGORIES
}
