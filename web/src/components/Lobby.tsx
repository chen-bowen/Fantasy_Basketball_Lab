import { useEffect, useState } from "react";
import { api, type RivalView, type SessionSummary, type ResultSummary } from "../api/client";
import { seatPicks, squadBadge, squadName, squadLean } from "../state/squads";
import { Logo } from "./ui";

interface Props {
  playerCount: number;
  savedSessions: SessionSummary[];
  results: ResultSummary[];
  onStart: (seed: string, seat: number) => void;
  onResume: (sessionId: string) => void;
  onOpenResult: (resultId: string) => void;
}

const NUM_TEAMS = 12;
const PREVIEW_ROUNDS = 3;

function randomSeed() {
  return Math.random().toString(36).slice(2, 8);
}

/** How long a slot waits between its first picks, in plain words. */
function waitText(picks: number[]): string {
  const [w1, w2] = [picks[1] - picks[0], picks[2] - picks[1]];
  if (w1 === 1) return `Two picks back to back at the turn, then a ${w2}-pick wait.`;
  if (w2 === 1) return `A ${w1}-pick wait, then two back to back at the turn.`;
  return `A ${w1}-pick wait after your first, then ${w2}.`;
}

function RoundArrow({ back }: { back: boolean }) {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
      <path d={back ? "M10 6H2M5 3L2 6l3 3" : "M2 6h8M7 3l3 3-3 3"} />
    </svg>
  );
}

