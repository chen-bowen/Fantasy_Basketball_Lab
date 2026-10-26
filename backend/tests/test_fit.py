"""Fit weights (the gradient of expected wins) and the draft window."""

from app.analysis.fit import (
    CONCEDE_THRESHOLD,
    MAX_WEIGHT,
    MIN_WEIGHT,
    NEED_THRESHOLD,
    category_stances,
    fit_weights,
    win_gradient,
)
from app.analysis.market import MARKET_WEIGHTS
from app.analysis.player_values import score_player
from app.analysis.roster_profile import build_roster_profile
from app.analysis.standings import expected_wins
from app.analysis.window import REACH_MIN, draft_window, reach, user_turns, window_info, window_size
from app.data.pool import PLAYERS
from app.engine.bots import choose_bot_pick
from app.engine.draft import (
    apply_pick,
    available_player_ids,
    create_draft,
    current_team_id,
    rewind_to_pick,
)
from app.engine.types import CATEGORIES

from .conftest import ROSTER_SIZE, make_config, run_draft


def _profiles(rosters, values):
    return [build_roster_profile(r, values) for r in rosters]


def _league(values, user_roster, n_teams=12, size=None):
    """The user's roster plus 11 bot rosters of `size` mid-board players
    each (by market value), skipping the user's players."""
    size = size or len(user_roster)
    mine = {p.id for p in user_roster}
    board = sorted(
        (p for p in PLAYERS if p.id not in mine),
        key=lambda p: -score_player(values[p.id], MARKET_WEIGHTS),
    )
    others = [board[i::n_teams - 1][:size] for i in range(n_teams - 1)]
    return [user_roster, *others]


class TestFitWeights:
    def test_empty_roster_is_plain_value_minus_punts(self, values):
        state = create_draft(make_config(user_slot=3))
        profiles = _profiles([[] for _ in range(12)], values)
        w = fit_weights(profiles, 3, {"FT%"}, ROSTER_SIZE)
        assert w["FT%"] == 0.0
        assert all(w[c] == 1.0 for c in CATEGORIES if c != "FT%")

    def test_weights_average_one_and_stay_bounded(self, pool, values):
        state = run_draft(make_config(user_slot=3), pool, values)
        profiles = _profiles([[pool[i] for i in r] for r in state.rosters], values)
        w = fit_weights(profiles, 3, {"AST"}, ROSTER_SIZE)
        assert w["AST"] == 0.0
        live = [w[c] for c in CATEGORIES if c != "AST"]
        assert abs(sum(live) / len(live) - 1.0) < 0.05  # normalized (clamps aside)
        assert all(MIN_WEIGHT <= x <= MAX_WEIGHT for x in live)

    def test_gradient_matches_expected_wins(self, values):
        """The weights are the derivative of the record: nudging the team's
        per-slot z in a category moves expected_wins by grad * delta."""
        board = sorted(PLAYERS, key=lambda p: -score_player(values[p.id], MARKET_WEIGHTS))[:156]
        rosters = [board[i::12] for i in range(12)]
        profiles = _profiles(rosters, values)
        grad = win_gradient(profiles, 0, set(), ROSTER_SIZE)
        base = expected_wins(profiles)[0]
        delta = 1e-4
        for c in ("PTS", "STL", "FT%"):
            bumped = profiles[0].per_slot_z | {c: profiles[0].per_slot_z[c] + delta}
            nudged = [profiles[0].__class__(**{**profiles[0].__dict__, "per_slot_z": bumped}), *profiles[1:]]
            numeric = (expected_wins(nudged)[0] - base) / delta
            # Full rosters: no dilution, no extra noise — the gradient is exact.
            assert abs(numeric - grad[c]) < 0.02 * max(1.0, abs(grad[c]))

    def test_a_lost_category_is_not_chased(self, values):
        """Late in the draft, a roster far behind everyone in STL gets a
        lower STL weight than a category it is in the thick of — the
        opposite of the old linear needs boost."""
        board = sorted(PLAYERS, key=lambda p: -score_player(values[p.id], MARKET_WEIGHTS))[:150]
        no_steals = sorted(board, key=lambda p: values[p.id]["STL"])[:11]
        profiles = _profiles(_league(values, no_steals), values)
        w = fit_weights(profiles, 0, set(), ROSTER_SIZE)
        field = sum(p.per_slot_z["STL"] for p in profiles[1:]) / 11
        assert profiles[0].per_slot_z["STL"] < field - 0.5  # genuinely hopeless
        contested = max(CATEGORIES, key=lambda c: w[c])
        assert w["STL"] < 1.0 < w[contested]
        assert w["STL"] <= CONCEDE_THRESHOLD
        assert category_stances(w, profiles, 0, set())["STL"] == "behind"

    def test_an_owned_category_is_not_bought_again(self, values):
        board = sorted(PLAYERS, key=lambda p: -score_player(values[p.id], MARKET_WEIGHTS))[:150]
        blockers = sorted(board, key=lambda p: -values[p.id]["BLK"])[:11]
        profiles = _profiles(_league(values, blockers), values)
        w = fit_weights(profiles, 0, set(), ROSTER_SIZE)
        assert w["BLK"] < 1.0
        assert category_stances(w, profiles, 0, set())["BLK"] in ("ahead", "even")
        assert w["BLK"] <= CONCEDE_THRESHOLD or w["BLK"] < min(w[c] for c in CATEGORIES if c != "BLK") + 0.2

    def test_early_deficits_are_diluted(self, values):
        """One bad-FT% pick doesn't make FT% a lost cause with twelve picks
        to come: after a single player the weights are all but uniform."""
        board = sorted(PLAYERS, key=lambda p: -score_player(values[p.id], MARKET_WEIGHTS))[:40]
        brick = min(board, key=lambda p: values[p.id]["FT%"])
        profiles = _profiles(_league(values, [brick]), values)
        w = fit_weights(profiles, 0, set(), ROSTER_SIZE)
        assert all(abs(w[c] - 1.0) < 0.05 for c in CATEGORIES)
        assert all(s == "even" for s in category_stances(w, profiles, 0, set()).values())

    def test_stances_follow_thresholds(self, pool, values):
        state = run_draft(make_config(user_slot=3), pool, values)
        profiles = _profiles([[pool[i] for i in r] for r in state.rosters], values)
        w = fit_weights(profiles, 3, {"TO"}, ROSTER_SIZE)
        st = category_stances(w, profiles, 3, {"TO"})
        assert st["TO"] == "punt"
        for c in CATEGORIES:
            if c == "TO":
                continue
            if w[c] >= NEED_THRESHOLD:
                assert st[c] == "lean"
            elif w[c] <= CONCEDE_THRESHOLD:
                assert st[c] in ("ahead", "behind")
            else:
                assert st[c] == "even"


