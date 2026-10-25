import { useMemo, useState } from "react";
import {
  CATEGORIES,
  type ApiPick,
  type ApiPlayer,
  type DraftView,
} from "../api/client";
import { teamBadge, teamName, teamPunts } from "../state/teams";
import { Headshot, PlayerMeta, RankLegend, RankStrip } from "./common";

interface Props {
  view: DraftView;
  playerMap: Map<string, ApiPlayer>;
}

export function TeamsScreen({ view, playerMap }: Props) {
  const [mode, setMode] = useState<"rosters" | "board">("rosters");
  const teams = useMemo(
    () => Array.from({ length: view.numTeams }, (_, t) => t),
    [view.numTeams],
  );

  return (
    <main className="screen">
      <div className="screen-head">
        <div className="screen-title">
          <h1 className="display-md">Every team's picks</h1>
          <p className="lede">
            Who each team has drafted, the build they're running, and where their
            roster ranks in each category right now.
          </p>
        </div>
        <div className="seg" role="group" aria-label="Teams view">
          <button aria-pressed={mode === "rosters"} onClick={() => setMode("rosters")}>Rosters</button>
          <button aria-pressed={mode === "board"} onClick={() => setMode("board")}>Draft board</button>
        </div>
      </div>

      {mode === "rosters" ? (
        <>
          <div className="team-grid">
            {teams.map((t) => (
              <TeamCard key={t} view={view} playerMap={playerMap} team={t} />
            ))}
          </div>
          <RankLegend />
        </>
      ) : (
        <Board view={view} playerMap={playerMap} teams={teams} />
      )}
    </main>
  );
}

function TeamCard({
  view,
  playerMap,
  team: t,
}: {
  view: DraftView;
  playerMap: Map<string, ApiPlayer>;
  team: number;
}) {
  const isYou = t === view.userSlot;
  const punts = teamPunts(view, t);
  const rec = view.records[t];
  const roster = view.rosters[t].map((id) => playerMap.get(id)!);
  const badge = isYou
    ? view.userPunts.length
      ? `Punt ${view.userPunts.join(", ")}`
      : "No punt yet"
    : teamBadge(view, t);
  const onClock = !view.complete && view.onClock === t;

  return (
    <section className={isYou ? "card pad stack team-card yours" : "card pad stack team-card"}>
      <div className="team-title">
        <h3 className="title">{isYou ? "Your team" : teamName(view, t)}</h3>
        <span className="chip">{badge}</span>
        {roster.length > 0 && (
          <span className="muted small push">
            {rec.wins}–{rec.losses}{rec.ties ? `–${rec.ties}` : ""}
          </span>
        )}
      </div>

      {roster.length > 0 && (
        <RankStrip
          ranks={CATEGORIES.map((c) => view.ranks[c][t])}
          punts={punts}
          size="sm"
        />
      )}

      <ol className="roster">
        {roster.map((p, i) => (
          <li key={p.id}>
            <span className="muted small rd">Rd {i + 1}</span>
            <Headshot player={p} variant="mini" />
            <span className="grow stack-0">
              <strong>{p.name}</strong>
              <PlayerMeta player={p} />
            </span>
          </li>
        ))}
        {onClock && (
          <li className="now">
            <span className="small rd">Rd {view.round}</span>
            <strong>On the clock</strong>
          </li>
        )}
        {roster.length === 0 && !onClock && (
          <li className="empty muted">No picks yet</li>
        )}
      </ol>
    </section>
  );
}

/** Classic draft board: one row per team, one column per round. */
function Board({
  view,
  playerMap,
  teams,
}: {
  view: DraftView;
  playerMap: Map<string, ApiPlayer>;
  teams: number[];
}) {
  const byCell = useMemo(
    () => new Map<string, ApiPick>(view.picks.map((p) => [`${p.round}:${p.teamId}`, p])),
    [view.picks],
  );
  const rounds = Array.from({ length: view.rosterSize }, (_, i) => i + 1);

  return (
    <section className="card table-card">
      <div className="table-scroll">
        <table className="league board">
          <thead>
            <tr>
              <th scope="col" className="left">Team</th>
              {rounds.map((r) => (
                <th key={r} scope="col">Rd {r}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {teams.map((t) => (
              <tr key={t} className={t === view.userSlot ? "focused" : ""}>
                <td className="left">
                  <span className="team-cell">
                    <strong>{teamName(view, t)}</strong>
                    <span className="chip">
                      {t === view.userSlot
                        ? view.userPunts.length
                          ? `Punt ${view.userPunts.join(", ")}`
                          : "You"
                        : teamBadge(view, t)}
                    </span>
                  </span>
                </td>
                {rounds.map((r) => {
                  const pick = byCell.get(`${r}:${t}`);
                  const pl = pick ? playerMap.get(pick.playerId) : undefined;
                  const clock = !view.complete && view.onClock === t && view.round === r;
                  return (
                    <td key={r} className={clock ? "left board-now" : "left"}>
                      {pl ? (
                        <span className="board-pick" title={`#${pick!.index + 1} · ${pl.name}`}>
                          <Headshot player={pl} variant="mini" />
                          <span className="stack-0 board-text">
                            <strong className="board-name">{pl.name}</strong>
                            <span className="muted small">#{pick!.index + 1}</span>
                          </span>
                        </span>
                      ) : clock ? (
                        <span className="muted small">On clock</span>
                      ) : null}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
