import type { Category, DraftView } from "../api/client";

const BOT_NAMES = [
  "Reapers", "Spiders", "Kings", "Aces", "Wolves", "Tigers",
  "Bears", "Hawks", "Sharks", "Titans", "Comets", "Foxes",
];

const KIND_LABELS: Record<string, string> = {
  value: "Value",
  needs: "Needs",
  punt: "Punt",
};

const RISK_LABELS: Record<string, string> = {
  cautious: "cautious",
  neutral: "",
  bold: "bold",
};

interface TeamLike {
  userSlot: number;
  botSpecs: DraftView["botSpecs"];
}

export function teamName(view: TeamLike, teamId: number): string {
  return teamId === view.userSlot ? "You" : BOT_NAMES[teamId];
}

/** Strategy badge shown in the UI — bot personalities are visible. */
export function teamBadge(view: TeamLike, teamId: number): string {
  if (teamId === view.userSlot) return "You";
  const spec = view.botSpecs[teamId];
  return spec.kind === "punt"
    ? `${KIND_LABELS.punt} ${spec.puntCategory}`
    : KIND_LABELS[spec.kind];
}

/** "bold" / "cautious" for bots with an appetite either way; "" for neutral. */
export function teamRisk(view: TeamLike, teamId: number): string {
  if (teamId === view.userSlot) return "";
  return RISK_LABELS[view.botSpecs[teamId].risk ?? "neutral"] ?? "";
}

/** Badge plus risk appetite, for places that show one line per team. */
export function teamBadgeWithRisk(view: TeamLike, teamId: number): string {
  const risk = teamRisk(view, teamId);
  return risk ? `${teamBadge(view, teamId)} · ${risk}` : teamBadge(view, teamId);
}

/** "1", "T2"… by wins, ties sharing a place. */
export function places(wins: number[]): string[] {
  return wins.map((w) => {
    const place = wins.filter((x) => x > w).length + 1;
    const tied = wins.filter((x) => x === w).length > 1;
    return `${tied ? "T" : ""}${place}`;
  });
}

/** "about 6–5": a week-to-week win rate as a record over `games` matchups. */
export function weekRecord(pct: number, games: number): string {
  const w = Math.round((pct / 100) * games);
  return `${w}–${games - w}`;
}

/** Expected matchup wins out of `games` as a win rate, 0–100 — the unit the report uses. */
export function winRate(wins: number, games: number): number {
  return Math.round((wins / games) * 100);
}

export function recordText(view: DraftView, teamId: number): string {
  const r = view.records[teamId];
  return `${r.wins}–${r.losses}${r.ties ? `–${r.ties}` : ""}`;
}

/** The team's build chip: the user's punts, or the bot's strategy. */
export function buildBadge(view: TeamLike & { userPunts: Category[] }, teamId: number): { label: string; tone: string } {
  if (teamId === view.userSlot) {
    return {
      label: view.userPunts.length ? `Punt ${view.userPunts.join(", ")}` : "No punt yet",
      tone: "yours",
    };
  }
  return { label: teamBadge(view, teamId), tone: view.botSpecs[teamId].kind };
}

/** Categories a team has punted — the user's chosen punts, or a punt bot's category. */
export function teamPunts(view: TeamLike & { userPunts: Category[] }, teamId: number): Set<Category> {
  if (teamId === view.userSlot) return new Set(view.userPunts);
  const s = view.botSpecs[teamId];
  return new Set(s.kind === "punt" && s.puntCategory ? [s.puntCategory] : []);
}

/** Team on the clock at overall pick index `i` (0-based) in a snake draft. */
export function snakeTeam(i: number, numTeams: number): number {
  const round = Math.floor(i / numTeams);
  const pos = i % numTeams;
  return round % 2 === 0 ? pos : numTeams - 1 - pos;
}

/** Overall pick numbers (1-based) a slot gets in its first `rounds` rounds. */
export function slotPicks(slot: number, numTeams: number, rounds: number): number[] {
  return Array.from({ length: rounds }, (_, r) =>
    r * numTeams + (r % 2 === 0 ? slot : numTeams - 1 - slot) + 1,
  );
}

export function ordinal(n: number): string {
  const t = n % 100;
  if (t >= 11 && t <= 13) return `${n}th`;
  return n + (["th", "st", "nd", "rd"][n % 10] ?? "th");
}

export function andList(xs: string[]): string {
  return xs.length > 1 ? `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}` : xs.join("");
}

/** 0-based index of the user's next pick at or after `from` (null once they're all made). */
export function nextUserPickIndex(view: { userSlot: number; numTeams: number; totalPicks: number }, from: number): number | null {
  for (let i = from; i < view.totalPicks; i++) {
    if (snakeTeam(i, view.numTeams) === view.userSlot) return i;
  }
  return null;
}

/** The user's last pick so far, if any. */
export function lastUserPick(view: { picks: { teamId: number; index: number }[]; userSlot: number }) {
  for (let i = view.picks.length - 1; i >= 0; i--) {
    if (view.picks[i].teamId === view.userSlot) return view.picks[i];
  }
  return null;
}
