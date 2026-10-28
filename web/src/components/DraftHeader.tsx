import { useEffect, useRef } from "react";
import type { ApiPlayer, DraftView } from "../api/client";
import type { Screen, Speed } from "../state/useSession";
import { lastUserPick, nextUserPickIndex, snakeTeam, teamName } from "../state/teams";
import { Headshot, Logo } from "./common";

interface Props {
  view: DraftView;
  speed: Speed;
  screen: Screen;
  turnArrivedAt: number | null; // pick index your turn arrived at while watching
  onNavigate: (s: Screen) => void;
  onPause: () => void;
  onResume: () => void;
  onSpeed: (s: Speed) => void;
  onExit: () => void;
}

export function DraftHeader({ view, speed, screen, turnArrivedAt, onNavigate, onPause, onResume, onSpeed, onExit }: Props) {
  const pct = (view.pickIndex / view.totalPicks) * 100;
  const yours = view.onClock === view.userSlot;
  // One ring pulse when the clock comes to you — keyed on the pick so it runs once.
  const arrived = yours && turnArrivedAt === view.pickIndex;
  return (
    <header className="topbar">
      <div className="topbar-inner">
        <Logo />
        <div className="progress-block">
          <div className="progress-text">
            {view.complete ? (
              <>
                <strong>Draft complete</strong>
                {" "}
                <span
                  className="muted small mono"
                  title="Draft code — paste it under 'Same league again?' on the setup screen to replay this league"
                >
                  code {view.seed}
                </span>
              </>
            ) : (
              <>
                <strong>
                  Round {view.round} of {view.rosterSize} · Pick {view.pickIndex + 1}
                </strong>
                {view.status === "paused" && <span className="chip warn">Paused</span>}
                {" "}
                <span
                  className="muted small mono"
                  title="Draft code — paste it under 'Same league again?' on the setup screen to replay this league"
                >
                  code {view.seed}
                </span>
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
            key={arrived ? `arrived-${view.pickIndex}` : "clock"}
            className={["clock-pill", yours ? "yours" : "", arrived ? "arrived" : ""].join(" ").trim()}
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

/**
 * The pick feed: the room's running story. Every pick since your last turn
 * (newest on the right), who's on the clock, who's next — and a status cell
 * that is the room's state: watching, paused, or you're up. Shared by the
 * build screens and the draft room, so it carries across the handoff.
 */
export function PickFeed({
  view,
  playerMap,
  turnArrivedAt,
}: {
  view: DraftView;
  playerMap: Map<string, ApiPlayer>;
  turnArrivedAt: number | null;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  // Keep the newest pick in view as the feed grows.
  useEffect(() => {
    const el = scroller.current;
    if (el) el.scrollLeft = el.scrollWidth;
  }, [view.pickIndex]);

  if (view.complete) return null;
  const yours = view.isUserTurn;
  const paused = view.status === "paused";
  const mine = lastUserPick(view);
  // Your last pick leads the feed, then everything since. Before your first
  // pick: everything so far (capped).
  const since = mine ? view.picks.slice(mine.index) : view.picks.slice(-24);
  const newest = view.picks[view.picks.length - 1]?.index ?? -1;
  const nextMine = nextUserPickIndex(view, view.pickIndex);
  const away = nextMine === null ? null : nextMine - view.pickIndex;
  const onClock = teamName(view, view.onClock ?? 0);
  const upcoming = [view.pickIndex + 1, view.pickIndex + 2].filter((i) => i < view.totalPicks);
  const arrived = yours && turnArrivedAt === view.pickIndex;

  let statusTitle: string;
  let statusText: string;
  if (yours) {
    statusTitle = "You're on the clock";
    statusText = `Pick #${view.pickIndex + 1} · Round ${view.round}`;
  } else if (paused) {
    statusTitle = "Paused";
    statusText = `${onClock} on the clock`;
  } else {
    statusTitle = "Watching";
    statusText =
      away === null
        ? `${onClock} on the clock · your picks are in`
        : `${onClock} on the clock · you're up in ${away} pick${away === 1 ? "" : "s"}`;
  }

  return (
    <div
      className={["feed", yours ? "yours" : paused ? "paused" : "watching", arrived ? "arrived" : ""].join(" ").trim()}
      aria-label="Pick feed"
    >
      <div className="feed-status" key={arrived ? `arrived-${view.pickIndex}` : "status"}>
        <span className="feed-dot" aria-hidden="true" />
        <span className="feed-status-text">
          <strong>{statusTitle}</strong>
          <span>{statusText}</span>
        </span>
      </div>
      {/* Announced once per state change, not on every pick. */}
      <span className="sr-only" aria-live="polite" aria-atomic="true">
        {yours ? `You're on the clock — pick ${view.pickIndex + 1}, round ${view.round}.` : ""}
      </span>
      <div className="feed-scroll" ref={scroller}>
        {since.map((p) => {
          const pl = playerMap.get(p.playerId);
          const isMine = p.teamId === view.userSlot;
          return (
            <span
              key={p.index}
              className={["tick", isMine ? "mine" : "", p.index === newest ? "latest" : ""].join(" ").trim()}
              title={`#${p.index + 1} · ${teamName(view, p.teamId)}`}
            >
              {pl && <Headshot player={pl} variant="mini" />}
              <span className="tick-team">{isMine ? "You" : teamName(view, p.teamId)}</span>
              <span className="tick-player">{pl?.name}</span>
            </span>
          );
        })}
        <span className={yours ? "tick now yours" : "tick now"}>
          <span className="tick-team">{onClock}</span>
          <span className="tick-player">{yours ? "Picking now" : "On the clock"}</span>
        </span>
        {upcoming.map((i) => (
          <span key={i} className="tick next">
            <span className="tick-team">{teamName(view, snakeTeam(i, view.numTeams))}</span>
            <span className="tick-player">{i === view.pickIndex + 1 ? "next" : "then"}</span>
          </span>
        ))}
      </div>
    </div>
  );
}
