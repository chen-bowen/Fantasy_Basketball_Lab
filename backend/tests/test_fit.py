"""Fit recommends players who belong at this pick, ranked by what they do
for this roster — and doesn't chase categories a pick can't change."""

from app.analysis.category_weights import needs_weights
from app.analysis.fit import (
    MAX_SWING,
    MIN_CANDIDATES,
    MIN_SWING,
    candidate_window,
    fit_score,
    fit_shape,
    fit_weights,
    market_ranks,
    needed_categories,
    rank_candidates,
    settled_categories,
    window_max_rank,
)
from app.analysis.market import MARKET_WEIGHTS
from app.analysis.player_values import score_player
from app.analysis.roster_profile import build_roster_profile, rank_teams
from app.engine.bots import choose_bot_pick
from app.engine.draft import (
    apply_pick,
    available_player_ids,
    create_draft,
    current_team_id,
    is_complete,
)
from app.engine.types import CATEGORIES
from app.views import draft_view

from .conftest import NUM_TEAMS, ROSTER_SIZE, make_config


def _profiles(state, pool, values):
    return [build_roster_profile([pool[i] for i in r], values) for r in state.rosters]


def _recommend(state, pool, values, ranks, punts=frozenset()):
    """What the draft room recommends on the user's turn, best Fit first."""
    slot = state.config.user_slot
    w = fit_weights(_profiles(state, pool, values), slot, set(punts), ROSTER_SIZE)
    window = candidate_window(
        available_player_ids(state, pool), values, len(state.picks) + 1, NUM_TEAMS, ranks
    )
    return rank_candidates(window, values, w), w


def _draft_following_fit(pool, values, seed, slot, until_pick=None):
    """Play a draft where the user takes the top recommendation every turn;
    yields (state, recommendations, weights) at each user turn."""
    ranks = market_ranks(values)
    state = create_draft(make_config(user_slot=slot, seed=seed))
    turns = []
    while not is_complete(state):
        if until_pick is not None and len(state.picks) >= until_pick:
            break
        t = current_team_id(state)
        if t == slot:
            top, w = _recommend(state, pool, values, ranks)
            turns.append((state, top, w))
            pid = top[0]
        else:
            pid = choose_bot_pick(state, pool, values, t)
        state = apply_pick(state, pool, pid)
    return state, turns


def test_window_holds_players_expected_to_go_around_this_pick(pool, values):
    ranks = market_ranks(values)
    state, _ = _draft_following_fit(pool, values, "window", 3, until_pick=39)
    pick = len(state.picks) + 1
    window = candidate_window(available_player_ids(state, pool), values, pick, NUM_TEAMS, ranks)
    assert len(window) >= MIN_CANDIDATES
    assert all(ranks[pid] <= window_max_rank(pick, NUM_TEAMS) for pid in window)
    assert max(ranks[pid] for pid in window) < 100  # nobody from the 9th round at pick 40
    # Best market value first, and everyone better than the window's worst is in it.
    assert [ranks[p] for p in window] == sorted(ranks[p] for p in window)
    worst = max(ranks[p] for p in window)
    assert all(ranks[p] >= worst for p in available_player_ids(state, pool) if p not in window)


def test_window_never_runs_dry_late_in_the_draft(pool, values):
    ranks = market_ranks(values)
    state, _ = _draft_following_fit(pool, values, "late", 0, until_pick=150)
    window = candidate_window(available_player_ids(state, pool), values, 151, NUM_TEAMS, ranks)
    assert len(window) >= MIN_CANDIDATES


def test_recommendations_stay_in_range_all_draft(pool, values):
    """Following Fit never recommends a player who should go rounds later:
    every top-5 recommendation from round 2 on is within the window."""
    ranks = market_ranks(values)
    for seed, slot in (("range-a", 0), ("range-b", 5), ("range-c", 11)):
        _, turns = _draft_following_fit(pool, values, seed, slot)
        assert len(turns) == ROSTER_SIZE
        for state, top, _ in turns[1:]:
            pick = len(state.picks) + 1
            limit = window_max_rank(pick, NUM_TEAMS)
            for pid in top[:5]:
                assert ranks[pid] <= max(limit, MIN_CANDIDATES), (seed, pick, ranks[pid])


def test_inside_the_window_order_is_by_fit_not_market(pool, values):
    """Fit re-orders the window: a player the market rates lower can be the
    recommendation when he does more for this roster."""
    ranks = market_ranks(values)
    reordered = 0
    for seed, slot in (("order-a", 3), ("order-b", 7)):
        _, turns = _draft_following_fit(pool, values, seed, slot)
        for state, top, w in turns[2:9]:
            fits = [fit_score(values[p], w) for p in top]
            assert fits == sorted(fits, reverse=True)
            if ranks[top[0]] != min(ranks[p] for p in top):
                reordered += 1
    assert reordered > 0


