import type { ApiPlayer, DraftView } from "../api/client";
import { teamBadge, teamName } from "../state/teams";

interface Props {
  view: DraftView;
  playerMap: Map<string, ApiPlayer>;
}

const surname = (name: string) => name.split(" ").slice(-1)[0];

export function DraftBoard({ view, playerMap }: Props) {
  const { numTeams, rosterSize, userSlot } = view;
  const lastPick = view.picks[view.picks.length - 1];

  return (
    <section className="panel board">
      <div className="panel-head">
        <h2>Draft board</h2>
        <span className="muted small">columns are teams · rows are rounds</span>
      </div>
      <div className="board-wrap">
        <table className="board-table">
          <thead>
            <tr>
              {Array.from({ length: numTeams }, (_, t) => (
                <th key={t} className={t === userSlot ? "you-col" : ""}>
                  <div className="tname">{teamName(view, t)}</div>
                  <div className="tbadge">{teamBadge(view, t)}</div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: rosterSize }, (_, r) => (
              <tr key={r}>
                {Array.from({ length: numTeams }, (_, t) => {
                  const pid = view.rosters[t][r];
                  const p = pid ? playerMap.get(pid) : null;
                  const isLast =
                    lastPick &&
                    lastPick.teamId === t &&
                    view.rosters[t].length - 1 === r;
                  return (
                    <td
                      key={t}
                      className={
                        (t === userSlot ? "you-col " : "") +
                        (isLast ? "last-pick" : "")
                      }
                    >
                      {p ? surname(p.name) : "·"}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="recent">
        <span className="muted small">Recent:</span>
        {view.picks.slice(-8).map((pk) => {
          const p = playerMap.get(pk.playerId);
          return (
            <span key={pk.index} className="recent-pick">
              <em>#{pk.index + 1}</em> {p?.name ?? pk.playerId} →{" "}
              {teamName(view, pk.teamId)}
            </span>
          );
        })}
      </div>
    </section>
  );
}
