#!/usr/bin/env python3
"""fetch_players — regenerate lab/pool/players.json from stats.nba.com.

Pulls per-game regular-season stats (leaguedashplayerstats) for the last
completed NBA season, plus current team and positions from ESPN team rosters.
Stats rows only know the team a player finished last season with, so the
roster is the source of truth for ``team``; players on no current roster get
``signed: false`` and keep their last team in ``lastTeam``. Players who missed
most of the season fall back to the prior season's stats — the "last
available season" rule — and are tagged via ``as_of_season``. Each player
also carries ``gpBySeason``: games played in each of the last three
completed seasons (newest first).

ADP comes from FantasyPros' public ADP table (Yahoo/ESPN average), scraped
from the server-rendered overall page and joined by normalized name. ADP is
enrichment only — a failure there never blocks the stats pipeline.

Usage:
    python backend/scripts/fetch_players.py [--season 2025-26] [--prev 2024-25] [--prev2 2023-24] [--no-cache]

No API key needed. stats.nba.com requires browser-ish headers and rate-limits
aggressively — raw responses cache under backend/.cache/ for 12h.
"""

from __future__ import annotations

import argparse
import json
import re
import time
import unicodedata
from datetime import datetime
from pathlib import Path

import httpx

ROOT = Path(__file__).resolve().parent.parent
OUT_PATH = ROOT / "lab" / "pool" / "players.json"
CACHE_DIR = ROOT / ".cache" / "nba"
CACHE_MS = 12 * 60 * 60  # seconds

NBA_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
        "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
    ),
    "Referer": "https://www.nba.com/",
    "Origin": "https://www.nba.com",
    "x-nba-stats-token": "true",
    "x-nba-stats-origin": "stats",
    "Accept": "application/json, text/plain, */*",
    "Accept-Language": "en-US,en;q=0.9",
}

MIN_GAMES = 30
MIN_MINUTES = 14
FALLBACK_MIN_GAMES = 20
MAX_PLAYERS = 280

# ESPN position abbreviations → our position list.
POSITION_MAP = {
    "PG": ["PG"], "SG": ["SG"], "SF": ["SF"], "PF": ["PF"], "C": ["C"],
    "G": ["G"], "F": ["F"],
    "G-F": ["G", "F"], "F-G": ["F", "G"], "F-C": ["F", "C"], "C-F": ["C", "F"],
    "C-G": ["C", "G"], "G-C": ["G", "C"],
}

ESPN_TEAM_IDS = list(range(1, 31))

# ESPN team abbreviations that differ from stats.nba.com's.
ESPN_TO_NBA_TEAM = {
    "GS": "GSW", "NO": "NOP", "NY": "NYK", "SA": "SAS", "UTAH": "UTA", "WSH": "WAS",
}


def default_seasons() -> tuple[str, str, str]:
    """NBA seasons start in October; last completed season ended this year."""
    now = datetime.now()
    start_year = now.year if now.month >= 9 else now.year - 1
    fmt = lambda y: f"{y}-{str(y + 1)[2:]}"
    return fmt(start_year - 1), fmt(start_year - 2), fmt(start_year - 3)


def cached(key: str, fetcher, no_cache: bool, permanent: bool = False):
    """Fetch through the cache. Entries expire after CACHE_MS unless
    `permanent` (completed-season stats never change). If a refresh fails,
    the last cached copy is used instead."""
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    path = CACHE_DIR / f"{key}.json"
    blob = json.loads(path.read_text()) if path.exists() else None
    if blob and not no_cache:
        if permanent or time.time() * 1000 - blob["at"] < CACHE_MS * 1000:
            return blob["data"]
    try:
        data = fetcher()
    except Exception as e:  # noqa: BLE001 — any network failure falls back to cache
        if blob is None:
            raise
        print(f"  {key}: refresh failed ({e.__class__.__name__}), using cached copy")
        return blob["data"]
    path.write_text(json.dumps({"at": time.time() * 1000, "data": data}))
    return data


