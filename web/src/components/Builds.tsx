import { Fragment, useState } from "react";
import {
  CATEGORIES,
  type ApiPlayer,
  type BuildAlternative,
  type BuildOption,
  type Advice,
  type Category,
  type SessionView,
} from "../api/client";
import { andList, ordinal, weekRecord, winRate } from "../state/squads";
import { Monogram, PairingNotes, PlayerMeta, RankLegend, RankStrip, Stars, initials, valueTier } from "./ui";


interface Props {
  view: SessionView;
  playerMap: Map<string, ApiPlayer>;
  result: Advice | null; // null while simulations run
  onPick: (pid: string, concede: Category | null) => void;
  onBrowse: () => void;
}

/** Look-ahead verdicts: "gone" above GONE_SURE, "can wait" below WAIT_SURE, the share itself in between. */
const GONE_THRESHOLD = 0.5;
const GONE_SURE = 0.75;
const WAIT_SURE = 0.25;
/** A top tier wider than this isn't a shortlist; the headline says the sims can't separate it. */
const WIDE_TIE = 6;
/** A build is scored over one week against each other team. */
const MATCHUPS = 11;
/** Expected duel wins as the share of weekly matchups won — the unit shown everywhere. */
const rate = (wins: number) => winRate(wins, MATCHUPS);
const tiePoints = (tieWins: number) => Math.round((tieWins / MATCHUPS) * 100);
/** "+4 vs the market's pick" — the option against the yardstick, in points of win rate. */
function vsMarket(o: BuildOption, result: Advice): { text: string; short: string; tone: "up" | "down" | "even" | "market" } | null {
  const c = result.consensus;
  if (!c) return null;
  if (c.pid === o.pid && c.concede === o.concede) return { text: "the market's pick", short: "market pick", tone: "market" };
  const d = rate(o.wins) - rate(c.wins);
  if (d === 0) return { text: "same as the market's pick", short: "= market pick", tone: "even" };
  const sign = d > 0 ? "+" : "−";
  return { text: `${sign}${Math.abs(d)} vs the market's pick`, short: `${sign}${Math.abs(d)} vs market`, tone: d > 0 ? "up" : "down" };
}

function lastName(p: ApiPlayer): string {
  return p.name.split(" ").slice(1).join(" ") || initials(p.name);
}

function buildLabel(concede: Category | null, keeps: boolean, current: Category | null): string {
  if (concede === null) return current ? "Drop the concede" : "No concede";
  return keeps ? `Keeps concede ${concede}` : current ? `Switch to concede ${concede}` : `Concede ${concede}`;
}

/** Cards across the top: the best few options, the rest go in the list below. */
const CARDS = 4;

/** A filter key per build: "none" for no concede. */
type BuildKey = string;
const keyOf = (concede: Category | null): BuildKey => concede ?? "none";

/**
 * One way to make this pick: a player under a build. Usually his best build
 * (`option` as the sims returned it); under a build filter it can be his
 * best player-for-that-build alternative, with that build's wins.
 */
interface Entry {
  option: BuildOption; // what drafting him this way would be
  best: BuildOption; // his best build, as listed
  isAlt: boolean;
}

function altOption(b: BuildAlternative, own: BuildOption): BuildOption {
  return { ...own, concede: b.concede, keepsConcede: b.keepsConcede, wins: b.wins, runs: b.runs, winsRange: b.winsRange, finishRanks: null };
}

/** The entries under a build filter: players whose best build it is, plus the best player for it when his best is something else. */
function entriesFor(result: Advice, filter: BuildKey | "all"): Entry[] {
  const own = new Map(result.options.map((o) => [o.pid, o]));
  if (filter === "all") return result.options.map((o) => ({ option: o, best: o, isAlt: false }));
  const entries: Entry[] = result.options
    .filter((o) => keyOf(o.concede) === filter)
    .map((o) => ({ option: o, best: o, isAlt: false }));
  for (const b of result.builds) {
    const o = own.get(b.pid);
    if (keyOf(b.concede) !== filter || !o || keyOf(o.concede) === filter) continue;
    entries.push({ option: altOption(b, o), best: o, isAlt: true });
  }
  return entries.sort((a, b) => b.option.wins - a.option.wins);
}

