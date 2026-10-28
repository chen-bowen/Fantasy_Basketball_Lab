# Fantasy Basketball Lab

Single-player, category-league fantasy basketball mock draft. You pick against
11 rule-based rivals, watch your team's category identity develop, and review
the result.

**League format:** head-to-head categories · 12 teams · snake draft · 13-round
rosters · one human slot. Categories: PTS, REB, AST, STL, BLK, 3PM, FG%, FT%,
TO. No positional requirements (deliberate V1 simplification).

**Architecture:** Python/FastAPI backend owns the draft session, rival logic,
category metrics, player data pipeline, and JSON persistence. The React
frontend is a thin presentation client over `http://localhost:8017/api`.

## Commands

```bash
# one-time setup (from repo root)
npm run setup:web                          # frontend deps (web/)
npm run setup:backend                      # backend deps via uv (backend/)

# run both servers (two terminals)
npm run dev:backend    # FastAPI on :8017
npm run dev            # Vite on :5173 (proxies /api → :8017; set API_URL to change)

# tests & checks
npm test               # pytest: domain/metrics/rival/persistence suite
npm run build          # typecheck + production build
npm run smoke          # headless end-to-end UI test (needs both servers)
npm run data:fetch     # regenerate backend/lab/pool/players.json from live stats
```

Root `package.json` delegates everything; `web/package.json` holds the
real frontend deps/scripts if you prefer to work inside `web/` directly.

## Player data

The engine consumes one **frozen dataset**: `backend/lab/pool/players.json`
(280 players). `npm run data:fetch` regenerates it:

- Per-game stats from `stats.nba.com` (`leaguedashplayerstats`), current
  season.
- Players who missed most of the season fall back to the prior season's
  stats ("last available season" rule) — tagged via `season`.
- Current team and positions from ESPN's roster API (stats rows only know
  last season's team). Players on no current roster keep `lastTeam`, get
  `signed: false`, and stay draftable with a "Free agent" tag. Unmatched
  positions get a stats-based guess.
- Raw responses cache in `.cache/` for 12h (`--no-cache` to bypass).

## Backend layout

```
backend/
  lab/
    domain/       model.py (Session/Selection/DraftSettings/RivalSpec/Player)
                  · session.py (pure, JSON-serializable draft state)
                  · snake.py (pick order) · autopilot.py (rival scoring)
    metrics/      profile.py · ratings.py · weighting.py · shape.py
                  · weekly.py · table.py · concede.py · board.py
                  (roster profiles, player values, Fit, standings, matchups,
                   concede plans)
    advisor.py    first/second-pick build options: every player in range,
                  by simulating the rest of the draft (process pool, cached
                  per draft position)
    render.py     view serializer (state + derived metrics per response)
    server.py     FastAPI routes
    archive.py    JSON-file persistence (sessions + saved runs)
    pool/         loader.py (frozen pool) + players.json
  scripts/fetch_players.py    data pipeline
  scripts/fit_market_weights.py · fit_category_noise.py   calibrations
  tests/          pytest suite
```

The frontend (`web/`) keeps only UI state: `src/api/client.ts` is a typed
HTTP client, `src/state/useSession.ts` drives mutations, spaces out rival
turns and holds the board's controls across picks, and `src/components/`
render the view the API returns (`Lobby`/`TopBar`/`Room`/`League`/`Report`/
`Builds`/`Duels`/`ui`).

The draft room holds still while the rivals pick: `Room` settles the
board (order and Fit) on your turn and only marks players as they go —
taken rows leave at a quiet moment, never under the pointer — and the
player panel keeps its subject until you change it. The pick feed
(`TopBar.tsx`) is shared by the build screens and the room and
carries the room's state: watching, paused, or you're up. All motion is
opt-in under `prefers-reduced-motion: no-preference`.

## API

| Endpoint | Purpose |
| --- | --- |
| `GET /api/health` | liveness |
| `GET /api/pool` | frozen pool with market scores |
| `POST /api/sessions` | create session `{seed, seat}` → view |
| `GET /api/sessions` / `GET /api/sessions/{id}` | list / resume |
| `POST /api/sessions/{id}/pick` | apply a selection (validated, snake order) |
| `POST /api/sessions/{id}/autopilot` | advance one rival pick |
| `POST .../pause` `.../resume` | phase control |
| `PUT /api/sessions/{id}/concedes` | `{concedes, mode?}` — set conceded categories by hand (manual), or `mode: "auto"` to let the roster decide → rescored view |
| `POST /api/sessions/{id}/inspect` | before/after roster profile for a player |
| `POST /api/sessions/{id}/rewind` | rewind to pick n (saves abandoned branch) |
| `GET /api/sessions/{id}/advise` | build options for the user's 1st/2nd pick: every player in range, simulated and tiered |
| `GET /api/league?seed=&seat=` | rival personalities a new session would get |
| `GET /api/results` / `GET /api/results/{id}` | saved runs for comparison |

