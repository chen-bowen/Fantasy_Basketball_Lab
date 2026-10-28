import {
  CATEGORIES,
  type ApiPlayer,
  type Category,
  type CategorySummary,
  type SessionView,
  type DuelBoard,
  type ResultSummary,
} from "../api/client";
import { andList, ordinal, places, weekRecord } from "../state/squads";
import { Monogram, PlayerMeta, RankLegend, RankStrip, Standings } from "./ui";
import { DuelsSection, deciderStat, formatTotal, lastName } from "./Duels";

interface Props {
  view: SessionView; // the session or saved run being viewed
  isLive: boolean; // false when viewing a saved run
  playerMap: Map<string, ApiPlayer>;
  results: ResultSummary[];
  selectedResult: string | null;
  onSelectResult: (resultId: string | null) => void;
  onNew: () => void;
  onRewind: (pickIndex: number) => void;
}

/** "3rd" / "tied 3rd" from a places() entry. */
function placeWord(p: string): string {
  return p.startsWith("T") ? `tied ${ordinal(Number(p.slice(1)))}` : ordinal(Number(p));
}

/** A category goes in the card of the outcome it has against most of the league. */
function side(s: CategorySummary, n: number): "win" | "loss" | "close" {
  if (s.win > n / 2) return "win";
  if (s.loss > n / 2) return "loss";
  return "close";
}

