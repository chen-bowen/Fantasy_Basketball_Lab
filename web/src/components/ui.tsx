import { useState, type CSSProperties, type ReactNode } from "react";
import { CATEGORIES, type ApiPlayer, type Category, type DraftView, type PairingReason } from "../api/client";
import { andList, buildBadge, ordinal, places, recordText, teamName, teamPunts, teamRisk } from "../state/teams";

/**
 * NBA CDN headshot (by nbaId). Large frames load the 1040×760 cut so they
 * stay sharp on retina screens; avatars zoom into the face of the 260×190
 * cut, which is already more pixels than a 40px circle can show.
 */
export function headshotUrl(nbaId: number | null, size: "lg" | "sm" = "sm"): string | null {
  if (!nbaId) return null;
  return `https://cdn.nba.com/headshots/nba/latest/${size === "lg" ? "1040x760" : "260x190"}/${nbaId}.png`;
}

/** Team colours for the headshot backdrop: a light and a deep shade of each team's primary. */
const TEAM_COLORS: Record<string, [string, string]> = {
  ATL: ["#e8535a", "#c8102e"], BKN: ["#5b5b5b", "#111111"], BOS: ["#2f9a5a", "#007a33"],
  CHA: ["#2e8ea8", "#1d1160"], CHI: ["#e0405a", "#ce1141"], CLE: ["#a8355a", "#860038"],
  DAL: ["#3f86c4", "#00538c"], DEN: ["#3a6a9e", "#0e2240"], DET: ["#e5485f", "#c8102e"],
  GSW: ["#3f7fd0", "#1d428a"], HOU: ["#e04a63", "#ce1141"], IND: ["#3a5f93", "#002d62"],
  LAC: ["#e04a63", "#1d428a"], LAL: ["#7a4fb3", "#552583"], MEM: ["#8197c4", "#5d76a9"],
  MIA: ["#c8364a", "#98002e"], MIL: ["#2f6b3e", "#00471b"], MIN: ["#4f87b8", "#236192"],
  NOP: ["#3a5e8c", "#0c2340"], NYK: ["#3d8fd6", "#006bb6"], OKC: ["#3fa3e0", "#007ac1"],
  ORL: ["#3f8fd6", "#0077c0"], PHI: ["#3d7fd0", "#006bb6"], PHX: ["#5a4a9c", "#1d1160"],
  POR: ["#e0455a", "#c8102e"], SAC: ["#7a5cb8", "#5a2d81"], SAS: ["#8a9399", "#3d4448"],
  TOR: ["#e0405a", "#ce1141"], UTA: ["#5a4fb0", "#3e2680"], WAS: ["#2f5fa8", "#002b5c"],
};
const NO_TEAM: [string, string] = ["#9aa3b0", "#5a6474"];

export function teamBackdrop(team: string): CSSProperties {
  const [a, b] = TEAM_COLORS[team] ?? NO_TEAM;
  return { "--team-a": a, "--team-b": b } as CSSProperties;
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
 * A headshot on its team's colours: `tile` fills a photo frame (the frame
 * sets the size), `avatar` and `mini` are circles cropped to the face. With
 * no photo, the player's initials sit on the same backdrop.
 */
export function Headshot({
  player,
  variant,
}: {
  player: Pick<ApiPlayer, "name" | "nbaId"> & { team?: string };
  variant: "tile" | "avatar" | "mini";
}) {
  const [failed, setFailed] = useState(false);
  const url = headshotUrl(player.nbaId, variant === "tile" ? "lg" : "sm");
  const decorative = variant !== "tile";
  return (
    <span
      className={`headshot ${variant}${!url || failed ? " fallback" : ""}`}
      style={teamBackdrop(player.team ?? "")}
      role={decorative ? undefined : "img"}
      aria-label={decorative ? undefined : player.name}
      aria-hidden={decorative ? true : undefined}
    >
      {url && !failed ? (
        <img src={url} alt="" loading="lazy" decoding="async" onError={() => setFailed(true)} />
      ) : (
        initials(player.name)
      )}
    </span>
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

/**
 * Nine category squares coloured by league rank (1 = best). A punted
 * category keeps its rank and colour and gets a dashed punt mark — you
 * still finish somewhere in it. With `showRanks` the rank is printed too.
 */
export function RankStrip({
  ranks,
  punts,
  size = "md",
  showRanks = false,
}: {
  ranks: number[];
  punts: ReadonlySet<Category>;
  size?: "sm" | "md";
  showRanks?: boolean;
}) {
  const label = CATEGORIES.map((c, j) =>
    `${c} ${ordinal(ranks[j])}${punts.has(c) ? " (punted)" : ""}`,
  ).join(", ");
  return (
    <span className={`strip ${size}${showRanks ? " ranked" : ""}`} role="img" aria-label={label}>
      {CATEGORIES.map((c, j) => (
        <span key={c} className="strip-cell">
          <span className={`sq ${rankTone(ranks[j])}${punts.has(c) ? " punted" : ""}`}>
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
      <span><i className="sq avg punted" />Punted (rank still counts)</span>
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
  punt,
}: {
  why: PairingReason;
  anchor: string | null; // the player already on the roster, or null before the first pick
  punt: Category | null;
}) {
  const last = anchor ? anchor.split(" ").slice(-1)[0] : null;
  const parts: string[] = [];
  if (why.adds.length) parts.push(`${anchor ? "adds" : "brings"} ${andList(why.adds)}`);
  if (why.patches.length) parts.push(`offsets ${last}'s ${andList(why.patches)}`);
  if (why.spares.length) parts.push(`doesn't deepen ${last}'s ${andList(why.spares)} problem`);
  if (why.overlaps.length) parts.push(`doubles up on ${andList(why.overlaps)}`);
  const costs = why.costs.filter((c) => c !== punt);
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
      <span><i className="sq avg punted" />Punted (rank still counts)</span>
    </>
  );
}

/**
 * One row per team, one rank cell per category, sorted by the paper record.
 * Next to W–L sits the week-to-week win rate: the share of matchups the
 * roster wins in a typical equal-games week, which counts how close each
 * category is rather than who ranks higher.
 */
export function Standings({ view, teams }: { view: DraftView; teams: number[] }) {
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
              const punts = teamPunts(view, t);
              const badge = buildBadge(view, t);
              const risk = teamRisk(view, t);
              return (
                <tr key={t} className={t === view.userSlot ? "focused" : ""}>
                  <td className="left muted">{place[t]}</td>
                  <th scope="row" className="left team-col">
                    <span className="team-cell">
                      <strong>{t === view.userSlot ? "Your team" : teamName(view, t)}</strong>
                      <span className={`kind ${badge.tone}`}>{badge.label}</span>
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
                    const punted = punts.has(c);
                    return (
                      <td key={c} className="cat">
                        <span
                          className={`rank-cell ${rankTone(r)}${punted ? " punted" : ""}`}
                          aria-label={`${c} ${ordinal(r)}${punted ? ", punted" : ""}`}
                          title={punted ? `${c}: punted, still ${ordinal(r)} of ${view.numTeams}` : undefined}
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
        counts how close each category is. Numbers are category ranks, 1st to {ordinal(view.numTeams)};
        a punted category still has one.
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