def test_fit_is_market_value_on_an_empty_roster(pool, values):
    """Same yardstick as the Value column: Fit deviates from it only for
    what this roster needs, and there is nothing to need yet."""
    state = create_draft(make_config(user_slot=0, seed="empty"))
    w, swing = fit_shape(_profiles(state, pool, values), 0, set(), ROSTER_SIZE)
    assert w == MARKET_WEIGHTS
    assert needed_categories(swing) == [] and settled_categories(swing) == []
    w = fit_weights(_profiles(state, pool, values), 0, {"TO"}, ROSTER_SIZE)
    assert w["TO"] == 0.0
    rest = {c: w[c] / MARKET_WEIGHTS[c] for c in CATEGORIES if c != "TO"}
    assert max(rest.values()) - min(rest.values()) < 1e-9  # market shape, rescaled


def test_fit_is_close_to_market_value_after_one_pick(pool, values):
    """One player is not a team shape: nothing is settled, so Fit doesn't
    swing to the categories he happens to lack."""
    state = create_draft(make_config(user_slot=0, seed="one"))
    while current_team_id(state) != 0:
        state = apply_pick(state, pool, choose_bot_pick(state, pool, values, current_team_id(state)))
    maxey = next(p.id for p in pool.values() if p.name == "Tyrese Maxey")
    state = apply_pick(state, pool, maxey)
    while current_team_id(state) != 0:
        state = apply_pick(state, pool, choose_bot_pick(state, pool, values, current_team_id(state)))
    profiles = _profiles(state, pool, values)
    w, swing = fit_shape(profiles, 0, set(), ROSTER_SIZE)
    assert all(abs(w[c] / MARKET_WEIGHTS[c] - 1.0) < 0.1 for c in CATEGORIES)
    assert needed_categories(swing) == [] and settled_categories(swing) == []
    # The old deficit weighting would already be reaching for rebounds here.
    old = needs_weights(profiles, 0)
    assert old["REB"] > 1.5
    # Next to Maxey, the second pick is the board's best available by market
    # value give or take the roster's shape: no 3-and-D specialist over a star.
    ranks = market_ranks(values)
    top, _ = _recommend(state, pool, values, ranks)
    best = min(ranks[p] for p in top)
    assert ranks[top[0]] <= best + 6


def _roster_of_bigs(pool, values, seed="bigs", slot=5, picks=6):
    """A mid-draft roster that is last in steals by a wide margin: the user
    takes the lowest-STL player in the window every turn."""
    ranks = market_ranks(values)
    state = create_draft(make_config(user_slot=slot, seed=seed))
    while len(state.rosters[slot]) < picks or current_team_id(state) != slot:
        t = current_team_id(state)
        if t == slot:
            window = candidate_window(
                available_player_ids(state, pool), values, len(state.picks) + 1, NUM_TEAMS, ranks
            )
            pid = min(window, key=lambda i: values[i]["STL"])
        else:
            pid = choose_bot_pick(state, pool, values, t)
        state = apply_pick(state, pool, pid)
    return state


def test_fit_does_not_chase_a_hopeless_category(pool, values):
    state = _roster_of_bigs(pool, values)
    slot = state.config.user_slot
    profiles = _profiles(state, pool, values)
    assert rank_teams(profiles)["STL"][slot] == NUM_TEAMS
    w, swing = fit_shape(profiles, slot, set(), ROSTER_SIZE)
    # Not steered: steals stay worth less than an average category to this
    # team, while the old weighting made them the top priority.
    assert w["STL"] < 1.0
    assert swing["STL"] < MAX_SWING
    assert needs_weights(profiles, slot)["STL"] > 1.5  # what the old weighting did
    # The reliable categories it is last in are written off, and the ones
    # it owns are discounted.
    assert {"PTS", "AST"} & set(settled_categories(swing))
    assert "REB" in settled_categories(swing)
    # And the recommendation isn't a steals specialist from rounds later.
    top, _ = _recommend(state, pool, values, market_ranks(values))
    pick = len(state.picks) + 1
    assert all(market_ranks(values)[p] <= window_max_rank(pick, NUM_TEAMS) for p in top[:5])
    assert sum(values[p]["STL"] for p in top[:3]) / 3 < 1.0


