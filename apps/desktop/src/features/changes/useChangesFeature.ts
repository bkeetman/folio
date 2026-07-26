import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";

import { invoke, isTauri, listen } from "../../platform/native";
import type { OperationProgress, OperationStats, PendingChange, SyncResult } from "../../types/library";
import {
  createChangesModel,
  type ChangesHistoryStatus,
  type ChangesMutation,
  type ChangesSnapshot,
  type ChangesSourceFilter,
} from "./changes-model";

const SYNC_CHANGE_ID_PREFIX = "sync:";

type MutationRequest = {
  operation: ChangesMutation;
  ids: string[];
};

export type ChangesFeatureView = {
  state: ChangesSnapshot;
  applyingChangeIds: ReadonlySet<string>;
  changeProgress: OperationProgress | null;
  confirmDeleteIds: string[];
  actions: {
    showHistory: (status: ChangesHistoryStatus) => void;
    filterSource: (source: ChangesSourceFilter) => void;
    clearDeviceFilter: () => void;
    toggleSelection: (id: string) => void;
    applyAll: () => void;
    applySelected: () => void;
    applyOne: (id: string) => void;
    undoAll: () => void;
    undoSelected: () => void;
    undoOne: (id: string) => void;
    cancelDelete: () => void;
    confirmDelete: () => void;
    retry: () => void;
  };
};

type UseChangesFeatureArgs = {
  enabled: boolean;
  active: boolean;
  refreshSignal: unknown;
  refreshLibrary: () => Promise<void>;
  reportStatus: (message: string) => void;
};

function splitChangeIds(ids: string[]) {
  const fileIds: string[] = [];
  const syncIds: string[] = [];
  for (const id of ids) {
    if (id.startsWith(SYNC_CHANGE_ID_PREFIX)) {
      syncIds.push(id.slice(SYNC_CHANGE_ID_PREFIX.length));
    } else {
      fileIds.push(id);
    }
  }
  return { fileIds, syncIds };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error ?? "Unknown changes error");
}

