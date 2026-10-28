import { useCallback, useEffect, useMemo, useState } from "react";
import {
  api,
  type ApiPlayer,
  type Category,
  type DraftSummary,
  type DraftView,
  type RunSummary,
  type Suggestions,
} from "../api/client";

export type Speed = "instant" | "fast" | "slow";
export type Screen = "draft" | "teams";
export const SPEED_MS: Record<Speed, number> = {
  instant: 25,
  fast: 200,
  slow: 900,
};

const LAST_DRAFT_KEY = "fantasy-draft-lab/lastDraftId";
const BOARD_PREFS_KEY = "fantasy-draft-lab/boardPrefs";
/** How long the panel stays on the player you just drafted before moving on. */
export const JUST_DRAFTED_MS = 2500;

/** The draft-room table's controls. Kept here, not in the table, so they
 *  survive the build screens and the Teams view between your picks. */
export interface BoardPrefs {
  mode: "fit" | "numbers";
  sortBy: "fit" | "value";
  query: string;
  pos: string;
  limit: number;
  detailOpen: boolean; // the panel's per-category section
}
export const DEFAULT_BOARD_PREFS: BoardPrefs = {
  mode: "fit",
  sortBy: "fit",
  query: "",
  pos: "All",
  limit: 50,
  detailOpen: false,
};

function loadBoardPrefs(draftId: string | null): BoardPrefs {
  if (!draftId) return DEFAULT_BOARD_PREFS;
  try {
    const raw = localStorage.getItem(`${BOARD_PREFS_KEY}/${draftId}`);
    return raw ? { ...DEFAULT_BOARD_PREFS, ...JSON.parse(raw) } : DEFAULT_BOARD_PREFS;
  } catch {
    return DEFAULT_BOARD_PREFS;
  }
}

export interface SessionState {
  phase: "setup" | "draft";
  view: DraftView | null;
  players: ApiPlayer[] | null;
  playerMap: Map<string, ApiPlayer> | null;
  speed: Speed;
  inspectedId: string | null;
  suggestions: Suggestions | null;
  suggestionsKey: string | null;
  browseAll: boolean; // skip the first/second-pick screens for this turn
  screen: Screen; // draft room vs. all-teams view
  boardPrefs: BoardPrefs;
  /** Pick index at which your turn arrived while you were watching — the
   *  room announces it once; null after a resume or on bot turns. */
  turnArrivedAt: number | null;
  /** The player you just drafted: the panel stays on him briefly. */
  justDrafted: { playerId: string; pickIndex: number } | null;
  savedDrafts: DraftSummary[];
  runs: RunSummary[];
  viewingRun: DraftView | null;
  viewingRunId: string | null;
  error: string | null;
}

export function userPickCount(view: DraftView): number {
  return view.rosters[view.userSlot].length;
}

/**
 * Session controller over the Python API. All draft mutation happens
 * server-side; this hook owns only UI state (speed, inspection, which run
 * is being viewed) and spaces out bot ticks so the draft unfolds visibly.
 */