Every mutation returns a full view — session state plus derived metrics
(team profiles, per-category ranks, player values under concede settings).
Persistence is JSON files under `backend/lab/store/`.

**Fit** (in every view as `fit`, with the recommended players in
`candidates`) is a player's category z-scores weighted by what a z-unit in
each category can still do for the user's head-to-head record, with
conceded categories zeroed. It starts from what a z-unit is worth toward
winning a week (`table.H2H_WEIGHTS`, 1 / category noise) and moves
only with the roster's shape. Two rules keep it from wasting picks
(`metrics/shape.py` + `metrics/weighting.py`):

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
  category's noise (the expected-wins model, wider sigma), averaged
  over opponents. The 1/noise factor is the head-to-head worth, so with
  an empty roster Fit *is* that worth — on the market's scale (weights
  average 1) but not its price list: a turnover lead is about as safe
  as a rebounding lead, whatever the draft table pays for it. The
  density is a swing multiplier (normalized to mean 1, clamped to
  [0.5, 1.6]) that raises categories still up for grabs
  (`neededCats`) and lowers ones the team has locked up or can't
  catch (`settledCats`). A roster hopeless in steals is therefore
  not steered into steals specialists. The gap is projected by the share
  of the roster drafted, so after one or two picks nothing is settled.

**Build suggestions** fix
the candidate pick(s), let every later user pick take the best Fit under
that concede plan, and average the *expected* head-to-head record over 8 drafts
(this seed plus 7 noise variants with the same rival personalities).
Expected, not projected: `table.expected_wins` treats each category as
a probabilistic win (normal CDF of the per-slot z gap over the category's
noise, `NOISE[c]`), so comfortable leads count for more than narrow ones
and the estimate keeps resolving between good options — under the
deterministic record a Fit-drafted team already shows 10–11 wins whatever
its second pick is, and the ordering of options was noise. The screens
show it as a **win rate** — "wins 57% of weekly matchups, about 6–5 in a
round against the league" — never as "6.3 wins": the same unit as the
report's week-to-week view below.

