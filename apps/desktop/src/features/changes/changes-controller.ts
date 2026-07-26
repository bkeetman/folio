import { invoke } from "../../platform/native";
import type {
  OperationProgress,
  OperationStats,
  PendingChange,
  SyncResult,
} from "../../types/library";
import type {
  ChangesHistoryStatus,
  ChangesModel,
  ChangesMutation,
} from "./changes-model";

const SYNC_CHANGE_ID_PREFIX = "sync:";

type CoverBlob = {
  mime: string;
  bytes: number[];
};

export type PendingCoverPreview = {
  fromCover?: CoverBlob | null;
  toCover?: CoverBlob | null;
};

export type ChangesMutationRequest = {
  operation: ChangesMutation;
  ids: string[];
};

export type ChangesInvoke = <T>(
  command: string,
  args?: Record<string, unknown>,
) => Promise<T>;

export type ChangesNativeGateway = {
  loadChanges: (status: ChangesHistoryStatus) => Promise<PendingChange[]>;
  loadCoverPreview: (changeId: string) => Promise<PendingCoverPreview | null>;
  applyFileChanges: (ids: string[], retrying: boolean) => Promise<void>;
  applySyncChanges: (ids: string[], retrying: boolean) => Promise<SyncResult>;
  findFailedSyncChangeIds: (ids: string[]) => Promise<string[]>;
  removeFileChanges: (ids: string[]) => Promise<number>;
  removeSyncChanges: (ids: string[]) => Promise<number>;
};

type ChangesControllerDependencies = {
  model: ChangesModel;
  gateway: ChangesNativeGateway;
  refreshLibrary: () => Promise<void>;
  reportStatus: (message: string) => void;
};

export type ChangesController = {
  loadHistory: (status: ChangesHistoryStatus, showLoading?: boolean) => Promise<PendingChange[]>;
  refreshPending: () => Promise<number>;
  refreshCurrent: () => Promise<void>;
  executeMutation: (request: ChangesMutationRequest, retrying: boolean) => Promise<void>;
  handleFileProgress: (progress: OperationProgress) => void;
  handleFileComplete: (stats: OperationStats) => Promise<void>;
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

export function createChangesNativeGateway(invoke: ChangesInvoke): ChangesNativeGateway {
  return {
    loadChanges: async (status) => {
      const [fileChanges, syncChanges] = await Promise.all([
        invoke<PendingChange[]>("get_pending_changes", { status }),
        invoke<PendingChange[]>("get_sync_queue_changes", { status }),
      ]);
      return [...fileChanges, ...syncChanges].sort((a, b) => b.created_at - a.created_at);
    },
    loadCoverPreview: (changeId) =>
      invoke<PendingCoverPreview | null>("get_pending_cover_preview", { changeId }),
    applyFileChanges: (ids, retrying) =>
      invoke<void>(retrying ? "retry_pending_changes" : "apply_pending_changes", { ids }),
    applySyncChanges: (ids, retrying) =>
      invoke<SyncResult>(retrying ? "retry_sync_queue_changes" : "apply_sync_queue_changes", {
        ids,
      }),
    findFailedSyncChangeIds: async (ids) => {
      const failedChanges = await invoke<PendingChange[]>("get_sync_queue_changes", {
        status: "error",
      });
      return failedChanges
        .map((change) => change.id.slice(SYNC_CHANGE_ID_PREFIX.length))
        .filter((id) => ids.includes(id));
    },
    removeFileChanges: (ids) => invoke<number>("remove_pending_changes", { ids }),
    removeSyncChanges: (ids) => invoke<number>("remove_sync_queue_changes", { ids }),
  };
}

export const changesNativeGateway = createChangesNativeGateway(invoke);

export function createChangesController({
  model,
  gateway,
  refreshLibrary,
  reportStatus,
}: ChangesControllerDependencies): ChangesController {
  let syncErrors = 0;
  let syncProcessed = 0;
  let historyRequestVersion = 0;

  const loadHistory = async (status: ChangesHistoryStatus, showLoading = true) => {
    if (showLoading && model.getSnapshot().operation.status === "running") {
      return model.getSnapshot().items;
    }
    const requestVersion = ++historyRequestVersion;
    if (showLoading) model.dispatch({ type: "history-requested", status });
    try {
      const items = await gateway.loadChanges(status);
      if (requestVersion !== historyRequestVersion) return items;
      model.dispatch({ type: "history-loaded", status, items });
      return items;
    } catch (error) {
      if (requestVersion !== historyRequestVersion) return [];
      if (showLoading) {
        model.dispatch({ type: "history-failed", status, message: errorMessage(error) });
      } else {
        reportStatus(`Could not refresh changes: ${errorMessage(error)}`);
      }
      return [];
    }
  };

  const refreshPending = async () => {
    try {
      const items = await gateway.loadChanges("pending");
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
  };

  const refreshCurrent = async () => {
    const status = model.getSnapshot().historyStatus;
    await loadHistory(status, false);
    if (status !== "pending") await refreshPending();
  };

  const refreshLibraryAfterApply = async () => {
    await refreshLibrary().catch((error) => {
      reportStatus(`Changes applied, but the library could not refresh: ${errorMessage(error)}`);
    });
  };

  const executeMutation = async (request: ChangesMutationRequest, retrying: boolean) => {
    const { fileIds, syncIds } = splitChangeIds(request.ids);
    syncErrors = 0;
    syncProcessed = 0;
    try {
      if (request.operation === "undo") {
        let processed = 0;
        if (fileIds.length > 0) processed += await gateway.removeFileChanges(fileIds);
        if (syncIds.length > 0) processed += await gateway.removeSyncChanges(syncIds);
        model.dispatch({ type: "operation-completed", processed, errors: 0 });
        await refreshCurrent();
        return;
      }

      if (syncIds.length > 0) {
        const result = await gateway.applySyncChanges(syncIds, retrying);
        syncErrors = result.errors.length;
        syncProcessed = Math.max(0, syncIds.length - result.errors.length);
        if (result.errors.length > 0) {
          const failedIds = await gateway.findFailedSyncChangeIds(syncIds);
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
        await gateway.applyFileChanges(fileIds, retrying);
        return;
      }

      model.dispatch({
        type: "operation-completed",
        processed: syncProcessed,
        errors: syncErrors,
      });
      await refreshCurrent();
      await refreshLibraryAfterApply();
    } catch (error) {
      const message = errorMessage(error);
      model.dispatch({ type: "operation-failed", message });
      reportStatus(`Could not ${request.operation} changes: ${message}`);
    }
  };

  const handleFileProgress = (progress: OperationProgress) => {
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
  };

  const handleFileComplete = async (stats: OperationStats) => {
    const errors = stats.errors + syncErrors;
    const processed = stats.processed + syncProcessed;
    model.dispatch({ type: "operation-completed", processed, errors });
    reportStatus(`Changes complete: ${processed} applied, ${errors} errors.`);
    await refreshCurrent();
    await refreshLibraryAfterApply();
  };

  return {
    loadHistory,
    refreshPending,
    refreshCurrent,
    executeMutation,
    handleFileProgress,
    handleFileComplete,
  };
}
