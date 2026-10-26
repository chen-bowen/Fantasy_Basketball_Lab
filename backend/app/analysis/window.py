"""Draft window: the players in range at the user's pick.

Fit says who helps the team most, but a draft is a sequence of picks with
a price on each: a player the room won't take for two more rounds costs
nothing to wait on, and spending this pick on him passes up the players
who are gone by the next turn. So the candidates at a pick are the top of
the draft board as the market sees it — every player expected to go
before the user's next turn, plus a margin of reach for the ones the
market underprices — and Fit ranks *within* that window. Players outside
it are still scored, but shown as later-round targets, never as the pick.

Window size = picks until the user's next turn + max(REACH_MIN, REACH_SHARE
x current pick): half a round early, growing with the pick number because
ADP is noisier the deeper the draft goes (a 100th pick can land anywhere
in a 30-pick band). Between the user's turns the window also covers the
bot picks still to come before his turn, so the list is stable while the
room drafts toward him. On the last turn everyone left is in range.

Market value, not the scoresheet, defines the board: it is what the bots
draft by (market.py), so "expected to go before your next pick" is read
off the same ranking that decides it.
"""

from __future__ import annotations

from ..engine.draft import DraftState, available_player_ids, is_complete
from ..engine.types import Player

REACH_MIN = 6  # half a round of reach in a 12-team league
REACH_SHARE = 0.15  # ...growing with the pick number


def user_turns(state: DraftState, count: int = 2) -> list[int]:
    """Pick indices of the user's next `count` turns, the current pick included."""
    slot = state.config.user_slot
    start = len(state.picks)
    out: list[int] = []
    for i in range(start, len(state.order)):
        if state.order[i] == slot:
            out.append(i)
            if len(out) == count:
                break
    return out


def reach(pick_number: int) -> int:
    """Spots of reach beyond the picks until the next turn, for a pick number (1-based)."""
    return max(REACH_MIN, round(REACH_SHARE * pick_number))


def window_size(state: DraftState) -> int | None:
    """How many of the available board's top players are in range at the
    user's upcoming pick; None when no user pick is left."""
    turns = user_turns(state, 2)
    if not turns:
        return None
    remaining = len(state.order) - len(state.picks)
    if len(turns) < 2:
        return remaining  # the user's last pick: everyone left is in range
    picks_before_next = turns[1] - len(state.picks) - 1
    return max(1, min(remaining, picks_before_next + reach(turns[0] + 1)))


def draft_window(
    state: DraftState, pool: dict[str, Player], market: dict[str, float]
) -> list[str]:
    """The candidates at the user's upcoming pick, in board order (market
    value, best first). Empty once the user has no pick left."""
    if is_complete(state):
        return []
    size = window_size(state)
    if size is None:
        return []
    board = sorted(available_player_ids(state, pool), key=lambda pid: -market.get(pid, float("-inf")))
    return board[:size]


def window_info(state: DraftState) -> dict:
    """What the window covers, for the UI: its size, the user's upcoming
    and following pick numbers, and the reach beyond the latter."""
    turns = user_turns(state, 2)
    size = window_size(state)
    return {
        "size": size,
        "pick": turns[0] + 1 if turns else None,
        "nextPick": turns[1] + 1 if len(turns) > 1 else None,
        "reach": reach(turns[0] + 1) if len(turns) > 1 else None,
    }
