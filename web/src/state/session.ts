import { useCallback, useEffect, useMemo, useState } from "react";
import {
  api,
  type ApiPlayer,
  type Category,
  type SessionSummary,
  type SessionView,
  type ResultSummary,
  type AdviceResult,
} from "../api/client";

export type Speed = "instant" | "fast" | "slow";
export type Screen = "room" | "league";
export const SPEED_MS: Record<Speed, number> = {
  instant: 25,
  fast: 200,
  slow: 900,
};

const LAST_SESSION_KEY = "fantasy-draft-lab/lastSessionId";
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

function loadBoardPrefs(sessionId: string | null): BoardPrefs {
  if (!sessionId) return DEFAULT_BOARD_PREFS;
  try {
    const raw = localStorage.getItem(`${BOARD_PREFS_KEY}/${sessionId}`);
    return raw ? { ...DEFAULT_BOARD_PREFS, ...JSON.parse(raw) } : DEFAULT_BOARD_PREFS;
  } catch {
    return DEFAULT_BOARD_PREFS;
  }
}

export interface SessionState {
  phase: "setup" | "room";
  view: SessionView | null;
  players: ApiPlayer[] | null;
  playerMap: Map<string, ApiPlayer> | null;
  speed: Speed;
  inspectedId: string | null;
  advice: AdviceResult | null;
  adviceKey: string | null;
  browseAll: boolean; // skip the first/second-pick screens for this turn
  screen: Screen; // draft room vs. all-teams view
  boardPrefs: BoardPrefs;
  /** Pick index at which your turn arrived while you were watching — the
   *  room announces it once; null after a resume or on rival turns. */
  turnArrivedAt: number | null;
  /** The player you just drafted: the panel stays on him briefly. */
  justPicked: { pid: string; at: number } | null;
  savedSessions: SessionSummary[];
  results: ResultSummary[];
  viewingResult: SessionView | null;
  viewingResultId: string | null;
  error: string | null;
}

export function picksMade(view: SessionView): number {
  return view.squads[view.seat].length;
}

/**
 * Session controller over the Python API. All draft mutation happens
 * server-side; this hook owns only UI state (speed, inspection, which result
 * is being viewed) and spaces out rival ticks so the draft unfolds visibly.
 */
