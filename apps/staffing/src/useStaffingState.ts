import { useCallback, useEffect, useRef, useState } from "react";
import type {
  AgentData,
  AssignmentData,
  GoLiveData,
  PersonData,
  PodData,
  Row,
  StaffingAPI,
  StaffingAction,
  StaffingPayload,
  WeeklyData,
} from "./types";
import { STAFFING_FN_SLUG } from "./types";

type AgentsListResponse = {
  data?: Row<AgentData>[];
  pagination?: { total_pages?: number };
};

async function fetchAllAgents(api: StaffingAPI): Promise<Row<AgentData>[]> {
  if (typeof api.get !== "function") return [];
  const collected: Row<AgentData>[] = [];
  let page = 1;
  for (;;) {
    let resp: AgentsListResponse | null = null;
    try {
      resp = await api.get<AgentsListResponse>(`custom-tables/pod_agents/rows?page=${page}&limit=100`);
    } catch {
      return collected;
    }
    const rows = resp?.data ?? [];
    collected.push(...rows);
    const totalPages = resp?.pagination?.total_pages ?? 1;
    if (rows.length === 0 || page >= totalPages) break;
    page += 1;
  }
  return collected;
}

type Patcher = (state: StaffingPayload) => StaffingPayload;
type Reconciler = (state: StaffingPayload, serverResponse: unknown) => StaffingPayload;

export type MutateOptions = {
  action: StaffingAction | "planTransition" | "offboardPerson" | "reactivatePerson" | "updateWeekly";
  payload?: Record<string, unknown>;
  optimistic?: Patcher;
  reconcile?: Reconciler;
  successMessage?: string;
};

export type MutateError = { message: string; code?: string };

export type MutateResult<T = unknown> =
  | { ok: true; data: T }
  | { ok: false; error: MutateError };

const EMPTY_STATE: StaffingPayload = { pods: [], people: [], assignments: [], weekly: [], go_lives: [], agents: [] };

export function replacePersonRow(state: StaffingPayload, row: Row<PersonData>): StaffingPayload {
  return {
    ...state,
    people: state.people.some((p) => p.id === row.id)
      ? state.people.map((p) => (p.id === row.id ? row : p))
      : [...state.people, row],
  };
}

export function replaceAssignmentRow(state: StaffingPayload, row: Row<AssignmentData>): StaffingPayload {
  return {
    ...state,
    assignments: state.assignments.some((a) => a.id === row.id)
      ? state.assignments.map((a) => (a.id === row.id ? row : a))
      : [...state.assignments, row],
  };
}

export function removeAssignmentRow(state: StaffingPayload, rowId: string): StaffingPayload {
  return { ...state, assignments: state.assignments.filter((a) => a.id !== rowId) };
}

export function replacePodRow(state: StaffingPayload, row: Row<PodData>): StaffingPayload {
  return {
    ...state,
    pods: state.pods.some((p) => p.id === row.id)
      ? state.pods.map((p) => (p.id === row.id ? row : p))
      : [...state.pods, row],
  };
}

export function replaceWeeklyRow(state: StaffingPayload, row: Row<WeeklyData>): StaffingPayload {
  return {
    ...state,
    weekly: state.weekly.some((w) => w.id === row.id)
      ? state.weekly.map((w) => (w.id === row.id ? row : w))
      : [...state.weekly, row],
  };
}

export function replaceGoLiveRow(state: StaffingPayload, row: Row<GoLiveData>): StaffingPayload {
  return {
    ...state,
    go_lives: state.go_lives.some((g) => g.id === row.id)
      ? state.go_lives.map((g) => (g.id === row.id ? row : g))
      : [...state.go_lives, row],
  };
}

export function removeGoLiveRow(state: StaffingPayload, rowId: string): StaffingPayload {
  return { ...state, go_lives: state.go_lives.filter((g) => g.id !== rowId) };
}

/**
 * Default reconciler: pattern-matches the server response to known shapes and
 * applies in-place updates. No full reload — no UI flash.
 */
