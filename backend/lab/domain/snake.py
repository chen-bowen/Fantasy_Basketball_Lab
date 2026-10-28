"""Snake draft order."""


def build_snake_order(num_teams: int, rounds: int) -> list[int]:
    """order[i] = teamId (0-based) picking at overall pick i."""
    order = []
    for r in range(rounds):
        for p in range(num_teams):
            order.append(p if r % 2 == 0 else num_teams - 1 - p)
    return order


def round_of_pick(num_teams: int, pick_index: int) -> int:
    return pick_index // num_teams + 1  # 1-based


def pick_in_round_of_pick(num_teams: int, pick_index: int) -> int:
    return pick_index % num_teams + 1  # 1-based
