import { AlertCircle, CheckCircle2, Loader2, X } from "lucide-react";

import type { OperationSnapshot } from "../operations/operation-model";
import { Button } from "./ui";

type OperationStatusPanelProps = {
  state: OperationSnapshot;
  etaLabel?: string | null;
  onCancel?: () => void;
  onDismiss: () => void;
};

export function OperationStatusPanel({
  state,
  etaLabel,
  onCancel,
  onDismiss,
}: OperationStatusPanelProps) {
  if (state.status === "idle") return null;

  if (state.status === "success" || state.status === "error") {
    const failed = state.status === "error";
    return (
      <div
        role={failed ? "alert" : "status"}
        className={`flex items-center gap-2 rounded-md border px-3 py-2 text-xs ${
          failed
            ? "border-red-300/70 bg-red-50/80 text-red-800"
            : "border-emerald-300/70 bg-emerald-50/80 text-emerald-800"
        }`}
      >
        {failed ? <AlertCircle size={15} /> : <CheckCircle2 size={15} />}
        <span className="min-w-0 flex-1 truncate">{state.message}</span>
        <Button variant="ghost" size="icon" onClick={onDismiss} aria-label="Dismiss operation status">
          <X size={14} />
        </Button>
      </div>
    );
  }

  if (state.status !== "running" && state.status !== "cancelling") return null;

  const progress = state.progress;
  const percentage = progress && progress.total > 0
    ? Math.min(100, Math.round((progress.current / progress.total) * 100))
    : null;

  return (
    <div role="status" className="rounded-md border border-app-accent/30 bg-app-accent/5 px-3 py-2">
      <div className="flex items-center gap-2">
        <Loader2 size={15} className="animate-spin text-app-accent" />
        <span className="text-xs font-medium text-app-ink">
          {state.status === "cancelling" ? `Cancelling ${state.label.toLowerCase()}…` : state.label}
        </span>
        {progress && (
          <span className="min-w-0 flex-1 truncate text-xs text-app-ink-muted">
            {progress.current}/{progress.total || "?"}
            {progress.message ? ` · ${progress.message}` : ""}
          </span>
        )}
        {etaLabel ? <span className="text-xs text-app-ink-muted">ETA {etaLabel}</span> : null}
        {state.canCancel && onCancel && state.status === "running" ? (
          <Button variant="outline" size="sm" onClick={onCancel}>Cancel</Button>
        ) : null}
      </div>
      <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-app-accent/15">
        <div
          className={`h-full bg-app-accent ${percentage === null ? "w-1/3 animate-pulse" : "transition-[width] duration-300"}`}
          style={percentage === null ? undefined : { width: `${percentage}%` }}
        />
      </div>
    </div>
  );
}
