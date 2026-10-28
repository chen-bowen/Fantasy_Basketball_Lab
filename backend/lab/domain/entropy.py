"""Deterministic, stateless randomness.

Every draw is a pure function of (seed, *context) via a stable hash —
no mutable RNG state, so serialization, replay, and rewind are exact
by construction.
"""

from __future__ import annotations

import hashlib


def unit_random(*parts: object) -> float:
    """Deterministic pseudo-random in [0, 1)."""
    key = "\x1f".join(str(p) for p in parts).encode()
    digest = hashlib.blake2b(key, digest_size=8).digest()
    return int.from_bytes(digest, "big") / 2**64


def centered_random(*parts: object) -> float:
    """Deterministic pseudo-random in [-0.5, 0.5)."""
    return unit_random(*parts) - 0.5


def seeded_pick(items: list, *parts: object):
    """Deterministic pick of one element from a non-empty list."""
    idx = int(unit_random(*parts) * len(items))
    return items[min(idx, len(items) - 1)]
