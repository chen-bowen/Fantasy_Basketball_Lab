import { useEffect, useState } from "react";
import { api, type BotSpecView, type DraftSummary } from "../api/client";
import { slotPicks, teamBadge, teamName, teamRisk } from "../state/teams";
import { Logo } from "./common";

interface Props {
  playerCount: number;
  savedDrafts: DraftSummary[];
  onStart: (seed: string, userSlot: number) => void;
  onResume: (draftId: string) => void;
}

const NUM_TEAMS = 12;

function randomSeed() {
  return Math.random().toString(36).slice(2, 8);
}

export function SetupScreen({
  playerCount,
  savedDrafts,
  onStart,
  onResume,
}: Props) {
  const [slot, setSlot] = useState<number | null>(null);
  const [seed, setSeed] = useState(randomSeed());
  const [bots, setBots] = useState<BotSpecView[] | null>(null);

  const canStart = slot !== null;
  const resumable = savedDrafts
    .filter((d) => d.picks > 0 && d.status !== "complete")
    .sort((a, b) => b.updatedAt - a.updatedAt);
  const latest = resumable[0];

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
          <h1 className="display">Draft against 11 bots. Watch your build take shape.</h1>
          <p className="lede">
            A category-league mock draft. Pick your slot. When you're up in round 1,
            you'll get a few builds to choose from, each a first pick plus the category
            it lets you punt. After that, recommendations follow what your team needs.
          </p>
          <div className="chips">
            <span className="chip">12 teams</span>
            <span className="chip">Snake · 13 rounds</span>
            <span className="chip">H2H 9-cat</span>
            <span className="chip">{playerCount}-player pool</span>
          </div>

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

        <section className="card setup-card">
          <div>
            <h2 className="title">Choose your draft slot</h2>
            <span className="muted">Your first three picks are shown under each slot.</span>
          </div>
          <div className="slot-grid" role="group" aria-label="Draft slot">
            {Array.from({ length: NUM_TEAMS }, (_, i) => (
              <button
                key={i}
                className={slot === i ? "slot selected" : "slot"}
                aria-pressed={slot === i}
                onClick={() => setSlot(i)}
              >
                <span className="slot-n">{i + 1}</span>
                <span className="slot-picks">
                  {slotPicks(i, NUM_TEAMS, 3).map((n) => `#${n}`).join(" · ")}
                </span>
              </button>
            ))}
          </div>
          <button
            className="btn soft fit-content"
            onClick={() => setSlot(Math.floor(Math.random() * NUM_TEAMS))}
          >
            Random slot
          </button>

          <div className="field">
            <div className="field-head">
              <span className="field-label">Your opponents</span>
              <button className="btn" onClick={() => setSeed(randomSeed())}>
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
                  <path d="M2 4h3c3 0 3 8 6 8h3M12 10l2 2-2 2M2 12h3c1 0 1.6-.9 2.2-2M14 4h-3c-1 0-1.6.9-2.2 2M12 2l2 2-2 2" />
                </svg>
                Shuffle opponents
              </button>
            </div>
            {slot === null ? (
              <span className="muted">Choose a slot to see who you're drafting against.</span>
            ) : bots ? (
              <div className="chips">
                {bots.map((_, t) =>
                  t === slot ? null : (
                    <span key={t} className="opponent">
                      <span className={`kind ${bots[t].kind}`}>
                        {teamBadge({ userSlot: slot, botSpecs: bots }, t)}
                      </span>
                      {teamRisk({ userSlot: slot, botSpecs: bots }, t) && (
                        <span
                          className={`kind risk ${bots[t].risk}`}
                          title={
                            bots[t].risk === "bold"
                              ? "Shrugs off half of the injury-risk discount — gambles on hurt stars"
                              : "Adds half again to the injury-risk discount — steers clear of hurt players"
                          }
                        >
                          {teamRisk({ userSlot: slot, botSpecs: bots }, t)}
                        </span>
                      )}
                      {teamName({ userSlot: slot, botSpecs: bots }, t)}
                    </span>
                  ),
                )}
              </div>
            ) : (
              <span className="muted">Loading opponents…</span>
            )}
            <span className="muted small">
              Value bots take the best player, Needs bots fill their weakest categories,
              and Punt bots ignore one category. Bold bots gamble on injury-prone and
              hurt players; cautious bots steer clear of them.
            </span>
          </div>

          <details className="replay">
            <summary>Replay code</summary>
            <div className="stack-sm">
              <div className="field-row">
                <input
                  id="seed"
                  aria-label="Replay code"
                  className="mono"
                  value={seed}
                  onChange={(e) => setSeed(e.target.value)}
                  spellCheck={false}
                />
              </div>
              <span className="muted small">
                This code sets your opponents and their pick tendencies. Enter a code from
                an earlier draft to face the same league again; make the same picks and the
                draft replays exactly.
              </span>
            </div>
          </details>

          <button
            className="btn primary xl"
            disabled={!canStart}
            onClick={() => canStart && onStart(seed || randomSeed(), slot!)}
          >
            {canStart ? `Start draft from pick ${slot! + 1}` : "Choose a slot to start"}
          </button>
        </section>
      </main>
    </div>
  );
}
