import {
  CATEGORIES,
  type ApiPlayer,
  type Category,
  type DraftView,
  type RunSummary,
} from "../api/client";
import { andList, ordinal, teamBadge, teamName, teamPunts } from "../state/teams";
import { Headshot, RankLegend, RankStrip } from "./common";

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

/** "1", "T2"… by wins, ties sharing a place. */
function places(wins: number[]): string[] {
  return wins.map((w) => {
    const place = wins.filter((x) => x > w).length + 1;
    const tied = wins.filter((x) => x === w).length > 1;
    return `${tied ? "T" : ""}${place}`;
  });
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
  const slot = view.userSlot;
  const n = view.numTeams;
  const punts = new Set<Category>(view.userPunts);
  const ranks = CATEGORIES.map((c) => view.ranks[c][slot]);
  const rec = view.records[slot];
  const place = places(view.records.map((r) => r.wins));

  const scored = CATEGORIES.map((c, j) => ({ c, r: ranks[j] })).filter(({ c }) => !punts.has(c));
  const best = [...scored].sort((a, b) => a.r - b.r);
  const strong = best.filter(({ r }) => r <= 3);
  const weak = [...scored].sort((a, b) => b.r - a.r).filter(({ r }) => r >= 9).slice(0, 3);
  const headline = strong.length
    ? `Built on ${andList(strong.slice(0, 3).map(({ c }) => c))}.`
    : `A balanced team, best in ${andList(best.slice(0, 2).map(({ c }) => c))}.`;

  const userPicks = view.picks.filter((p) => p.teamId === slot);
  const centers = userPicks.filter((p) => playerMap.get(p.playerId)?.positions.includes("C")).length;

  // Rewind hint: the weakest category, and the pick from round 3 on that helped it least.
  const soft = weak[0];
  const culprit = soft
    ? userPicks
        .filter((p) => p.round >= 3)
        .map((p) => ({ p, z: playerMap.get(p.playerId)?.z?.[soft.c] ?? 0 }))
        .sort((a, b) => a.z - b.z)[0]?.p
    : undefined;

  const order = Array.from({ length: n }, (_, t) => t).sort(
    (a, b) => view.records[b].wins - view.records[a].wins || a - b,
  );

  return (
    <main className="report">
      <div className="report-tools">
        {runs.length > 0 && (
          <select
            aria-label="Draft to view"
            value={selectedRun ?? "live"}
            onChange={(e) => onSelectRun(e.target.value === "live" ? null : e.target.value)}
          >
            <option value="live">This draft</option>
            {runs.map((r) => (
              <option key={r.id} value={r.id}>{r.label}</option>
            ))}
          </select>
        )}
        <button className="btn primary" onClick={onNewDraft}>New draft</button>
      </div>

      <section className="hero">
        <div className="hero-text">
          <span className="eyebrow">Draft complete</span>
          <h1 className="display-lg">{headline}</h1>
          <p>
            {punts.size > 0 && <>You punted {andList([...punts])}. </>}
            {centers >= 4 && <>You drafted {centers} centers. </>}
            {strong.length > 0 && <>You finished top 3 in {andList(strong.map(({ c }) => c))}.</>}
          </p>
        </div>
        <div className="record-box">
          <span className="record">{rec.wins}–{rec.losses}{rec.ties ? `–${rec.ties}` : ""}</span>
          <span>vs. the other {n - 1} teams</span>
          <span>
            {place[slot].startsWith("T") ? "Tied " : ""}
            {ordinal(Number(place[slot].replace("T", "")))} of {n}
          </span>
        </div>
      </section>

      <section className="win-lose">
        <div className="card pad stack-sm">
          <strong>Where you win</strong>
          <div className="chips">
            {best.slice(0, 4).map(({ c, r }) => (
              <span key={c} className={r <= 3 ? "chip blue" : "chip blue-soft"}>{c} · {ordinal(r)}</span>
            ))}
          </div>
        </div>
        <div className="card pad stack-sm">
          <strong>Where you lose</strong>
          <div className="chips">
            {weak.length ? (
              weak.map(({ c, r }) => (
                <span key={c} className="chip orange-soft">{c} · {ordinal(r)}</span>
              ))
            ) : (
              <span className="muted">Nowhere in the bottom 4.</span>
            )}
            {[...punts].map((c) => (
              <span key={c} className="chip">{c} · punted</span>
            ))}
          </div>
        </div>
      </section>

      {isLive && soft && culprit && (
        <section className="hint">
          <div className="grow stack-xs">
            <strong>{soft.c} is your soft spot</strong>
            <span>
              You're {ordinal(soft.r)} in {soft.c}. Rewind to round {culprit.round}, where you took{" "}
              {playerMap.get(culprit.playerId)?.name}, and try a player who helps {soft.c}.
            </span>
          </div>
          <button className="btn outline-accent" onClick={() => onRewind(culprit.index)}>
            Rewind to pick #{culprit.index + 1}
          </button>
        </section>
      )}

      <div className="report-grid">
        <section className="card table-card">
          <div className="pad-x stack-xs head-pad">
            <h2 className="title">League table</h2>
            <span className="muted small">
              Each team vs. every other team across 9 categories, equal games played
            </span>
          </div>
          <div className="table-scroll">
            <table className="league">
              <thead>
                <tr>
                  <th scope="col" className="left" />
                  <th scope="col" className="left">Team</th>
                  <th scope="col">Record</th>
                  <th scope="col" className="left">Category ranks</th>
                </tr>
              </thead>
              <tbody>
                {order.map((t) => {
                  const r = view.records[t];
                  return (
                    <tr key={t} className={t === slot ? "focused" : ""}>
                      <td className="left muted">{place[t]}</td>
                      <td className="left">
                        <span className="team-cell">
                          <strong>{teamName(view, t)}</strong>
                          <span className="chip">
                            {t === slot
                              ? punts.size ? `Punt ${[...punts].join(", ")}` : "No punt"
                              : teamBadge(view, t)}
                          </span>
                        </span>
                      </td>
                      <td><strong>{r.wins}–{r.losses}{r.ties ? `–${r.ties}` : ""}</strong></td>
                      <td className="left">
                        <RankStrip
                          ranks={CATEGORIES.map((c) => view.ranks[c][t])}
                          punts={teamPunts(view, t)}
                          size="sm"
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="pad-x foot-pad"><RankLegend /></div>
        </section>

        <section className="card pad stack-sm picks-card">
          <h2 className="title">Your picks</h2>
          <ol className="roster">
            {userPicks.map((p) => {
              const pl = playerMap.get(p.playerId)!;
              return (
                <li key={p.index}>
                  <span className="muted small rd">Rd {p.round}</span>
                  <Headshot player={pl} variant="avatar" />
                  <span className="grow stack-0">
                    <strong>{pl.name}</strong>
                    <span className="muted small">
                      {pl.positions.join("/")} · {pl.signed ? pl.team : "Free agent"}
                    </span>
                  </span>
                  {isLive && (
                    <button
                      className="link-btn small"
                      title="Rewind to this pick and try someone else"
                      onClick={() => onRewind(p.index)}
                    >
                      Rewind
                    </button>
                  )}
                </li>
              );
            })}
          </ol>
          {!isLive && (
            <p className="muted small">Viewing a saved run. Switch back to “This draft” to rewind.</p>
          )}
        </section>
      </div>
    </main>
  );
}
