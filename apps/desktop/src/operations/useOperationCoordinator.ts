import { useMemo, useState, useSyncExternalStore } from "react";

import {
  createOperationModel,
  type BeginOperationOptions,
  type OperationKind,
  type OperationSnapshot,
  type OperationToken,
} from "./operation-model";
import type { OperationProgress } from "../types/library";

export type OperationCoordinator = {
  state: OperationSnapshot;
  isBusy: boolean;
  isRunning: (kind: OperationKind, task?: string) => boolean;
  getActiveToken: (kind: OperationKind) => OperationToken | null;
  begin: (kind: OperationKind, options: BeginOperationOptions) => OperationToken | null;
  update: (token: OperationToken, progress: OperationProgress) => void;
  requestCancellation: (token: OperationToken) => boolean;
  complete: (token: OperationToken, message: string) => boolean;
  fail: (token: OperationToken, message: string) => boolean;
  reset: () => void;
};

export function useOperationCoordinator(): OperationCoordinator {
  const [model] = useState(createOperationModel);
  const state = useSyncExternalStore(model.subscribe, model.getSnapshot, model.getSnapshot);

  return useMemo(() => {
    const isBusy = state.status === "running" || state.status === "cancelling";
    return {
      state,
      isBusy,
      isRunning: (kind, task) =>
        isBusy && state.kind === kind && (task === undefined || state.task === task),
      getActiveToken: model.getActiveToken,
      begin: model.begin,
      update: model.update,
      requestCancellation: model.requestCancellation,
      complete: model.complete,
      fail: model.fail,
      reset: model.reset,
    };
  }, [model, state]);
}