export function Report({
  view,
  isLive,
  playerMap,
  results,
  selectedResult,
  onSelectResult,
  onNew,
  onRewind,
}: Props) {
  const slot = view.seat;
  const n = view.teams;
  const concedes = new Set<Category>(view.concedes);
  const ranks = CATEGORIES.map((c) => view.ranks[c][slot]);
  const rec = view.records[slot];
  const paperPlace = places(view.records.map((r) => r.wins));
  const weekPlace = places(view.weekPct);
  const bd = view.board;

  const scored = CATEGORIES.map((c, j) => ({ c, r: ranks[j] })).filter(({ c }) => !concedes.has(c));
  const best = [...scored].sort((a, b) => a.r - b.r);
  const strong = best.filter(({ r }) => r <= 3);
  const headline = strong.length
    ? `Built on ${andList(strong.slice(0, 3).map(({ c }) => c))}.`
    : `A balanced team, best in ${andList(best.slice(0, 2).map(({ c }) => c))}.`;

  const userPicks = view.selections.filter((p) => p.squad === slot);
  const centers = userPicks.filter((p) => playerMap.get(p.pid)?.positions.includes("C")).length;

  // Soft spot: the category you lose to most of the league (not a concede —
  // that one is on purpose), else the worst rank; and the pick from round 3
  // on that helped it least.
  const soft = (() => {
    if (bd) {
      const losing = CATEGORIES.filter((c) => !concedes.has(c) && bd.categories[c].loss > (n - 1) / 2)
        .sort((a, b) => bd.categories[b].loss - bd.categories[a].loss || view.ranks[b][slot] - view.ranks[a][slot]);
      if (losing.length) return { c: losing[0], r: view.ranks[losing[0]][slot], lost: bd.categories[losing[0]].loss };
    }
    const weak = [...scored].sort((a, b) => b.r - a.r)[0];
    return weak && weak.r >= 9 ? { ...weak, lost: null } : null;
  })();
  const culprit = soft
    ? userPicks
        .filter((p) => p.round >= 3)
        .map((p) => ({ p, z: playerMap.get(p.pid)?.z?.[soft.c] ?? 0 }))
        .sort((a, b) => a.z - b.z)[0]?.p
    : undefined;

  const teams = Array.from({ length: n }, (_, t) => t);

  return (
    <main className="screen">
      <div className="screen-head">
        <div className="screen-title">
          <span className="eyebrow-accent">
            Draft complete
            {[...concedes].map((c) => (
              <span key={c} className="chip dark">Concede {c}</span>
            ))}
          </span>
          <h1 className="display-md">{headline}</h1>
          <p className="lede">
            {centers >= 4 && <>You drafted {centers} centers. </>}
            {strong.length > 0 && <>You finished top 3 in {andList(strong.map(({ c }) => c))}. </>}
            Below: how you'd do against each of the other {n - 1} teams, on paper and week to week.
          </p>
        </div>
        <div className="report-tools">
          {results.length > 0 && (
            <select
              aria-label="Draft to view"
              value={selectedResult ?? "live"}
              onChange={(e) => onSelectResult(e.target.value === "live" ? null : e.target.value)}
            >
              <option value="live">This session</option>
              {results.map((r) => (
                <option key={r.id} value={r.id}>{r.label}</option>
              ))}
            </select>
          )}
          <button className="btn primary" onClick={onNew}>New session</button>
        </div>
      </div>

      <section className="card pad recap">
        <div className="recap-pair">
          <div className="recap-record">
            <span className="muted small">On paper</span>
            <strong className="recap-num record">
              {rec.wins}–{rec.losses}{rec.ties ? `–${rec.ties}` : ""}
            </strong>
            <span className="muted small">
              {placeWord(paperPlace[slot])} of {n} · beats {rec.wins} of the other {n - 1} teams
            </span>
          </div>
          {bd && (
            <div className="recap-record">
              <span className="muted small">Week to week</span>
              <strong className="recap-num">{bd.winPct}%</strong>
              <span className="muted small">
                {placeWord(weekPlace[slot])} of {n} · wins {bd.winPct}% of matchups, about {weekRecord(bd.winPct, n - 1)} ·
                best team {Math.max(...view.weekPct)}%, weakest {Math.min(...view.weekPct)}%
              </span>
            </div>
          )}
        </div>
        {bd && <RecapStory view={view} bd={bd} />}
        <div className="grow stack-sm recap-ranks">
          <span className="muted small">Where your team ranks (a conceded category still has a rank)</span>
          <RankStrip ranks={ranks} concedes={concedes} showRanks />
        </div>
        <RankLegend />
      </section>

      {bd && <CategoryCards view={view} bd={bd} playerMap={playerMap} />}

      {isLive && soft && culprit && (
        <section className="hint">
          <div className="grow stack-xs">
            <strong>{soft.c} is your soft spot</strong>
            <span>
              {soft.lost != null
                ? `You'd lose ${soft.c} to ${soft.lost} of the ${n - 1} other teams most weeks (${ordinal(soft.r)} of ${n}).`
                : `You're ${ordinal(soft.r)} in ${soft.c}.`}{" "}
              Rewind to round {culprit.round}, where you took {playerMap.get(culprit.pid)?.name}, and try a
              player who helps {soft.c}.
            </span>
          </div>
          <button className="btn outline-accent" onClick={() => onRewind(culprit.at)}>
            Rewind to pick #{culprit.at + 1}
          </button>
        </section>
      )}

      <DuelsSection view={view} playerMap={playerMap} />

      <div className="report-grid">
        <div className="report-standings">
          <Standings view={view} teams={teams} />
        </div>

        <section className="card pad stack-sm picks-card">
          <h2 className="title">Your picks</h2>
          <ol className="roster">
            {userPicks.map((p) => {
              const pl = playerMap.get(p.pid)!;
              return (
                <li key={p.at}>
                  <span className="muted small rd">Rd {p.round}</span>
                  <Monogram player={pl} variant="avatar" />
                  <span className="grow stack-0">
                    <strong>{pl.name}</strong>
                    <PlayerMeta player={pl} />
                  </span>
                  {isLive && (
                    <button
                      className="link-btn small"
                      title="Rewind to this pick and try someone else"
                      onClick={() => onRewind(p.at)}
                    >
                      Rewind
                    </button>
                  )}
                </li>
              );
            })}
          </ol>
          {!isLive && (
            <p className="muted small">Viewing a saved run. Switch back to “This session” to rewind.</p>
          )}
        </section>
      </div>
    </main>
  );
}

/**
 * Why the two records differ, in one or two lines. The story is picked by
 * league place, not by the raw gap: every paper record overstates, so what
 * matters is whether yours overstates more than the others'.
 */
