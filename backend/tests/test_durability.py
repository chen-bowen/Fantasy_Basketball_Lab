"""Availability from games played and injury status, how it feeds player
values, and how rivals with different lean appetites react to it."""

from dataclasses import replace

from lab.metrics.durability import (
    LONG_OUT_SHARE,
    SHORT_OUT_SHARE,
    STATUS_SHARES,
    UNSIGNED_SHARE,
    expected_share,
)
from lab.metrics.ratings import (
    RATE_CAP,
    EVEN_WEIGHTS,
    score_pool,
    line_score,
)
from lab.pool.loader import PLAYERS
from lab.domain.autopilot import LEAN_OF_RISK, autopilot_pick, risk_lean
from lab.domain.session import open_session
from lab.domain.model import CATEGORIES, RivalSpec, Player

from .conftest import LEAGUE_SIZE, make_config

SEASONS = ("2025-26", "2024-25", "2023-24")


def make(name: str, gp: dict[str, int], **kw) -> Player:
    base = dict(
        id=name, name=name, team="TST", positions=("G",),
        pts=20, reb=5, ast=5, stl=1, blk=0.5, threes=2,
        fgm=8, fga=17, ftm=4, fta=5, tov=2, season_gp=gp,
    )
    base.update(kw)
    return Player(**base)


def pool(*players: Player) -> list[Player]:
    """Test players plus an anchor that defines the three seasons."""
    anchor = make("anchor", {s: 70 for s in SEASONS})
    return [anchor, *players]


def value_pool(*players: Player) -> list[Player]:
    """pool() plus a healthy bench of weaker lines, so replacement level sits
    below the players under test (in a pool of identical lines, a missed
    game would cost nothing because the replacement is just as good)."""
    bench = [
        make(f"bench{i}", {s: 70 for s in SEASONS},
             pts=8 + i, reb=3, ast=1.5, stl=0.5, blk=0.2, threes=1,
             fgm=3, fga=7, ftm=1, fta=1.3, tov=1)
        for i in range(6)
    ]
    return [*pool(*players), *bench]


def overall(values, pid: str) -> float:
    return line_score(values[pid], EVEN_WEIGHTS)


# ---------- durability from games played ----------


def test_recent_seasons_weigh_more():
    recent_bad = make("recent_bad", {"2025-26": 30, "2024-25": 80, "2023-24": 80})
    old_bad = make("old_bad", {"2025-26": 80, "2024-25": 80, "2023-24": 30})
    a = expected_share(pool(recent_bad, old_bad))
    assert a["recent_bad"] < a["old_bad"]


def test_seasons_before_debut_do_not_count():
    rookie = make("rookie", {"2025-26": 80})
    missed_two = make("missed_two", {"2023-24": 80}, status="Out")
    a = expected_share(pool(rookie, missed_two))
    assert a["rookie"] > a["missed_two"]


def test_one_long_absence_is_forgiven_only_once_healthy():
    """A season mostly missed counts at a reduced weight once he's back, in full
    while he's still hurt — and never disappears entirely."""
    healthy_now = make("healthy_now", {"2025-26": 10, "2024-25": 75, "2023-24": 75})
    still_out = make("still_out", {"2025-26": 10, "2024-25": 75, "2023-24": 75}, status="Out")
    durable = make("durable", {"2025-26": 75, "2024-25": 75, "2023-24": 75})
    a = expected_share(pool(healthy_now, still_out, durable))
    assert a["still_out"] < a["healthy_now"] < a["durable"]
    assert a["healthy_now"] < a["durable"] - 0.1  # the absence still counts


def test_two_long_absences_mark_injury_prone():
    one_off = make("one_off", {"2025-26": 10, "2024-25": 75, "2023-24": 75})
    chronic = make("chronic", {"2025-26": 10, "2024-25": 75, "2023-24": 10})
    a = expected_share(pool(one_off, chronic))
    assert a["chronic"] < a["one_off"] - 0.05


