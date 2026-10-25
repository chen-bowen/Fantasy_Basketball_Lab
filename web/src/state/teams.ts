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
