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

    threes = made three-pointers; fgm/fga and ftm/fta carry volume so
    FG%/FT% aggregate correctly.
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
    threes: float
    fgm: float
    fga: float
    ftm: float
    fta: float
    tov: float
    ref_id: int | None = None
    season: str | None = None
    gp: int = 0
    mpg: float = 0.0
    signed: bool = True  # False: on no club roster right now (free agent / retired)
    season_gp: dict[str, int] = field(default_factory=dict)  # season -> GP, newest first
    adp: float | None = None  # consensus draft position on the board
    status: str | None = None  # current availability tag ("Out", "Day-To-Day", …); display only


@dataclass(frozen=True)
class RivalSpec:
    """Rival personality: draft style and appetite for injury lean,
    assigned when the session opens."""

    style: str  # "value" | "needs" | "concede"
    concede_cat: str | None = None
    lean: str = "neutral"  # "cautious" | "neutral" | "bold"


RIVAL_STYLES = {"value": "Value", "needs": "Needs", "concede": "Concede"}
RIVAL_LEANS = ["cautious", "neutral", "bold"]