export function Builds({ view, playerMap, result, onPick, onBrowse }: Props) {
  const [sel, setSel] = useState<{ id: string; concede: Category | null } | null>(null);
  const [filter, setFilter] = useState<BuildKey | "all">("all");
  const slot = view.seat;
  const first = view.selections.find((p) => p.squad === slot) ?? null;
  const firstPlayer = first ? playerMap.get(first.pid)! : null;
  const stage = firstPlayer ? "second" : "first";
  const current = view.concedes[0] ?? null;
  const concedes = new Set<Category>(view.concedes);

  const options = result?.options ?? null;
  const entries = result ? entriesFor(result, filter) : [];
  const chosen: BuildOption | null = (() => {
    if (!result || !options?.length) return null;
    if (sel) {
      const o = options.find((x) => x.pid === sel.id);
      if (o && o.concede === sel.concede) return o;
      const b = result.builds.find((x) => x.pid === sel.id && x.concede === sel.concede);
      if (o && b) return altOption(b, o);
    }
    return entries[0]?.option ?? options[0];
  })();
  const chosenPlayer = chosen ? playerMap.get(chosen.pid) : null;
  const pick = (o: BuildOption) => setSel({ id: o.pid, concede: o.concede });

  return (
    <main className="room build-room">
      <div className="build-main">
        <header className="build-head">
          <span className="eyebrow-accent">
            Pick #{view.atPick + 1} · Round {view.round} · Step {stage === "first" ? 1 : 2} of 2
            {current && <span className="chip dark">Concede {current}</span>}
          </span>
          <h1 className="build-title">{stage === "first" ? "Your first pick sets your build" : "Finish your build"}</h1>
          <p className="build-headline">
            {result ? (
              <Headline result={result} playerMap={playerMap} />
            ) : stage === "first" ? (
              "Every player in range at this pick is being tested: each one taken here, the rest of the session played out against these rivals, under no concede and the concedes that suit him."
            ) : (
              "Every player in range at this pick is being tested next to your first pick, under the concedes that suit the pair."
            )}
          </p>
        </header>
        {!result ? (
          <div className="card loading-card" role="status">
            <span className="spinner" aria-hidden="true" />
            Simulating drafts for every player in range…
          </div>
        ) : !options || options.length === 0 ? (
          <div className="card loading-card">
            <span className="body-text">
              Couldn't simulate builds for this spot — draft from the full board instead.
            </span>
            <button className="btn primary" onClick={onBrowse}>
              Browse all players
            </button>
          </div>
        ) : (
          <>
            <TopCards
              result={result}
              playerMap={playerMap}
              entries={entries}
              current={current}
              chosen={chosen}
              onSelect={pick}
            />
            <BuildFilters result={result} filter={filter} current={current} onFilter={setFilter} />
            <OptionList
              result={result}
              playerMap={playerMap}
              entries={entries}
              current={current}
              chosen={chosen}
              onSelect={pick}
            />
            <p className="muted small build-foot">
              {result.tested} players tested — everyone the draft expects to go around pick #{result.pick}.
              Looking for someone else?{" "}
              <button className="link-btn inline" onClick={onBrowse}>
                Browse all players
              </button>
            </p>
          </>
        )}
      </div>
      <aside className="build-side">
        {chosen && chosenPlayer && result ? (
          <OptionDetail
            o={chosen}
            p={chosenPlayer}
            playerMap={playerMap}
            firstPlayer={firstPlayer}
            current={current}
            result={result}
            onPick={() => onPick(chosen.pid, chosen.concede)}
          />
        ) : (
          <section className="card build-detail skeleton" aria-hidden="true">
            <div className="team-line">
              <span className="skel avatar" />
              <span className="stack-xs grow">
                <span className="skel line w60" />
                <span className="skel line w40" />
              </span>
            </div>
            <span className="skel line w30 tall" />
            <span className="skel line" />
            <span className="skel line w80" />
            <span className="skel block" />
          </section>
        )}
        <TeamSoFar view={view} firstPlayer={firstPlayer} concedes={concedes} result={result} />
        <RankLegend />
      </aside>
    </main>
  );
}

