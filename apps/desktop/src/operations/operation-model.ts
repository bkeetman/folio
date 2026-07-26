import type { OperationProgress } from "../types/library";

export type OperationKind = "scan" | "import" | "enrich" | "fix" | "organize" | "metadata";
export type OperationToken = number;

export type OperationSnapshot =
  | { status: "idle" }
  | {
      status: "running" | "cancelling";
      kind: OperationKind;
      token: OperationToken;
      task: string | null;
      label: string;
      canCancel: boolean;
      startedAt: number;
      progress: OperationProgress | null;
      processingIds: ReadonlySet<string>;
    }
  | {
      status: "success" | "error";
      kind: OperationKind;
      token: OperationToken;
      task: string | null;
      label: string;
      finishedAt: number;
      message: string;
    };

export type BeginOperationOptions = {
  label: string;
  canCancel: boolean;
  task?: string;
  progress?: OperationProgress | null;
};

export type OperationModel = {
  getSnapshot: () => OperationSnapshot;
  subscribe: (listener: () => void) => () => void;
  getActiveToken: (kind: OperationKind) => OperationToken | null;
  begin: (kind: OperationKind, options: BeginOperationOptions) => OperationToken | null;
  update: (token: OperationToken, progress: OperationProgress) => void;
  requestCancellation: (token: OperationToken) => boolean;
  complete: (token: OperationToken, message: string) => boolean;
  fail: (token: OperationToken, message: string) => boolean;
  reset: () => void;
};

function isBusy(snapshot: OperationSnapshot): snapshot is Extract<
  OperationSnapshot,
  { status: "running" | "cancelling" }
> {
  return snapshot.status === "running" || snapshot.status === "cancelling";
}

export function createOperationModel(now: () => number = Date.now): OperationModel {
  let snapshot: OperationSnapshot = { status: "idle" };
  let nextToken = 1;
  const listeners = new Set<() => void>();

  const publish = (next: OperationSnapshot) => {
    snapshot = next;
    listeners.forEach((listener) => listener());
  };

  return {
    getSnapshot: () => snapshot,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getActiveToken: (kind) => isBusy(snapshot) && snapshot.kind === kind ? snapshot.token : null,
    begin: (kind, options) => {
      if (isBusy(snapshot)) return null;
      const token = nextToken++;
      publish({
        status: "running",
        kind,
        token,
        task: options.task ?? null,
        label: options.label,
        canCancel: options.canCancel,
        startedAt: now(),
        progress: options.progress ?? null,
        processingIds: new Set(),
      });
      return token;
    },
    update: (token, progress) => {
      if (!isBusy(snapshot) || snapshot.token !== token) return;
      const processingIds = new Set(snapshot.processingIds);
      if (progress.status === "processing" || progress.status === "pending") {
        processingIds.add(progress.itemId);
      } else {
        processingIds.delete(progress.itemId);
      }
      publish({ ...snapshot, progress, processingIds });
    },
    requestCancellation: (token) => {
      if (snapshot.status !== "running" || snapshot.token !== token || !snapshot.canCancel) {
        return false;
      }
      publish({ ...snapshot, status: "cancelling" });
      return true;
    },
    complete: (token, message) => {
      if (!isBusy(snapshot) || snapshot.token !== token) return false;
      publish({
        status: "success",
        kind: snapshot.kind,
        token,
        task: snapshot.task,
        label: snapshot.label,
        finishedAt: now(),
        message,
      });
      return true;
    },
    fail: (token, message) => {
      if (!isBusy(snapshot) || snapshot.token !== token) return false;
      publish({
        status: "error",
        kind: snapshot.kind,
        token,
        task: snapshot.task,
        label: snapshot.label,
        finishedAt: now(),
        message,
      });
      return true;
    },
    reset: () => publish({ status: "idle" }),
  };
}
