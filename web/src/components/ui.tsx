import type { CSSProperties, ReactNode } from "react";
import { CATEGORIES, type ApiPlayer, type Category, type SessionView, type PairingReason } from "../api/client";
import { andList, buildChip, ordinal, places, recordText, squadName, squadConcedes, squadLean } from "../state/squads";

/**
 * Avatar backdrop colours derived from the team code itself: a short hash
 * picks the hue pair, so every club gets a stable, distinct gradient.
 */
export function clubTint(team: string): CSSProperties {
  let h = 0;
  for (const ch of team) h = (h * 31 + ch.charCodeAt(0)) | 0;
  const hue = ((h % 360) + 360) % 360;
  if (!team) return { "--team-a": "#9aa3b0", "--team-b": "#5a6474" } as CSSProperties;
  return {
    "--team-a": `hsl(${hue} 55% 55%)`,
    "--team-b": `hsl(${hue} 60% 28%)`,
  } as CSSProperties;
}

export function initials(name: string): string {
  return name
    .split(" ")
    .filter((w) => /^[A-Z]/.test(w))
    .slice(0, 2)
    .map((w) => w[0])
    .join("");
}

/**
 * The player's monogram on his club's colours: `tile` fills a large frame
 * (the frame sets the size), `avatar` and `mini` are small circles.
 */
export function Monogram({
  player,
  variant,
}: {
  player: Pick<ApiPlayer, "name"> & { team?: string };
  variant: "tile" | "avatar" | "mini";
}) {
  const decorative = variant !== "tile";
  return (
    <span
      className={`monogram ${variant}`}
      style={clubTint(player.team ?? "")}
      role={decorative ? undefined : "img"}
      aria-label={decorative ? undefined : player.name}
      aria-hidden={decorative ? true : undefined}
    >
      {initials(player.name)}
    </span>
  );
}

