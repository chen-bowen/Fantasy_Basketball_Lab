# Fantasy Draft Lab — Draft Simulator

Single-player, category-league fantasy basketball mock draft. You pick against
11 rule-based bots, watch your team's category identity develop, and review
the result.

**League format:** head-to-head categories · 12 teams · snake draft · 13-round
rosters · one human slot. Categories: PTS, REB, AST, STL, BLK, 3PM, FG%, FT%,
TO. No positional requirements (deliberate V1 simplification).

**Architecture:** Python/FastAPI backend owns the draft engine, bot logic,
category analysis, player data pipeline, and JSON persistence. The React
frontend is a thin presentation client over `http://localhost:8000/api`.

## Commands

```bash
# one-time setup (from repo root)
npm run setup:web                          # frontend deps (web/)
uv venv && uv pip install -r backend/requirements.txt   # backend deps

# run both servers (two terminals)
npm run dev:backend    # FastAPI on :8000
npm run dev            # Vite on :5173 (proxies /api → :8000)

# tests & checks
npm test               # pytest: engine/analysis/bot/persistence suite
npm run build          # typecheck + production build
npm run smoke          # headless end-to-end UI test (needs both servers)
npm run data:fetch     # regenerate backend/app/data/players.json from live stats
```

Root `package.json` delegates everything; `web/package.json` holds the
real frontend deps/scripts if you prefer to work inside `web/` directly.

## Player data

The engine consumes one **frozen dataset**: `backend/app/data/players.json`
(280 players). `npm run data:fetch` regenerates it:

- Per-game stats from `stats.nba.com` (`leaguedashplayerstats`), current
  season.
- Players who missed most of the season fall back to the prior season's
  stats ("last available season" rule) — tagged via `asOfSeason`.
- Positions from ESPN's roster API; unmatched players get a stats-based guess.
- Raw responses cache in `.cache/` for 12h (`--no-cache` to bypass).

## Backend layout

```
backend/
  app/
    engine/       types.py · random.py · snake.py · draft.py · bots.py
                  (pure, JSON-serializable state)
    analysis/     player_values.py · roster_profile.py · category_weights.py
    data/         pool.py (frozen pool loader) + players.json
    store.py      JSON-file persistence (sessions + saved runs)
    views.py      DraftView serializer (state + derived analysis per response)
    main.py       FastAPI routes
  scripts/fetch_players.py   data pipeline
  tests/          pytest suite
```

The frontend (`web/`) keeps only UI state: `src/api/client.ts` is a typed
HTTP client, `src/state/useSession.ts` drives mutations and spaces out bot
ticks, and `src/components/` render the DraftView the API returns.

## API

| Endpoint | Purpose |
| --- | --- |
| `GET /api/players` | frozen pool with overall scores |
| `POST /api/drafts` | create draft `{seed, userSlot}` → DraftView |
| `GET /api/drafts` / `GET /api/drafts/{id}` | list / resume |
| `POST /api/drafts/{id}/picks` | apply a pick (validated, snake order) |
| `POST /api/drafts/{id}/bot-pick` | advance one bot pick |
| `POST .../pause` `.../resume` | status control |
| `PUT /api/drafts/{id}/punts` | user punt categories → rescored view |
| `POST /api/drafts/{id}/preview` | before/after roster profile for a player |
| `POST /api/drafts/{id}/rewind` | rewind to pick n (saves abandoned branch) |
| `GET /api/runs` / `GET /api/runs/{id}` | saved runs for comparison |

Every mutation returns a full `DraftView` — draft state plus derived
analysis (team profiles, per-category ranks, player scores under punt
settings). Persistence is JSON files under `backend/app/store/`.

Design notes:

- **Determinism:** all randomness is a hash of `(seed, context)` — no mutable
  RNG state, so serialize/replay/rewind are exact by construction.
- **Bot scoring:** `S(p,t) = Σ w(t,c) · v(p,c) + ε` where `v` is the player's
  standardized category contribution and `ε` is small seeded noise.
  Personalities: value (uniform weights), needs (boosts weak categories,
  capped), punt (zeroes an assigned category). Visible as badges in the UI.
- **Player values:** z-scores per category; TO sign-flipped; FG%/FT% use
  volume-adjusted impact (`FGM − lg%·FGA`) so percentages carry attempt
  volume.
- **Roster profiles:** raw per-game totals (FG%/FT% = Σ makes ÷ Σ attempts)
  plus per-slot z for fair mid-draft comparison. Labeled equal-games
  projections, not weekly forecasts.
- **Rewind:** `rewind_to_pick` replays the pick log to any point; the
  abandoned branch is auto-saved to runs for comparison in the report.

## Milestone acceptance

- Full 12×13 draft: 156 unique picks, 13 per team — `tests/test_draft.py`
- Reproducibility / save-restore / snake order — `tests/test_draft.py`
- Punt weights change displayed rankings, not stats — `tests/test_analysis.py`
- Same seed + picks → same bot selections; strategy change → new picks —
  `tests/test_bots.py`
- Rewind/branch legality and divergence — `tests/test_bots.py`
