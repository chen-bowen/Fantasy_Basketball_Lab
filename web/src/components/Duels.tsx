import { useState } from "react";
import {
  type ApiPlayer,
  type Category,
  type SessionView,
  type Decider,
  type Duel,
  type DuelCategory,
  type Verdict,
} from "../api/client";
import { andList, buildChip, squadName, weekRecord } from "../state/squads";
import { Monogram } from "./ui";

/**
 * Your week against each team. One duel is laid out like a tale of the
 * tape — two per-game totals, a label, and the players who decide it — so
 * "likely win" is just the reading of the numbers next to it. The list
 * on the left carries every opponent's chance; the 58% underneath is
 * their average, and the same number as the record card's "week to week".
 */

export const VERDICT_WORD: Record<Verdict, string> = {
  win: "Likely win",
  tossup: "Toss-up",
  loss: "Likely loss",
};
const VERDICT_GLYPH: Record<Verdict, string> = { win: "W", tossup: "≈", loss: "L" };

const BRACKET_WORD = { favored: "Favored", tossup: "Toss-up", underdog: "Underdog" } as const;

/** Whole numbers for the big counting stats, one decimal for the small ones. */
export function formatTotal(cat: Category, value: number | null, att: number | null): string {
  if (value == null) return "—";
  if (cat === "FG%" || cat === "FT%") return `${(value * 100).toFixed(1)}%${att != null ? ` on ${att.toFixed(0)}` : ""}`;
  return cat === "PTS" || cat === "REB" || cat === "AST" ? value.toFixed(0) : value.toFixed(1);
}

/** "Cunningham 23.9", "Giannis 63% on 17 att", "Young 3.1 TO". */
export function deciderStat(cat: Category, d: Decider): string {
  if (cat === "FG%" || cat === "FT%") return `${Math.round(d.stat * 100)}% on ${(d.att ?? 0).toFixed(1)} att`;
  return `${d.stat.toFixed(1)}${cat === "TO" ? " TO" : ""}`;
}

export function lastName(p: ApiPlayer): string {
  const parts = p.name.split(" ");
  const tail = parts.slice(1).filter((w) => !/^(Jr\.?|Sr\.?|II|III|IV)$/.test(w));
  return tail.join(" ") || p.name;
}

export function DeciderChip({ cat, d, playerMap, side }: { cat: Category; d: Decider; playerMap: Map<string, ApiPlayer>; side: boolean }) {
  const p = playerMap.get(d.pid);
  if (!p) return null;
  return (
    <span className="decider" title={p.name}>
      <Monogram player={p} variant="mini" />
      {side && <span className="decider-side">{d.side === "you" ? "you" : "them"}</span>}
      <span className="decider-name">{lastName(p)}</span>
      <span className="decider-stat">{deciderStat(cat, d)}</span>
    </span>
  );
}

function VerdictStrip({ m }: { m: Duel }) {
  return (
    <span className="look-strip" aria-hidden="true">
      {m.categories.map((c) => (
        <span key={c.cat} className={`look-dot ${c.verdict}${c.concededByYou ? " conceded" : ""}`} />
      ))}
    </span>
  );
}

/** One line that says how the week is won or lost, in category names. */
export function verdict(m: Duel): string {
  const edge = m.categories.filter((c) => c.verdict === "win").sort((a, b) => b.pct - a.pct).map((c) => c.cat);
  const toss = m.categories.filter((c) => c.verdict === "tossup").sort((a, b) => b.pct - a.pct).map((c) => c.cat);
  const theirs = m.categories.filter((c) => c.verdict === "loss").map((c) => c.cat + (c.concededByYou ? " (conceded)" : ""));
  const parts: string[] = [];
  parts.push(edge.length ? `Edge: ${andList(edge)}.` : "No category you're likely to win.");
  if (m.need === 0) {
    const thinnest = m.categories.filter((c) => c.verdict === "win").sort((a, b) => a.pct - b.pct)[0];
    const spare = edge.length - 5;
    parts.push(
      spare > 0
        ? `You can drop ${spare} of those and still win; ${thinnest.cat} is the thinnest.`
        : `Enough only if all ${edge.length} hold — ${thinnest.cat} is the thinnest.`,
    );
  } else if (toss.length === 0 || m.need > toss.length) {
    parts.push(toss.length ? `Short even if every toss-up (${andList(toss)}) goes your way.` : "Short without an upset.");
  } else if (m.need === toss.length) {
    parts.push(`Needs every toss-up: ${andList(toss)}.`);
  } else {
    parts.push(`Needs ${m.need} of the ${toss.length} toss-ups: ${andList(toss)}.`);
  }
  if (theirs.length) parts.push(`Theirs: ${andList(theirs)}.`);
  return parts.join(" ");
}

