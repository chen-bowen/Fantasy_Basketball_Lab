/**
 * API client for the Python draft backend. The frontend is a thin client:
 * every mutation returns a full DraftView with derived analysis included.
 */

export type Category =
  | "PTS" | "REB" | "AST" | "STL" | "BLK" | "3PM" | "FG%" | "FT%" | "TO";

export const CATEGORIES: Category[] = [
  "PTS", "REB", "AST", "STL", "BLK", "3PM", "FG%", "FT%", "TO",
];

export const LOWER_IS_BETTER: ReadonlySet<Category> = new Set(["TO"]);

export interface ApiPlayer {
  id: string;
  nbaId: number | null;
  name: string;
  team: string; // current team; "" when unsigned
  signed: boolean; // false: on no current NBA roster
  positions: string[];
  asOfSeason: string | null;
  gp: number;
  gpBySeason: Record<string, number>; // season -> games played, newest first
  min: number;
  pts: number;
  reb: number;
  ast: number;
  stl: number;
  blk: number;
  tpm: number;
  fgm: number;
  fga: number;
  ftm: number;
  fta: number;
  tov: number;
  adp: number | null; // aggregated draft position (Yahoo/ESPN avg via FantasyPros)
  overall: number | null; // market value: z's weighted the way real drafts pay for categories (see backend market.py)
  overallRank: number | null; // 1 = highest market value in the pool — tracks ADP, not the scoresheet
  availability: number | null; // expected share of games, 0–1, from games-played history + injury status (scales value)
  injury: string | null; // current ESPN status, e.g. "Out", "Day-To-Day"; lowers availability
  z: Record<Category, number> | null; // per-category z vs. the pool (TO flipped)
}

export type BotRisk = "cautious" | "neutral" | "bold";

export interface BotSpecView {
  kind: "value" | "needs" | "punt";
  puntCategory: Category | null;
  risk: BotRisk; // appetite for injury risk: bold bots gamble on hurt stars, cautious ones steer clear
}

export interface ApiPick {
  index: number;
  round: number;
  teamId: number;
  playerId: string;
}

export interface ProfileView {
  size: number;
  totals: Record<string, number>;
  fgPct: number | null;
  ftPct: number | null;
  perSlotZ: Record<Category, number>;
}

export interface DraftView {
  id: string | null;
  status: "in_progress" | "paused" | "complete";
  seed: string;
  numTeams: number;
  rosterSize: number;
  userSlot: number;
  botSpecs: BotSpecView[];
  pickIndex: number;
  totalPicks: number;
  round: number;
  pickInRound: number;
  onClock: number | null;
  isUserTurn: boolean;
  complete: boolean;
  picks: ApiPick[];
  rosters: string[][];
  draftedIds: string[];
  scores: Record<string, number>; // player id → score under user's punts
  fit: Record<string, number>; // available player id → Fit for the user's team
  fitWeights: Record<Category, number>;
  neededCategories: Category[]; // categories Fit counts most: still up for grabs
  settledCategories: { ahead: Category[]; behind: Category[] }; // counted least: locked up / out of reach
  // The players Fit recommends at this pick, best Fit first: the ones the draft
  // expects to go around here (market rank within the window). Others are browsable, not recommended.
  candidates: string[];
  fitWindow: { pick: number; maxRank: number; size: number };
  profiles: ProfileView[];
  ranks: Record<Category, number[]>;
  records: TeamRecord[];
  userPunts: Category[];
  puntMode: "auto" | "manual"; // auto: punts follow the roster after every pick
  puntPlan: PuntPlan;
  nextUserPick: number | null; // overall pick number of the user's next turn (on the user's turn)
  gone: Record<string, number>; // player id → share of look-ahead runs in which he's drafted before then
}

export interface TeamRecord {
  wins: number;
  losses: number;
  ties: number;
}

/** Why a player, next to what you already have — plain roster arithmetic, no simulation. */
export interface PairingReason {
  adds: Category[]; // categories he is strong in that the roster isn't yet
  patches: Category[]; // roster weaknesses he actively offsets
  spares: Category[]; // roster weaknesses he at least doesn't deepen
  overlaps: Category[]; // strengths the roster already has
  costs: Category[]; // categories he clearly hurts
  availability: number; // expected share of games, 0–1
  marketRank: number | null; // his rank among available players by market value
}