/** One sentence that says what the simulations can and can't tell you here. */
function Headline({ result, playerMap }: { result: Advice; playerMap: Map<string, ApiPlayer> }) {
  const top = result.options.filter((o) => o.tier === 1);
  if (top.length === 0) return null;
  const best = top[0];
  const bestP = playerMap.get(best.pid)!;
  const backToBack = result.nextPick != null && result.nextPick === result.pick + 1;
  const goneCount = top.filter((o) => (o.gone ?? 0) >= GONE_THRESHOLD).length;
  const consensus = result.consensus ? playerMap.get(result.consensus.pid) : null;
  const lo = Math.min(...top.map((o) => o.wins));
  const hi = Math.max(...top.map((o) => o.wins));

  if (top.length === 1) {
    const next = result.options[1];
    return (
      <>
        <strong>{bestP.name}</strong> is the best tested here: the team you'd finish with wins {rate(best.wins)}% of its weeks
        {next ? `, ${rate(best.wins) - rate(next.wins)} points clear of the next option` : ""}.
        {best.gone != null && best.gone >= GONE_THRESHOLD && result.nextPick != null && !backToBack
          ? ` He won't be there at #${result.nextPick}.`
          : ""}
      </>
    );
  }
  const names = top.slice(0, 3).map((o) => lastName(playerMap.get(o.pid)!));
  const listed = top.length > 3 ? `${names.join(", ")} and ${top.length - 3} more` : andList(names);
  const market = consensus
    ? consensus.id === best.pid
      ? `${lastName(consensus)} is the market's pick.`
      : `The market's pick is ${lastName(consensus)}.`
    : "";
  if (top.length > WIDE_TIE) {
    // Most of the range is a wash: say so, and point at what decides the pick.
    return (
      <>
        <strong>The simulations can't separate the top {top.length} here</strong> (the team you'd finish with wins {rate(lo)}–
        {rate(hi)}% of its weeks whichever you take), so this pick is about{" "}
        {backToBack
          ? `the build you want — you pick again right after this one (#${result.nextPick}), so take any two.`
          : goneCount > 0 && result.nextPick != null
            ? `who won't be there at #${result.nextPick} (${goneCount} of them) and the build you want.`
            : "the build you want."}{" "}
        {market}
      </>
    );
  }
  return (
    <>
      <strong>
        {top.length} players are a toss-up
      </strong>{" "}
      by the simulations (the team you'd finish with wins {rate(lo)}–{rate(hi)}% of its weeks): {listed}.{" "}
      {backToBack
        ? `You pick again right after this one (#${result.nextPick}), so nobody here is gone — take any two.`
        : goneCount > 0 && result.nextPick != null
          ? `${goneCount === top.length ? "None of them" : `Only ${top.length - goneCount} of them`} will still be there at #${result.nextPick}.`
          : result.nextPick != null
            ? `They should all still be there at #${result.nextPick}.`
            : ""}
      {market && <> {market}</>}
    </>
  );
}

