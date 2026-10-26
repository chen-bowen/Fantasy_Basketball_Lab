#!/usr/bin/env python3
"""fit_market_weights — calibrate the draft-table category weights to ADP.

The engine's z-scores say what a player produces per category. How much
drafters *pay* for each category is a different thing: real ADP rewards
points and assists far above steals, free-throw percentage or turnovers.
This script recovers those preferences from the frozen pool's ADP column
and prints the weight vector to paste into app/analysis/market.py as
FITTED_WEIGHTS (the engine blends them with uniform weights there).

Method: ridge regression of -log(ADP) on the nine availability-adjusted
category z's over the draftable pool (ADP <= 156), shrunk toward uniform
weights rather than toward zero so a thin ADP sample can't produce wild
values. The shrinkage strength is picked by out-of-sample rank correlation
over random half-splits, and the result is normalized so the nine weights
average 1.0 (keeping the overall score on the same scale as a plain z sum)
and rounded to 0.05.

Usage:
    python backend/scripts/fit_market_weights.py [--lam L] [--splits N]
"""

from __future__ import annotations

import argparse
import math
import random
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.analysis.player_values import compute_player_values  # noqa: E402
from app.data.pool import PLAYERS  # noqa: E402
from app.engine.types import CATEGORIES, Player  # noqa: E402

DRAFTABLE_ADP = 12 * 13
LAMBDAS = (0.3, 1, 3, 10, 30, 100)
ROUND_TO = 0.05


def spearman(xs: list[float], ys: list[float]) -> float:
    n = len(xs)

    def ranks(v: list[float]) -> dict[int, int]:
        return {i: r for r, i in enumerate(sorted(range(n), key=lambda i: v[i]))}

    rx, ry = ranks(xs), ranks(ys)
    return 1 - 6 * sum((rx[i] - ry[i]) ** 2 for i in range(n)) / (n * (n * n - 1))


def solve(a: list[list[float]], b: list[float]) -> list[float]:
    """Gaussian elimination with partial pivoting (k is 9; no numpy needed)."""
    k = len(b)
    m = [row[:] + [b[i]] for i, row in enumerate(a)]
    for c in range(k):
        piv = max(range(c, k), key=lambda r: abs(m[r][c]))
        m[c], m[piv] = m[piv], m[c]
        for r in range(k):
            if r != c:
                f = m[r][c] / m[c][c]
                m[r] = [m[r][j] - f * m[c][j] for j in range(k + 1)]
    return [m[i][k] / m[i][i] for i in range(k)]


def fit(players: list[Player], values: dict, lam: float) -> dict[str, float]:
    """Ridge toward uniform: minimize ||y - Xw||^2 + lam * ||w - s*1||^2 where
    s is the scale of a uniform fit, so shrinkage pulls toward 'all
    categories equal', not 'no category matters'."""
    x = [[values[p.id][c] for c in CATEGORIES] for p in players]
    y = [-math.log(p.adp) for p in players]
    n, k = len(x), len(CATEGORIES)
    mx = [sum(r[j] for r in x) / n for j in range(k)]
    my = sum(y) / n
    xc = [[r[j] - mx[j] for j in range(k)] for r in x]
    yc = [v - my for v in y]
    # Scale of the uniform fit: regress y on the plain z sum.
    u = [sum(r) for r in xc]
    s = sum(ui * yi for ui, yi in zip(u, yc)) / (sum(ui * ui for ui in u) or 1.0)
    a = [
        [sum(xc[i][p] * xc[i][q] for i in range(n)) + (lam if p == q else 0.0) for q in range(k)]
        for p in range(k)
    ]
    b = [sum(xc[i][p] * yc[i] for i in range(n)) + lam * s for p in range(k)]
    w = solve(a, b)
    scale = sum(w) / k
    return {c: wi / scale for c, wi in zip(CATEGORIES, w)}


def out_of_sample(players: list[Player], values: dict, lam: float, splits: int) -> float:
    rng = random.Random(7)
    rhos = []
    for _ in range(splits):
        ps = players[:]
        rng.shuffle(ps)
        a, b = ps[: len(ps) // 2], ps[len(ps) // 2 :]
        w = fit(a, values, lam)
        rhos.append(
            spearman(
                [sum(w[c] * values[p.id][c] for c in CATEGORIES) for p in b],
                [-p.adp for p in b],
            )
        )
    return sum(rhos) / len(rhos)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--lam", type=float, default=None, help="fix the shrinkage instead of searching")
    ap.add_argument("--splits", type=int, default=40)
    args = ap.parse_args()

    values, _ = compute_player_values(PLAYERS)
    draftable = [p for p in PLAYERS if p.adp is not None and p.adp <= DRAFTABLE_ADP]
    print(f"{len(draftable)} players with ADP <= {DRAFTABLE_ADP}")

    base = spearman(
        [sum(values[p.id][c] for c in CATEGORIES) for p in draftable],
        [-p.adp for p in draftable],
    )
    print(f"uniform weights: rho vs ADP = {base:.3f}")

    if args.lam is None:
        scores = {lam: out_of_sample(draftable, values, lam, args.splits) for lam in LAMBDAS}
        for lam, rho in scores.items():
            print(f"  lam={lam:<5g} out-of-sample rho = {rho:.3f}")
        lam = max(scores, key=scores.get)
    else:
        lam = args.lam
    w = fit(draftable, values, lam)
    rounded = {c: round(w[c] / ROUND_TO) * ROUND_TO for c in CATEGORIES}
    rho = spearman(
        [sum(rounded[c] * values[p.id][c] for c in CATEGORIES) for p in draftable],
        [-p.adp for p in draftable],
    )
    print(f"\nlam={lam:g}: rho vs ADP = {rho:.3f} (uniform {base:.3f})")
    print("\nFITTED_WEIGHTS = {")
    for c in CATEGORIES:
        print(f'    "{c}": {rounded[c]:.2f},')
    print("}")


if __name__ == "__main__":
    main()