export function useSession() {
  const [state, setState] = useState<SessionState>({
    phase: "setup",
    view: null,
    players: null,
    playerMap: null,
    speed: "fast",
    inspectedId: null,
    suggestions: null,
    suggestionsKey: null,
    browseAll: false,
    screen: "draft",
    boardPrefs: DEFAULT_BOARD_PREFS,
    turnArrivedAt: null,
    justDrafted: null,
    savedDrafts: [],
    runs: [],
    viewingRun: null,
    viewingRunId: null,
    error: null,
  });

  const set = useCallback(
    (patch: Partial<SessionState>) =>
      setState((s) => ({ ...s, ...patch })),
    [],
  );

  const fail = useCallback(
    (e: unknown) =>
      set({ error: e instanceof Error ? e.message : String(e) }),
    [set],
  );

  // Initial data: player pool + resumable drafts + saved runs.
  useEffect(() => {
    api
      .players()
      .then(({ players }) => {
        set({
          players,
          playerMap: new Map(players.map((p) => [p.id, p])),
        });
      })
      .catch(fail);
    api.listDrafts().then((d) => set({ savedDrafts: d })).catch(() => {});
    api.listRuns().then((r) => set({ runs: r })).catch(() => {});
  }, [set, fail]);

  // Bot tick: while a bot is on the clock, advance one pick per speed tick.
  const view = state.view;
  useEffect(() => {
    if (
      !view?.id ||
      view.status !== "in_progress" ||
      view.complete ||
      view.onClock === null ||
      view.onClock === view.userSlot
    ) {
      return;
    }
    const id = view.id;
    const timer = setTimeout(() => {
      api.botPick(id).then(set0).catch(fail);
    }, SPEED_MS[state.speed]);
    return () => clearTimeout(timer);
    function set0(v: DraftView) {
      // The clock just came to you: the room announces it (once per turn).
      set(v.isUserTurn ? { view: v, turnArrivedAt: v.pickIndex } : { view: v });
    }
  }, [view, state.speed, set, fail]);

  // Build suggestions: simulated server-side for the user's first two turns.
  const suggestionsKey =
    view?.id && view.isUserTurn && userPickCount(view) < 2
      ? `${view.id}:${view.pickIndex}:${view.userPunts.join(",")}`
      : null;
  useEffect(() => {
    if (!suggestionsKey || !view?.id) return;
    let cancelled = false;
    set({ suggestions: null, suggestionsKey });
    api
      .suggestions(view.id)
      .then((s) => {
        if (!cancelled) set({ suggestions: s });
      })
      .catch(fail);
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [suggestionsKey]);

  const inspect = useCallback(
    (playerId: string | null) => set({ inspectedId: playerId, justDrafted: null }),
    [set],
  );

  const dismissJustDrafted = useCallback(() => set({ justDrafted: null }), [set]);

  const setBoardPrefs = useCallback(
    (patch: Partial<BoardPrefs>) =>
      setState((s) => {
        const boardPrefs = { ...s.boardPrefs, ...patch };
        if (s.view?.id) {
          try {
            localStorage.setItem(`${BOARD_PREFS_KEY}/${s.view.id}`, JSON.stringify(boardPrefs));
          } catch {
            /* storage unavailable: prefs still live for the session */
          }
        }
        return { ...s, boardPrefs };
      }),
    [],
  );

  const enterDraft = useCallback(
    (v: DraftView) => {
      localStorage.setItem(LAST_DRAFT_KEY, v.id ?? "");
      set({
        view: v,
        phase: "draft",
        inspectedId: null,
        viewingRun: null,
        browseAll: false,
        screen: "draft",
        boardPrefs: loadBoardPrefs(v.id),
        turnArrivedAt: null,
        justDrafted: null,
      });
    },
    [set],
  );

  const startDraft = useCallback(
    (seed: string, userSlot: number) => {
      api.createDraft(seed, userSlot).then(enterDraft).catch(fail);
    },
    [enterDraft, fail],
  );

  const resumeDraft = useCallback(
    (id: string) => {
      api.getDraft(id).then(enterDraft).catch(fail);
    },
    [enterDraft, fail],
  );

  const userPick = useCallback(
    (playerId: string) => {
      const v = state.view;
      if (!v?.id) return;
      const pickIndex = v.pickIndex;
      api
        .pick(v.id, playerId)
        .then((nv) =>
          set({
            view: nv,
            inspectedId: null,
            browseAll: false,
            justDrafted: { playerId, pickIndex },
          }),
        )
        .catch(fail);
    },
    [state.view, set, fail],
  );

  /** Draft a player and start from the plan his build is built around; the
   *  roster keeps adjusting it from here (auto mode). */
  const draftWithPunt = useCallback(
    (playerId: string, punt: Category | null) => {
      const v = state.view;
      if (!v?.id) return;
      const id = v.id;
      const pickIndex = v.pickIndex;
      api
        .setPunts(id, punt ? [punt] : [], "auto")
        .then(() => api.pick(id, playerId))
        .then((nv) =>
          set({
            view: nv,
            inspectedId: null,
            browseAll: false,
            justDrafted: { playerId, pickIndex },
          }),
        )
        .catch(fail);
    },
    [state.view, set, fail],
  );

  const pause = useCallback(() => {
    const v = state.view;
    if (v?.id) api.pause(v.id).then((nv) => set({ view: nv })).catch(fail);
  }, [state.view, set, fail]);

  const resume = useCallback(() => {
    const v = state.view;
    if (v?.id) api.resume(v.id).then((nv) => set({ view: nv })).catch(fail);
  }, [state.view, set, fail]);

  const setSpeed = useCallback((speed: Speed) => set({ speed }), [set]);

  const togglePunt = useCallback(
    (category: Category) => {
      const v = state.view;
      if (!v?.id) return;
      const punts = v.userPunts.includes(category)
        ? v.userPunts.filter((c) => c !== category)
        : [...v.userPunts, category];
      api.setPunts(v.id, punts).then((nv) => set({ view: nv })).catch(fail);
    },
    [state.view, set, fail],
  );

  /** Hand the punt decision back to the roster. */
  const autoPunts = useCallback(() => {
    const v = state.view;
    if (!v?.id) return;
    api.setPunts(v.id, v.userPunts, "auto").then((nv) => set({ view: nv })).catch(fail);
  }, [state.view, set, fail]);

  const setBrowseAll = useCallback(
    (browseAll: boolean) => set({ browseAll }),
    [set],
  );

  const setScreen = useCallback(
    (screen: Screen) => set({ screen }),
    [set],
  );

  const rewind = useCallback(
    (pickIndex: number) => {
      const v = state.view;
      if (!v?.id) return;
      api
        .rewind(v.id, pickIndex)
        .then((nv) => {
          set({
            view: nv,
            inspectedId: null,
            viewingRun: null,
            viewingRunId: null,
            turnArrivedAt: null,
            justDrafted: null,
          });
          api.listRuns().then((r) => set({ runs: r })).catch(() => {});
        })
        .catch(fail);
    },
    [state.view, set, fail],
  );

  const viewRun = useCallback(
    (runId: string | null) => {
      if (runId === null) {
        set({ viewingRun: null, viewingRunId: null });
        return;
      }
      api
        .getRun(runId)
        .then((v) => set({ viewingRun: v, viewingRunId: runId }))
        .catch(fail);
    },
    [set, fail],
  );

  /** Open a saved run straight from setup. Runs are snapshots of finished
   *  drafts with no draft id, so the report shows them read-only. */
  const openRun = useCallback(
    (runId: string) => {
      api
        .getRun(runId)
        .then((v) =>
          set({
            view: v,
            phase: "draft",
            viewingRun: v,
            viewingRunId: runId,
            inspectedId: null,
            browseAll: false,
            screen: "draft",
            turnArrivedAt: null,
            justDrafted: null,
          }),
        )
        .catch(fail);
    },
    [set, fail],
  );

  const reset = useCallback(() => {
    set({
      phase: "setup",
      view: null,
      inspectedId: null,
      viewingRun: null,
      screen: "draft",
      turnArrivedAt: null,
      justDrafted: null,
    });
    api.listDrafts().then((d) => set({ savedDrafts: d })).catch(() => {});
    api.listRuns().then((r) => set({ runs: r })).catch(() => {});
  }, [set]);

  const clearError = useCallback(() => set({ error: null }), [set]);

  return useMemo(
    () => ({
      state,
      actions: {
        startDraft,
        resumeDraft,
        userPick,
        draftWithPunt,
        autoPunts,
        pause,
        resume,
        setSpeed,
        togglePunt,
        setBrowseAll,
        setScreen,
        inspect,
        dismissJustDrafted,
        setBoardPrefs,
        rewind,
        viewRun,
        openRun,
        reset,
        clearError,
      },
    }),
    [
      state,
      startDraft,
      resumeDraft,
      userPick,
      draftWithPunt,
      autoPunts,
      pause,
      resume,
      setSpeed,
      togglePunt,
      setBrowseAll,
      setScreen,
      inspect,
      dismissJustDrafted,
      setBoardPrefs,
      rewind,
      viewRun,
      openRun,
      reset,
      clearError,
    ],
  );
}
