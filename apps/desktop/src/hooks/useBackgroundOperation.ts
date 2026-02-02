import { listen } from "@tauri-apps/api/event";
import { useCallback, useEffect, useRef, useState } from "react";
import type { OperationProgress, OperationStats } from "../types/library";

type UseBackgroundOperationOptions = {
  /** Event name prefix (e.g., "enrich" for "enrich-progress" and "enrich-complete") */
  operationName: string;
  /** Callback when operation completes successfully */
  onComplete?: (stats: OperationStats) => void;
  /** Callback when operation errors */
  onError?: (error: string) => void;
  /** Whether to listen for events (usually tied to isDesktop) */
  enabled?: boolean;
};

type UseBackgroundOperationResult = {
  /** Whether the operation is currently running */
  isRunning: boolean;
  /** Current progress (null when not running) */
  progress: OperationProgress | null;
  /** Set of item IDs currently being processed */
  processingIds: Set<string>;
  /** Manually set running state (for initiating operations) */
  setIsRunning: (running: boolean) => void;
  /** Reset all state */
  reset: () => void;
};

/**
 * Hook to manage background operation state and listen to progress events.
 * Provides unified handling for scan, enrich, sync, and apply-changes operations.
 */
export function useBackgroundOperation({
  operationName,
  onComplete,
  onError,
  enabled = true,
}: UseBackgroundOperationOptions): UseBackgroundOperationResult {
  const [isRunning, setIsRunning] = useState(false);
  const [progress, setProgress] = useState<OperationProgress | null>(null);
  const [processingIds, setProcessingIds] = useState<Set<string>>(new Set());

  // Use refs to avoid stale closures in callbacks
  const onCompleteRef = useRef(onComplete);
  const onErrorRef = useRef(onError);

  useEffect(() => {
    onCompleteRef.current = onComplete;
    onErrorRef.current = onError;
  }, [onComplete, onError]);

  const reset = useCallback(() => {
    setIsRunning(false);
    setProgress(null);
    setProcessingIds(new Set());
  }, []);

  useEffect(() => {
    if (!enabled) return;

    let unlistenProgress: (() => void) | undefined;
    let unlistenComplete: (() => void) | undefined;
    let unlistenError: (() => void) | undefined;

    // Listen for progress updates
    listen<OperationProgress>(`${operationName}-progress`, (event) => {
      setProgress(event.payload);
      setProcessingIds((prev) => {
        const next = new Set(prev);
        if (event.payload.status === "processing" || event.payload.status === "pending") {
          next.add(event.payload.itemId);
        } else {
          next.delete(event.payload.itemId);
        }
        return next;
      });
      setIsRunning(true);
    }).then((stop) => {
      unlistenProgress = stop;
    });

    // Listen for completion
    listen<OperationStats>(`${operationName}-complete`, (event) => {
      setProgress(null);
      setProcessingIds(new Set());
      setIsRunning(false);
      onCompleteRef.current?.(event.payload);
    }).then((stop) => {
      unlistenComplete = stop;
    });

    // Listen for errors (optional event)
    listen<string>(`${operationName}-error`, (event) => {
      setProgress(null);
      setProcessingIds(new Set());
      setIsRunning(false);
      onErrorRef.current?.(event.payload);
    }).then((stop) => {
      unlistenError = stop;
    });

    return () => {
      unlistenProgress?.();
      unlistenComplete?.();
      unlistenError?.();
    };
  }, [enabled, operationName]);

  return {
    isRunning,
    progress,
    processingIds,
    setIsRunning,
    reset,
  };
}
