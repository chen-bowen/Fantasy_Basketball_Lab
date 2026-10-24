import { useMemo, useState } from "react";
import type { ApiPlayer, Category } from "../api/client";

type StatKey =
  | "pts" | "reb" | "ast" | "stl" | "blk" | "tpm" | "fgp" | "ftp" | "tov";
type SortKey = "val" | "name" | "min" | StatKey;

interface Props {
  players: ApiPlayer[]; // already filtered to available
  scores: Record<string, number>; // value under the user's punt settings
  punts: ReadonlySet<Category>;
  inspectedId: string | null;
  onInspect: (id: string) => void;
}

const statOf: Record<StatKey, (p: ApiPlayer) => number> = {
  pts: (p) => p.pts,
  reb: (p) => p.reb,
  ast: (p) => p.ast,
  stl: (p) => p.stl,
  blk: (p) => p.blk,
  tpm: (p) => p.tpm,
  fgp: (p) => (p.fga > 0 ? p.fgm / p.fga : 0),
  ftp: (p) => (p.fta > 0 ? p.ftm / p.fta : 0),
  tov: (p) => p.tov,
};

const COLS: { key: SortKey; label: string }[] = [
  { key: "val", label: "VAL" },
  { key: "name", label: "Player" },
  { key: "min", label: "MIN" },
  { key: "pts", label: "PTS" },
  { key: "reb", label: "REB" },
  { key: "ast", label: "AST" },
  { key: "stl", label: "STL" },
  { key: "blk", label: "BLK" },
  { key: "tpm", label: "3PM" },
  { key: "fgp", label: "FG%" },
  { key: "ftp", label: "FT%" },
  { key: "tov", label: "TO" },
];

const POSITION_FILTERS = ["All", "G", "F", "C", "PG", "SG", "SF", "PF"] as const;

export function PlayerTable({
  players,
  scores,
  punts,
  inspectedId,
  onInspect,
}: Props) {
  const [query, setQuery] = useState("");
  const [posFilter, setPosFilter] = useState<string>("All");
  const [sortKey, setSortKey] = useState<SortKey>("val");
  const [asc, setAsc] = useState(false);

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    let list = players;
    if (q) {
      list = list.filter(
        (p) =>
          p.name.toLowerCase().includes(q) ||
          p.team.toLowerCase().includes(q),
      );
    }
    if (posFilter !== "All") {
      list = list.filter((p) => p.positions.includes(posFilter));
    }
    type Row = { p: ApiPlayer; val: number; name: string; min: number } & Record<
      StatKey,
      number
    >;
    const keyed: Row[] = list.map((p) => ({
      p,
      val: scores[p.id] ?? 0,
      name: p.name,
      min: p.min,
      pts: p.pts,
      reb: p.reb,
      ast: p.ast,
      stl: p.stl,
      blk: p.blk,
      tpm: p.tpm,
      fgp: statOf.fgp(p),
      ftp: statOf.ftp(p),
      tov: p.tov,
    }));
    const dir = asc ? 1 : -1;
    keyed.sort((a, b) => {
      if (sortKey === "name") return dir * a.name.localeCompare(b.name);
      return dir * (a[sortKey] - b[sortKey]);
    });
    return keyed;
  }, [players, scores, query, posFilter, sortKey, asc]);

  const clickSort = (k: SortKey) => {
    if (k === sortKey) setAsc(!asc);
    else {
      setSortKey(k);
      setAsc(k === "name");
    }
  };

  const punted = (c: string) => punts.has(c as Category);

  return (
    <section className="panel players">
      <div className="panel-head">
        <h2>Available players</h2>
        <input
          placeholder="Search name or team…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <select value={posFilter} onChange={(e) => setPosFilter(e.target.value)}>
          {POSITION_FILTERS.map((p) => (
            <option key={p}>{p}</option>
          ))}
        </select>
      </div>
      <div className="table-wrap">
        <table className="player-table">
          <thead>
            <tr>
              <th className="num">#</th>
              {COLS.map((c) => (
                <th
                  key={c.key}
                  onClick={() => clickSort(c.key)}
                  className={
                    (sortKey === c.key ? "sorted " : "") +
                    (c.key === "name" ? "name" : "num") +
                    (punted(c.label) ? " punted" : "")
                  }
                >
                  {c.label}
                  {sortKey === c.key ? (asc ? " ▲" : " ▼") : ""}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr
                key={r.p.id}
                className={inspectedId === r.p.id ? "inspecting" : ""}
                onClick={() => onInspect(r.p.id)}
              >
                <td className="num muted">{i + 1}</td>
                <td className="num val">{r.val.toFixed(1)}</td>
                <td className="name">
                  {r.p.name}
                  <span className="pos">
                    {r.p.positions.join("/")} · {r.p.team}
                    {r.p.asOfSeason ? ` · '${r.p.asOfSeason.slice(2)}` : ""}
                  </span>
                </td>
                <td className="num">{r.min.toFixed(1)}</td>
                <td className="num">{r.pts.toFixed(1)}</td>
                <td className="num">{r.reb.toFixed(1)}</td>
                <td className="num">{r.ast.toFixed(1)}</td>
                <td className="num">{r.stl.toFixed(1)}</td>
                <td className="num">{r.blk.toFixed(1)}</td>
                <td className="num">{r.tpm.toFixed(1)}</td>
                <td className="num">{(r.fgp * 100).toFixed(1)}</td>
                <td className="num">{(r.ftp * 100).toFixed(1)}</td>
                <td className="num">{r.tov.toFixed(1)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
