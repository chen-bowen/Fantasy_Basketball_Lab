import { useMemo, useState } from "react";
import {
  CATEGORIES,
  type ApiPlayer,
  type Category,
  type DraftView,
} from "../api/client";
import { andList, ordinal, teamBadge, teamName, teamPunts } from "../state/teams";
import { Headshot, PlayerMeta, ZStrip, rankTone } from "./common";

interface Props {
  view: DraftView;
  playerMap: Map<string, ApiPlayer>;
  inspectedId: string | null;
  onInspect: (id: string | null) => void;
  onDraft: (id: string) => void;
  onTogglePunt: (c: Category) => void;
}

const HELPS_Z = 0.4;
const HURTS_Z = -0.9;

export function DraftRoom({ view, playerMap, inspectedId, onInspect, onDraft, onTogglePunt }: Props) {
  const punts = useMemo(() => new Set<Category>(view.userPunts), [view.userPunts]);
  const available = useMemo(
    () =>
      Object.keys(view.fit)
        .map((id) => playerMap.get(id)!)
        .filter(Boolean)
        .sort((a, b) => view.fit[b.id] - view.fit[a.id]),
    [view.fit, playerMap],
  );
  const focus =
    (inspectedId && view.fit[inspectedId] !== undefined && playerMap.get(inspectedId)) ||
    available[0];

  return (
    <>
      <BuildBanner view={view} punts={punts} onTogglePunt={onTogglePunt} />
      <main className="room">
        <FitTable
          view={view}
          players={available}
          punts={punts}
          focusId={focus?.id ?? null}
          onInspect={onInspect}
        />
        <aside className="room-side">
          {focus && (
            <PlayerPanel
              view={view}
              player={focus}
              isTop={focus.id === available[0]?.id}
              punts={punts}
              onDraft={() => onDraft(focus.id)}
              onClose={inspectedId ? () => onInspect(null) : null}
            />
          )}
          <TeamPanel view={view} playerMap={playerMap} />
        </aside>
      </main>
    </>
  );
}

