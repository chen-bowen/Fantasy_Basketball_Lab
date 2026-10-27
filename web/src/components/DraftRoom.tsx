import { Fragment, useEffect, useMemo, useState } from "react";
import {
  api,
  CATEGORIES,
  type ApiPlayer,
  type Category,
  type DraftView,
  type PreviewView,
} from "../api/client";
import { andList, ordinal, teamBadgeWithRisk, teamName, teamPunts } from "../state/teams";
import {
  Headshot,
  PlayerMeta,
  Stars,
  ZStrip,
  fitScale,
  fitScore,
  rankTone,
  valueTier,
  type FitScale,
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
/** Between these shares the look-ahead is a coin flip, and the row says so instead of picking a side. */
const GONE_SURE = 0.75;
const WAIT_SURE = 0.25;

export function DraftRoom({
  view, playerMap, inspectedId, onInspect, onDraft, onTogglePunt, onAutoPunts, onBackToBuild,
}: Props) {
  const punts = useMemo(() => new Set<Category>(view.userPunts), [view.userPunts]);
  const lookahead = view.nextUserPick != null && Object.keys(view.gone).length > 0;
  const canWait = useMemo(
    () => new Set(lookahead ? Object.keys(view.gone).filter((id) => view.gone[id] < GONE_THRESHOLD) : []),
    [view.gone, lookahead],
  );
  // Who Fit recommends: the players the draft expects to go around this
  // pick. Everyone else is browsable but not a recommendation — he'll be
  // there later, and taking him now costs a player who won't be.
  const candidates = useMemo(() => new Set(view.candidates), [view.candidates]);
  // Candidates first, sorted by Fit — but those who will still be there
  // next turn go below the ones who won't (Fit says who helps most, the
  // look-ahead says who you have to take now). Then the rest of the board
  // in market order.
  const available = useMemo(() => {
    const picks = view.candidates
      .map((id) => playerMap.get(id)!)
      .filter(Boolean)
      .sort(
        (a, b) =>
          Number(canWait.has(a.id)) - Number(canWait.has(b.id)) || view.fit[b.id] - view.fit[a.id],
      );
    const later = Object.keys(view.fit)
      .filter((id) => !candidates.has(id))
      .map((id) => playerMap.get(id)!)
      .filter(Boolean)
      .sort((a, b) => (b.overall ?? 0) - (a.overall ?? 0));
    return [...picks, ...later];
  }, [view.candidates, view.fit, playerMap, canWait, candidates]);
  // The 0–10 scale is set by the candidates alone, sorted by raw Fit (the
  // display order is can't-wait first): 10 is the best recommendation at
  // this pick, not the best raw Fit on the whole board.
  const scale = useMemo(
    () => fitScale(view.candidates.map((id) => view.fit[id]).sort((a, b) => b - a)),
    [view.candidates, view.fit],
  );
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
          canWait={canWait}
          candidates={candidates}
          focusId={focus?.id ?? null}
          onInspect={onInspect}
        />
        <aside className="room-side">
          {focus && (
            <PlayerPanel
              view={view}
              player={focus}
              isTop={focus.id === available[0]?.id}
              isCandidate={candidates.has(focus.id)}
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
  const needs = view.neededCategories;
  const hasRoster = view.rosters[view.userSlot].length > 0;
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
            {needs.length
              ? `Fit counts ${andList(needs)} most — the categories you're still in the fight for.`
              : hasRoster
                ? "Nothing is settled yet, so Fit is close to draft value."
                : "Fit is draft value until your team has a shape."}
            {hasRoster && <SettledNote settled={view.settledCategories} />}
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

/** The categories Fit counts least, and why: a pick can't move a category
 * you've locked up, and shouldn't chase one you can't catch. */
function SettledNote({ settled }: { settled: DraftView["settledCategories"] }) {
  const { ahead, behind } = settled;
  if (!ahead.length && !behind.length) return null;
  const parts: string[] = [];
  if (ahead.length) parts.push(`${andList(ahead)} ${ahead.length > 1 ? "are" : "is"} locked up`);
  if (behind.length)
    parts.push(`${andList(behind)} ${behind.length > 1 ? "are" : "is"} too far back to chase with a pick`);
  return <> It counts {andList([...ahead, ...behind])} least: {parts.join(", and ")}.</>;
}

const POSITIONS = ["All", "G", "F", "C", "PG", "SG", "SF", "PF"];
const PAGE = 50;

function FitTable({
  view,
  players,
  scale,
  punts,
  canWait,
  candidates,
  focusId,
  onInspect,
}: {
  view: DraftView;
  players: ApiPlayer[];
  scale: FitScale;
  punts: ReadonlySet<Category>;
  canWait: ReadonlySet<string>;
  candidates: ReadonlySet<string>;
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
    // `players` arrives sorted by Fit; re-sort only when sorting by value.
    return sortBy === "fit"
      ? shown
      : [...shown].sort((a, b) => (b.overall ?? 0) - (a.overall ?? 0));
  }, [players, query, pos, sortBy]);
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
        <strong>Fit</strong> (0–10) is how much a player helps your team at this pick, among the{" "}
        {view.fitWindow.size} players the draft expects to go around pick #{view.fitWindow.pick}{" "}
        (market rank up to #{view.fitWindow.maxRank}): the best of them scores 10, and it updates
        after every pick. The rest of the board is listed underneath — those players usually go
        later, so taking one now means passing up someone you can't get back.
        {view.nextUserPick != null && canWait.size > 0 && sortBy === "fit" && (
          <>
            {" "}Players likely still there at your next pick (#{view.nextUserPick}) are listed
            below the ones who won't be — take those first.
          </>
        )}{" "}
        <strong>Value</strong> (stars) is his price at the draft table — where drafters
        take him, weighing categories the way real drafts do (points and assists over
        steals or free throws): five stars is first-round quality. Fit starts from Value
        and moves with your roster: above it, he does more for the categories you're still
        fighting for; below it, his strengths are ones you've already settled.
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
              const waits = canWait.has(p.id);
              const later = !candidates.has(p.id);
              const prev = i > 0 ? arr[i - 1] : null;
              // Dividers (Fit order only): the first recommendation you can
              // wait on, and the first player outside this pick's range.
              const laterDivider = sortBy === "fit" && later && (!prev || candidates.has(prev.id));
              const waitDivider =
                sortBy === "fit" && !later && waits && (!prev || !canWait.has(prev.id));
              const cols = mode === "fit" ? 4 : 5 + CATEGORIES.length;
              return (
                <Fragment key={p.id}>
                  {waitDivider && (
                    <tr className="divider-row" aria-hidden="true">
                      <td colSpan={cols}>
                        Likely still there at #{view.nextUserPick} — you can wait on these
                      </td>
                    </tr>
                  )}
                  {laterDivider && (
                    <tr className="divider-row later" aria-hidden="true">
                      <td colSpan={cols}>
                        Usually drafted later than pick #{view.fitWindow.pick} — not recommended
                        yet; they'll be there in a round or two
                      </td>
                    </tr>
                  )}
                <tr
                  className={[p.id === focusId ? "focused" : "", later ? "later" : ""].join(" ").trim()}
                  onClick={() => onInspect(p.id)}
                >
                  <td className="left">
                    <button className="row-btn">
                      <Headshot player={p} variant="avatar" />
                      <span className="row-name">
                        <strong>{p.name}</strong>
                        <PlayerMeta player={p} />
                        {!later && lookaheadChip(view.gone[p.id], view.nextUserPick, sortBy === "fit")}
                        {later && sortBy !== "fit" && (
                          <span className="chip wait" title={`Usually drafted later than pick #${view.fitWindow.pick} — Fit isn't recommending him yet`}>later</span>
                        )}
                      </span>
                    </button>
                  </td>
                  <td className="left">
                    <span className={later ? "fit-cell later" : "fit-cell"}>
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

/** The look-ahead's verdict on a row. In Fit order the divider already
 * separates the sure cases, so only the coin flips get a chip there. */
function lookaheadChip(gone: number | undefined, nextPick: number | null, fitOrder: boolean) {
  if (gone === undefined || nextPick == null) return null;
  const pct = Math.round(gone * 100);
  if (gone > WAIT_SURE && gone < GONE_SURE) {
    return (
      <span className="chip" title={`Drafted before #${nextPick} in ${pct}% of look-ahead runs — a coin flip`}>
        {pct}% gone by #{nextPick}
      </span>
    );
  }
  if (fitOrder) return null;
  if (gone <= WAIT_SURE) {
    return (
      <span className="chip wait" title={`Still there at #${nextPick} in ${100 - pct}% of look-ahead runs`}>
        can wait
      </span>
    );
  }
  return null;
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
  isCandidate,
  scale,
  punts,
  onDraft,
  onClose,
}: {
  view: DraftView;
  player: ApiPlayer;
  isTop: boolean; // the top row of the table: the pick Fit recommends right now
  isCandidate: boolean; // inside this pick's range
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
  const strong = CATEGORIES.filter((c) => !punts.has(c) && !helps.includes(c) && z[c] >= 1.5);
  const locked = strong.filter((c) => view.settledCategories.ahead.includes(c));
  const outOfReach = strong.filter((c) => view.settledCategories.behind.includes(c));
  const hurts = CATEGORIES.filter((c) => !punts.has(c) && z[c] <= HURTS_Z);
  const fit = view.fit[player.id];
  const value = player.overall ?? 0;
  const last = player.name.split(" ").slice(1).join(" ") || player.name;
  const emptyRoster = view.rosters[view.userSlot].length === 0;
  const noShape = !emptyRoster && view.neededCategories.length === 0;

  let why: string;
  if (!isCandidate) {
    why = `Usually drafted around #${player.overallRank ?? "—"}, later than this pick (#${view.fitWindow.pick}), so Fit isn't recommending him yet: take a player who won't last, and come back for him.`;
    if (helps.length) why += ` He would add ${andList(helps)}.`;
  } else if (helps.length) {
    why = `${isTop ? "The pick Fit recommends right now. " : ""}He adds ${andList(helps)}, the ${helps.length > 1 ? "categories" : "category"} your team is still in the fight for.`;
  } else if (strong.length && emptyRoster) {
    why = `${isTop ? "The best player available. " : ""}Strong in ${andList(strong)}.`;
  } else if (strong.length && locked.length === strong.length) {
    why = `Strong in ${andList(strong)}, which you already have locked up — that's worth less to you than to the room.`;
  } else if (strong.length && outOfReach.length === strong.length) {
    why = `Strong in ${andList(strong)}, but you're too far back there for one pick to change it.`;
  } else if (strong.length) {
    why = `${isTop ? "The pick Fit recommends right now. " : ""}Strong in ${andList(strong)}.${noShape ? " Nothing is settled for your team yet, so that counts at his draft value." : ""}`;
  } else {
    why = isTop
      ? "The pick Fit recommends right now: solid across the board, with nothing your team has to fix."
      : "Solid across the board, but doesn't move the categories your team is fighting for.";
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
            <span className="fit-badge" title="Fit for your team on a 0–10 scale: 10 = best option at this pick, 0 = outside roughly the top 30">
              <strong>{fitScore(fit, scale).toFixed(1)}</strong>
              <span>fit / 10</span>
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
          {Math.abs(fit - value) > 0.25 && (
            <span className="muted small">
              {fit > value
                ? "Fit is above his draft value: your roster makes him worth more than his price — he moves categories you're still in the fight for."
                : "Fit is below his draft value: his strengths are in categories you've locked up, written off, or punt."}
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
        <span className="muted small">0 = average player · draft value {value.toFixed(1)}</span>
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
