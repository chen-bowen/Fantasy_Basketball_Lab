/**
 * API client for the Python draft backend. The frontend is a thin client:
 * every mutation returns a full SessionView with derived analysis included.
 */

export type Category =
  | "PTS" | "REB" | "AST" | "STL" | "BLK" | "3PM" | "FG%" | "FT%" | "TO";

export const CATEGORIES: Category[] = [
  "PTS", "REB", "AST", "STL", "BLK", "3PM", "FG%", "FT%", "TO",
];

export const LOWER_IS_BETTER: ReadonlySet<Category> = new Set(["TO"]);

export interface ApiPlayer {
  id: string;
  refId: number | null;
  name: string;
  team: string; // current team; "" when unsigned
  signed: boolean; // false: on no league roster
  positions: string[];
  season: string | null; // season the line comes from
  gp: number;
  seasonGp: Record<string, number>; // season -> games played, newest first
  mpg: number;
  pts: number;
  reb: number;
  ast: number;
  stl: number;
  blk: number;
  threes: number;
  fgm: number;
  fga: number;
  ftm: number;
  fta: number;
  tov: number;
  adp: number | null; // consensus draft position on the league's board
  market: number | null; // market value: z's weighted the way drafts pay for categories
  marketRank: number | null; // 1 = highest market value in the pool — tracks ADP, not the scoresheet
  availability: number | null; // expected share of games, 0–1, from games-played history + status (scales value)
  status: string | null; // current status, e.g. "Out", "Day-To-Day"; lowers availability
  z: Record<Category, number> | null; // per-category z vs. the pool (TO flipped)
}

export type RivalLean = "cautious" | "neutral" | "bold";

export interface RivalView {
  style: "value" | "needs" | "concede";
  concede: Category | null;
  lean: RivalLean; // appetite for injury risk: bold rivals gamble on hurt stars, cautious ones steer clear
}

export interface ApiPick {
  at: number;
  round: number;
  squad: number;
  pid: string;
}

export interface ProfileView {
  size: number;
  totals: Record<string, number>;
  fgPct: number | null;
  ftPct: number | null;
  perSlotZ: Record<Category, number>;
}

export interface SessionView {
  id: string | null;
  phase: "in_progress" | "paused" | "complete";
  seed: string;
  teams: number;
  squadSize: number;
  seat: number;
  rivals: RivalView[];
  atPick: number;
  span: number;
  round: number;
  slot: number;
  onClock: number | null;
  yourPick: boolean;
  complete: boolean;
  selections: ApiPick[];
  squads: string[][];
  taken: string[];
  scores: Record<string, number>; // player id → score under user's concedes
  fit: Record<string, number>; // available player id → Fit for the user's team
  shape: Record<Category, number>;
  inPlay: Category[]; // categories Fit counts most: still up for grabs
  settled: { ahead: Category[]; behind: Category[] }; // counted least: locked up / out of reach
  // The players Fit recommends at this pick, best Fit first: the ones the draft
  // expects to go around here (market rank within the window). Others are browsable, not recommended.
  candidates: string[];
  window: { pick: number; maxRank: number; size: number };
  profiles: ProfileView[];
  ranks: Record<Category, number[]>;
  records: TeamRecord[]; // on paper: a team beats another by ranking higher in more categories
  weekPct: number[]; // week to week: share of duels each team wins in a typical equal-games week, 0–100
  board: DuelBoard | null; // the user's week against each team; null until squads are complete
  concedes: Category[];
  concedeMode: "auto" | "manual"; // auto: concedes follow the roster after every pick
  concedePlan: ConcedePlan;
  nextTurn: number | null; // overall pick number of the user's next turn (on the user's turn)
  gone: Record<string, number>; // player id → share of look-ahead runs in which he's drafted before then
}

export interface TeamRecord {
  wins: number;
  losses: number;
  ties: number;
}

export type Verdict = "win" | "tossup" | "loss"; // likely win / toss-up / likely loss (60% bands)
export type Bracket = "favored" | "tossup" | "underdog";

/** A player who decides a category: his per-game line (a rate plus attempts for FG%/FT%). */
export interface Decider {
  pid: string;
  side: "you" | "them";
  stat: number;
  att: number | null;
}

/** One category of one duel: two totals, a label, and who drives it. */
export interface DuelCategory {
  cat: Category;
  pct: number; // chance you win this category in a typical week, 0–100
  verdict: Verdict;
  you: number | null; // per-game roster total (a rate for FG%/FT%), availability-adjusted
  them: number | null;
  youAtt: number | null; // attempts per game behind a rate
  themAtt: number | null;
  paperLead: boolean; // you rank higher in it
  concededByYou: boolean;
  concededByThem: boolean;
  deciders: Decider[];
}