/** "C · NYE", or a free-agent tag when the player is unsigned. */
export function PlayerMeta({ player }: { player: ApiPlayer }) {
  return (
    <span className="player-meta">
      {player.positions.join("/")}
      {" · "}
      {player.signed ? (
        player.team
      ) : (
        <span className="fa-tag" title="On no club roster">
          Free agent
        </span>
      )}
      {player.status && (
        <>
          {" "}
          <span
            className={player.status === "Out" ? "status-tag out" : "status-tag"}
            title="Current status tag; lowers the share of games he's expected to play, and with it his value"
          >
            {player.status}
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

/**
 * Nine category squares coloured by league rank (1 = best). A conceded
 * category keeps its rank and colour and gets a dashed concede mark — you
 * still finish somewhere in it. With `showRanks` the rank is printed too.
 */
export function RankStrip({
  ranks,
  concedes,
  size = "md",
  showRanks = false,
}: {
  ranks: number[];
  concedes: ReadonlySet<Category>;
  size?: "sm" | "md";
  showRanks?: boolean;
}) {
  const label = CATEGORIES.map((c, j) =>
    `${c} ${ordinal(ranks[j])}${concedes.has(c) ? " (conceded)" : ""}`,
  ).join(", ");
  return (
    <span className={`strip ${size}${showRanks ? " ranked" : ""}`} role="img" aria-label={label}>
      {CATEGORIES.map((c, j) => (
        <span key={c} className="strip-cell">
          <span className={`sq ${rankTone(ranks[j])}${concedes.has(c) ? " conceded" : ""}`}>
            {showRanks && ranks[j]}
          </span>
          <span className="strip-label">{c}</span>
        </span>
      ))}
    </span>
  );
}

/** Nine squares for one player: how much he helps each category. */
export function ZStrip({
  z,
  concedes,
}: {
  z: Record<Category, number>;
  concedes: ReadonlySet<Category>;
}) {
  const label = CATEGORIES.map((c) =>
    `${c} ${concedes.has(c) ? "conceded" : Z_WORDS[zTone(z[c])]}`,
  ).join(", ");
  return (
    <span className="zstrip" role="img" aria-label={label}>
      {CATEGORIES.map((c) => (
        <span key={c} className={`sq ${concedes.has(c) ? "conceded" : zTone(z[c])}`} />
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
      <span><i className="sq avg conceded" />Conceded (rank still counts)</span>
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

/** Why this player next to the roster you have, in one or two plain sentences. */
export function PairingNotes({
  why,
  anchor,
  concede,
}: {
  why: PairingReason;
  anchor: string | null; // the player already on the roster, or null before the first pick
  concede: Category | null;
}) {
  const last = anchor ? anchor.split(" ").slice(-1)[0] : null;
  const parts: string[] = [];
  if (why.adds.length) parts.push(`${anchor ? "adds" : "brings"} ${andList(why.adds)}`);
  if (why.patches.length) parts.push(`offsets ${last}'s ${andList(why.patches)}`);
  if (why.spares.length) parts.push(`doesn't deepen ${last}'s ${andList(why.spares)} problem`);
  if (why.overlaps.length) parts.push(`doubles up on ${andList(why.overlaps)}`);
  const costs = why.costs.filter((c) => c !== concede);
  if (costs.length) parts.push(`costs you ${andList(costs)}`);
  const games = Math.round(why.availability * 100);
  const durability =
    why.availability >= 0.85
      ? `plays ~${games}% of games`
      : why.availability < 0.7
        ? `expected to miss ~${100 - games}% of games`
        : null;
  const price =
    why.marketRank != null
      ? why.marketRank === 1
        ? "the market's pick here"
        : `#${why.marketRank} on the board by market value`
      : null;
  const tail = [durability, price].filter(Boolean).join("; ");
  if (!parts.length && !tail) return null;
  const sentence = parts.join(", ");
  return (
    <span className="small pairing-notes">
      {parts.length > 0 && (
        <>
          {anchor ? (
            <>
              <strong className="ink">With {last}:</strong> {sentence}
            </>
          ) : (
            sentence.charAt(0).toUpperCase() + sentence.slice(1)
          )}
          {tail ? ". " : "."}
        </>
      )}
      {tail && <span className="muted">{tail.charAt(0).toUpperCase() + tail.slice(1)}.</span>}
    </span>
  );
}

export function RankLegendItems() {
  return (
    <>
      <span><i className="sq top" />Top 3</span>
      <span><i className="sq good" />4th–6th</span>
      <span><i className="sq low" />7th–9th</span>
      <span><i className="sq bottom" />Bottom 3</span>
      <span><i className="sq avg conceded" />Conceded (rank still counts)</span>
    </>
  );
}

/**
 * One row per team, one rank cell per category, sorted by the paper record.
 * Next to W–L sits the week-to-week win rate: the share of matchups the
 * roster wins in a typical equal-games week, which counts how close each
 * category is rather than who ranks higher.
 */
export function Standings({ view, teams }: { view: SessionView; teams: number[] }) {
  const place = places(view.records.map((r) => r.wins));
  const weekPlace = places(view.weekPct);
  const order = [...teams].sort(
    (a, b) => view.records[b].wins - view.records[a].wins || view.records[a].losses - view.records[b].losses,
  );

  return (
    <section className="card standings" aria-labelledby="standings-title">
      <div className="standings-head pad-x">
        <h2 id="standings-title" className="title">Category standings</h2>
        <span className="legend push">
          <RankLegendItems />
        </span>
      </div>
      <div className="table-scroll">
        <table className="league standings-table">
          <thead>
            <tr>
              <th scope="col" className="left">#</th>
              <th scope="col" className="left">Team</th>
              <th scope="col" title="Beats a team by ranking higher in more categories">On paper</th>
              <th scope="col" title="Share of matchups won in a typical equal-games week">Week to week</th>
              {CATEGORIES.map((c) => (
                <th key={c} scope="col" className="cat">{c}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {order.map((t) => {
              const concedes = squadConcedes(view, t);
              const badge = buildChip(view, t);
              const risk = squadLean(view, t);
              return (
                <tr key={t} className={t === view.seat ? "focused" : ""}>
                  <td className="left muted">{place[t]}</td>
                  <th scope="row" className="left team-col">
                    <span className="team-cell">
                      <strong>{t === view.seat ? "Your team" : squadName(view, t)}</strong>
                      <span className={`badge ${badge.tone}`}>{badge.label}</span>
                      {risk && <span className="muted small">{risk}</span>}
                    </span>
                  </th>
                  <td className="ink">{recordText(view, t)}</td>
                  <td className="week-col">
                    <span className="ink">{view.weekPct[t]}%</span>
                    <span className="muted small"> {weekPlace[t].startsWith("T") ? `T-${weekPlace[t].slice(1)}` : ordinal(Number(weekPlace[t]))}</span>
                  </td>
                  {CATEGORIES.map((c) => {
                    const r = view.ranks[c][t];
                    const conceded = concedes.has(c);
                    return (
                      <td key={c} className="cat">
                        <span
                          className={`rank-cell ${rankTone(r)}${conceded ? " conceded" : ""}`}
                          aria-label={`${c} ${ordinal(r)}${conceded ? ", conceded" : ""}`}
                          title={conceded ? `${c}: conceded, still ${ordinal(r)} of ${view.teams}` : undefined}
                        >
                          {r}
                        </span>
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="muted small pad-x foot-pad standings-foot">
        On paper: each roster against every other, beating a team by ranking higher in more of
        the 9 categories — every lead counts, however small. Week to week: the share of those
        matchups it wins in a typical week when both sides play the same number of games, which
        counts how close each category is. Numbers are category ranks, 1st to {ordinal(view.teams)};
        a conceded category still has one.
      </p>
    </section>
  );
}

/**
 * The card at the top of every draft phase — build screens and the room
 * alike. Same slot, same shape; only what it says changes at the handoff.
 */
export function PhaseBanner({
  title,
  chips,
  text,
  tone = "muted",
  actions,
  children,
}: {
  title: ReactNode;
  chips?: ReactNode;
  text: ReactNode;
  tone?: "muted" | "ink"; // ink: the text is the point, not a footnote
  actions?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="banner-wrap">
      <section className="card banner">
        <div className="banner-text">
          <span className="banner-title">
            <strong className="banner-heading">{title}</strong>
            {chips}
          </span>
          <span className={tone === "ink" ? "banner-copy ink-copy" : "banner-copy muted"}>{text}</span>
        </div>
        {actions}
        {children}
      </section>
    </div>
  );
}
