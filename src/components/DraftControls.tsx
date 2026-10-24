import type { DraftView } from "../api/client";
import type { Speed } from "../state/useSession";
import { teamBadge, teamName } from "../state/teams";

interface Props {
  view: DraftView;
  speed: Speed;
  onPause: () => void;
  onResume: () => void;
  onSpeed: (s: Speed) => void;
  onExit: () => void;
}

const SPEEDS: Speed[] = ["instant", "fast", "slow"];

export function DraftControls({
  view,
  speed,
  onPause,
  onResume,
  onSpeed,
  onExit,
}: Props) {
  const team = view.onClock;
  const badge = team !== null ? teamBadge(view, team) : null;

  return (
    <header className="controls">
      <div className="controls-left">
        {view.complete ? (
          <strong>Draft complete</strong>
        ) : (
          <>
            <strong>
              Round {view.round} · Pick {view.pickInRound}
            </strong>
            <span className="muted">
              #{view.pickIndex + 1} of {view.totalPicks}
            </span>
            <span className={team === view.userSlot ? "you" : "clock"}>
              {team === view.userSlot
                ? "Your pick"
                : `${teamName(view, team ?? -1)} on the clock`}
              {badge && team !== view.userSlot && (
                <span className="badge">{badge}</span>
              )}
            </span>
            {view.status === "paused" && <span className="badge warn">Paused</span>}
          </>
        )}
      </div>
      <div className="controls-right">
        <div className="seg">
          {SPEEDS.map((s) => (
            <button
              key={s}
              className={speed === s ? "on" : ""}
              onClick={() => onSpeed(s)}
            >
              {s}
            </button>
          ))}
        </div>
        {view.status === "paused" ? (
          <button onClick={onResume}>Resume</button>
        ) : (
          <button onClick={onPause} disabled={view.complete}>
            Pause
          </button>
        )}
        <button className="ghost" onClick={onExit}>
          New draft
        </button>
        <span className="muted small saved">autosaved</span>
      </div>
    </header>
  );
}
