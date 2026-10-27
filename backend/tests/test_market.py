"""Market value: bots and the value rank follow what drafters pay for,
while the standings and the user's Fit keep scoring all nine categories."""

from app.analysis.category_weights import needs_weights, punt_bot_weights
from app.analysis.fit import fit_weights
from app.analysis.market import FITTED_WEIGHTS, MARKET_SHARE, MARKET_WEIGHTS
from app.analysis.player_values import UNIFORM_WEIGHTS, compute_player_values, score_player
from app.analysis.roster_profile import build_roster_profile
from app.data.pool import PLAYERS, PLAYER_POOL
from app.engine.bots import choose_bot_pick
from app.engine.draft import apply_pick, create_draft, current_team_id
from app.engine.types import CATEGORIES

from .conftest import NUM_TEAMS, make_config


def spearman(xs, ys):
    n = len(xs)
    rank = lambda v: {i: r for r, i in enumerate(sorted(range(n), key=lambda i: v[i]))}
    rx, ry = rank(xs), rank(ys)
    return 1 - 6 * sum((rx[i] - ry[i]) ** 2 for i in range(n)) / (n * (n * n - 1))


def by_name(name: str):
    return next(p for p in PLAYERS if p.name == name)


def test_market_weights_are_a_reweighting_not_a_rescale():
    for w in (FITTED_WEIGHTS, MARKET_WEIGHTS):
        assert abs(sum(w.values()) / len(CATEGORIES) - 1.0) < 0.05
        assert all(v > 0 for v in w.values())
        # The market's known preferences: points and assists over steals, FT% and TO.
        assert w["PTS"] > w["AST"] > 1.0
        assert max(w["STL"], w["FT%"], w["TO"]) < 0.6
    # The engine's weights sit between the scoresheet and the pure ADP fit.
    assert 0 < MARKET_SHARE < 1
    for c in CATEGORIES:
        lo, hi = sorted((1.0, FITTED_WEIGHTS[c]))
        assert lo - 1e-9 <= MARKET_WEIGHTS[c] <= hi + 1e-9


def test_market_value_tracks_adp_much_better_than_a_plain_z_sum():
    values, _ = compute_player_values(PLAYERS)
    draftable = [p for p in PLAYERS if p.adp is not None and p.adp <= NUM_TEAMS * 13]
    adp = [-p.adp for p in draftable]
    uniform = spearman([score_player(values[p.id], UNIFORM_WEIGHTS) for p in draftable], adp)
    market = spearman([score_player(values[p.id], MARKET_WEIGHTS) for p in draftable], adp)
    assert market > uniform + 0.05
    assert market > 0.85


def test_solid_starters_are_not_first_round_and_stars_are():
    """The complaint that motivated market weights: low-TO, high-FT%, 3-and-D
    guards were ranked like stars; high-usage stars with an ugly FT% or TO
    line fell out of the first round."""
    values, _ = compute_player_values(PLAYERS)
    order = sorted(PLAYERS, key=lambda p: -score_player(values[p.id], MARKET_WEIGHTS))
    rank = {p.id: i + 1 for i, p in enumerate(order)}
    for name in ("Nickeil Alexander-Walker", "Derrick White", "Mikal Bridges", "Dyson Daniels"):
        assert rank[by_name(name).id] > 24, name  # not in the first two rounds
    for name in ("Nikola Jokić", "Luka Dončić", "Giannis Antetokounmpo", "Cade Cunningham"):
        assert rank[by_name(name).id] <= 24, name  # first two rounds


def test_first_round_of_a_bot_draft_is_made_of_first_round_players(pool, values, healthy_values):
    for seed in ("market-a", "market-b", "market-c"):
        state = create_draft(make_config(seed=seed))
        for _ in range(NUM_TEAMS):
            t = current_team_id(state)
            state = apply_pick(state, pool, choose_bot_pick(state, pool, values, t, healthy_values))
        first_round = [pool[p.player_id] for p in state.picks]
        # A reach or two (a bold bot on a hurt star) is human; a 4th-round
        # guard in round 1 is not.
        for p in first_round:
            assert p.adp is not None and p.adp <= 40, f"{seed}: {p.name} (ADP {p.adp}) went in round 1"
        assert sum(1 for p in first_round if p.adp <= 24) >= 9


def test_bot_strategies_build_on_market_weights():
    w = punt_bot_weights("FT%", MARKET_WEIGHTS)
    assert w["FT%"] == 0.0 and w["PTS"] == MARKET_WEIGHTS["PTS"]
    values, _ = compute_player_values(PLAYERS)
    profiles = [build_roster_profile(PLAYERS[:5], values), build_roster_profile(PLAYERS[100:105], values)]
    w = needs_weights(profiles, 1, MARKET_WEIGHTS)
    for c in CATEGORIES:
        assert 0.6 * MARKET_WEIGHTS[c] <= w[c] <= 2.0 * MARKET_WEIGHTS[c]


def test_user_fit_is_on_the_markets_yardstick():
    """Fit and Value share one yardstick: with no roster Fit is market value,
    and a roster's shape only scales each category's market weight. The
    scoresheet's uniform weights would call a low-turnover 3-and-D guard a
    better player than a star with an ugly FT% line — a roto valuation, not
    a head-to-head one."""
    values, _ = compute_player_values(PLAYERS)
    empty = [build_roster_profile([], values) for _ in range(NUM_TEAMS)]
    assert fit_weights(empty, 0, set()) == MARKET_WEIGHTS
    assert fit_weights(empty, 0, set()) != UNIFORM_WEIGHTS
    full = list(empty)
    full[0] = build_roster_profile(PLAYERS[:5], values)
    w = fit_weights(full, 0, set())
    assert all(0.4 * MARKET_WEIGHTS[c] <= w[c] <= 2.0 * MARKET_WEIGHTS[c] for c in CATEGORIES)
    assert abs(sum(w.values()) / len(CATEGORIES) - 1.0) < 1e-9


def test_standings_noise_follows_category_reliability():
    """Expected wins resolve a points edge faster than a steals edge: the
    same per-slot gap is a clear favourite in a reliable category and close
    to a coin flip in a noisy one."""
    from app.analysis.standings import CATEGORY_NOISE, NOISE, category_win_prob
    assert NOISE["PTS"] < NOISE["REB"] < NOISE["STL"]
    assert category_win_prob(0.3, NOISE["PTS"]) > 0.75 > category_win_prob(0.3, NOISE["FT%"])
    # A z-unit is worth 1 / noise; on average that is still 1 / CATEGORY_NOISE.
    worth = sum(1 / NOISE[c] for c in CATEGORIES) / len(CATEGORIES)
    assert abs(worth - 1 / CATEGORY_NOISE) < 1e-9


def test_pool_is_indexed_consistently():
    assert all(PLAYER_POOL[p.id] is p for p in PLAYERS)
