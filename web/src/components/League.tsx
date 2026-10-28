import { useMemo, useState } from "react";
import {
  CATEGORIES,
  type ApiPick,
  type ApiPlayer,
  type SessionView,
} from "../api/client";
import { buildChip, ordinal, places, recordText, squadName, squadConcedes } from "../state/squads";
import { Monogram, PlayerMeta, RankStrip, Standings } from "./ui";

interface Props {
  view: SessionView;
  playerMap: Map<string, ApiPlayer>;
}

export function League({ view, playerMap }: Props) {
  const [mode, setMode] = useState<"squads" | "board">("squads");
  const teams = useMemo(
    () => Array.from({ length: view.teams }, (_, t) => t),
    [view.teams],
  );
  const started = view.selections.length > 0;

  return (
    <main className="screen">
      <div className="screen-head">
        <div className="screen-title">
          <h1 className="display-md">The league so far</h1>
          <p className="lede">
            Where every roster ranks in each category right now, and the record it would
            post against the other {view.teams - 1}.
          </p>
        </div>
        <div className="seg seg-lg" role="group" aria-label="Teams view">
          <button aria-pressed={mode === "squads"} onClick={() => setMode("squads")}>Standings &amp; rosters</button>
          <button aria-pressed={mode === "board"} onClick={() => setMode("board")}>Draft board</button>
        </div>
      </div>

      {mode === "squads" ? (
        <>
          {started && <Standings view={view} teams={teams} />}
          <section className="stack" aria-labelledby="rosters-title">
            <div className="section-head">
              <h2 id="rosters-title" className="title">Rosters</h2>
              <span className="muted">Your team first, then in draft order.</span>
            </div>
            <div className="team-grid">
              {[view.seat, ...teams.filter((t) => t !== view.seat)].map((t) => (
                <TeamCard key={t} view={view} playerMap={playerMap} team={t} />
              ))}
            </div>
          </section>
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
  view: SessionView;
  playerMap: Map<string, ApiPlayer>;
  team: number;
}) {
  const isYou = t === view.seat;
  const concedes = squadConcedes(view, t);
  const roster = view.squads[t].map((id) => playerMap.get(id)!);
  const picks = view.selections.filter((p) => p.squad === t);
  const badge = buildChip(view, t);
  const onClock = !view.complete && view.onClock === t;
  const place = places(view.records.map((r) => r.wins))[t];

  return (
    <section
      className={["card pad stack team-card", isYou ? "yours" : "", onClock ? "on-clock" : ""].join(" ").trim()}
    >
      <div className="team-title">
        <h3 className="title">{isYou ? "Your team" : squadName(view, t)}</h3>
        <span className={`badge ${badge.tone}`}>{badge.label}</span>
        {roster.length > 0 && (
          <span className="push team-record">
            {recordText(view, t)}{" "}
            <span className="muted small">
              {place.startsWith("T") ? `T-${ordinal(Number(place.slice(1)))}` : ordinal(Number(place))}
            </span>
          </span>
        )}
      </div>

      {roster.length > 0 && (
        <RankStrip
          ranks={CATEGORIES.map((c) => view.ranks[c][t])}
          concedes={concedes}
          size="sm"
        />
      )}

      <ol className="roster team-roster">
        {roster.map((p, i) => (
          <li key={p.id}>
            <span className="muted small rd">Rd {i + 1}</span>
            <Monogram player={p} variant="mini" />
            <span className="grow stack-0">
              <strong>{p.name}</strong>
              <PlayerMeta player={p} />
            </span>
            {picks[i] && <span className="muted small">#{picks[i].at + 1}</span>}
          </li>
        ))}
        {onClock && (
          <li className="now">
            <span className="dot" />
            <strong>On the clock · Rd {view.round}</strong>
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
  view: SessionView;
  playerMap: Map<string, ApiPlayer>;
  teams: number[];
}) {
  const byCell = useMemo(
    () => new Map<string, ApiPick>(view.selections.map((p) => [`${p.round}:${p.squad}`, p])),
    [view.selections],
  );
  const rounds = Array.from({ length: view.squadSize }, (_, i) => i + 1);

  return (
    <section className="card table-card">
      <div className="table-scroll">
        <table className="league board">
          <thead>
            <tr>
              <th scope="col" className="left board-team">Team</th>
              {rounds.map((r) => (
                <th key={r} scope="col" className="left">
                  Rd {r} <span aria-hidden="true">{r % 2 ? "→" : "←"}</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {teams.map((t) => {
              const badge = buildChip(view, t);
              return (
                <tr key={t} className={t === view.seat ? "focused" : ""}>
                  <th scope="row" className="left board-team">
                    <span className="stack-0">
                      <strong>{t === view.seat ? "You" : squadName(view, t)}</strong>
                      <span className="muted small">{badge.label}</span>
                    </span>
                  </th>
                  {rounds.map((r) => {
                    const pick = byCell.get(`${r}:${t}`);
                    const pl = pick ? playerMap.get(pick.pid) : undefined;
                    const clock = !view.complete && view.onClock === t && view.round === r;
                    return (
                      <td key={r} className={clock ? "left board-now" : "left"}>
                        {pl ? (
                          <span className="board-pick" title={`#${pick!.at + 1} · ${pl.name}`}>
                            <Monogram player={pl} variant="mini" />
                            <span className="stack-0 board-text">
                              <strong className="board-name">{pl.name}</strong>
                              <span className="muted small">#{pick!.at + 1}</span>
                            </span>
                          </span>
                        ) : clock ? (
                          <span className="small board-clock">On the clock</span>
                        ) : null}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
