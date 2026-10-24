import { useMemo } from "react";
import type { Category } from "./api/client";
import { useSession } from "./state/useSession";
import { SetupScreen } from "./components/SetupScreen";
import { DraftControls } from "./components/DraftControls";
import { PlayerTable } from "./components/PlayerTable";
import { PlayerDetails } from "./components/PlayerDetails";
import { TeamRoster } from "./components/TeamRoster";
import { CategoryProfile } from "./components/CategoryProfile";
import { DraftBoard } from "./components/DraftBoard";
import { DraftReport } from "./components/DraftReport";

export default function App() {
  const { state, actions } = useSession();
  const {
    phase,
    view,
    players,
    playerMap,
    speed,
    inspectedId,
    preview,
    savedDrafts,
    runs,
    viewingRun,
    viewingRunId,
    error,
  } = state;

  const punts = useMemo(
    () => new Set<Category>(view?.userPunts ?? []),
    [view],
  );

  const drafted = useMemo(
    () => new Set(view?.draftedIds ?? []),
    [view],
  );

  if (phase === "setup" || !view || !players || !playerMap) {
    return (
      <>
        {error && (
          <div className="error-banner" onClick={actions.clearError}>
            {error}
          </div>
        )}
        <SetupScreen
          playerCount={players?.length ?? 0}
          savedDrafts={savedDrafts}
          onStart={actions.startDraft}
          onResume={actions.resumeDraft}
        />
      </>
    );
  }

  const available = players.filter((p) => !drafted.has(p.id));
  const userRoster = view.rosters[view.userSlot].map(
    (id) => playerMap.get(id)!,
  );
  const userPickIndices = view.picks
    .filter((p) => p.teamId === view.userSlot)
    .map((p) => p.index);
  const inspected = inspectedId ? playerMap.get(inspectedId) : null;
  const shown = viewingRun ?? view;

  return (
    <div className="app">
      {error && (
        <div className="error-banner" onClick={actions.clearError}>
          {error}
        </div>
      )}
      <DraftControls
        view={view}
        speed={speed}
        onPause={actions.pause}
        onResume={actions.resume}
        onSpeed={actions.setSpeed}
        onExit={actions.reset}
      />

      {view.complete ? (
        <DraftReport
          view={shown}
          isLive={!viewingRun}
          playerMap={playerMap}
          runs={runs}
          selectedRun={viewingRunId}
          onSelectRun={actions.viewRun}
          onNewDraft={actions.reset}
          onRewind={actions.rewind}
        />
      ) : (
        <>
          <main className="draft-grid">
            <div className="left">
              <PlayerTable
                players={available}
                scores={view.scores}
                punts={punts}
                inspectedId={inspectedId}
                onInspect={actions.inspect}
              />
            </div>
            <div className="right">
              <TeamRoster
                roster={userRoster}
                rosterSize={view.rosterSize}
                pickIndices={userPickIndices}
                onRewind={actions.rewind}
              />
              <CategoryProfile
                profile={view.profiles[view.userSlot]}
                ranks={view.ranks}
                teamId={view.userSlot}
                numTeams={view.numTeams}
                punts={punts}
                onTogglePunt={actions.togglePunt}
              />
            </div>
          </main>
          <DraftBoard view={view} playerMap={playerMap} />
          {inspected && (
            <PlayerDetails
              player={inspected}
              puntScore={view.scores[inspected.id] ?? null}
              punts={punts}
              preview={preview}
              canDraft={view.isUserTurn}
              onDraft={() => actions.userPick(inspected.id)}
              onClose={() => actions.inspect(null)}
            />
          )}
        </>
      )}
    </div>
  );
}
