import { invoke, isTauri } from "@tauri-apps/api/core";
import { useCallback, useEffect, useState, type Dispatch, type SetStateAction } from "react";
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
  setScanStatus: Dispatch<SetStateAction<string | null>>;
  runLibraryMutationPipeline: RunLibraryMutationPipeline;
};

export function useMetadataSettings({
  initialMetadataSources,
  setScanStatus,
  runLibraryMutationPipeline,
}: UseMetadataSettingsArgs) {
  const [normalizingDescriptions, setNormalizingDescriptions] = useState(false);
  const [batchFixingTitles, setBatchFixingTitles] = useState(false);
  const [metadataSources, setMetadataSources] =
    useState<MetadataSourceSetting[]>(initialMetadataSources);
  const [metadataSourcesSaving, setMetadataSourcesSaving] = useState(false);

  const handleNormalizeDescriptions = useCallback(async () => {
    if (!isTauri() || normalizingDescriptions) return;
    setNormalizingDescriptions(true);
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
    } catch (error) {
      const message =
        error instanceof Error ? error.message : String(error ?? "Description cleanup failed.");
      setScanStatus(`Could not clean descriptions: ${message}`);
    } finally {
      setNormalizingDescriptions(false);
    }
  }, [normalizingDescriptions, runLibraryMutationPipeline, setScanStatus]);

  const handleBatchFixTitles = useCallback(async () => {
    if (!isTauri() || batchFixingTitles) return;
    setBatchFixingTitles(true);
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
    } catch (error) {
      const message =
        error instanceof Error ? error.message : String(error ?? "Batch title cleanup failed.");
      setScanStatus(`Could not batch-fix titles: ${message}`);
    } finally {
      setBatchFixingTitles(false);
    }
  }, [batchFixingTitles, runLibraryMutationPipeline, setScanStatus]);

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
      setMetadataSourcesSaving(true);
      try {
        await invoke("set_metadata_lookup_settings", {
          settings: { sources },
        });
        setScanStatus(successMessage);
      } catch {
        setScanStatus("Could not save metadata source settings.");
      } finally {
        setMetadataSourcesSaving(false);
      }
    },
    [setScanStatus]
  );

  const handleSetMetadataSourceEnabled = useCallback(
    async (id: string, enabled: boolean) => {
      setMetadataSources((current) => {
        const next = current.map((source) =>
          source.id === id ? { ...source, enabled } : source
        );
        void persistMetadataSources(next, "Metadata source settings saved.");
        return next;
      });
    },
    [persistMetadataSources]
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
