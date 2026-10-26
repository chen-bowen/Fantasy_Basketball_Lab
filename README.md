# Fantasy Basektabll Lab

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
npm run setup:backend                      # backend deps via uv (backend/)

# run both servers (two terminals)
npm run dev:backend    # FastAPI on :8000
npm run dev            # Vite on :5173 (proxies /api → :8000; set API_URL to change)

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
- Current team and positions from ESPN's roster API (stats rows only know
  last season's team). Players on no current roster keep `lastTeam`, get
  `signed: false`, and stay draftable with a "Free agent" tag. Unmatched
  positions get a stats-based guess.
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
    analysis/     … fit.py (needs-aware Fit) · standings.py (head-to-head records)
    suggestions.py  first/second-pick build options, by simulating the rest
                    of the draft (process pool, cached per draft position)
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
| `PUT /api/drafts/{id}/punts` | `{punts, mode?}` — set punts by hand (manual), or `mode: "auto"` to let the roster decide → rescored view |
| `POST /api/drafts/{id}/preview` | before/after roster profile for a player |
| `POST /api/drafts/{id}/rewind` | rewind to pick n (saves abandoned branch) |
| `GET /api/drafts/{id}/suggestions` | build options for the user's 1st/2nd pick (simulated) |
| `GET /api/league-preview?seed=&userSlot=` | bot personalities a new draft would get |

**Fit** (in every DraftView as `fit`) is a player's category z-scores
(scoresheet weights, see below) weighted by the user's needs — categories the team trails the field in get
up to 2× weight — with punted categories zeroed. **Build suggestions** fix
the candidate pick(s), let every later user pick take the best Fit under
that punt, and average the *expected* head-to-head record over 6 drafts
(this seed plus 5 noise variants with the same bot personalities).
Expected, not projected: `standings.expected_wins` treats each category as
a probabilistic win (normal CDF of the per-slot z gap, `CATEGORY_NOISE`),
so comfortable leads count for more than narrow ones and the estimate
keeps resolving between good options — under the deterministic record a
Fit-drafted team already shows 10–11 wins whatever its second pick is, and
the ordering of options was noise.

Every plausible candidate is tested: the market's top of the board plus
the best Fits under no punt and under each punt (~20 players), each with
no punt and with the punts the roster-plus-him would be genuinely weak in
(`natural_punts` — a punt concedes a category you can't win, never one you
own). Two stages keep it fast: 2 drafts per combination to screen, 8 for
the leaders (`SCREEN_SEEDS`, `SIM_SEEDS`); the min–max is shown on screen.
Near-ties break toward the higher market value. Every option explains
itself (`why`: categories he adds / offsets / doubles up on / costs next to
the roster, games played, market rank), says whether he would still be
there at the next turn (`wait`), and the response carries the market's
pick at this spot (`consensus`) so the options can be read against it.

**Look-ahead** (in the DraftView on the user's turn as `gone` and
`nextUserPick`): a few quick runs to the user's next turn give, for every
available player, the share in which he is drafted before then. The draft
room lists players who can wait below the ones who can't, so Fit never
argues for a reach.

**Punt plan** (`analysis/punt_plan.py`, `puntMode` / `puntPlan` in the
view): in auto mode (the default) the user's punt follows the roster after
every pick — a puntable category the team sits in the bottom third of is
conceded, a punt is kept while the team is still weak there and replaced
only once it isn't. Setting punts by hand switches to manual; `PUT
/punts` with `mode: "auto"` hands the decision back.

## Availability and injury risk

Nobody plays 82 games, so values are built on what a player is *expected*
to produce, not his per-game line (`analysis/availability.py`,
`analysis/player_values.py`):

- **Availability** = durability × current status. Durability is his share
  of games over the last three seasons (newest weighted most, shrunk toward
  the pool average). A season he mostly missed counts in full while he is
  still hurt, but at a quarter weight once he is healthy again — one long
  absence he has come back from is a risk signal, not a forecast (the room
  drafts Haliburton and Tatum as near-full players); two mark him
  injury-prone. His ESPN status
  then costs him games: Day-To-Day a few; Out a share that shrinks the more
  of the current season he has already played (a late knock vs. a
  long-term injury). Unsigned players play nothing until signed.
- **Missed games are played by a replacement-level pickup**, not by nobody:
  expected line = `a × his line + (1 − a) × 0.85 × replacement line`, where
  the replacement line is the average of the best players who go undrafted
  in a 12×13 league and 0.85 is how much of it a streamed game really
  recovers. A missed star game therefore costs a lot, a missed 12th-man
  game little, and a player who never plays is worth less than a healthy
  13th man. Turnovers stay per-game (absence must never look like a TO
  edge).
- **Bots have a risk appetite** on top of their strategy (`BotSpec.risk`,
  seeded like everything else): a *bold* bot shrugs off half of a player's
  availability discount, a *cautious* one adds half again, *neutral* takes
  the model as is. That is what makes a hurt star fall to the one drafter
  who always gambles, rather than to everyone at the same pick.

The user's own values, Fit and suggestions are risk-neutral.

## Market value vs. the scoresheet

The league scores nine categories equally, but drafters don't pay for them
equally: real ADP rewards points and assists far above steals, FT% or
turnovers. A plain z-score sum therefore ranks low-turnover, high-FT%
3-and-D guards like first-rounders and drops stars with an ugly FT% or
turnover line out of the first round. `analysis/market.py` holds category
weights fitted to ADP (`scripts/fit_market_weights.py`, ridge regression
shrunk toward uniform; refit after `npm run data:fetch`), blended 75/25
with the uniform weights so a disciplined 9-cat drafter still meets
resistance (pure ADP bots lose 10 of 11 to one).

| | weights | used for |
| --- | --- | --- |
| **Market value** | fitted to ADP | bot drafting (punt/needs/risk on top), the UI's Value stars and `#rank`, suggestion candidates and tie-breaks |
| **Scoresheet** | uniform | standings / head-to-head records, the user's Fit, expected wins behind suggestions |

So bots draft like the room (rank correlation of their picks with ADP:
0.90, up from 0.74), while Fit and the simulations still tell you what
actually wins — including which players the market underrates for your
build.
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
  volume, capped at ±3 so one shooting line can't sink a player.
- **Availability** (`analysis/availability.py`): expected share of games from
  three seasons of games played (weights 3/2/1), pulled toward the pool
  average. A season missed entirely only counts while the player is still
  injured; unsigned players get 30%. Production is scaled by √availability
  (a replacement covers part of a missed game); turnovers aren't scaled.
  Current ESPN injury status is display-only.
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
