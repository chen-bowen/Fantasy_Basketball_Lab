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
