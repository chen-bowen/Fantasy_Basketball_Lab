import { useState } from "react";
import type { DraftSummary } from "../api/client";

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

  const canStart = slot !== null;
  const resumable = savedDrafts
    .filter((d) => d.picks > 0 && d.status !== "complete")
    .sort((a, b) => b.updatedAt - a.updatedAt);

  return (
    <div className="setup">
      <h1>Fantasy Draft Lab</h1>
      <p className="tagline">
        Category-league mock draft · 12 teams · snake · {playerCount}-player
        pool
      </p>

      {resumable.length > 0 && (
        <div className="card resume-card">
          <div>
            <strong>Saved drafts</strong>
            {resumable.slice(0, 3).map((d) => (
              <div key={d.id} className="muted">
                Seed “{d.seed}” · {d.picks} picks made · saved{" "}
                {new Date(d.updatedAt).toLocaleTimeString()}{" "}
                <button
                  className="ghost tiny"
                  onClick={() => onResume(d.id)}
                >
                  Resume
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="card">
        <h2>Choose your draft slot</h2>
        <div className="slot-grid">
          {Array.from({ length: NUM_TEAMS }, (_, i) => (
            <button
              key={i}
              className={slot === i ? "slot selected" : "slot"}
              onClick={() => setSlot(i)}
            >
              {i + 1}
            </button>
          ))}
          <button
            className="slot random"
            onClick={() => setSlot(Math.floor(Math.random() * NUM_TEAMS))}
          >
            Random
          </button>
        </div>
        <div className="seed-row">
          <label htmlFor="seed">Draft seed</label>
          <input
            id="seed"
            value={seed}
            onChange={(e) => setSeed(e.target.value)}
            spellCheck={false}
          />
          <button className="ghost" onClick={() => setSeed(randomSeed())}>
            Re-roll
          </button>
        </div>
        <p className="muted small">
          The seed drives bot personalities and their pick randomness — same
          seed + same picks reproduces the same draft.
        </p>
        <button
          className="primary big"
          disabled={!canStart}
          onClick={() => canStart && onStart(seed || randomSeed(), slot!)}
        >
          Start draft{slot !== null ? ` — pick ${slot + 1}` : ""}
        </button>
      </div>
    </div>
  );
}
