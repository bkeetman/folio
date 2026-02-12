import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useCallback, type Dispatch, type SetStateAction } from "react";
import type {
  ImportRequest,
  OperationProgress,
  OperationStats,
  ScanProgress,
  View,
} from "../types/library";

type UseLibraryOperationsArgs = {
  scanning: boolean;
  setScanning: Dispatch<SetStateAction<boolean>>;
  setScanStartedAt: Dispatch<SetStateAction<number | null>>;
  setScanProgress: Dispatch<SetStateAction<ScanProgress | null>>;
  setScanStatus: Dispatch<SetStateAction<string | null>>;
  refreshLibrary: () => Promise<void>;
  enriching: boolean;
  setEnriching: Dispatch<SetStateAction<boolean>>;
  setEnrichProgress: Dispatch<SetStateAction<OperationProgress | null>>;
  setEnrichingItems: Dispatch<SetStateAction<Set<string>>>;
  importingBooks: boolean;
  setImportingBooks: Dispatch<SetStateAction<boolean>>;
  setImportProgress: Dispatch<SetStateAction<OperationProgress | null>>;
  setViewWithTransition: Dispatch<SetStateAction<View>>;
};

export function useLibraryOperations({
  scanning,
  setScanning,
  setScanStartedAt,
  setScanProgress,
  setScanStatus,
  refreshLibrary,
  enriching,
  setEnriching,
  setEnrichProgress,
  setEnrichingItems,
  importingBooks,
  setImportingBooks,
  setImportProgress,
  setViewWithTransition,
}: UseLibraryOperationsArgs) {
  const handleScan = useCallback(async () => {
    try {
      if (!isTauri()) {
        setScanStatus("Scan requires the Tauri desktop runtime.");
        return;
      }
      if (scanning) return;
      setScanning(true);
      setScanStartedAt(Date.now());
      setScanProgress(null);
      const { open } = await import("@tauri-apps/plugin-dialog");
      const selection: string | string[] | null = await open({
        directory: true,
        multiple: false,
      });
      if (typeof selection === "string") {
        setScanStatus("Scanning...");
        await invoke("scan_folder", {
          root: selection,
        });
        await refreshLibrary();
      } else {
        setScanStatus("Scan cancelled.");
        setScanProgress(null);
      }
    } catch (error) {
      const message =
        error instanceof Error ? error.message : String(error ?? "Scan failed.");
      setScanStatus(`Scan failed: ${message}`);
      setScanProgress(null);
    } finally {
      setScanning(false);
    }
  }, [
    refreshLibrary,
    scanning,
    setScanProgress,
    setScanStartedAt,
    setScanStatus,
    setScanning,
  ]);

  const handleEnrichAll = useCallback(
    async (itemIds?: string[]) => {
      if (!isTauri()) {
        setScanStatus("Enrich requires the Tauri desktop runtime.");
        return;
      }
      if (enriching) return;
      const targetItemIds = itemIds ?? [];
      if (targetItemIds.length === 0) {
        setScanStatus("No items in Needs Fixing to enrich.");
        return;
      }
      setEnriching(true);
      setEnrichProgress(null);
      setEnrichingItems(new Set());
      setScanStatus(`Enriching ${targetItemIds.length} items from Needs Fixing...`);
      try {
        // This returns immediately, progress comes via events
        await invoke("enrich_all", { itemIds: targetItemIds });
      } catch (error) {
        const message =
          error instanceof Error ? error.message : String(error ?? "Enrich failed.");
        setScanStatus(`Enrich failed: ${message}`);
        setEnriching(false);
        setEnrichingItems(new Set());
      }
    },
    [enriching, setEnrichProgress, setEnriching, setEnrichingItems, setScanStatus]
  );

  const handleCancelEnrich = useCallback(async () => {
    if (!isTauri()) return;
    try {
      await invoke("cancel_enrich");
      setScanStatus("Cancelling enrichment...");
    } catch (error) {
      console.error("Failed to cancel enrich:", error);
    }
  }, [setScanStatus]);

  const handleImportCancel = useCallback(() => {
    setViewWithTransition("library-books");
  }, [setViewWithTransition]);

  const handleImportStart = useCallback(
    async (request: ImportRequest) => {
      if (!isTauri() || importingBooks) return;
      setImportingBooks(true);
      setImportProgress({
        itemId: "import",
        status: "processing",
        message: "Starting import...",
        current: 0,
        total: request.newBookIds.length + Object.keys(request.duplicateActions).length,
      });
      setScanStatus("Importing books...");

      const unlisten = await listen<OperationProgress>("import-progress", (event) => {
        setImportProgress(event.payload);
      });

      try {
        const result = await invoke<OperationStats>("import_books", { request });
        await refreshLibrary();
        setViewWithTransition("library-books");
        setScanStatus(
          `Import complete: ${result.processed} imported, ${result.skipped} skipped, ${result.errors} errors.`
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error ?? "Import failed.");
        setScanStatus(`Import failed: ${message}`);
      } finally {
        unlisten();
        setImportingBooks(false);
        setTimeout(() => {
          setImportProgress(null);
        }, 1200);
      }
    },
    [
      importingBooks,
      refreshLibrary,
      setImportProgress,
      setImportingBooks,
      setScanStatus,
      setViewWithTransition,
    ]
  );

  return {
    handleScan,
    handleEnrichAll,
    handleCancelEnrich,
    handleImportCancel,
    handleImportStart,
  };
}
