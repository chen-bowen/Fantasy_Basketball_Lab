import type { ApiPlayer } from "../api/client";

interface Props {
  roster: ApiPlayer[];
  rosterSize: number;
  pickIndices: number[]; // global pick index for each roster slot (for rewind)
  onRewind: (pickIndex: number) => void;
}

export function TeamRoster({ roster, rosterSize, pickIndices, onRewind }: Props) {
  return (
    <section className="panel roster">
      <div className="panel-head">
        <h2>
          Your team <span className="muted">({roster.length}/{rosterSize})</span>
        </h2>
      </div>
      <ul className="roster-list">
        {roster.map((p, i) => (
          <li key={p.id}>
            <span className="pick-num">{i + 1}</span>
            <span className="rname">{p.name}</span>
            <span className="muted">
              {p.positions.join("/")} · {p.pts.toFixed(1)}p {p.reb.toFixed(1)}r{" "}
              {p.ast.toFixed(1)}a
            </span>
            <button
              className="ghost tiny"
              title="Rewind to this pick and try someone else"
              onClick={() => onRewind(pickIndices[i])}
            >
              rewind
            </button>
          </li>
        ))}
        {roster.length === 0 && (
          <li className="muted empty">No picks yet — the draft board fills in as you go.</li>
        )}
      </ul>
    </section>
  );
}
