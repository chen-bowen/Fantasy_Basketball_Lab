"""Your week against each team, explained by players.

The draft report shows two records side by side:

  - "On paper": standings.records — you beat a team if you rank higher in
    more of the 9 categories. Every lead counts the same, however small.
  - "Week to week": the chance of actually winning each matchup in a
    typical week, from standings.matchup_win_prob — a small lead, or a
    lead in a category that swings a lot (STL, FT%, TO), is close to a
    coin flip. Averaged over the 11 opponents it is the team's win rate;
    expected_wins / 11 on the build screens is the same number.

Both are equal-games comparisons of drafted rosters, not forecasts of a
real week: no NBA schedule, no later injuries, no lineup moves.

This module lays one matchup out like a tale of the tape so the label on
each category is just the reading of two numbers and two players:

    PTS   you 243  ·  them 220   likely win    Cunningham 23.9 · Young 22.1

  - The totals are per game for the whole roster, with the same
    availability adjustment the model uses (a player expected to miss
    games counts for the share he plays plus a replacement's share), so
    the numbers never contradict the labels.
  - The drivers are the players who decide the category: the two best on
    the favoured side; for a toss-up, the best on each side; for TO, the
    biggest turnover sources on the side that is losing it.
  - Likely win / toss-up / likely loss are whole-percent bands
    (LIKELY_PCT) and the same bands name the week: favored / toss-up /
    underdog. Labels are assigned on the rounded percent, so a label never
    disagrees with the number shown next to it.
"""

from __future__ import annotations

from statistics import median
from typing import Any

from ..engine.types import CATEGORIES, Category, Player
from .player_values import STREAM_SHARE, CategoryZ, PoolStats
from .roster_profile import RosterProfile
from .standings import MAJORITY, category_win_probs, head_to_head, win_count_distribution

# A category (or a week) is "likely" at this chance or more, and a likely
# loss at 100 - LIKELY_PCT or less; in between it is a toss-up.
LIKELY_PCT = 60
DRIVERS = 2  # players named on the favoured side of a category

STAT_KEY: dict[Category, str] = {
    "PTS": "pts", "REB": "reb", "AST": "ast", "STL": "stl", "BLK": "blk",
    "3PM": "tpm", "TO": "tov",
}
COUNTING: tuple[Category, ...] = ("PTS", "REB", "AST", "STL", "BLK", "3PM")


def pct(p: float) -> int:
    return int(round(p * 100))


def outlook(win_pct: int) -> str:
    """"win" / "tossup" / "loss" for a category at this chance."""
    if win_pct >= LIKELY_PCT:
        return "win"
    if win_pct <= 100 - LIKELY_PCT:
        return "loss"
    return "tossup"


def band(win_pct: int) -> str:
    """"favored" / "tossup" / "underdog" for a week at this chance."""
    return {"win": "favored", "loss": "underdog"}.get(outlook(win_pct), "tossup")


def team_line(roster: list[Player], stats: PoolStats | None) -> dict[str, float | None]:
    """Per-game roster totals, availability-adjusted the way the model is:
    counting stats blend in a replacement's share for missed games, TO stays
    per game, percentages are over the games actually played. Without pool
    stats (no availability data) they are plain per-game sums."""
    out: dict[str, float | None] = {c: 0.0 for c in CATEGORIES}
    fgm = fga = ftm = fta = 0.0
    for p in roster:
        a = stats.availability.get(p.id, 1.0) if stats else 1.0
        for c in COUNTING:
            own = getattr(p, STAT_KEY[c])
            fill = (1 - a) * STREAM_SHARE * stats.replacement[c] if stats else 0.0
            out[c] += a * own + fill  # type: ignore[operator]
        out["TO"] += p.tov  # type: ignore[operator]
        fgm += a * p.fgm
        fga += a * p.fga
        ftm += a * p.ftm
        fta += a * p.fta
    out["FG%"] = fgm / fga if fga else None
    out["FT%"] = ftm / fta if fta else None
    out["fga"] = fga
    out["fta"] = fta
    return out


def _driver(p: Player, c: Category, side: str) -> dict[str, Any]:
    if c == "FG%":
        return {"playerId": p.id, "side": side, "stat": p.fgm / p.fga if p.fga else 0.0, "att": p.fga}
    if c == "FT%":
        return {"playerId": p.id, "side": side, "stat": p.ftm / p.fta if p.fta else 0.0, "att": p.fta}
    return {"playerId": p.id, "side": side, "stat": getattr(p, STAT_KEY[c]), "att": None}


def _best(roster: list[Player], values: dict[str, CategoryZ], c: Category, n: int, worst: bool = False) -> list[Player]:
    """The n players who help most in c — or, with `worst`, hurt most."""
    zero: CategoryZ = {k: 0.0 for k in CATEGORIES}
    ranked = sorted(roster, key=lambda p: values.get(p.id, zero)[c], reverse=not worst)[:n]
    # Chosen by expected contribution (availability counts); shown in the
    # order of the per-game line the reader sees.
    return sorted(ranked, key=lambda p: _driver(p, c, "")["stat"], reverse=True)


