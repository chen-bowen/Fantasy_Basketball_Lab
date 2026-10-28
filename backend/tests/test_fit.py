"""Fit recommends players who belong at this pick, ranked by what they do
for this roster — and doesn't chase categories a pick can't change."""

from lab.metrics.weighting import shortfall_weights
from lab.metrics.shape import (
    SWING_CAP,
    MIN_BOARD,
    SWING_FLOOR,
    board_window,
    shape_score,
    shape_frame,
    shape_weights,
    board_order,
    in_play,
    order_candidates,
    decided,
    window_ceiling,
)
from lab.metrics.table import WEEK_WEIGHTS
from lab.metrics.ratings import line_score
from lab.metrics.profile import roster_line, cat_ranks
from lab.domain.autopilot import autopilot_pick
from lab.domain.session import (
    record_pick,
    undrafted_ids,
    open_session,
    on_clock,
    draft_done,
)
from lab.domain.model import CATEGORIES
from lab.render import session_view

from .conftest import LEAGUE_SIZE, SQUAD_SIZE, make_config


def _profiles(state, pool, values):
    return [roster_line([pool[i] for i in r], values) for r in state.squads]


def _recommend(state, pool, values, ranks, concedes=frozenset()):
    """What the draft room recommends on the user's turn, best Fit first."""
    slot = state.config.seat
    w = shape_weights(_profiles(state, pool, values), slot, set(concedes), SQUAD_SIZE)
    window = board_window(
        undrafted_ids(state, pool), values, len(state.selections) + 1, LEAGUE_SIZE, ranks
    )
    return order_candidates(window, values, w), w


def _draft_following_fit(pool, values, seed, slot, until_pick=None):
    """Play a draft where the user takes the top recommendation every turn;
    yields (state, recommendations, weights) at each user turn."""
    ranks = board_order(values)
    state = open_session(make_config(seat=slot, seed=seed))
    turns = []
    while not draft_done(state):
        if until_pick is not None and len(state.selections) >= until_pick:
            break
        t = on_clock(state)
        if t == slot:
            top, w = _recommend(state, pool, values, ranks)
            turns.append((state, top, w))
            pid = top[0]
        else:
            pid = autopilot_pick(state, pool, values, t)
        state = record_pick(state, pool, pid)
    return state, turns


def test_window_holds_players_expected_to_go_around_this_pick(pool, values):
    ranks = board_order(values)
    state, _ = _draft_following_fit(pool, values, "window", 3, until_pick=39)
    pick = len(state.selections) + 1
    window = board_window(undrafted_ids(state, pool), values, pick, LEAGUE_SIZE, ranks)
    assert len(window) >= MIN_BOARD
    assert all(ranks[pid] <= window_ceiling(pick, LEAGUE_SIZE) for pid in window)
    assert max(ranks[pid] for pid in window) < 100  # nobody from the 9th round at pick 40
    # Best market value first, and everyone better than the window's worst is in it.
    assert [ranks[p] for p in window] == sorted(ranks[p] for p in window)
    worst = max(ranks[p] for p in window)
    assert all(ranks[p] >= worst for p in undrafted_ids(state, pool) if p not in window)


def test_window_never_runs_dry_late_in_the_draft(pool, values):
    ranks = board_order(values)
    state, _ = _draft_following_fit(pool, values, "late", 0, until_pick=150)
    window = board_window(undrafted_ids(state, pool), values, 151, LEAGUE_SIZE, ranks)
    assert len(window) >= MIN_BOARD


def test_recommendations_stay_in_range_all_draft(pool, values):
    """Following Fit never recommends a player who should go rounds later:
    every top-5 recommendation from round 2 on is within the window."""
    ranks = board_order(values)
    for seed, slot in (("range-a", 0), ("range-b", 5), ("range-c", 11)):
        _, turns = _draft_following_fit(pool, values, seed, slot)
        assert len(turns) == SQUAD_SIZE
        for state, top, _ in turns[1:]:
            pick = len(state.selections) + 1
            limit = window_ceiling(pick, LEAGUE_SIZE)
            for pid in top[:5]:
                assert ranks[pid] <= max(limit, MIN_BOARD), (seed, pick, ranks[pid])


def test_inside_the_window_order_is_by_fit_not_market(pool, values):
    """Fit re-orders the window: a player the market rates lower can be the
    recommendation when he does more for this roster."""
    ranks = board_order(values)
    reordered = 0
    for seed, slot in (("order-a", 3), ("order-b", 7)):
        _, turns = _draft_following_fit(pool, values, seed, slot)
        for state, top, w in turns[2:9]:
            fits = [shape_score(values[p], w) for p in top]
            assert fits == sorted(fits, reverse=True)
            if ranks[top[0]] != min(ranks[p] for p in top):
                reordered += 1
    assert reordered > 0


