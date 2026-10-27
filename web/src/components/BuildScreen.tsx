import { Fragment, useState } from "react";
import {
  CATEGORIES,
  type ApiPlayer,
  type BuildOption,
  type BuildOptions,
  type Category,
  type DraftView,
} from "../api/client";
import { andList, ordinal, teamName } from "../state/teams";
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
/** Rows shown before the rest of the range folds behind a toggle (the top tier is never cut). */
const VISIBLE_ROWS = 10;
/** Build alternatives further behind the best option than this aren't worth a row. */
const BUILD_WITHIN = 1.0;
const TIER_LABELS = ["Toss-up for the top spot", "A step behind", "Further back"];
/** A top tier wider than this isn't a shortlist; the headline says the sims can't separate it. */
const WIDE_TIE = 6;

function lastName(p: ApiPlayer): string {
  return p.name.split(" ").slice(1).join(" ") || initials(p.name);
}

function buildLabel(punt: Category | null, keeps: boolean, current: Category | null): string {
  if (punt === null) return current ? "Drop the punt" : "No punt";
  return keeps ? `Keeps punt ${punt}` : current ? `Switch to punt ${punt}` : `Punt ${punt}`;
}

export function BuildScreen({ view, playerMap, result, onDraft, onBrowse }: Props) {
  const [selId, setSelId] = useState<string | null>(null);
  const slot = view.userSlot;
  const first = view.picks.find((p) => p.teamId === slot) ?? null;
  const firstPlayer = first ? playerMap.get(first.playerId)! : null;
  const stage = firstPlayer ? "second" : "first";
  const current = view.userPunts[0] ?? null;
  const punts = new Set<Category>(view.userPunts);
  const since = first ? view.picks.filter((p) => p.index > first.index) : view.picks;

  const options = result?.options ?? null;
  const chosen = options
    ? (selId && options.find((o) => o.playerId === selId)) || options[0]
    : null;
  const chosenPlayer = chosen ? playerMap.get(chosen.playerId) : null;

  return (
    <main className="screen">
      {since.length > 0 && (
        <div className="since" aria-label={first ? "Picks since your last turn" : "Already gone"}>
          <span className="muted small">{first ? "Since your last pick" : "Already gone"}</span>
          {since.map((p) => {
            const pl = playerMap.get(p.playerId)!;
            return (
              <span key={p.index} className="gone-chip">
                <Headshot player={pl} variant="mini" />
                <span className="muted small">{teamName(view, p.teamId)}</span>
                <strong>{pl.name}</strong>
              </span>
            );
          })}
        </div>
      )}

      <div className="stack-xs">
        <h1 className="display-md">
          {stage === "first" ? "Your first pick sets your build" : "Finish your build"}
        </h1>
        <p className="lede">
          {result ? (
            <Headline result={result} playerMap={playerMap} />
          ) : stage === "first" ? (
            "Every player in range at this pick is being tested: each one taken here, the rest of the draft played out against these bots, under no punt and the punts that suit him."
          ) : (
            "Every player in range at this pick is being tested next to your first pick, under the punts that suit the pair."
          )}
        </p>
      </div>

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
        <div className="build-layout">
          <div className="stack">
            <OptionList
              result={result}
              playerMap={playerMap}
              current={current}
              chosenId={chosen?.playerId ?? null}
              onSelect={setSelId}
            />
            <Builds result={result} playerMap={playerMap} current={current} onSelect={setSelId} />
            <p className="muted small">
              {result.tested} players tested — everyone the draft expects to go around pick #{result.pick}.
              Looking for someone else?{" "}
              <button className="link-btn inline" onClick={onBrowse}>
                Browse all players
              </button>
            </p>
          </div>
          <aside className="build-side">
            <TeamSoFar view={view} firstPlayer={firstPlayer} punts={punts} result={result} />
            {chosen && chosenPlayer && (
              <OptionDetail
                o={chosen}
                p={chosenPlayer}
                playerMap={playerMap}
                firstPlayer={firstPlayer}
                current={current}
                result={result}
                onDraft={() => onDraft(chosen.playerId, chosen.punt)}
              />
            )}
            <RankLegend />
          </aside>
        </div>
      )}
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