class TestDraftWindow:
    def _advance(self, state, pool, values):
        while current_team_id(state) != state.config.user_slot:
            t = current_team_id(state)
            state = apply_pick(state, pool, choose_bot_pick(state, pool, values, t))
        return state

    def test_size_covers_the_picks_until_the_next_turn_plus_reach(self, pool, values):
        state = self._advance(create_draft(make_config(user_slot=5)), pool, values)
        assert user_turns(state) == [5, 18]
        assert window_size(state) == (18 - 5 - 1) + reach(6)  # 12 bot picks + 6
        assert reach(6) == REACH_MIN and reach(100) == 15
        info = window_info(state)
        assert info == {"size": 18, "pick": 6, "nextPick": 19, "reach": 6}

    def test_window_is_the_top_of_the_board(self, pool, values):
        state = self._advance(create_draft(make_config(user_slot=5)), pool, values)
        market = {pid: score_player(values[pid], MARKET_WEIGHTS) for pid in pool}
        window = draft_window(state, pool, market)
        board = sorted(available_player_ids(state, pool), key=lambda i: -market[i])
        assert window == board[: window_size(state)]
        assert len(window) == 18

    def test_window_is_stable_while_bots_draft_toward_the_user(self, pool, values):
        """Between the user's turns the window already includes the players
        the bots in between will take, so it only shrinks from the top."""
        state = create_draft(make_config(user_slot=5))
        market = {pid: score_player(values[pid], MARKET_WEIGHTS) for pid in pool}
        before = draft_window(state, pool, market)
        assert window_size(state) == 5 + 12 + REACH_MIN
        at_turn = draft_window(self._advance(state, pool, values), pool, market)
        assert set(at_turn) <= set(before)

    def test_back_to_back_picks_and_last_pick(self, pool, values):
        state = self._advance(create_draft(make_config(user_slot=11)), pool, values)
        assert user_turns(state) == [11, 12]
        assert window_size(state) == REACH_MIN  # nobody picks in between: only the reach
        # Last round, last user pick: everyone left is in range.
        state = run_draft(make_config(user_slot=0), pool, values)
        state = rewind_to_pick(state, pool, 12 * 12)  # round 13 opens with slot 0
        assert user_turns(state) == [len(state.picks)]
        assert window_size(state) == len(state.order) - len(state.picks)
        assert len(draft_window(state, pool, market={pid: 0.0 for pid in pool})) == window_size(state)

    def test_no_window_once_the_user_is_done(self, pool, values):
        state = run_draft(make_config(user_slot=0), pool, values)
        assert window_size(state) is None
        assert draft_window(state, pool, {}) == []