def nba_get(client: httpx.Client, endpoint: str, params: dict, tries: int = 4):
    url = f"https://stats.nba.com/stats/{endpoint}"
    last_err: Exception | None = None
    for t in range(tries):
        try:
            res = client.get(url, params=params, timeout=45.0)
            res.raise_for_status()
            payload = res.json()
            result = (payload.get("resultSets") or [payload.get("resultSet")])[0]
            cols = result["headers"]
            return [dict(zip(cols, row)) for row in result["rowSet"]]
        except Exception as e:  # noqa: BLE001 — retry everything, this API is flaky
            last_err = e
            time.sleep(3 * (t + 1))
    raise last_err  # type: ignore[misc]


def stats_params(season: str) -> dict:
    keys = {
        "College": "", "Conference": "", "Country": "", "DateFrom": "",
        "DateTo": "", "Division": "", "DraftPick": "", "DraftYear": "",
        "GameScope": "", "GameSegment": "", "Height": "", "LastNGames": "0",
        "LeagueID": "00", "Location": "", "MeasureType": "Base", "Month": "0",
        "OpponentTeamID": "0", "Outcome": "", "PORound": "0", "PaceAdjust": "N",
        "PerMode": "PerGame", "Period": "0", "PlayerExperience": "",
        "PlayerPosition": "", "PlusMinus": "N", "Rank": "N", "Season": season,
        "SeasonSegment": "", "SeasonType": "Regular Season", "ShotClockRange": "",
        "StarterBench": "", "TeamID": "0", "TwoWay": "0", "VsConference": "",
        "VsDivision": "", "Weight": "",
    }
    return keys


def espn_gp_by_player(client: httpx.Client, year: int) -> dict[str, int]:
    """normName -> games played in the regular season ending in `year`
    (e.g. 2024 = the 2023-24 season). Fallback for when stats.nba.com is
    unreachable — ESPN stats have no nba.com ids, so we join by name.
    """
    out: dict[str, int] = {}
    page = 1
    while True:
        res = client.get(
            "https://site.web.api.espn.com/apis/common/v3/sports/basketball/nba/statistics/byathlete",
            params={
                "region": "us", "lang": "en", "contentorigin": "espn",
                "page": page, "limit": 100, "season": year, "seasontype": 2,
            },
            timeout=30.0,
        )
        res.raise_for_status()
        data = res.json()
        names = next(c for c in data["categories"] if c["name"] == "general")["names"]
        gpi = names.index("gamesPlayed")
        for a in data["athletes"]:
            totals = next(c for c in a["categories"] if c["name"] == "general")["totals"]
            out[norm_name(a["athlete"]["displayName"])] = int(float(totals[gpi]))
        if page >= data["pagination"]["pages"]:
            return out
        page += 1


FP_ADP_URL = "https://www.fantasypros.com/nba/adp/overall.php"

# <tr><td>rank</td><td class="player-label"><a ... fp-player-name="X">…
# <td>Yahoo</td><td>ESPN</td><td>AVG</td> — a source shows &nbsp; when missing,
# and hurt players carry an extra status <small> inside the label cell.
ADP_ROW_RE = re.compile(
    r'<tr><td>\d+</td>\s*'
    r'<td class="player-label">(.*?)</td>\s*'
    r"<td>([\d.]+|&nbsp;)</td>\s*"
    r"<td>([\d.]+|&nbsp;)</td>\s*"
    r"<td>([\d.]+)</td>",
    re.S,
)
ADP_NAME_RE = re.compile(r'fp-player-name="([^"]+)"')


def fantasypros_adp(client: httpx.Client, no_cache: bool) -> dict[str, float]:
    """normName -> aggregated ADP (Yahoo+ESPN average) from FantasyPros."""

    def fetch():
        res = client.get(FP_ADP_URL, timeout=30.0)
        res.raise_for_status()
        return res.text

    html = cached("fp-adp", fetch, no_cache)
    out: dict[str, float] = {}
    for cell, _yh, _espn, avg in ADP_ROW_RE.findall(html):
        m = ADP_NAME_RE.search(cell)
        if m:
            out[norm_name(m.group(1))] = float(avg)
    return out


def norm_name(name: str) -> str:
    """Normalize a name for cross-source joins: lowercase, strip accents/suffixes."""
    s = unicodedata.normalize("NFD", name)
    s = "".join(ch for ch in s if unicodedata.category(ch) != "Mn")
    s = s.lower()
    s = re.sub(r"\b(jr|sr|ii|iii|iv|v)\b\.?", "", s)
    return re.sub(r"[^a-z0-9]", "", s)


