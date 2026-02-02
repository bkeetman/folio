import { Loader2 } from "lucide-react";
import type { OperationProgress, ScanProgress, SyncProgress } from "../types/library";

export type ProgressBarVariant = "accent" | "purple" | "blue" | "green";

type ProgressBarProps = {
  /** Progress data from useBackgroundOperation */
  progress: OperationProgress | null;
  /** Label to show (e.g., "Enriching", "Applying changes") */
  label: string;
  /** Visual variant */
  variant?: ProgressBarVariant;
  /** Whether to show the progress bar (typically: isRunning && progress) */
  show: boolean;
  className?: string;
};

const variantStyles: Record<ProgressBarVariant, { border: string; bg: string; bar: string; spinner: string }> = {
  accent: {
    border: "border-[rgba(208,138,70,0.4)]",
    bg: "bg-[rgba(208,138,70,0.08)]",
    bar: "bg-[var(--app-accent)]",
    spinner: "text-[var(--app-accent)]",
  },
  purple: {
    border: "border-[rgba(147,112,219,0.4)]",
    bg: "bg-[rgba(147,112,219,0.08)]",
    bar: "bg-purple-500",
    spinner: "text-purple-600",
  },
  blue: {
    border: "border-[rgba(59,130,246,0.4)]",
    bg: "bg-[rgba(59,130,246,0.08)]",
    bar: "bg-blue-500",
    spinner: "text-blue-600",
  },
  green: {
    border: "border-[rgba(34,197,94,0.4)]",
    bg: "bg-[rgba(34,197,94,0.08)]",
    bar: "bg-green-500",
    spinner: "text-green-600",
  },
};

const trackStyles: Record<ProgressBarVariant, string> = {
  accent: "bg-[rgba(208,138,70,0.2)]",
  purple: "bg-purple-100",
  blue: "bg-blue-100",
  green: "bg-green-100",
};

/**
 * Reusable progress bar component for background operations.
 * Shows a spinner, progress text, and animated progress bar.
 */
export function ProgressBar({ progress, label, variant = "accent", show, className }: ProgressBarProps) {
  if (!show || !progress) return null;

  const styles = variantStyles[variant];
  const percentage = progress.total > 0 ? (progress.current / progress.total) * 100 : 0;

  return (
    <div className={`rounded-lg border ${styles.border} ${styles.bg} px-3 py-2 ${className || ""}`}>
      <div className="flex items-center gap-2">
        <Loader2 size={14} className={`animate-spin ${styles.spinner}`} />
        <span className="text-xs text-[var(--app-ink)]">
          {label} {progress.current} of {progress.total}...
        </span>
        {progress.message && (
          <span className="text-xs text-[var(--app-ink-muted)] truncate max-w-[300px]">
            {progress.message}
          </span>
        )}
      </div>
      <div className={`mt-1.5 h-1.5 rounded-full ${trackStyles[variant]} overflow-hidden`}>
        <div
          className={`h-full ${styles.bar} transition-all duration-300`}
          style={{ width: `${percentage}%` }}
        />
      </div>
    </div>
  );
}

type ItemSpinnerProps = {
  /** Whether this item is currently being processed */
  isProcessing: boolean;
  /** Size of the spinner */
  size?: number;
  /** Visual variant */
  variant?: ProgressBarVariant;
};

/**
 * Small spinner to show on individual items being processed.
 */
export function ItemSpinner({ isProcessing, size = 14, variant = "purple" }: ItemSpinnerProps) {
  if (!isProcessing) return null;

  const styles = variantStyles[variant];

  return <Loader2 size={size} className={`animate-spin ${styles.spinner}`} />;
}

type ProcessingOverlayProps = {
  /** Whether to show the overlay */
  isProcessing: boolean;
  /** Size of the spinner */
  size?: number;
  /** Visual variant */
  variant?: ProgressBarVariant;
};

/**
 * Semi-transparent overlay with centered spinner for cards/items being processed.
 */
export function ProcessingOverlay({ isProcessing, size = 24, variant = "purple" }: ProcessingOverlayProps) {
  if (!isProcessing) return null;

  const styles = variantStyles[variant];

  return (
    <div className="absolute inset-0 flex items-center justify-center bg-white/70">
      <Loader2 size={size} className={`animate-spin ${styles.spinner}`} />
    </div>
  );
}

