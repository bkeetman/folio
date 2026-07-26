import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";

import { isTauri, listen } from "../../platform/native";
import type { OperationProgress, OperationStats } from "../../types/library";
import {
  changesNativeGateway,
  createChangesController,
  type ChangesMutationRequest,
} from "./changes-controller";
import {
  createChangesModel,
  type ChangesHistoryStatus,
  type ChangesMutation,
  type ChangesSnapshot,
  type ChangesSourceFilter,
} from "./changes-model";

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
  const fileListenersReadyRef = useRef(false);

  const controller = useMemo(
    () =>
      createChangesController({
        model,
        gateway: changesNativeGateway,
        refreshLibrary,
        reportStatus,
      }),
    [model, refreshLibrary, reportStatus],
  );

  const loadHistory = useCallback(
    async (status: ChangesHistoryStatus, showLoading = true) => {
      if (!enabled || !isTauri()) return [];
      return controller.loadHistory(status, showLoading);
    },
    [controller, enabled],
  );

  const refreshPending = useCallback(async () => {
    if (!enabled || !isTauri()) return 0;
    return controller.refreshPending();
  }, [controller, enabled]);

  const executeNativeMutation = useCallback(
    async (request: ChangesMutationRequest, retrying: boolean) => {
      await controller.executeMutation(request, retrying);
    },
    [controller],
  );

  const startMutation = useCallback(
    (operation: ChangesMutation, ids: string[], retrying = false) => {
      const historyStatus = model.getSnapshot().historyStatus;
      const allowed = historyStatus === "pending" || (retrying && historyStatus === "error");
      if (!enabled || ids.length === 0 || !allowed) return;
      const fileIds = ids.filter((id) => !id.startsWith("sync:"));
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
          controller.handleFileProgress(progress);
        }),
      ),
      register(
        listen<OperationStats>("change-complete", (event) => {
          setChangeProgress(null);
          setApplyingChangeIds(new Set());
          void controller.handleFileComplete(event.payload);
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
  }, [controller, enabled, listenerSetupAttempt, model, reportStatus]);

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