def infer_position(row: dict) -> list[str]:
    """Position guessed from stats for players missing from ESPN rosters."""
    if (row.get("BLK") or 0) >= 1.2:
        return ["C"]
    if (row.get("AST") or 0) >= 4.2:
        return ["G"]
    return ["F"]


def espn_rosters(client: httpx.Client, no_cache: bool) -> dict[str, dict]:
    """normName -> {team, positions, injury} for every player on a current roster.
    `injury` is ESPN's current status ("Out", "Day-To-Day", …) or None."""
    out: dict[str, dict] = {}
    for tid in ESPN_TEAM_IDS:
        def fetch(tid=tid):
            res = client.get(
                f"https://site.api.espn.com/apis/site/v2/sports/basketball/nba/teams/{tid}/roster",
                timeout=15.0,
            )
            res.raise_for_status()
            return res.json()

        data = cached(f"espn-roster-{tid}", fetch, no_cache)
        abbr = (data.get("team") or {}).get("abbreviation", "")
        team = ESPN_TO_NBA_TEAM.get(abbr, abbr)
        for a in data.get("athletes") or []:
            if not a.get("displayName"):
                continue
            pos = (a.get("position") or {}).get("abbreviation")
            injuries = a.get("injuries") or []
            out[norm_name(a["displayName"])] = {
                "team": team,
                "positions": POSITION_MAP.get(pos, ["F"]) if pos else None,
                "status": injuries[0].get("status") if injuries else None,
            }
    return out


def r1(x) -> float:
    return round(float(x or 0), 1)


def to_player(
    row: dict,
    roster_by_name: dict[str, dict],
    season: str,
    gp_by_season: dict[str, int],
    adp_by_name: dict[str, float],
) -> dict:
    nba_id = row["PLAYER_ID"]
    last_team = row.get("TEAM_ABBREVIATION") or ""
    nn = norm_name(row["PLAYER_NAME"])
    on_roster = roster_by_name.get(nn)
    return {
        "id": f"nba-{nba_id}",
        "adp": adp_by_name.get(nn),
        "refId": nba_id,
        "name": row["PLAYER_NAME"],
        "team": on_roster["team"] if on_roster else "",
        "lastTeam": last_team,
        "signed": on_roster is not None,
        "status": on_roster.get("status") if on_roster else None,
        "positions": (on_roster and on_roster["positions"]) or infer_position(row),
        "season": season,
        "gp": row.get("GP") or 0,
        "seasonGp": gp_by_season,
        "mpg": r1(row.get("MIN")),
        "pts": r1(row.get("PTS")),
        "reb": r1(row.get("REB")),
        "ast": r1(row.get("AST")),
        "stl": r1(row.get("STL")),
        "blk": r1(row.get("BLK")),
        "threes": r1(row.get("FG3M")),
        "fgm": r1(row.get("FGM")),
        "fga": r1(row.get("FGA")),
        "ftm": r1(row.get("FTM")),
        "fta": r1(row.get("FTA")),
        "tov": r1(row.get("TOV")),
    }


def meaningful(row: dict) -> bool:
    return (row.get("GP") or 0) >= MIN_GAMES and (row.get("MIN") or 0) >= MIN_MINUTES


