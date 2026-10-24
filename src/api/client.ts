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
  team: string;
  positions: string[];
  asOfSeason: string | null;
  gp: number;
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
  overall: number | null;
}

export interface BotSpecView {
  kind: "value" | "needs" | "punt";
  puntCategory: Category | null;
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
  profiles: ProfileView[];
  ranks: Record<Category, number[]>;
  userPunts: Category[];
}

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

export interface PreviewView {
  before: ProfileView;
  after: ProfileView;
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
  setPunts: (id: string, punts: Category[]) =>
    req<DraftView>(`/drafts/${id}/punts`, {
      method: "PUT",
      body: JSON.stringify({ punts }),
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
  listRuns: () => req<RunSummary[]>("/runs"),
  getRun: (id: string) => req<DraftView>(`/runs/${id}`),
};
