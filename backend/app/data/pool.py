"""Frozen player pool loader.

players.json is written by scripts/fetch_players.py from real season
stats. This is the single source of truth for the engine.
"""

from __future__ import annotations

import json
from pathlib import Path

from ..engine.types import Player

DATA_PATH = Path(__file__).parent / "players.json"


def load_players() -> list[Player]:
    raw = json.loads(DATA_PATH.read_text())
    out: list[Player] = []
    for r in raw:
        out.append(
            Player(
                id=r["id"],
                name=r["name"],
                team=r.get("team", ""),
                positions=tuple(r.get("positions") or ("F",)),
                pts=r["pts"],
                reb=r["reb"],
                ast=r["ast"],
                stl=r["stl"],
                blk=r["blk"],
                tpm=r["tpm"],
                fgm=r["fgm"],
                fga=r["fga"],
                ftm=r["ftm"],
                fta=r["fta"],
                tov=r["tov"],
                nba_id=r.get("nbaId"),
                as_of_season=r.get("asOfSeason"),
                gp=r.get("gp", 0),
                min=r.get("min", 0.0),
                signed=r.get("signed", True),
                gp_by_season=r.get("gpBySeason") or {},
                adp=r.get("adp"),
                injury=r.get("injury"),
            )
        )
    return out


PLAYERS: list[Player] = load_players()
PLAYER_POOL: dict[str, Player] = {p.id: p for p in PLAYERS}
