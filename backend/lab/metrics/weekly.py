"""Your week against each team, explained by players.

The draft report shows two table_records side by side:

  - "On paper": standings.table_records — you beat a team if you rank higher in
    more of the 9 categories. Every lead counts the same, however small.
  - "Week to week": the chance of actually winning each duel_card in a
    typical week, from standings.duel_prob — a small lead, or a
    lead in a category that swings a lot (STL, FT%, TO), is close to a
    coin flip. Averaged over the 11 opponents it is the team's win rate;
    win_expectation / 11 on the build screens is the same number.

Both are equal-games comparisons of drafted rosters, not forecasts of a
real week: no schedule, no later injuries, no lineup moves.

This module lays one duel_card out like a tale of the tape so the label on
each category is just the reading of two numbers and two players:

    PTS   you 243  ·  them 220   likely win    A. Corbin 23.9 · B. Reyes 22.1

  - The totals are per game for the whole roster, with the same
    availability adjustment the model uses (a player expected to miss
    games counts for the share he plays plus a replacement's share), so
    the numbers never contradict the labels.
  - The deciders are the players who decide the category: the two best on
    the favoured side; for a toss-up, the best on each side; for TO, the
    biggest turnover sources on the side that is losing it.
  - Likely win / toss-up / likely loss are whole-percent bands
    (EDGE_PCT) and the same bands name the week: favored / toss-up /
    underdog. Labels are assigned on the rounded percent, so a label never
    disagrees with the number shown next to it.
"""

from __future__ import annotations

from statistics import median
from typing import Any

from ..domain.model import CATEGORIES, Category, Player
from .ratings import FILL_SHARE, CatScores, Baseline
from .profile import RosterLine
from .table import CATS_NEEDED, cat_probs, duel, win_dist

# A category (or a week) is "likely" at this chance or more, and a likely
# loss at 100 - EDGE_PCT or less; in between it is a toss-up.
EDGE_PCT = 60
NAMED = 2  # players named on the favoured side of a category

LINE_KEY: dict[Category, str] = {
    "PTS": "pts", "REB": "reb", "AST": "ast", "STL": "stl", "BLK": "blk",
    "3PM": "threes", "TO": "tov",
}
COUNTING_CATS: tuple[Category, ...] = ("PTS", "REB", "AST", "STL", "BLK", "3PM")


def to_pct(p: float) -> int:
    return int(round(p * 100))


def verdict(win_pct: int) -> str:
    """"win" / "tossup" / "loss" for a category at this chance."""
    if win_pct >= EDGE_PCT:
        return "win"
    if win_pct <= 100 - EDGE_PCT:
        return "loss"
    return "tossup"


def bracket(win_pct: int) -> str:
    """"favored" / "tossup" / "underdog" for a week at this chance."""
    return {"win": "favored", "loss": "underdog"}.get(verdict(win_pct), "tossup")


def week_totals(roster: list[Player], stats: Baseline | None) -> dict[str, float | None]:
    """Per-game roster totals, availability-adjusted the way the model is:
    counting stats blend in a replacement's share for missed games, TO stays
    per game, percentages are over the games actually played. Without pool
    stats (no availability data) they are plain per-game sums."""
    out: dict[str, float | None] = {c: 0.0 for c in CATEGORIES}
    fgm = fga = ftm = fta = 0.0
    for p in roster:
        a = stats.avail.get(p.id, 1.0) if stats else 1.0
        for c in COUNTING_CATS:
            own = getattr(p, LINE_KEY[c])
            fill = (1 - a) * FILL_SHARE * stats.replacement[c] if stats else 0.0
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
        return {"pid": p.id, "side": side, "stat": p.fgm / p.fga if p.fga else 0.0, "att": p.fga}
    if c == "FT%":
        return {"pid": p.id, "side": side, "stat": p.ftm / p.fta if p.fta else 0.0, "att": p.fta}
    return {"pid": p.id, "side": side, "stat": getattr(p, LINE_KEY[c]), "att": None}


def _best(roster: list[Player], values: dict[str, CatScores], c: Category, n: int, worst: bool = False) -> list[Player]:
    """The n players who help most in c — or, with `worst`, hurt most."""
    zero: CatScores = {k: 0.0 for k in CATEGORIES}
    ranked = sorted(roster, key=lambda p: values.get(p.id, zero)[c], reverse=not worst)[:n]
    # Chosen by expected contribution (availability counts); shown in the
    # order of the per-game line the reader sees.
    return sorted(ranked, key=lambda p: _driver(p, c, "")["stat"], reverse=True)


def deciders(
    c: Category,
    look: str,
    you: list[Player],
    them: list[Player],
    values: dict[str, CatScores],
) -> list[dict[str, Any]]:
    """Who decides this category. Counting stats and percentages: the best
    on the favoured side (one per side for a toss-up). TO: the biggest
    turnover sources on the side losing it — that is what loses TO."""
    if c == "TO":
        sides = {"win": [("them", them)], "loss": [("you", you)], "tossup": [("you", you), ("them", them)]}[look]
        n = 1 if look == "tossup" else NAMED
        return [_driver(p, c, side) for side, roster in sides for p in _best(roster, values, c, n, worst=True)]
    sides = {"win": [("you", you)], "loss": [("them", them)], "tossup": [("you", you), ("them", them)]}[look]
    n = 1 if look == "tossup" else NAMED
    return [_driver(p, c, side) for side, roster in sides for p in _best(roster, values, c, n)]


