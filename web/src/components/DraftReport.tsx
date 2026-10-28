import {
  CATEGORIES,
  type ApiPlayer,
  type Category,
  type DraftView,
  type RunSummary,
} from "../api/client";
import { andList, ordinal, places } from "../state/teams";
import { Headshot, PlayerMeta, RankLegend, RankStrip, Standings } from "./common";

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
  const slot = view.userSlot;
  const n = view.numTeams;
  const punts = new Set<Category>(view.userPunts);
  const ranks = CATEGORIES.map((c) => view.ranks[c][slot]);
  const rec = view.records[slot];
  const place = places(view.records.map((r) => r.wins));
  const tied = place[slot].startsWith("T");
  const placeText = `${tied ? "Tied " : ""}${ordinal(Number(place[slot].replace("T", "")))}`;

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

  const teams = Array.from({ length: n }, (_, t) => t);

  return (
    <main className="screen">
      <div className="screen-head">
        <div className="screen-title">
          <span className="eyebrow-accent">
            Draft complete
            {[...punts].map((c) => (
              <span key={c} className="chip dark">Punt {c}</span>
            ))}
          </span>
          <h1 className="display-md">{headline}</h1>
          <p className="lede">
            {centers >= 4 && <>You drafted {centers} centers. </>}
            {strong.length > 0 && <>You finished top 3 in {andList(strong.map(({ c }) => c))}.</>}
          </p>
        </div>
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
      </div>

      <section className="card pad recap">
        <div className="recap-record">
          <strong className="recap-num">
            {rec.wins}–{rec.losses}{rec.ties ? `–${rec.ties}` : ""}
          </strong>
          <span className="muted small">
            vs. the other {n - 1} teams · {placeText} of {n}
          </span>
        </div>
        <div className="grow stack-sm">
          <span className="muted small">Where your team ranks</span>
          <RankStrip ranks={ranks} punts={punts} />
        </div>
        <RankLegend />
      </section>

      <div className="win-lose">
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
      </div>

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
        <div className="report-standings">
          <Standings view={view} teams={teams} />
        </div>

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
                    <PlayerMeta player={pl} />
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
