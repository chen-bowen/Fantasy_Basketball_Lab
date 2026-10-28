import { useEffect } from "react";
import { useSession, userPickCount } from "./state/useSession";
import { SetupScreen } from "./components/SetupScreen";
import { DraftHeader, PickFeed } from "./components/DraftHeader";
import { BuildScreen } from "./components/BuildScreen";
import { DraftRoom } from "./components/DraftRoom";
import { DraftReport } from "./components/DraftReport";
import { TeamsScreen } from "./components/TeamsScreen";

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
    suggestions,
    browseAll,
    screen,
    savedDrafts,
    runs,
    viewingRun,
    viewingRunId,
    boardPrefs,
    turnArrivedAt,
    justDrafted,
    error,
  } = state;

  // The tab says so when it's your pick — the draft keeps going while you're elsewhere.
  const yourTurn = phase === "draft" && !!view && view.isUserTurn && !view.complete;
  useEffect(() => {
    document.title = yourTurn ? `● Your pick — ${TITLE}` : TITLE;
    return () => {
      document.title = TITLE;
    };
  }, [yourTurn]);

  // Which body is showing. A change of phase (build → room, room → report)
  // fades the body in and starts it at the top; picks inside a phase don't.
  const buildTurn = view && view.isUserTurn && !browseAll ? userPickCount(view) : null;
  const phaseKey =
    phase !== "draft" || !view
      ? "setup"
      : screen === "teams"
        ? "teams"
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
        <SetupScreen
          playerCount={players?.length ?? 0}
          savedDrafts={savedDrafts}
          runs={runs}
          onStart={actions.startDraft}
          onResume={actions.resumeDraft}
          onOpenRun={actions.openRun}
        />
      </>
    );
  }

  // The user's first two turns get the build screens unless they chose to browse.
  const ready = suggestions && suggestions.stage !== null ? suggestions : null;

  let body;
  if (phaseKey === "teams") {
    body = <TeamsScreen view={viewingRun ?? view} playerMap={playerMap} />;
  } else if (phaseKey === "report") {
    body = (
      <DraftReport
        view={viewingRun ?? view}
        isLive={!viewingRun && !!view.id}
        playerMap={playerMap}
        runs={runs}
        selectedRun={viewingRunId}
        onSelectRun={actions.viewRun}
        onNewDraft={actions.reset}
        onRewind={actions.rewind}
      />
    );
  } else if (phaseKey === "build") {
    body = (
      <BuildScreen
        key={view.pickIndex}
        view={view}
        playerMap={playerMap}
        result={ready?.stage === (buildTurn === 0 ? "first" : "second") ? ready : null}
        onDraft={actions.draftWithPunt}
        onBrowse={() => actions.setBrowseAll(true)}
      />
    );
  } else {
    body = (
      <DraftRoom
        view={view}
        playerMap={playerMap}
        inspectedId={inspectedId}
        justDrafted={justDrafted}
        prefs={boardPrefs}
        onPrefs={actions.setBoardPrefs}
        onInspect={actions.inspect}
        onDismissJustDrafted={actions.dismissJustDrafted}
        onDraft={actions.userPick}
        onTogglePunt={actions.togglePunt}
        onAutoPunts={actions.autoPunts}
        onBackToBuild={
          view.isUserTurn && browseAll && userPickCount(view) < 2
            ? () => actions.setBrowseAll(false)
            : null
        }
      />
    );
  }

  return (
    <div className={phaseKey === "room" || phaseKey === "build" ? "page page-fixed" : "page"}>
      {errorBanner}
      <DraftHeader
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