Every player in range is tested — the same candidate window the draft
room uses — each with no concede and with the concedes the roster-plus-him
would be genuinely weak in (`natural_concedes` — a concede gives up a category
you can't win, never one you own). Two stages keep it fast: 2 drafts per
(player, concede) combination to screen, then the full 8 for every player's
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
players" is an escape hatch, never the path (`tests/test_advisor.py`).

**Look-ahead** (in the view on the user's turn as `gone` and
`nextUserPick`): a few quick runs to the user's next turn give, for every
available player, the share in which he is drafted before then. The draft
room lists candidates who can wait below the ones who can't, so Fit never
argues for a reach even inside the window. The simulations' user policy
(`advisor.fit_select`) is the same window-and-Fit rule the room shows,
so build options and look-ahead describe the draft the room actually
advises.

**Concede plan** (`metrics/concede.py`, `concedeMode` / `concedes` in the
view): in auto mode (the default) the user's concede follows the roster after
every pick — a concedable category the team sits in the bottom third of is
conceded, a concede is kept while the team is still weak there and replaced
only once it isn't. Setting concedes by hand switches to manual; `PUT
/concedes` with `mode: "auto"` hands the decision back.

## The report: on paper vs. week to week

The draft report (and any saved run opened from it) puts two records side
by side, in the same unit, and explains the gap with players rather than
probabilities (`metrics/weekly.py`, `duels` + `weekPct` in the view):

- **On paper** — `records`: you beat a team if you rank higher in more of
  the 9 categories. Every lead counts the same, however small. 10–1.
- **Week to week** — the chance of actually winning each matchup in a
  typical week (`matchup_win_prob`, the model the build screens score
  with), averaged over the 11 opponents: *wins 50% of matchups, about
  6–5*. Both views get a league place, and the standings table carries
  both columns, so a 50% that is 7th of 12 reads differently from one
  that is 2nd.

A short story under the numbers says why they differ — *9 of your 10
paper wins are 5–4, and the leads that carry them are often toss-ups
(FT%, AST, STL)* — and what a concede costs: *with FG% conceded and REB and BLK
against you most weeks, you need 5 of the other 6 every week.*

**Your week against each team** lists the 11 opponents with their chance
and, for the selected one, a tale of the tape: per-game roster totals for
both teams (availability-adjusted the way the model is, so the numbers
never contradict the labels), a label per category — **likely win /
toss-up / likely loss**, at 60% bands on the rounded percent — and the
players who decide it: the two best on the favoured side, one per side
for a toss-up, the biggest turnover sources for TO. The verdict is one
line in category names (*Edge: 3PM, AST, PTS, FT%, STL. Enough only if
all 5 hold — STL is the thinnest*), and the chance of the week is always
the verdict: five likely wins at 60–70% each are still a coin flip, so
the text never promises more than the number. The category noise is
untouched — a 217–213 lead in PTS is a toss-up while 28.8–14.3 in 3PM is
a lock — and one fixed line says why steals, free throws and turnovers
flip more often than points. A conceded category keeps its rank everywhere
(dashed mark), because you still finish somewhere in it.

The category noise is fitted, not guessed
(`scripts/fit_category_noise.py`): a week of each counting stat is a sum
of per-game lines with minute variance and game-count variance, so the
weekly sigma is the per-game std times a modelled spread in games — tighter for
steals, blocks, threes and turnovers and wider for points, rebounds and
assists, and the percentages are binomial in the makes plus the swing in
attempts. Points come out at 0.29, rebounds and assists about 0.3,
turnovers 0.40, threes 0.43, blocks 0.53, steals and the percentages
0.85–0.91. An earlier version took the noise from the market weights
instead (`0.75 / w_c`), which overstated the swing in rebounds, threes,
FT% and especially turnovers — the market discounts those for being
conceded, not for being random — and squeezed every matchup toward 50%:
the league's weekly win rates ran 41–58% and first-round options sat
within 5 points of each other. Fitted, the league runs about 30–68% and
the options 14 points apart, and a concede costs what it costs.

Rivals draft like the room (rank correlation of their picks with ADP:
0.90); Fit chooses among the same players (the window is measured in
market rank — where the rivals will take a player — so "usually drafted
later" means later in this league) but prefers, inside it, what wins
weeks: a Fit-drafted roster projects about 65% of weekly matchups
against these rivals, ahead of a plain scoresheet sum in the same window
(`tests/test_fit.py`). Refit both calibrations after
`npm run data:fetch`.

## Design notes

- **Determinism:** all randomness is a hash of `(seed, context)` — no mutable
  RNG state, so serialize/replay/rewind are exact by construction.
- **Rival scoring:** `S(p,t) = Σ w(t,c) · v(p,c) + ε` where `v` is the player's
  standardized category contribution and `ε` is small seeded noise.
  Personalities: value (uniform weights), needs (boosts weak categories,
  capped), concede (zeroes an assigned category). Visible as badges in the UI.
- **Player values:** z-scores per category; TO sign-flipped; FG%/FT% use
  volume-adjusted impact (`FGM − lg%·FGA`) so percentages carry attempt
  volume, capped at ±3 so one shooting line can't sink a player.
- **Availability** (`metrics/ratings.py`): expected share of games from
  three seasons of games played (weights 3/2/1), pulled toward the pool
  average. A season missed entirely only counts while the player is still
  injured; unsigned players get 30%. Production is scaled by √availability
  (a replacement covers part of a missed game); turnovers aren't scaled.
  Current injury status is display-only.
- **Roster profiles:** raw per-game totals (FG%/FT% = Σ makes ÷ Σ attempts)
  plus per-slot z for fair mid-draft comparison. Labeled equal-games
  projections, not weekly forecasts.
- **Rewind:** `rewind` replays the pick log to any point; the
  abandoned branch is auto-saved to runs for comparison in the report.

## Milestone acceptance

- Full 12×13 draft: 156 unique picks, 13 per team — `tests/test_session.py`
- Reproducibility / save-restore / snake order — `tests/test_session.py`
- Concede weights change displayed rankings, not stats — `tests/test_metrics.py`
- Same seed + picks → same rival selections; style change → new picks —
  `tests/test_autopilot.py`
- Rewind/branch legality and divergence — `tests/test_autopilot.py`
- Fit recommends only players expected to go around the current pick,
  orders them by Fit rather than market, and doesn't chase a category the
  team has locked up or can't catch — `tests/test_fit.py`