export function useSession() {
  const [state, setState] = useState<SessionState>({
    phase: "setup",
    view: null,
    players: null,
    playerMap: null,
    speed: "fast",
    inspectedId: null,
    advice: null,
    adviceKey: null,
    browseAll: false,
    screen: "room",
    boardPrefs: DEFAULT_BOARD_PREFS,
    turnArrivedAt: null,
    justPicked: null,
    savedSessions: [],
    results: [],
    viewingResult: null,
    viewingResultId: null,
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

  // Initial data: player pool + resumable sessions + saved results.
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
    api.listSessions().then((d) => set({ savedSessions: d })).catch(() => {});
    api.listResults().then((r) => set({ results: r })).catch(() => {});
  }, [set, fail]);

  // Rival tick: while a rival is on the clock, advance one pick per speed tick.
  const view = state.view;
  useEffect(() => {
    if (
      !view?.id ||
      view.phase !== "in_progress" ||
      view.complete ||
      view.onClock === null ||
      view.onClock === view.seat
    ) {
      return;
    }
    const id = view.id;
    const timer = setTimeout(() => {
      api.autopilot(id).then(set0).catch(fail);
    }, SPEED_MS[state.speed]);
    return () => clearTimeout(timer);
    function set0(v: SessionView) {
      // The clock just came to you: the room announces it (once per turn).
      set(v.yourPick ? { view: v, turnArrivedAt: v.atPick } : { view: v });
    }
  }, [view, state.speed, set, fail]);

  // Build advice: simulated server-side for the user's first two turns.
  const adviceKey =
    view?.id && view.yourPick && picksMade(view) < 2
      ? `${view.id}:${view.atPick}:${view.concedes.join(",")}`
      : null;
  useEffect(() => {
    if (!adviceKey || !view?.id) return;
    let cancelled = false;
    set({ advice: null, adviceKey });
    api
      .advise(view.id)
      .then((s) => {
        if (!cancelled) set({ advice: s });
      })
      .catch(fail);
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [adviceKey]);

  const inspect = useCallback(
    (pid: string | null) => set({ inspectedId: pid, justPicked: null }),
    [set],
  );

  const dismissJustPicked = useCallback(() => set({ justPicked: null }), [set]);

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

  const enterSession = useCallback(
    (v: SessionView) => {
      localStorage.setItem(LAST_SESSION_KEY, v.id ?? "");
      set({
        view: v,
        phase: "room",
        inspectedId: null,
        viewingResult: null,
        browseAll: false,
        screen: "room",
        boardPrefs: loadBoardPrefs(v.id),
        turnArrivedAt: null,
        justPicked: null,
      });
    },
    [set],
  );

  const create = useCallback(
    (seed: string, seat: number) => {
      api.createSession(seed, seat).then(enterSession).catch(fail);
    },
    [enterSession, fail],
  );

  const open = useCallback(
    (id: string) => {
      api.getSession(id).then(enterSession).catch(fail);
    },
    [enterSession, fail],
  );

  const pick = useCallback(
    (pid: string) => {
      const v = state.view;
      if (!v?.id) return;
      const at = v.atPick;
      api
        .pick(v.id, pid)
        .then((nv) =>
          set({
            view: nv,
            inspectedId: null,
            browseAll: false,
            justPicked: { pid, at },
          }),
        )
        .catch(fail);
    },
    [state.view, set, fail],
  );

  /** Draft a player and start from the plan his build is built around; the
   *  roster keeps adjusting it from here (auto mode). */
  const pickWithConcede = useCallback(
    (pid: string, concede: Category | null) => {
      const v = state.view;
      if (!v?.id) return;
      const id = v.id;
      const at = v.atPick;
      api
        .setConcedes(id, concede ? [concede] : [], "auto")
        .then(() => api.pick(id, pid))
        .then((nv) =>
          set({
            view: nv,
            inspectedId: null,
            browseAll: false,
            justPicked: { pid, at },
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

  const toggleConcede = useCallback(
    (category: Category) => {
      const v = state.view;
      if (!v?.id) return;
      const concedes = v.concedes.includes(category)
        ? v.concedes.filter((c) => c !== category)
        : [...v.concedes, category];
      api.setConcedes(v.id, concedes).then((nv) => set({ view: nv })).catch(fail);
    },
    [state.view, set, fail],
  );

  /** Hand the concede decision back to the roster. */
  const autoConcedes = useCallback(() => {
    const v = state.view;
    if (!v?.id) return;
    api.setConcedes(v.id, v.concedes, "auto").then((nv) => set({ view: nv })).catch(fail);
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
    (at: number) => {
      const v = state.view;
      if (!v?.id) return;
      api
        .rewind(v.id, at)
        .then((nv) => {
          set({
            view: nv,
            inspectedId: null,
            viewingResult: null,
            viewingResultId: null,
            turnArrivedAt: null,
            justPicked: null,
          });
          api.listResults().then((r) => set({ results: r })).catch(() => {});
        })
        .catch(fail);
    },
    [state.view, set, fail],
  );

  const viewResult = useCallback(
    (resultId: string | null) => {
      if (resultId === null) {
        set({ viewingResult: null, viewingResultId: null });
        return;
      }
      api
        .getResult(resultId)
        .then((v) => set({ viewingResult: v, viewingResultId: resultId }))
        .catch(fail);
    },
    [set, fail],
  );

  /** Open a saved result straight from setup. Results are snapshots of
   *  finished drafts with no session id, so the report shows them read-only. */
  const openResult = useCallback(
    (resultId: string) => {
      api
        .getResult(resultId)
        .then((v) =>
          set({
            view: v,
            phase: "room",
            viewingResult: v,
            viewingResultId: resultId,
            inspectedId: null,
            browseAll: false,
            screen: "room",
            turnArrivedAt: null,
            justPicked: null,
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
      viewingResult: null,
      screen: "room",
      turnArrivedAt: null,
      justPicked: null,
    });
    api.listSessions().then((d) => set({ savedSessions: d })).catch(() => {});
    api.listResults().then((r) => set({ results: r })).catch(() => {});
  }, [set]);

  const clearError = useCallback(() => set({ error: null }), [set]);

  return useMemo(
    () => ({
      state,
      actions: {
        create,
        open,
        pick,
        pickWithConcede,
        autoConcedes,
        pause,
        resume,
        setSpeed,
        toggleConcede,
        setBrowseAll,
        setScreen,
        inspect,
        dismissJustPicked,
        setBoardPrefs,
        rewind,
        viewResult,
        openResult,
        reset,
        clearError,
      },
    }),
    [
      state,
      create,
      open,
      pick,
      pickWithConcede,
      autoConcedes,
      pause,
      resume,
      setSpeed,
      toggleConcede,
      setBrowseAll,
      setScreen,
      inspect,
      dismissJustPicked,
      setBoardPrefs,
      rewind,
      viewResult,
      openResult,
      reset,
      clearError,
    ],
  );
}
