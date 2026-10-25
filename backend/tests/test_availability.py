"""Availability from games played and injury status, how it feeds player
values, and how bots with different risk appetites react to it."""

from dataclasses import replace

from app.analysis.availability import (
    LONG_TERM_OUT_FACTOR,
    SHORT_TERM_OUT_FACTOR,
    STATUS_FACTORS,
    UNSIGNED_FACTOR,
    compute_availability,
)
from app.analysis.player_values import (
    PCT_Z_CAP,
    UNIFORM_WEIGHTS,
    compute_player_values,
    score_player,
)
from app.data.pool import PLAYERS
from app.engine.bots import RISK_TILT, choose_bot_pick, risk_adjustment
from app.engine.draft import create_draft
from app.engine.types import CATEGORIES, BotSpec, Player

from .conftest import NUM_TEAMS, make_config

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


def value_pool(*players: Player) -> list[Player]:
    """pool() plus a healthy bench of weaker lines, so replacement level sits
    below the players under test (in a pool of identical lines, a missed
    game would cost nothing because the replacement is just as good)."""
    bench = [
        make(f"bench{i}", {s: 70 for s in SEASONS},
             pts=8 + i, reb=3, ast=1.5, stl=0.5, blk=0.2, tpm=1,
             fgm=3, fga=7, ftm=1, fta=1.3, tov=1)
        for i in range(6)
    ]
    return [*pool(*players), *bench]


def overall(values, pid: str) -> float:
    return score_player(values[pid], UNIFORM_WEIGHTS)


# ---------- durability from games played ----------


def test_recent_seasons_weigh_more():
    recent_bad = make("recent_bad", {"2025-26": 30, "2024-25": 80, "2023-24": 80})
    old_bad = make("old_bad", {"2025-26": 80, "2024-25": 80, "2023-24": 30})
    a = compute_availability(pool(recent_bad, old_bad))
    assert a["recent_bad"] < a["old_bad"]


def test_seasons_before_debut_do_not_count():
    rookie = make("rookie", {"2025-26": 80})
    missed_two = make("missed_two", {"2023-24": 80}, injury="Out")
    a = compute_availability(pool(rookie, missed_two))
    assert a["rookie"] > a["missed_two"]


def test_one_long_absence_is_forgiven_only_once_healthy():
    """A season mostly missed counts at half weight once he's back, in full
    while he's still hurt — and never disappears entirely."""
    healthy_now = make("healthy_now", {"2025-26": 10, "2024-25": 75, "2023-24": 75})
    still_out = make("still_out", {"2025-26": 10, "2024-25": 75, "2023-24": 75}, injury="Out")
    durable = make("durable", {"2025-26": 75, "2024-25": 75, "2023-24": 75})
    a = compute_availability(pool(healthy_now, still_out, durable))
    assert a["still_out"] < a["healthy_now"] < a["durable"]
    assert a["healthy_now"] < a["durable"] - 0.1  # the absence still counts


def test_two_long_absences_mark_injury_prone():
    one_off = make("one_off", {"2025-26": 10, "2024-25": 75, "2023-24": 75})
    chronic = make("chronic", {"2025-26": 10, "2024-25": 75, "2023-24": 10})
    a = compute_availability(pool(one_off, chronic))
    assert a["chronic"] < a["one_off"] - 0.05


def test_unsigned_players_are_discounted():
    signed = make("signed", {s: 70 for s in SEASONS})
    unsigned = make("unsigned", {s: 70 for s in SEASONS}, signed=False)
    a = compute_availability(pool(signed, unsigned))
    assert abs(a["unsigned"] - a["signed"] * UNSIGNED_FACTOR) < 1e-9


# ---------- current injury status ----------


def test_day_to_day_costs_a_few_games():
    healthy = make("healthy", {s: 70 for s in SEASONS})
    dtd = make("dtd", {s: 70 for s in SEASONS}, injury="Day-To-Day")
    a = compute_availability(pool(healthy, dtd))
    assert abs(a["dtd"] - a["healthy"] * STATUS_FACTORS["Day-To-Day"]) < 1e-9


