import { isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useEffect, type Dispatch, type MutableRefObject, type SetStateAction } from "react";
import type {
  ActivityLogItem,
  ApplyMetadataProgress,
  OperationProgress,
  OperationStats,
  PendingChange,
  ScanProgress,
  ScanStats,
} from "../types/library";

type PendingChangeStatus = "pending" | "applied" | "error";

type UseOperationEventListenersArgs = {
  isDesktop: boolean;
  scanning: boolean;
  scanStartedAt: number | null;
  setCurrentTimeMs: Dispatch<SetStateAction<number>>;
  setScanStatus: Dispatch<SetStateAction<string | null>>;
  handleScan: () => void | Promise<void>;
  setScanProgress: Dispatch<SetStateAction<ScanProgress | null>>;
  setScanning: Dispatch<SetStateAction<boolean>>;
  setScanStartedAt: Dispatch<SetStateAction<number | null>>;
  setActivityLog: Dispatch<SetStateAction<ActivityLogItem[]>>;
  setEnrichProgress: Dispatch<SetStateAction<OperationProgress | null>>;
  setEnrichingItems: Dispatch<SetStateAction<Set<string>>>;
  setEnriching: Dispatch<SetStateAction<boolean>>;
  refreshLibrary: () => Promise<void>;
  setChangeProgress: Dispatch<SetStateAction<OperationProgress | null>>;
  setApplyingChangeIds: Dispatch<SetStateAction<Set<string>>>;
  setPendingChangesApplying: Dispatch<SetStateAction<boolean>>;
  loadChangesByStatus: (status: PendingChangeStatus) => Promise<PendingChange[]>;
  pendingChangesStatusRef: MutableRefObject<PendingChangeStatus>;
  setPendingChanges: Dispatch<SetStateAction<PendingChange[]>>;
  setPendingChangesCount: Dispatch<SetStateAction<number>>;
  refreshPendingChanges: () => Promise<number>;
};

