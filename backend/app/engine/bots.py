"""Bot drafters.

choose_bot_pick is pure selection: the bot sees only the current draft
state — no future picks leak in.

  S(p,t) = Σ w(t,c)·v(p,c) + ρ_t·[Σ w(t,c)·h(p,c) − Σ w(t,c)·v(p,c)] + ε

w(t,c) starts from the market's category weights (market.py) — bots pay
for categories the way real drafters do, not the way the scoresheet counts
them — and a punt bot zeroes one category, a needs bot tilts toward its
deficits. v is the player's availability-adjusted value, h his value if he
played every game, so the bracket is what injury risk costs him under this
bot's weights (floored at zero: a below-replacement player loses nothing by
sitting, and there is nothing to gamble on). ρ_t is the bot's risk
appetite: a cautious bot (ρ < 0) doubles down on the discount, a bold one
(ρ > 0) shrugs off half of it, like the drafter who always gambles on the
hurt star. Unsigned players get no such treatment — being on no roster is
not injury risk. ε is small noise derived from (seed, pick_index, team,
player).
"""

from __future__ import annotations

from ..analysis.category_weights import needs_weights, punt_bot_weights
from ..analysis.market import MARKET_WEIGHTS
from ..analysis.player_values import (
    CategoryWeights,
    CategoryZ,
    score_player,
)
from ..analysis.roster_profile import build_roster_profile
from .draft import DraftState, available_player_ids
from .random import centered_random, seeded_pick, unit_random
from .types import BOT_RISKS, CATEGORIES, BotSpec, Player

# Scale of seeded jitter — reorders near-ties without reaching deep.
EPSILON_SCALE = 0.6

# ρ by risk appetite: share of the availability discount a bot adds back
# (bold) or piles on (cautious).
RISK_TILT = {"cautious": -0.5, "neutral": 0.0, "bold": 0.5}


def _epsilon(seed: str, pick_index: int, team_id: int, player_id: str) -> float:
    return centered_random(seed, "eps", pick_index, team_id, player_id) * EPSILON_SCALE


def bot_weights(
    state: DraftState,
    pool: dict[str, Player],
    values: dict[str, CategoryZ],
    team_id: int,
) -> CategoryWeights:
    """The w_{t,c} term for a bot team at the current draft state."""
    spec = state.config.bot_specs[team_id]
    if spec.kind == "value":
        return dict(MARKET_WEIGHTS)
    if spec.kind == "punt":
        return punt_bot_weights(spec.punt_category or "TO", MARKET_WEIGHTS)
    if spec.kind == "needs":
        profiles = [
            build_roster_profile([pool[i] for i in roster], values)
            for roster in state.rosters
        ]
        return needs_weights(profiles, team_id, MARKET_WEIGHTS)
    raise ValueError(f"unknown bot kind {spec.kind}")


def risk_adjustment(
    spec: BotSpec,
    z: CategoryZ,
    healthy: CategoryZ | None,
    w: CategoryWeights,
) -> float:
    """ρ_t times what availability costs this player under weights w."""
    tilt = RISK_TILT.get(spec.risk, 0.0)
    if not tilt or healthy is None:
        return 0.0
    cost = max(0.0, score_player(healthy, w) - score_player(z, w))
    return tilt * cost


def choose_bot_pick(
    state: DraftState,
    pool: dict[str, Player],
    values: dict[str, CategoryZ],
    team_id: int,
    healthy_values: dict[str, CategoryZ] | None = None,
) -> str:
    """Best available player for this bot. Without healthy_values (the
    full-health z's from PoolStats) every bot drafts risk-neutral."""
    spec = state.config.bot_specs[team_id]
    w = bot_weights(state, pool, values, team_id)
    pick_index = len(state.picks)
    best_id: str | None = None
    best_score = float("-inf")
    for pid in available_player_ids(state, pool):
        z = values.get(pid)
        if z is None:
            continue
        s = score_player(z, w)
        if healthy_values is not None and pool[pid].signed:
            s += risk_adjustment(spec, z, healthy_values.get(pid), w)
        s += _epsilon(state.config.seed, pick_index, team_id, pid)
        if s > best_score:
            best_score = s
            best_id = pid
    if best_id is None:
        raise RuntimeError("No available players to draft")
    return best_id


def _seeded_split(seed: str, tag: str, options: list[str], n: int) -> list[str]:
    """n labels, as evenly split over options as possible, in a seeded order."""
    labels = [options[i % len(options)] for i in range(n)]
    # Deterministic Fisher-Yates shuffle.
    for i in range(len(labels) - 1, 0, -1):
        j = int(unit_random(seed, tag, i) * (i + 1))
        labels[i], labels[j] = labels[j], labels[i]
    return labels


def assign_bot_specs(seed: str, num_teams: int, user_slot: int) -> tuple[BotSpec, ...]:
    """Deterministically assign personalities to all non-user slots —
    roughly even split of strategies and of risk appetites, independently;
    punt bots get a seeded category up front."""
    bot_slots = [t for t in range(num_teams) if t != user_slot]
    kinds = _seeded_split(seed, "kindshuffle", ["value", "needs", "punt"], len(bot_slots))
    risks = _seeded_split(seed, "riskshuffle", BOT_RISKS, len(bot_slots))

    specs: list[BotSpec] = [BotSpec(kind="value")] * num_teams
    for team_id, kind, risk in zip(bot_slots, kinds, risks):
        if kind == "punt":
            cat = seeded_pick(list(CATEGORIES), seed, "puntcat", team_id)
            specs[team_id] = BotSpec(kind="punt", punt_category=cat, risk=risk)
        else:
            specs[team_id] = BotSpec(kind=kind, risk=risk)
    return tuple(specs)