type ScanProgressBarProps = {
  /** Whether scanning is in progress */
  scanning: boolean;
  /** Scan progress data (null when preparing) */
  progress: ScanProgress | null;
  /** Optional ETA label (e.g., "2m 30s") */
  etaLabel?: string | null;
  /** Visual variant */
  variant?: ProgressBarVariant;
};

/**
 * Specialized progress bar for scan operations.
 * Supports a "preparing" indeterminate state and ETA display.
 */
export function ScanProgressBar({ scanning, progress, etaLabel, variant = "accent" }: ScanProgressBarProps) {
  if (!scanning) return null;

  const styles = variantStyles[variant];

  // Preparing state - no progress yet
  if (!progress) {
    return (
      <div className={`rounded-lg border ${styles.border} ${styles.bg} px-3 py-2`}>
        <div className="flex items-center gap-2">
          <Loader2 size={14} className={`animate-spin ${styles.spinner}`} />
          <span className="text-xs text-[var(--app-ink)]">Preparing scan...</span>
        </div>
        <div className={`mt-1.5 h-1.5 rounded-full ${trackStyles[variant]} overflow-hidden`}>
          <div className={`h-full w-1/3 animate-pulse ${styles.bar}`} />
        </div>
        <div className="mt-1 text-[10px] text-[var(--app-ink-muted)]">Collecting files...</div>
      </div>
    );
  }

  // Active scanning state
  const percentage = progress.total > 0
    ? Math.min(100, Math.round((progress.processed / progress.total) * 100))
    : 6;

  return (
    <div className={`rounded-lg border ${styles.border} ${styles.bg} px-3 py-2`}>
      <div className="flex items-center gap-2">
        <Loader2 size={14} className={`animate-spin ${styles.spinner}`} />
        <span className="text-xs text-[var(--app-ink)]">
          Scanning {progress.processed} of {progress.total || "?"}...
        </span>
        {etaLabel && (
          <span className="text-xs text-[var(--app-ink-muted)]">
            ETA {etaLabel}
          </span>
        )}
      </div>
      <div className={`mt-1.5 h-1.5 rounded-full ${trackStyles[variant]} overflow-hidden`}>
        <div
          className={`h-full ${styles.bar} transition-all duration-300`}
          style={{ width: `${percentage}%` }}
        />
      </div>
      {progress.current && (
        <div className="mt-1 truncate text-[10px] text-[var(--app-ink-muted)]">
          {progress.current}
        </div>
      )}
    </div>
  );
}

type SyncProgressBarProps = {
  /** Whether syncing is in progress */
  syncing: boolean;
  /** Sync progress data */
  progress: SyncProgress | null;
  /** Visual variant */
  variant?: ProgressBarVariant;
};

/**
 * Specialized progress bar for eReader sync operations.
 * Shows action type (add/remove/import) and current file.
 */
export function SyncProgressBar({ syncing, progress, variant = "accent" }: SyncProgressBarProps) {
  if (!syncing || !progress) return null;

  const styles = variantStyles[variant];
  const percentage = progress.total > 0
    ? Math.round((progress.processed / progress.total) * 100)
    : 0;

  const actionLabel = progress.action === "add"
    ? "Adding"
    : progress.action === "remove"
      ? "Removing"
      : "Importing";

  return (
    <div className={`rounded-lg border ${styles.border} ${styles.bg} px-3 py-2`}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Loader2 size={14} className={`animate-spin ${styles.spinner}`} />
          <span className="text-xs font-medium text-[var(--app-ink)]">
            {actionLabel}
          </span>
        </div>
        <span className="text-xs text-[var(--app-ink-muted)]">
          {progress.processed} / {progress.total}
        </span>
      </div>
      <div className={`mt-1.5 h-1.5 rounded-full ${trackStyles[variant]} overflow-hidden`}>
        <div
          className={`h-full ${styles.bar} transition-all duration-300`}
          style={{ width: `${percentage}%` }}
        />
      </div>
      {progress.current && (
        <div className="mt-1 truncate text-[10px] text-[var(--app-ink-muted)]">
          {progress.current}
        </div>
      )}
    </div>
  );
}