def test_fit_is_head_to_head_worth_on_an_empty_roster(pool, values):
    """With nothing drafted, Fit is what a z-unit is worth toward winning a
    week (1 / noise): it deviates from that only for what this roster
    needs, and there is nothing to need yet."""
    state = open_session(make_config(seat=0, seed="empty"))
    w, swing = shape_frame(_profiles(state, pool, values), 0, set(), SQUAD_SIZE)
    assert w == WEEK_WEIGHTS
    assert abs(sum(w.values()) / len(CATEGORIES) - 1.0) < 1e-9  # on the market's scale
    assert w["PTS"] > w["STL"] and w["TO"] > w["FT%"]  # reliable categories count most
    assert in_play(swing) == [] and decided(swing) == []
    w = shape_weights(_profiles(state, pool, values), 0, {"TO"}, SQUAD_SIZE)
    assert w["TO"] == 0.0
    rest = {c: w[c] / WEEK_WEIGHTS[c] for c in CATEGORIES if c != "TO"}
    assert max(rest.values()) - min(rest.values()) < 1e-9  # same shape, rescaled


def test_fit_is_close_to_its_base_after_one_pick(pool, values):
    """One player is not a team shape: nothing is settled, so Fit doesn't
    swing to the categories he happens to lack."""
    ranks = board_order(values)
    state = open_session(make_config(seat=0, seed="one"))
    while on_clock(state) != 0:
        state = record_pick(state, pool, autopilot_pick(state, pool, values, on_clock(state)))
    # A lead guard: the best available backcourt player who is weak on the
    # glass but otherwise a normal star (no single superhuman category).
    lead = min(
        (
            pid for pid in undrafted_ids(state, pool)
            if "G" in pool[pid].positions and values[pid]["REB"] < -0.3
            and max(values[pid][c] for c in CATEGORIES) < 2.5
        ),
        key=lambda pid: ranks[pid],
    )
    state = record_pick(state, pool, lead)
    while on_clock(state) != 0:
        state = record_pick(state, pool, autopilot_pick(state, pool, values, on_clock(state)))
    profiles = _profiles(state, pool, values)
    w, swing = shape_frame(profiles, 0, set(), SQUAD_SIZE)
    assert all(abs(w[c] / WEEK_WEIGHTS[c] - 1.0) < 0.1 for c in CATEGORIES)
    assert in_play(swing) == [] and decided(swing) == []
    # The old deficit weighting would already be reaching for rebounds here.
    old = shortfall_weights(profiles, 0)
    assert old["REB"] > 1.5
    # Next to a lead guard, the second pick is the board's best available by
    # market value give or take the roster's shape: no specialist over a star.
    top, _ = _recommend(state, pool, values, ranks)
    best = min(ranks[p] for p in top)
    assert ranks[top[0]] <= best + 6


def _roster_of_bigs(pool, values, seed="bigs", slot=5, picks=8):
    """A mid-draft roster that is last in steals by a wide margin: the user
    takes the lowest-STL player in the window every turn."""
    ranks = board_order(values)
    state = open_session(make_config(seat=slot, seed=seed))
    while len(state.squads[slot]) < picks or on_clock(state) != slot:
        t = on_clock(state)
        if t == slot:
            window = board_window(
                undrafted_ids(state, pool), values, len(state.selections) + 1, LEAGUE_SIZE, ranks
            )
            pid = min(window, key=lambda i: values[i]["STL"])
        else:
            pid = autopilot_pick(state, pool, values, t)
        state = record_pick(state, pool, pid)
    return state


def test_fit_does_not_chase_a_hopeless_category(pool, values):
    state = _roster_of_bigs(pool, values)
    slot = state.config.seat
    profiles = _profiles(state, pool, values)
    assert cat_ranks(profiles)["STL"][slot] == LEAGUE_SIZE
    w, swing = shape_frame(profiles, slot, set(), SQUAD_SIZE)
    # Not steered: steals stay worth less than an average category to this
    # team, while the old weighting made them the top priority.
    assert w["STL"] < 1.0
    assert swing["STL"] < SWING_CAP
    assert shortfall_weights(profiles, slot)["STL"] > 1.5  # what the old weighting did
    # The categories it owns are discounted, and a lost cause is written off.
    ranks_by_cat = cat_ranks(profiles)
    owned = {c for c in CATEGORIES if ranks_by_cat[c][slot] <= 3}
    assert owned & set(decided(swing))
    assert "3PM" in decided(swing)  # a lost cause written off
    # And the recommendation isn't a steals specialist from rounds later.
    top, _ = _recommend(state, pool, values, board_order(values))
    pick = len(state.selections) + 1
    assert all(board_order(values)[p] <= window_ceiling(pick, LEAGUE_SIZE) for p in top[:5])
    assert sum(values[p]["STL"] for p in top[:3]) / 3 < 1.0


