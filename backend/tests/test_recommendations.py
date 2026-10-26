"""Acceptance: the draft room's recommendations are in range for the pick.

Plays drafts through the API, taking the top candidate at every user turn,
and checks at each turn that

  - every candidate is someone the board expects to go before the user's
    next pick (plus the reach) — nobody ranked 100 spots below the pick;
  - candidates are ordered by Fit, not by market value, and the market's
    price does not decide the order (underpriced players rise);
  - the 0-10 scale tops out at the best candidate;
  - players outside the window are still scored, but never recommended.
"""

from fastapi.testclient import TestClient

from app.analysis.window import reach
from app.main import OVERALL_RANK, app
from app.engine.types import CATEGORIES


def _play_to_user_turn(client, d):
    while not d["isUserTurn"] and not d["complete"]:
        d = client.post(f"/api/drafts/{d['id']}/bot-pick").json()
    return d


def _board(d):
    """Available players in market order (the draft board as the room sees it)."""
    return sorted(d["fit"], key=lambda pid: OVERALL_RANK[pid])


def test_candidates_are_in_range_and_ranked_by_fit():
    client = TestClient(app)
    for slot in (0, 5, 11):
        d = client.post("/api/drafts", json={"seed": f"range-{slot}", "userSlot": slot}).json()
        d = _play_to_user_turn(client, d)
        turns = 0
        while not d["complete"] and turns < 9:
            pick = d["pickIndex"] + 1
            window = d["window"]
            cands = d["candidates"]
            assert window["pick"] == pick and len(cands) == window["size"]
            board = _board(d)
            positions = {pid: i + 1 for i, pid in enumerate(board)}
            # In range: the window is the top of the board, nobody deeper.
            assert all(positions[pid] <= window["size"] for pid in cands)
            assert window["size"] <= (window["nextPick"] - pick - 1) + reach(pick)
            # Nobody ranked a full 100 spots below this pick is a candidate.
            assert all(OVERALL_RANK[pid] < pick + 100 for pid in cands)
            # Ordered by Fit (desc), and it is Fit not value that orders them.
            fits = [d["fit"][pid] for pid in cands]
            assert fits == sorted(fits, reverse=True)
            if len(cands) > 3 and turns > 0:
                assert [OVERALL_RANK[pid] for pid in cands] != sorted(OVERALL_RANK[pid] for pid in cands)
            # The scale tops out at the best candidate; out-of-window players
            # keep a raw Fit but are not candidates.
            assert d["fitScale"]["best"] == max(fits)
            assert d["fitScale"]["floor"] <= min(fits)
            assert set(d["fit"]) > set(cands)
            d = client.post(f"/api/drafts/{d['id']}/picks", json={"playerId": cands[0]}).json()
            d = _play_to_user_turn(client, d)
            turns += 1


def test_following_the_recommendation_never_reaches():
    """Across three drafts the top candidate sits within the window at every
    pick: taking him is never a reach past what the board would leave."""
    client = TestClient(app)
    worst = 0
    for slot in (2, 7):
        d = client.post("/api/drafts", json={"seed": f"reach-{slot}", "userSlot": slot}).json()
        d = _play_to_user_turn(client, d)
        while not d["complete"]:
            pick = d["pickIndex"] + 1
            top = d["candidates"][0]
            positions = {pid: i + 1 for i, pid in enumerate(_board(d))}
            allowed = (d["window"]["nextPick"] or d["totalPicks"] + 1) - pick - 1 + reach(pick)
            assert positions[top] <= max(allowed, 1)
            worst = max(worst, positions[top])
            d = client.post(f"/api/drafts/{d['id']}/picks", json={"playerId": top}).json()
            d = _play_to_user_turn(client, d)
    assert worst <= 12 + 20  # back-to-back slots see a round plus the reach


def test_stances_and_weights_are_reported():
    client = TestClient(app)
    d = client.post("/api/drafts", json={"seed": "stances", "userSlot": 4}).json()
    assert set(d["stances"]) == set(CATEGORIES)
    assert all(s == "even" for s in d["stances"].values())  # empty roster: plain value
    d = _play_to_user_turn(client, d)
    for _ in range(8):
        d = client.post(f"/api/drafts/{d['id']}/picks", json={"playerId": d["candidates"][0]}).json()
        d = _play_to_user_turn(client, d)
    for c in d["userPunts"]:
        assert d["stances"][c] == "punt" and d["fitWeights"][c] == 0.0
    live = [d["fitWeights"][c] for c in CATEGORIES if c not in d["userPunts"]]
    assert all(0.5 <= w <= 1.8 for w in live)
    assert d["neededCategories"] == [c for c in CATEGORIES if d["stances"][c] == "lean"]
