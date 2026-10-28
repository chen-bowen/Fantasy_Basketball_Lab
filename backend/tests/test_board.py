"""Market value: rivals and the value rank follow what drafters pay for,
while the standings and the user's Fit keep scoring all nine categories."""

from lab.metrics.weighting import shortfall_weights, rival_concede_weights
from lab.metrics.shape import shape_weights
from lab.metrics.board import BOARD_FIT, BOARD_BLEND, BOARD_WEIGHTS
from lab.metrics.ratings import EVEN_WEIGHTS, score_pool, line_score
from lab.metrics.profile import roster_line
from lab.pool.loader import PLAYERS, PLAYER_POOL
from lab.domain.autopilot import autopilot_pick
from lab.domain.session import record_pick, open_session, on_clock
from lab.domain.model import CATEGORIES

from .conftest import LEAGUE_SIZE, make_config


def spearman(xs, ys):
    n = len(xs)
    rank = lambda v: {i: r for r, i in enumerate(sorted(range(n), key=lambda i: v[i]))}
    rx, ry = rank(xs), rank(ys)
    return 1 - 6 * sum((rx[i] - ry[i]) ** 2 for i in range(n)) / (n * (n * n - 1))


def test_market_weights_are_a_reweighting_not_a_rescale():
    for w in (BOARD_FIT, BOARD_WEIGHTS):
        assert abs(sum(w.values()) / len(CATEGORIES) - 1.0) < 0.05
        assert all(v > 0 for v in w.values())
        # The market's known preferences: points and assists over steals, FT% and TO.
        assert w["PTS"] > w["AST"] > 1.0
        assert max(w["STL"], w["FT%"], w["TO"]) < 0.75
        assert min(w["FT%"], w["TO"]) < w["STL"]
    # The engine's weights sit between the scoresheet and the pure ADP fit.
    assert 0 < BOARD_BLEND < 1
    for c in CATEGORIES:
        lo, hi = sorted((1.0, BOARD_FIT[c]))
        assert lo - 1e-9 <= BOARD_WEIGHTS[c] <= hi + 1e-9


def test_market_value_tracks_adp_much_better_than_a_plain_z_sum():
    values, _ = score_pool(PLAYERS)
    draftable = [p for p in PLAYERS if p.adp is not None and p.adp <= LEAGUE_SIZE * 13]
    adp = [-p.adp for p in draftable]
    uniform = spearman([line_score(values[p.id], EVEN_WEIGHTS) for p in draftable], adp)
    market = spearman([line_score(values[p.id], BOARD_WEIGHTS) for p in draftable], adp)
    assert market > uniform + 0.05
    assert market > 0.85


def test_first_rounders_have_star_production():
    """The complaint that motivated market weights: low-TO, high-FT%, 3-and-D
    guards were ranked like stars; high-usage stars with an ugly FT% or TO
    line fell out of the first round. The first two rounds are heavy
    producers, not specialists."""
    values, _ = score_pool(PLAYERS)
    order = sorted(PLAYERS, key=lambda p: -line_score(values[p.id], BOARD_WEIGHTS))
    for p in order[:24]:
        assert p.mpg > 25, p.name
        assert p.pts + p.reb + p.ast > 24, p.name


def test_first_round_of_a_bot_draft_is_made_of_first_round_players(pool, values, healthy_values):
    for seed in ("market-a", "market-b", "market-c"):
        state = open_session(make_config(seed=seed))
        for _ in range(LEAGUE_SIZE):
            t = on_clock(state)
            state = record_pick(state, pool, autopilot_pick(state, pool, values, t, healthy_values))
        first_round = [pool[p.pid] for p in state.selections]
        # A reach or two (a bold rival on a hurt star) is human; a 4th-round
        # guard in round 1 is not.
        for p in first_round:
            assert p.adp is not None and p.adp <= 40, f"{seed}: {p.name} (ADP {p.adp}) went in round 1"
        assert sum(1 for p in first_round if p.adp <= 24) >= 9


def test_bot_strategies_build_on_market_weights():
    w = rival_concede_weights("FT%", BOARD_WEIGHTS)
    assert w["FT%"] == 0.0 and w["PTS"] == BOARD_WEIGHTS["PTS"]
    values, _ = score_pool(PLAYERS)
    profiles = [roster_line(PLAYERS[:5], values), roster_line(PLAYERS[100:105], values)]
    w = shortfall_weights(profiles, 1, BOARD_WEIGHTS)
    for c in CATEGORIES:
        assert 0.6 * BOARD_WEIGHTS[c] <= w[c] <= 2.0 * BOARD_WEIGHTS[c]


def test_user_fit_is_on_the_markets_scale_not_its_prices():
    """Fit and Value share a scale (weights average 1.0) but not a price
    list: with no roster Fit is what a z-unit is worth toward winning a
    week, which counts turnovers and rebounds more than the draft table
    does and steals and FT% less. The candidate window, not the weights,
    is what keeps Fit from reaching for a specialist in round one."""
    from lab.metrics.table import WEEK_WEIGHTS
    values, _ = score_pool(PLAYERS)
    empty = [roster_line([], values) for _ in range(LEAGUE_SIZE)]
    assert shape_weights(empty, 0, set()) == WEEK_WEIGHTS
    assert shape_weights(empty, 0, set()) != EVEN_WEIGHTS
    assert abs(sum(WEEK_WEIGHTS.values()) / len(CATEGORIES) - 1.0) < 1e-9
    assert WEEK_WEIGHTS["TO"] > BOARD_WEIGHTS["TO"] and WEEK_WEIGHTS["STL"] < 1.0
    full = list(empty)
    full[0] = roster_line(PLAYERS[:5], values)
    w = shape_weights(full, 0, set())
    assert all(0.4 * WEEK_WEIGHTS[c] <= w[c] <= 2.0 * WEEK_WEIGHTS[c] for c in CATEGORIES)
    assert abs(sum(w.values()) / len(CATEGORIES) - 1.0) < 1e-9


def test_standings_noise_follows_category_reliability():
    """Expected wins resolve a points edge faster than a steals edge: the
    same per-slot gap is a clear favourite in a reliable category and close
    to a coin flip in a noisy one."""
    from lab.metrics.table import MEAN_VARIANCE, NOISE, cat_prob
    # The counting stats resolve a lead faster than the volatile ones.
    counting = {"PTS", "REB", "AST"}
    noisy = {"STL", "BLK", "3PM", "FG%", "FT%"}
    assert max(NOISE[c] for c in counting) < min(NOISE[c] for c in noisy)
    assert cat_prob(0.3, NOISE["PTS"]) > 0.75 > cat_prob(0.3, NOISE["FT%"])
    # The fit is from game-level variance, not the market's concede discount:
    # turnovers are a few per game but steady, so a TO lead is about as
    # safe as a rebounding lead, and nowhere near as loose as steals.
    assert NOISE["TO"] <= NOISE["BLK"] < NOISE["STL"]
    assert min(NOISE.values()) < MEAN_VARIANCE < max(NOISE.values())


def test_pool_is_indexed_consistently():
    assert all(PLAYER_POOL[p.id] is p for p in PLAYERS)