def test_fit_discounts_a_category_already_locked_up(pool, values):
    state = _roster_of_bigs(pool, values)
    slot = state.config.seat
    profiles = _profiles(state, pool, values)
    assert cat_ranks(profiles)["REB"][slot] == 1
    w, swing = shape_frame(profiles, slot, set(), SQUAD_SIZE)
    assert w["REB"] < WEEK_WEIGHTS["REB"] and "REB" in decided(swing)
    assert all(SWING_FLOOR <= swing[c] <= SWING_CAP for c in CATEGORIES)
    assert abs(sum(w.values()) / len(CATEGORIES) - 1.0) < 1e-9  # on the market's scale


def test_fit_weights_zero_punts_and_renormalize_the_rest(pool, values):
    state = _roster_of_bigs(pool, values)
    slot = state.config.seat
    w = shape_weights(_profiles(state, pool, values), slot, {"FT%"}, SQUAD_SIZE)
    assert w["FT%"] == 0.0
    rest = [w[c] for c in CATEGORIES if c != "FT%"]
    assert abs(sum(rest) / len(rest) - 1.0) < 1e-9


def test_fit_beats_a_plain_scoresheet_draft(pool, values):
    """Fit's shape term earns its keep: against the same rivals, a roster
    drafted by Fit projects more weekly wins than one that takes the best
    plain z sum in the window every turn — and it gets there without
    conceding points, which a uniform scoresheet weighting drifts into
    because it prices every category the same however often it flips."""
    from lab.metrics.table import win_expectation
    from lab.metrics.concede import advise_concedes
    ranks = board_order(values)

    def play(seed, slot, weights_for):
        state = open_session(make_config(seat=slot, seed=seed))
        concedes = []
        while not draft_done(state):
            t = on_clock(state)
            if t == slot:
                profiles = _profiles(state, pool, values)
                concedes = advise_concedes(profiles, slot, concedes)["concedes"]
                w = weights_for(profiles, set(concedes))
                window = board_window(undrafted_ids(state, pool), values, len(state.selections) + 1, LEAGUE_SIZE, ranks)
                pid = max(window, key=lambda i: line_score(values[i], w))
            else:
                pid = autopilot_pick(state, pool, values, t)
            state = record_pick(state, pool, pid)
        profiles = _profiles(state, pool, values)
        return win_expectation(profiles)[slot], cat_ranks(profiles)

    def uniform(profiles, concedes):
        return {c: (0.0 if c in concedes else 1.0) for c in CATEGORIES}

    def fit(profiles, concedes):
        return shape_weights(profiles, 3, concedes, SQUAD_SIZE)

    seeds = ("arb-1", "arb-2", "arb-3", "arb-4")
    u = [play(s, 3, uniform) for s in seeds]
    f = [play(s, 3, fit) for s in seeds]
    assert sum(w for w, _ in f) / len(seeds) > sum(w for w, _ in u) / len(seeds)
    # The uniform roster drifts away from points; the Fit roster does not.
    assert sum(r["PTS"][3] for _, r in f) / len(seeds) < sum(r["PTS"][3] for _, r in u) / len(seeds)


def test_draft_view_exposes_candidates_in_fit_order(pool, values):
    ranks = board_order(values)
    state, _ = _draft_following_fit(pool, values, "view", 4, until_pick=40)
    view = session_view("d", state, [], pool, values, market_rank=ranks)
    pick = view["atPick"] + 1
    cands = view["candidates"]
    assert view["window"] == {
        "pick": pick, "maxRank": window_ceiling(pick, LEAGUE_SIZE), "size": len(cands)
    }
    assert len(cands) >= MIN_BOARD
    assert all(ranks[p] <= view["window"]["maxRank"] for p in cands)
    assert all(p in view["fit"] for p in cands)
    fits = [view["fit"][p] for p in cands]
    assert fits == sorted(fits, reverse=True)
    assert set(view["settled"]) == {"ahead", "behind"}
    assert not set(view["settled"]["ahead"]) & set(view["settled"]["behind"])


def test_simulated_user_picks_follow_the_window(pool, values):
    """The suggestion engine's user policy is the room's recommendation."""
    from lab.advisor import top_shape
    ranks = board_order(values)
    state, _ = _draft_following_fit(pool, values, "sim", 2, until_pick=45)
    assert on_clock(state) == 2
    pick = len(state.selections) + 1
    for pid in top_shape(state, 2, set(), 5):
        assert ranks[pid] <= window_ceiling(pick, LEAGUE_SIZE)
