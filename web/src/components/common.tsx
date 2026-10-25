import { useState } from "react";
import { CATEGORIES, type ApiPlayer, type Category } from "../api/client";
import { ordinal } from "../state/teams";

/** NBA CDN headshot (by nbaId) with an initials fallback. */
export function headshotUrl(nbaId: number | null): string | null {
  return nbaId
    ? `https://cdn.nba.com/headshots/nba/latest/260x190/${nbaId}.png`
    : null;
}

export function initials(name: string): string {
  return name
    .split(" ")
    .filter((w) => /^[A-Z]/.test(w))
    .slice(0, 2)
    .map((w) => w[0])
    .join("");
}

export function Headshot({
  player,
  variant,
}: {
  player: Pick<ApiPlayer, "name" | "nbaId">;
  variant: "card" | "tile" | "avatar" | "mini";
}) {
  const [failed, setFailed] = useState(false);
  const url = headshotUrl(player.nbaId);
  if (!url || failed) {
    return (
      <span className={`headshot ${variant} fallback`} aria-hidden="true">
        {initials(player.name)}
      </span>
    );
  }
  return (
    <img
      className={`headshot ${variant}`}
      src={url}
      alt={variant === "avatar" || variant === "mini" ? "" : player.name}
      loading="lazy"
      onError={() => setFailed(true)}
    />
  );
}

/** "C · NYK", or a free-agent tag when the player is on no current roster. */
export function PlayerMeta({ player }: { player: ApiPlayer }) {
  return (
    <span className="player-meta">
      {player.positions.join("/")}
      {" · "}
      {player.signed ? (
        player.team
      ) : (
        <span className="fa-tag" title="On no current NBA roster">
          Free agent
        </span>
      )}
      {player.injury && (
        <>
          {" "}
          <span
            className={player.injury === "Out" ? "injury-tag out" : "injury-tag"}
            title="Current injury status from ESPN; lowers the share of games he's expected to play, and with it his value"
          >
            {player.injury}
          </span>
        </>
      )}
    </span>
  );
}

/** How deep into the available list the 0 end of the Fit scale sits. */
const FIT_FLOOR_DEPTH = 30;
/** Minimum raw-Fit width of the scale, so near-equal players stay near-equal late in a draft. */
const FIT_MIN_SPREAD = 1.5;

export interface FitScale {
  best: number;
  floor: number;
}

/** Scale for this pick from available Fits sorted best first. */
export function fitScale(sortedFits: number[]): FitScale {
  const best = sortedFits[0] ?? 0;
  const floor = sortedFits[Math.min(FIT_FLOOR_DEPTH, sortedFits.length) - 1] ?? best;
  return { best, floor: Math.min(floor, best - FIT_MIN_SPREAD) };
}

/** Fit on a 0–10 scale for this pick: the best option available scores 10.0. */
export function fitScore(fit: number, scale: FitScale): number {
  return Math.max(0, Math.min(10, ((fit - scale.floor) / (scale.best - scale.floor)) * 10));
}

/** Value tiers by overall rank: roughly the first round, rounds 2–3, 4–6, 7–13, undrafted. */
const VALUE_TIERS: { maxRank: number; stars: number; label: string }[] = [
  { maxRank: 12, stars: 5, label: "Elite" },
  { maxRank: 36, stars: 4, label: "Star" },
  { maxRank: 72, stars: 3, label: "Starter" },
  { maxRank: 156, stars: 2, label: "Rotation" },
  { maxRank: Infinity, stars: 1, label: "Bench" },
];

export function valueTier(rank: number | null) {
  return VALUE_TIERS.find((t) => (rank ?? Infinity) <= t.maxRank)!;
}

export function Stars({ count, max = 5 }: { count: number; max?: number }) {
  return (
    <span className="stars" role="img" aria-label={`${count} of ${max} stars`}>
      {Array.from({ length: max }, (_, i) => (
        <svg key={i} width="12" height="12" viewBox="0 0 12 12" aria-hidden="true" className={i < count ? "on" : ""}>
          <path d="M6 .8l1.6 3.3 3.6.5-2.6 2.5.6 3.6L6 9l-3.2 1.7.6-3.6L.8 4.6l3.6-.5z" />
        </svg>
      ))}
    </span>
  );
}

export function rankTone(rank: number): string {
  if (rank <= 3) return "top";
  if (rank <= 6) return "good";
  if (rank <= 9) return "low";
  return "bottom";
}

export function zTone(z: number): string {
  if (z >= 1.5) return "top";
  if (z >= 0.5) return "good";
  if (z > -0.5) return "avg";
  if (z > -1.5) return "low";
  return "bottom";
}

const Z_WORDS: Record<string, string> = {
  top: "big help",
  good: "helps",
  avg: "average",
  low: "hurts",
  bottom: "hurts a lot",
};

/** Nine category squares coloured by league rank (1 = best). */
export function RankStrip({
  ranks,
  punts,
  size = "md",
}: {
  ranks: number[];
  punts: ReadonlySet<Category>;
  size?: "sm" | "md";
}) {
  const label = CATEGORIES.map((c, j) =>
    `${c} ${punts.has(c) ? "punted" : ordinal(ranks[j])}`,
  ).join(", ");
  return (
    <span className={`strip ${size}`} role="img" aria-label={label}>
      {CATEGORIES.map((c, j) => (
        <span key={c} className="strip-cell">
          <span className={`sq ${punts.has(c) ? "punted" : rankTone(ranks[j])}`} />
          <span className="strip-label">{c}</span>
        </span>
      ))}
    </span>
  );
}

/** Nine squares for one player: how much he helps each category. */
export function ZStrip({
  z,
  punts,
}: {
  z: Record<Category, number>;
  punts: ReadonlySet<Category>;
}) {
  const label = CATEGORIES.map((c) =>
    `${c} ${punts.has(c) ? "punted" : Z_WORDS[zTone(z[c])]}`,
  ).join(", ");
  return (
    <span className="zstrip" role="img" aria-label={label}>
      {CATEGORIES.map((c) => (
        <span key={c} className={`sq ${punts.has(c) ? "punted" : zTone(z[c])}`} />
      ))}
    </span>
  );
}

export function RankLegend() {
  return (
    <span className="legend">
      <span><i className="sq top" />Top 3</span>
      <span><i className="sq good" />4th–6th</span>
      <span><i className="sq low" />7th–9th</span>
      <span><i className="sq bottom" />Bottom 3</span>
    </span>
  );
}

export function Logo() {
  return (
    <span className="logo">
      <svg width="30" height="30" viewBox="0 0 32 32" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true">
        <circle cx="16" cy="16" r="13" />
        <path d="M3 16h26M16 3v26M7 6.5c4 3 5.5 6 5.5 9.5S11 22.5 7 25.5M25 6.5c-4 3-5.5 6-5.5 9.5s1.5 6.5 5.5 9.5" />
      </svg>
      <span>Fantasy Draft Lab</span>
    </span>
  );
}