function defaultReconcile(state: StaffingPayload, response: unknown): StaffingPayload {
  if (!response || typeof response !== "object") return state;
  const r = response as {
    pod?: Row<PodData>;
    person?: Row<PersonData>;
    assignment?: Row<AssignmentData>;
    weekly?: Row<WeeklyData>;
    go_live?: Row<GoLiveData>;
    open_slot?: Row<AssignmentData> | null;
    deleted?: boolean;
    row_id?: string;
    kind?: string;
    assignment_results?: {
      assignment?: Row<AssignmentData>;
      open_slot?: Row<AssignmentData>;
      choice?: string;
      row_id?: string;
    }[];
  };
  let next = state;
  if (r.pod) next = replacePodRow(next, r.pod);
  if (r.person) next = replacePersonRow(next, r.person);
  if (r.assignment) next = replaceAssignmentRow(next, r.assignment);
  if (r.weekly) next = replaceWeeklyRow(next, r.weekly);
  if (r.go_live) next = replaceGoLiveRow(next, r.go_live);
  if (r.open_slot) next = replaceAssignmentRow(next, r.open_slot);
  if (r.deleted && r.row_id) {
    if (r.kind === "go_live") next = removeGoLiveRow(next, r.row_id);
    else next = removeAssignmentRow(next, r.row_id);
  }
  if (Array.isArray(r.assignment_results)) {
    for (const item of r.assignment_results) {
      if (item.assignment) next = replaceAssignmentRow(next, item.assignment);
      if (item.open_slot) next = replaceAssignmentRow(next, item.open_slot);
      if (item.choice === "delete" && item.row_id) next = removeAssignmentRow(next, item.row_id);
    }
  }
  return next;
}

export function useStaffingState(api: StaffingAPI) {
  const [data, setData] = useState<StaffingPayload>(EMPTY_STATE);
  const [isLoading, setIsLoading] = useState(true);
  const [isMutating, setIsMutating] = useState(false);
  const [error, setError] = useState<MutateError | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const apiRef = useRef(api);
  apiRef.current = api;
  const dataRef = useRef(data);
  dataRef.current = data;
  const hasLoadedRef = useRef(false);

  const setNoticeWithFade = useCallback((msg: string | null) => {
    setNotice(msg);
    if (msg) {
      window.setTimeout(() => {
        setNotice((current) => (current === msg ? null : current));
      }, 3500);
    }
  }, []);

  const load = useCallback(async (opts: { silent?: boolean } = {}) => {
    if (!opts.silent && !hasLoadedRef.current) setIsLoading(true);
    setError(null);
    try {
      // Run ClickUp sync first (non-blocking on error) so the load picks up freshly synced people.
      try {
        await apiRef.current.invokeFunction(STAFFING_FN_SLUG, {
          method: "POST",
          params: { action: "syncClickUpCerts", payload: {} },
        });
      } catch {
        // ignore — load proceeds with whatever data exists.
      }
      const [result, agents] = await Promise.all([
        apiRef.current.invokeFunction<StaffingPayload>(STAFFING_FN_SLUG, {
          method: "POST",
          params: { action: "load", payload: {} },
        }),
        fetchAllAgents(apiRef.current),
      ]);
      setData({
        pods: result.pods ?? [],
        people: result.people ?? [],
        assignments: result.assignments ?? [],
        weekly: result.weekly ?? [],
        go_lives: (result as StaffingPayload).go_lives ?? [],
        agents,
      });
      hasLoadedRef.current = true;
    } catch (err) {
      setError({ message: err instanceof Error ? err.message : "Failed to load staffing data" });
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const mutate = useCallback(
    async <T = unknown>(opts: MutateOptions): Promise<MutateResult<T>> => {
      const { action, payload = {}, optimistic, reconcile, successMessage } = opts;
      const snapshot = dataRef.current;
      if (optimistic) setData(optimistic(snapshot));
      setIsMutating(true);
      setError(null);
      try {
        const result = await apiRef.current.invokeFunction<T>(STAFFING_FN_SLUG, {
          method: "POST",
          params: { action, payload },
        });
        if (reconcile) {
          setData((current) => reconcile(current, result));
        } else {
          setData((current) => defaultReconcile(current, result));
        }
        if (successMessage) setNoticeWithFade(successMessage);
        return { ok: true, data: result };
      } catch (err) {
        setData(snapshot);
        const e = err as { message?: string; code?: string; body?: { code?: string; reason?: string } };
        const code = e?.code ?? e?.body?.code;
        const message = e?.body?.reason ?? e?.message ?? String(err);
        const errObj = { message, code };
        setError(errObj);
        return { ok: false, error: errObj };
      } finally {
        setIsMutating(false);
      }
    },
    [setNoticeWithFade],
  );

  const clearError = useCallback(() => setError(null), []);
  const clearNotice = useCallback(() => setNotice(null), []);

  return {
    pods: data.pods,
    people: data.people,
    assignments: data.assignments,
    weekly: data.weekly,
    goLives: data.go_lives,
    agents: data.agents,
    isLoading,
    isMutating,
    error,
    notice,
    load,
    mutate,
    clearError,
    clearNotice,
  };
}
