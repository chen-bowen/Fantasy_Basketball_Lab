import { useEffect } from "react";
import { useSession, picksMade } from "./state/session";
import { Lobby } from "./components/Lobby";
import { TopBar, PickFeed } from "./components/TopBar";
import { Builds } from "./components/Builds";
import { Room } from "./components/Room";
import { Report } from "./components/Report";
import { League } from "./components/League";

const TITLE = "Fantasy Draft Lab — Draft Simulator";

export default function App() {
  const { state, actions } = useSession();
  const {
    phase,
    view,
    players,
    playerMap,
    speed,
    inspectedId,
    advice,
    browseAll,
    screen,
    savedSessions,
    results,
    viewingResult,
    viewingResultId,
    boardPrefs,
    turnArrivedAt,
    justPicked,
    error,
  } = state;

  // The tab says so when it's your pick — the draft keeps going while you're elsewhere.
  const yourTurn = phase === "room" && !!view && view.yourPick && !view.complete;
  useEffect(() => {
    document.title = yourTurn ? `● Your pick — ${TITLE}` : TITLE;
    return () => {
      document.title = TITLE;
    };
  }, [yourTurn]);

  // Which body is showing. A change of phase (build → room, room → report)
  // fades the body in and starts it at the top; picks inside a phase don't.
  const buildTurn = view && view.yourPick && !browseAll ? picksMade(view) : null;
  const phaseKey =
    phase !== "room" || !view
      ? "setup"
      : screen === "league"
        ? "league"
        : view.complete
          ? "report"
          : buildTurn === 0 || buildTurn === 1
            ? "build"
            : "room";
  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, [phaseKey]);

  const errorBanner = error && (
    <button className="error-banner" onClick={actions.clearError}>
      {error} <span className="muted">(dismiss)</span>
    </button>
  );

  if (phase === "setup" || !view || !players || !playerMap) {
    return (
      <>
        {errorBanner}
        <Lobby
          playerCount={players?.length ?? 0}
          savedSessions={savedSessions}
          results={results}
          onStart={actions.create}
          onResume={actions.open}
          onOpenResult={actions.openResult}
        />
      </>
    );
  }

  // The user's first two turns get the build screens unless they chose to browse.
  const ready = advice && advice.stage !== null ? advice : null;

  let body;
  if (phaseKey === "league") {
    body = <League view={viewingResult ?? view} playerMap={playerMap} />;
  } else if (phaseKey === "report") {
    body = (
      <Report
        view={viewingResult ?? view}
        isLive={!viewingResult && !!view.id}
        playerMap={playerMap}
        results={results}
        selectedResult={viewingResultId}
        onSelectResult={actions.viewResult}
        onNew={actions.reset}
        onRewind={actions.rewind}
      />
    );
  } else if (phaseKey === "build") {
    body = (
      <Builds
        key={view.atPick}
        view={view}
        playerMap={playerMap}
        result={ready?.stage === (buildTurn === 0 ? "first" : "second") ? ready : null}
        onPick={actions.pickWithConcede}
        onBrowse={() => actions.setBrowseAll(true)}
      />
    );
  } else {
    body = (
      <Room
        view={view}
        playerMap={playerMap}
        inspectedId={inspectedId}
        justPicked={justPicked}
        prefs={boardPrefs}
        onPrefs={actions.setBoardPrefs}
        onInspect={actions.inspect}
        onDismiss={actions.dismissJustPicked}
        onPick={actions.pick}
        onConcede={actions.toggleConcede}
        onAuto={actions.autoConcedes}
        onBack={
          view.yourPick && browseAll && picksMade(view) < 2
            ? () => actions.setBrowseAll(false)
            : null
        }
      />
    );
  }

  return (
    <div className={phaseKey === "room" || phaseKey === "build" ? "page page-fixed" : "page"}>
      {errorBanner}
      <TopBar
        view={view}
        speed={speed}
        screen={screen}
        turnArrivedAt={turnArrivedAt}
        onNavigate={actions.setScreen}
        onPause={actions.pause}
        onResume={actions.resume}
        onSpeed={actions.setSpeed}
        onExit={actions.reset}
      />
      <PickFeed view={view} playerMap={playerMap} turnArrivedAt={turnArrivedAt} />
      <div className="phase" key={phaseKey}>
        {body}
      </div>
    </div>
  );
}
