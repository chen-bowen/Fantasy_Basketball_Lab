import type { Category, SessionView } from "../api/client";

const RIVAL_NAMES = [
  "Reapers", "Spiders", "Kings", "Aces", "Wolves", "Tigers",
  "Bears", "Hawks", "Sharks", "Titans", "Comets", "Foxes",
];

const STYLE_LABELS: Record<string, string> = {
  value: "Value",
  needs: "Needs",
  concede: "Concede",
};

const LEAN_LABELS: Record<string, string> = {
  cautious: "cautious",
  neutral: "",
  bold: "bold",
};

interface TeamLike {
  seat: number;
  rivals: SessionView["rivals"];
}

export function squadName(view: TeamLike, squad: number): string {
  return squad === view.seat ? "You" : RIVAL_NAMES[squad];
}

/** Strategy badge shown in the UI — rival personalities are visible. */
export function squadBadge(view: TeamLike, squad: number): string {
  if (squad === view.seat) return "You";
  const spec = view.rivals[squad];
  return spec.style === "concede"
    ? `${STYLE_LABELS.concede} ${spec.concede}`
    : STYLE_LABELS[spec.style];
}

/** "bold" / "cautious" for rivals with an appetite either way; "" for neutral. */
export function squadLean(view: TeamLike, squad: number): string {
  if (squad === view.seat) return "";
  return LEAN_LABELS[view.rivals[squad].lean ?? "neutral"] ?? "";
}

/** Badge plus risk appetite, for places that show one line per team. */
export function squadBadgeFull(view: TeamLike, squad: number): string {
  const lean = squadLean(view, squad);
  return lean ? `${squadBadge(view, squad)} · ${lean}` : squadBadge(view, squad);
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

/** Expected duel wins out of `games` as a win rate, 0–100 — the unit the report uses. */
export function winRate(wins: number, games: number): number {
  return Math.round((wins / games) * 100);
}

export function recordText(view: SessionView, squad: number): string {
  const r = view.records[squad];
  return `${r.wins}–${r.losses}${r.ties ? `–${r.ties}` : ""}`;
}

/** The team's build chip: the user's concedes, or the rival's strategy. */
export function buildChip(view: TeamLike & { concedes: Category[] }, squad: number): { label: string; tone: string } {
  if (squad === view.seat) {
    return {
      label: view.concedes.length ? `Concede ${view.concedes.join(", ")}` : "No concede yet",
      tone: "yours",
    };
  }
  return { label: squadBadge(view, squad), tone: view.rivals[squad].style };
}

/** Categories a team has conceded — the user's chosen concedes, or a concede rival's category. */
export function squadConcedes(view: TeamLike & { concedes: Category[] }, squad: number): Set<Category> {
  if (squad === view.seat) return new Set(view.concedes);
  const s = view.rivals[squad];
  return new Set(s.style === "concede" && s.concede ? [s.concede] : []);
}

/** Team on the clock at overall pick index `i` (0-based) in a snake draft. */
export function snakeSquad(i: number, teams: number): number {
  const round = Math.floor(i / teams);
  const pos = i % teams;
  return round % 2 === 0 ? pos : teams - 1 - pos;
}

/** Overall pick numbers (1-based) a seat gets in its first `rounds` rounds. */
export function seatPicks(seat: number, teams: number, rounds: number): number[] {
  return Array.from({ length: rounds }, (_, r) =>
    r * teams + (r % 2 === 0 ? seat : teams - 1 - seat) + 1,
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
export function nextTurnAt(view: { seat: number; teams: number; span: number }, from: number): number | null {
  for (let i = from; i < view.span; i++) {
    if (snakeSquad(i, view.teams) === view.seat) return i;
  }
  return null;
}

/** The user's last pick so far, if any. */
export function lastPick(view: { selections: { squad: number; at: number }[]; seat: number }) {
  for (let i = view.selections.length - 1; i >= 0; i--) {
    if (view.selections[i].squad === view.seat) return view.selections[i];
  }
  return null;
}
