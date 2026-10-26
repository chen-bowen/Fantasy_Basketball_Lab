import { Fragment, useEffect, useMemo, useState } from "react";
import {
  api,
  CATEGORIES,
  type ApiPlayer,
  type Category,
  type DraftView,
  type FitScale,
  type PreviewView,
} from "../api/client";
import { andList, ordinal, teamBadgeWithRisk, teamName, teamPunts } from "../state/teams";
import {
  Headshot,
  PlayerMeta,
  Stars,
  ZStrip,
  fitScore,
  rankTone,
  valueTier,
} from "./common";

interface Props {
  view: DraftView;
  playerMap: Map<string, ApiPlayer>;
  inspectedId: string | null;
  onInspect: (id: string | null) => void;
  onDraft: (id: string) => void;
  onTogglePunt: (c: Category) => void;
  onAutoPunts: () => void;
  onBackToBuild: (() => void) | null; // back to the build screens, on the first two turns
}

const HELPS_Z = 0.4;
const HURTS_Z = -0.9;
/** A player is "likely gone" when he's drafted before your next turn in at least half the look-ahead runs. */
const GONE_THRESHOLD = 0.5;

export function DraftRoom({
  view, playerMap, inspectedId, onInspect, onDraft, onTogglePunt, onAutoPunts, onBackToBuild,
}: Props) {
  const punts = useMemo(() => new Set<Category>(view.userPunts), [view.userPunts]);
  const lookahead = view.nextUserPick != null && Object.keys(view.gone).length > 0;
  const canWait = useMemo(
    () => new Set(lookahead ? Object.keys(view.gone).filter((id) => view.gone[id] < GONE_THRESHOLD) : []),
    [view.gone, lookahead],
  );
  // The recommendations are the candidates: the players in range at this
  // pick (the top of the board as the market sees it — whoever is expected
  // to go before your next turn, plus some reach), ordered by Fit. Everyone
  // else is a later-round target: still scored, listed below, never the pick.
  const candidates = useMemo(() => new Set(view.candidates), [view.candidates]);
  const available = useMemo(() => {
    const later = Object.keys(view.fit)
      .filter((id) => !candidates.has(id))
      .sort((a, b) => view.fit[b] - view.fit[a]);
    return [...view.candidates, ...later].map((id) => playerMap.get(id)!).filter(Boolean);
  }, [view.fit, view.candidates, candidates, playerMap]);
  const scale = view.fitScale;
  const focus =
    (inspectedId && view.fit[inspectedId] !== undefined && playerMap.get(inspectedId)) ||
    available[0];

  return (
    <>
      <BuildBanner
        view={view}
        punts={punts}
        onTogglePunt={onTogglePunt}
        onAutoPunts={onAutoPunts}
        onBackToBuild={onBackToBuild}
      />
      <main className="room">
        <FitTable
          view={view}
          players={available}
          scale={scale}
          punts={punts}
          candidates={candidates}
          canWait={canWait}
          focusId={focus?.id ?? null}
          onInspect={onInspect}
        />
        <aside className="room-side">
          {focus && (
            <PlayerPanel
              view={view}
              player={focus}
              isTop={focus.id === view.candidates[0]}
              inRange={candidates.has(focus.id)}
              canWait={canWait.has(focus.id)}
              runnerUp={
                focus.id === view.candidates[0] && canWait.has(focus.id)
                  ? view.candidates.slice(1).map((id) => playerMap.get(id)).find((p) => p && !canWait.has(p.id)) ?? null
                  : null
              }
              scale={scale}
              punts={punts}
              onDraft={() => onDraft(focus.id)}
              onClose={inspectedId ? () => onInspect(null) : null}
            />
          )}
          <TeamPanel view={view} playerMap={playerMap} />
        </aside>
      </main>
    </>
  );
}

