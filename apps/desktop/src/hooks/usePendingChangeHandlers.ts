import { invoke } from "@tauri-apps/api/core";
import { useCallback, type Dispatch, type MutableRefObject, type SetStateAction } from "react";
import type { PendingChange } from "../types/library";

type PendingChangeStatus = "pending" | "applied" | "error";
type ChangesSourceFilter = "all" | "library" | "ereader";
type PendingChangeMutation = "apply" | "remove";
type PendingChangeRefreshPolicy = "never" | "sync" | "always";

type UsePendingChangeHandlersArgs = {
  isTauriRuntime: boolean;
  pendingChangesStatusRef: MutableRefObject<PendingChangeStatus>;
  selectedChangeIds: Set<string>;
  pendingChangesForView: PendingChange[];
  changesSourceFilter: ChangesSourceFilter;
  changesDeviceFilter: string | null;
  confirmDeleteIds: string[];
  setConfirmDeleteIds: Dispatch<SetStateAction<string[]>>;
  setConfirmDeleteOpen: Dispatch<SetStateAction<boolean>>;
  setPendingChangesApplying: Dispatch<SetStateAction<boolean>>;
  setSelectedChangeIds: Dispatch<SetStateAction<Set<string>>>;
  setScanStatus: Dispatch<SetStateAction<string | null>>;
  splitChangeIds: (ids: string[]) => { fileIds: string[]; syncIds: string[] };
  refreshCurrentChanges: () => Promise<PendingChange[]>;
  refreshLibrary: () => Promise<void>;
};