function BuildBanner({
  view,
  punts,
  onTogglePunt,
}: {
  view: DraftView;
  punts: ReadonlySet<Category>;
  onTogglePunt: (c: Category) => void;
}) {
  const [editing, setEditing] = useState(false);
  const needs = view.neededCategories;
  return (
    <div className="banner-wrap">
      <section className="card banner">
        <div className="banner-text">
          <span className="banner-title">
            <strong>{punts.size ? "Your build" : "No punt yet"}</strong>
            {[...punts].map((c) => (
              <span key={c} className="chip dark">
                Punt {c}
              </span>
            ))}
          </span>
          <span className="muted">
            {needs.length
              ? `Fit is boosting what your team is behind in: ${andList(needs)}.`
              : view.rosters[view.userSlot].length
                ? "Your team isn't far behind in any category, so Fit is close to plain value."
                : "Fit is plain value until your team has a shape."}
          </span>
        </div>
        <button className="btn" aria-expanded={editing} onClick={() => setEditing(!editing)}>
          {editing ? "Done" : "Change punts"}
        </button>
        {editing && (
          <div className="punt-toggles" role="group" aria-label="Punted categories">
            {CATEGORIES.map((c) => (
              <button
                key={c}
                className={punts.has(c) ? "toggle on" : "toggle"}
                aria-pressed={punts.has(c)}
                onClick={() => onTogglePunt(c)}
              >
                {c}
              </button>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

const POSITIONS = ["All", "G", "F", "C", "PG", "SG", "SF", "PF"];
const PAGE = 50;

function FitTable({
  view,
  players,
  punts,
  focusId,
  onInspect,
}: {
  view: DraftView;
  players: ApiPlayer[];
  punts: ReadonlySet<Category>;
  focusId: string | null;
  onInspect: (id: string) => void;
}) {
  const [mode, setMode] = useState<"fit" | "numbers">("fit");
  const [query, setQuery] = useState("");
  const [pos, setPos] = useState("All");
  const [limit, setLimit] = useState(PAGE);

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return players.filter(
      (p) =>
        (!q || p.name.toLowerCase().includes(q) || p.team.toLowerCase().includes(q)) &&
        (pos === "All" || p.positions.includes(pos)),
    );
  }, [players, query, pos]);
  const maxFit = Math.max(1, ...players.slice(0, 1).map((p) => view.fit[p.id]));
  const needed = new Set(view.neededCategories);
  const colClass = (c: Category) =>
    punts.has(c) ? "cat-col punted" : needed.has(c) ? "cat-col needed" : "cat-col";

  return (
    <section className="card table-card">
      <div className="table-head">
        <h2 className="title">Best fit for your team</h2>
        <div className="seg" role="group" aria-label="Table view">
          <button aria-pressed={mode === "fit"} onClick={() => setMode("fit")}>Fit</button>
          <button aria-pressed={mode === "numbers"} onClick={() => setMode("numbers")}>Numbers</button>
        </div>
      </div>
      <p className="table-note">
        Fit starts from a player's value and boosts the categories your team is behind in,
        so it changes after every pick.
        {punts.size > 0 && ` ${andList([...punts])} ${punts.size > 1 ? "are" : "is"} punted and doesn't count.`}
      </p>
      <div className="filters">
        <label className="search">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
            <circle cx="7" cy="7" r="5" />
            <path d="M11 11l3.5 3.5" />
          </svg>
          <input
            aria-label="Search players"
            placeholder="Search players"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
        <select aria-label="Position" value={pos} onChange={(e) => setPos(e.target.value)}>
          {POSITIONS.map((p) => (
            <option key={p} value={p}>{p === "All" ? "All positions" : p}</option>
          ))}
        </select>
      </div>

      <div className="table-scroll">
        <table className={mode === "fit" ? "fit-table" : "fit-table numbers"}>
          <thead>
            <tr>
              <th scope="col" className="left">Player</th>
              <th scope="col" className="left fit-col">Fit</th>
              {mode === "fit" ? (
                <th scope="col" className="left">
                  <span className="zhead">
                    {CATEGORIES.map((c) => (
                      <span key={c} className={colClass(c)}>{c}</span>
                    ))}
                  </span>
                </th>
              ) : (
                <>
                  <th scope="col">Value</th>
                  <th scope="col">MIN</th>
                  {CATEGORIES.map((c) => (
                    <th key={c} scope="col" className={colClass(c)}>{c}</th>
                  ))}
                </>
              )}
            </tr>
          </thead>
          <tbody>
            {rows.slice(0, limit).map((p) => {
              const fit = view.fit[p.id];
              return (
                <tr
                  key={p.id}
                  className={p.id === focusId ? "focused" : ""}
                  onClick={() => onInspect(p.id)}
                >
                  <td className="left">
                    <button className="row-btn">
                      <Headshot player={p} variant="avatar" />
                      <span className="row-name">
                        <strong>{p.name}</strong>
                        <PlayerMeta player={p} />
                      </span>
                    </button>
                  </td>
                  <td className="left">
                    <span className="fit-cell">
                      <strong>{fit.toFixed(1)}</strong>
                      {mode === "fit" && (
                        <span className="meter dark">
                          <span style={{ width: `${Math.max(0, (fit / maxFit) * 100)}%` }} />
                        </span>
                      )}
                    </span>
                  </td>
                  {mode === "fit" ? (
                    <td className="left">{p.z && <ZStrip z={p.z} punts={punts} />}</td>
                  ) : (
                    <>
                      <td>{(view.scores[p.id] ?? 0).toFixed(1)}</td>
                      <td className="muted">{p.min.toFixed(1)}</td>
                      {CATEGORIES.map((c) => (
                        <td key={c} className={punts.has(c) ? "muted" : ""}>
                          {statText(p, c)}
                        </td>
                      ))}
                    </>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {rows.length > limit && (
        <div className="table-foot">
          <button className="btn" onClick={() => setLimit(limit + PAGE)}>
            Show {Math.min(PAGE, rows.length - limit)} more
          </button>
        </div>
      )}
      {mode === "fit" && (
        <div className="legend table-legend">
          <span><i className="sq top" />Big help</span>
          <span><i className="sq good" />Helps</span>
          <span><i className="sq avg" />About average</span>
          <span><i className="sq low" />Hurts</span>
          <span><i className="sq bottom" />Hurts a lot</span>
          <span><strong className="needed-key">Bold blue</strong> = category you need</span>
        </div>
      )}
    </section>
  );
}

function statText(p: ApiPlayer, c: Category): string {
  switch (c) {
    case "PTS": return p.pts.toFixed(1);
    case "REB": return p.reb.toFixed(1);
    case "AST": return p.ast.toFixed(1);
    case "STL": return p.stl.toFixed(1);
    case "BLK": return p.blk.toFixed(1);
    case "3PM": return p.tpm.toFixed(1);
    case "FG%": return p.fga > 0 ? ((p.fgm / p.fga) * 100).toFixed(1) : "—";
    case "FT%": return p.fta > 0 ? ((p.ftm / p.fta) * 100).toFixed(1) : "—";
    case "TO": return p.tov.toFixed(1);
  }
}

function PlayerPanel({
  view,
  player,
  isTop,
  punts,
  onDraft,
  onClose,
}: {
  view: DraftView;
  player: ApiPlayer;
  isTop: boolean;
  punts: ReadonlySet<Category>;
  onDraft: () => void;
  onClose: (() => void) | null;
}) {
  const z = player.z ?? ({} as Record<Category, number>);
  const helps = view.neededCategories.filter((c) => z[c] > HELPS_Z);
  const otherHelps = CATEGORIES.filter(
    (c) => !punts.has(c) && !helps.includes(c) && z[c] >= 1.5,
  );
  const hurts = CATEGORIES.filter((c) => !punts.has(c) && z[c] <= HURTS_Z);
  const fit = view.fit[player.id];
  const value = view.scores[player.id] ?? 0;
  const last = player.name.split(" ").slice(1).join(" ") || player.name;

  let why: string;
  if (helps.length) {
    why = `${isTop ? "The best fit left for your team. " : ""}He adds ${andList(helps)}, which your team needs most right now.`;
  } else if (otherHelps.length) {
    why = `Strong in ${andList(otherHelps)}, but those aren't what your team is missing.`;
  } else {
    why = "Doesn't move the categories your team is behind in.";
  }

  return (
    <section className="card player-panel">
      <div className="panel-photo">
        <Headshot player={player} variant="tile" />
        {onClose && (
          <button className="icon-btn" aria-label="Back to top fit" onClick={onClose}>
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <path d="M3 3l10 10M13 3L3 13" />
            </svg>
          </button>
        )}
      </div>
      <div className="pad stack">
        <div className="panel-head">
          <div className="stack-xs grow">
            <h3 className="title-lg">{player.name}</h3>
            <span className="muted">
              <PlayerMeta player={player} /> · {player.gp} games in {player.asOfSeason}
            </span>
          </div>
          <span className="fit-badge">
            <strong>{fit.toFixed(1)}</strong>
            <span>fit</span>
          </span>
        </div>
        <p className="body-text lg">{why}</p>
        <div className="stack-sm">
          <div className="chip-row">
            <span className="chip-row-label">Fills a need</span>
            {helps.length ? helps.map((c) => <span key={c} className="chip blue">{c}</span>) : <span className="muted small">None</span>}
          </div>
          <div className="chip-row">
            <span className="chip-row-label">Costs you</span>
            {hurts.length ? hurts.map((c) => <span key={c} className="chip orange-soft">{c}</span>) : <span className="muted small">Nothing major</span>}
          </div>
          <span className="muted small">
            Base value {value.toFixed(1)}.{" "}
            {fit > value + 0.05
              ? "Fit is higher because he covers what you lack."
              : fit < value - 0.05
                ? "Fit is lower because his strengths are already covered or punted."
                : ""}
          </span>
          {Object.keys(player.gpBySeason).length > 0 && (
            <span className="muted small">
              Games played:{" "}
              {Object.entries(player.gpBySeason)
                .map(([s, g]) => `'${s.slice(2)} ${g}`)
                .join(" · ")}
            </span>
          )}
        </div>
        <button className="btn primary xl" disabled={!view.isUserTurn} onClick={onDraft}>
          {view.isUserTurn ? `Draft ${last}` : "Waiting for your pick…"}
        </button>
      </div>
    </section>
  );
}

function TeamPanel({ view, playerMap }: { view: DraftView; playerMap: Map<string, ApiPlayer> }) {
  const [team, setTeam] = useState(view.userSlot);
  const n = view.numTeams;
  const isYou = team === view.userSlot;
  const punts = teamPunts(view, team);
  const badge = isYou
    ? view.userPunts.length ? `Punt ${view.userPunts.join(", ")}` : "No punt yet"
    : teamBadge(view, team);
  const roster = view.rosters[team].map((id) => playerMap.get(id)!);
  const rec = view.records[team];
  const go = (t: number) => setTeam((t + n) % n);

  return (
    <section className="card pad stack team-panel">
      <div className="team-nav">
        <button className="icon-btn outline" aria-label="Previous team" onClick={() => go(team - 1)}>
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M10 3L5 8l5 5" /></svg>
        </button>
        <select aria-label="Team to view" value={team} onChange={(e) => setTeam(Number(e.target.value))}>
          {Array.from({ length: n }, (_, t) => (
            <option key={t} value={t}>
              {t === view.userSlot ? "You" : `${teamName(view, t)} · ${teamBadge(view, t)}`}
            </option>
          ))}
        </select>
        <button className="icon-btn outline" aria-label="Next team" onClick={() => go(team + 1)}>
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M6 3l5 5-5 5" /></svg>
        </button>
      </div>

      <div className="team-title">
        <h3 className="title">{isYou ? "Your team" : teamName(view, team)}</h3>
        <span className="chip">{badge}</span>
        {roster.length > 0 && (
          <span className="muted small push">
            {rec.wins}–{rec.losses}{rec.ties ? `–${rec.ties}` : ""} so far
          </span>
        )}
      </div>

      <ol className="roster">
        {roster.map((p, i) => (
          <li key={p.id}>
            <span className="muted small rd">Rd {i + 1}</span>
            <Headshot player={p} variant="mini" />
            <strong className="grow">{p.name}</strong>
            <span className="muted small">{p.positions.join("/")}</span>
          </li>
        ))}
        {isYou && view.isUserTurn && (
          <li className="now">
            <span className="small rd">Rd {view.round}</span>
            <strong>Your pick now</strong>
          </li>
        )}
        {roster.length === 0 && !(isYou && view.isUserTurn) && (
          <li className="empty muted">No picks yet</li>
        )}
      </ol>

      {roster.length > 0 && (
        <div className="ranks">
          <div className="ranks-head">
            <strong>Where they rank</strong>
            <span className="muted small">out of {n} teams</span>
          </div>
          {CATEGORIES.map((c) => {
            const r = view.ranks[c][team];
            const p = punts.has(c);
            return (
              <div key={c} className={p ? "rank-row punted" : "rank-row"}>
                <span className="rank-cat">{c}</span>
                <span className="meter">
                  <span className={p ? "punted" : rankTone(r)} style={{ width: `${((n + 1 - r) / n) * 100}%` }} />
                </span>
                <span className="rank-val">{p ? "punted" : ordinal(r)}</span>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
