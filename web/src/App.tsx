import { useSession, userPickCount } from "./state/useSession";
import { SetupScreen } from "./components/SetupScreen";
import { DraftHeader, PickTicker } from "./components/DraftHeader";
import { BuildScreen } from "./components/BuildScreen";
import { DraftRoom } from "./components/DraftRoom";
import { DraftReport } from "./components/DraftReport";
import { TeamsScreen } from "./components/TeamsScreen";

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
    error,
  } = state;

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
          onStart={actions.startDraft}
          onResume={actions.resumeDraft}
        />
      </>
    );
  }

  // The user's first two turns get the build screens unless they chose to browse.
  const buildTurn = view.isUserTurn && !browseAll ? userPickCount(view) : null;
  const ready = suggestions && suggestions.stage !== null ? suggestions : null;

  let body;
  if (screen === "teams") {
    body = <TeamsScreen view={viewingRun ?? view} playerMap={playerMap} />;
  } else if (view.complete) {
    body = (
      <DraftReport
        view={viewingRun ?? view}
        isLive={!viewingRun}
        playerMap={playerMap}
        runs={runs}
        selectedRun={viewingRunId}
        onSelectRun={actions.viewRun}
        onNewDraft={actions.reset}
        onRewind={actions.rewind}
      />
    );
  } else if (buildTurn === 0 || buildTurn === 1) {
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
        onInspect={actions.inspect}
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
    <div className="page">
      {errorBanner}
      <DraftHeader
        view={view}
        speed={speed}
        screen={screen}
        onNavigate={actions.setScreen}
        onPause={actions.pause}
        onResume={actions.resume}
        onSpeed={actions.setSpeed}
        onExit={actions.reset}
      />
      <PickTicker view={view} playerMap={playerMap} />
      {body}
    </div>
  );
}