function RecapStory({ view, bd }: { view: SessionView; bd: DuelBoard }) {
  const slot = view.seat;
  const n = view.teams;
  const rec = view.records[slot];
  const paperPlace = Number(places(view.records.map((r) => r.wins))[slot].replace("T", ""));
  const weekPlace = Number(places(view.weekPct)[slot].replace("T", ""));
  const narrowLeads = Object.entries(bd.tossupLeads)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([c]) => c);
  const lines: string[] = [];

  if (weekPlace - paperPlace >= 2 && rec.wins > 0) {
    lines.push(
      `${bd.oneCategoryWins} of your ${rec.wins} paper wins are 5–4, one category from a loss` +
        (narrowLeads.length ? `, and the leads that carry them are often toss-ups (${andList(narrowLeads)})` : "") +
        `. That's why ${rec.wins}–${rec.losses} plays out closer to ${weekRecord(bd.winPct, n - 1)}.`,
    );
  } else if (paperPlace - weekPlace >= 2) {
    lines.push(
      `On paper you lose ${rec.losses} matchups, but your leads hold up better than theirs: you're favored in ${bd.favored} of ${n - 1} and a toss-up in ${bd.tossup}, about ${weekRecord(bd.winPct, n - 1)} in a typical round.`,
    );
  } else {
    lines.push(
      `Both views agree: favored in ${bd.favored} of ${n - 1} matchups, a toss-up in ${bd.tossup}, an underdog in ${bd.underdog}` +
        (rec.wins ? `; ${bd.oneCategoryWins} of your ${rec.wins} paper wins are 5–4.` : "."),
    );
  }

  const losing = CATEGORIES.filter((c) => bd.categories[c].loss > (n - 1) / 2);
  const conceded = losing.filter((c) => bd.categories[c].conceded);
  const other = losing.filter((c) => !bd.categories[c].conceded);
  if (losing.length) {
    const left = CATEGORIES.length - losing.length;
    const need = left > 5 ? `you need 5 of the other ${left} every week` : left === 5 ? "you need all 5 of the others every week" : "you can't reach 5 without an upset";
    lines.push(
      (conceded.length ? `With ${andList(conceded)} conceded` : "") +
        (other.length ? `${conceded.length ? " and" : "With"} ${andList(other)} against you most weeks` : "") +
        `, ${need}.`,
    );
  }

  return (
    <div className="recap-story stack-xs">
      <p className="body-text">
        On paper you beat a team if you rank higher in more categories, and every lead counts the same.
        Week to week counts how close each category really is: a small lead, or a lead in a category that
        swings a lot (STL, FT%, TO), is closer to a coin flip than a win.
      </p>
      {lines.map((l) => (
        <p key={l} className="body-text lg">▸ {l}</p>
      ))}
      <p className="muted small">
        Both are equal-games comparisons of the drafted rosters, not forecasts: no schedule, no later
        injuries, no lineup moves.
      </p>
    </div>
  );
}

/** Where you win / it's close / where you lose, with the player behind each. */
function CategoryCards({ view, bd, playerMap }: { view: SessionView; bd: DuelBoard; playerMap: Map<string, ApiPlayer> }) {
  const n = view.teams - 1;
  const groups = { win: [] as Category[], close: [] as Category[], loss: [] as Category[] };
  for (const c of CATEGORIES) groups[side(bd.categories[c], n)].push(c);
  groups.win.sort((a, b) => bd.categories[b].win - bd.categories[a].win);
  groups.loss.sort((a, b) => bd.categories[b].loss - bd.categories[a].loss);
  groups.close.sort((a, b) => bd.categories[b].tossup - bd.categories[a].tossup);

  const line = (c: Category) => {
    const s = bd.categories[c];
    const p = s.best ? playerMap.get(s.best.pid) : null;
    const who = p && s.best ? `${lastName(p)} ${deciderStat(c, s.best)}` : null;
    const totals = `you ${formatTotal(c, s.you, null)} vs a typical ${formatTotal(c, s.leagueMedian, null)}`;
    const kind = side(s, n);
    const count =
      kind === "win" ? `likely win vs ${s.win} of ${n}` : kind === "loss" ? `likely loss vs ${s.loss} of ${n}` : `toss-up vs ${s.tossup} of ${n}`;
    const why =
      c === "TO"
        ? who ? `${who} is your biggest source` : ""
        : kind === "loss"
          ? who ? `your best is ${who}` : ""
          : who ? `${who} carries it` : "";
    return (
      <li key={c} className="cat-line">
        <span className={`look ${kind === "close" ? "tossup" : kind}`}>{c}{s.conceded ? " · conceded" : ""}</span>
        <span className="small">
          <strong className="ink">{count}</strong> — {totals}{why ? `; ${why}` : ""}.
        </span>
      </li>
    );
  };

  return (
    <div className="win-lose three">
      <div className="card pad stack-sm">
        <strong>Where you win</strong>
        {groups.win.length ? <ul className="cat-lines">{groups.win.map(line)}</ul> : <span className="muted">No category you'd win against most of the league.</span>}
      </div>
      <div className="card pad stack-sm">
        <strong>Where it's close</strong>
        {groups.close.length ? <ul className="cat-lines">{groups.close.map(line)}</ul> : <span className="muted">Nothing hangs in the balance.</span>}
      </div>
      <div className="card pad stack-sm">
        <strong>Where you lose</strong>
        {groups.loss.length ? <ul className="cat-lines">{groups.loss.map(line)}</ul> : <span className="muted">No category you'd lose to most of the league.</span>}
      </div>
    </div>
  );
}