def duel_card(
    me: int,
    other: int,
    profiles: list[RosterLine],
    ranks: dict[Category, list[int]],
    rosters: list[list[Player]],
    lines: list[dict[str, float | None]],
    values: dict[str, CatScores],
    concedes: list[set[str]],
) -> dict[str, Any]:
    """One week against `other`: the chance of winning it, the paper result,
    and every category with both totals, its label and its deciders."""
    probs = cat_probs(profiles[me], profiles[other])
    win_pct = to_pct(sum(win_dist(probs)[CATS_NEEDED:]))
    cats = []
    likely = 0
    for c in CATEGORIES:
        p = to_pct(probs[c])
        look = verdict(p)
        likely += look == "win"
        cats.append(
            {
                "cat": c,
                "pct": p,
                "verdict": look,
                "you": lines[me][c],
                "them": lines[other][c],
                "youAtt": lines[me]["fga" if c == "FG%" else "fta"] if c in ("FG%", "FT%") else None,
                "themAtt": lines[other]["fga" if c == "FG%" else "fta"] if c in ("FG%", "FT%") else None,
                "paperLead": ranks[c][me] < ranks[c][other],
                "concededByYou": c in concedes[me],
                "concededByThem": c in concedes[other],
                "deciders": deciders(c, look, rosters[me], rosters[other], values),
            }
        )
    won = sum(1 for c in CATEGORIES if ranks[c][me] < ranks[c][other])
    lost = sum(1 for c in CATEGORIES if ranks[c][me] > ranks[c][other])
    h = duel(ranks, me, other)
    return {
        "squad": other,
        "winPct": win_pct,
        "bracket": bracket(win_pct),
        "paper": {
            "won": won,
            "lost": lost,
            "tied": len(CATEGORIES) - won - lost,
            "result": "win" if h > 0 else "loss" if h < 0 else "tie",
        },
        # Toss-ups still needed for a majority if every likely win holds.
        "need": max(0, CATS_NEEDED - likely),
        "categories": cats,
    }


def week_board(
    squad: int,
    profiles: list[RosterLine],
    ranks: dict[Category, list[int]],
    rosters: list[list[Player]],
    values: dict[str, CatScores],
    stats: Baseline | None,
    concedes: list[set[str]],
) -> dict[str, Any]:
    """The team's week against every other team, best chance first, plus
    the summary the report's headline and category cards are written from."""
    lines = [week_totals(r, stats) for r in rosters]
    opponents = [
        duel_card(squad, o, profiles, ranks, rosters, lines, values, concedes)
        for o in range(len(profiles))
        if o != squad
    ]
    opponents.sort(key=lambda m: -m["winPct"])

    paper_wins = [m for m in opponents if m["paper"]["result"] == "win"]
    tossup_leads: dict[str, int] = {}
    for m in paper_wins:
        for cat in m["categories"]:
            if cat["paperLead"] and cat["verdict"] == "tossup":
                tossup_leads[cat["cat"]] = tossup_leads.get(cat["cat"], 0) + 1

    categories: dict[str, Any] = {}
    for c in CATEGORIES:
        counts = {"win": 0, "tossup": 0, "loss": 0}
        for m in opponents:
            counts[next(x["verdict"] for x in m["categories"] if x["cat"] == c)] += 1
        others = [lines[o][c] for o in range(len(profiles)) if o != squad and lines[o][c] is not None]
        best = _best(rosters[squad], values, c, 1, worst=(c == "TO"))
        categories[c] = {
            **counts,
            "you": lines[squad][c],
            "leagueMedian": median(others) if others else None,  # type: ignore[type-var]
            "best": _driver(best[0], c, "you") if best else None,
            "conceded": c in concedes[squad],
        }

    n = len(opponents)
    return {
        "squad": squad,
        # The week-to-week win rate: the average of the opponents' chances.
        "winPct": to_pct(sum(m["winPct"] for m in opponents) / (100 * n)) if n else 0,
        "favored": sum(1 for m in opponents if m["bracket"] == "favored"),
        "tossup": sum(1 for m in opponents if m["bracket"] == "tossup"),
        "underdog": sum(1 for m in opponents if m["bracket"] == "underdog"),
        # Paper wins decided by a single category.
        "oneCategoryWins": sum(1 for m in paper_wins if m["paper"]["won"] == CATS_NEEDED),
        "tossupLeads": tossup_leads,
        "categories": categories,
        "opponents": opponents,
    }


def week_rates(profiles: list[RosterLine]) -> list[int]:
    """Every team's week-to-week win rate: the rounded average of its rounded
    chances against each other team — the same arithmetic as the breakdown's
    headline, so the standings column and the report never differ by a point."""
    n = len(profiles)
    out = []
    for a in range(n):
        chances = [
            to_pct(sum(win_dist(cat_probs(profiles[a], profiles[b]))[CATS_NEEDED:]))
            for b in range(n)
            if b != a
        ]
        out.append(to_pct(sum(chances) / (100 * len(chances))) if chances else 0)
    return out