def test_fit_discounts_a_category_already_locked_up(pool, values):
    state = _roster_of_bigs(pool, values)
    slot = state.config.user_slot
    profiles = _profiles(state, pool, values)
    assert rank_teams(profiles)["REB"][slot] == 1
    w, swing = fit_shape(profiles, slot, set(), ROSTER_SIZE)
    assert w["REB"] < MARKET_WEIGHTS["REB"] and "REB" in settled_categories(swing)
    assert all(MIN_SWING <= swing[c] <= MAX_SWING for c in CATEGORIES)
    assert abs(sum(w.values()) / len(CATEGORIES) - 1.0) < 1e-9  # on the market's scale


def test_fit_weights_zero_punts_and_renormalize_the_rest(pool, values):
    state = _roster_of_bigs(pool, values)
    slot = state.config.user_slot
    w = fit_weights(_profiles(state, pool, values), slot, {"FT%"}, ROSTER_SIZE)
    assert w["FT%"] == 0.0
    rest = [w[c] for c in CATEGORIES if c != "FT%"]
    assert abs(sum(rest) / len(rest) - 1.0) < 1e-9


def test_scoresheet_arbitrage_no_longer_wins_the_sims(pool, values):
    """A roster that hoards the noisy categories the room underpays for
    (steals, FT%, turnovers) and concedes points is not a winner under
    category-specific noise; the balanced Fit roster projects better."""
    from app.analysis.player_values import UNIFORM_WEIGHTS
    from app.analysis.standings import expected_wins
    from app.analysis.punt_plan import suggest_punts
    ranks = market_ranks(values)

    def play(seed, slot, weights_for):
        state = create_draft(make_config(user_slot=slot, seed=seed))
        punts = []
        while not is_complete(state):
            t = current_team_id(state)
            if t == slot:
                profiles = _profiles(state, pool, values)
                punts = suggest_punts(profiles, slot, punts)["punts"]
                w = weights_for(profiles, set(punts))
                window = candidate_window(available_player_ids(state, pool), values, len(state.picks) + 1, NUM_TEAMS, ranks)
                pid = max(window, key=lambda i: score_player(values[i], w))
            else:
                pid = choose_bot_pick(state, pool, values, t)
            state = apply_pick(state, pool, pid)
        profiles = _profiles(state, pool, values)
        return expected_wins(profiles)[slot], rank_teams(profiles)

    def uniform(profiles, punts):
        return {c: (0.0 if c in punts else 1.0) for c in CATEGORIES}

    def fit(profiles, punts):
        return fit_weights(profiles, 3, punts, ROSTER_SIZE)

    u = [play(s, 3, uniform) for s in ("arb-1", "arb-2", "arb-3")]
    f = [play(s, 3, fit) for s in ("arb-1", "arb-2", "arb-3")]
    assert sum(w for w, _ in f) / 3 > sum(w for w, _ in u) / 3
    # The uniform roster is the arbitrage shape: elite in steals, nowhere in points.
    assert sum(r["STL"][3] for _, r in u) / 3 < 5 and sum(r["PTS"][3] for _, r in u) / 3 > 8


def test_draft_view_exposes_candidates_in_fit_order(pool, values):
    ranks = market_ranks(values)
    state, _ = _draft_following_fit(pool, values, "view", 4, until_pick=40)
    view = draft_view("d", state, [], pool, values, market_rank=ranks)
    pick = view["pickIndex"] + 1
    cands = view["candidates"]
    assert view["fitWindow"] == {
        "pick": pick, "maxRank": window_max_rank(pick, NUM_TEAMS), "size": len(cands)
    }
    assert len(cands) >= MIN_CANDIDATES
    assert all(ranks[p] <= view["fitWindow"]["maxRank"] for p in cands)
    assert all(p in view["fit"] for p in cands)
    fits = [view["fit"][p] for p in cands]
    assert fits == sorted(fits, reverse=True)
    assert set(view["settledCategories"]) == {"ahead", "behind"}
    assert not set(view["settledCategories"]["ahead"]) & set(view["settledCategories"]["behind"])


def test_simulated_user_picks_follow_the_window(pool, values):
    """The suggestion engine's user policy is the room's recommendation."""
    from app.suggestions import best_fit
    ranks = market_ranks(values)
    state, _ = _draft_following_fit(pool, values, "sim", 2, until_pick=45)
    assert current_team_id(state) == 2
    pick = len(state.picks) + 1
    for pid in best_fit(state, 2, set(), 5):
        assert ranks[pid] <= window_max_rank(pick, NUM_TEAMS)
