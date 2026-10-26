"""Milestone 3 acceptance: z-scores, roster aggregation, punt rankings."""

from app.analysis.category_weights import needs_multipliers, needs_weights
from app.analysis.player_values import (
    DRAFT_WEIGHTS,
    UNIFORM_WEIGHTS,
    compute_player_values,
    punt_weights,
    score_player,
)
from app.analysis.roster_profile import build_roster_profile, rank_teams
from app.data.pool import PLAYERS
from app.engine.types import CATEGORIES

import pytest


@pytest.fixture(scope="module")
def values_and_pool():
    return compute_player_values(PLAYERS)


def top_by_score(values, weights, n=10):
    return [
        p.id
        for p in sorted(
            PLAYERS,
            key=lambda p: score_player(values[p.id], weights),
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
        values, _ = values_and_pool
        top = {
            PLAYERS[[p.id for p in PLAYERS].index(pid)].name
            for pid in top_by_score(values, UNIFORM_WEIGHTS, 15)
        }
        studs = {
            "Nikola Jokić", "Shai Gilgeous-Alexander", "Victor Wembanyama",
            "Luka Dončić", "Giannis Antetokounmpo", "Cade Cunningham",
            "Jalen Johnson", "Josh Giddey", "Tyrese Maxey",
        }
        assert len(top & studs) >= 3

    def test_turnovers_reversed(self, values_and_pool):
        values, _ = values_and_pool
        high_to = next(p for p in PLAYERS if p.name.endswith("Westbrook"))
        careful = next(p for p in PLAYERS if p.tov <= 1.0 and p.min > 20)
        assert values[careful.id]["TO"] > values[high_to.id]["TO"]

    def test_fg_pct_uses_volume(self, values_and_pool):
        _, pool = values_and_pool
        assert 0.40 < pool.lg_fg_pct < 0.55
        assert 0.70 < pool.lg_ft_pct < 0.85

    def test_punt_weights_change_ranking_not_stats(self, values_and_pool):
        values, _ = values_and_pool
        a = top_by_score(values, DRAFT_WEIGHTS, 20)
        b = top_by_score(values, punt_weights({"FT%"}), 20)
        assert a != b
        w = punt_weights({"FT%"})
        assert w["FT%"] == 0.0
        assert all(w[c] == DRAFT_WEIGHTS[c] for c in CATEGORIES if c != "FT%")

    def test_draft_weights_rank_stars_over_role_players(self, values_and_pool):
        """The room prices the box score: a 3-and-D guard with low
        turnovers must not outrank the stars, however tidy his z-sum."""
        values, _ = values_and_pool
        by_name = {p.name: p for p in PLAYERS}
        rank = {
            pid: i + 1 for i, pid in enumerate(top_by_score(values, DRAFT_WEIGHTS, len(PLAYERS)))
        }
        stars = ["Nikola Jokić", "Shai Gilgeous-Alexander", "Luka Dončić", "Cade Cunningham", "Anthony Edwards"]
        role = ["Derrick White", "Mikal Bridges", "Nickeil Alexander-Walker", "Dyson Daniels"]
        assert all(rank[by_name[s].id] <= 20 for s in stars)
        assert all(rank[by_name[r].id] > 30 for r in role)
        # …and the uniform z-sum is what made them look like stars.
        uniform = {pid: i + 1 for i, pid in enumerate(top_by_score(values, UNIFORM_WEIGHTS, len(PLAYERS)))}
        assert min(uniform[by_name[r].id] for r in role) <= 20


class TestRosterProfile:
    def test_aggregates_and_recomputes_percentages(self, values_and_pool):
        values, _ = values_and_pool
        roster = PLAYERS[:3]
        prof = build_roster_profile(roster, values)
        assert prof.size == 3
        assert prof.totals["pts"] == pytest.approx(sum(p.pts for p in roster))
        expected_fg = sum(p.fgm for p in roster) / sum(p.fga for p in roster)
        assert prof.fg_pct == pytest.approx(expected_fg)

    def test_per_slot_fair_comparison(self, values_and_pool):
        values, _ = values_and_pool
        strong = build_roster_profile(PLAYERS[:5], values)
        weak = build_roster_profile(PLAYERS[100:113], values)
        # 5 great players beat 13 mediocre ones per slot, lose on totals.
        assert strong.per_slot_z["PTS"] > weak.per_slot_z["PTS"]
        assert weak.totals["pts"] > strong.totals["pts"]

    def test_rank_teams(self, values_and_pool):
        values, _ = values_and_pool
        profiles = [
            build_roster_profile(PLAYERS[:13], values),
            build_roster_profile(PLAYERS[13:26], values),
        ]
        ranks = rank_teams(profiles)
        for c in CATEGORIES:
            assert sorted(ranks[c]) == [1, 2]


class TestNeedsWeights:
    def test_capped_for_extreme_deficits(self, values_and_pool):
        values, _ = values_and_pool
        empty = build_roster_profile([], values)
        full = build_roster_profile(PLAYERS[:13], values)
        m = needs_multipliers([empty, full], 1)
        w = needs_weights([empty, full], 1)
        for c in CATEGORIES:
            assert 0.6 <= m[c] <= 2.0
            assert w[c] == pytest.approx(DRAFT_WEIGHTS[c] * m[c])


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
            assert abs(p.pts - (2 * p.fgm + p.tpm + p.ftm)) < 1.5