export function usePendingChangeHandlers({
  isTauriRuntime,
  pendingChangesStatusRef,
  selectedChangeIds,
  pendingChangesForView,
  changesSourceFilter,
  changesDeviceFilter,
  confirmDeleteIds,
  setConfirmDeleteIds,
  setConfirmDeleteOpen,
  setPendingChangesApplying,
  setSelectedChangeIds,
  setScanStatus,
  splitChangeIds,
  refreshCurrentChanges,
  refreshLibrary,
}: UsePendingChangeHandlersArgs) {
  const runPendingChangeMutation = useCallback(
    async ({
      mutation,
      scopedIds,
      includeAllMatching = false,
      refreshLibraryPolicy = "sync",
    }: {
      mutation: PendingChangeMutation;
      scopedIds: string[];
      includeAllMatching?: boolean;
      refreshLibraryPolicy?: PendingChangeRefreshPolicy;
    }) => {
      const fileCommand =
        mutation === "apply" ? "apply_pending_changes" : "remove_pending_changes";
      const syncCommand =
        mutation === "apply" ? "apply_sync_queue_changes" : "remove_sync_queue_changes";

      let syncTouched = false;
      if (includeAllMatching) {
        await invoke(fileCommand, { ids: [] });
        await invoke(syncCommand, { ids: [] });
        syncTouched = true;
      } else if (scopedIds.length > 0) {
        const { fileIds, syncIds } = splitChangeIds(scopedIds);
        if (fileIds.length > 0) {
          await invoke(fileCommand, { ids: fileIds });
        }
        if (syncIds.length > 0) {
          await invoke(syncCommand, { ids: syncIds });
          syncTouched = true;
        }
      }

      await refreshCurrentChanges();

      if (
        refreshLibraryPolicy === "always" ||
        (refreshLibraryPolicy === "sync" && syncTouched)
      ) {
        await refreshLibrary();
      }
    },
    [refreshCurrentChanges, refreshLibrary, splitChangeIds]
  );

  const handleApplyChange = useCallback(
    async (changeId: string) => {
      if (!isTauriRuntime || pendingChangesStatusRef.current !== "pending") return;
      try {
        setPendingChangesApplying(true);
        await runPendingChangeMutation({
          mutation: "apply",
          scopedIds: [changeId],
          refreshLibraryPolicy: "sync",
        });
      } catch {
        setScanStatus("Could not apply change.");
      } finally {
        setPendingChangesApplying(false);
      }
    },
    [
      isTauriRuntime,
      pendingChangesStatusRef,
      runPendingChangeMutation,
      setPendingChangesApplying,
      setScanStatus,
    ]
  );

  const handleApplySelectedChanges = useCallback(async () => {
    if (!isTauriRuntime || pendingChangesStatusRef.current !== "pending") return;
    const ids = Array.from(selectedChangeIds);
    if (!ids.length) return;
    const selectedDeletes = pendingChangesForView
      .filter((change) => ids.includes(change.id))
      .filter((change) => change.change_type === "delete")
      .map((change) => change.id);
    if (selectedDeletes.length) {
      setConfirmDeleteIds(ids);
      setConfirmDeleteOpen(true);
      return;
    }
    try {
      setPendingChangesApplying(true);
      await runPendingChangeMutation({
        mutation: "apply",
        scopedIds: ids,
        refreshLibraryPolicy: "sync",
      });
      setSelectedChangeIds(new Set());
    } catch {
      setScanStatus("Could not apply changes.");
    } finally {
      setPendingChangesApplying(false);
    }
  }, [
    isTauriRuntime,
    pendingChangesStatusRef,
    selectedChangeIds,
    pendingChangesForView,
    setConfirmDeleteIds,
    setConfirmDeleteOpen,
    setPendingChangesApplying,
    runPendingChangeMutation,
    setSelectedChangeIds,
    setScanStatus,
  ]);

  const handleConfirmDelete = useCallback(async () => {
    if (!confirmDeleteIds.length || pendingChangesStatusRef.current !== "pending") return;
    try {
      setPendingChangesApplying(true);
      await runPendingChangeMutation({
        mutation: "apply",
        scopedIds: confirmDeleteIds,
        refreshLibraryPolicy: "sync",
      });
      setSelectedChangeIds(new Set());
    } catch {
      setScanStatus("Could not apply delete changes.");
    } finally {
      setPendingChangesApplying(false);
      setConfirmDeleteIds([]);
      setConfirmDeleteOpen(false);
    }
  }, [
    confirmDeleteIds,
    pendingChangesStatusRef,
    setPendingChangesApplying,
    runPendingChangeMutation,
    setSelectedChangeIds,
    setScanStatus,
    setConfirmDeleteIds,
    setConfirmDeleteOpen,
  ]);

  const handleApplyAllChanges = useCallback(async () => {
    if (!isTauriRuntime || pendingChangesStatusRef.current !== "pending") return;
    try {
      setPendingChangesApplying(true);
      const scopedIds = pendingChangesForView.map((change) => change.id);
      await runPendingChangeMutation({
        mutation: "apply",
        scopedIds,
        includeAllMatching: changesSourceFilter === "all" && !changesDeviceFilter,
        refreshLibraryPolicy: "always",
      });
    } catch {
      setScanStatus("Could not apply changes.");
    } finally {
      setPendingChangesApplying(false);
    }
  }, [
    isTauriRuntime,
    pendingChangesStatusRef,
    setPendingChangesApplying,
    pendingChangesForView,
    runPendingChangeMutation,
    changesSourceFilter,
    changesDeviceFilter,
    setScanStatus,
  ]);

  const handleRemoveChange = useCallback(
    async (changeId: string) => {
      if (!isTauriRuntime || pendingChangesStatusRef.current !== "pending") return;
      try {
        await runPendingChangeMutation({
          mutation: "remove",
          scopedIds: [changeId],
          refreshLibraryPolicy: "never",
        });
        setSelectedChangeIds((prev) => {
          const next = new Set(prev);
          next.delete(changeId);
          return next;
        });
      } catch {
        setScanStatus("Could not remove change.");
      }
    },
    [
      isTauriRuntime,
      pendingChangesStatusRef,
      runPendingChangeMutation,
      setSelectedChangeIds,
      setScanStatus,
    ]
  );

  const handleRemoveSelectedChanges = useCallback(async () => {
    if (!isTauriRuntime || !selectedChangeIds.size || pendingChangesStatusRef.current !== "pending")
      return;
    try {
      await runPendingChangeMutation({
        mutation: "remove",
        scopedIds: Array.from(selectedChangeIds),
        refreshLibraryPolicy: "never",
      });
      setSelectedChangeIds(new Set());
    } catch {
      setScanStatus("Could not remove changes.");
    }
  }, [
    isTauriRuntime,
    selectedChangeIds,
    pendingChangesStatusRef,
    runPendingChangeMutation,
    setSelectedChangeIds,
    setScanStatus,
  ]);

  const handleRemoveAllChanges = useCallback(async () => {
    if (!isTauriRuntime || pendingChangesStatusRef.current !== "pending") return;
    try {
      const scopedIds = pendingChangesForView.map((change) => change.id);
      await runPendingChangeMutation({
        mutation: "remove",
        scopedIds,
        includeAllMatching: changesSourceFilter === "all" && !changesDeviceFilter,
        refreshLibraryPolicy: "never",
      });
      setSelectedChangeIds(new Set());
    } catch {
      setScanStatus("Could not remove changes.");
    }
  }, [
    isTauriRuntime,
    pendingChangesStatusRef,
    pendingChangesForView,
    runPendingChangeMutation,
    changesSourceFilter,
    changesDeviceFilter,
    setSelectedChangeIds,
    setScanStatus,
  ]);

  return {
    handleApplyChange,
    handleApplySelectedChanges,
    handleConfirmDelete,
    handleApplyAllChanges,
    handleRemoveChange,
    handleRemoveSelectedChanges,
    handleRemoveAllChanges,
  };
}