def drivers(
    c: Category,
    look: str,
    you: list[Player],
    them: list[Player],
    values: dict[str, CategoryZ],
) -> list[dict[str, Any]]:
    """Who decides this category. Counting stats and percentages: the best
    on the favoured side (one per side for a toss-up). TO: the biggest
    turnover sources on the side losing it — that is what loses TO."""
    if c == "TO":
        sides = {"win": [("them", them)], "loss": [("you", you)], "tossup": [("you", you), ("them", them)]}[look]
        n = 1 if look == "tossup" else DRIVERS
        return [_driver(p, c, side) for side, roster in sides for p in _best(roster, values, c, n, worst=True)]
    sides = {"win": [("you", you)], "loss": [("them", them)], "tossup": [("you", you), ("them", them)]}[look]
    n = 1 if look == "tossup" else DRIVERS
    return [_driver(p, c, side) for side, roster in sides for p in _best(roster, values, c, n)]


def matchup(
    me: int,
    other: int,
    profiles: list[RosterProfile],
    ranks: dict[Category, list[int]],
    rosters: list[list[Player]],
    lines: list[dict[str, float | None]],
    values: dict[str, CategoryZ],
    punts: list[set[str]],
) -> dict[str, Any]:
    """One week against `other`: the chance of winning it, the paper result,
    and every category with both totals, its label and its drivers."""
    probs = category_win_probs(profiles[me], profiles[other])
    win_pct = pct(sum(win_count_distribution(probs)[MAJORITY:]))
    cats = []
    likely = 0
    for c in CATEGORIES:
        p = pct(probs[c])
        look = outlook(p)
        likely += look == "win"
        cats.append(
            {
                "cat": c,
                "pct": p,
                "outlook": look,
                "you": lines[me][c],
                "them": lines[other][c],
                "youAtt": lines[me]["fga" if c == "FG%" else "fta"] if c in ("FG%", "FT%") else None,
                "themAtt": lines[other]["fga" if c == "FG%" else "fta"] if c in ("FG%", "FT%") else None,
                "paperLead": ranks[c][me] < ranks[c][other],
                "puntedByYou": c in punts[me],
                "puntedByThem": c in punts[other],
                "drivers": drivers(c, look, rosters[me], rosters[other], values),
            }
        )
    won = sum(1 for c in CATEGORIES if ranks[c][me] < ranks[c][other])
    lost = sum(1 for c in CATEGORIES if ranks[c][me] > ranks[c][other])
    h = head_to_head(ranks, me, other)
    return {
        "teamId": other,
        "winPct": win_pct,
        "band": band(win_pct),
        "paper": {
            "won": won,
            "lost": lost,
            "tied": len(CATEGORIES) - won - lost,
            "result": "win" if h > 0 else "loss" if h < 0 else "tie",
        },
        # Toss-ups still needed for a majority if every likely win holds.
        "need": max(0, MAJORITY - likely),
        "categories": cats,
    }


def matchup_breakdown(
    team_id: int,
    profiles: list[RosterProfile],
    ranks: dict[Category, list[int]],
    rosters: list[list[Player]],
    values: dict[str, CategoryZ],
    stats: PoolStats | None,
    punts: list[set[str]],
) -> dict[str, Any]:
    """The team's week against every other team, best chance first, plus
    the summary the report's headline and category cards are written from."""
    lines = [team_line(r, stats) for r in rosters]
    opponents = [
        matchup(team_id, o, profiles, ranks, rosters, lines, values, punts)
        for o in range(len(profiles))
        if o != team_id
    ]
    opponents.sort(key=lambda m: -m["winPct"])

    paper_wins = [m for m in opponents if m["paper"]["result"] == "win"]
    tossup_leads: dict[str, int] = {}
    for m in paper_wins:
        for cat in m["categories"]:
            if cat["paperLead"] and cat["outlook"] == "tossup":
                tossup_leads[cat["cat"]] = tossup_leads.get(cat["cat"], 0) + 1

    categories: dict[str, Any] = {}
    for c in CATEGORIES:
        counts = {"win": 0, "tossup": 0, "loss": 0}
        for m in opponents:
            counts[next(x["outlook"] for x in m["categories"] if x["cat"] == c)] += 1
        others = [lines[o][c] for o in range(len(profiles)) if o != team_id and lines[o][c] is not None]
        best = _best(rosters[team_id], values, c, 1, worst=(c == "TO"))
        categories[c] = {
            **counts,
            "you": lines[team_id][c],
            "leagueMedian": median(others) if others else None,  # type: ignore[type-var]
            "best": _driver(best[0], c, "you") if best else None,
            "punted": c in punts[team_id],
        }

    n = len(opponents)
    return {
        "teamId": team_id,
        # The week-to-week win rate: the average of the opponents' chances.
        "winPct": pct(sum(m["winPct"] for m in opponents) / (100 * n)) if n else 0,
        "favored": sum(1 for m in opponents if m["band"] == "favored"),
        "tossup": sum(1 for m in opponents if m["band"] == "tossup"),
        "underdog": sum(1 for m in opponents if m["band"] == "underdog"),
        # Paper wins decided by a single category.
        "oneCategoryWins": sum(1 for m in paper_wins if m["paper"]["won"] == MAJORITY),
        "tossupLeads": tossup_leads,
        "categories": categories,
        "opponents": opponents,
    }


def week_pcts(profiles: list[RosterProfile]) -> list[int]:
    """Every team's week-to-week win rate: the rounded average of its rounded
    chances against each other team — the same arithmetic as the breakdown's
    headline, so the standings column and the report never differ by a point."""
    n = len(profiles)
    out = []
    for a in range(n):
        chances = [
            pct(sum(win_count_distribution(category_win_probs(profiles[a], profiles[b]))[MAJORITY:]))
            for b in range(n)
            if b != a
        ]
        out.append(pct(sum(chances) / (100 * len(chances))) if chances else 0)
    return out
