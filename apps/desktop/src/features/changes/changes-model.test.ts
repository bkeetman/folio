import { deepEqual, equal } from "node:assert/strict";
import { test } from "node:test";

import { createChangesModel } from "./changes-model";
import type { PendingChange } from "../../types/library";

function pendingChange(
  id: string,
  changeType: string,
  changesJson: string | null = null,
): PendingChange {
  return {
    id,
    file_id: id,
    change_type: changeType,
    from_path: null,
    to_path: null,
    changes_json: changesJson,
    status: "pending",
    created_at: 1,
    applied_at: null,
    error: null,
  };
}

test("loaded change history exposes the selected source and pending count", () => {
  const model = createChangesModel();

  model.dispatch({ type: "history-requested", status: "pending" });
  equal(model.getSnapshot().operation.status, "loading");

  model.dispatch({
    type: "history-loaded",
    status: "pending",
    items: [
      pendingChange("file-1", "rename"),
      pendingChange(
        "sync:queue-1",
        "ereader_add",
        JSON.stringify({ deviceId: "kobo-1" }),
      ),
    ],
  });

  equal(model.getSnapshot().pendingCount, 2);
  equal(model.getSnapshot().operation.status, "idle");
  deepEqual(model.getSnapshot().visibleItems.map((item) => item.id), [
    "file-1",
    "sync:queue-1",
  ]);

  model.dispatch({ type: "source-filter-changed", source: "library" });
  deepEqual(model.getSnapshot().visibleItems.map((item) => item.id), ["file-1"]);
});

test("changing filters removes hidden changes from the selection", () => {
  const model = createChangesModel();
  model.dispatch({
    type: "history-loaded",
    status: "pending",
    items: [
      pendingChange("file-1", "rename"),
      pendingChange(
        "sync:queue-1",
        "ereader_add",
        JSON.stringify({ deviceId: "kobo-1" }),
      ),
      pendingChange(
        "sync:queue-2",
        "ereader_add",
        JSON.stringify({ deviceId: "kindle-1" }),
      ),
    ],
  });
  model.dispatch({ type: "selection-toggled", id: "file-1" });
  model.dispatch({ type: "selection-toggled", id: "sync:queue-1" });

  model.dispatch({ type: "source-filter-changed", source: "ereader" });
  deepEqual([...model.getSnapshot().selectedIds], ["sync:queue-1"]);

  model.dispatch({ type: "device-filter-changed", deviceId: "kindle-1" });
  deepEqual(model.getSnapshot().visibleItems.map((item) => item.id), ["sync:queue-2"]);
  equal(model.getSnapshot().selectedIds.size, 0);
});

test("partial apply failures remain visible and retry only failed changes", () => {
  const model = createChangesModel();

  model.dispatch({
    type: "operation-started",
    operation: "apply",
    ids: ["file-1", "file-2"],
  });
  deepEqual(model.getSnapshot().operation, {
    status: "running",
    operation: "apply",
    ids: ["file-1", "file-2"],
    failedIds: [],
  });

  model.dispatch({
    type: "operation-progressed",
    itemId: "file-2",
    status: "error",
    message: "File is locked",
  });
  model.dispatch({
    type: "operation-completed",
    processed: 1,
    errors: 1,
  });

  deepEqual(model.getSnapshot().operation, {
    status: "partial",
    operation: "apply",
    processed: 1,
    errors: 1,
    failedIds: ["file-2"],
    message: "File is locked",
  });

  model.dispatch({ type: "operation-retry-requested" });
  deepEqual(model.getSnapshot().operation, {
    status: "running",
    operation: "apply",
    ids: ["file-2"],
    failedIds: [],
  });
});

test("apply and undo share retryable failure and completion states", () => {
  const model = createChangesModel();

  model.dispatch({
    type: "operation-started",
    operation: "undo",
    ids: ["file-1"],
  });
  model.dispatch({
    type: "operation-failed",
    message: "Database is busy",
  });
  deepEqual(model.getSnapshot().operation, {
    status: "error",
    operation: "undo",
    ids: ["file-1"],
    message: "Database is busy",
  });

  model.dispatch({ type: "operation-retry-requested" });
  equal(model.getSnapshot().operation.status, "running");
  model.dispatch({ type: "operation-completed", processed: 1, errors: 0 });
  deepEqual(model.getSnapshot().operation, {
    status: "success",
    operation: "undo",
    processed: 1,
    errors: 0,
  });
});

test("refreshing history preserves a visible mutation result", () => {
  const model = createChangesModel();
  model.dispatch({
    type: "operation-started",
    operation: "apply",
    ids: ["file-1"],
  });
  model.dispatch({
    type: "operation-progressed",
    itemId: "file-1",
    status: "error",
    message: "Permission denied",
  });
  model.dispatch({ type: "operation-completed", processed: 0, errors: 1 });

  model.dispatch({
    type: "history-loaded",
    status: "error",
    items: [{ ...pendingChange("file-1", "rename"), status: "error" }],
  });

  equal(model.getSnapshot().operation.status, "partial");
  deepEqual(model.getSnapshot().visibleItems.map((item) => item.id), ["file-1"]);
});

test("history navigation cannot interrupt a running mutation", () => {
  const model = createChangesModel();
  model.dispatch({
    type: "operation-started",
    operation: "apply",
    ids: ["file-1"],
  });

  model.dispatch({ type: "history-requested", status: "applied" });
  model.dispatch({ type: "history-loaded", status: "applied", items: [] });
  model.dispatch({
    type: "history-failed",
    status: "applied",
    message: "History unavailable",
  });

  deepEqual(model.getSnapshot().operation, {
    status: "running",
    operation: "apply",
    ids: ["file-1"],
    failedIds: [],
  });
  equal(model.getSnapshot().historyStatus, "pending");
});

test("history load failures are visible without discarding the last good list", () => {
  const model = createChangesModel();
  model.dispatch({
    type: "history-loaded",
    status: "pending",
    items: [pendingChange("file-1", "rename")],
  });
  model.dispatch({ type: "history-requested", status: "pending" });
  model.dispatch({
    type: "history-failed",
    status: "pending",
    message: "Native backend unavailable",
  });

  deepEqual(model.getSnapshot().visibleItems.map((item) => item.id), ["file-1"]);
  deepEqual(model.getSnapshot().operation, {
    status: "load-error",
    historyStatus: "pending",
    message: "Native backend unavailable",
  });
});

test("pending count refresh does not replace the selected history", () => {
  const model = createChangesModel();
  model.dispatch({
    type: "history-loaded",
    status: "applied",
    items: [{ ...pendingChange("file-1", "rename"), status: "applied" }],
  });
  model.dispatch({ type: "pending-count-refreshed", count: 4 });

  equal(model.getSnapshot().historyStatus, "applied");
  equal(model.getSnapshot().pendingCount, 4);
  deepEqual(model.getSnapshot().visibleItems.map((item) => item.id), ["file-1"]);
});
