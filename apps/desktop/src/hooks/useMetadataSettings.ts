import { useCallback, useEffect, useState, type Dispatch, type SetStateAction } from "react";
import { invoke, isTauri } from "../platform/native";
import type { OperationCoordinator } from "../operations/useOperationCoordinator";
import type {
  MetadataLookupSettings,
  MetadataSourceSetting,
} from "../types/library";

type LibraryMutationOptions<T> = {
  refreshCoverItemId?: string | null;
  refreshLibrary?: boolean | ((result: T) => boolean);
  refreshPendingChanges?: boolean | ((result: T) => boolean);
};

type RunLibraryMutationPipeline = <T>(
  mutation: () => Promise<T>,
  options?: LibraryMutationOptions<T>
) => Promise<{ result: T; pendingChangesCount: number }>;

type UseMetadataSettingsArgs = {
  initialMetadataSources: MetadataSourceSetting[];
  operations: OperationCoordinator;
  setScanStatus: Dispatch<SetStateAction<string | null>>;
  runLibraryMutationPipeline: RunLibraryMutationPipeline;
};

export function useMetadataSettings({
  initialMetadataSources,
  operations,
  setScanStatus,
  runLibraryMutationPipeline,
}: UseMetadataSettingsArgs) {
  const [metadataSources, setMetadataSources] =
    useState<MetadataSourceSetting[]>(initialMetadataSources);
  const { begin, complete, fail } = operations;
  const normalizingDescriptions = operations.isRunning("metadata", "normalize-descriptions");
  const batchFixingTitles = operations.isRunning("metadata", "batch-fix-titles");
  const metadataSourcesSaving = operations.isRunning("metadata", "save-sources");

  const handleNormalizeDescriptions = useCallback(async () => {
    if (!isTauri() || normalizingDescriptions) return;
    const token = begin("metadata", {
      task: "normalize-descriptions",
      label: "Cleaning descriptions",
      canCancel: false,
    });
    if (token === null) return;
    try {
      const { result } = await runLibraryMutationPipeline(
        () =>
          invoke<{ itemsUpdated: number; filesQueued: number }>(
            "normalize_item_descriptions"
          ),
        {
          refreshLibrary: (cleanupResult) => cleanupResult.itemsUpdated > 0,
          refreshPendingChanges: (cleanupResult) => cleanupResult.filesQueued > 0,
        }
      );
      if (result.itemsUpdated > 0) {
        setScanStatus(
          result.filesQueued > 0
            ? `Updated descriptions for ${result.itemsUpdated} books. ${result.filesQueued} EPUB update(s) queued in Changes.`
            : `Updated descriptions for ${result.itemsUpdated} books.`
        );
      } else {
        setScanStatus("Descriptions were already clean.");
      }
      complete(token, "Description cleanup complete.");
    } catch (error) {
      const message =
        error instanceof Error ? error.message : String(error ?? "Description cleanup failed.");
      setScanStatus(`Could not clean descriptions: ${message}`);
      fail(token, message);
    }
  }, [begin, complete, fail, normalizingDescriptions, runLibraryMutationPipeline, setScanStatus]);

  const handleBatchFixTitles = useCallback(async () => {
    if (!isTauri() || batchFixingTitles) return;
    const token = begin("metadata", {
      task: "batch-fix-titles",
      label: "Fixing titles",
      canCancel: false,
    });
    if (token === null) return;
    try {
      const { result } = await runLibraryMutationPipeline(
        () =>
          invoke<{
            itemsUpdated: number;
            titlesCleaned: number;
            yearsInferred: number;
            authorsInferred: number;
            isbnsNormalized: number;
            isbnsRemoved: number;
            filesQueued: number;
          }>("batch_cleanup_titles"),
        {
          refreshLibrary: (cleanupResult) => cleanupResult.itemsUpdated > 0,
          refreshPendingChanges: (cleanupResult) => cleanupResult.filesQueued > 0,
        }
      );
      if (result.itemsUpdated > 0) {
        setScanStatus(
          result.filesQueued > 0
            ? `Updated ${result.itemsUpdated} books (${result.titlesCleaned} titles, ${result.yearsInferred} years, ${result.authorsInferred} authors, ${result.isbnsNormalized} ISBN normalized, ${result.isbnsRemoved} ISBN removed). ${result.filesQueued} EPUB update(s) queued in Changes.`
            : `Updated ${result.itemsUpdated} books (${result.titlesCleaned} titles, ${result.yearsInferred} years, ${result.authorsInferred} authors, ${result.isbnsNormalized} ISBN normalized, ${result.isbnsRemoved} ISBN removed).`
        );
      } else {
        setScanStatus("No titles needed batch cleanup.");
      }
      complete(token, "Batch title cleanup complete.");
    } catch (error) {
      const message =
        error instanceof Error ? error.message : String(error ?? "Batch title cleanup failed.");
      setScanStatus(`Could not batch-fix titles: ${message}`);
      fail(token, message);
    }
  }, [batchFixingTitles, begin, complete, fail, runLibraryMutationPipeline, setScanStatus]);

  useEffect(() => {
    if (!isTauri()) return;
    let cancelled = false;
    void invoke<MetadataLookupSettings>("get_metadata_lookup_settings")
      .then((settings) => {
        if (cancelled) return;
        if (Array.isArray(settings.sources) && settings.sources.length > 0) {
          setMetadataSources(settings.sources);
        }
      })
      .catch(() => {
        if (cancelled) return;
        setMetadataSources(initialMetadataSources);
      });
    return () => {
      cancelled = true;
    };
  }, [initialMetadataSources]);

  const persistMetadataSources = useCallback(
    async (sources: MetadataSourceSetting[], successMessage: string) => {
      if (!isTauri()) return;
      const token = begin("metadata", {
        task: "save-sources",
        label: "Saving metadata sources",
        canCancel: false,
      });
      if (token === null) return;
      try {
        await invoke("set_metadata_lookup_settings", {
          settings: { sources },
        });
        setScanStatus(successMessage);
        complete(token, successMessage);
      } catch {
        const message = "Could not save metadata source settings.";
        fail(token, message);
        setScanStatus(message);
      }
    },
    [begin, complete, fail, setScanStatus]
  );

  const handleSetMetadataSourceEnabled = useCallback(
    async (id: string, enabled: boolean) => {
      if (operations.isBusy) return;
      setMetadataSources((current) => {
        const next = current.map((source) =>
          source.id === id ? { ...source, enabled } : source
        );
        void persistMetadataSources(next, "Metadata source settings saved.");
        return next;
      });
    },
    [operations.isBusy, persistMetadataSources]
  );

  return {
    normalizingDescriptions,
    batchFixingTitles,
    metadataSources,
    metadataSourcesSaving,
    handleNormalizeDescriptions,
    handleBatchFixTitles,
    handleSetMetadataSourceEnabled,
  };
}