export function Lobby({
  playerCount,
  savedSessions,
  results,
  onStart,
  onResume,
  onOpenResult,
}: Props) {
  const [slot, setSlot] = useState<number | null>(null);
  const [freshSeed, setFreshSeed] = useState(randomSeed); // the league you get with no code
  const [code, setCode] = useState(""); // a pasted replay code, if any
  const seed = code.trim() || freshSeed;
  const [rivals, setBots] = useState<RivalView[] | null>(null);

  const canStart = slot !== null;
  const resumable = savedSessions
    .filter((d) => d.selections > 0 && d.status !== "complete")
    .sort((a, b) => b.updatedAt - a.updatedAt);
  const latest = resumable[0];
  const picks = slot !== null ? seatPicks(slot, NUM_TEAMS, PREVIEW_ROUNDS) : null;

  // Opponent preview: rival personalities are a pure function of seed + slot.
  useEffect(() => {
    if (slot === null || !seed) {
      setBots(null);
      return;
    }
    const t = setTimeout(() => {
      api.league(seed, slot).then((r) => setBots(r.rivals)).catch(() => setBots(null));
    }, 250);
    return () => clearTimeout(t);
  }, [seed, slot]);

  return (
    <div className="page">
      <header className="setup-header">
        <Logo />
      </header>
      <main className="setup">
        <div className="setup-intro">
          <div className="stack">
            <span className="setup-eyebrow">Category-league mock session</span>
            <h1 className="display">Draft against 11 rivals. Watch your build take shape.</h1>
            <p className="lede">
              Pick a slot and a league of opponents. In round 1 you choose a build, a first
              pick plus the category it lets you concede. After that, every recommendation
              follows what your team still needs.
            </p>
          </div>

          <dl className="setup-facts">
            <div><dt>12</dt><dd>teams, you and 11 rivals</dd></div>
            <div><dt>13</dt><dd>rounds, snake order</dd></div>
            <div><dt>9-cat</dt><dd>head-to-head scoring</dd></div>
            <div><dt>{playerCount || "—"}</dt><dd>players in the pool</dd></div>
          </dl>

          <ol className="setup-steps">
            <li>
              <span className="step-n">1</span>
              <span><strong>Pick a slot.</strong> Early slots get a star, late slots get two picks back to back.</span>
            </li>
            <li>
              <span className="step-n">2</span>
              <span><strong>Choose a build.</strong> Your first pick and a category to concede, side by side.</span>
            </li>
            <li>
              <span className="step-n">3</span>
              <span><strong>Draft to fit.</strong> The room ranks who's in range by what your roster needs.</span>
            </li>
          </ol>

          {latest && (
            <section className="card resume-card">
              <div className="resume-icon" aria-hidden="true">
                <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M4 10a6 6 0 1 0 2-4.5M4 3v3.5h3.5" />
                </svg>
              </div>
              <div className="resume-text">
                <strong>Pick up where you left off</strong>
                <span className="muted">
                  {latest.selections} picks made · saved{" "}
                  {new Date(latest.updatedAt).toLocaleTimeString([], {
                    hour: "numeric",
                    minute: "2-digit",
                  })}
                </span>
              </div>
              <button className="btn outline" onClick={() => onResume(latest.id)}>
                Resume session
              </button>
            </section>
          )}
        </div>

        <section className="card setup-card" aria-label="New session">
          <div className="setup-section">
            <div className="setup-section-head">
              <div className="stack-xs grow">
                <span className="step-label">Step 1</span>
                <h2 className="title">Choose your session slot</h2>
              </div>
              <button
                className="btn soft"
                onClick={() => setSlot(Math.floor(Math.random() * NUM_TEAMS))}
              >
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
                  <rect x="2" y="2" width="12" height="12" rx="3" />
                  <circle cx="5.5" cy="5.5" r="0.7" fill="currentColor" />
                  <circle cx="8" cy="8" r="0.7" fill="currentColor" />
                  <circle cx="10.5" cy="10.5" r="0.7" fill="currentColor" />
                </svg>
                Random slot
              </button>
            </div>

            <div className="slot-scroll">
              <div className="slot-grid" role="group" aria-label="Draft slot">
                <span className="slot-axis" style={{ gridRow: 1 }}>Slot</span>
                {Array.from({ length: PREVIEW_ROUNDS }, (_, r) => (
                  <span key={r} className="slot-axis" style={{ gridRow: r + 2 }}>
                    Rd {r + 1} <RoundArrow back={r % 2 === 1} />
                  </span>
                ))}
                {Array.from({ length: NUM_TEAMS }, (_, i) => {
                  const p = seatPicks(i, NUM_TEAMS, PREVIEW_ROUNDS);
                  return (
                    <button
                      key={i}
                      className={slot === i ? "slot selected" : "slot"}
                      style={{ gridColumn: i + 2 }}
                      aria-pressed={slot === i}
                      aria-label={`Slot ${i + 1}, picks ${p.join(", ")}`}
                      onClick={() => setSlot(i)}
                    >
                      <span className="slot-n">{i + 1}</span>
                      {p.map((n) => (
                        <span key={n} className="slot-pick">#{n}</span>
                      ))}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="slot-summary">
              {picks ? (
                <>
                  <strong>Slot {slot! + 1}</strong>
                  <span>
                    picks {picks.map((n) => `#${n}`).join(", ")}. {waitText(picks)}
                  </span>
                </>
              ) : (
                <span className="muted">
                  Snake order: round 2 results backward, so the last slot in round 1 picks
                  first in round 2.
                </span>
              )}
            </div>
          </div>

          <div className="setup-section">
            <div className="setup-section-head">
              <div className="stack-xs grow">
                <span className="step-label">Step 2</span>
                <h2 className="title">Your opponents</h2>
              </div>
              <button
                className="btn"
                onClick={() => {
                  setFreshSeed(randomSeed());
                  setCode("");
                }}
              >
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
                  <path d="M2 4h3c3 0 3 8 6 8h3M12 10l2 2-2 2M2 12h3c1 0 1.6-.9 2.2-2M14 4h-3c-1 0-1.6.9-2.2 2M12 2l2 2-2 2" />
                </svg>
                Shuffle opponents
              </button>
            </div>

            {slot === null ? (
              <span className="muted">Choose a slot to see who you're drafting against.</span>
            ) : rivals ? (
              <ul className="opponents">
                {rivals.map((b, t) => {
                  if (t === slot) return null;
                  const league = { seat: slot, rivals: rivals };
                  const risk = squadLean(league, t);
                  return (
                    <li key={t} className="opponent">
                      <span className="opponent-slot">{t + 1}</span>
                      <strong className="grow">{squadName(league, t)}</strong>
                      <span className={`badge ${b.style}`}>{squadBadge(league, t)}</span>
                      {risk && (
                        <span
                          className={`kind risk ${b.lean}`}
                          title={
                            b.lean === "bold"
                              ? "Shrugs off half of the injury-risk discount — gambles on hurt stars"
                              : "Adds half again to the injury-risk discount — steers clear of hurt players"
                          }
                        >
                          {risk}
                        </span>
                      )}
                    </li>
                  );
                })}
              </ul>
            ) : (
              <span className="muted">Loading opponents…</span>
            )}
            <p className="muted small setup-key">
              <strong className="key-value">Value</strong> rivals take the best player left.{" "}
              <strong className="key-needs">Needs</strong> rivals fill their weakest categories.{" "}
              <strong className="key-concede">Concede</strong> rivals ignore one.{" "}
              <strong>Bold</strong> rivals gamble on injured stars; <strong>cautious</strong> ones
              steer clear.
            </p>
          </div>

          <div className="setup-section">
            <details className="replay">
              <summary>
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
                  <path d="M5 3l4 4-4 4" />
                </svg>
                Same league again? <span className="muted">Paste a session code</span>
              </summary>
              <div className="stack-sm replay-body">
                <label htmlFor="seed" className="small ink">Draft code</label>
                <input
                  id="seed"
                  className="mono"
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  placeholder="Leave blank for a fresh league"
                  spellCheck={false}
                />
                <span className="muted small">
                  Every session's code is in its header. Same code and same picks replay the
                  session exactly.
                </span>
              </div>
            </details>

            <button
              className="btn primary xl"
              disabled={!canStart}
              onClick={() => canStart && onStart(seed, slot!)}
            >
              {canStart ? `Start session from pick ${slot! + 1}` : "Choose a slot to start"}
              {canStart && (
                <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                  <path d="M3 9h12M11 5l4 4-4 4" />
                </svg>
              )}
            </button>
          </div>
        </section>

        <PastSessions sessions={savedSessions} results={results} onResume={onResume} onOpenResult={onOpenResult} />
      </main>
    </div>
  );
}

const SHOWN = 6;

function when(ms: number): string {
  return new Date(ms).toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

interface PastRow {
  key: string;
  status: "progress" | "complete" | "branch";
  title: string;
  code: string;
  meta: string;
  at: number;
  action: string;
  open: () => void;
}

/**
 * Every session you can go back to: unfinished sessions resume, finished ones
 * open their report, and the branches a rewind left behind open read-only.
 * A finished session's own run snapshot is the same session, so it's listed only
 * once its session is gone.
 */
function PastSessions({
  sessions,
  results,
  onResume,
  onOpenResult,
}: {
  sessions: SessionSummary[];
  results: ResultSummary[];
  onResume: (sessionId: string) => void;
  onOpenResult: (resultId: string) => void;
}) {
  const [all, setAll] = useState(false);
  const sessionIds = new Set(sessions.map((d) => d.id));

  const rows: PastRow[] = [
    ...sessions
      .filter((d) => d.selections > 0)
      .map((d): PastRow => {
        const done = d.status === "complete";
        return {
          key: `d-${d.id}`,
          status: done ? "complete" : "progress",
          title: done ? "Finished session" : `${d.selections} picks made`,
          code: d.seed,
          meta: `${done ? "Finished" : "Saved"} ${when(d.updatedAt)}`,
          at: d.updatedAt,
          action: done ? "View report" : "Resume",
          open: () => onResume(d.id),
        };
      }),
    ...results
      .filter((r) => r.id.startsWith("branch-") || !sessionIds.has(r.id.replace(/^run-/, "")))
      .map((r): PastRow => {
        const [title, rest = ""] = r.label.split(" — ");
        const branch = r.id.startsWith("branch-");
        return {
          key: `r-${r.id}`,
          status: branch ? "branch" : "complete",
          title: branch ? title : "Finished session",
          code: rest.replace(/^replay code /, ""),
          meta: `${branch ? "Rewound" : "Finished"} ${when(r.createdAt)}`,
          at: r.createdAt,
          action: "View",
          open: () => onOpenResult(r.id),
        };
      }),
  ].sort((a, b) => b.at - a.at);

  if (rows.length === 0) return null;
  const shown = all ? rows : rows.slice(0, SHOWN);
  const label = { progress: "In progress", complete: "Complete", branch: "Branch" };

  return (
    <section className="past-sessions" aria-labelledby="past-title">
      <div className="section-head">
        <h2 id="past-title" className="title">Your sessions</h2>
        <span className="muted">
          Resume an unfinished session, or reopen a finished one and the branches you rewound from.
        </span>
      </div>
      <ul className="past-list">
        {shown.map((r) => (
          <li key={r.key} className="card past-row">
            <span className={`kind past-${r.status}`}>{label[r.status]}</span>
            <span className="grow stack-0">
              <strong>{r.title}</strong>
              <span className="muted small">
                {r.meta}
                {r.code && <> · code <span className="mono">{r.code}</span></>}
              </span>
            </span>
            <button className={r.status === "progress" ? "btn outline" : "btn"} onClick={r.open}>
              {r.action}
            </button>
          </li>
        ))}
      </ul>
      {rows.length > SHOWN && (
        <button className="link-btn fit-content" onClick={() => setAll(!all)}>
          {all ? "Show fewer" : `Show all ${rows.length}`}
        </button>
      )}
    </section>
  );
}