function TeamSoFar({
  view,
  firstPlayer,
  concedes,
  result,
}: {
  view: SessionView;
  firstPlayer: ApiPlayer | null;
  concedes: ReadonlySet<Category>;
  result: Advice | null;
}) {
  const slot = view.seat;
  const pick = view.atPick + 1;
  if (!firstPlayer) {
    return (
      <div className="card pad stack-sm">
        <span className="muted small">Your slot</span>
        <strong className="title">
          Pick #{pick} of {view.span}
          {result?.nextPick != null && <span className="muted"> · then #{result.nextPick}</span>}
        </strong>
        <span className="muted small">
          The percentage on each option is not the player's: it's the team you'd finish with if you
          take him now and draft by Fit from here — the share of its weekly matchups it wins against
          these {MATCHUPS} rivals, averaged over simulated drafts. The market's pick is the yardstick;
          within {tiePoints(result?.tieWins ?? 0.3)} points of each other is a toss-up.
        </span>
      </div>
    );
  }
  const ranksNow = CATEGORIES.map((c) => view.ranks[c][slot]);
  const covered = CATEGORIES.filter((c, j) => !concedes.has(c) && ranksNow[j] <= 3);
  const thin = CATEGORIES.filter((c, j) => !concedes.has(c) && ranksNow[j] >= view.teams - 2);
  const concede = view.concedes[0] ?? null;
  return (
    <div className="card pad stack-sm">
      <div className="team-line">
        <Monogram player={firstPlayer} variant="avatar" />
        <span className="stack-xs grow">
          <span className="muted small">Your team so far</span>
          <strong>{firstPlayer.name}</strong>
        </span>
        {concede && <span className="chip dark">Concede {concede}</span>}
      </div>
      <RankStrip ranks={ranksNow} concedes={concedes} size="sm" />
      <span className="muted small">
        {covered.length > 0 && <>{lastName(firstPlayer)} covers {andList(covered)}. </>}
        {thin.length > 0 && <>Brings little {andList(thin)} — one pick settles nothing.</>}
      </span>
    </div>
  );
}

function goneLabel(gone: number | null, nextPick: number | null, backToBack: boolean) {
  if (backToBack || nextPick == null || gone == null) return <span className="muted small">—</span>;
  const pct = Math.round(gone * 100);
  if (gone >= GONE_SURE)
    return <span className="chip orange-soft" title={`Drafted before #${nextPick} in ${pct}% of look-ahead runs`}>gone by #{nextPick}</span>;
  if (gone <= WAIT_SURE)
    return <span className="chip wait" title={`Still there at #${nextPick} in ${100 - pct}% of look-ahead runs`}>can wait</span>;
  return <span className="chip" title={`Drafted before #${nextPick} in ${pct}% of look-ahead runs — a coin flip`}>{pct}% gone by #{nextPick}</span>;
}

/** Wins on a bar: the bar spans the tested range, so small gaps still show. */
function winsScale(result: Advice) {
  const ws = result.options.map((o) => o.wins).concat(result.builds.map((b) => b.wins));
  const hi = Math.max(...ws);
  const lo = Math.min(...ws) - 0.3;
  return (w: number) => `${Math.max(4, ((w - lo) / Math.max(hi - lo, 0.1)) * 100)}%`;
}

function TopCards({
  result,
  playerMap,
  entries,
  current,
  chosen,
  onSelect,
}: {
  result: Advice;
  playerMap: Map<string, ApiPlayer>;
  entries: Entry[];
  current: Category | null;
  chosen: BuildOption | null;
  onSelect: (o: BuildOption) => void;
}) {
  const { options, nextPick, pick } = result;
  const backToBack = nextPick != null && nextPick === pick + 1;
  const bar = winsScale(result);
  const cards = options.slice(0, CARDS);
  const topCount = options.filter((o) => o.tier === 1).length;
  return (
    <section className="build-cards-wrap" aria-label="Top options">
      <div className="build-section-head">
        <strong>{topCount > 1 ? "Toss-up for the top spot" : "The best tested here"}</strong>
        <span className="muted small">
          {topCount > CARDS
            ? `the best ${CARDS} of ${topCount} within ${tiePoints(result.tieWins)} points of each other`
            : topCount > 1
              ? `within ${tiePoints(result.tieWins)} points of each other`
              : "by the finished team's share of weeks won"}
        </span>
      </div>
      <div className="build-cards" role="radiogroup" aria-label="Top options at this pick">
        {cards.map((best) => {
          const p = playerMap.get(best.pid)!;
          // Under a build filter the card shows that build, or fades if he has none.
          const entry = entries.find((e) => e.option.pid === best.pid);
          const o = entry?.option ?? best;
          const selected = chosen?.pid === o.pid && chosen.concede === o.concede;
          const tier = valueTier(p.marketRank);
          return (
            <button
              key={best.pid}
              role="radio"
              aria-checked={selected}
              className={["build-card", selected ? "selected" : "", entry ? "" : "dim"].join(" ").trim()}
              onClick={() => onSelect(o)}
            >
              <span className="build-card-photo">
                <Monogram player={p} variant="tile" />
                {p.marketRank != null && <span className="photo-tag">#{p.marketRank} overall</span>}
                {selected && (
                  <span className="photo-check" aria-hidden="true">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><path d="M5 12l5 5 9-10" /></svg>
                  </span>
                )}
              </span>
              <span className="build-card-body">
                <span className="build-card-id">
                  <strong className="clamp" title={p.name}>{p.name}</strong>
                  <span className="muted small clamp">
                    <PlayerMeta player={p} /> · <Stars count={tier.stars} />
                  </span>
                </span>
                <span className="build-card-wins">
                  <strong>{rate(o.wins)}%</strong>
                  <span className="stack-0">
                    <span className="muted small">of weeks, finished team</span>
                    {vsMarket(o, result) && <span className={`small vs ${vsMarket(o, result)!.tone}`}>{vsMarket(o, result)!.text}</span>}
                  </span>
                </span>
                <span className="meter dark"><span style={{ width: bar(o.wins) }} /></span>
                <span className="build-card-chips">
                  <span className={o.concede ? "chip dark" : "chip"}>{buildLabel(o.concede, o.keepsConcede, current)}</span>
                  {goneLabel(o.gone, nextPick, backToBack)}
                </span>
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}

/** One chip per build the sims tried, with how many tested players suit it. */
function BuildFilters({
  result,
  filter,
  current,
  onFilter,
}: {
  result: Advice;
  filter: BuildKey | "all";
  current: Category | null;
  onFilter: (f: BuildKey | "all") => void;
}) {
  const builds: { key: BuildKey; concede: Category | null }[] = [];
  for (const concede of [...result.options.map((o) => o.concede), ...result.builds.map((b) => b.concede)]) {
    if (!builds.some((b) => b.key === keyOf(concede))) builds.push({ key: keyOf(concede), concede });
  }
  // No concede first, then the concedes in category order.
  builds.sort((a, b) => (a.concede === null ? -1 : b.concede === null ? 1 : CATEGORIES.indexOf(a.concede) - CATEGORIES.indexOf(b.concede)));
  if (builds.length < 2) return null;
  const chip = (key: BuildKey | "all", label: string, count: number, title?: string) => (
    <button
      key={key}
      className={filter === key ? "filter-chip on" : "filter-chip"}
      aria-pressed={filter === key}
      title={title}
      onClick={() => onFilter(key)}
    >
      {label}
      <span className="filter-count">{count}</span>
    </button>
  );
  return (
    <div className="build-filters" role="group" aria-label="Filter by build">
      <span className="build-filters-label">Build</span>
      {chip("all", "All", result.options.length)}
      {builds.map((b) => {
        const es = entriesFor(result, b.key);
        const top = es[0]?.option.wins;
        return chip(
          b.key,
          buildLabel(b.concede, b.concede === current, current),
          es.length,
          top != null ? `Best under this build: wins ${rate(top)}% of matchups` : undefined,
        );
      })}
    </div>
  );
}

const LIST_TIER_LABELS = ["Also a toss-up", "A step behind", "Further back"];

function OptionList({
  result,
  playerMap,
  entries,
  current,
  chosen,
  onSelect,
}: {
  result: Advice;
  playerMap: Map<string, ApiPlayer>;
  entries: Entry[];
  current: Category | null;
  chosen: BuildOption | null;
  onSelect: (o: BuildOption) => void;
}) {
  const { nextPick, pick } = result;
  const backToBack = nextPick != null && nextPick === pick + 1;
  const bar = winsScale(result);
  const carded = new Set(result.options.slice(0, CARDS).map((o) => o.pid));
  const rows = entries.filter((e) => !carded.has(e.option.pid));
  return (
    <div className="card build-list" role="radiogroup" aria-label="Other players in range at this pick">
      {rows.length === 0 && (
        <p className="build-empty muted">No other tested player suits this build at #{pick}.</p>
      )}
      {rows.map(({ option: o, best, isAlt }, i) => {
        const p = playerMap.get(o.pid)!;
        const t = Math.min(best.tier, 3);
        const tierStart = i === 0 || Math.min(rows[i - 1].best.tier, 3) !== t;
        const selected = chosen?.pid === o.pid && chosen.concede === o.concede;
        const tier = valueTier(p.marketRank);
        return (
          <Fragment key={`${o.pid}|${keyOf(o.concede)}`}>
            {tierStart && (
              <div className={`build-tier t${t}`} aria-hidden="true">
                {LIST_TIER_LABELS[t - 1]}
              </div>
            )}
            <div
              role="radio"
              aria-checked={selected}
              tabIndex={0}
              className={["build-row", selected ? "selected" : ""].join(" ").trim()}
              onClick={() => onSelect(o)}
              onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onSelect(o); } }}
            >
              <Monogram player={p} variant="avatar" />
              <span className="build-name">
                <strong>{p.name}</strong>
                <span className="muted small">
                  <PlayerMeta player={p} />
                  {" · "}
                  <Stars count={tier.stars} />
                  {p.marketRank != null && ` #${p.marketRank}`}
                </span>
              </span>
              <span className="build-plan">
                <span className={o.concede ? "chip dark" : "chip"}>{buildLabel(o.concede, o.keepsConcede, current)}</span>
                {isAlt && (
                  <span className="muted small">best: {buildLabel(best.concede, best.keepsConcede, current)} {rate(best.wins)}%</span>
                )}
              </span>
              <span className="build-wins">
                <span className="meter dark"><span style={{ width: bar(o.wins) }} /></span>
                <strong>{rate(o.wins)}%</strong>
                <span className={`small vs ${vsMarket(o, result)?.tone ?? ""}`} title={vsMarket(o, result)?.text}>{vsMarket(o, result)?.short ?? ""}</span>
              </span>
              <span className="build-status">{goneLabel(o.gone, nextPick, backToBack)}</span>
            </div>
          </Fragment>
        );
      })}
    </div>
  );
}

function OptionDetail({
  o,
  p,
  playerMap,
  firstPlayer,
  current,
  result,
  onPick,
}: {
  o: BuildOption;
  p: ApiPlayer;
  playerMap: Map<string, ApiPlayer>;
  firstPlayer: ApiPlayer | null;
  current: Category | null;
  result: Advice;
  onPick: () => void;
}) {
  const concedes = new Set<Category>(o.concede ? [o.concede] : []);
  const nextPick = result.nextPick;
  const backToBack = nextPick != null && nextPick === result.pick + 1;
  const listed = result.options.find((x) => x.pid === o.pid);
  const isAlt = !!listed && listed.concede !== o.concede;
  const rank = listed ? result.options.indexOf(listed) + 1 : 0;
  return (
    <section className="card build-detail">
      <div className="team-line">
        <Monogram player={p} variant="avatar" />
        <span className="stack-xs grow">
          <strong className="title clamp" title={p.name}>{p.name}</strong>
          <span className="muted small"><PlayerMeta player={p} /></span>
        </span>
        <span className={o.concede ? "chip dark" : "chip"}>{buildLabel(o.concede, o.keepsConcede, current)}</span>
      </div>
      <div className="wins-row">
        <strong className="title-lg">{rate(o.wins)}%</strong>
        <span className="stack-0">
          <span className="small ink">
            of weeks won by the team you'd finish with
            {vsMarket(o, result) ? <> · <span className={`vs ${vsMarket(o, result)!.tone}`}>{vsMarket(o, result)!.text}</span></> : null}
          </span>
          <span className="muted small">
            About {weekRecord(rate(o.wins), MATCHUPS)} in a round against the league
            {o.winsRange ? ` · ${rate(o.winsRange[0])}–${rate(o.winsRange[1])}% across ${o.runs} test drafts` : ""}
            {isAlt
              ? ` · his best build is ${buildLabel(listed!.concede, listed!.keepsConcede, current).toLowerCase()} (${rate(listed!.wins)}%)`
              : ` · ${ordinal(rank)} of ${result.tested}${o.tier === 1 ? ", in the top tier" : ""}`}
          </span>
        </span>
      </div>
      <PairingNotes why={o.why} anchor={firstPlayer?.name ?? null} concede={o.concede} />
      {o.gone != null && nextPick != null && (
        <span className={o.gone >= GONE_THRESHOLD && !backToBack ? "small ink" : "muted small"}>
          {backToBack
            ? `You pick again right after this one (#${nextPick}).`
            : o.gone >= 0.99
              ? `Gone before #${nextPick} in every look-ahead run — now or never.`
              : o.gone <= 0.01
                ? `Still there at #${nextPick} in every look-ahead run — you can wait on him.`
                : `Gone before #${nextPick} in ${Math.round(o.gone * 100)}% of look-ahead runs.`}
        </span>
      )}
      {o.finishRanks && (
        <div className="stack-sm">
          <span className="muted small">Where the build finishes</span>
          <RankStrip ranks={o.finishRanks} concedes={concedes} size="sm" />
        </div>
      )}
      {o.nextOptions.length > 0 && nextPick != null && (
        <div className="stack-sm">
          <span className="muted small">Then likely at #{nextPick}</span>
          <span className="mini-chips">
            {o.nextOptions.map((id) => {
              const n = playerMap.get(id)!;
              return (
                <span key={id} className="mini-chip">
                  <Monogram player={n} variant="mini" />
                  {n.name}
                </span>
              );
            })}
          </span>
        </div>
      )}
      <span className="muted small">
        {o.concede
          ? `After this pick, Fit plans around a ${o.concede} concede; the plan keeps following your roster from there.`
          : "Fit stays balanced; a concede is suggested if your roster develops one."}
      </span>
      <button className="btn primary xl" onClick={onPick}>
        Draft {lastName(p)}
      </button>
    </section>
  );
}
