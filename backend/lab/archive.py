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

ARCHIVE_DIR = Path(__file__).resolve().parent / "store"
SESSIONS_DIR = ARCHIVE_DIR / "drafts"
RESULTS_DIR = ARCHIVE_DIR / "runs"


def _ensure() -> None:
    SESSIONS_DIR.mkdir(parents=True, exist_ok=True)
    RESULTS_DIR.mkdir(parents=True, exist_ok=True)


def mint_id(prefix: str) -> str:
    return f"{prefix}-{secrets.token_hex(4)}"


def put_session(session_id: str, payload: dict[str, Any]) -> None:
    _ensure()
    payload = {**payload, "updatedAt": int(time.time() * 1000)}
    (SESSIONS_DIR / f"{session_id}.json").write_text(json.dumps(payload))


def get_session(session_id: str) -> dict[str, Any] | None:
    path = SESSIONS_DIR / f"{session_id}.json"
    if not path.exists():
        return None
    try:
        return json.loads(path.read_text())
    except json.JSONDecodeError:
        return None


def session_index() -> list[dict[str, Any]]:
    _ensure()
    out = []
    for p in SESSIONS_DIR.glob("*.json"):
        try:
            d = json.loads(p.read_text())
            draft = d["draft"]
            out.append(
                {
                    "id": p.stem,
                    "seed": draft["config"]["seed"],
                    "selections": len(draft.get("picks", [])),
                    "status": draft.get("status"),
                    "updatedAt": d.get("updatedAt", 0),
                }
            )
        except (json.JSONDecodeError, KeyError):
            continue
    return sorted(out, key=lambda d: d["updatedAt"], reverse=True)


def drop_session(session_id: str) -> None:
    path = SESSIONS_DIR / f"{session_id}.json"
    path.unlink(missing_ok=True)


def put_result(result_id: str, payload: dict[str, Any]) -> None:
    _ensure()
    (RESULTS_DIR / f"{result_id}.json").write_text(json.dumps(payload))


def result_index() -> list[dict[str, Any]]:
    _ensure()
    out = []
    for p in RESULTS_DIR.glob("*.json"):
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


def get_result(result_id: str) -> dict[str, Any] | None:
    path = RESULTS_DIR / f"{result_id}.json"
    if not path.exists():
        return None
    try:
        return json.loads(path.read_text())
    except json.JSONDecodeError:
        return None