/** Your week against one team. */
export interface Duel {
  squad: number;
  winPct: number; // chance you win the week, 0–100
  bracket: Bracket;
  paper: { won: number; lost: number; tied: number; result: "win" | "loss" | "tie" }; // category count on paper
  need: number; // toss-ups you need if every likely win holds
  categories: DuelCategory[];
}

/** How a category goes for you across the league. */
export interface CategorySummary {
  win: number; // opponents it's a likely win against
  tossup: number;
  loss: number;
  you: number | null; // your per-game total (a rate for FG%/FT%)
  leagueMedian: number | null; // the median opponent's
  best: Decider | null; // your best player in it (for TO, your biggest turnover source)
  conceded: boolean;
}

export interface DuelBoard {
  squad: number;
  winPct: number; // your week-to-week win rate: the average of the 11 chances
  favored: number; // duels by bracket
  tossup: number;
  underdog: number;
  oneCategoryWins: number; // paper wins decided 5–4
  tossupLeads: Partial<Record<Category, number>>; // paper leads that are really toss-ups, by category
  categories: Record<Category, CategorySummary>;
  opponents: Duel[]; // best chance first
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
  pid: string;
  concede: Category | null; // null: no concede
  keepsConcede: boolean; // same plan as the current concede (always true for "no concede" with none set)
  wins: number; // expected duel wins of 11, averaged over runs
  runs: number;
  winsRange: [number, number] | null; // min/max over the runs
  tier: number; // 1 = within tieWins of the best option; the sims can't separate a tier
  gone: number | null; // share of look-ahead runs in which he's drafted before your next turn
  finishRanks: number[] | null; // the roster's final category ranks in the session's own seed
  nextOptions: string[]; // likely picks at your next turn if you take him
  why: PairingReason;
}

/** The best player under each plan — the builds you could choose instead. */
export interface BuildAlternative {
  concede: Category | null;
  pid: string;
  wins: number;
  runs: number;
  winsRange: [number, number] | null;
  behind: number; // wins given up against the best option overall
  keepsConcede: boolean;
}

/** The market's pick at this spot and what it would expect to win — a yardstick for the options. */
export interface ConsensusPick {
  pid: string;
  wins: number;
  concede: Category | null;
  runs: number;
}

export interface Advice {
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

/** What the roster says to concede right now, and why. */
export interface ConcedePlan {
  concedes: Category[];
  category: Category | null;
  rank: number | null;
  reason: string;
}

export type AdviceResult = Advice | { stage: null; options: [] };

export interface SessionSummary {
  id: string;
  seed: string;
  selections: number;
  status: string;
  updatedAt: number;
}

export interface ResultSummary {
  id: string;
  label: string;
  createdAt: number;
}

export interface CategoryRankMove {
  before: number;
  after: number;
}

export interface InspectView {
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
  players: () => req<{ players: ApiPlayer[]; count: number }>("/pool"),
  listSessions: () => req<SessionSummary[]>("/sessions"),
  createSession: (seed: string, seat: number) =>
    req<SessionView>("/sessions", {
      method: "POST",
      body: JSON.stringify({ seed, seat }),
    }),
  getSession: (id: string) => req<SessionView>(`/sessions/${id}`),
  pick: (id: string, pid: string) =>
    req<SessionView>(`/sessions/${id}/pick`, {
      method: "POST",
      body: JSON.stringify({ pid }),
    }),
  autopilot: (id: string) =>
    req<SessionView>(`/sessions/${id}/autopilot`, { method: "POST" }),
  pause: (id: string) =>
    req<SessionView>(`/sessions/${id}/pause`, { method: "POST" }),
  resume: (id: string) =>
    req<SessionView>(`/sessions/${id}/resume`, { method: "POST" }),
  /** Set concedes by hand (manual mode), or with mode "auto" hand the decision back to the roster. */
  setConcedes: (id: string, concedes: Category[], mode?: "auto") =>
    req<SessionView>(`/sessions/${id}/concedes`, {
      method: "PUT",
      body: JSON.stringify(mode ? { concedes, mode } : { concedes }),
    }),
  inspect: (id: string, pid: string) =>
    req<InspectView>(`/sessions/${id}/inspect`, {
      method: "POST",
      body: JSON.stringify({ pid }),
    }),
  rewind: (id: string, at: number) =>
    req<SessionView>(`/sessions/${id}/rewind`, {
      method: "POST",
      body: JSON.stringify({ at }),
    }),
  advise: (id: string) => req<AdviceResult>(`/sessions/${id}/advise`),
  league: (seed: string, seat: number) =>
    req<{ rivals: RivalView[] }>(
      `/league?seed=${encodeURIComponent(seed)}&seat=${seat}`,
    ),
  listResults: () => req<ResultSummary[]>("/results"),
  getResult: (id: string) => req<SessionView>(`/results/${id}`),
};
