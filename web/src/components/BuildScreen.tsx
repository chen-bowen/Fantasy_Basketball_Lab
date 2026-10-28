import { Fragment, useState } from "react";
import {
  CATEGORIES,
  type ApiPlayer,
  type BuildAlternative,
  type BuildOption,
  type BuildOptions,
  type Category,
  type DraftView,
} from "../api/client";
import { andList, ordinal } from "../state/teams";
import { Headshot, PairingNotes, PlayerMeta, RankLegend, RankStrip, Stars, initials, valueTier } from "./common";


interface Props {
  view: DraftView;
  playerMap: Map<string, ApiPlayer>;
  result: BuildOptions | null; // null while simulations run
  onDraft: (playerId: string, punt: Category | null) => void;
  onBrowse: () => void;
}

/** Look-ahead verdicts: "gone" above GONE_SURE, "can wait" below WAIT_SURE, the share itself in between. */
const GONE_THRESHOLD = 0.5;
const GONE_SURE = 0.75;
const WAIT_SURE = 0.25;
/** A top tier wider than this isn't a shortlist; the headline says the sims can't separate it. */
const WIDE_TIE = 6;

function lastName(p: ApiPlayer): string {
  return p.name.split(" ").slice(1).join(" ") || initials(p.name);
}

function buildLabel(punt: Category | null, keeps: boolean, current: Category | null): string {
  if (punt === null) return current ? "Drop the punt" : "No punt";
  return keeps ? `Keeps punt ${punt}` : current ? `Switch to punt ${punt}` : `Punt ${punt}`;
}

/** Cards across the top: the best few options, the rest go in the list below. */
const CARDS = 4;

/** A filter key per build: "none" for no punt. */
type BuildKey = string;
const keyOf = (punt: Category | null): BuildKey => punt ?? "none";

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
  return { ...own, punt: b.punt, keepsPunt: b.keepsPunt, wins: b.wins, runs: b.runs, winsRange: b.winsRange, finishRanks: null };
}

/** The entries under a build filter: players whose best build it is, plus the best player for it when his best is something else. */
function entriesFor(result: BuildOptions, filter: BuildKey | "all"): Entry[] {
  const own = new Map(result.options.map((o) => [o.playerId, o]));
  if (filter === "all") return result.options.map((o) => ({ option: o, best: o, isAlt: false }));
  const entries: Entry[] = result.options
    .filter((o) => keyOf(o.punt) === filter)
    .map((o) => ({ option: o, best: o, isAlt: false }));
  for (const b of result.builds) {
    const o = own.get(b.playerId);
    if (keyOf(b.punt) !== filter || !o || keyOf(o.punt) === filter) continue;
    entries.push({ option: altOption(b, o), best: o, isAlt: true });
  }
  return entries.sort((a, b) => b.option.wins - a.option.wins);
}

