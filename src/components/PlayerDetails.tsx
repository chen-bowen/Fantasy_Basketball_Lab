import {
  CATEGORIES,
  LOWER_IS_BETTER,
  type ApiPlayer,
  type Category,
  type PreviewView,
} from "../api/client";

interface Props {
  player: ApiPlayer;
  puntScore: number | null; // value under the user's punt settings
  punts: ReadonlySet<Category>;
  preview: PreviewView | null; // before/after roster profile from the API
  canDraft: boolean;
  onDraft: () => void;
  onClose: () => void;
}

const fmt1 = (x: number) => x.toFixed(1);
const fmtPct = (x: number | null) => (x === null ? "—" : (x * 100).toFixed(1));

const TOTAL_KEY = {
  PTS: "pts",
  REB: "reb",
  AST: "ast",
  STL: "stl",
  BLK: "blk",
  "3PM": "tpm",
  TO: "tov",
} as const;

export function PlayerDetails({
  player,
  puntScore,
  punts,
  preview,
  canDraft,
  onDraft,
  onClose,
}: Props) {
  const cell = (c: Category, which: "before" | "after"): string => {
    if (!preview) return "…";
    const p = preview[which];
    if (c === "FG%") return fmtPct(p.fgPct);
    if (c === "FT%") return fmtPct(p.ftPct);
    return fmt1(p.totals[TOTAL_KEY[c as keyof typeof TOTAL_KEY]!] ?? 0);
  };

  return (
    <aside className="inspector">
      <div className="inspector-head">
        <div>
          <h3>{player.name}</h3>
          <div className="muted">
            {player.positions.join("/")} · {player.team}
            {player.asOfSeason ? ` · ${player.asOfSeason} stats` : ""}
            {player.gp ? ` · ${player.gp} GP` : ""}
          </div>
        </div>
        <button className="ghost" onClick={onClose}>
          ✕
        </button>
      </div>

      <div className="stat-grid">
        {(
          [
            ["PTS", player.pts],
            ["REB", player.reb],
            ["AST", player.ast],
            ["STL", player.stl],
            ["BLK", player.blk],
            ["3PM", player.tpm],
            ["FG%", player.fga > 0 ? `${fmt1((player.fgm / player.fga) * 100)}` : "—"],
            ["FT%", player.fta > 0 ? `${fmt1((player.ftm / player.fta) * 100)}` : "—"],
            ["TO", player.tov],
            ["MIN", player.min],
          ] as [string, number | string][]
        ).map(([k, v]) => (
          <div key={k} className="stat">
            <span className="k">{k}</span>
            <span className="v">{typeof v === "number" ? fmt1(v) : v}</span>
          </div>
        ))}
      </div>

      <div className="scores">
        <div>
          Overall score{" "}
          <strong>
            {player.overall !== null ? player.overall.toFixed(2) : "—"}
          </strong>
        </div>
        <div>
          Under your punts{" "}
          <strong>
            {punts.size ? (puntScore?.toFixed(2) ?? "—") : "—"}
          </strong>
          {punts.size > 0 && (
            <span className="muted"> ({[...punts].join(", ")})</span>
          )}
        </div>
      </div>

      <h4>Roster projection if drafted</h4>
      <table className="mini-table">
        <thead>
          <tr>
            <th></th>
            {CATEGORIES.map((c) => (
              <th key={c} className={LOWER_IS_BETTER.has(c) ? "lower" : ""}>
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          <tr>
            <td className="muted">Now</td>
            {CATEGORIES.map((c) => (
              <td key={c} className="num">
                {cell(c, "before")}
              </td>
            ))}
          </tr>
          <tr>
            <td className="muted">+{player.name.split(" ").pop()}</td>
            {CATEGORIES.map((c) => (
              <td key={c} className="num after">
                {cell(c, "after")}
              </td>
            ))}
          </tr>
        </tbody>
      </table>
      <p className="muted small">
        Per-game totals across your roster; FG%/FT% are makes ÷ attempts. TO is
        lower-is-better.
      </p>

      <button className="primary big" disabled={!canDraft} onClick={onDraft}>
        {canDraft ? "Draft player" : "Waiting for your pick…"}
      </button>
    </aside>
  );
}
