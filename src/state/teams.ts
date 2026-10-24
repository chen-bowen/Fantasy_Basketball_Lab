import type { DraftView } from "../api/client";

const BOT_NAMES = [
  "Reapers", "Spiders", "Kings", "Aces", "Wolves", "Tigers",
  "Bears", "Hawks", "Sharks", "Titans", "Comets", "Foxes",
];

const KIND_LABELS: Record<string, string> = {
  value: "Value",
  needs: "Needs",
  punt: "Punt",
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