def test_unsigned_players_are_discounted():
    signed = make("signed", {s: 70 for s in SEASONS})
    unsigned = make("unsigned", {s: 70 for s in SEASONS}, signed=False)
    a = expected_share(pool(signed, unsigned))
    assert abs(a["unsigned"] - a["signed"] * UNSIGNED_SHARE) < 1e-9


# ---------- current injury status ----------


def test_day_to_day_costs_a_few_games():
    healthy = make("healthy", {s: 70 for s in SEASONS})
    dtd = make("dtd", {s: 70 for s in SEASONS}, status="Day-To-Day")
    a = expected_share(pool(healthy, dtd))
    assert abs(a["dtd"] - a["healthy"] * STATUS_SHARES["Day-To-Day"]) < 1e-9


def test_out_is_graded_by_how_much_of_the_season_he_has_played():
    late_knock = make("late_knock", {"2025-26": 78, "2024-25": 75, "2023-24": 75}, status="Out")
    lingering = make("lingering", {"2025-26": 40, "2024-25": 75, "2023-24": 75}, status="Out")
    long_term = make("long_term", {"2025-26": 5, "2024-25": 75, "2023-24": 75}, status="Out")
    season_lost = make("season_lost", {"2024-25": 75, "2023-24": 75}, status="Out")
    # Healthy twins in the same pool, so the shrinkage prior is shared.
    twins = [
        replace(late_knock, id="late_knock_ok", status=None),
        replace(long_term, id="long_term_ok", status=None),
    ]
    a = expected_share(pool(late_knock, lingering, long_term, season_lost, *twins))
    assert a["season_lost"] < a["long_term"] < a["lingering"] < a["late_knock"]
    # Ends of the scale: a late knock costs a tenth of the season…
    assert abs(a["late_knock"] / a["late_knock_ok"] - SHORT_OUT_SHARE) < 1e-9
    # …a long-term "Out" costs most of it, and his mostly-missed season is
    # also read as still-injured (full weight) rather than forgiven.
    assert a["long_term"] / a["long_term_ok"] < LONG_OUT_SHARE + 1e-9


def test_unknown_status_is_treated_as_minor():
    odd = make("odd", {s: 70 for s in SEASONS}, status="Probable")
    healthy = make("healthy", {s: 70 for s in SEASONS})
    a = expected_share(pool(odd, healthy))
    assert a["healthy"] * 0.9 < a["odd"] < a["healthy"]


# ---------- how availability turns into value ----------


def test_percentage_scores_are_capped():
    values, _ = score_pool(PLAYERS)
    worst = min(min(v["FG%"], v["FT%"]) for v in values.values())
    best = max(max(v["FG%"], v["FT%"]) for v in values.values())
    assert -RATE_CAP <= worst and best <= RATE_CAP
    assert worst == -RATE_CAP  # the cap actually binds in this pool


def test_missing_games_lowers_value_but_not_turnovers():
    durable = make("durable", {s: 80 for s in SEASONS})
    fragile = make("fragile", {s: 30 for s in SEASONS})
    values, _ = score_pool(value_pool(durable, fragile))
    assert overall(values, "fragile") < overall(values, "durable")
    assert values["fragile"]["TO"] == values["durable"]["TO"]


def test_missed_star_games_cost_more_than_missed_bench_games():
    """A missed game is played by a replacement-level pickup, so the drop
    from full health is proportional to how far above that level he is."""
    star = make("star", {s: 40 for s in SEASONS}, pts=30, reb=10, ast=8, stl=1.8, blk=1.2, threes=3)
    bench = make("bench", {s: 40 for s in SEASONS}, pts=8, reb=3, ast=1.5, stl=0.5, blk=0.2, threes=1)
    values, stats = score_pool(value_pool(star, bench))
    cost = lambda pid: overall(stats.healthy_values, pid) - overall(values, pid)
    assert cost("star") > cost("bench") + 1.0
    assert stats.avail["star"] == stats.avail["bench"]


def test_healthy_values_are_what_a_full_season_would_be_worth():
    durable = make("durable", {s: 82 for s in SEASONS})
    fragile = make("fragile", {s: 30 for s in SEASONS})
    values, stats = score_pool(value_pool(durable, fragile))
    # Identical lines: same value if both played every game…
    assert all(
        abs(stats.healthy_values["fragile"][c] - stats.healthy_values["durable"][c]) < 1e-9
        for c in CATEGORIES
    )
    # …and the adjusted value never exceeds the healthy one.
    assert overall(values, "fragile") < overall(stats.healthy_values, "fragile")