export function useOperationEventListeners({
  isDesktop,
  scanning,
  scanStartedAt,
  setCurrentTimeMs,
  setScanStatus,
  handleScan,
  setScanProgress,
  setScanning,
  setScanStartedAt,
  setActivityLog,
  setEnrichProgress,
  setEnrichingItems,
  setEnriching,
  refreshLibrary,
  setChangeProgress,
  setApplyingChangeIds,
  setPendingChangesApplying,
  loadChangesByStatus,
  pendingChangesStatusRef,
  setPendingChanges,
  setPendingChangesCount,
  refreshPendingChanges,
}: UseOperationEventListenersArgs) {
  useEffect(() => {
    if (!scanning) return;
    const interval = setInterval(() => {
      setCurrentTimeMs(Date.now());
      setScanStatus((prev) => prev ?? "Scanning...");
    }, 1000);
    return () => clearInterval(interval);
  }, [scanning, setCurrentTimeMs, setScanStatus]);

  useEffect(() => {
    if (!isTauri()) return;
    let unlisten: (() => void) | undefined;
    listen("menu-scan-folder", () => {
      void handleScan();
    }).then((stop) => {
      unlisten = stop;
    });
    return () => {
      if (unlisten) unlisten();
    };
  }, [handleScan]);

  useEffect(() => {
    if (!isDesktop) return;
    let unlistenProgress: (() => void) | undefined;
    let unlistenComplete: (() => void) | undefined;
    let unlistenImportScan: (() => void) | undefined;
    let unlistenError: (() => void) | undefined;

    listen<ScanProgress>("scan-progress", (event) => {
      setScanProgress(event.payload);
      if (!scanning) setScanning(true);
      if (!scanStartedAt) setScanStartedAt(Date.now());
    }).then((stop) => {
      unlistenProgress = stop;
    });

    listen<ScanStats>("scan-complete", (event) => {
      setScanProgress(null);
      setScanning(false);
      setScanStatus(
        `Scan complete: ${event.payload.added} added, ${event.payload.updated} updated, ${event.payload.moved} moved.`
      );
      setActivityLog((prev) => [
        {
          id: `scan-${Date.now()}`,
          type: "scan",
          message: `Scanned: ${event.payload.added} new, ${event.payload.updated} updated`,
          timestamp: Date.now(),
        },
        ...prev,
      ]);
    }).then((stop) => {
      unlistenComplete = stop;
    });

    listen<OperationProgress>("import-scan-progress", (event) => {
      const { status, current, total, message } = event.payload;
      if (status === "done") {
        setScanStatus(message ?? `Import scan complete (${total} files).`);
        setActivityLog((prev) => [
          {
            id: `import-scan-${Date.now()}`,
            type: "scan",
            message: message ?? `Import scan complete (${total} files).`,
            timestamp: Date.now(),
          },
          ...prev,
        ]);
        return;
      }

      const progressLabel = total > 0 ? `Import scan ${current}/${total}` : "Import scan";
      setScanStatus(message ? `${progressLabel}: ${message}` : progressLabel);
    }).then((stop) => {
      unlistenImportScan = stop;
    });

    listen<string>("scan-error", (event) => {
      setScanProgress(null);
      setScanning(false);
      setScanStatus(`Scan failed: ${event.payload}`);
      setActivityLog((prev) => [
        {
          id: `scan-err-${Date.now()}`,
          type: "error",
          message: `Scan failed: ${event.payload}`,
          timestamp: Date.now(),
        },
        ...prev,
      ]);
    }).then((stop) => {
      unlistenError = stop;
    });

    return () => {
      if (unlistenProgress) unlistenProgress();
      if (unlistenComplete) unlistenComplete();
      if (unlistenImportScan) unlistenImportScan();
      if (unlistenError) unlistenError();
    };
  }, [
    isDesktop,
    scanStartedAt,
    scanning,
    setActivityLog,
    setScanProgress,
    setScanStartedAt,
    setScanStatus,
    setScanning,
  ]);

  useEffect(() => {
    if (!isDesktop) return;
    let unlistenProgress: (() => void) | undefined;
    let unlistenComplete: (() => void) | undefined;
    let unlistenCancelled: (() => void) | undefined;

    listen<OperationProgress>("enrich-progress", (event) => {
      console.log("enrich-progress event:", event.payload);
      setEnrichProgress(event.payload);
      setEnrichingItems((prev) => {
        const next = new Set(prev);
        if (event.payload.status === "processing" || event.payload.status === "pending") {
          next.add(event.payload.itemId);
        } else {
          next.delete(event.payload.itemId);
        }
        return next;
      });
      setEnriching(true);
    }).then((stop) => {
      unlistenProgress = stop;
    });

    listen<OperationStats>("enrich-complete", (event) => {
      console.log("enrich-complete event:", event.payload);
      setEnrichProgress(null);
      setEnriching(false);
      setEnrichingItems(new Set());
      setScanStatus(
        `Enrichment complete: ${event.payload.processed} enriched, ${event.payload.skipped} skipped, ${event.payload.errors} errors.`
      );
      setActivityLog((prev) => [
        {
          id: `enrich-${Date.now()}`,
          type: "enrich",
          message: `Enriched ${event.payload.processed} items`,
          timestamp: Date.now(),
        },
        ...prev,
      ]);
      void refreshLibrary();
    }).then((stop) => {
      unlistenComplete = stop;
    });

    listen<OperationStats>("enrich-cancelled", (event) => {
      console.log("enrich-cancelled event:", event.payload);
      setEnrichProgress(null);
      setEnriching(false);
      setEnrichingItems(new Set());
      setScanStatus(
        `Enrichment cancelled: ${event.payload.processed} enriched before cancellation.`
      );
      void refreshLibrary();
    }).then((stop) => {
      unlistenCancelled = stop;
    });

    return () => {
      if (unlistenProgress) unlistenProgress();
      if (unlistenComplete) unlistenComplete();
      if (unlistenCancelled) unlistenCancelled();
    };
  }, [
    isDesktop,
    refreshLibrary,
    setActivityLog,
    setEnrichProgress,
    setEnriching,
    setEnrichingItems,
    setScanStatus,
  ]);

  useEffect(() => {
    if (!isDesktop) return;
    let unlistenProgress: (() => void) | undefined;
    let unlistenComplete: (() => void) | undefined;

    listen<OperationProgress>("change-progress", (event) => {
      console.log("change-progress event:", event.payload);
      setChangeProgress(event.payload);
      setApplyingChangeIds((prev) => {
        const next = new Set(prev);
        if (event.payload.status === "processing") {
          next.add(event.payload.itemId);
        } else {
          next.delete(event.payload.itemId);
        }
        return next;
      });
      setPendingChangesApplying(true);
    }).then((stop) => {
      unlistenProgress = stop;
    });

    listen<OperationStats>("change-complete", async (event) => {
      console.log("change-complete event:", event.payload);
      setChangeProgress(null);
      setApplyingChangeIds(new Set());
      setPendingChangesApplying(false);
      setScanStatus(
        `Changes complete: ${event.payload.processed} applied, ${event.payload.errors} errors.`
      );
      try {
        const result = await loadChangesByStatus(pendingChangesStatusRef.current);
        setPendingChanges(result);
        if (pendingChangesStatusRef.current === "pending") {
          setPendingChangesCount(result.length);
        } else {
          await refreshPendingChanges();
        }
        await refreshLibrary();
      } catch {
        // ignore
      }
    }).then((stop) => {
      unlistenComplete = stop;
    });

    return () => {
      if (unlistenProgress) unlistenProgress();
      if (unlistenComplete) unlistenComplete();
    };
  }, [
    isDesktop,
    loadChangesByStatus,
    pendingChangesStatusRef,
    refreshLibrary,
    refreshPendingChanges,
    setApplyingChangeIds,
    setChangeProgress,
    setPendingChanges,
    setPendingChangesApplying,
    setPendingChangesCount,
    setScanStatus,
  ]);

  useEffect(() => {
    if (!isDesktop) return;
    let unlisten: (() => void) | undefined;
    listen<ApplyMetadataProgress>("apply-metadata-progress", (event) => {
      const { message, current, total, step } = event.payload;
      const progressMessage =
        step === "done" ? "Metadata apply complete." : `${message} (${current}/${total})`;
      setScanStatus(progressMessage);
    }).then((stop) => {
      unlisten = stop;
    });
    return () => {
      if (unlisten) unlisten();
    };
  }, [isDesktop, setScanStatus]);
}
