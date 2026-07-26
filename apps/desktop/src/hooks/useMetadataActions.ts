import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from "react";
import { invoke, isTauri } from "../platform/native";
import type { OperationCoordinator } from "../operations/useOperationCoordinator";
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
  fixSearchRequestIdRef: MutableRefObject<number>;
  operations: OperationCoordinator;
  setScanStatus: Dispatch<SetStateAction<string | null>>;
  setFixCandidates: Dispatch<SetStateAction<EnrichmentCandidate[]>>;
  setEditMatchCandidates: Dispatch<SetStateAction<EnrichmentCandidate[]>>;
  setEditDetailsVersion: Dispatch<SetStateAction<number>>;
  runLibraryMutationPipeline: RunLibraryMutationPipeline;
};

export function useMetadataActions({
  isDesktop,
  selectedFixItemId,
  selectedItemId,
  fixSearchRequestIdRef,
  operations,
  setScanStatus,
  setFixCandidates,
  setEditMatchCandidates,
  setEditDetailsVersion,
  runLibraryMutationPipeline,
}: UseMetadataActionsArgs) {
  const previousFixItemIdRef = useRef(selectedFixItemId);
  const [fixApplyingCandidateId, setFixApplyingCandidateId] = useState<string | null>(null);
  const [editMatchApplying, setEditMatchApplying] = useState<string | null>(null);
  const { begin, complete, fail, reset } = operations;

  useEffect(() => {
    if (previousFixItemIdRef.current === selectedFixItemId) return;
    previousFixItemIdRef.current = selectedFixItemId;
    // Invalidate in-flight Fix Metadata searches and clear stale results on selection change.
    fixSearchRequestIdRef.current += 1;
    setFixCandidates([]);
    if (
      (operations.state.status === "running" || operations.state.status === "cancelling") &&
      operations.state.kind === "fix" &&
      operations.state.task === "fix-search"
    ) {
      reset();
    }
  }, [fixSearchRequestIdRef, operations.state, reset, selectedFixItemId, setFixCandidates]);

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
      const token = begin("fix", {
        task: "fix-search",
        label: "Searching metadata",
        canCancel: false,
      });
      if (token === null) return;
      const requestId = ++fixSearchRequestIdRef.current;
      const itemId = selectedFixItemId;
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
        complete(token, "Metadata search complete.");
      } catch {
        if (fixSearchRequestIdRef.current !== requestId) return;
        setScanStatus("Could not search metadata sources.");
        setFixCandidates([]);
        fail(token, "Could not search metadata sources.");
      }
    },
    [begin, complete, fail, fixSearchRequestIdRef, selectedFixItemId, setFixCandidates, setScanStatus]
  );

  const handleApplyFixCandidate = useCallback(
    async (candidate: EnrichmentCandidate) => {
      if (!selectedFixItemId || !isTauri()) return;
      if (fixApplyingCandidateId) return;
      const token = begin("fix", {
        task: "fix-apply",
        label: "Applying metadata change",
        canCancel: false,
      });
      if (token === null) return;
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
        const message = pendingChangesCount > 0
          ? "Metadata updated in library. Changes are queued in Changes."
          : "Metadata updated in library.";
        setScanStatus(message);
        complete(token, message);
        setFixCandidates([]);
      } catch (error) {
        console.error("Failed to apply metadata candidate", error);
        const message = error instanceof Error ? error.message : String(error);
        fail(token, message);
        setScanStatus(`Could not apply metadata change: ${message}`);
      } finally {
        setFixApplyingCandidateId(null);
      }
    },
    [
      begin,
      complete,
      fail,
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
      const token = begin("metadata", {
        task: "save-item",
        label: "Saving metadata",
        canCancel: false,
      });
      if (token === null) return;
      setScanStatus("Applying metadata change...");
      try {
        const { pendingChangesCount } = await runLibraryMutationPipeline(
          () => invoke("save_item_metadata", { itemId: id, metadata: data }),
          {
            refreshCoverItemId: id,
            refreshPendingChanges: true,
          }
        );
        const message = pendingChangesCount > 0
          ? "Metadata updated in library. Changes are queued in Changes."
          : "Metadata updated in library.";
        setScanStatus(message);
        complete(token, message);
      } catch (error) {
        console.error("Failed to save metadata", error);
        fail(token, error instanceof Error ? error.message : String(error));
        setScanStatus("Could not apply metadata change.");
      }
    },
    [begin, complete, fail, isDesktop, runLibraryMutationPipeline, setScanStatus]
  );

  const handleApplyBatchMetadata = useCallback(
    async (payload: BatchMetadataUpdatePayload) => {
      if (!isTauri()) return;
      if (!payload.itemIds.length) return;
      const token = begin("metadata", {
        task: "batch-update",
        label: "Applying batch metadata",
        canCancel: false,
      });
      if (token === null) return;
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
        const message = result.itemsUpdated > 0
            ? result.filesQueued > 0
              ? `Updated ${result.itemsUpdated} books${detailSuffix}. ${result.filesQueued} EPUB update(s) queued in Changes.`
              : result.changesQueued > 0
                ? `Updated ${result.itemsUpdated} books${detailSuffix}. ${result.changesQueued} change(s) queued in Changes.`
                : `Updated ${result.itemsUpdated} books${detailSuffix}.`
            : "No books required a batch update.";
        setScanStatus(message);
        complete(token, message);
      } catch (error) {
        const message =
          error instanceof Error
            ? error.message
            : String(error ?? "Batch metadata update failed.");
        fail(token, message);
        setScanStatus(`Could not apply batch update: ${message}`);
      }
    },
    [begin, complete, fail, runLibraryMutationPipeline, setScanStatus]
  );

  const loadEditMatchCandidates = useCallback(
    async (itemId: string) => {
      if (!isTauri()) {
        setEditMatchCandidates(sampleFixCandidates);
        return;
      }
      const token = begin("fix", {
        task: "edit-match",
        label: "Loading metadata matches",
        canCancel: false,
      });
      if (token === null) return;
      try {
        const candidates = await invoke<EnrichmentCandidate[]>("get_fix_candidates", {
          itemId,
        });
        setEditMatchCandidates(candidates);
        complete(token, "Metadata matches loaded.");
      } catch {
        setScanStatus("Could not fetch match candidates.");
        setEditMatchCandidates([]);
        fail(token, "Could not fetch match candidates.");
      }
    },
    [begin, complete, fail, setEditMatchCandidates, setScanStatus]
  );

  const handleEditMatchSearch = useCallback(
    async (query: string) => {
      if (!query.trim()) return;
      if (!isTauri()) {
        setEditMatchCandidates(sampleFixCandidates);
        return;
      }
      const token = begin("fix", {
        task: "edit-match",
        label: "Searching metadata",
        canCancel: false,
      });
      if (token === null) return;
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
        complete(token, "Metadata search complete.");
      } catch {
        setScanStatus("Could not search metadata sources.");
        setEditMatchCandidates([]);
        fail(token, "Could not search metadata sources.");
      }
    },
    [begin, complete, fail, selectedItemId, setEditMatchCandidates, setScanStatus]
  );

  const handleEditMatchApply = useCallback(
    async (candidate: EnrichmentCandidate) => {
      if (!selectedItemId || !isTauri()) return;
      const token = begin("fix", {
        task: "edit-apply",
        label: "Applying metadata match",
        canCancel: false,
      });
      if (token === null) return;
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
        const message = pendingChangesCount > 0
            ? "Metadata updated in library. EPUB/file updates are queued in Changes."
            : "Metadata updated in library.";
        setScanStatus(message);
        complete(token, message);
        setEditDetailsVersion((value) => value + 1);
      } catch (error) {
        console.error("Failed to apply metadata candidate (edit view)", error);
        const message = error instanceof Error ? error.message : String(error);
        fail(token, message);
        setScanStatus(`Could not apply metadata change: ${message}`);
      } finally {
        setEditMatchApplying(null);
      }
    },
    [
      begin,
      complete,
      fail,
      runLibraryMutationPipeline,
      selectedItemId,
      setEditDetailsVersion,
      setEditMatchApplying,
      setScanStatus,
    ]
  );

  return {
    fixLoading: operations.isRunning("fix", "fix-search"),
    editMatchLoading: operations.isRunning("fix", "edit-match"),
    fixApplyingCandidateId,
    editMatchApplying,
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
