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
    suggestions.py  first/second-pick build options: every player in range,
                    by simulating the rest of the draft (process pool, cached
                    per draft position)
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
| `GET /api/drafts/{id}/suggestions` | build options for the user's 1st/2nd pick: every player in range, simulated and tiered |
| `GET /api/league-preview?seed=&userSlot=` | bot personalities a new draft would get |

**Fit** (in every DraftView as `fit`, with the recommended players in
`candidates`) is a player's category z-scores weighted by what a z-unit in
each category can still do for the user's head-to-head record, with
punted categories zeroed. It starts from market value — the same
yardstick as the Value column — and moves only with the roster's shape.
Two rules keep it from wasting picks (`analysis/fit.py`):

- **Candidates belong at this pick.** Fit only recommends players whose
  market rank is within 1.5 rounds of the current pick (`fitWindow`; never
  fewer than the best 10 on the board). The room ranks those by Fit and
  lists everyone else underneath as "usually drafted later": a specialist
  who will still be there two rounds from now is not the pick now, however
  well he fits. Inside the window the order is Fit, not market — a player
  the room underprices but who does more for this roster comes first.
- **Weights follow leverage, not deficit.** A category's weight is the
  marginal win probability of a z-unit there: the normal density of the
  projected end-of-draft gap against each opponent, divided by the
  category's noise (the expected-wins model, tighter sigma), averaged
  over opponents. The 1/noise factor is the market weight, so with an
  empty roster Fit *is* market value; the density is a swing multiplier
  (normalized to mean 1, clamped to [0.5, 1.6]) that raises categories
  still up for grabs (`neededCategories`) and lowers ones the team has
  locked up or can't catch (`settledCategories`). A roster hopeless in
  steals is therefore not steered into steals specialists. The gap is
  projected by the share of the roster drafted, so after one or two
  picks nothing is settled and Fit is still essentially market value.

**Build suggestions** fix
the candidate pick(s), let every later user pick take the best Fit under
that punt, and average the *expected* head-to-head record over 8 drafts
(this seed plus 7 noise variants with the same bot personalities).
Expected, not projected: `standings.expected_wins` treats each category as
a probabilistic win (normal CDF of the per-slot z gap over the category's
noise, `NOISE[c]`), so comfortable leads count for more than narrow ones
and the estimate keeps resolving between good options — under the
deterministic record a Fit-drafted team already shows 10–11 wins whatever
its second pick is, and the ordering of options was noise.

Every player in range is tested — the same candidate window the draft
room uses — each with no punt and with the punts the roster-plus-him
would be genuinely weak in (`natural_punts` — a punt concedes a category
you can't win, never one you own). Two stages keep it fast: 2 drafts per
(player, punt) combination to screen, then the full 8 for every player's
best plan and for the best player under each plan (`SCREEN_SEEDS`,
`SIM_SEEDS`), so everything on screen has the full sample and its min–max.
Near-ties break toward the higher market value. The response is a
decision, not a leaderboard: one option per player, best first, grouped
into **tiers** at the simulations' resolution (`TIE_WINS`, 0.3 — options
within it are a toss-up, and the screen says so rather than ranking them);
the best player under each plan as the **build alternatives** (`builds`,
with what each gives up against the top option); the look-ahead's share
of runs in which each player is gone before the user's next turn
(`gone`); and the market's pick at this spot (`consensus`) as a
yardstick. Every option explains itself (`why`: categories he adds /
offsets / doubles up on / costs next to the roster, games played, market
rank), shows where the build finishes, and who is likely there next turn.

The success criterion is stated as a test: every player the draft expects
to go around this pick is on the screen with an evaluation, so "Browse all
players" is an escape hatch, never the path (`tests/test_suggestions.py`).

**Look-ahead** (in the DraftView on the user's turn as `gone` and
`nextUserPick`): a few quick runs to the user's next turn give, for every
available player, the share in which he is drafted before then. The draft
room lists candidates who can wait below the ones who can't, so Fit never
argues for a reach even inside the window. The simulations' user policy
(`suggestions.best_fit`) is the same window-and-Fit rule the room shows,
so build options and look-ahead describe the draft the room actually
advises.

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

## Market value and category noise

The league scores nine categories equally, but drafters don't pay for them
equally: real ADP rewards points and assists far above steals, FT% or
turnovers. A plain z-score sum therefore ranks low-turnover, high-FT%
3-and-D guards like first-rounders and drops stars with an ugly FT% or
turnover line out of the first round. `analysis/market.py` holds category
weights fitted to ADP (`scripts/fit_market_weights.py`, ridge regression
shrunk toward uniform; refit after `npm run data:fetch`), blended 75/25
with the uniform weights.

The market is mostly right about this, and for a reason the scoresheet
hides: a week of points is hundreds of events and a per-slot edge there
is a real favourite, while a week of steals, free throws or turnovers is a
handful and the same edge is close to a coin flip. (An independent
count-noise estimate from per-game rates ranks the categories the same
way, turnovers aside — drafters discount those mostly because they are
the classic punt.) A z-sum valuation is a rotisserie valuation; in
head-to-head the worth of a z-unit is what it does to the chance of
winning the category. So the engine uses one yardstick throughout:

| | used for |
| --- | --- |
| **Market weights** `w_c` | bot drafting (punt/needs/risk on top), the UI's Value stars and `#rank`, the candidate window, the base of the user's Fit |
| **Category noise** `NOISE[c] = 0.75 / w_c` | expected wins (standings, the build suggestions' objective), Fit's swing multipliers |
| **Uniform** | the deterministic league table only (`records`: who ranks higher in more categories) |

Bots draft like the room (rank correlation of their picks with ADP: 0.90,
up from 0.74); Fit starts from the same board and departs from it only
for what *this* roster still needs; and the simulations no longer reward
hoarding the noisy categories the room underpays for (under a single
uniform noise a team 1st in steals and 10th in points projected as a
winner — and Fit recommended the 3-and-D specialists that build it).
Market rank is also what the candidate window is measured in: it is
where the bots will take a player, so "usually drafted later" means later
in this league, not just in a consensus ADP list.
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
- Fit recommends only players expected to go around the current pick,
  orders them by Fit rather than market, and doesn't chase a category the
  team has locked up or can't catch — `tests/test_fit.py`
