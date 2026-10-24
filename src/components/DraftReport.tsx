import {
  CATEGORIES,
  LOWER_IS_BETTER,
  type ApiPlayer,
  type DraftView,
  type RunSummary,
} from "../api/client";
import { teamBadge, teamName } from "../state/teams";

interface Props {
  view: DraftView; // the draft or saved run being viewed
  isLive: boolean; // false when viewing a saved run
  playerMap: Map<string, ApiPlayer>;
  runs: RunSummary[];
  selectedRun: string | null;
  onSelectRun: (runId: string | null) => void;
  onNewDraft: () => void;
  onRewind: (pickIndex: number) => void;
}

export function DraftReport({
  view,
  isLive,
  playerMap,
  runs,
  selectedRun,
  onSelectRun,
  onNewDraft,
  onRewind,
}: Props) {
  const ranks = view.ranks;
  const userId = view.userSlot;
  const userRanks = CATEGORIES.map((c) => ({ c, r: ranks[c][userId] })).sort(
    (a, b) => a.r - b.r,
  );
  const strongest = userRanks.slice(0, 2);
  const weakest = userRanks.slice(-2).reverse();
  const userPicks = view.picks.filter((p) => p.teamId === userId);

  const heat = (rank: number) => {
    const n = view.numTeams;
    if (rank <= n / 3) return "strong";
    if (rank >= (2 * n) / 3) return "weak";
    return "mid";
  };

  return (
    <div className="report">
      <div className="panel-head report-head">
        <h2>Draft report</h2>
        <div className="report-actions">
          {runs.length > 0 && (
            <select
              value={selectedRun ?? "live"}
              onChange={(e) =>
                onSelectRun(e.target.value === "live" ? null : e.target.value)
              }
            >
              <option value="live">This draft</option>
              {runs.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.label}
                </option>
              ))}
            </select>
          )}
          <button onClick={onNewDraft}>New draft</button>
        </div>
      </div>

      <div className="report-grid">
        <section className="panel">
          <h3>Category standings — per-slot z, equal games</h3>
          <table className="mini-table matrix">
            <thead>
              <tr>
                <th>Team</th>
                {CATEGORIES.map((c) => (
                  <th key={c} className={LOWER_IS_BETTER.has(c) ? "lower" : ""}>
                    {c}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {view.profiles.map((_, t) => (
                <tr key={t} className={t === userId ? "you-row" : ""}>
                  <td className="team-cell">
                    {teamName(view, t)}
                    <span className="muted"> {teamBadge(view, t)}</span>
                  </td>
                  {CATEGORIES.map((c) => (
                    <td key={c} className={`num ${heat(ranks[c][t])}`}>
                      {ranks[c][t]}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          <p className="muted small">
            1 = strongest in that category. TO is lower-is-better in raw terms;
            the ranking already accounts for it. Comparison assumes equal games
            played — it does not model schedules, injuries, or weekly variance.
          </p>
        </section>

        <section className="panel">
          <h3>Your team</h3>
          <div className="callouts">
            <div>
              <span className="muted">Strongest</span>
              {strongest.map(({ c, r }) => (
                <span key={c} className="tag strong">
                  {c} #{r}
                </span>
              ))}
            </div>
            <div>
              <span className="muted">Weakest</span>
              {weakest.map(({ c, r }) => (
                <span key={c} className="tag weak">
                  {c} #{r}
                </span>
              ))}
            </div>
            {view.userPunts.length > 0 && (
              <div>
                <span className="muted">Your punts</span>
                {view.userPunts.map((c) => (
                  <span key={c} className="tag">
                    {c}
                  </span>
                ))}
              </div>
            )}
          </div>

          <h4>Pick history</h4>
          <ol className="pick-history">
            {userPicks.map((pk) => {
              const p = playerMap.get(pk.playerId);
              return (
                <li key={pk.index}>
                  <span className="muted">
                    Rd {pk.round} · #{pk.index + 1}
                  </span>{" "}
                  {p?.name ?? pk.playerId}
                  {isLive && (
                    <button
                      className="ghost tiny"
                      title="Rewind to this pick and try someone else"
                      onClick={() => onRewind(pk.index)}
                    >
                      rewind
                    </button>
                  )}
                </li>
              );
            })}
          </ol>
          {!isLive && (
            <p className="muted small">
              Viewing a saved run — switch back to "This draft" to rewind.
            </p>
          )}
        </section>
      </div>
    </div>
  );
}