export function useChangesFeature({
  enabled,
  active,
  refreshSignal,
  refreshLibrary,
  reportStatus,
}: UseChangesFeatureArgs) {
  const [model] = useState(createChangesModel);
  const state = useSyncExternalStore(model.subscribe, model.getSnapshot, model.getSnapshot);
  const [confirmDeleteIds, setConfirmDeleteIds] = useState<string[]>([]);
  const confirmDeleteRetryRef = useRef(false);
  const [applyingChangeIds, setApplyingChangeIds] = useState<Set<string>>(new Set());
  const [changeProgress, setChangeProgress] = useState<OperationProgress | null>(null);
  const [listenerSetupAttempt, setListenerSetupAttempt] = useState(0);
  const syncErrorsRef = useRef(0);
  const syncProcessedRef = useRef(0);
  const fileListenersReadyRef = useRef(false);

  const loadChangesByStatus = useCallback(async (status: ChangesHistoryStatus) => {
    const [fileChanges, syncChanges] = await Promise.all([
      invoke<PendingChange[]>("get_pending_changes", { status }),
      invoke<PendingChange[]>("get_sync_queue_changes", { status }),
    ]);
    return [...fileChanges, ...syncChanges].sort((a, b) => b.created_at - a.created_at);
  }, []);

  const loadHistory = useCallback(
    async (status: ChangesHistoryStatus, showLoading = true) => {
      if (!enabled || !isTauri()) return [];
      if (showLoading && model.getSnapshot().operation.status === "running") {
        return model.getSnapshot().items;
      }
      if (showLoading) model.dispatch({ type: "history-requested", status });
      try {
        const items = await loadChangesByStatus(status);
        model.dispatch({ type: "history-loaded", status, items });
        return items;
      } catch (error) {
        if (showLoading) {
          model.dispatch({ type: "history-failed", status, message: errorMessage(error) });
        } else {
          reportStatus(`Could not refresh changes: ${errorMessage(error)}`);
        }
        return [];
      }
    },
    [enabled, loadChangesByStatus, model, reportStatus],
  );

  const refreshPending = useCallback(async () => {
    if (!enabled || !isTauri()) return 0;
    try {
      const items = await loadChangesByStatus("pending");
      if (model.getSnapshot().historyStatus === "pending") {
        model.dispatch({ type: "history-loaded", status: "pending", items });
      } else {
        model.dispatch({ type: "pending-count-refreshed", count: items.length });
      }
      return items.length;
    } catch (error) {
      reportStatus(`Could not refresh changes: ${errorMessage(error)}`);
      return model.getSnapshot().pendingCount;
    }
  }, [enabled, loadChangesByStatus, model, reportStatus]);

  const refreshCurrent = useCallback(async () => {
    const status = model.getSnapshot().historyStatus;
    await loadHistory(status, false);
    if (status !== "pending") await refreshPending();
  }, [loadHistory, model, refreshPending]);

  const executeNativeMutation = useCallback(
    async (request: MutationRequest, retrying: boolean) => {
      const { fileIds, syncIds } = splitChangeIds(request.ids);
      syncErrorsRef.current = 0;
      syncProcessedRef.current = 0;
      try {
        if (request.operation === "undo") {
          let processed = 0;
          if (fileIds.length > 0) {
            processed += await invoke<number>("remove_pending_changes", { ids: fileIds });
          }
          if (syncIds.length > 0) {
            processed += await invoke<number>("remove_sync_queue_changes", { ids: syncIds });
          }
          model.dispatch({ type: "operation-completed", processed, errors: 0 });
          await refreshCurrent();
          return;
        }

        if (syncIds.length > 0) {
          const syncCommand = retrying ? "retry_sync_queue_changes" : "apply_sync_queue_changes";
          const result = await invoke<SyncResult>(syncCommand, { ids: syncIds });
          syncErrorsRef.current = result.errors.length;
          syncProcessedRef.current = Math.max(0, syncIds.length - result.errors.length);
          if (result.errors.length > 0) {
            const failedChanges = await invoke<PendingChange[]>("get_sync_queue_changes", {
              status: "error",
            });
            const failedIds = failedChanges
              .map((change) => change.id.slice(SYNC_CHANGE_ID_PREFIX.length))
              .filter((id) => syncIds.includes(id));
            const message = result.errors.join("; ");
            (failedIds.length > 0 ? failedIds : syncIds).forEach((id) => {
              model.dispatch({
                type: "operation-progressed",
                itemId: `${SYNC_CHANGE_ID_PREFIX}${id}`,
                status: "error",
                message,
              });
            });
          }
        }

        if (fileIds.length > 0) {
          const fileCommand = retrying ? "retry_pending_changes" : "apply_pending_changes";
          await invoke(fileCommand, { ids: fileIds });
        } else {
          const errors = syncErrorsRef.current;
          model.dispatch({
            type: "operation-completed",
            processed: Math.max(0, syncIds.length - errors),
            errors,
          });
          await refreshCurrent();
          await refreshLibrary().catch((error) => {
            reportStatus(
              `Changes applied, but the library could not refresh: ${errorMessage(error)}`,
            );
          });
        }
      } catch (error) {
        const message = errorMessage(error);
        model.dispatch({ type: "operation-failed", message });
        reportStatus(`Could not ${request.operation} changes: ${message}`);
      }
    },
    [model, refreshCurrent, refreshLibrary, reportStatus],
  );

  const startMutation = useCallback(
    (operation: ChangesMutation, ids: string[], retrying = false) => {
      const historyStatus = model.getSnapshot().historyStatus;
      const allowed = historyStatus === "pending" || (retrying && historyStatus === "error");
      if (!enabled || ids.length === 0 || !allowed) return;
      const { fileIds } = splitChangeIds(ids);
      if (operation === "apply" && fileIds.length > 0 && !fileListenersReadyRef.current) {
        setListenerSetupAttempt((attempt) => attempt + 1);
        reportStatus("Changes are not ready yet. Please try again in a moment.");
        return;
      }
      const request = { operation, ids };
      model.dispatch({ type: "operation-started", operation, ids });
      void executeNativeMutation(request, retrying);
    },
    [enabled, executeNativeMutation, model, reportStatus],
  );

  const applyIds = useCallback(
    (ids: string[]) => {
      const snapshot = model.getSnapshot();
      const retrying = snapshot.historyStatus === "error";
      const deleteIds = snapshot.visibleItems
        .filter((change) => ids.includes(change.id) && change.change_type === "delete")
        .map((change) => change.id);
      if (deleteIds.length > 0) {
        confirmDeleteRetryRef.current = retrying;
        setConfirmDeleteIds(ids);
        return;
      }
      startMutation("apply", ids, retrying);
    },
    [model, startMutation],
  );

  useEffect(() => {
    if (!active || !enabled) return;
    void loadHistory(model.getSnapshot().historyStatus);
    const interval = window.setInterval(() => {
      void loadHistory(model.getSnapshot().historyStatus, false);
    }, 8000);
    return () => window.clearInterval(interval);
  }, [active, enabled, loadHistory, model]);

  useEffect(() => {
    if (!enabled) return;
    void refreshPending();
  }, [enabled, refreshPending, refreshSignal]);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    let unlistenProgress: (() => void) | undefined;
    let unlistenComplete: (() => void) | undefined;
    fileListenersReadyRef.current = false;

    type ListenerRegistration =
      | { ok: true; stop: () => void }
      | { ok: false; error: unknown };
    const register = (promise: Promise<() => void>): Promise<ListenerRegistration> =>
      promise.then(
        (stop) => ({ ok: true, stop }),
        (error: unknown) => ({ ok: false, error }),
      );

    void Promise.all([
      register(
        listen<OperationProgress>("change-progress", (event) => {
          const progress = event.payload;
          setChangeProgress(progress);
          setApplyingChangeIds((previous) => {
            const next = new Set(previous);
            if (progress.status === "processing") next.add(progress.itemId);
            else next.delete(progress.itemId);
            return next;
          });
          model.dispatch({
            type: "operation-progressed",
            itemId: progress.itemId,
            status:
              progress.status === "error"
                ? "error"
                : progress.status === "done"
                  ? "done"
                  : "processing",
            message: progress.message ?? undefined,
          });
        }),
      ),
      register(
        listen<OperationStats>("change-complete", (event) => {
          const errors = event.payload.errors + syncErrorsRef.current;
          const processed = event.payload.processed + syncProcessedRef.current;
          model.dispatch({ type: "operation-completed", processed, errors });
          setChangeProgress(null);
          setApplyingChangeIds(new Set());
          reportStatus(`Changes complete: ${processed} applied, ${errors} errors.`);
          void refreshCurrent();
          void refreshLibrary().catch((error) => {
            reportStatus(`Changes applied, but the library could not refresh: ${errorMessage(error)}`);
          });
        }),
      ),
    ]).then((registrations) => {
      const stops = registrations.flatMap((registration) =>
        registration.ok ? [registration.stop] : [],
      );
      const failure = registrations.find((registration) => !registration.ok);
      if (cancelled || failure) {
        stops.forEach((stop) => stop());
        if (failure && !cancelled) {
          const message = errorMessage(failure.error);
          model.dispatch({
            type: "history-failed",
            status: model.getSnapshot().historyStatus,
            message: `Could not monitor changes: ${message}`,
          });
          reportStatus(`Could not monitor changes: ${message}`);
        }
        return;
      }
      [unlistenProgress, unlistenComplete] = stops;
      fileListenersReadyRef.current = true;
    });

    return () => {
      cancelled = true;
      fileListenersReadyRef.current = false;
      unlistenProgress?.();
      unlistenComplete?.();
    };
  }, [enabled, listenerSetupAttempt, model, refreshCurrent, refreshLibrary, reportStatus]);

  const actions: ChangesFeatureView["actions"] = {
    showHistory: (status) => void loadHistory(status),
    filterSource: (source) => model.dispatch({ type: "source-filter-changed", source }),
    clearDeviceFilter: () => model.dispatch({ type: "device-filter-changed", deviceId: null }),
    toggleSelection: (id) => model.dispatch({ type: "selection-toggled", id }),
    applyAll: () => applyIds(state.visibleItems.map((change) => change.id)),
    applySelected: () => applyIds([...state.selectedIds]),
    applyOne: (id) => applyIds([id]),
    undoAll: () => startMutation("undo", state.visibleItems.map((change) => change.id)),
    undoSelected: () => startMutation("undo", [...state.selectedIds]),
    undoOne: (id) => startMutation("undo", [id]),
    cancelDelete: () => {
      confirmDeleteRetryRef.current = false;
      setConfirmDeleteIds([]);
    },
    confirmDelete: () => {
      const ids = confirmDeleteIds;
      const retrying = confirmDeleteRetryRef.current;
      confirmDeleteRetryRef.current = false;
      setConfirmDeleteIds([]);
      startMutation("apply", ids, retrying);
    },
    retry: () => {
      const operation = model.getSnapshot().operation;
      if (operation.status === "load-error") {
        setListenerSetupAttempt((attempt) => attempt + 1);
        void loadHistory(operation.historyStatus);
        return;
      }
      if (operation.status !== "partial" && operation.status !== "error") return;
      const ids = operation.status === "partial" ? operation.failedIds : operation.ids;
      const request = { operation: operation.operation, ids };
      model.dispatch({ type: "operation-retry-requested" });
      void executeNativeMutation(request, true);
    },
  };

  const view: ChangesFeatureView = {
    state,
    applyingChangeIds,
    changeProgress,
    confirmDeleteIds,
    actions,
  };

  return {
    view,
    pendingCount: state.pendingCount,
    refreshPending,
    openForDevice: (deviceId: string | null) => {
      if (model.getSnapshot().operation.status === "running") return;
      model.dispatch({ type: "source-filter-changed", source: "ereader" });
      model.dispatch({ type: "device-filter-changed", deviceId });
      void loadHistory("pending");
    },
  };
}