def main() -> None:
    ap = argparse.ArgumentParser()
    d_season, d_prev, d_prev2 = default_seasons()
    ap.add_argument("--season", default=d_season)
    ap.add_argument("--prev", default=d_prev)
    ap.add_argument("--prev2", default=d_prev2)
    ap.add_argument("--no-cache", action="store_true")
    args = ap.parse_args()
    season, prev, prev2, no_cache = args.season, args.prev, args.prev2, args.no_cache
    print(f"Season: {season} (fallback {prev}, gp history thru {prev2})")

    def get_stats(client: httpx.Client, s: str) -> list[dict] | None:
        """stats.nba.com rows for a season, or None when the API is unreachable."""
        have_espn_fill = (CACHE_DIR / f"espn-gp-{s}.json").exists()
        if not no_cache and have_espn_fill and not (CACHE_DIR / f"stats-{s}.json").exists():
            return None  # an earlier run already fell back to ESPN for this season
        try:
            return cached(f"stats-{s}",
                          lambda: nba_get(client, "leaguedashplayerstats", stats_params(s)),
                          no_cache, permanent=True)
        except Exception as e:  # noqa: BLE001 — report and try ESPN for the gap
            print(f"  stats.nba.com failed for {s}: {e}")
            return None

    with httpx.Client(headers=NBA_HEADERS, follow_redirects=True) as client:
        stats = get_stats(client, season)
        prev_stats = get_stats(client, prev)
        prev2_stats = get_stats(client, prev2)
        if stats is None:
            raise SystemExit(
                f"no {season} stats (stats.nba.com unreachable, nothing cached) — aborting"
            )

        # Fill season gaps in the GP history from ESPN (joined by name).
        espn_gp: dict[str, dict[str, int]] = {}
        for s, rows in ((season, stats), (prev, prev_stats), (prev2, prev2_stats)):
            if rows is not None:
                continue
            year = int(s.split("-")[0]) + 1
            espn_gp[s] = cached(
                f"espn-gp-{s}",
                lambda y=year: espn_gp_by_player(client, y),
                no_cache,
                permanent=True,
            )
            print(f"  {s} games played via ESPN: {len(espn_gp[s])} players")

        # v2: entries carry injury status (older cached entries don't).
        roster_by_name = cached("espn-rosters-v2",
                                lambda: espn_rosters(client, no_cache),
                                no_cache)
        try:
            adp_by_name = fantasypros_adp(client, no_cache)
        except Exception as e:  # noqa: BLE001 — ADP is enrichment, never fatal
            print(f"  fantasypros ADP failed: {e}")
            adp_by_name = {}

    print(f"{season}: {len(stats)} rows | {prev}: {len(prev_stats or [])} rows | "
          f"{prev2}: {len(prev2_stats or [])} rows | "
          f"espn roster players: {len(roster_by_name)} | "
          f"fantasypros ADP rows: {len(adp_by_name)}")

    # nba_id -> games played in each of the last three seasons (newest first).
    gp_history: dict[int, dict[str, int]] = {}
    for s, rows in ((season, stats), (prev, prev_stats or []), (prev2, prev2_stats or [])):
        for r in rows:
            gp_history.setdefault(r["PLAYER_ID"], {})[s] = r.get("GP") or 0

    def gp_lookup(nba_id: int, name: str) -> dict[str, int]:
        """Season -> GP for one player, filling seasons ESPN covered by name."""
        hist = dict(gp_history.get(nba_id, {}))
        nn = norm_name(name)
        for s, by_name in espn_gp.items():
            if nn in by_name:
                hist[s] = by_name[nn]
        return hist

    primary = [r for r in stats if meaningful(r)]
    primary_ids = {r["PLAYER_ID"] for r in primary}
    if prev_stats is None:
        print(f"  no {prev} stats — skipping last-available-season fallbacks")
        fallback = []
    else:
        fallback = [
            r for r in prev_stats
            if r["PLAYER_ID"] not in primary_ids
            and (r.get("GP") or 0) >= FALLBACK_MIN_GAMES
            and (r.get("MIN") or 0) >= MIN_MINUTES
        ]

    players = [
        to_player(r, roster_by_name, season, gp_lookup(r["PLAYER_ID"], r["PLAYER_NAME"]),
                  adp_by_name)
        for r in primary
    ]
    players += [
        to_player(r, roster_by_name, prev, gp_lookup(r["PLAYER_ID"], r["PLAYER_NAME"]),
                  adp_by_name)
        for r in fallback
    ]

    players.sort(key=lambda p: (-p["mpg"], -p["pts"]))
    players = players[:MAX_PLAYERS]
    players.sort(key=lambda p: (-p["pts"], p["name"]))

    OUT_PATH.write_text(json.dumps(players, indent=1) + "\n")
    moved = sum(1 for p in players if p["signed"] and p["team"] != p["lastTeam"])
    unsigned = [p["name"] for p in players if not p["signed"]]
    print(f"wrote {len(players)} players ({len(fallback)} from {prev}) → {OUT_PATH}")
    injured = sum(1 for p in players if p["status"])
    print(f"  {moved} changed teams since last season; {len(unsigned)} on no current roster; "
          f"{injured} with an injury status")
    if unsigned:
        print("  unsigned: " + ", ".join(unsigned))


if __name__ == "__main__":
    main()
