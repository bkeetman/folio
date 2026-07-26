import { deepEqual, equal } from "node:assert/strict";
import { test } from "node:test";

import type { PendingChange, SyncResult } from "../../types/library";
import {
  createChangesController,
  createChangesNativeGateway,
  type ChangesNativeGateway,
  type PendingCoverPreview,
} from "./changes-controller";
import { createChangesModel } from "./changes-model";

function change(
  id: string,
  status: PendingChange["status"] = "pending",
  changeType = "rename",
): PendingChange {
  return {
    id,
    file_id: id,
    change_type: changeType,
    from_path: null,
    to_path: null,
    changes_json: null,
    status,
    created_at: 1,
    applied_at: null,
    error: null,
  };
}

function syncResult(errors: string[] = []): SyncResult {
  return { added: errors.length === 0 ? 1 : 0, removed: 0, imported: 0, updated: 0, errors };
}

function createFixtureGateway(overrides: Partial<ChangesNativeGateway> = {}): ChangesNativeGateway {
  return {
    loadChanges: async () => [],
    loadCoverPreview: async () => null,
    applyFileChanges: async () => undefined,
    applySyncChanges: async () => syncResult(),
    findFailedSyncChangeIds: async () => [],
    removeFileChanges: async (ids) => ids.length,
    removeSyncChanges: async (ids) => ids.length,
    ...overrides,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

test("native gateway maps history and cover preview requests across the Tauri boundary", async () => {
  const calls: Array<{ command: string; args: unknown }> = [];
  const cover: PendingCoverPreview = {
    fromCover: { mime: "image/jpeg", bytes: [1, 2] },
    toCover: { mime: "image/png", bytes: [3, 4] },
  };
  const invoke = async <T>(command: string, args?: unknown): Promise<T> => {
    calls.push({ command, args });
    if (command === "get_pending_changes") return [change("file-1")] as T;
    if (command === "get_sync_queue_changes") {
      return [change("sync:queue-1", "pending", "ereader_add")] as T;
    }
    if (command === "get_pending_cover_preview") return cover as T;
    throw new Error(`Unexpected command: ${command}`);
  };
  const gateway = createChangesNativeGateway(invoke);

  deepEqual(
    (await gateway.loadChanges("pending")).map((item) => item.id),
    ["file-1", "sync:queue-1"],
  );
  deepEqual(await gateway.loadCoverPreview("cover-1"), cover);
  deepEqual(calls, [
    { command: "get_pending_changes", args: { status: "pending" } },
    { command: "get_sync_queue_changes", args: { status: "pending" } },
    { command: "get_pending_cover_preview", args: { changeId: "cover-1" } },
  ]);
});

test("native gateway routes apply, retry, and undo to their matching commands", async () => {
  const calls: Array<{ command: string; args: unknown }> = [];
  const invoke = async <T>(command: string, args?: unknown): Promise<T> => {
    calls.push({ command, args });
    if (command === "apply_sync_queue_changes" || command === "retry_sync_queue_changes") {
      return syncResult() as T;
    }
    if (command === "remove_pending_changes" || command === "remove_sync_queue_changes") {
      return 1 as T;
    }
    return undefined as T;
  };
  const gateway = createChangesNativeGateway(invoke);

  await gateway.applyFileChanges(["file-1"], false);
  await gateway.applyFileChanges(["file-2"], true);
  await gateway.applySyncChanges(["queue-1"], false);
  await gateway.applySyncChanges(["queue-2"], true);
  await gateway.removeFileChanges(["file-3"]);
  await gateway.removeSyncChanges(["queue-3"]);

  deepEqual(calls, [
    { command: "apply_pending_changes", args: { ids: ["file-1"] } },
    { command: "retry_pending_changes", args: { ids: ["file-2"] } },
    { command: "apply_sync_queue_changes", args: { ids: ["queue-1"] } },
    { command: "retry_sync_queue_changes", args: { ids: ["queue-2"] } },
    { command: "remove_pending_changes", args: { ids: ["file-3"] } },
    { command: "remove_sync_queue_changes", args: { ids: ["queue-3"] } },
  ]);
});

test("a stale refresh cannot overwrite a newer history selection", async () => {
  const model = createChangesModel();
  const pending = deferred<PendingChange[]>();
  const applied = deferred<PendingChange[]>();
  const controller = createChangesController({
    model,
    gateway: createFixtureGateway({
      loadChanges: (status) => (status === "pending" ? pending.promise : applied.promise),
    }),
    refreshLibrary: async () => undefined,
    reportStatus: () => undefined,
  });

  const staleRefresh = controller.loadHistory("pending", false);
  const newSelection = controller.loadHistory("applied");
  applied.resolve([change("applied-1", "applied")]);
  await newSelection;
  pending.resolve([change("pending-1")]);
  await staleRefresh;

  equal(model.getSnapshot().historyStatus, "applied");
  deepEqual(model.getSnapshot().visibleItems.map((item) => item.id), ["applied-1"]);
});

test("file apply completes from the native event and refreshes history and library", async () => {
  const model = createChangesModel();
  const applied: Array<{ ids: string[]; retrying: boolean }> = [];
  let historyLoads = 0;
  let libraryRefreshes = 0;
  const controller = createChangesController({
    model,
    gateway: createFixtureGateway({
      applyFileChanges: async (ids, retrying) => {
        applied.push({ ids, retrying });
      },
      loadChanges: async () => {
        historyLoads += 1;
        return [];
      },
    }),
    refreshLibrary: async () => {
      libraryRefreshes += 1;
    },
    reportStatus: () => undefined,
  });

  model.dispatch({ type: "operation-started", operation: "apply", ids: ["file-1"] });
  await controller.executeMutation({ operation: "apply", ids: ["file-1"] }, false);
  equal(model.getSnapshot().operation.status, "running");

  await controller.handleFileComplete({ total: 1, processed: 1, skipped: 0, errors: 0 });

  deepEqual(applied, [{ ids: ["file-1"], retrying: false }]);
  deepEqual(model.getSnapshot().operation, {
    status: "success",
    operation: "apply",
    processed: 1,
    errors: 0,
  });
  equal(historyLoads, 1);
  equal(libraryRefreshes, 1);
});

test("undo removes both change sources and refreshes the current history", async () => {
  const model = createChangesModel();
  const removed: string[][] = [];
  let historyLoads = 0;
  const controller = createChangesController({
    model,
    gateway: createFixtureGateway({
      removeFileChanges: async (ids) => {
        removed.push(ids);
        return ids.length;
      },
      removeSyncChanges: async (ids) => {
        removed.push(ids);
        return ids.length;
      },
      loadChanges: async () => {
        historyLoads += 1;
        return [];
      },
    }),
    refreshLibrary: async () => undefined,
    reportStatus: () => undefined,
  });

  model.dispatch({
    type: "operation-started",
    operation: "undo",
    ids: ["file-1", "sync:queue-1"],
  });
  await controller.executeMutation(
    { operation: "undo", ids: ["file-1", "sync:queue-1"] },
    false,
  );

  deepEqual(removed, [["file-1"], ["queue-1"]]);
  deepEqual(model.getSnapshot().operation, {
    status: "success",
    operation: "undo",
    processed: 2,
    errors: 0,
  });
  equal(historyLoads, 1);
});

test("partial native failure retries only failed changes and refreshes after both attempts", async () => {
  const model = createChangesModel();
  const attempts: Array<{ ids: string[]; retrying: boolean }> = [];
  let historyLoads = 0;
  let libraryRefreshes = 0;
  const gateway = createFixtureGateway({
    applySyncChanges: async (ids, retrying) => {
      attempts.push({ ids, retrying });
      return retrying ? syncResult() : syncResult(["Device is full"]);
    },
    findFailedSyncChangeIds: async () => ["queue-2"],
    loadChanges: async () => {
      historyLoads += 1;
      return [];
    },
  });
  const controller = createChangesController({
    model,
    gateway,
    refreshLibrary: async () => {
      libraryRefreshes += 1;
    },
    reportStatus: () => undefined,
  });

  model.dispatch({
    type: "operation-started",
    operation: "apply",
    ids: ["sync:queue-1", "sync:queue-2"],
  });
  await controller.executeMutation(
    { operation: "apply", ids: ["sync:queue-1", "sync:queue-2"] },
    false,
  );
  deepEqual(model.getSnapshot().operation, {
    status: "partial",
    operation: "apply",
    processed: 1,
    errors: 1,
    failedIds: ["sync:queue-2"],
    message: "Device is full",
  });

  model.dispatch({ type: "operation-retry-requested" });
  const retry = model.getSnapshot().operation;
  if (retry.status !== "running") throw new Error("Expected a running retry");
  await controller.executeMutation({ operation: retry.operation, ids: retry.ids }, true);

  deepEqual(attempts, [
    { ids: ["queue-1", "queue-2"], retrying: false },
    { ids: ["queue-2"], retrying: true },
  ]);
  deepEqual(model.getSnapshot().operation, {
    status: "success",
    operation: "apply",
    processed: 1,
    errors: 0,
  });
  equal(historyLoads, 2);
  equal(libraryRefreshes, 2);
});
