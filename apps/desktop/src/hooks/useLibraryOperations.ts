import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";

import type { OperationCoordinator } from "../operations/useOperationCoordinator";
import { invoke, isTauri, listen, open } from "../platform/native";
import type {
  ActivityLogItem,
  ImportRequest,
  OperationProgress,
  OperationStats,
  ScanProgress,
  ScanStats,
  View,
} from "../types/library";

type UseLibraryOperationsArgs = {
  operations: OperationCoordinator;
  setScanStatus: Dispatch<SetStateAction<string | null>>;
  setActivityLog: Dispatch<SetStateAction<ActivityLogItem[]>>;
  refreshLibrary: () => Promise<void>;
  setViewWithTransition: Dispatch<SetStateAction<View>>;
};

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : String(error ?? fallback);
}

export function useLibraryOperations({
  operations,
  setScanStatus,
  setActivityLog,
  refreshLibrary,
  setViewWithTransition,
}: UseLibraryOperationsArgs) {
  const [currentTimeMs, setCurrentTimeMs] = useState(() => Date.now());
  const [listenersReady, setListenersReady] = useState(false);
  const [listenerSetupAttempt, setListenerSetupAttempt] = useState(0);
  const scanTokenRef = useRef<number | null>(null);
  const enrichTokenRef = useRef<number | null>(null);
  const { begin, complete, fail, requestCancellation, reset, update } = operations;
  const scanning = operations.isRunning("scan");
  const enriching = operations.isRunning("enrich");
  const importingBooks = operations.isRunning("import");
  const activeProgress =
    operations.state.status === "running" || operations.state.status === "cancelling"
      ? operations.state.progress
      : null;
  const scanStartedAt = scanning && "startedAt" in operations.state
    ? operations.state.startedAt
    : null;
  const scanProgress: ScanProgress | null = scanning && activeProgress
    ? {
        processed: activeProgress.current,
        total: activeProgress.total,
        current: activeProgress.message ?? activeProgress.itemId,
      }
    : null;
  const enrichProgress = enriching ? activeProgress : null;
  const enrichingItems = enriching && "processingIds" in operations.state
    ? new Set(operations.state.processingIds)
    : new Set<string>();
  const importProgress = importingBooks ? activeProgress : null;

  useEffect(() => {
    if (!scanning) return;
    const interval = window.setInterval(() => {
      setCurrentTimeMs(Date.now());
      setScanStatus((previous) => previous ?? "Scanning...");
    }, 1000);
    return () => window.clearInterval(interval);
  }, [scanning, setScanStatus]);

  useEffect(() => {
    let cancelled = false;
    let registered = 0;
    const registrationTarget = 7;
    const stops: Array<() => void> = [];
    const register = async <T,>(eventName: string, handler: (payload: T) => void) => {
      try {
        const stop = await listen<T>(eventName, (event) => handler(event.payload));
        if (cancelled) stop();
        else {
          stops.push(stop);
          registered += 1;
          if (registered === registrationTarget) setListenersReady(true);
        }
      } catch (error) {
        if (!cancelled) {
          setScanStatus(`Could not monitor background operations: ${errorMessage(error, "Unknown error")}`);
        }
      }
    };

    void register<ScanProgress>("scan-progress", (progress) => {
      const token = scanTokenRef.current;
      if (token === null) return;
      update(token, {
        itemId: progress.current,
        status: "processing",
        message: progress.current,
        current: progress.processed,
        total: progress.total,
      });
    });
    void register<ScanStats>("scan-complete", (stats) => {
      const message = `Scan complete: ${stats.added} added, ${stats.updated} updated, ${stats.moved} moved.`;
      const token = scanTokenRef.current;
      if (token === null || !complete(token, message)) return;
      scanTokenRef.current = null;
      setScanStatus(message);
      setActivityLog((previous) => [
        {
          id: `scan-${Date.now()}`,
          type: "scan",
          message: `Scanned: ${stats.added} new, ${stats.updated} updated`,
          timestamp: Date.now(),
        },
        ...previous,
      ]);
    });
    void register<string>("scan-error", (error) => {
      const message = `Scan failed: ${error}`;
      const token = scanTokenRef.current;
      if (token === null || !fail(token, message)) return;
      scanTokenRef.current = null;
      setScanStatus(message);
      setActivityLog((previous) => [
        {
          id: `scan-err-${Date.now()}`,
          type: "error",
          message,
          timestamp: Date.now(),
        },
        ...previous,
      ]);
    });
    void register<OperationProgress>("enrich-progress", (progress) => {
      const token = enrichTokenRef.current;
      if (token !== null) update(token, progress);
    });
    void register<OperationStats>("enrich-complete", (stats) => {
      const message = `Enrichment complete: ${stats.processed} enriched, ${stats.skipped} skipped, ${stats.errors} errors.`;
      const token = enrichTokenRef.current;
      if (token === null || !complete(token, message)) return;
      enrichTokenRef.current = null;
      setScanStatus(message);
      setActivityLog((previous) => [
        {
          id: `enrich-${Date.now()}`,
          type: "enrich",
          message: `Enriched ${stats.processed} items`,
          timestamp: Date.now(),
        },
        ...previous,
      ]);
      void refreshLibrary();
    });
    void register<OperationStats>("enrich-cancelled", (stats) => {
      const message = `Enrichment cancelled: ${stats.processed} enriched before cancellation.`;
      const token = enrichTokenRef.current;
      if (token === null || !complete(token, message)) return;
      enrichTokenRef.current = null;
      setScanStatus(message);
      void refreshLibrary();
    });
    void register<string>("enrich-error", (error) => {
      const message = `Enrich failed: ${error}`;
      const token = enrichTokenRef.current;
      if (token === null || !fail(token, message)) return;
      enrichTokenRef.current = null;
      setScanStatus(message);
      setActivityLog((previous) => [
        {
          id: `enrich-err-${Date.now()}`,
          type: "error",
          message,
          timestamp: Date.now(),
        },
        ...previous,
      ]);
    });

    return () => {
      cancelled = true;
      stops.forEach((stop) => stop());
    };
  }, [complete, fail, listenerSetupAttempt, refreshLibrary, setActivityLog, setScanStatus, update]);

  const handleScan = useCallback(async () => {
    if (!isTauri()) {
      setScanStatus("Scan requires the Tauri desktop runtime.");
      return;
    }
    if (!listenersReady) {
      setListenerSetupAttempt((attempt) => attempt + 1);
      setScanStatus("Background operations are not ready yet. Please try again in a moment.");
      return;
    }
    const token = begin("scan", { label: "Scanning library", canCancel: false });
    if (token === null) return;
    scanTokenRef.current = token;
    setCurrentTimeMs(Date.now());
    try {
      const selection: string | string[] | null = await open({
        directory: true,
        multiple: false,
      });
      if (typeof selection !== "string") {
        scanTokenRef.current = null;
        reset();
        setScanStatus("Scan cancelled.");
        return;
      }

      setScanStatus("Scanning...");
      await invoke("scan_folder", { root: selection });
      await refreshLibrary();
    } catch (error) {
      const message = `Scan failed: ${errorMessage(error, "Scan failed.")}`;
      fail(token, message);
      scanTokenRef.current = null;
      setScanStatus(message);
    }
  }, [begin, fail, listenersReady, refreshLibrary, reset, setScanStatus]);

  const handleEnrichAll = useCallback(
    async (itemIds?: string[]) => {
      if (!isTauri()) {
        setScanStatus("Enrich requires the Tauri desktop runtime.");
        return;
      }
      const targetItemIds = itemIds ?? [];
      if (targetItemIds.length === 0) {
        setScanStatus("No items in Needs Fixing to enrich.");
        return;
      }
      if (!listenersReady) {
        setListenerSetupAttempt((attempt) => attempt + 1);
        setScanStatus("Background operations are not ready yet. Please try again in a moment.");
        return;
      }
      const token = begin("enrich", { label: "Enriching metadata", canCancel: true });
      if (token === null) return;
      enrichTokenRef.current = token;
      setScanStatus(`Enriching ${targetItemIds.length} items from Needs Fixing...`);
      try {
        await invoke("enrich_all", { itemIds: targetItemIds });
      } catch (error) {
        const message = `Enrich failed: ${errorMessage(error, "Enrich failed.")}`;
        fail(token, message);
        enrichTokenRef.current = null;
        setScanStatus(message);
      }
    },
    [begin, fail, listenersReady, setScanStatus],
  );

  const handleCancelEnrich = useCallback(async () => {
    const token = enrichTokenRef.current;
    if (!isTauri() || token === null || !requestCancellation(token)) return;
    setScanStatus("Cancelling enrichment...");
    try {
      await invoke("cancel_enrich");
    } catch (error) {
      const message = `Could not cancel enrichment: ${errorMessage(error, "Unknown error")}`;
      fail(token, message);
      enrichTokenRef.current = null;
      setScanStatus(message);
    }
  }, [fail, requestCancellation, setScanStatus]);

  const handleImportCancel = useCallback(() => {
    if (importingBooks) return;
    setViewWithTransition("library-books");
  }, [importingBooks, setViewWithTransition]);

  const handleImportStart = useCallback(
    async (request: ImportRequest) => {
      if (!isTauri()) return;
      const total = request.newBookIds.length + Object.keys(request.duplicateActions).length;
      const token = begin("import", {
        label: "Importing books",
        canCancel: false,
        progress: {
          itemId: "import",
          status: "processing",
          message: "Starting import...",
          current: 0,
          total,
        },
      });
      if (token === null) return;
      setScanStatus("Importing books...");
      let unlisten: (() => void) | undefined;
      try {
        unlisten = await listen<OperationProgress>("import-progress", (event) => {
          update(token, event.payload);
        });
        const result = await invoke<OperationStats>("import_books", { request });
        await refreshLibrary();
        setViewWithTransition("library-books");
        const message = `Import complete: ${result.processed} imported, ${result.skipped} skipped, ${result.errors} errors.`;
        complete(token, message);
        setScanStatus(message);
      } catch (error) {
        const message = `Import failed: ${errorMessage(error, "Import failed.")}`;
        fail(token, message);
        setScanStatus(message);
      } finally {
        unlisten?.();
      }
    },
    [begin, complete, fail, refreshLibrary, setScanStatus, setViewWithTransition, update],
  );

  return {
    scanning,
    scanStartedAt,
    scanProgress,
    currentTimeMs,
    enriching,
    enrichingItems,
    enrichProgress,
    importingBooks,
    importProgress,
    handleScan,
    handleEnrichAll,
    handleCancelEnrich,
    handleImportCancel,
    handleImportStart,
  };
}
