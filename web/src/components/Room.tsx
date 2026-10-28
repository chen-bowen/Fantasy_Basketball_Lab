import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  api,
  CATEGORIES,
  type ApiPick,
  type ApiPlayer,
  type Category,
  type DraftView,
  type PreviewView,
} from "../api/client";
import { JUST_DRAFTED_MS, type BoardPrefs } from "../state/useSession";
import { andList, nextUserPickIndex, ordinal, teamBadgeWithRisk, teamName, teamPunts } from "../state/teams";
import {
  Headshot,
  PlayerMeta,
  Stars,
  ZStrip,
  fitScale,
  fitScore,
  rankTone,
  teamBackdrop,
  valueTier,
  type FitScale,
} from "./common";

interface Props {
  view: DraftView;
  playerMap: Map<string, ApiPlayer>;
  inspectedId: string | null;
  justDrafted: { playerId: string; pickIndex: number } | null;
  prefs: BoardPrefs;
  onPrefs: (patch: Partial<BoardPrefs>) => void;
  onInspect: (id: string | null) => void;
  onDismissJustDrafted: () => void;
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
/** Taken rows leave the board this long after the last pick, and only while you're not in the room. */
const PRUNE_MS = 600;

/**
 * The board as the table shows it. While the bots pick, the room holds the
 * board it settled on — order and Fit alike — and only marks players as
 * they go; it resettles when the clock comes back to you (or when you change
 * punts). Rows never reorder while you're reading them.
 */
interface Board {
  draftId: string | null;
  pickIndex: number; // picks from here on were made after the board settled
  puntsKey: string;
  rows: ApiPlayer[];
  fit: Record<string, number>;
  scale: FitScale;
  canWait: ReadonlySet<string>;
  candidates: ReadonlySet<string>;
  needed: ReadonlySet<Category>;
  nextUserPick: number | null;
  gone: Record<string, number>;
  fitWindow: DraftView["fitWindow"];
}

function computeBoard(view: DraftView, playerMap: Map<string, ApiPlayer>): Board {
  const lookahead = view.nextUserPick != null && Object.keys(view.gone).length > 0;
  const canWait = new Set(
    lookahead ? Object.keys(view.gone).filter((id) => view.gone[id] < GONE_THRESHOLD) : [],
  );
  // Who Fit recommends: the players the draft expects to go around this
  // pick. Everyone else is browsable but not a recommendation — he'll be
  // there later, and taking him now costs a player who won't be.
  const candidates = new Set(view.candidates);
  // Candidates first, sorted by Fit — but those who will still be there
  // next turn go below the ones who won't (Fit says who helps most, the
  // look-ahead says who you have to take now). Then the rest of the board
  // in market order.
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
  // The 0–10 scale is set by the candidates alone, sorted by raw Fit (the
  // display order is can't-wait first): 10 is the best recommendation at
  // this pick, not the best raw Fit on the whole board.
  const scale = fitScale(view.candidates.map((id) => view.fit[id]).sort((a, b) => b - a));
  return {
    draftId: view.id,
    pickIndex: view.pickIndex,
    puntsKey: view.userPunts.join(","),
    rows: [...picks, ...later],
    fit: view.fit,
    scale,
    canWait,
    candidates,
    needed: new Set(view.neededCategories),
    nextUserPick: view.nextUserPick,
    gone: view.gone,
    fitWindow: view.fitWindow,
  };
}

/** The panel's subject: on the board, gone to another team, or just yours. */
type SubjectStatus =
  | { kind: "live" }
  | { kind: "taken"; team: string; pick: number; round: number }
  | { kind: "yours"; pick: number; round: number };

export function DraftRoom({
  view, playerMap, inspectedId, justDrafted, prefs, onPrefs, onInspect, onDismissJustDrafted,
  onDraft, onTogglePunt, onAutoPunts, onBackToBuild,
}: Props) {
  const punts = useMemo(() => new Set<Category>(view.userPunts), [view.userPunts]);

  // --- the settled board (see Board) ---
  const live = useMemo(() => computeBoard(view, playerMap), [view, playerMap]);
  const [settled, setSettled] = useState(live);
  const frozen =
    !view.isUserTurn &&
    !view.complete &&
    settled.draftId === live.draftId &&
    settled.puntsKey === live.puntsKey &&
    live.pickIndex >= settled.pickIndex; // a rewind resettles
  const board = frozen ? settled : live;
  useEffect(() => {
    if (board !== settled) setSettled(board);
  }, [board, settled]);

  // Picks made since the board settled: those players stay in place, marked
  // taken, until a quiet moment prunes them.
  const taken = useMemo(() => {
    const m = new Map<string, ApiPick>();
    for (const p of view.picks) if (p.index >= board.pickIndex) m.set(p.playerId, p);
    return m;
  }, [view.picks, board.pickIndex]);
  const [prunedBefore, setPrunedBefore] = useState(0);
  const rows = useMemo(
    () => board.rows.filter((p) => (taken.get(p.id)?.index ?? Infinity) >= prunedBefore),
    [board.rows, taken, prunedBefore],
  );
  const unpruned = rows.some((p) => taken.has(p.id));

  // "In the room": pointer over the table or panel, or focus inside. No
  // pruning and no panel hand-offs while that's true.
  const [hover, setHover] = useState(false);
  const [focusWithin, setFocusWithin] = useState(false);
  const engaged = hover || focusWithin;
  const engagedRef = useRef(engaged);
  useEffect(() => {
    engagedRef.current = engaged;
  }, [engaged]);
  const scrollFix = useRef(0);
  useEffect(() => {
    if (!unpruned || engaged || view.isUserTurn) return;
    const t = setTimeout(() => {
      if (engagedRef.current) return;
      // Rows leaving above the viewport would shift what's in it: measure and compensate.
      let above = 0;
      document.querySelectorAll<HTMLTableRowElement>(".fit-table tr.taken").forEach((tr) => {
        const r = tr.getBoundingClientRect();
        if (r.bottom <= 0) above += r.height;
      });
      scrollFix.current = above;
      setPrunedBefore(view.pickIndex);
    }, PRUNE_MS);
    return () => clearTimeout(t);
  }, [unpruned, engaged, view.isUserTurn, view.pickIndex]);
  useLayoutEffect(() => {
    if (scrollFix.current) {
      window.scrollBy(0, -scrollFix.current);
      scrollFix.current = 0;
    }
  }, [prunedBefore]);

  // The player you just drafted stays in the panel for a moment.
  useEffect(() => {
    if (!justDrafted) return;
    const t = setTimeout(onDismissJustDrafted, JUST_DRAFTED_MS);
    return () => clearTimeout(t);
  }, [justDrafted, onDismissJustDrafted]);

  // --- the panel's subject: changes only by your action or at a settle point ---
  const pickOf = (id: string) => view.picks.find((p) => p.playerId === id);
  const statusFor = (pk: ApiPick | undefined): SubjectStatus =>
    !pk
      ? { kind: "live" }
      : pk.teamId === view.userSlot
        ? { kind: "yours", pick: pk.index + 1, round: pk.round }
        : { kind: "taken", team: teamName(view, pk.teamId), pick: pk.index + 1, round: pk.round };
  let subject: ApiPlayer | undefined;
  let status: SubjectStatus = { kind: "live" };
  if (justDrafted && !inspectedId && playerMap.has(justDrafted.playerId)) {
    subject = playerMap.get(justDrafted.playerId);
    status = statusFor(pickOf(justDrafted.playerId));
  } else if (inspectedId && playerMap.has(inspectedId)) {
    subject = playerMap.get(inspectedId);
    status = statusFor(pickOf(inspectedId));
  } else {
    subject = rows[0];
    if (subject) status = statusFor(taken.get(subject.id));
  }
  const topId = rows.find((p) => !taken.has(p.id))?.id ?? null;

  const nextMine = nextUserPickIndex(view, view.pickIndex);
  const watching =
    view.isUserTurn || view.complete
      ? null
      : {
          team: teamName(view, view.onClock ?? 0),
          away: nextMine === null ? null : nextMine - view.pickIndex,
          paused: view.status === "paused",
        };

  return (
    <>
      <BuildBanner
        view={view}
        punts={punts}
        onTogglePunt={onTogglePunt}
        onAutoPunts={onAutoPunts}
        onBackToBuild={onBackToBuild}
      />
      <main
        className="room"
        onPointerEnter={() => setHover(true)}
        onPointerLeave={() => setHover(false)}
        onFocus={(e) => {
          // Keyboard focus only: a row clicked with the mouse isn't being held.
          const t = e.target as Element;
          setFocusWithin(typeof t.matches === "function" ? t.matches(":focus-visible") : true);
        }}
        onBlur={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setFocusWithin(false);
        }}
      >
        <FitTable
          onHover={setHover}
          view={view}
          board={board}
          rows={rows}
          taken={taken}
          punts={punts}
          prefs={prefs}
          onPrefs={onPrefs}
          watching={watching !== null}
          focusId={subject?.id ?? null}
          onInspect={onInspect}
        />
        {subject && (
          <PlayerPanel
            view={view}
            board={board}
            player={subject}
            status={status}
            watching={watching}
            isTop={status.kind === "live" && subject.id === topId}
            topId={topId}
            punts={punts}
            detailOpen={prefs.detailOpen}
            onToggleDetail={(detailOpen) => onPrefs({ detailOpen })}
            onInspect={onInspect}
            onDraft={() => onDraft(subject!.id)}
            onClose={
              inspectedId || justDrafted
                ? () => {
                    onInspect(null);
                    onDismissJustDrafted();
                  }
                : null
            }
          />
        )}
        <TeamPanel view={view} playerMap={playerMap} justDraftedId={justDrafted?.playerId ?? null} />
      </main>
    </>
  );
}