def test_out_is_graded_by_how_much_of_the_season_he_has_played():
    late_knock = make("late_knock", {"2025-26": 78, "2024-25": 75, "2023-24": 75}, injury="Out")
    lingering = make("lingering", {"2025-26": 40, "2024-25": 75, "2023-24": 75}, injury="Out")
    long_term = make("long_term", {"2025-26": 5, "2024-25": 75, "2023-24": 75}, injury="Out")
    season_lost = make("season_lost", {"2024-25": 75, "2023-24": 75}, injury="Out")
    # Healthy twins in the same pool, so the shrinkage prior is shared.
    twins = [
        replace(late_knock, id="late_knock_ok", injury=None),
        replace(long_term, id="long_term_ok", injury=None),
    ]
    a = compute_availability(pool(late_knock, lingering, long_term, season_lost, *twins))
    assert a["season_lost"] < a["long_term"] < a["lingering"] < a["late_knock"]
    # Ends of the scale: a late knock costs a tenth of the season…
    assert abs(a["late_knock"] / a["late_knock_ok"] - SHORT_TERM_OUT_FACTOR) < 1e-9
    # …a long-term "Out" costs most of it, and his mostly-missed season is
    # also read as still-injured (full weight) rather than forgiven.
    assert a["long_term"] / a["long_term_ok"] < LONG_TERM_OUT_FACTOR + 1e-9


def test_unknown_status_is_treated_as_minor():
    odd = make("odd", {s: 70 for s in SEASONS}, injury="Probable")
    healthy = make("healthy", {s: 70 for s in SEASONS})
    a = compute_availability(pool(odd, healthy))
    assert a["healthy"] * 0.9 < a["odd"] < a["healthy"]


# ---------- how availability turns into value ----------


def test_percentage_scores_are_capped():
    values, _ = compute_player_values(PLAYERS)
    worst = min(min(v["FG%"], v["FT%"]) for v in values.values())
    best = max(max(v["FG%"], v["FT%"]) for v in values.values())
    assert -PCT_Z_CAP <= worst and best <= PCT_Z_CAP
    assert worst == -PCT_Z_CAP  # the cap actually binds in this pool


def test_missing_games_lowers_value_but_not_turnovers():
    durable = make("durable", {s: 80 for s in SEASONS})
    fragile = make("fragile", {s: 30 for s in SEASONS})
    values, _ = compute_player_values(value_pool(durable, fragile))
    assert overall(values, "fragile") < overall(values, "durable")
    assert values["fragile"]["TO"] == values["durable"]["TO"]


def test_missed_star_games_cost_more_than_missed_bench_games():
    """A missed game is played by a replacement-level pickup, so the drop
    from full health is proportional to how far above that level he is."""
    star = make("star", {s: 40 for s in SEASONS}, pts=30, reb=10, ast=8, stl=1.8, blk=1.2, tpm=3)
    bench = make("bench", {s: 40 for s in SEASONS}, pts=8, reb=3, ast=1.5, stl=0.5, blk=0.2, tpm=1)
    values, stats = compute_player_values(value_pool(star, bench))
    cost = lambda pid: overall(stats.healthy_values, pid) - overall(values, pid)
    assert cost("star") > cost("bench") + 1.0
    assert stats.availability["star"] == stats.availability["bench"]


def test_healthy_values_are_what_a_full_season_would_be_worth():
    durable = make("durable", {s: 82 for s in SEASONS})
    fragile = make("fragile", {s: 30 for s in SEASONS})
    values, stats = compute_player_values(value_pool(durable, fragile))
    # Identical lines: same value if both played every game…
    assert all(
        abs(stats.healthy_values["fragile"][c] - stats.healthy_values["durable"][c]) < 1e-9
        for c in CATEGORIES
    )
    # …and the adjusted value never exceeds the healthy one.
    assert overall(values, "fragile") < overall(stats.healthy_values, "fragile")


