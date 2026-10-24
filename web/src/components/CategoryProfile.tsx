import {
  CATEGORIES,
  LOWER_IS_BETTER,
  type Category,
  type ProfileView,
} from "../api/client";

interface Props {
  profile: ProfileView;
  ranks: Record<Category, number[]>; // per-category rank for every team
  teamId: number;
  numTeams: number;
  punts: ReadonlySet<Category>;
  onTogglePunt: (c: Category) => void;
}

const TOTAL_KEY = {
  PTS: "pts",
  REB: "reb",
  AST: "ast",
  STL: "stl",
  BLK: "blk",
  "3PM": "tpm",
  TO: "tov",
} as const;

const catLabel: Record<Category, string> = {
  PTS: "PTS",
  REB: "REB",
  AST: "AST",
  STL: "STL",
  BLK: "BLK",
  "3PM": "3PM",
  "FG%": "FG%",
  "FT%": "FT%",
  TO: "TO ↓",
};

export function CategoryProfile({
  profile,
  ranks,
  teamId,
  numTeams,
  punts,
  onTogglePunt,
}: Props) {
  const total = (c: Category): string => {
    if (c === "FG%")
      return profile.fgPct === null ? "—" : (profile.fgPct * 100).toFixed(1);
    if (c === "FT%")
      return profile.ftPct === null ? "—" : (profile.ftPct * 100).toFixed(1);
    return (profile.totals[TOTAL_KEY[c as keyof typeof TOTAL_KEY]!] ?? 0).toFixed(1);
  };

  const strength = (rank: number) =>
    rank <= numTeams / 3 ? "strong" : rank >= (2 * numTeams) / 3 ? "weak" : "mid";

  return (
    <section className="panel cat-profile">
      <div className="panel-head">
        <h2>Category profile</h2>
      </div>
      <div className="punt-row">
        <span className="muted small">Punt:</span>
        {CATEGORIES.map((c) => (
          <button
            key={c}
            className={punts.has(c) ? "chip on" : "chip"}
            onClick={() => onTogglePunt(c)}
            title="Exclude this category from your displayed rankings"
          >
            {c}
          </button>
        ))}
      </div>
      <table className="mini-table">
        <thead>
          <tr>
            <th></th>
            <th>Total/g</th>
            <th>Per-slot z</th>
            <th>Rank</th>
          </tr>
        </thead>
        <tbody>
          {CATEGORIES.map((c) => {
            const rank = ranks[c][teamId];
            return (
              <tr key={c} className={punts.has(c) ? "punted" : ""}>
                <td>
                  {catLabel[c]}
                  {LOWER_IS_BETTER.has(c) && <span className="sr">*</span>}
                </td>
                <td className="num">{total(c)}</td>
                <td className="num">{profile.perSlotZ[c].toFixed(2)}</td>
                <td className={`num ${strength(rank)}`}>
                  {rank}/{numTeams}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="muted small">
        Roster profile under equal games played — per-slot z compares teams
        fairly mid-draft.
      </p>
    </section>
  );
}
