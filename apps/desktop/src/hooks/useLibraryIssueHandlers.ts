import { invoke, isTauri } from "@tauri-apps/api/core";
import { useCallback, useState, type Dispatch, type SetStateAction } from "react";
import type { DuplicateGroup } from "../types/library";

type LibraryMutationOptions<T> = {
  refreshCoverItemId?: string | null;
  refreshLibrary?: boolean | ((result: T) => boolean);
  refreshPendingChanges?: boolean | ((result: T) => boolean);
};

type RunLibraryMutationPipeline = <T>(
  mutation: () => Promise<T>,
  options?: LibraryMutationOptions<T>
) => Promise<{ result: T; pendingChangesCount: number }>;

type UseLibraryIssueHandlersArgs = {
  organizeRoot: string | null;
  setOrganizeRoot: Dispatch<SetStateAction<string | null>>;
  refreshLibrary: () => Promise<void>;
  refreshPendingChanges: () => Promise<number>;
  runLibraryMutationPipeline: RunLibraryMutationPipeline;
  setScanStatus: Dispatch<SetStateAction<string | null>>;
};

export function useLibraryIssueHandlers({
  organizeRoot,
  setOrganizeRoot,
  refreshLibrary,
  refreshPendingChanges,
  runLibraryMutationPipeline,
  setScanStatus,
}: UseLibraryIssueHandlersArgs) {
  const [duplicateKeepSelection, setDuplicateKeepSelection] = useState<
    Record<string, string>
  >({});

  const handleRelinkMissing = useCallback(
    async (fileId: string) => {
      if (!isTauri()) return;
      try {
        const { open } = await import("@tauri-apps/plugin-dialog");
        const selection = await open({ multiple: false });
        if (typeof selection !== "string") return;
        const { pendingChangesCount } = await runLibraryMutationPipeline(
          () => invoke("relink_missing_file", { fileId, newPath: selection }),
          { refreshPendingChanges: true }
        );
        setScanStatus(
          pendingChangesCount > 0
            ? "Missing file relinked in library. Change queued in Changes."
            : "Missing file relinked."
        );
      } catch (err) {
        console.error("Failed to relink file", err);
        setScanStatus("Could not relink file.");
      }
    },
    [runLibraryMutationPipeline, setScanStatus]
  );

  const handleRemoveMissing = useCallback(
    async (fileId: string) => {
      if (!isTauri()) return;
      try {
        const { pendingChangesCount } = await runLibraryMutationPipeline(
          () => invoke("remove_missing_file", { fileId }),
          { refreshPendingChanges: true }
        );
        setScanStatus(
          pendingChangesCount > 0
            ? "Missing file removed in library. Change queued in Changes."
            : "Missing file removed from library."
        );
      } catch (err) {
        console.error("Failed to remove missing file", err);
        setScanStatus("Could not remove missing file.");
      }
    },
    [runLibraryMutationPipeline, setScanStatus]
  );

  const handleRemoveAllMissing = useCallback(async () => {
    if (!isTauri()) return;
    const { confirm } = await import("@tauri-apps/plugin-dialog");
    const ok = await confirm(
      "This will remove all missing-file entries from your library records. Continue?",
      {
        title: "Remove all missing files",
        kind: "warning",
      }
    );
    if (!ok) return;
    try {
      const { result: removed, pendingChangesCount } = await runLibraryMutationPipeline(
        () => invoke<number>("remove_all_missing_files"),
        {
          refreshLibrary: (count) => count > 0,
          refreshPendingChanges: (count) => count > 0,
        }
      );
      setScanStatus(
        removed > 0
          ? pendingChangesCount > 0
            ? `Removed ${removed} missing-file entries in library. Changes queued in Changes.`
            : `Removed ${removed} missing-file entries from library.`
          : "No missing file entries to remove."
      );
    } catch (err) {
      console.error("Failed to remove all missing files", err);
      setScanStatus("Could not remove all missing files.");
    }
  }, [runLibraryMutationPipeline, setScanStatus]);

  const handleRescanMissing = useCallback(async () => {
    if (!isTauri()) return;
    try {
      let selection = organizeRoot;
      if (!selection) {
        const { open } = await import("@tauri-apps/plugin-dialog");
        const picked: string | string[] | null = await open({
          directory: true,
          multiple: false,
        });
        if (typeof picked !== "string") return;
        selection = picked;
        setOrganizeRoot(picked);
      }
      setScanStatus("Scanning for missing files...");
      await invoke("scan_folder", { root: selection });
      await refreshLibrary();
      setScanStatus("Missing files refreshed.");
    } catch (err) {
      console.error("Failed to rescan", err);
      setScanStatus("Could not rescan folder.");
    }
  }, [organizeRoot, refreshLibrary, setOrganizeRoot, setScanStatus]);

  const pickBestDuplicate = useCallback((group: DuplicateGroup) => {
    const scoreFile = (fileName: string, filePath: string) => {
      const lowerPath = filePath.toLowerCase();
      let score = 0;
      if (lowerPath.endsWith(".epub")) score += 50;
      if (lowerPath.endsWith(".mobi")) score += 30;
      if (lowerPath.endsWith(".pdf")) score += 10;
      if (!/(\s\[\d+\]|\s\(\d+\)|\s-\s?copy| copy)/i.test(fileName)) score += 20;
      if (!lowerPath.includes(".trash")) score += 5;
      return score;
    };

    let bestId = group.file_ids[0];
    let bestScore = -Infinity;
    group.files.forEach((file, index) => {
      const fileId = group.file_ids[index] ?? file;
      const filePath = group.file_paths[index] ?? file;
      const score = scoreFile(file, filePath);
      if (score > bestScore) {
        bestScore = score;
        bestId = fileId;
      }
    });
    return bestId;
  }, []);

  const handleResolveDuplicate = useCallback(
    async (group: DuplicateGroup, keepFileId: string) => {
      if (!isTauri()) return;
      try {
        const keepId = keepFileId || (group ? pickBestDuplicate(group) : "");
        if (!keepId) {
          setScanStatus("Pick a file to keep first.");
          return;
        }
        if (group.kind === "hash") {
          await invoke("resolve_duplicate_group", { groupId: group.id, keepFileId: keepId });
        } else {
          await invoke("resolve_duplicate_group_by_files", {
            keepFileId: keepId,
            fileIds: group.file_ids,
          });
        }
        await refreshLibrary();
        await refreshPendingChanges();
        setScanStatus("Duplicate resolved in library. File delete changes are queued in Changes.");
        setDuplicateKeepSelection((prev) => {
          const next = { ...prev };
          delete next[group.id];
          return next;
        });
      } catch {
        setScanStatus("Could not resolve duplicate.");
      }
    },
    [pickBestDuplicate, refreshLibrary, refreshPendingChanges, setScanStatus]
  );

  const handleAutoSelectDuplicates = useCallback(
    (groups: DuplicateGroup[]) => {
      const next: Record<string, string> = {};
      groups.forEach((group) => {
        next[group.id] = pickBestDuplicate(group);
      });
      setDuplicateKeepSelection(next);
    },
    [pickBestDuplicate]
  );

  const handleResolveAllDuplicates = useCallback(
    async (groups: DuplicateGroup[]) => {
      if (!isTauri()) return;
      try {
        let resolved = 0;
        for (const group of groups) {
          const keepId = duplicateKeepSelection[group.id] || pickBestDuplicate(group);
          if (!keepId) continue;
          if (group.kind === "hash") {
            await invoke("resolve_duplicate_group", { groupId: group.id, keepFileId: keepId });
          } else {
            await invoke("resolve_duplicate_group_by_files", {
              keepFileId: keepId,
              fileIds: group.file_ids,
            });
          }
          resolved += 1;
        }
        await refreshLibrary();
        await refreshPendingChanges();
        setScanStatus(
          resolved > 0
            ? `Resolved ${resolved} duplicate groups in library. File delete changes are queued in Changes.`
            : "No duplicate groups were resolved."
        );
      } catch {
        setScanStatus("Could not resolve duplicates.");
      }
    },
    [
      duplicateKeepSelection,
      pickBestDuplicate,
      refreshLibrary,
      refreshPendingChanges,
      setScanStatus,
    ]
  );

  return {
    duplicateKeepSelection,
    setDuplicateKeepSelection,
    handleRelinkMissing,
    handleRemoveMissing,
    handleRemoveAllMissing,
    handleRescanMissing,
    handleResolveDuplicate,
    handleAutoSelectDuplicates,
    handleResolveAllDuplicates,
  };
}
