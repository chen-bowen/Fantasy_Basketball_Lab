import { useState } from "react";
import {
  CATEGORIES,
  type ApiPlayer,
  type Category,
  type ConsensusPick,
  type DraftView,
  type SecondPickOption,
} from "../api/client";
import { andList, slotPicks, teamName } from "../state/teams";
import { Headshot, PairingNotes, PlayerMeta, RankLegend, RankStrip, ZStrip } from "./common";

interface Props {
  view: DraftView;
  playerMap: Map<string, ApiPlayer>;
  options: SecondPickOption[] | null; // null while simulations run
  consensus: ConsensusPick | null;
  tested: number;
  onDraft: (playerId: string, punt: Category | null) => void;
  onBrowse: () => void;
}

const PHOTO_BG = ["#E3F0EE", "#EAF1E4", "#F5EBE3", "#ECEDF1"];
const FEW_RUNS = 4;

export function SecondPickScreen({ view, playerMap, options, consensus, tested, onDraft, onBrowse }: Props) {
  const [sel, setSel] = useState(0);
  const slot = view.userSlot;
  const firstPick = view.picks.find((p) => p.teamId === slot)!;
  const first = playerMap.get(firstPick.playerId)!;
  const punt = view.userPunts[0] ?? null;
  const punts = new Set<Category>(view.userPunts);
  const ranksNow = CATEGORIES.map((c) => view.ranks[c][slot]);
  const covered = CATEGORIES.filter((c, j) => !punts.has(c) && ranksNow[j] <= 3);
  // What one player leaves open — plain roster arithmetic for the narrative;
  // the options below are ranked by simulation, not by this.
  const missing = CATEGORIES.filter((c, j) => !punts.has(c) && ranksNow[j] >= view.numTeams - 2);
  const since = view.picks.filter((p) => p.index > firstPick.index);
  const nextPick = slotPicks(slot, view.numTeams, 3)[2];
  const chosen = options?.[sel];
  const chosenPlayer = chosen ? playerMap.get(chosen.playerId) : null;

  return (
    <main className="screen">
      {since.length > 0 && (
        <div className="since" aria-label="Picks since your last turn">
          <span className="muted small">Since your last pick</span>
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

      <div className="two-col">
        <aside className="card team-so-far">
          <span className="photo tile-photo">
            <Headshot player={first} variant="tile" />
            <span className="photo-tag">Rd 1 · #{firstPick.index + 1}</span>
          </span>
          <div className="pad stack">
            <div className="stack-xs">
              <span className="muted small">Your team so far</span>
              <strong className="title">{first.name}</strong>
              {punt && <span className="chip dark fit-content">Punt {punt}</span>}
            </div>
            <div className="stack-sm">
              <span className="muted small">Where you rank now</span>
              <RankStrip ranks={ranksNow} punts={punts} />
            </div>
            <p className="body-text">
              {covered.length > 0 && <>{first.name.split(" ").slice(-1)[0]} already covers {andList(covered)}. </>}
              {missing.length > 0 && (
                <>
                  This pick could bring <strong>{andList(missing)}</strong> — or not: the options
                  below are ranked by simulated record, not by what he lacks.
                </>
              )}
            </p>
          </div>
        </aside>

        <section className="stack grow">
          <div className="stack-xs">
            <h1 className="display-md">Finish your build</h1>
            <p className="lede">
              Some options keep your punt, others switch it. After this pick your punt is
              set, and Fit plans the rest of your draft around it.
            </p>
          </div>

          {!options ? (
            <div className="card loading-card" role="status">
              <span className="spinner" aria-hidden="true" />
              Simulating drafts for each option…
            </div>
          ) : options.length === 0 ? (
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
              <div className="option-grid" role="radiogroup" aria-label="Second pick options">
                {options.map((o, i) => {
                  const p = playerMap.get(o.playerId)!;
                  return (
                    <button
                      key={o.playerId}
                      role="radio"
                      aria-checked={i === sel}
                      className={i === sel ? "option-card selected" : "option-card"}
                      onClick={() => setSel(i)}
                    >
                      <span className="option-photo" style={{ background: PHOTO_BG[i % PHOTO_BG.length] }}>
                        <Headshot player={p} variant="tile" />
                      </span>
                      <span className="option-body">
                        <span className="pick-card-name">
                          <strong>{p.name}</strong>
                          <PlayerMeta player={p} />
                        </span>
                        <span className="wins-row">
                          <span className={o.keepsPunt ? "chip dark" : "chip accent-soft"}>
                            {o.punt === null
                              ? o.keepsPunt ? "No punt" : "Drop the punt"
                              : o.keepsPunt ? `Keeps punt ${o.punt}` : `Switch to punt ${o.punt}`}
                          </span>
                          <span className="meter">
                            <span style={{ width: `${(o.wins / 11) * 100}%` }} />
                          </span>
                          <strong>
                            {o.wins.toFixed(1)}
                            <span className="muted small"> / 11 wins</span>
                          </strong>
                        </span>
                        <span className={o.runs < FEW_RUNS ? "small warn-text" : "muted small"}>
                          {o.runs < FEW_RUNS
                            ? `Only ${o.runs} test draft${o.runs === 1 ? "" : "s"}: he usually doesn't last this long.`
                            : `${o.winsRange ? `${o.winsRange[0].toFixed(1)}–${o.winsRange[1].toFixed(1)}` : o.wins.toFixed(1)} across ${o.runs} test drafts`}
                          {consensus && consensus.playerId !== o.playerId && (() => {
                            const gap = o.wins - consensus.wins;
                            const cp = playerMap.get(consensus.playerId);
                            return cp
                              ? ` · ${Math.abs(gap) < 0.15 ? "even with" : gap > 0 ? `+${gap.toFixed(1)} over` : `${gap.toFixed(1)} under`} ${cp.name.split(" ").slice(-1)[0]}, the market's pick`
                              : "";
                          })()}
                        </span>
                        <span className="stack-sm">
                          <span className="muted small">What he brings</span>
                          {p.z && <ZStrip z={p.z} punts={new Set<Category>(o.punt ? [o.punt] : [])} />}
                        </span>
                        <PairingNotes why={o.why} anchor={first.name} punt={o.punt} />
                        {o.wait.pick != null && o.wait.runs > 0 && (
                          <span className="muted small">
                            {o.wait.pick === view.pickIndex + 2
                              ? `You pick again right after this one (#${o.wait.pick}), so you can take him there and someone else now.`
                              : o.wait.stillThere === o.wait.runs
                                ? `Still there at #${o.wait.pick} in every test draft if you pass now — you could take someone else first.`
                                : o.wait.stillThere === 0
                                  ? `Gone before #${o.wait.pick} in every test draft — it's now or never.`
                                  : `Still there at #${o.wait.pick} in ${o.wait.stillThere} of ${o.wait.runs} test drafts if you pass now.`}
                          </span>
                        )}
                        {o.ranksAfter && (
                          <span className="stack-sm">
                            <span className="muted small">Your team after this pick</span>
                            <RankStrip ranks={o.ranksAfter} punts={new Set<Category>(o.punt ? [o.punt] : [])} size="sm" />
                          </span>
                        )}
                        {o.nextOptions.length > 0 && (
                          <span className="muted small">
                            Then likely at #{nextPick}:{" "}
                            <strong className="ink">
                              {o.nextOptions.map((id) => playerMap.get(id)!.name).join(" or ")}
                            </strong>
                          </span>
                        )}
                      </span>
                    </button>
                  );
                })}
              </div>
              <RankLegend />

              {chosen && chosenPlayer && (
                <section className="action-bar">
                  <div className="action-text">
                    <strong>
                      {chosenPlayer.name} ·{" "}
                      {chosen.punt === null
                        ? chosen.keepsPunt ? "no punt" : "drops the punt"
                        : chosen.keepsPunt ? `keeps punt ${chosen.punt}` : `switches to punt ${chosen.punt}`}
                    </strong>
                    <span>
                      Expects {chosen.wins.toFixed(1)} matchup wins of 11 across {chosen.runs} simulated
                      drafts where he was still available here
                      {tested > 0 ? ` — the top ${options!.length} of ${tested} players tested` : ""}.
                      {consensus && (() => {
                        const cp = playerMap.get(consensus.playerId);
                        if (!cp) return null;
                        const gap = chosen.wins - consensus.wins;
                        const isChosen = consensus.playerId === chosen.playerId;
                        return isChosen
                          ? " He's also the market's pick here."
                          : ` The market's pick here, ${cp.name}, expects ${consensus.wins.toFixed(1)}${
                              Math.abs(gap) < 0.15
                                ? " — a toss-up, so don't reach if you'd rather have the name."
                                : gap > 0
                                  ? ` (${gap.toFixed(1)} fewer).`
                                  : ` (${(-gap).toFixed(1)} more).`
                            }`;
                      })()}
                    </span>
                  </div>
                  <button className="link-btn" onClick={onBrowse}>
                    Browse all players
                  </button>
                  <button
                    className="btn primary lg"
                    onClick={() => onDraft(chosen.playerId, chosen.punt)}
                  >
                    Draft {chosenPlayer.name.split(" ").slice(1).join(" ")}
                  </button>
                </section>
              )}
            </>
          )}
        </section>
      </div>
    </main>
  );
}