export function BuildScreen({ view, playerMap, result, onDraft, onBrowse }: Props) {
  const [sel, setSel] = useState<{ id: string; punt: Category | null } | null>(null);
  const [filter, setFilter] = useState<BuildKey | "all">("all");
  const slot = view.userSlot;
  const first = view.picks.find((p) => p.teamId === slot) ?? null;
  const firstPlayer = first ? playerMap.get(first.playerId)! : null;
  const stage = firstPlayer ? "second" : "first";
  const current = view.userPunts[0] ?? null;
  const punts = new Set<Category>(view.userPunts);

  const options = result?.options ?? null;
  const entries = result ? entriesFor(result, filter) : [];
  const chosen: BuildOption | null = (() => {
    if (!result || !options?.length) return null;
    if (sel) {
      const o = options.find((x) => x.playerId === sel.id);
      if (o && o.punt === sel.punt) return o;
      const b = result.builds.find((x) => x.playerId === sel.id && x.punt === sel.punt);
      if (o && b) return altOption(b, o);
    }
    return entries[0]?.option ?? options[0];
  })();
  const chosenPlayer = chosen ? playerMap.get(chosen.playerId) : null;
  const pick = (o: BuildOption) => setSel({ id: o.playerId, punt: o.punt });

  return (
    <main className="room build-room">
      <div className="build-main">
        <header className="build-head">
          <span className="eyebrow-accent">
            Pick #{view.pickIndex + 1} · Round {view.round} · Step {stage === "first" ? 1 : 2} of 2
            {current && <span className="chip dark">Punt {current}</span>}
          </span>
          <h1 className="build-title">{stage === "first" ? "Your first pick sets your build" : "Finish your build"}</h1>
          <p className="build-headline">
            {result ? (
              <Headline result={result} playerMap={playerMap} />
            ) : stage === "first" ? (
              "Every player in range at this pick is being tested: each one taken here, the rest of the draft played out against these bots, under no punt and the punts that suit him."
            ) : (
              "Every player in range at this pick is being tested next to your first pick, under the punts that suit the pair."
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
            onDraft={() => onDraft(chosen.playerId, chosen.punt)}
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
        <TeamSoFar view={view} firstPlayer={firstPlayer} punts={punts} result={result} />
        <RankLegend />
      </aside>
    </main>
  );
}

/** One sentence that says what the simulations can and can't tell you here. */
function Headline({ result, playerMap }: { result: BuildOptions; playerMap: Map<string, ApiPlayer> }) {
  const top = result.options.filter((o) => o.tier === 1);
  if (top.length === 0) return null;
  const best = top[0];
  const bestP = playerMap.get(best.playerId)!;
  const backToBack = result.nextPick != null && result.nextPick === result.pick + 1;
  const goneCount = top.filter((o) => (o.gone ?? 0) >= GONE_THRESHOLD).length;
  const consensus = result.consensus ? playerMap.get(result.consensus.playerId) : null;
  const lo = Math.min(...top.map((o) => o.wins));
  const hi = Math.max(...top.map((o) => o.wins));

  if (top.length === 1) {
    const next = result.options[1];
    return (
      <>
        <strong>{bestP.name}</strong> is the best tested here: {best.wins.toFixed(1)} wins of 11
        {next ? `, ${(best.wins - next.wins).toFixed(1)} clear of the next option` : ""}.
        {best.gone != null && best.gone >= GONE_THRESHOLD && result.nextPick != null && !backToBack
          ? ` He won't be there at #${result.nextPick}.`
          : ""}
      </>
    );
  }
  const names = top.slice(0, 3).map((o) => lastName(playerMap.get(o.playerId)!));
  const listed = top.length > 3 ? `${names.join(", ")} and ${top.length - 3} more` : andList(names);
  const market = consensus
    ? consensus.id === best.playerId
      ? `${lastName(consensus)} is the market's pick.`
      : `The market's pick is ${lastName(consensus)}.`
    : "";
  if (top.length > WIDE_TIE) {
    // Most of the range is a wash: say so, and point at what decides the pick.
    return (
      <>
        <strong>The simulations can't separate the top {top.length} here</strong> ({lo.toFixed(1)}–
        {hi.toFixed(1)} wins of 11), so this pick is about{" "}
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
      by the simulations ({lo.toFixed(1)}–{hi.toFixed(1)} wins of 11): {listed}.{" "}
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
  punts,
  result,
}: {
  view: DraftView;
  firstPlayer: ApiPlayer | null;
  punts: ReadonlySet<Category>;
  result: BuildOptions | null;
}) {
  const slot = view.userSlot;
  const pick = view.pickIndex + 1;
  if (!firstPlayer) {
    return (
      <div className="card pad stack-sm">
        <span className="muted small">Your slot</span>
        <strong className="title">
          Pick #{pick} of {view.totalPicks}
          {result?.nextPick != null && <span className="muted"> · then #{result.nextPick}</span>}
        </strong>
        <span className="muted small">
          Wins are expected weekly-matchup wins of 11, averaged over simulated drafts against
          these bots. Within {result?.tieWins ?? 0.3} of each other is a toss-up.
        </span>
      </div>
    );
  }
  const ranksNow = CATEGORIES.map((c) => view.ranks[c][slot]);
  const covered = CATEGORIES.filter((c, j) => !punts.has(c) && ranksNow[j] <= 3);
  const thin = CATEGORIES.filter((c, j) => !punts.has(c) && ranksNow[j] >= view.numTeams - 2);
  const punt = view.userPunts[0] ?? null;
  return (
    <div className="card pad stack-sm">
      <div className="team-line">
        <Headshot player={firstPlayer} variant="avatar" />
        <span className="stack-xs grow">
          <span className="muted small">Your team so far</span>
          <strong>{firstPlayer.name}</strong>
        </span>
        {punt && <span className="chip dark">Punt {punt}</span>}
      </div>
      <RankStrip ranks={ranksNow} punts={punts} size="sm" />
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
function winsScale(result: BuildOptions) {
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
  result: BuildOptions;
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
            ? `the best ${CARDS} of ${topCount} within ${result.tieWins} wins of each other`
            : topCount > 1
              ? `within ${result.tieWins} wins of each other`
              : "by expected wins"}
        </span>
      </div>
      <div className="build-cards" role="radiogroup" aria-label="Top options at this pick">
        {cards.map((best) => {
          const p = playerMap.get(best.playerId)!;
          // Under a build filter the card shows that build, or fades if he has none.
          const entry = entries.find((e) => e.option.playerId === best.playerId);
          const o = entry?.option ?? best;
          const selected = chosen?.playerId === o.playerId && chosen.punt === o.punt;
          const tier = valueTier(p.overallRank);
          return (
            <button
              key={best.playerId}
              role="radio"
              aria-checked={selected}
              className={["build-card", selected ? "selected" : "", entry ? "" : "dim"].join(" ").trim()}
              onClick={() => onSelect(o)}
            >
              <span className="build-card-photo">
                <Headshot player={p} variant="tile" />
                {p.overallRank != null && <span className="photo-tag">#{p.overallRank} overall</span>}
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
                  <strong>{o.wins.toFixed(1)}</strong>
                  <span className="muted small">wins of 11</span>
                </span>
                <span className="meter dark"><span style={{ width: bar(o.wins) }} /></span>
                <span className="build-card-chips">
                  <span className={o.punt ? "chip dark" : "chip"}>{buildLabel(o.punt, o.keepsPunt, current)}</span>
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
  result: BuildOptions;
  filter: BuildKey | "all";
  current: Category | null;
  onFilter: (f: BuildKey | "all") => void;
}) {
  const builds: { key: BuildKey; punt: Category | null }[] = [];
  for (const punt of [...result.options.map((o) => o.punt), ...result.builds.map((b) => b.punt)]) {
    if (!builds.some((b) => b.key === keyOf(punt))) builds.push({ key: keyOf(punt), punt });
  }
  // No punt first, then the punts in category order.
  builds.sort((a, b) => (a.punt === null ? -1 : b.punt === null ? 1 : CATEGORIES.indexOf(a.punt) - CATEGORIES.indexOf(b.punt)));
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
          buildLabel(b.punt, b.punt === current, current),
          es.length,
          top != null ? `Best under this build: ${top.toFixed(1)} wins` : undefined,
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
  result: BuildOptions;
  playerMap: Map<string, ApiPlayer>;
  entries: Entry[];
  current: Category | null;
  chosen: BuildOption | null;
  onSelect: (o: BuildOption) => void;
}) {
  const { nextPick, pick } = result;
  const backToBack = nextPick != null && nextPick === pick + 1;
  const bar = winsScale(result);
  const carded = new Set(result.options.slice(0, CARDS).map((o) => o.playerId));
  const rows = entries.filter((e) => !carded.has(e.option.playerId));
  return (
    <div className="card build-list" role="radiogroup" aria-label="Other players in range at this pick">
      {rows.length === 0 && (
        <p className="build-empty muted">No other tested player suits this build at #{pick}.</p>
      )}
      {rows.map(({ option: o, best, isAlt }, i) => {
        const p = playerMap.get(o.playerId)!;
        const t = Math.min(best.tier, 3);
        const tierStart = i === 0 || Math.min(rows[i - 1].best.tier, 3) !== t;
        const selected = chosen?.playerId === o.playerId && chosen.punt === o.punt;
        const tier = valueTier(p.overallRank);
        return (
          <Fragment key={`${o.playerId}|${keyOf(o.punt)}`}>
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
              <Headshot player={p} variant="avatar" />
              <span className="build-name">
                <strong>{p.name}</strong>
                <span className="muted small">
                  <PlayerMeta player={p} />
                  {" · "}
                  <Stars count={tier.stars} />
                  {p.overallRank != null && ` #${p.overallRank}`}
                </span>
              </span>
              <span className="build-plan">
                <span className={o.punt ? "chip dark" : "chip"}>{buildLabel(o.punt, o.keepsPunt, current)}</span>
                {isAlt && (
                  <span className="muted small">best: {buildLabel(best.punt, best.keepsPunt, current)} {best.wins.toFixed(1)}</span>
                )}
              </span>
              <span className="build-wins">
                <span className="meter dark"><span style={{ width: bar(o.wins) }} /></span>
                <strong>{o.wins.toFixed(1)}</strong>
                <span className="muted small">
                  {o.winsRange ? `${o.winsRange[0].toFixed(1)}–${o.winsRange[1].toFixed(1)}` : ""}
                </span>
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
  onDraft,
}: {
  o: BuildOption;
  p: ApiPlayer;
  playerMap: Map<string, ApiPlayer>;
  firstPlayer: ApiPlayer | null;
  current: Category | null;
  result: BuildOptions;
  onDraft: () => void;
}) {
  const punts = new Set<Category>(o.punt ? [o.punt] : []);
  const nextPick = result.nextPick;
  const backToBack = nextPick != null && nextPick === result.pick + 1;
  const listed = result.options.find((x) => x.playerId === o.playerId);
  const isAlt = !!listed && listed.punt !== o.punt;
  const rank = listed ? result.options.indexOf(listed) + 1 : 0;
  return (
    <section className="card build-detail">
      <div className="team-line">
        <Headshot player={p} variant="avatar" />
        <span className="stack-xs grow">
          <strong className="title clamp" title={p.name}>{p.name}</strong>
          <span className="muted small"><PlayerMeta player={p} /></span>
        </span>
        <span className={o.punt ? "chip dark" : "chip"}>{buildLabel(o.punt, o.keepsPunt, current)}</span>
      </div>
      <div className="wins-row">
        <strong className="title-lg">{o.wins.toFixed(1)}</strong>
        <span className="muted small">
          wins of 11{o.winsRange ? ` · ${o.winsRange[0].toFixed(1)}–${o.winsRange[1].toFixed(1)} across ${o.runs} test drafts` : ""}
          {isAlt
            ? ` · his best build is ${buildLabel(listed!.punt, listed!.keepsPunt, current).toLowerCase()} (${listed!.wins.toFixed(1)})`
            : ` · ${ordinal(rank)} of ${result.tested}${o.tier === 1 ? ", in the top tier" : ""}`}
        </span>
      </div>
      <PairingNotes why={o.why} anchor={firstPlayer?.name ?? null} punt={o.punt} />
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
          <RankStrip ranks={o.finishRanks} punts={punts} size="sm" />
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
                  <Headshot player={n} variant="mini" />
                  {n.name}
                </span>
              );
            })}
          </span>
        </div>
      )}
      <span className="muted small">
        {o.punt
          ? `After this pick, Fit plans around a ${o.punt} punt; the plan keeps following your roster from there.`
          : "Fit stays balanced; a punt is suggested if your roster develops one."}
      </span>
      <button className="btn primary xl" onClick={onDraft}>
        Draft {lastName(p)}
      </button>
    </section>
  );
}
