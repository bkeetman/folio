import { deepEqual, equal } from "node:assert/strict";
import { test } from "node:test";

import { createOperationModel } from "./operation-model";

test("only one conflicting operation can run at a time", () => {
  const model = createOperationModel(() => 100);

  equal(model.begin("scan", { label: "Scanning library", canCancel: false }), 1);
  equal(model.begin("import", { label: "Importing books", canCancel: true }), null);
  deepEqual(model.getSnapshot(), {
    status: "running",
    kind: "scan",
    token: 1,
    task: null,
    label: "Scanning library",
    canCancel: false,
    startedAt: 100,
    progress: null,
    processingIds: new Set(),
  });
});

test("progress and cancellation use one predictable lifecycle", () => {
  const model = createOperationModel(() => 200);
  const token = model.begin("enrich", { label: "Enriching metadata", canCancel: true });
  if (token === null) throw new Error("Expected enrichment to start");
  model.update(token, {
    itemId: "book-1",
    status: "processing",
    message: "Looking up metadata",
    current: 1,
    total: 3,
  });

  equal(model.requestCancellation(token + 1), false);
  equal(model.requestCancellation(token), true);
  deepEqual(model.getSnapshot(), {
    status: "cancelling",
    kind: "enrich",
    token,
    task: null,
    label: "Enriching metadata",
    canCancel: true,
    startedAt: 200,
    progress: {
      itemId: "book-1",
      status: "processing",
      message: "Looking up metadata",
      current: 1,
      total: 3,
    },
    processingIds: new Set(["book-1"]),
  });
});

test("completion and errors release the operation lock", () => {
  let now = 300;
  const model = createOperationModel(() => now);
  const organizeToken = model.begin("organize", { label: "Organizing library", canCancel: false });
  if (organizeToken === null) throw new Error("Expected organizer to start");
  now = 350;
  model.complete(organizeToken, "Organizer complete");

  deepEqual(model.getSnapshot(), {
    status: "success",
    kind: "organize",
    token: organizeToken,
    task: null,
    label: "Organizing library",
    finishedAt: 350,
    message: "Organizer complete",
  });
  const metadataToken = model.begin("metadata", { label: "Saving metadata", canCancel: false });
  if (metadataToken === null) throw new Error("Expected metadata to start");
  now = 400;
  model.fail(metadataToken, "Database unavailable");
  deepEqual(model.getSnapshot(), {
    status: "error",
    kind: "metadata",
    token: metadataToken,
    task: null,
    label: "Saving metadata",
    finishedAt: 400,
    message: "Database unavailable",
  });
});

test("late events from an old operation cannot replace the current operation", () => {
  const model = createOperationModel(() => 500);
  const scanToken = model.begin("scan", { label: "Scanning", canCancel: false });
  if (scanToken === null) throw new Error("Expected scan to start");
  model.complete(scanToken, "Done");
  const nextScanToken = model.begin("scan", { label: "Scanning again", canCancel: false });
  if (nextScanToken === null) throw new Error("Expected second scan to start");

  model.update(scanToken, {
    itemId: "late-file",
    status: "done",
    message: null,
    current: 1,
    total: 1,
  });
  model.fail(scanToken, "Late failure");

  const snapshot = model.getSnapshot();
  equal(snapshot.status, "running");
  if (snapshot.status !== "running") throw new Error("Expected second scan to remain active");
  equal(snapshot.kind, "scan");
  equal(snapshot.token, nextScanToken);
});
