"""Snake draft order."""


def build_snake_order(teams: int, rounds: int) -> list[int]:
    """order[i] = teamId (0-based) picking at overall pick i."""
    order = []
    for r in range(rounds):
        for p in range(teams):
            order.append(p if r % 2 == 0 else teams - 1 - p)
    return order


def round_of_pick(teams: int, pick_index: int) -> int:
    return pick_index // teams + 1  # 1-based


def pick_in_round_of_pick(teams: int, pick_index: int) -> int:
    return pick_index % teams + 1  # 1-based