/** One candidate at this pick, evaluated by simulation under his best plan. */
export interface BuildOption {
  playerId: string;
  punt: Category | null; // null: no punt
  keepsPunt: boolean; // same plan as the current punt (always true for "no punt" with no punt set)
  wins: number; // expected matchup wins of 11, averaged over runs
  runs: number;
  winsRange: [number, number] | null; // min/max over the runs
  tier: number; // 1 = within tieWins of the best option; the sims can't separate a tier
  gone: number | null; // share of look-ahead runs in which he's drafted before your next turn
  finishRanks: number[] | null; // the roster's final category ranks in the draft's own seed
  nextOptions: string[]; // likely picks at your next turn if you take him
  why: PairingReason;
}

/** The best player under each plan — the builds you could choose instead. */
export interface BuildAlternative {
  punt: Category | null;
  playerId: string;
  wins: number;
  runs: number;
  winsRange: [number, number] | null;
  behind: number; // wins given up against the best option overall
  keepsPunt: boolean;
}

/** The market's pick at this spot and what it would expect to win — a yardstick for the options. */
export interface ConsensusPick {
  playerId: string;
  wins: number;
  punt: Category | null;
  runs: number;
}

export interface BuildOptions {
  stage: "first" | "second";
  pick: number; // the current pick number
  nextPick: number | null; // your next turn
  tieWins: number; // options within this many wins are a toss-up
  tested: number; // players evaluated (everyone in range at this pick)
  window: number;
  consensus: ConsensusPick | null;
  options: BuildOption[]; // one per player, best first
  builds: BuildAlternative[];
}

/** What the roster says to punt right now, and why. */
export interface PuntPlan {
  punts: Category[];
  category: Category | null;
  rank: number | null;
  reason: string;
}

export type Suggestions = BuildOptions | { stage: null; options: [] };

export interface DraftSummary {
  id: string;
  seed: string;
  picks: number;
  status: string;
  updatedAt: number;
}

export interface RunSummary {
  id: string;
  label: string;
  createdAt: number;
}

export interface CategoryRankMove {
  before: number;
  after: number;
}

export interface PreviewView {
  before: ProfileView;
  after: ProfileView;
  ranks: Record<Category, CategoryRankMove>; // user's category ranks if drafted
}

const BASE = "/api";

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(BASE + path, {
    headers: { "Content-Type": "application/json" },
    ...init,
  });
  if (!res.ok) {
    const detail = await res.json().catch(() => ({}));
    throw new Error(detail?.detail ?? `HTTP ${res.status}`);
  }
  return res.json();
}

export const api = {
  players: () => req<{ players: ApiPlayer[]; count: number }>("/players"),
  listDrafts: () => req<DraftSummary[]>("/drafts"),
  createDraft: (seed: string, userSlot: number) =>
    req<DraftView>("/drafts", {
      method: "POST",
      body: JSON.stringify({ seed, userSlot }),
    }),
  getDraft: (id: string) => req<DraftView>(`/drafts/${id}`),
  pick: (id: string, playerId: string) =>
    req<DraftView>(`/drafts/${id}/picks`, {
      method: "POST",
      body: JSON.stringify({ playerId }),
    }),
  botPick: (id: string) =>
    req<DraftView>(`/drafts/${id}/bot-pick`, { method: "POST" }),
  pause: (id: string) =>
    req<DraftView>(`/drafts/${id}/pause`, { method: "POST" }),
  resume: (id: string) =>
    req<DraftView>(`/drafts/${id}/resume`, { method: "POST" }),
  /** Set punts by hand (manual mode), or with mode "auto" hand the decision back to the roster. */
  setPunts: (id: string, punts: Category[], mode?: "auto") =>
    req<DraftView>(`/drafts/${id}/punts`, {
      method: "PUT",
      body: JSON.stringify(mode ? { punts, mode } : { punts }),
    }),
  preview: (id: string, playerId: string) =>
    req<PreviewView>(`/drafts/${id}/preview`, {
      method: "POST",
      body: JSON.stringify({ playerId }),
    }),
  rewind: (id: string, pickIndex: number) =>
    req<DraftView>(`/drafts/${id}/rewind`, {
      method: "POST",
      body: JSON.stringify({ pickIndex }),
    }),
  suggestions: (id: string) => req<Suggestions>(`/drafts/${id}/suggestions`),
  leaguePreview: (seed: string, userSlot: number) =>
    req<{ botSpecs: BotSpecView[] }>(
      `/league-preview?seed=${encodeURIComponent(seed)}&userSlot=${userSlot}`,
    ),
  listRuns: () => req<RunSummary[]>("/runs"),
  getRun: (id: string) => req<DraftView>(`/runs/${id}`),
};
