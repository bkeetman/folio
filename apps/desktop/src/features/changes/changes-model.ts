import type { PendingChange } from "../../types/library";

export type ChangesHistoryStatus = "pending" | "applied" | "error";
export type ChangesSourceFilter = "all" | "library" | "ereader";
export type ChangesMutation = "apply" | "undo";

export type ChangesOperationState =
  | { status: "idle" }
  | { status: "loading"; historyStatus: ChangesHistoryStatus }
  | { status: "load-error"; historyStatus: ChangesHistoryStatus; message: string }
  | {
      status: "running";
      operation: ChangesMutation;
      ids: string[];
      failedIds: string[];
      message?: string;
    }
  | {
      status: "partial";
      operation: ChangesMutation;
      processed: number;
      errors: number;
      failedIds: string[];
      message: string;
    }
  | {
      status: "error";
      operation: ChangesMutation;
      ids: string[];
      message: string;
    }
  | {
      status: "success";
      operation: ChangesMutation;
      processed: number;
      errors: 0;
    };

export type ChangesSnapshot = {
  historyStatus: ChangesHistoryStatus;
  sourceFilter: ChangesSourceFilter;
  deviceFilter: string | null;
  items: PendingChange[];
  visibleItems: PendingChange[];
  selectedIds: ReadonlySet<string>;
  pendingCount: number;
  operation: ChangesOperationState;
};

export type ChangesEvent =
  | { type: "history-requested"; status: ChangesHistoryStatus }
  | { type: "history-loaded"; status: ChangesHistoryStatus; items: PendingChange[] }
  | { type: "history-failed"; status: ChangesHistoryStatus; message: string }
  | { type: "pending-count-refreshed"; count: number }
  | { type: "source-filter-changed"; source: ChangesSourceFilter }
  | { type: "device-filter-changed"; deviceId: string | null }
  | { type: "selection-toggled"; id: string }
  | { type: "operation-started"; operation: ChangesMutation; ids: string[] }
  | {
      type: "operation-progressed";
      itemId: string;
      status: "processing" | "done" | "error";
      message?: string;
    }
  | { type: "operation-completed"; processed: number; errors: number }
  | { type: "operation-failed"; message: string }
  | { type: "operation-retry-requested" };

export type ChangesModel = {
  getSnapshot: () => ChangesSnapshot;
  dispatch: (event: ChangesEvent) => void;
  subscribe: (listener: () => void) => () => void;
};

type StoredChangesState = Omit<ChangesSnapshot, "visibleItems">;

function isEreaderChange(change: PendingChange): boolean {
  return change.id.startsWith("sync:") || change.change_type.startsWith("ereader_");
}

function getChangeDeviceId(change: PendingChange): string | null {
  if (!change.changes_json) return null;
  try {
    const parsed: unknown = JSON.parse(change.changes_json);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    const deviceId = (parsed as { deviceId?: unknown }).deviceId;
    return typeof deviceId === "string" && deviceId.length > 0 ? deviceId : null;
  } catch {
    return null;
  }
}

function createSnapshot(state: StoredChangesState): ChangesSnapshot {
  const visibleItems = state.items.filter((change) => {
    const ereaderChange = isEreaderChange(change);
    if (state.sourceFilter === "library") return !ereaderChange;
    if (state.sourceFilter === "ereader" && !ereaderChange) return false;
    if (state.deviceFilter) {
      return ereaderChange && getChangeDeviceId(change) === state.deviceFilter;
    }
    return true;
  });
  return { ...state, visibleItems };
}

export function createChangesModel(): ChangesModel {
  let state: StoredChangesState = {
    historyStatus: "pending",
    sourceFilter: "all",
    deviceFilter: null,
    items: [],
    selectedIds: new Set(),
    pendingCount: 0,
    operation: { status: "idle" },
  };
  const listeners = new Set<() => void>();
  let snapshot = createSnapshot(state);

  const dispatch = (event: ChangesEvent) => {
    switch (event.type) {
      case "history-requested":
        if (state.operation.status === "running") break;
        state = {
          ...state,
          historyStatus: event.status,
          operation: { status: "loading", historyStatus: event.status },
        };
        break;
      case "history-loaded":
        if (state.operation.status === "running" && event.status !== state.historyStatus) break;
        state = {
          ...state,
          historyStatus: event.status,
          items: event.items,
          pendingCount: event.status === "pending" ? event.items.length : state.pendingCount,
          operation:
            state.operation.status === "loading" ? { status: "idle" } : state.operation,
        };
        break;
      case "history-failed":
        if (state.operation.status === "running") break;
        state = {
          ...state,
          historyStatus: event.status,
          operation: {
            status: "load-error",
            historyStatus: event.status,
            message: event.message,
          },
        };
        break;
      case "pending-count-refreshed":
        state = { ...state, pendingCount: event.count };
        break;
      case "source-filter-changed":
        state = { ...state, sourceFilter: event.source };
        break;
      case "device-filter-changed":
        state = { ...state, deviceFilter: event.deviceId };
        break;
      case "selection-toggled": {
        const selectedIds = new Set(state.selectedIds);
        if (selectedIds.has(event.id)) selectedIds.delete(event.id);
        else selectedIds.add(event.id);
        state = { ...state, selectedIds };
        break;
      }
      case "operation-started":
        state = {
          ...state,
          operation: {
            status: "running",
            operation: event.operation,
            ids: event.ids,
            failedIds: [],
          },
        };
        break;
      case "operation-progressed":
        if (state.operation.status === "running" && event.status === "error") {
          state = {
            ...state,
            operation: {
              ...state.operation,
              failedIds: [...new Set([...state.operation.failedIds, event.itemId])],
              message: event.message,
            },
          };
        }
        break;
      case "operation-completed":
        if (state.operation.status === "running" && event.errors === 0) {
          state = {
            ...state,
            operation: {
              status: "success",
              operation: state.operation.operation,
              processed: event.processed,
              errors: 0,
            },
          };
        } else if (state.operation.status === "running") {
          state = {
            ...state,
            operation: {
              status: "partial",
              operation: state.operation.operation,
              processed: event.processed,
              errors: event.errors,
              failedIds: state.operation.failedIds,
              message: state.operation.message ?? "Some changes could not be completed.",
            },
          };
        }
        break;
      case "operation-failed":
        if (state.operation.status === "running") {
          state = {
            ...state,
            operation: {
              status: "error",
              operation: state.operation.operation,
              ids: state.operation.ids,
              message: event.message,
            },
          };
        }
        break;
      case "operation-retry-requested":
        if (state.operation.status === "partial") {
          state = {
            ...state,
            operation: {
              status: "running",
              operation: state.operation.operation,
              ids: state.operation.failedIds,
              failedIds: [],
            },
          };
        } else if (state.operation.status === "error") {
          state = {
            ...state,
            operation: {
              status: "running",
              operation: state.operation.operation,
              ids: state.operation.ids,
              failedIds: [],
            },
          };
        }
        break;
    }

    if (
      event.type === "history-loaded" ||
      event.type === "source-filter-changed" ||
      event.type === "device-filter-changed"
    ) {
      const visibleIds = new Set(createSnapshot(state).visibleItems.map((item) => item.id));
      state = {
        ...state,
        selectedIds: new Set([...state.selectedIds].filter((id) => visibleIds.has(id))),
      };
    }
    snapshot = createSnapshot(state);
    listeners.forEach((listener) => listener());
  };

  return {
    getSnapshot: () => snapshot,
    dispatch,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