function CategoryRow({ c, playerMap }: { c: DuelCategory; playerMap: Map<string, ApiPlayer> }) {
  const youLead = c.you != null && c.them != null && (c.cat === "TO" ? c.you < c.them : c.you > c.them);
  const concede = c.concededByYou ? "conceded" : c.concededByThem ? "they concede it" : null;
  return (
    <tr className={`tape-row ${c.verdict}`}>
      <th scope="row" className="left tape-cat">
        {c.cat}
        {c.cat === "TO" && <span className="muted small tape-note">fewer wins</span>}
      </th>
      <td className={`tape-num${youLead ? " lead" : ""}`}>{formatTotal(c.cat, c.you, c.youAtt)}</td>
      <td className={`tape-num${c.you != null && c.them != null && !youLead && c.you !== c.them ? " lead" : ""}`}>
        {formatTotal(c.cat, c.them, c.themAtt)}
      </td>
      <td className="tape-look">
        <span className={`look ${c.verdict}`} title={`You'd win ${c.cat} in about ${c.pct}% of weeks`}>
          <span className="look-glyph" aria-hidden="true">{VERDICT_GLYPH[c.verdict]}</span>
          {VERDICT_WORD[c.verdict]}
        </span>
      </td>
      <td className="tape-why">
        <span className="deciders">
          {concede && <span className="chip tape-concede">{concede}</span>}
          {c.deciders.map((d) => (
            <DeciderChip key={d.pid + d.side} cat={c.cat} d={d} playerMap={playerMap} side />
          ))}
        </span>
      </td>
    </tr>
  );
}

export function DuelsSection({ view, playerMap }: { view: SessionView; playerMap: Map<string, ApiPlayer> }) {
  const bd = view.board;
  const [picked, setPicked] = useState<number | null>(null);
  if (!bd || bd.opponents.length === 0) return null;
  const m = bd.opponents.find((o) => o.squad === picked) ?? bd.opponents[0];
  const rec = view.records[view.seat];
  const n = bd.opponents.length;
  const badge = buildChip(view, m.squad);
  const paper = m.paper.result === "tie" ? `tie ${m.paper.won}–${m.paper.lost}–${m.paper.tied}` : `${m.paper.result} ${m.paper.won}–${m.paper.lost}`;
  const disagree = (m.paper.result === "win" && m.winPct < 50) || (m.paper.result === "loss" && m.winPct > 50);

  return (
    <section className="card matchups" aria-labelledby="duels-title">
      <div className="standings-head pad-x">
        <h2 id="duels-title" className="title">Your week against each team</h2>
        <span className="muted small">
          You play one team a week and win it by taking 5 of the 9 categories.
        </span>
      </div>
      <div className="duels-body">
        <div className="duel-list" role="tablist" aria-label="Opponents">
          {bd.opponents.map((o) => {
            const b = buildChip(view, o.squad);
            const on = o.squad === m.squad;
            return (
              <button
                key={o.squad}
                role="tab"
                aria-selected={on}
                className={`duel-row${on ? " on" : ""}`}
                onClick={() => setPicked(o.squad)}
              >
                <span className="duel-team">
                  <strong>{squadName(view, o.squad)}</strong>
                  <span className={`badge ${b.tone}`}>{b.label}</span>
                </span>
                <strong className="duel-pct">{o.winPct}%</strong>
                <span className="meter"><span className={o.bracket} style={{ width: `${o.winPct}%` }} /></span>
                <span className="duel-side">
                  <span
                    className={`small duel-paper${(o.paper.result === "win") !== o.winPct >= 50 ? " off" : " muted"}`}
                    title="On paper: categories you rank higher in vs. lower"
                  >
                    {o.paper.result === "win" ? "W" : o.paper.result === "loss" ? "L" : "T"} {o.paper.won}–{o.paper.lost}
                  </span>
                  <VerdictStrip m={o} />
                </span>
              </button>
            );
          })}
          <p className="duel-list-foot small">
            <strong className="ink">Week to week you'd win {bd.winPct}% of these matchups</strong> — the average of the {n}{" "}
            chances above, about {weekRecord(bd.winPct, n)} in a round against the league.{" "}
            <span className="muted">On paper: {rec.wins}–{rec.losses}{rec.ties ? `–${rec.ties}` : ""}. Chance is how often you'd win the week; W/L is who ranks higher in more categories.</span>
          </p>
        </div>

        <div className="duel-detail" role="tabpanel">
          <div className="duel-detail-head">
            <span className="stack-0">
              <span className="eyebrow-accent">
                {BRACKET_WORD[m.bracket]}
                <span className={`badge ${badge.tone}`}>{badge.label}</span>
              </span>
              <h3 className="title-lg">You vs {squadName(view, m.squad)}</h3>
            </span>
            <span className="duel-detail-odds">
              <strong className="recap-num sm">{m.winPct}%</strong>
              <span className="muted small">
                chance you win the week · about {Math.round(m.winPct / 10)} weeks in 10
                <br />
                On paper: {paper}
                {disagree && <span className="warn-text"> — but the chance says otherwise</span>}
              </span>
            </span>
          </div>
          <div className="table-scroll">
            <table className="tape">
              <thead>
                <tr>
                  <th scope="col" className="left"></th>
                  <th scope="col">You</th>
                  <th scope="col">{squadName(view, m.squad)}</th>
                  <th scope="col" className="left">This week</th>
                  <th scope="col" className="left">Why</th>
                </tr>
              </thead>
              <tbody>
                {m.categories.map((c) => (
                  <CategoryRow key={c.cat} c={c} playerMap={playerMap} />
                ))}
              </tbody>
            </table>
          </div>
          <p className="body-text lg duel-verdict">{verdict(m)}</p>
          <p className="muted small">
            Per game, all {view.squadSize} players, both teams playing the same number of games; players expected
            to miss games count for the share they play. Steals, free throws and turnovers are few per
            week, so leads there flip more often than leads in points. Likely = 60% or better.
          </p>
        </div>
      </div>
    </section>
  );
}
