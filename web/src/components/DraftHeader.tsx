import type { ApiPlayer, DraftView } from "../api/client";
import type { Screen, Speed } from "../state/useSession";
import { snakeTeam, teamName } from "../state/teams";
import { Logo } from "./common";

interface Props {
  view: DraftView;
  speed: Speed;
  screen: Screen;
  onNavigate: (s: Screen) => void;
  onPause: () => void;
  onResume: () => void;
  onSpeed: (s: Speed) => void;
  onExit: () => void;
}

export function DraftHeader({ view, speed, screen, onNavigate, onPause, onResume, onSpeed, onExit }: Props) {
  const pct = (view.pickIndex / view.totalPicks) * 100;
  const yours = view.onClock === view.userSlot;
  return (
    <header className="topbar">
      <div className="topbar-inner">
        <Logo />
        <div className="progress-block">
          <div className="progress-text">
            {view.complete ? (
              <strong>Draft complete</strong>
            ) : (
              <>
                <strong>
                  Round {view.round} of {view.rosterSize} · Pick {view.pickIndex + 1}
                </strong>
                {view.status === "paused" && <span className="chip warn">Paused</span>}
              </>
            )}
          </div>
          <div
            className="progress"
            role="img"
            aria-label={`Draft ${Math.round(pct)}% complete`}
          >
            <div style={{ width: `${pct}%` }} />
          </div>
        </div>
        {!view.complete && (
          <button
            className={yours ? "clock-pill yours" : "clock-pill"}
            title="Go to the draft room"
            onClick={() => onNavigate("draft")}
          >
            <span className="dot" />
            {yours
              ? "Your pick"
              : `${teamName(view, view.onClock ?? 0)} picking`}
          </button>
        )}
        <nav className="seg" aria-label="Draft screens">
          <button aria-pressed={screen === "draft"} onClick={() => onNavigate("draft")}>Draft</button>
          <button aria-pressed={screen === "teams"} onClick={() => onNavigate("teams")}>Teams</button>
        </nav>
        <div className="topbar-actions">
          {!view.complete && (
            <>
              <label className="inline-field">
                Bots
                <select value={speed} onChange={(e) => onSpeed(e.target.value as Speed)}>
                  <option value="fast">Fast</option>
                  <option value="instant">Instant</option>
                  <option value="slow">Slow</option>
                </select>
              </label>
              {view.status === "paused" ? (
                <button className="btn" onClick={onResume}>Resume</button>
              ) : (
                <button className="btn" onClick={onPause}>Pause</button>
              )}
            </>
          )}
          <button className="btn ghost" onClick={onExit}>New draft</button>
        </div>
      </div>
    </header>
  );
}

/** Last few picks, who's on the clock, and who's next. */
export function PickTicker({
  view,
  playerMap,
}: {
  view: DraftView;
  playerMap: Map<string, ApiPlayer>;
}) {
  if (view.complete) return null;
  const recent = view.picks.slice(-4);
  const upcoming = [view.pickIndex + 1, view.pickIndex + 2].filter(
    (i) => i < view.totalPicks,
  );
  return (
    <div className="ticker" aria-label="Recent and upcoming picks">
      {recent.map((p) => (
        <span key={p.index} className="tick">
          <span className="tick-team">{teamName(view, p.teamId)}</span>
          <span className="tick-player">{playerMap.get(p.playerId)?.name}</span>
        </span>
      ))}
      <span className={view.isUserTurn ? "tick now yours" : "tick now"}>
        <span className="tick-team">{teamName(view, view.onClock ?? 0)}</span>
        <span className="tick-player">
          {view.isUserTurn ? "Picking now" : "On the clock"}
        </span>
      </span>
      {upcoming.map((i) => (
        <span key={i} className="tick next">
          <span className="tick-team">{teamName(view, snakeTeam(i, view.numTeams))}</span>
          <span className="tick-player">{i === view.pickIndex + 1 ? "next" : "then"}</span>
        </span>
      ))}
    </div>
  );
}
