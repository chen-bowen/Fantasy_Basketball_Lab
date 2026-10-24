"""JSON-file persistence for draft sessions and saved runs.

Draft sessions are saved on every mutation; the client only needs the
draft id to resume. Rewound/abandoned branches and completed drafts are
saved as "runs" so they can be compared in the report.
"""

from __future__ import annotations

import json
import secrets
import time
from pathlib import Path
from typing import Any

STORE_DIR = Path(__file__).resolve().parent / "store"
DRAFTS_DIR = STORE_DIR / "drafts"
RUNS_DIR = STORE_DIR / "runs"


def _ensure() -> None:
    DRAFTS_DIR.mkdir(parents=True, exist_ok=True)
    RUNS_DIR.mkdir(parents=True, exist_ok=True)


def new_id(prefix: str) -> str:
    return f"{prefix}-{secrets.token_hex(4)}"


def save_draft(draft_id: str, payload: dict[str, Any]) -> None:
    _ensure()
    payload = {**payload, "updatedAt": int(time.time() * 1000)}
    (DRAFTS_DIR / f"{draft_id}.json").write_text(json.dumps(payload))


def load_draft(draft_id: str) -> dict[str, Any] | None:
    path = DRAFTS_DIR / f"{draft_id}.json"
    if not path.exists():
        return None
    try:
        return json.loads(path.read_text())
    except json.JSONDecodeError:
        return None


def list_drafts() -> list[dict[str, Any]]:
    _ensure()
    out = []
    for p in DRAFTS_DIR.glob("*.json"):
        try:
            d = json.loads(p.read_text())
            draft = d["draft"]
            out.append(
                {
                    "id": p.stem,
                    "seed": draft["config"]["seed"],
                    "picks": len(draft.get("picks", [])),
                    "status": draft.get("status"),
                    "updatedAt": d.get("updatedAt", 0),
                }
            )
        except (json.JSONDecodeError, KeyError):
            continue
    return sorted(out, key=lambda d: d["updatedAt"], reverse=True)


def delete_draft(draft_id: str) -> None:
    path = DRAFTS_DIR / f"{draft_id}.json"
    path.unlink(missing_ok=True)


def save_run(run_id: str, payload: dict[str, Any]) -> None:
    _ensure()
    (RUNS_DIR / f"{run_id}.json").write_text(json.dumps(payload))


def list_runs() -> list[dict[str, Any]]:
    _ensure()
    out = []
    for p in RUNS_DIR.glob("*.json"):
        try:
            d = json.loads(p.read_text())
            out.append(
                {
                    "id": p.stem,
                    "label": d.get("label", p.stem),
                    "createdAt": d.get("createdAt", 0),
                }
            )
        except json.JSONDecodeError:
            continue
    return sorted(out, key=lambda d: d["createdAt"])


def load_run(run_id: str) -> dict[str, Any] | None:
    path = RUNS_DIR / f"{run_id}.json"
    if not path.exists():
        return None
    try:
        return json.loads(path.read_text())
    except json.JSONDecodeError:
        return None
