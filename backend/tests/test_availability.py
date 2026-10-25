"""Availability from games played, and how it feeds player values."""

from dataclasses import replace

from app.analysis.availability import (
    UNSIGNED_FACTOR,
    compute_availability,
    production_scale,
)
from app.analysis.player_values import (
    PCT_Z_CAP,
    UNIFORM_WEIGHTS,
    compute_player_values,
    score_player,
)
from app.data.pool import PLAYERS
from app.engine.types import Player

SEASONS = ("2025-26", "2024-25", "2023-24")


def make(name: str, gp: dict[str, int], **kw) -> Player:
    base = dict(
        id=name, name=name, team="TST", positions=("G",),
        pts=20, reb=5, ast=5, stl=1, blk=0.5, tpm=2,
        fgm=8, fga=17, ftm=4, fta=5, tov=2, gp_by_season=gp,
    )
    base.update(kw)
    return Player(**base)


def pool(*players: Player) -> list[Player]:
    """Test players plus an anchor that defines the three seasons."""
    anchor = make("anchor", {s: 70 for s in SEASONS})
    return [anchor, *players]


def test_recent_seasons_weigh_more():
    recent_bad = make("recent_bad", {"2025-26": 20, "2024-25": 80, "2023-24": 80})
    old_bad = make("old_bad", {"2025-26": 80, "2024-25": 80, "2023-24": 20})
    a = compute_availability(pool(recent_bad, old_bad))
    assert a["recent_bad"] < a["old_bad"]


def test_seasons_before_debut_do_not_count():
    rookie = make("rookie", {"2025-26": 80})
    missed_two = make("missed_two", {"2023-24": 80}, injury="Out")
    a = compute_availability(pool(rookie, missed_two))
    assert a["rookie"] > a["missed_two"]


def test_full_missed_season_counts_only_while_injured():
    healthy_now = make("healthy_now", {"2024-25": 75, "2023-24": 75})
    still_out = make("still_out", {"2024-25": 75, "2023-24": 75}, injury="Out")
    a = compute_availability(pool(healthy_now, still_out))
    assert a["healthy_now"] > 0.8
    assert a["still_out"] < a["healthy_now"] - 0.2


def test_unsigned_players_are_discounted():
    signed = make("signed", {s: 70 for s in SEASONS})
    unsigned = make("unsigned", {s: 70 for s in SEASONS}, signed=False)
    a = compute_availability(pool(signed, unsigned))
    assert abs(a["unsigned"] - a["signed"] * UNSIGNED_FACTOR) < 1e-9


def test_softened_scale_only_for_signed():
    p = make("p", {})
    assert production_scale(p, 0.64) == 0.8
    assert production_scale(replace(p, signed=False), 0.2) == 0.2


def test_percentage_scores_are_capped():
    values, _ = compute_player_values(PLAYERS)
    worst = min(min(v["FG%"], v["FT%"]) for v in values.values())
    best = max(max(v["FG%"], v["FT%"]) for v in values.values())
    assert -PCT_Z_CAP <= worst and best <= PCT_Z_CAP
    assert worst == -PCT_Z_CAP  # the cap actually binds in this pool


def test_missing_games_lowers_value_but_not_turnovers():
    durable = make("durable", {s: 80 for s in SEASONS})
    fragile = make("fragile", {s: 30 for s in SEASONS})
    values, _ = compute_player_values(pool(durable, fragile))
    assert score_player(values["fragile"], UNIFORM_WEIGHTS) < score_player(
        values["durable"], UNIFORM_WEIGHTS
    )
    assert values["fragile"]["TO"] == values["durable"]["TO"]