function OptionList({
  result,
  playerMap,
  current,
  chosenId,
  onSelect,
}: {
  result: BuildOptions;
  playerMap: Map<string, ApiPlayer>;
  current: Category | null;
  chosenId: string | null;
  onSelect: (id: string) => void;
}) {
  const [showAll, setShowAll] = useState(false);
  const { options, nextPick, pick } = result;
  const backToBack = nextPick != null && nextPick === pick + 1;
  const maxWins = Math.max(...options.map((o) => o.wins));
  const cut = Math.max(VISIBLE_ROWS, options.filter((o) => o.tier === 1).length);
  const hidden = options.slice(cut);
  const collapsed = !showAll && hidden.length > 0 && !hidden.some((o) => o.playerId === chosenId);
  const shown = collapsed ? options.slice(0, cut) : options;
  return (
    <div className="card build-list" role="radiogroup" aria-label="Players in range at this pick">
      {shown.map((o, i) => {
        const p = playerMap.get(o.playerId)!;
        const tierStart = i === 0 || shown[i - 1].tier !== o.tier;
        const selected = o.playerId === chosenId;
        const tier = valueTier(p.overallRank);
        return (
          <Fragment key={o.playerId}>
            {tierStart && (
              <div className={`build-tier t${Math.min(o.tier, 3)}`} aria-hidden="true">
                {TIER_LABELS[Math.min(o.tier, 3) - 1]}
                {o.tier === 1 && options.filter((x) => x.tier === 1).length > 1
                  ? ` · within ${result.tieWins} wins of each other`
                  : ""}
              </div>
            )}
            <div
              role="radio"
              aria-checked={selected}
              tabIndex={0}
              className={["build-row", selected ? "selected" : "", o.tier === 1 ? "top" : ""].join(" ").trim()}
              onClick={() => onSelect(o.playerId)}
              onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onSelect(o.playerId); } }}
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
              <span className={o.punt ? "chip dark" : "chip"}>{buildLabel(o.punt, o.keepsPunt, current)}</span>
              <span className="build-wins">
                <span className="meter">
                  <span style={{ width: `${(o.wins / Math.max(maxWins, 1)) * 100}%` }} />
                </span>
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
      {hidden.length > 0 && (
        <button className="build-more" onClick={() => setShowAll(!collapsed ? false : true)}>
          {collapsed
            ? `Show the ${hidden.length} other player${hidden.length > 1 ? "s" : ""} in range`
            : "Show fewer"}
        </button>
      )}
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
  const rank = result.options.indexOf(o) + 1;
  return (
    <section className="card build-detail">
      <div className="team-line">
        <Headshot player={p} variant="avatar" />
        <span className="stack-xs grow">
          <strong className="title">{p.name}</strong>
          <span className="muted small"><PlayerMeta player={p} /></span>
        </span>
        <span className={o.punt ? "chip dark" : "chip"}>{buildLabel(o.punt, o.keepsPunt, current)}</span>
      </div>
      <div className="wins-row">
        <strong className="title-lg">{o.wins.toFixed(1)}</strong>
        <span className="muted small">
          wins of 11{o.winsRange ? ` · ${o.winsRange[0].toFixed(1)}–${o.winsRange[1].toFixed(1)} across ${o.runs} test drafts` : ""}
          {" · "}{ordinal(rank)} of {result.tested}{o.tier === 1 ? ", in the top tier" : ""}
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

/** The best player under each other plan, when a build is a real alternative. */
function Builds({
  result,
  playerMap,
  current,
  onSelect,
}: {
  result: BuildOptions;
  playerMap: Map<string, ApiPlayer>;
  current: Category | null;
  onSelect: (id: string) => void;
}) {
  const best = result.options[0];
  const alts = result.builds.filter(
    (b) => b.punt !== best.punt && b.behind <= BUILD_WITHIN,
  );
  if (alts.length === 0) return null;
  return (
    <div className="card build-alts">
      <div className="stack-xs">
        <strong>Other builds</strong>
        <span className="muted small">
          The best player under each plan, and what the plan gives up against the top option.
        </span>
      </div>
      {alts.map((b) => {
        const p = playerMap.get(b.playerId)!;
        const own = result.options.find((o) => o.playerId === b.playerId);
        return (
          <button key={String(b.punt)} className="build-alt" onClick={() => onSelect(b.playerId)}>
            <span className={b.punt ? "chip dark" : "chip"}>{buildLabel(b.punt, b.keepsPunt, current)}</span>
            <Headshot player={p} variant="mini" />
            <strong>{p.name}</strong>
            <span className="muted small">
              {b.wins.toFixed(1)} wins
              {b.behind > 0.05 ? ` · ${b.behind.toFixed(1)} behind` : " · even with the top option"}
              {own && own.punt !== b.punt ? ` · ${ordinal(result.options.indexOf(own) + 1)} on the list under his best plan` : ""}
            </span>
          </button>
        );
      })}
    </div>
  );
}