function BuildBanner({
  view,
  punts,
  onTogglePunt,
  onAutoPunts,
  onBackToBuild,
}: {
  view: DraftView;
  punts: ReadonlySet<Category>;
  onTogglePunt: (c: Category) => void;
  onAutoPunts: () => void;
  onBackToBuild: (() => void) | null;
}) {
  const [editing, setEditing] = useState(false);
  const auto = view.puntMode === "auto";
  const plan = view.puntPlan;
  const planDiffers =
    !auto && (plan.punts.length !== punts.size || plan.punts.some((c) => !punts.has(c)));
  return (
    <div className="banner-wrap">
      <section className="card banner">
        <div className="banner-text">
          <span className="banner-title">
            <strong>{punts.size ? "Your build" : "No punt"}</strong>
            {[...punts].map((c) => (
              <span key={c} className="chip dark">
                Punt {c}
              </span>
            ))}
            <span className="chip" title={auto ? "The punt follows your roster after every pick" : "Punts set by hand"}>
              {auto ? "follows your roster" : "set by hand"}
            </span>
          </span>
          <span className="muted">
            {auto
              ? plan.reason
              : planDiffers
                ? `${plan.reason} (You're on manual — ${plan.punts.length ? `the roster would punt ${andList(plan.punts)}.` : "the roster would punt nothing."})`
                : plan.reason}{" "}
            {fitStanceText(view)}
          </span>
        </div>
        {onBackToBuild && (
          <button className="btn" onClick={onBackToBuild}>
            Back to build options
          </button>
        )}
        {!auto && (
          <button className="btn" onClick={onAutoPunts} title="Let the roster decide the punt from here">
            Let the roster decide
          </button>
        )}
        <button className="btn" aria-expanded={editing} onClick={() => setEditing(!editing)}>
          {editing ? "Done" : "Change punts"}
        </button>
        {editing && (
          <div className="punt-toggles" role="group" aria-label="Punted categories">
            {CATEGORIES.map((c) => (
              <button
                key={c}
                className={punts.has(c) ? "toggle on" : "toggle"}
                aria-pressed={punts.has(c)}
                onClick={() => onTogglePunt(c)}
              >
                {c}
              </button>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

/**
 * One sentence on how Fit is weighing the categories right now: what it
 * leans toward (where one pick moves your record most), and what it has
 * stopped chasing — a category you're too far behind in to catch the pack,
 * or one you already own. Never "fix what you're worst at".
 */
function fitStanceText(view: DraftView): string {
  if (view.rosters[view.userSlot].length === 0) return "Fit is plain value until your team has a shape.";
  const lean = CATEGORIES.filter((c) => view.stances[c] === "lean");
  const behind = CATEGORIES.filter((c) => view.stances[c] === "behind");
  const ahead = CATEGORIES.filter((c) => view.stances[c] === "ahead");
  const parts: string[] = [];
  if (lean.length) parts.push(`Fit leans toward ${andList(lean)}, where one pick moves your record most.`);
  const skipped: string[] = [];
  if (behind.length) skipped.push(`${andList(behind)} (too far behind to catch the pack — don't spend picks on it)`);
  if (ahead.length) skipped.push(`${andList(ahead)} (already yours)`);
  if (skipped.length) parts.push(`It isn't chasing ${skipped.join(" or ")}.`);
  if (!parts.length) return "Every category is still in play, so Fit is close to plain value — just weighed the way the scoresheet counts, not the way the market pays.";
  return parts.join(" ");
}

const POSITIONS = ["All", "G", "F", "C", "PG", "SG", "SF", "PF"];
const PAGE = 50;

function FitTable({
  view,
  players,
  scale,
  punts,
  candidates,
  canWait,
  focusId,
  onInspect,
}: {
  view: DraftView;
  players: ApiPlayer[];
  scale: FitScale;
  punts: ReadonlySet<Category>;
  candidates: ReadonlySet<string>;
  canWait: ReadonlySet<string>;
  focusId: string | null;
  onInspect: (id: string) => void;
}) {
  const [mode, setMode] = useState<"fit" | "numbers">("fit");
  const [sortBy, setSortBy] = useState<"fit" | "value">("fit");
  const [query, setQuery] = useState("");
  const [pos, setPos] = useState("All");
  const [limit, setLimit] = useState(PAGE);

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    const shown = players.filter(
      (p) =>
        (!q || p.name.toLowerCase().includes(q) || p.team.toLowerCase().includes(q)) &&
        (pos === "All" || p.positions.includes(pos)),
    );
    // `players` arrives as candidates by Fit, then the rest by Fit; re-sort
    // only when sorting by value.
    return sortBy === "fit"
      ? shown
      : [...shown].sort((a, b) => (b.overall ?? 0) - (a.overall ?? 0));
  }, [players, query, pos, sortBy]);
  const win = view.window;
  const rangeText =
    win.size == null
      ? ""
      : win.nextPick == null
        ? "Your last pick: everyone left is in range."
        : `In range now: the ${win.size} players the board expects to go before your next pick (#${win.nextPick}), plus ${win.reach} spots of reach.`;
  const sortHeader = (key: "fit" | "value", label: string) => (
    <button
      className={sortBy === key ? "sort-btn on" : "sort-btn"}
      aria-label={`Sort by ${label}`}
      onClick={() => setSortBy(key)}
    >
      {label}
      {sortBy === key && (
        <svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor" aria-hidden="true">
          <path d="M1 3h8L5 8z" />
        </svg>
      )}
    </button>
  );
  const needed = new Set(view.neededCategories);
  const colClass = (c: Category) =>
    punts.has(c) ? "cat-col punted" : needed.has(c) ? "cat-col needed" : "cat-col";

  return (
    <section className="card table-card">
      <div className="table-head">
        <h2 className="title">Available players</h2>
        <div className="seg" role="group" aria-label="Table view">
          <button aria-pressed={mode === "fit"} onClick={() => setMode("fit")}>Fit</button>
          <button aria-pressed={mode === "numbers"} onClick={() => setMode("numbers")}>Numbers</button>
        </div>
      </div>
      <p className="table-note">
        <strong>Fit</strong> (0–10) is how much a player helps your team at this pick: the best
        candidate in range scores 10, and it updates after every pick. {rangeText}
        {" "}Players the board expects to go later are listed below the line: they keep a Fit, but
        the pick comes from the candidates — you can likely get them at a later turn.{" "}
        <strong>Value</strong> (stars) is his price at the draft table — where drafters
        take him, weighing categories the way real drafts do (points and assists over
        steals or free throws): five stars is first-round quality. When Fit runs ahead of
        Value, the market is underrating what he does for your categories.
        {punts.size > 0 && ` Fit leaves out ${andList([...punts])} because you punt ${punts.size > 1 ? "them" : "it"}.`}
      </p>
      <div className="filters">
        <label className="search">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
            <circle cx="7" cy="7" r="5" />
            <path d="M11 11l3.5 3.5" />
          </svg>
          <input
            aria-label="Search players"
            placeholder="Search players"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
        <select aria-label="Position" value={pos} onChange={(e) => setPos(e.target.value)}>
          {POSITIONS.map((p) => (
            <option key={p} value={p}>{p === "All" ? "All positions" : p}</option>
          ))}
        </select>
      </div>

      <div className="table-scroll">
        <table className={mode === "fit" ? "fit-table" : "fit-table numbers"}>
          <thead>
            <tr>
              <th scope="col" className="left">Player</th>
              <th scope="col" className="left fit-col" aria-sort={sortBy === "fit" ? "descending" : "none"}>
                {sortHeader("fit", "Fit")}
              </th>
              <th scope="col" className="left value-col" aria-sort={sortBy === "value" ? "descending" : "none"}>
                {sortHeader("value", "Value")}
              </th>
              {mode === "fit" ? (
                <th scope="col" className="left">
                  <span className="zhead">
                    {CATEGORIES.map((c) => (
                      <span key={c} className={colClass(c)}>{c}</span>
                    ))}
                  </span>
                </th>
              ) : (
                <>
                  <th scope="col">ADP</th>
                  <th scope="col">MIN</th>
                  {CATEGORIES.map((c) => (
                    <th key={c} scope="col" className={colClass(c)}>{c}</th>
                  ))}
                </>
              )}
            </tr>
          </thead>
          <tbody>
            {rows.slice(0, limit).map((p, i, arr) => {
              const score = fitScore(view.fit[p.id], scale);
              const tier = valueTier(p.overallRank);
              const inRange = candidates.has(p.id);
              const waits = inRange && canWait.has(p.id);
              const divider =
                sortBy === "fit" && !inRange && (i === 0 || candidates.has(arr[i - 1].id));
              return (
                <Fragment key={p.id}>
                  {divider && (
                    <tr className="divider-row" aria-hidden="true">
                      <td colSpan={mode === "fit" ? 4 : 5 + CATEGORIES.length}>
                        Usually drafted later — not in range at #{win.pick}
                        {win.nextPick != null && `; likely still there at your next pick (#${win.nextPick})`}
                      </td>
                    </tr>
                  )}
                <tr
                  className={[p.id === focusId ? "focused" : "", inRange ? "" : "later"].join(" ").trim()}
                  onClick={() => onInspect(p.id)}
                >
                  <td className="left">
                    <button className="row-btn">
                      <Headshot player={p} variant="avatar" />
                      <span className="row-name">
                        <strong>{p.name}</strong>
                        <PlayerMeta player={p} />
                        {!inRange && sortBy !== "fit" && (
                          <span className="chip wait" title={`The board expects him to go after your next pick — not a candidate at #${win.pick}`}>later round</span>
                        )}
                        {waits && (
                          <span className="chip wait" title={`Still there at #${view.nextUserPick} in ${Math.round((1 - view.gone[p.id]) * 100)}% of look-ahead runs`}>can wait</span>
                        )}
                      </span>
                    </button>
                  </td>
                  <td className="left">
                    <span className={inRange ? "fit-cell" : "fit-cell later"}>
                      <strong>{score.toFixed(1)}</strong>
                      {mode === "fit" && (
                        <span className="meter dark">
                          <span style={{ width: `${score * 10}%` }} />
                        </span>
                      )}
                    </span>
                  </td>
                  <td className="left">
                    <span
                      className="value-cell"
                      title={`${tier.label} · value ${(p.overall ?? 0).toFixed(1)}`}
                    >
                      <Stars count={tier.stars} />
                      {p.overallRank != null && <span className="muted small">#{p.overallRank}</span>}
                    </span>
                  </td>
                  {mode === "fit" ? (
                    <td className="left">{p.z && <ZStrip z={p.z} punts={punts} />}</td>
                  ) : (
                    <>
                      <td className="muted">{p.adp != null ? p.adp.toFixed(1) : "—"}</td>
                      <td className="muted">{p.min.toFixed(1)}</td>
                      {CATEGORIES.map((c) => (
                        <td key={c} className={punts.has(c) ? "muted" : ""}>
                          {statText(p, c)}
                        </td>
                      ))}
                    </>
                  )}
                </tr>
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
      {rows.length > limit && (
        <div className="table-foot">
          <button className="btn" onClick={() => setLimit(limit + PAGE)}>
            Show {Math.min(PAGE, rows.length - limit)} more
          </button>
        </div>
      )}
      {mode === "fit" && (
        <div className="legend table-legend">
          <span><i className="sq top" />Big help</span>
          <span><i className="sq good" />Helps</span>
          <span><i className="sq avg" />About average</span>
          <span><i className="sq low" />Hurts</span>
          <span><i className="sq bottom" />Hurts a lot</span>
          <span><strong className="needed-key">Bold blue</strong> = category you need</span>
        </div>
      )}
    </section>
  );
}

function statText(p: ApiPlayer, c: Category): string {
  switch (c) {
    case "PTS": return p.pts.toFixed(1);
    case "REB": return p.reb.toFixed(1);
    case "AST": return p.ast.toFixed(1);
    case "STL": return p.stl.toFixed(1);
    case "BLK": return p.blk.toFixed(1);
    case "3PM": return p.tpm.toFixed(1);
    case "FG%": return p.fga > 0 ? ((p.fgm / p.fga) * 100).toFixed(1) : "—";
    case "FT%": return p.fta > 0 ? ((p.ftm / p.fta) * 100).toFixed(1) : "—";
    case "TO": return p.tov.toFixed(1);
  }
}

function PlayerPanel({
  view,
  player,
  isTop,
  inRange,
  canWait,
  runnerUp,
  scale,
  punts,
  onDraft,
  onClose,
}: {
  view: DraftView;
  player: ApiPlayer;
  isTop: boolean; // the top candidate
  inRange: boolean; // a candidate at this pick (in the draft window)
  canWait: boolean; // likely still there at the user's next pick (look-ahead)
  runnerUp: ApiPlayer | null; // the best candidate who won't be, when the top one can wait
  scale: FitScale;
  punts: ReadonlySet<Category>;
  onDraft: () => void;
  onClose: (() => void) | null;
}) {
  const z = player.z ?? ({} as Record<Category, number>);
  const tier = valueTier(player.overallRank);
  const [preview, setPreview] = useState<{
    playerId: string;
    pickIndex: number;
    data: PreviewView;
  } | null>(null);
  useEffect(() => {
    if (!view.id) return;
    let cancelled = false;
    api
      .preview(view.id, player.id)
      .then((data) => {
        if (!cancelled)
          setPreview({ playerId: player.id, pickIndex: view.pickIndex, data });
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [view.id, view.pickIndex, player.id]);

  const helps = view.neededCategories.filter((c) => z[c] > HELPS_Z);
  const otherHelps = CATEGORIES.filter(
    (c) => !punts.has(c) && !helps.includes(c) && z[c] >= 1.5,
  );
  const hurts = CATEGORIES.filter((c) => !punts.has(c) && z[c] <= HURTS_Z);
  const fit = view.fit[player.id];
  const value = player.overall ?? 0;
  const last = player.name.split(" ").slice(1).join(" ") || player.name;

  const lead = isTop ? "The best fit in range at this pick. " : "";
  let why: string;
  if (helps.length) {
    why = `${lead}He adds ${andList(helps)}, where a pick moves your record most right now.`;
  } else if (otherHelps.length && view.rosters[view.userSlot].length === 0) {
    why = `${isTop ? "The best player available. " : ""}Strong in ${andList(otherHelps)}.`;
  } else if (otherHelps.length) {
    why = `${lead}Strong in ${andList(otherHelps)}.`;
  } else {
    why = `${lead}No standout category — his value is spread across the board.`;
  }
  if (!inRange) {
    why +=
      view.window.nextPick != null
        ? ` The board expects him to go after your next pick (#${view.window.nextPick}), so he isn't a candidate at #${view.window.pick} — target him at a later turn rather than spend this one.`
        : " Not in range at this pick.";
  } else if (isTop && canWait && runnerUp) {
    why += ` He is likely still there at #${view.nextUserPick}, though — ${runnerUp.name} won't be, and fits nearly as well.`;
  }

  return (
    <section className="card player-panel">
      <div className="panel-photo">
        <Headshot player={player} variant="tile" />
        {onClose && (
          <button className="icon-btn" aria-label="Back to top fit" onClick={onClose}>
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <path d="M3 3l10 10M13 3L3 13" />
            </svg>
          </button>
        )}
      </div>
      <div className="pad stack">
        <div className="panel-head">
          <div className="stack-xs grow">
            <h3 className="title-lg">{player.name}</h3>
            <span className="muted">
              <PlayerMeta player={player} /> · {player.gp} games in {player.asOfSeason}
            </span>
          </div>
          <span className="badge-pair">
            <span
              className={inRange ? "fit-badge" : "fit-badge later"}
              title={
                inRange
                  ? "Fit for your team on a 0–10 scale: 10 = the best candidate in range at this pick, 0 = the last one"
                  : "Fit on this pick's scale, but he is outside the draft window — usually drafted later"
              }
            >
              <strong>{fitScore(fit, scale).toFixed(1)}</strong>
              <span>{inRange ? "fit / 10" : "later round"}</span>
            </span>
            <span className="value-badge" title={`Value ${value.toFixed(1)}`}>
              <Stars count={tier.stars} />
              <span>
                {tier.label}
                {player.overallRank != null ? ` · #${player.overallRank}` : ""}
              </span>
            </span>
          </span>
        </div>
        <p className="body-text lg">{why}</p>
        <div className="stack-sm">
          <div className="chip-row">
            <span className="chip-row-label">Fills a need</span>
            {helps.length ? helps.map((c) => <span key={c} className="chip blue">{c}</span>) : <span className="muted small">None</span>}
          </div>
          <div className="chip-row">
            <span className="chip-row-label">Costs you</span>
            {hurts.length ? hurts.map((c) => <span key={c} className="chip orange-soft">{c}</span>) : <span className="muted small">Nothing major</span>}
          </div>
          {Math.abs(fit - value) > 0.05 && (
            <span className="muted small">
              {fit > value
                ? "Fit is above his draft value: he produces in categories the market underpays for, or in ones where a pick moves your record most."
                : "Fit is below his draft value: his strengths are in categories that are punted, already yours, out of reach, or priced in by the market."}
            </span>
          )}
          {player.adp != null && (
            <span className="muted small">
              ADP {player.adp.toFixed(1)}
              {view.isUserTurn &&
                (() => {
                  const gap = Math.round(view.pickIndex + 1 - player.adp!);
                  if (Math.abs(gap) <= 3) return " — goes right around this pick";
                  return gap > 0
                    ? ` — usually goes ~${gap} picks earlier`
                    : ` — usually goes ~${-gap} picks later`;
                })()}
            </span>
          )}
          {view.nextUserPick != null && view.gone[player.id] !== undefined && (
            <span className={view.gone[player.id] >= 0.5 ? "small ink" : "muted small"}>
              {view.nextUserPick === view.pickIndex + 2
                ? `You pick again right after this one (#${view.nextUserPick}).`
                : view.gone[player.id] >= 0.99
                  ? `Gone before your next pick (#${view.nextUserPick}) in every look-ahead run — now or never.`
                  : view.gone[player.id] >= 0.5
                    ? `Gone before your next pick (#${view.nextUserPick}) in ${Math.round(view.gone[player.id] * 100)}% of look-ahead runs.`
                    : view.gone[player.id] <= 0.01
                      ? `Still there at your next pick (#${view.nextUserPick}) in every look-ahead run — you can wait on him.`
                      : `Still there at #${view.nextUserPick} in ${Math.round((1 - view.gone[player.id]) * 100)}% of look-ahead runs.`}
            </span>
          )}
          {Object.keys(player.gpBySeason ?? {}).length > 0 && (
            <span className="muted small">
              Games played:{" "}
              {Object.entries(player.gpBySeason ?? {})
                .map(([s, g]) => `'${s.slice(2)} ${g}`)
                .join(" · ")}
              {player.availability != null && (
                <>
                  {" "}
                  — {player.injury ? `listed ${player.injury}, ` : ""}
                  expected to play about {Math.round(player.availability * 100)}% of games
                  {player.availability < 0.65
                    ? ", which lowers his value a lot"
                    : player.availability < 0.8
                      ? ", which lowers his value"
                      : ""}
                </>
              )}
            </span>
          )}
        </div>
        {player.z && <ValueBreakdown z={player.z} punts={punts} value={value} />}
        {preview?.playerId === player.id &&
          preview.pickIndex === view.pickIndex && (
            <ImpactRows
              preview={preview.data}
              punts={punts}
              needed={new Set(view.neededCategories)}
            />
          )}
        <button className="btn primary xl" disabled={!view.isUserTurn} onClick={onDraft}>
          {view.isUserTurn ? `Draft ${last}` : "Waiting for your pick…"}
        </button>
      </div>
    </section>
  );
}

const BAR_MAX_Z = 3; // bars are scaled to ±3; larger scores fill the bar

/** Where a player's value comes from: one bar per category score, centred on 0. */
function ValueBreakdown({
  z,
  punts,
  value,
}: {
  z: Record<Category, number>;
  punts: ReadonlySet<Category>;
  value: number;
}) {
  return (
    <div className="breakdown">
      <div className="impact-head">
        <strong>Where his value comes from</strong>
        <span className="muted small">0 = average player · sum {value.toFixed(1)}</span>
      </div>
      {CATEGORIES.map((c) => {
        const v = z[c];
        const width = (Math.min(Math.abs(v), BAR_MAX_Z) / BAR_MAX_Z) * 50;
        return (
          <div key={c} className={punts.has(c) ? "breakdown-row punted" : "breakdown-row"}>
            <span className="rank-cat">{c}</span>
            <span className="diverge" aria-hidden="true">
              <span
                className={v >= 0 ? "diverge-bar pos" : "diverge-bar neg"}
                style={v >= 0 ? { left: "50%", width: `${width}%` } : { right: "50%", width: `${width}%` }}
              />
            </span>
            <span className={v >= 0 ? "breakdown-val pos" : "breakdown-val neg"}>
              {v >= 0 ? "+" : "−"}
              {Math.abs(v).toFixed(1)}
            </span>
          </div>
        );
      })}
    </div>
  );
}

/** Per-category rank the user's team would hold with this player added. */
function ImpactRows({
  preview,
  punts,
  needed,
}: {
  preview: PreviewView;
  punts: ReadonlySet<Category>;
  needed: ReadonlySet<Category>;
}) {
  const hasBefore = preview.before.size > 0;
  return (
    <div className="impact">
      <div className="impact-head">
        <strong>If you draft him</strong>
        <span className="muted small">your category ranks</span>
      </div>
      {CATEGORIES.map((c) => {
        const r = preview.ranks?.[c];
        if (!r) return null;
        const moved = hasBefore ? r.before - r.after : 0;
        return (
          <div
            key={c}
            className={
              punts.has(c)
                ? "impact-row punted"
                : needed.has(c)
                  ? "impact-row needed"
                  : "impact-row"
            }
          >
            <span className="rank-cat">{c}</span>
            <span className="impact-move">
              <span>{hasBefore ? ordinal(r.before) : "—"}</span>
              <span className="impact-arrow" aria-hidden="true">→</span>
              <strong className={rankTone(r.after)}>{ordinal(r.after)}</strong>
            </span>
            <span
              className={
                moved > 0
                  ? "impact-delta up"
                  : moved < 0
                    ? "impact-delta down"
                    : "impact-delta flat"
              }
            >
              {moved > 0 ? `+${moved}` : moved < 0 ? moved : "—"}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function TeamPanel({ view, playerMap }: { view: DraftView; playerMap: Map<string, ApiPlayer> }) {
  const [team, setTeam] = useState(view.userSlot);
  const n = view.numTeams;
  const isYou = team === view.userSlot;
  const punts = teamPunts(view, team);
  const badge = isYou
    ? view.userPunts.length ? `Punt ${view.userPunts.join(", ")}` : "No punt yet"
    : teamBadgeWithRisk(view, team);
  const roster = view.rosters[team].map((id) => playerMap.get(id)!);
  const rec = view.records[team];
  const go = (t: number) => setTeam((t + n) % n);

  return (
    <section className="card pad stack team-panel">
      <div className="team-nav">
        <button className="icon-btn outline" aria-label="Previous team" onClick={() => go(team - 1)}>
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M10 3L5 8l5 5" /></svg>
        </button>
        <select aria-label="Team to view" value={team} onChange={(e) => setTeam(Number(e.target.value))}>
          {Array.from({ length: n }, (_, t) => (
            <option key={t} value={t}>
              {t === view.userSlot ? "You" : `${teamName(view, t)} · ${teamBadgeWithRisk(view, t)}`}
            </option>
          ))}
        </select>
        <button className="icon-btn outline" aria-label="Next team" onClick={() => go(team + 1)}>
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M6 3l5 5-5 5" /></svg>
        </button>
      </div>

      <div className="team-title">
        <h3 className="title">{isYou ? "Your team" : teamName(view, team)}</h3>
        <span className="chip">{badge}</span>
        {roster.length > 0 && (
          <span className="muted small push">
            {rec.wins}–{rec.losses}{rec.ties ? `–${rec.ties}` : ""} so far
          </span>
        )}
      </div>

      <ol className="roster">
        {roster.map((p, i) => (
          <li key={p.id}>
            <span className="muted small rd">Rd {i + 1}</span>
            <Headshot player={p} variant="mini" />
            <strong className="grow">{p.name}</strong>
            <span className="muted small">{p.positions.join("/")}</span>
          </li>
        ))}
        {isYou && view.isUserTurn && (
          <li className="now">
            <span className="small rd">Rd {view.round}</span>
            <strong>Your pick now</strong>
          </li>
        )}
        {roster.length === 0 && !(isYou && view.isUserTurn) && (
          <li className="empty muted">No picks yet</li>
        )}
      </ol>

      {roster.length > 0 && (
        <div className="ranks">
          <div className="ranks-head">
            <strong>Where they rank</strong>
            <span className="muted small">out of {n} teams</span>
          </div>
          {CATEGORIES.map((c) => {
            const r = view.ranks[c][team];
            const p = punts.has(c);
            return (
              <div key={c} className={p ? "rank-row punted" : "rank-row"}>
                <span className="rank-cat">{c}</span>
                <span className="meter">
                  <span className={p ? "punted" : rankTone(r)} style={{ width: `${((n + 1 - r) / n) * 100}%` }} />
                </span>
                <span className="rank-val">{p ? "punted" : ordinal(r)}</span>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
