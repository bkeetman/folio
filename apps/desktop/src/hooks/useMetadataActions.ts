import { invoke, isTauri } from "@tauri-apps/api/core";
import {
  useCallback,
  useEffect,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from "react";
import { sampleFixCandidates } from "../lib/sampleData";
import type {
  BatchMetadataUpdatePayload,
  BatchMetadataUpdateResult,
  EnrichmentCandidate,
  ItemMetadata,
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

type UseMetadataActionsArgs = {
  isDesktop: boolean;
  selectedFixItemId: string | null;
  selectedItemId: string | null;
  fixApplyingCandidateId: string | null;
  fixSearchRequestIdRef: MutableRefObject<number>;
  setScanStatus: Dispatch<SetStateAction<string | null>>;
  setFixLoading: Dispatch<SetStateAction<boolean>>;
  setFixCandidates: Dispatch<SetStateAction<EnrichmentCandidate[]>>;
  setFixApplyingCandidateId: Dispatch<SetStateAction<string | null>>;
  setEditMatchLoading: Dispatch<SetStateAction<boolean>>;
  setEditMatchCandidates: Dispatch<SetStateAction<EnrichmentCandidate[]>>;
  setEditMatchApplying: Dispatch<SetStateAction<string | null>>;
  setEditDetailsVersion: Dispatch<SetStateAction<number>>;
  runLibraryMutationPipeline: RunLibraryMutationPipeline;
};

export function useMetadataActions({
  isDesktop,
  selectedFixItemId,
  selectedItemId,
  fixApplyingCandidateId,
  fixSearchRequestIdRef,
  setScanStatus,
  setFixLoading,
  setFixCandidates,
  setFixApplyingCandidateId,
  setEditMatchLoading,
  setEditMatchCandidates,
  setEditMatchApplying,
  setEditDetailsVersion,
  runLibraryMutationPipeline,
}: UseMetadataActionsArgs) {
  useEffect(() => {
    // Invalidate in-flight Fix Metadata searches and clear stale results on selection change.
    fixSearchRequestIdRef.current += 1;
    setFixCandidates([]);
    setFixLoading(false);
  }, [fixSearchRequestIdRef, selectedFixItemId, setFixCandidates, setFixLoading]);

  const getCandidateCoverUrl = useCallback((candidate: EnrichmentCandidate) => {
    if (candidate.cover_url) return candidate.cover_url;
    const isbn = candidate.identifiers
      .map((value) => value.replace(/[^0-9Xx]/g, "").toUpperCase())
      .find((value) => value.length === 13 || value.length === 10);
    if (!isbn) return null;
    return `https://covers.openlibrary.org/b/isbn/${isbn}-M.jpg`;
  }, []);

  const handleSearchFixWithQuery = useCallback(
    async (queryValue: string) => {
      if (!selectedFixItemId || !isTauri()) return;
      const requestId = ++fixSearchRequestIdRef.current;
      const itemId = selectedFixItemId;
      setFixLoading(true);
      setScanStatus("Searching metadata...");
      await new Promise((resolve) => setTimeout(resolve, 0));
      try {
        const candidates = await invoke<EnrichmentCandidate[]>("search_candidates", {
          query: queryValue,
          itemId,
        });
        if (fixSearchRequestIdRef.current !== requestId) return;
        setFixCandidates(candidates);
        if (candidates.length === 0) {
          setScanStatus("No metadata matches found.");
        }
      } catch {
        if (fixSearchRequestIdRef.current !== requestId) return;
        setScanStatus("Could not search metadata sources.");
        setFixCandidates([]);
      } finally {
        if (fixSearchRequestIdRef.current === requestId) {
          setFixLoading(false);
        }
      }
    },
    [fixSearchRequestIdRef, selectedFixItemId, setFixCandidates, setFixLoading, setScanStatus]
  );

  const handleApplyFixCandidate = useCallback(
    async (candidate: EnrichmentCandidate) => {
      if (!selectedFixItemId || !isTauri()) return;
      if (fixApplyingCandidateId) return;
      setFixApplyingCandidateId(candidate.id);
      setScanStatus("Applying metadata change...");
      try {
        const { pendingChangesCount } = await runLibraryMutationPipeline(
          () =>
            invoke("apply_fix_candidate", {
              itemId: selectedFixItemId,
              candidate,
            }),
          {
            refreshCoverItemId: selectedFixItemId,
            refreshPendingChanges: true,
          }
        );
        setScanStatus(
          pendingChangesCount > 0
            ? "Metadata updated in library. Changes are queued in Changes."
            : "Metadata updated in library."
        );
        setFixCandidates([]);
      } catch (error) {
        console.error("Failed to apply metadata candidate", error);
        const message = error instanceof Error ? error.message : String(error);
        setScanStatus(`Could not apply metadata change: ${message}`);
      } finally {
        setFixApplyingCandidateId(null);
      }
    },
    [
      fixApplyingCandidateId,
      runLibraryMutationPipeline,
      selectedFixItemId,
      setFixApplyingCandidateId,
      setFixCandidates,
      setScanStatus,
    ]
  );

  const handleSaveFixMetadata = useCallback(
    async (id: string, data: ItemMetadata) => {
      if (!isDesktop) return;
      setScanStatus("Applying metadata change...");
      try {
        const { pendingChangesCount } = await runLibraryMutationPipeline(
          () => invoke("save_item_metadata", { itemId: id, metadata: data }),
          {
            refreshCoverItemId: id,
            refreshPendingChanges: true,
          }
        );
        setScanStatus(
          pendingChangesCount > 0
            ? "Metadata updated in library. Changes are queued in Changes."
            : "Metadata updated in library."
        );
      } catch (error) {
        console.error("Failed to save metadata", error);
        setScanStatus("Could not apply metadata change.");
      }
    },
    [isDesktop, runLibraryMutationPipeline, setScanStatus]
  );

  const handleApplyBatchMetadata = useCallback(
    async (payload: BatchMetadataUpdatePayload) => {
      if (!isTauri()) return;
      if (!payload.itemIds.length) return;
      setScanStatus(`Applying batch update for ${payload.itemIds.length} books...`);
      try {
        const { result } = await runLibraryMutationPipeline(
          () =>
            invoke<BatchMetadataUpdateResult>("apply_batch_metadata_update", {
              payload,
            }),
          {
            refreshLibrary: (batchResult) => batchResult.itemsUpdated > 0,
            refreshPendingChanges: (batchResult) => batchResult.itemsUpdated > 0,
          }
        );
        const details: string[] = [];
        if (payload.genres) {
          details.push(`${result.categoriesUpdated} category updates`);
        }
        if (payload.authors) {
          details.push(`${result.authorsUpdated} author updates`);
        }
        if (payload.language || payload.clearLanguage) {
          details.push(`${result.languageUpdated} language updates`);
        }
        if (payload.series || payload.clearSeries) {
          details.push(`${result.seriesUpdated} series updates`);
        }
        if (payload.seriesIndex !== undefined || payload.clearSeriesIndex) {
          details.push(`${result.seriesIndexUpdated} series # updates`);
        }
        if (payload.publishedYear !== undefined || payload.clearPublishedYear) {
          details.push(`${result.yearsUpdated} year updates`);
        }
        if ((payload.tagIds && payload.tagIds.length > 0) || payload.clearTags) {
          details.push(`${result.tagsUpdated} tag updates`);
        }
        const detailSuffix = details.length > 0 ? ` (${details.join(", ")})` : "";
        setScanStatus(
          result.itemsUpdated > 0
            ? result.filesQueued > 0
              ? `Updated ${result.itemsUpdated} books${detailSuffix}. ${result.filesQueued} EPUB update(s) queued in Changes.`
              : result.changesQueued > 0
                ? `Updated ${result.itemsUpdated} books${detailSuffix}. ${result.changesQueued} change(s) queued in Changes.`
                : `Updated ${result.itemsUpdated} books${detailSuffix}.`
            : "No books required a batch update."
        );
      } catch (error) {
        const message =
          error instanceof Error
            ? error.message
            : String(error ?? "Batch metadata update failed.");
        setScanStatus(`Could not apply batch update: ${message}`);
      }
    },
    [runLibraryMutationPipeline, setScanStatus]
  );

  const loadEditMatchCandidates = useCallback(
    async (itemId: string) => {
      if (!isTauri()) {
        setEditMatchCandidates(sampleFixCandidates);
        return;
      }
      setEditMatchLoading(true);
      try {
        const candidates = await invoke<EnrichmentCandidate[]>("get_fix_candidates", {
          itemId,
        });
        setEditMatchCandidates(candidates);
      } catch {
        setScanStatus("Could not fetch match candidates.");
        setEditMatchCandidates([]);
      } finally {
        setEditMatchLoading(false);
      }
    },
    [setEditMatchCandidates, setEditMatchLoading, setScanStatus]
  );

  const handleEditMatchSearch = useCallback(
    async (query: string) => {
      if (!query.trim()) return;
      if (!isTauri()) {
        setEditMatchCandidates(sampleFixCandidates);
        return;
      }
      setEditMatchLoading(true);
      setScanStatus("Searching metadata...");
      await new Promise((resolve) => setTimeout(resolve, 0));
      try {
        const candidates = await invoke<EnrichmentCandidate[]>("search_candidates", {
          query,
          itemId: selectedItemId ?? undefined,
        });
        setEditMatchCandidates(candidates);
        if (candidates.length === 0) {
          setScanStatus("No metadata matches found.");
        }
      } catch {
        setScanStatus("Could not search metadata sources.");
        setEditMatchCandidates([]);
      } finally {
        setEditMatchLoading(false);
      }
    },
    [selectedItemId, setEditMatchCandidates, setEditMatchLoading, setScanStatus]
  );

  const handleEditMatchApply = useCallback(
    async (candidate: EnrichmentCandidate) => {
      if (!selectedItemId || !isTauri()) return;
      setEditMatchApplying(candidate.id);
      try {
        const { pendingChangesCount } = await runLibraryMutationPipeline(
          () =>
            invoke("apply_fix_candidate", {
              itemId: selectedItemId,
              candidate,
            }),
          {
            refreshCoverItemId: selectedItemId,
            refreshPendingChanges: true,
          }
        );
        setScanStatus(
          pendingChangesCount > 0
            ? "Metadata updated in library. EPUB/file updates are queued in Changes."
            : "Metadata updated in library."
        );
        setEditDetailsVersion((value) => value + 1);
      } catch (error) {
        console.error("Failed to apply metadata candidate (edit view)", error);
        const message = error instanceof Error ? error.message : String(error);
        setScanStatus(`Could not apply metadata change: ${message}`);
      } finally {
        setEditMatchApplying(null);
      }
    },
    [
      runLibraryMutationPipeline,
      selectedItemId,
      setEditDetailsVersion,
      setEditMatchApplying,
      setScanStatus,
    ]
  );

  return {
    getCandidateCoverUrl,
    handleSearchFixWithQuery,
    handleApplyFixCandidate,
    handleSaveFixMetadata,
    handleApplyBatchMetadata,
    loadEditMatchCandidates,
    handleEditMatchSearch,
    handleEditMatchApply,
  };
}