/**
 * The build, on one line above the room: the punt, who's steering it, why,
 * and the controls to change it. The full explanation is the line's tooltip.
 */
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
  const why = [
    auto
      ? plan.reason
      : planDiffers
        ? `${plan.reason} (You're on manual — ${plan.punts.length ? `the roster would punt ${andList(plan.punts)}.` : "the roster would punt nothing."})`
        : plan.reason,
    needs.length
      ? `Fit counts ${andList(needs)} most — the categories you're still in the fight for.`
      : hasRoster
        ? "Nothing is settled yet, so Fit is close to draft value."
        : "Fit is draft value until your team has a shape.",
    hasRoster ? settledNote(view.settledCategories) : "",
  ]
    .filter(Boolean)
    .join(" ");
  return (
    <div className="room-bar-wrap">
      <section className="room-bar" aria-label="Your build">
        <span className="room-bar-build">
          <span className="room-bar-label">Your build</span>
          {punts.size ? (
            [...punts].map((c) => (
              <span key={c} className="chip dark">
                Punt {c}
              </span>
            ))
          ) : (
            <span className="chip dark">No punt</span>
          )}
          <span className="chip" title={auto ? "The punt follows your roster after every pick" : "Punts set by hand"}>
            {auto ? "follows your roster" : "set by hand"}
          </span>
        </span>
        <span className="room-bar-text" title={why}>
          {needs.length > 0 && (
            <>
              Needs <strong className="needed-key">{andList(needs)}</strong> ·{" "}
            </>
          )}
          {why}
        </span>
        <span className="room-bar-actions">
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
        </span>
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
function settledNote({ ahead, behind }: DraftView["settledCategories"]): string {
  if (!ahead.length && !behind.length) return "";
  const parts: string[] = [];
  if (ahead.length) parts.push(`${andList(ahead)} ${ahead.length > 1 ? "are" : "is"} locked up`);
  if (behind.length)
    parts.push(`${andList(behind)} ${behind.length > 1 ? "are" : "is"} too far back to chase with a pick`);
  return `It counts ${andList([...ahead, ...behind])} least: ${parts.join(", and ")}.`;
}

const POSITIONS = ["All", "G", "F", "C", "PG", "SG", "SF", "PF"];
const PAGE = 50;

function FitTable({
  view,
  board,
  rows: boardRows,
  taken,
  punts,
  prefs,
  onPrefs,
  watching,
  focusId,
  onInspect,
  onHover,
}: {
  view: DraftView;
  board: Board;
  rows: ApiPlayer[]; // the board, minus pruned rows
  taken: ReadonlyMap<string, ApiPick>; // drafted since the board settled: shown in place, marked
  punts: ReadonlySet<Category>;
  prefs: BoardPrefs;
  onPrefs: (patch: Partial<BoardPrefs>) => void;
  watching: boolean; // a bot is on the clock: the board is held
  focusId: string | null;
  onInspect: (id: string) => void;
  onHover: (over: boolean) => void; // pointer over the table: the board holds still
}) {
  const { mode, sortBy, query, pos, limit } = prefs;
  const { scale, canWait, candidates, needed } = board;

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    const shown = boardRows.filter(
      (p) =>
        (!q || p.name.toLowerCase().includes(q) || p.team.toLowerCase().includes(q)) &&
        (pos === "All" || p.positions.includes(pos)),
    );
    // The board arrives in Fit order; re-sort only when sorting by value.
    return sortBy === "fit"
      ? shown
      : [...shown].sort((a, b) => (b.overall ?? 0) - (a.overall ?? 0));
  }, [boardRows, query, pos, sortBy]);
  const sortHeader = (key: "fit" | "value", label: string) => (
    <button
      className={sortBy === key ? "sort-btn on" : "sort-btn"}
      aria-label={`Sort by ${label}`}
      onClick={() => onPrefs({ sortBy: key })}
    >
      {label}
      {sortBy === key && (
        <svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor" aria-hidden="true">
          <path d="M1 3h8L5 8z" />
        </svg>
      )}
    </button>
  );
  const colClass = (c: Category) =>
    punts.has(c) ? "cat-col punted" : needed.has(c) ? "cat-col needed" : "cat-col";

  return (
    <section
      className={watching ? "card table-card watching" : "card table-card"}
      onPointerEnter={() => onHover(true)}
      onPointerLeave={() => onHover(false)}
    >
      <div className="table-head">
        <h2 className="table-title">Available players</h2>
        <label className="search">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
            <circle cx="7" cy="7" r="5" />
            <path d="M11 11l3.5 3.5" />
          </svg>
          <input
            aria-label="Search players"
            placeholder="Search players"
            value={query}
            onChange={(e) => onPrefs({ query: e.target.value })}
          />
        </label>
        <select aria-label="Position" value={pos} onChange={(e) => onPrefs({ pos: e.target.value })}>
          {POSITIONS.map((p) => (
            <option key={p} value={p}>{p === "All" ? "All positions" : p}</option>
          ))}
        </select>
        <div className="seg" role="group" aria-label="Table view">
          <button aria-pressed={mode === "fit"} onClick={() => onPrefs({ mode: "fit" })}>Fit</button>
          <button aria-pressed={mode === "numbers"} onClick={() => onPrefs({ mode: "numbers" })}>Numbers</button>
        </div>
        <details className="info">
          <summary aria-label="How Fit and Value work" title="How Fit and Value work">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
              <circle cx="8" cy="8" r="6.5" />
              <path d="M8 7v4.5M8 4.8v.4" strokeLinecap="round" />
            </svg>
          </summary>
          <div className="popover">
            <p>
              <strong>Fit</strong> (0–10) is how much a player helps your team at this pick, among the{" "}
              {board.fitWindow.size} players the draft expects to go around pick #{board.fitWindow.pick}{" "}
              (market rank up to #{board.fitWindow.maxRank}): the best of them scores 10, and it updates
              after every pick. The rest of the board is listed underneath — those players usually go
              later, so taking one now means passing up someone you can't get back.
              {board.nextUserPick != null && canWait.size > 0 && sortBy === "fit" && (
                <>
                  {" "}Players likely still there at your next pick (#{board.nextUserPick}) are listed
                  below the ones who won't be — take those first.
                </>
              )}
            </p>
            <p>
              <strong>Value</strong> (stars) is his price at the draft table — where drafters
              take him, weighing categories the way real drafts do (points and assists over
              steals or free throws): five stars is first-round quality. Fit starts from Value
              and moves with your roster: above it, he does more for the categories you're still
              fighting for; below it, his strengths are ones you've already settled.
              {punts.size > 0 && ` Fit leaves out ${andList([...punts])} because you punt ${punts.size > 1 ? "them" : "it"}.`}
            </p>
          </div>
        </details>
        {watching && (
          <span className="chip hold" title="Order and Fit are held while the bots pick; players are marked as they go">
            Board held — refreshes when you're up
          </span>
        )}
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
              const score = fitScore(board.fit[p.id], scale);
              const tier = valueTier(p.overallRank);
              const waits = canWait.has(p.id);
              const later = !candidates.has(p.id);
              const gone = taken.get(p.id);
              const prev = i > 0 ? arr[i - 1] : null;
              // Group headers (Fit order only): take now, can wait, and the
              // players outside this pick's range.
              const group = later ? "later" : waits ? "wait" : "now";
              const prevGroup = prev ? (!candidates.has(prev.id) ? "later" : canWait.has(prev.id) ? "wait" : "now") : null;
              const groupStart = sortBy === "fit" && group !== prevGroup;
              const cols = mode === "fit" ? 4 : 5 + CATEGORIES.length;
              const cls = [
                p.id === focusId ? "focused" : "",
                later ? "later" : "",
                gone ? "taken" : "",
              ].join(" ").trim();
              return (
                <Fragment key={p.id}>
                  {groupStart && (
                    <tr className={`group-row ${group}`} aria-hidden="true">
                      <td colSpan={cols}>
                        {group === "now" ? (
                          <>
                            <strong>{board.nextUserPick != null && canWait.size > 0 ? "Take now" : "Recommended at this pick"}</strong>
                            {board.nextUserPick != null && canWait.size > 0 && <span>won't last to your next pick (#{board.nextUserPick})</span>}
                          </>
                        ) : group === "wait" ? (
                          <>
                            <strong>Can wait</strong>
                            <span>likely still there at #{board.nextUserPick}</span>
                          </>
                        ) : (
                          <>
                            <strong>Later</strong>
                            <span>usually drafted after pick #{board.fitWindow.pick} — they'll be there in a round or two</span>
                          </>
                        )}
                      </td>
                    </tr>
                  )}
                <tr
                  className={cls}
                  onClick={() => onInspect(p.id)}
                >
                  <td className="left">
                    <button className="row-btn">
                      <Headshot player={p} variant="avatar" />
                      <span className="row-name">
                        <strong>{p.name}</strong>
                        <PlayerMeta player={p} />
                        {!gone && !later && lookaheadChip(board.gone[p.id], board.nextUserPick, sortBy === "fit")}
                        {!gone && later && sortBy !== "fit" && (
                          <span className="chip wait" title={`Usually drafted later than pick #${board.fitWindow.pick} — Fit isn't recommending him yet`}>later</span>
                        )}
                      </span>
                    </button>
                  </td>
                  <td className="left">
                    {gone ? (
                      <span
                        className="chip taken-chip"
                        title={`Drafted by ${teamName(view, gone.teamId)} at #${gone.index + 1}`}
                      >
                        Taken · {gone.teamId === view.userSlot ? "you" : teamName(view, gone.teamId)} · #{gone.index + 1}
                      </span>
                    ) : (
                      <span className={later ? "fit-cell later" : "fit-cell"}>
                        <strong>{score.toFixed(1)}</strong>
                        {mode === "fit" && (
                          <span className="meter dark">
                            <span style={{ width: `${score * 10}%` }} />
                          </span>
                        )}
                      </span>
                    )}
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
          <button className="btn" onClick={() => onPrefs({ limit: limit + PAGE })}>
            Show {Math.min(PAGE, rows.length - limit)} more
          </button>
        </div>
      )}
      {mode === "fit" && (
        <div className="legend table-legend">
          <span><i className="sq top" />Big help</span>
          <span><i className="sq good" />Helps</span>
          <span><i className="sq avg" />Average</span>
          <span><i className="sq low" />Hurts</span>
          <span><i className="sq bottom" />Hurts a lot</span>
          <span><strong className="needed-key">Blue</strong> = category you need</span>
        </div>
      )}
    </section>
  );
}

/** The look-ahead's verdict on a row. In Fit order the divider already
 * separates the sure cases, so only the coin flips get a chip there; the
 * panel (`always`) shows every case, in the same words as the table. */
function lookaheadChip(
  gone: number | undefined,
  nextPick: number | null,
  fitOrder: boolean,
  always = false,
) {
  if (gone === undefined || nextPick == null) return null;
  const pct = Math.round(gone * 100);
  if (gone > WAIT_SURE && gone < GONE_SURE) {
    return (
      <span className="chip" title={`Drafted before #${nextPick} in ${pct}% of look-ahead runs — a coin flip`}>
        {pct}% gone by #{nextPick}
      </span>
    );
  }
  if (fitOrder && !always) return null;
  if (gone <= WAIT_SURE) {
    return (
      <span className="chip wait" title={`Still there at #${nextPick} in ${100 - pct}% of look-ahead runs — you can wait on him`}>
        can wait
      </span>
    );
  }
  if (!always) return null;
  return gone >= 0.99 ? (
    <span className="chip gone" title={`Gone before your next pick (#${nextPick}) in every look-ahead run — now or never`}>
      now or never
    </span>
  ) : (
    <span className="chip gone" title={`Gone before your next pick (#${nextPick}) in ${pct}% of look-ahead runs`}>
      {pct}% gone by #{nextPick}
    </span>
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

/** One sentence on the player, and the longer version it stands for (hover). */
interface Verdict {
  line: string;
  detail: string;
}

/**
 * The panel's one line. It says *why* Fit rates him where it does — the
 * categories themselves are the chip rows underneath, so the line never
 * lists them. `detail` is the full explanation, kept as the tooltip.
 */
function verdictFor(args: {
  view: DraftView;
  player: ApiPlayer;
  isTop: boolean;
  isCandidate: boolean;
  helps: Category[];
  strong: Category[];
  locked: Category[];
  outOfReach: Category[];
}): Verdict {
  const { view, player, isTop, isCandidate, helps, strong, locked, outOfReach } = args;
  const emptyRoster = view.rosters[view.userSlot].length === 0;
  const noShape = !emptyRoster && view.neededCategories.length === 0;
  const topLong = isTop ? "The pick Fit recommends right now. " : "";
  // "Fit's pick: moves …" on the top row, "Moves …" elsewhere.
  const lead = (text: string) =>
    isTop ? `Fit's pick: ${text}` : text.charAt(0).toUpperCase() + text.slice(1);
  if (!isCandidate) {
    const rank = player.overallRank != null ? `~#${player.overallRank}` : "later";
    return {
      line: `Usually goes ${rank} — he'll be there later; take someone who won't.`,
      detail:
        `Usually drafted around #${player.overallRank ?? "—"}, later than this pick (#${view.fitWindow.pick}), so Fit isn't recommending him yet: take a player who won't last, and come back for him.` +
        (helps.length ? ` He would add ${andList(helps)}.` : ""),
    };
  }
  if (helps.length) {
    return {
      line: lead("moves the categories you're still fighting for."),
      detail: `${topLong}He adds ${andList(helps)}, the ${helps.length > 1 ? "categories" : "category"} your team is still in the fight for.`,
    };
  }
  if (strong.length && emptyRoster) {
    return {
      line: isTop
        ? "Best player available — value is all that counts until you have a roster."
        : "Value is all that counts until you have a roster.",
      detail: `${isTop ? "The best player available. " : ""}Strong in ${andList(strong)}.`,
    };
  }
  if (strong.length && locked.length === strong.length) {
    return {
      line: "Strong where you're already locked up — worth less to you than to the room.",
      detail: `Strong in ${andList(strong)}, which you already have locked up — that's worth less to you than to the room.`,
    };
  }
  if (strong.length && outOfReach.length === strong.length) {
    return {
      line: "Strong where you're too far back for one pick to matter.",
      detail: `Strong in ${andList(strong)}, but you're too far back there for one pick to change it.`,
    };
  }
  if (strong.length) {
    return {
      line: lead(
        noShape
          ? "strong in spots; nothing is settled yet, so that counts at his draft value."
          : "strong where it still counts for you.",
      ),
      detail: `${topLong}Strong in ${andList(strong)}.${noShape ? " Nothing is settled for your team yet, so that counts at his draft value." : ""}`,
    };
  }
  return isTop
    ? {
        line: "Fit's pick: solid everywhere, nothing to fix.",
        detail: "The pick Fit recommends right now: solid across the board, with nothing your team has to fix.",
      }
    : {
        line: "Solid everywhere, but doesn't move what you're fighting for.",
        detail: "Solid across the board, but doesn't move the categories your team is fighting for.",
      };
}

function PlayerPanel({
  view,
  board,
  player,
  status,
  watching,
  isTop,
  topId,
  punts,
  detailOpen,
  onToggleDetail,
  onInspect,
  onDraft,
  onClose,
}: {
  view: DraftView;
  board: Board;
  player: ApiPlayer;
  status: SubjectStatus;
  watching: { team: string; away: number | null; paused: boolean } | null; // a bot is on the clock
  isTop: boolean; // the top row of the table: the pick Fit recommends right now
  topId: string | null; // Fit's pick right now, for the hand-off link when he's gone
  punts: ReadonlySet<Category>;
  detailOpen: boolean; // the per-category section; remembered across players
  onToggleDetail: (open: boolean) => void;
  onInspect: (id: string) => void;
  onDraft: () => void;
  onClose: (() => void) | null;
}) {
  const z = player.z ?? ({} as Record<Category, number>);
  const tier = valueTier(player.overallRank);
  const onBoard = status.kind === "live";
  const isCandidate = board.candidates.has(player.id);
  const [preview, setPreview] = useState<{
    playerId: string;
    pickIndex: number;
    data: PreviewView;
  } | null>(null);
  useEffect(() => {
    // No preview for a player who's gone: the panel keeps his last one.
    if (!view.id || !onBoard) return;
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
  }, [view.id, view.pickIndex, player.id, onBoard]);

  const helps = view.neededCategories.filter((c) => z[c] > HELPS_Z);
  const strong = CATEGORIES.filter((c) => !punts.has(c) && !helps.includes(c) && z[c] >= 1.5);
  const locked = strong.filter((c) => view.settledCategories.ahead.includes(c));
  const outOfReach = strong.filter((c) => view.settledCategories.behind.includes(c));
  const hurts = CATEGORIES.filter((c) => !punts.has(c) && z[c] <= HURTS_Z);
  const fit = board.fit[player.id];
  const hasFit = fit !== undefined;
  const value = player.overall ?? 0;
  const last = lastNameOf(player);
  const verdict = verdictFor({ view, player, isTop, isCandidate, helps, strong, locked, outOfReach });
  const topPlayer = topId && topId !== player.id ? board.rows.find((p) => p.id === topId) : null;

  // Fit against his price: a glyph on the badge, the sentence on hover.
  const fitGap = hasFit && Math.abs(fit - value) > 0.25 ? (fit > value ? "above" : "below") : null;
  const fitTitle =
    "Fit for your team on a 0–10 scale: 10 = best option at this pick, 0 = outside roughly the top 30." +
    (fitGap === "above"
      ? " Fit is above his draft value: your roster makes him worth more than his price — he moves categories you're still in the fight for."
      : fitGap === "below"
        ? " Fit is below his draft value: his strengths are in categories you've locked up, written off, or punt."
        : "");

  // Price: value, and where drafters take him relative to this pick.
  let adpNote = "";
  if (player.adp != null) {
    adpNote = `ADP ${player.adp.toFixed(1)}`;
    if (view.isUserTurn) {
      const gap = Math.round(view.pickIndex + 1 - player.adp);
      adpNote +=
        Math.abs(gap) <= 3
          ? " — goes right around this pick"
          : gap > 0
            ? ` — usually goes ~${gap} picks earlier`
            : ` — usually goes ~${-gap} picks later`;
    }
  }
  const valueTitle = [`${tier.label} · value ${value.toFixed(1)}`, adpNote].filter(Boolean).join(" · ");

  // Look-ahead, in the table's chip language.
  const backToBack = board.nextUserPick != null && board.nextUserPick === view.pickIndex + 2;
  const lookahead = backToBack ? (
    <span className="chip wait" title={`You pick again right after this one (#${board.nextUserPick})`}>
      you pick next
    </span>
  ) : (
    lookaheadChip(board.gone[player.id], board.nextUserPick, false, true)
  );

  // Availability and games played, on one line; the full story on hover.
  const seasons = Object.entries(player.gpBySeason ?? {});
  const avail = player.availability;
  const availPct = avail != null ? Math.round(avail * 100) : null;
  const availLine = [
    availPct != null ? `Plays ~${availPct}% of games` : null,
    seasons.length ? `GP ${seasons.map(([, g]) => g).join(" / ")}` : `GP ${player.gp}`,
  ]
    .filter(Boolean)
    .join(" · ");
  const availTitle =
    (seasons.length
      ? `Games played: ${seasons.map(([s, g]) => `'${s.slice(2)} ${g}`).join(" · ")}`
      : `${player.gp} games in ${player.asOfSeason}`) +
    (avail != null
      ? ` — ${player.injury ? `listed ${player.injury}, ` : ""}expected to play about ${availPct}% of games` +
        (avail < 0.65
          ? ", which lowers his value a lot"
          : avail < 0.8
            ? ", which lowers his value"
            : "")
      : "");
  const availTone = avail != null && avail < 0.65 ? "avail-low" : avail != null && avail < 0.8 ? "avail-mid" : "muted";

  // The action slot: the draft button on your turn, otherwise the room's
  // state in its place — never a disabled button.
  let action;
  if (status.kind === "taken" && !watching && onClose) {
    // It's your pick and he's gone: the slot hands you back to the board.
    action = (
      <button className="btn outline-accent xl" onClick={onClose}>
        Back to the board{topPlayer ? ` · Fit's pick: ${lastNameOf(topPlayer)}` : ""}
      </button>
    );
  } else if (status.kind === "taken") {
    action = (
      <div className="panel-state taken" role="status">
        <strong>Drafted by {status.team} at #{status.pick}</strong>
        <span>Round {status.round} · no longer on the board</span>
      </div>
    );
  } else if (status.kind === "yours") {
    action = (
      <div className="panel-state yours" role="status">
        <strong>Yours at #{status.pick}</strong>
        <span>Your round-{status.round} pick · he's on your roster below</span>
      </div>
    );
  } else if (watching) {
    action = (
      <div className="panel-state watching" role="status">
        <strong>{watching.paused ? "Paused" : `${watching.team} picking`}</strong>
        <span>
          {watching.paused
            ? `${watching.team} on the clock`
            : watching.away === null
              ? "Your picks are in"
              : `You're up in ${watching.away} pick${watching.away === 1 ? "" : "s"}`}
        </span>
      </div>
    );
  } else {
    action = (
      <button className="btn primary xl" onClick={onDraft}>
        Draft {last}
      </button>
    );
  }

  const livePreview =
    onBoard && preview?.playerId === player.id && preview.pickIndex === view.pickIndex ? preview.data : null;

  return (
    <section className={`card player-panel ${status.kind}`}>
      <div className="panel-scroll">
        <div className="panel-photo" style={teamBackdrop(player.team)}>
          <Headshot player={player} variant="tile" />
          {status.kind !== "live" ? (
            <span className={`panel-tag ${status.kind}`}>
              {status.kind === "taken" ? `Taken · ${status.team}` : "Yours"}
            </span>
          ) : (
            onBoard && lookahead && <span className="panel-tag look">{lookahead}</span>
          )}
          {onClose && (
            <button className="icon-btn" aria-label={onBoard ? "Back to top fit" : "Back to the board"} onClick={onClose}>
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                <path d="M3 3l10 10M13 3L3 13" />
              </svg>
            </button>
          )}
        </div>
        <div className="panel-body">
          <div className="panel-id-row">
            <div className="panel-id">
              <h3 className="panel-name clamp" title={player.name}>{player.name}</h3>
              <span className="muted clamp">
                <PlayerMeta player={player} />
              </span>
            </div>
            {onBoard && hasFit ? (
              <span className="fit-badge" title={fitTitle}>
                <strong>
                  {fitScore(fit, board.scale).toFixed(1)}
                  {fitGap && (
                    <span className={`fit-gap ${fitGap}`} aria-label={`Fit ${fitGap} draft value`}>
                      {fitGap === "above" ? "▲" : "▼"}
                    </span>
                  )}
                </strong>
                <span>fit / 10</span>
              </span>
            ) : (
              <span className="fit-badge off" title={onBoard ? "Not in this pick's Fit window" : "Off the board — Fit no longer applies"}>
                <strong>—</strong>
                <span>fit / 10</span>
              </span>
            )}
          </div>
          <div className="panel-sub">
            <span className="value-cell" title={valueTitle}>
              <Stars count={tier.stars} />
              <span className="muted small">
                {tier.label}
                {player.overallRank != null ? ` · #${player.overallRank}` : ""}
              </span>
            </span>
            <span className={`small clamp ${availTone}`} title={availTitle}>{availLine}</span>
          </div>
          {status.kind === "taken" ? (
            <p className="verdict">
              Off the board — {status.team} took him at #{status.pick}.{" "}
              {topPlayer && (
                <button className="link-btn inline" onClick={() => onInspect(topPlayer.id)}>
                  Fit's pick now: {topPlayer.name}
                </button>
              )}
            </p>
          ) : status.kind === "yours" ? (
            <p className="verdict">
              On your team as your round-{status.round} pick.{" "}
              {helps.length ? `He brings ${andList(helps)}.` : strong.length ? `Strong in ${andList(strong)}.` : ""}
            </p>
          ) : (
            <p className="verdict" title={verdict.detail}>{verdict.line}</p>
          )}
          <div className="chip-row">
            <span className="chip-row-label">Fills a need</span>
            {helps.length ? (
              helps.map((c) => (
                <span key={c} className="chip blue" title={`${c} ${fmtZ(z[c])} vs. an average player`}>{c}</span>
              ))
            ) : (
              <span className="muted small">None</span>
            )}
          </div>
          <div className="chip-row">
            <span className="chip-row-label">Costs you</span>
            {hurts.length ? (
              hurts.map((c) => (
                <span key={c} className="chip orange-soft" title={`${c} ${fmtZ(z[c])} vs. an average player`}>{c}</span>
              ))
            ) : (
              <span className="muted small">Nothing major</span>
            )}
          </div>
          {onBoard && <RankMoves preview={livePreview} punts={punts} />}
          <details
            className="panel-detail"
            open={detailOpen}
            onToggle={(e) => onToggleDetail((e.currentTarget as HTMLDetailsElement).open)}
          >
            <summary>
              <span>Category detail</span>
              <span className="muted small">his value · your ranks with him</span>
            </summary>
            {player.z && (
              <CategoryDetail
                z={player.z}
                value={value}
                punts={punts}
                needed={new Set(view.neededCategories)}
                preview={livePreview}
                inert={!onBoard}
              />
            )}
          </details>
        </div>
      </div>
      <div className="panel-action">{action}</div>
    </section>
  );
}

/** Your category ranks before → after drafting him, as a 3×3 grid of tiles. */
function RankMoves({ preview, punts }: { preview: PreviewView | null; punts: ReadonlySet<Category> }) {
  const hasBefore = (preview?.before.size ?? 0) > 0;
  return (
    <div className="rank-moves-wrap">
      <div className="rank-moves" aria-label="Your category ranks with him">
        {CATEGORIES.map((c) => {
          const r = preview?.ranks?.[c];
          const punted = punts.has(c);
          const moved = r && hasBefore ? r.before - r.after : 0;
          const tone = punted ? "punted" : moved > 0 ? "up" : moved < 0 ? "down" : "flat";
          return (
            <span key={c} className={`rank-move ${tone}`}>
              <span className="rank-move-cat">{c}{punted ? " · punt" : ""}</span>
              <span className="rank-move-val">
                {r ? (
                  hasBefore ? (
                    <>
                      <span className="muted">{ordinal(r.before)}</span> → <strong>{ordinal(r.after)}</strong>
                    </>
                  ) : (
                    <strong>{ordinal(r.after)}</strong>
                  )
                ) : (
                  <span className="muted">…</span>
                )}
              </span>
            </span>
          );
        })}
      </div>
      <span className="muted small">Your rank in each category among the league{hasBefore ? ", before → with him" : ", with him"}</span>
    </div>
  );
}

function lastNameOf(p: ApiPlayer): string {
  return p.name.split(" ").slice(1).join(" ") || p.name;
}

function fmtZ(v: number): string {
  return `${v >= 0 ? "+" : "−"}${Math.abs(v).toFixed(1)}`;
}

const BAR_MAX_Z = 3; // bars are scaled to ±3; larger scores fill the bar

/**
 * One row per category: where his value comes from (score vs. an average
 * player, centred on 0) and where your team would rank with him added.
 */
function CategoryDetail({
  z,
  value,
  punts,
  needed,
  preview,
  inert = false,
}: {
  z: Record<Category, number>;
  value: number;
  punts: ReadonlySet<Category>;
  needed: ReadonlySet<Category>;
  preview: PreviewView | null;
  inert?: boolean; // he's off the board: no "your rank with him"
}) {
  const hasBefore = (preview?.before.size ?? 0) > 0;
  return (
    <div className="catdetail">
      <div className="catdetail-key muted small">
        <span>0 = average player · value {value.toFixed(1)}</span>
        <span>your rank</span>
      </div>
      {CATEGORIES.map((c) => {
        const v = z[c];
        const width = (Math.min(Math.abs(v), BAR_MAX_Z) / BAR_MAX_Z) * 50;
        const r = preview?.ranks?.[c];
        const moved = r && hasBefore ? r.before - r.after : 0;
        const cls = punts.has(c) ? "catdetail-row punted" : needed.has(c) ? "catdetail-row needed" : "catdetail-row";
        return (
          <div key={c} className={cls}>
            <span className="rank-cat">{c}</span>
            <span className="diverge" aria-hidden="true">
              <span
                className={v >= 0 ? "diverge-bar pos" : "diverge-bar neg"}
                style={v >= 0 ? { left: "50%", width: `${width}%` } : { right: "50%", width: `${width}%` }}
              />
            </span>
            <span className={v >= 0 ? "breakdown-val pos" : "breakdown-val neg"}>{fmtZ(v)}</span>
            <span className="impact-move">
              {r ? (
                <>
                  <span>{hasBefore ? ordinal(r.before) : "—"}</span>
                  <span className="impact-arrow" aria-hidden="true">→</span>
                  <strong className={rankTone(r.after)}>{ordinal(r.after)}</strong>
                </>
              ) : (
                <span className="muted">{inert ? "—" : "…"}</span>
              )}
            </span>
            <span className={moved > 0 ? "impact-delta up" : moved < 0 ? "impact-delta down" : "impact-delta flat"}>
              {moved > 0 ? `+${moved}` : moved < 0 ? moved : "—"}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function TeamPanel({
  view,
  playerMap,
  justDraftedId,
}: {
  view: DraftView;
  playerMap: Map<string, ApiPlayer>;
  justDraftedId: string | null; // your newest pick: his roster row is lit for a moment
}) {
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
          <li key={p.id} className={isYou && p.id === justDraftedId ? "just-drafted" : undefined}>
            <span className="muted small rd">Rd {i + 1}</span>
            <Headshot player={p} variant="avatar" />
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