def test_pool_injury_status_moves_the_ranking():
    """In the frozen dataset, a player tagged Out after a mostly-missed
    season ranks well below where his per-game line alone would put him."""
    values, stats = score_pool(PLAYERS)
    rank = lambda vals: {
        pid: i for i, pid in enumerate(sorted(vals, key=lambda k: -overall(vals, k)))
    }
    r_adj, r_healthy = rank(values), rank(stats.healthy_values)
    long_term_out = [
        p.id for p in PLAYERS
        if p.status == "Out" and p.season_gp.get("2025-26", 0) < 25 and p.signed
        and r_healthy[p.id] < 156  # draftable on his line alone
    ]
    assert long_term_out  # the dataset has such players
    for pid in long_term_out:
        assert r_adj[pid] > r_healthy[pid] + 20
    # A player who never plays is worth less than a healthy 13th man, so
    # nobody on no roster is draftable in a 12 x 13 league.
    assert all(r_adj[p.id] >= 156 for p in PLAYERS if not p.signed)


# ---------- rival lean appetite ----------


def test_risk_tilts_scale_the_availability_cost():
    values, stats = score_pool(PLAYERS)
    fragile = max(
        PLAYERS,
        key=lambda p: overall(stats.healthy_values, p.id) - overall(values, p.id),
    )
    z, h = values[fragile.id], stats.healthy_values[fragile.id]
    cost = overall(stats.healthy_values, fragile.id) - overall(values, fragile.id)
    assert cost > 0
    bold = risk_lean(RivalSpec(style="value", lean="bold"), z, h, EVEN_WEIGHTS)
    cautious = risk_lean(RivalSpec(style="value", lean="cautious"), z, h, EVEN_WEIGHTS)
    neutral = risk_lean(RivalSpec(style="value", lean="neutral"), z, h, EVEN_WEIGHTS)
    assert abs(bold - LEAN_OF_RISK["bold"] * cost) < 1e-9
    assert abs(cautious - LEAN_OF_RISK["cautious"] * cost) < 1e-9
    assert neutral == 0.0
    assert risk_lean(RivalSpec(style="value", lean="bold"), z, None, EVEN_WEIGHTS) == 0.0


def test_bold_bot_takes_the_hurt_star_earlier_than_a_cautious_one(pool, values, healthy_values):
    """Run the same pick with each appetite: the bold rival's choice is at
    least as risky (lower availability-adjusted share of healthy value)."""
    _, stats = score_pool(PLAYERS)

    def first_pick(lean: str) -> str:
        specs = tuple(RivalSpec(style="value", lean=lean) for _ in range(LEAGUE_SIZE))
        state = open_session(make_config(seed="lean-seed", rivals=specs))
        return autopilot_pick(state, pool, values, 0, healthy_values)

    picks = {r: first_pick(r) for r in ("cautious", "neutral", "bold")}
    avail = {r: stats.avail[pid] for r, pid in picks.items()}
    assert avail["bold"] <= avail["neutral"] <= avail["cautious"]


def test_risk_is_assigned_and_survives_serialization():
    from lab.domain.autopilot import deal_rivals
    from lab.domain.session import DraftSettings

    specs = deal_rivals("any-seed", LEAGUE_SIZE, 0)
    leans = {s.lean for i, s in enumerate(specs) if i != 0}
    assert leans == {"cautious", "neutral", "bold"}
    config = DraftSettings(LEAGUE_SIZE, 13, 0, "any-seed", specs)
    assert DraftSettings.from_dict(config.to_dict()) == config
    # Saves from before lean existed load as neutral.
    old = {**config.to_dict()}
    old["botSpecs"] = [{"style": s["style"], "puntCategory": s["puntCategory"]} for s in old["botSpecs"]]
    assert all(s.lean == "neutral" for s in DraftSettings.from_dict(old).rivals)