def test_real_pool_injury_status_moves_the_ranking():
    """With the frozen dataset, a player tagged Out after a mostly-missed
    season ranks well below where his per-game line alone would put him."""
    values, stats = compute_player_values(PLAYERS)
    rank = lambda vals: {
        pid: i for i, pid in enumerate(sorted(vals, key=lambda k: -overall(vals, k)))
    }
    r_adj, r_healthy = rank(values), rank(stats.healthy_values)
    long_term_out = [
        p.id for p in PLAYERS
        if p.injury == "Out" and p.gp_by_season.get("2025-26", 0) < 25 and p.signed
        and r_healthy[p.id] < 156  # draftable on his line alone
    ]
    assert long_term_out  # the dataset has such players
    for pid in long_term_out:
        assert r_adj[pid] > r_healthy[pid] + 20
    # A player who never plays is worth less than a healthy 13th man, so
    # nobody on no roster is draftable in a 12 x 13 league.
    assert all(r_adj[p.id] >= 156 for p in PLAYERS if not p.signed)


# ---------- bot risk appetite ----------


def test_risk_tilts_scale_the_availability_cost():
    values, stats = compute_player_values(PLAYERS)
    fragile = max(
        PLAYERS,
        key=lambda p: overall(stats.healthy_values, p.id) - overall(values, p.id),
    )
    z, h = values[fragile.id], stats.healthy_values[fragile.id]
    cost = overall(stats.healthy_values, fragile.id) - overall(values, fragile.id)
    assert cost > 0
    bold = risk_adjustment(BotSpec(kind="value", risk="bold"), z, h, UNIFORM_WEIGHTS)
    cautious = risk_adjustment(BotSpec(kind="value", risk="cautious"), z, h, UNIFORM_WEIGHTS)
    neutral = risk_adjustment(BotSpec(kind="value", risk="neutral"), z, h, UNIFORM_WEIGHTS)
    assert abs(bold - RISK_TILT["bold"] * cost) < 1e-9
    assert abs(cautious - RISK_TILT["cautious"] * cost) < 1e-9
    assert neutral == 0.0
    assert risk_adjustment(BotSpec(kind="value", risk="bold"), z, None, UNIFORM_WEIGHTS) == 0.0


def test_bold_bot_takes_the_hurt_star_earlier_than_a_cautious_one(pool, values, healthy_values):
    """Run the same pick with each appetite: the bold bot's choice is at
    least as risky (lower availability-adjusted share of healthy value)."""
    _, stats = compute_player_values(PLAYERS)

    def first_pick(risk: str) -> str:
        specs = tuple(BotSpec(kind="value", risk=risk) for _ in range(NUM_TEAMS))
        state = create_draft(make_config(seed="risk-seed", bot_specs=specs))
        return choose_bot_pick(state, pool, values, 0, healthy_values)

    picks = {r: first_pick(r) for r in ("cautious", "neutral", "bold")}
    avail = {r: stats.availability[pid] for r, pid in picks.items()}
    assert avail["bold"] <= avail["neutral"] <= avail["cautious"]


def test_risk_is_assigned_and_survives_serialization():
    from app.engine.bots import assign_bot_specs
    from app.engine.draft import DraftConfig

    specs = assign_bot_specs("any-seed", NUM_TEAMS, 0)
    risks = {s.risk for i, s in enumerate(specs) if i != 0}
    assert risks == {"cautious", "neutral", "bold"}
    config = DraftConfig(NUM_TEAMS, 13, 0, "any-seed", specs)
    assert DraftConfig.from_dict(config.to_dict()) == config
    # Saves from before risk existed load as neutral.
    old = {**config.to_dict()}
    old["botSpecs"] = [{"kind": s["kind"], "puntCategory": s["puntCategory"]} for s in old["botSpecs"]]
    assert all(s.risk == "neutral" for s in DraftConfig.from_dict(old).bot_specs)
