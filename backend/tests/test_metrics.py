"""Milestone 3 acceptance: z-scores, roster aggregation, concede rankings."""

from lab.metrics.weighting import shortfall_weights
from lab.metrics.ratings import (
    EVEN_WEIGHTS,
    score_pool,
    concede_weights,
    line_score,
)
from lab.metrics.profile import roster_line, cat_ranks
from lab.pool.loader import PLAYERS
from lab.domain.model import CATEGORIES

import pytest


@pytest.fixture(scope="module")
def values_and_pool():
    return score_pool(PLAYERS)


def top_by_score(values, weights, n=10):
    return [
        p.id
        for p in sorted(
            PLAYERS,
            key=lambda p: line_score(values[p.id], weights),
            reverse=True,
        )[:n]
    ]


class TestPlayerValues:
    def test_every_player_has_finite_z(self, values_and_pool):
        values, _ = values_and_pool
        for p in PLAYERS:
            z = values[p.id]
            for c in CATEGORIES:
                assert z[c] == z[c]  # not NaN

    def test_top_ranked_are_plausible(self, values_and_pool):
        """The top of the board is star production: heavy minutes and
        franchise counting lines, not specialists."""
        values, _ = values_and_pool
        top = [
            p for p in sorted(
                PLAYERS, key=lambda p: line_score(values[p.id], EVEN_WEIGHTS),
                reverse=True,
            )[:15]
        ]
        assert all(p.mpg >= 25 for p in top)
        assert sum(p.pts + p.reb + p.ast for p in top) / len(top) > 30

    def test_turnovers_reversed(self, values_and_pool):
        values, _ = values_and_pool
        rotation = [p for p in PLAYERS if p.mpg > 20]
        high_to = max(rotation, key=lambda p: p.tov)
        careful = min(rotation, key=lambda p: p.tov)
        assert values[careful.id]["TO"] > values[high_to.id]["TO"]

    def test_fg_pct_uses_volume(self, values_and_pool):
        _, pool = values_and_pool
        assert 0.40 < pool.lg_fg_pct < 0.55
        assert 0.70 < pool.lg_ft_pct < 0.85

    def test_punt_weights_change_ranking_not_stats(self, values_and_pool):
        values, _ = values_and_pool
        a = top_by_score(values, EVEN_WEIGHTS, 20)
        b = top_by_score(values, concede_weights({"FT%"}), 20)
        assert a != b
        w = concede_weights({"FT%"})
        assert w["FT%"] == 0.0
        assert all(w[c] == 1.0 for c in CATEGORIES if c != "FT%")


class TestRosterProfile:
    def test_aggregates_and_recomputes_percentages(self, values_and_pool):
        values, _ = values_and_pool
        roster = PLAYERS[:3]
        prof = roster_line(roster, values)
        assert prof.size == 3
        assert prof.totals["pts"] == pytest.approx(sum(p.pts for p in roster))
        expected_fg = sum(p.fgm for p in roster) / sum(p.fga for p in roster)
        assert prof.fg_pct == pytest.approx(expected_fg)

    def test_per_slot_fair_comparison(self, values_and_pool):
        values, _ = values_and_pool
        strong = roster_line(PLAYERS[:5], values)
        weak = roster_line(PLAYERS[100:113], values)
        # 5 great players beat 13 mediocre ones per slot, lose on totals.
        assert strong.per_slot_z["PTS"] > weak.per_slot_z["PTS"]
        assert weak.totals["pts"] > strong.totals["pts"]

    def test_rank_teams(self, values_and_pool):
        values, _ = values_and_pool
        profiles = [
            roster_line(PLAYERS[:13], values),
            roster_line(PLAYERS[13:26], values),
        ]
        ranks = cat_ranks(profiles)
        for c in CATEGORIES:
            assert sorted(ranks[c]) == [1, 2]


class TestNeedsWeights:
    def test_capped_for_extreme_deficits(self, values_and_pool):
        values, _ = values_and_pool
        empty = roster_line([], values)
        full = roster_line(PLAYERS[:13], values)
        w = shortfall_weights([empty, full], 1)
        for c in CATEGORIES:
            assert 0.6 <= w[c] <= 2.0


class TestDatasetIntegrity:
    def test_enough_players(self):
        assert len(PLAYERS) >= 180

    def test_unique_ids_sane_stats(self):
        ids = {p.id for p in PLAYERS}
        assert len(ids) == len(PLAYERS)
        for p in PLAYERS:
            assert p.pts > 0
            assert p.fga > 0
            assert len(p.positions) > 0
            # pts ≈ 2*fgm + tpm + ftm (within rounding of per-game averages)
            assert abs(p.pts - (2 * p.fgm + p.threes + p.ftm)) < 1.5
