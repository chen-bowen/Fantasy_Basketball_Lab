"""Core domain types for the draft engine."""

from __future__ import annotations

from dataclasses import dataclass, field

CATEGORIES = ["PTS", "REB", "AST", "STL", "BLK", "3PM", "FG%", "FT%", "TO"]
Category = str  # one of CATEGORIES

LOWER_IS_BETTER = {"TO"}
PERCENTAGE_CATEGORIES = {"FG%", "FT%"}
POSITIONS = ["PG", "SG", "SF", "PF", "C", "G", "F"]


@dataclass(frozen=True)
class Player:
    """Per-game projection for a single player.

    tpm = made threes; fgm/fga and ftm/fta carry volume so FG%/FT%
    aggregate correctly.
    """

    id: str
    name: str
    team: str
    positions: tuple[str, ...]
    pts: float
    reb: float
    ast: float
    stl: float
    blk: float
    tpm: float
    fgm: float
    fga: float
    ftm: float
    fta: float
    tov: float
    nba_id: int | None = None
    as_of_season: str | None = None
    gp: int = 0
    min: float = 0.0
    signed: bool = True  # False: on no current NBA roster (free agent / retired)
    gp_by_season: dict[str, int] = field(default_factory=dict)  # season -> GP, newest first
    adp: float | None = None  # aggregated draft position (FantasyPros Yahoo/ESPN avg)
    injury: str | None = None  # current ESPN status ("Out", "Day-To-Day", …); display only


@dataclass(frozen=True)
class BotSpec:
    """Bot personality. punt_category and risk are assigned at draft start."""

    kind: str  # "value" | "needs" | "punt"
    punt_category: str | None = None
    risk: str = "neutral"  # "cautious" | "neutral" | "bold" — appetite for injury risk


BOT_KIND_LABELS = {"value": "Value", "needs": "Needs", "punt": "Punt"}
BOT_RISKS = ["cautious", "neutral", "bold"]
