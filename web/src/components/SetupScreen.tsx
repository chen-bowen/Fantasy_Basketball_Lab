import { useEffect, useState } from "react";
import { api, type BotSpecView, type DraftSummary, type RunSummary } from "../api/client";
import { slotPicks, teamBadge, teamName, teamRisk } from "../state/teams";
import { Logo } from "./common";

interface Props {
  playerCount: number;
  savedDrafts: DraftSummary[];
  runs: RunSummary[];
  onStart: (seed: string, userSlot: number) => void;
  onResume: (draftId: string) => void;
  onOpenRun: (runId: string) => void;
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

export function SetupScreen({
  playerCount,
  savedDrafts,
  runs,
  onStart,
  onResume,
  onOpenRun,
}: Props) {
  const [slot, setSlot] = useState<number | null>(null);
  const [freshSeed, setFreshSeed] = useState(randomSeed); // the league you get with no code
  const [code, setCode] = useState(""); // a pasted replay code, if any
  const seed = code.trim() || freshSeed;
  const [bots, setBots] = useState<BotSpecView[] | null>(null);

  const canStart = slot !== null;
  const resumable = savedDrafts
    .filter((d) => d.picks > 0 && d.status !== "complete")
    .sort((a, b) => b.updatedAt - a.updatedAt);
  const latest = resumable[0];
  const picks = slot !== null ? slotPicks(slot, NUM_TEAMS, PREVIEW_ROUNDS) : null;

  // Opponent preview: bot personalities are a pure function of seed + slot.
  useEffect(() => {
    if (slot === null || !seed) {
      setBots(null);
      return;
    }
    const t = setTimeout(() => {
      api.leaguePreview(seed, slot).then((r) => setBots(r.botSpecs)).catch(() => setBots(null));
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
            <span className="setup-eyebrow">Category-league mock draft</span>
            <h1 className="display">Draft against 11 bots. Watch your build take shape.</h1>
            <p className="lede">
              Pick a slot and a league of opponents. In round 1 you choose a build, a first
              pick plus the category it lets you punt. After that, every recommendation
              follows what your team still needs.
            </p>
          </div>

          <dl className="setup-facts">
            <div><dt>12</dt><dd>teams, you and 11 bots</dd></div>
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
              <span><strong>Choose a build.</strong> Your first pick and a category to punt, side by side.</span>
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
                  {latest.picks} picks made · saved{" "}
                  {new Date(latest.updatedAt).toLocaleTimeString([], {
                    hour: "numeric",
                    minute: "2-digit",
                  })}
                </span>
              </div>
              <button className="btn outline" onClick={() => onResume(latest.id)}>
                Resume draft
              </button>
            </section>
          )}
        </div>

        <section className="card setup-card" aria-label="New draft">
          <div className="setup-section">
            <div className="setup-section-head">
              <div className="stack-xs grow">
                <span className="step-label">Step 1</span>
                <h2 className="title">Choose your draft slot</h2>
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
                  const p = slotPicks(i, NUM_TEAMS, PREVIEW_ROUNDS);
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
                  Snake order: round 2 runs backward, so the last slot in round 1 picks
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
            ) : bots ? (
              <ul className="opponents">
                {bots.map((b, t) => {
                  if (t === slot) return null;
                  const league = { userSlot: slot, botSpecs: bots };
                  const risk = teamRisk(league, t);
                  return (
                    <li key={t} className="opponent">
                      <span className="opponent-slot">{t + 1}</span>
                      <strong className="grow">{teamName(league, t)}</strong>
                      <span className={`kind ${b.kind}`}>{teamBadge(league, t)}</span>
                      {risk && (
                        <span
                          className={`kind risk ${b.risk}`}
                          title={
                            b.risk === "bold"
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
              <strong className="key-value">Value</strong> bots take the best player left.{" "}
              <strong className="key-needs">Needs</strong> bots fill their weakest categories.{" "}
              <strong className="key-punt">Punt</strong> bots ignore one.{" "}
              <strong>Bold</strong> bots gamble on injured stars; <strong>cautious</strong> ones
              steer clear.
            </p>
          </div>

          <div className="setup-section">
            <details className="replay">
              <summary>
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
                  <path d="M5 3l4 4-4 4" />
                </svg>
                Same league again? <span className="muted">Paste a draft code</span>
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
                  Every draft's code is in its header. Same code and same picks replay the
                  draft exactly.
                </span>
              </div>
            </details>

            <button
              className="btn primary xl"
              disabled={!canStart}
              onClick={() => canStart && onStart(seed, slot!)}
            >
              {canStart ? `Start draft from pick ${slot! + 1}` : "Choose a slot to start"}
              {canStart && (
                <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                  <path d="M3 9h12M11 5l4 4-4 4" />
                </svg>
              )}
            </button>
          </div>
        </section>

        <PastDrafts drafts={savedDrafts} runs={runs} onResume={onResume} onOpenRun={onOpenRun} />
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
 * Every draft you can go back to: unfinished drafts resume, finished ones
 * open their report, and the branches a rewind left behind open read-only.
 * A finished draft's own run snapshot is the same draft, so it's listed only
 * once its draft is gone.
 */
function PastDrafts({
  drafts,
  runs,
  onResume,
  onOpenRun,
}: {
  drafts: DraftSummary[];
  runs: RunSummary[];
  onResume: (draftId: string) => void;
  onOpenRun: (runId: string) => void;
}) {
  const [all, setAll] = useState(false);
  const draftIds = new Set(drafts.map((d) => d.id));

  const rows: PastRow[] = [
    ...drafts
      .filter((d) => d.picks > 0)
      .map((d): PastRow => {
        const done = d.status === "complete";
        return {
          key: `d-${d.id}`,
          status: done ? "complete" : "progress",
          title: done ? "Finished draft" : `${d.picks} picks made`,
          code: d.seed,
          meta: `${done ? "Finished" : "Saved"} ${when(d.updatedAt)}`,
          at: d.updatedAt,
          action: done ? "View report" : "Resume",
          open: () => onResume(d.id),
        };
      }),
    ...runs
      .filter((r) => r.id.startsWith("branch-") || !draftIds.has(r.id.replace(/^run-/, "")))
      .map((r): PastRow => {
        const [title, rest = ""] = r.label.split(" — ");
        const branch = r.id.startsWith("branch-");
        return {
          key: `r-${r.id}`,
          status: branch ? "branch" : "complete",
          title: branch ? title : "Finished draft",
          code: rest.replace(/^replay code /, ""),
          meta: `${branch ? "Rewound" : "Finished"} ${when(r.createdAt)}`,
          at: r.createdAt,
          action: "View",
          open: () => onOpenRun(r.id),
        };
      }),
  ].sort((a, b) => b.at - a.at);

  if (rows.length === 0) return null;
  const shown = all ? rows : rows.slice(0, SHOWN);
  const label = { progress: "In progress", complete: "Complete", branch: "Branch" };

  return (
    <section className="past-drafts" aria-labelledby="past-title">
      <div className="section-head">
        <h2 id="past-title" className="title">Your drafts</h2>
        <span className="muted">
          Resume an unfinished draft, or reopen a finished one and the branches you rewound from.
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
