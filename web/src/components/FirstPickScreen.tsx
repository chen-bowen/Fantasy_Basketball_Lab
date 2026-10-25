import { useState } from "react";
import {
  CATEGORIES,
  type ApiPlayer,
  type Category,
  type DraftView,
  type FirstPickOption,
} from "../api/client";
import { andList, slotPicks } from "../state/teams";
import { Headshot, PlayerMeta, RankLegend, RankStrip, initials } from "./common";

interface Props {
  view: DraftView;
  playerMap: Map<string, ApiPlayer>;
  options: FirstPickOption[] | null; // null while simulations run
  onDraft: (playerId: string, punt: Category) => void;
  onBrowse: () => void;
}

const PHOTO_BG = ["#E6ECF5", "#E3F0EE", "#F5EBE3", "#ECEDF1", "#EAF1E4"];

/** The three categories a build finishes best in (punt excluded). */
export function strengths(ranks: number[], punt: Category, n = 3): Category[] {
  return CATEGORIES.map((c, j) => ({ c, r: ranks[j] }))
    .filter(({ c }) => c !== punt)
    .sort((a, b) => a.r - b.r)
    .slice(0, n)
    .map(({ c }) => c);
}

export function FirstPickScreen({ view, playerMap, options, onDraft, onBrowse }: Props) {
  const [sel, setSel] = useState(0);
  const nextPick = slotPicks(view.userSlot, view.numTeams, 2)[1];
  const gone = view.picks.map((p) => playerMap.get(p.playerId)!);
  const noPlan = options
    ?.map((o) => o.noPlanWins)
    .filter((w): w is number => w !== null);
  const chosen = options?.[sel];
  const chosenPlayer = chosen ? playerMap.get(chosen.playerId) : null;

  return (
    <main className="screen">
      <div className="screen-head">
        <div className="screen-title">
          <h1 className="display-md">Your first pick sets your build</h1>
          <p className="lede">
            Each player comes with the category he lets you punt. Win counts are averages
            from simulated drafts against these bots.
          </p>
        </div>
        {gone.length > 0 && (
          <div className="gone">
            <span className="muted small">Already gone</span>
            {gone.map((p) => (
              <span key={p.id} className="gone-chip">
                <Headshot player={p} variant="mini" />
                <s>{p.name}</s>
              </span>
            ))}
          </div>
        )}
      </div>

      {!options ? (
        <div className="card loading-card" role="status">
          <span className="spinner" aria-hidden="true" />
          Simulating drafts to test each build…
        </div>
      ) : (
        <>
          <div className="pick-cards" role="radiogroup" aria-label="First pick options">
            {options.map((o, i) => {
              const p = playerMap.get(o.playerId)!;
              const punts = new Set<Category>([o.punt]);
              return (
                <button
                  key={o.playerId}
                  role="radio"
                  aria-checked={i === sel}
                  className={i === sel ? "pick-card selected" : "pick-card"}
                  onClick={() => setSel(i)}
                >
                  <span className="photo" style={{ background: PHOTO_BG[i % PHOTO_BG.length] }}>
                    <Headshot player={p} variant="card" />
                    <span className="photo-tag">{p.signed ? p.team : "Free agent"}</span>
                    {i === 0 && <span className="photo-tag right">Best tested</span>}
                  </span>
                  <span className="pick-card-body">
                    <span className="pick-card-name">
                      <strong>{p.name}</strong>
                      <PlayerMeta player={p} />
                    </span>
                    <span className="wins-row">
                      <span className="chip dark">Punt {o.punt}</span>
                      <span className="meter">
                        <span style={{ width: `${(o.wins / 11) * 100}%` }} />
                      </span>
                      <strong>
                        {o.wins.toFixed(1)}
                        <span className="muted small"> / 11 wins</span>
                      </strong>
                    </span>
                    {o.finishRanks && (
                      <span className="stack-sm">
                        <span className="muted small">Where the build finishes</span>
                        <RankStrip ranks={o.finishRanks} punts={punts} size="sm" />
                      </span>
                    )}
                    <span className="stack-sm divider-top">
                      <span className="muted small">Likely there at #{nextPick}</span>
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
                    </span>
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
                  {chosenPlayer.name} · punt {chosen.punt}
                </strong>
                <span>
                  {chosen.finishRanks
                    ? `This build finishes strongest in ${andList(strengths(chosen.finishRanks, chosen.punt))}. `
                    : ""}
                  After this pick, Fit plans around a {chosen.punt} punt. You can still switch
                  builds with your second pick.
                </span>
              </div>
              <button className="link-btn" onClick={onBrowse}>
                Browse all players
              </button>
              <button
                className="btn primary lg"
                onClick={() => onDraft(chosen.playerId, chosen.punt)}
              >
                Draft {chosenPlayer.name.split(" ").slice(1).join(" ") || initials(chosenPlayer.name)}
              </button>
            </section>
          )}
          {noPlan && noPlan.length > 0 && (
            <p className="muted small">
              Taking the best player with no punt plan wins{" "}
              {Math.min(...noPlan).toFixed(1)}–{Math.max(...noPlan).toFixed(1)} of 11 in the
              same simulations.
            </p>
          )}
        </>
      )}
    </main>
  );
}
