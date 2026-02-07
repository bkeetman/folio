import { invoke, isTauri } from "@tauri-apps/api/core";
import { useCallback, useEffect, useState } from "react";
import type {
  DuplicateGroup,
  InboxItem,
  LibraryHealth,
  LibraryItem,
  MissingFileItem,
} from "../types/library";

type TitleCleanupIgnore = {
  itemId: string;
  titleSnapshot: string;
};

type UseLibraryDataArgs = {
  setScanStatus: (value: string | null) => void;
};

export function useLibraryData({ setScanStatus }: UseLibraryDataArgs) {
  const [libraryItems, setLibraryItems] = useState<LibraryItem[]>([]);
  const [libraryReady, setLibraryReady] = useState(false);
  const [inbox, setInbox] = useState<InboxItem[]>([]);
  const [duplicates, setDuplicates] = useState<DuplicateGroup[]>([]);
  const [titleDuplicates, setTitleDuplicates] = useState<DuplicateGroup[]>([]);
  const [fuzzyDuplicates, setFuzzyDuplicates] = useState<DuplicateGroup[]>([]);
  const [missingFiles, setMissingFiles] = useState<MissingFileItem[]>([]);
  const [libraryHealth, setLibraryHealth] = useState<LibraryHealth | null>(null);
  const [titleCleanupIgnoreMap, setTitleCleanupIgnoreMap] = useState<Record<string, string>>({});

  const refreshTitleCleanupIgnores = useCallback(async () => {
    if (!isTauri()) return;
    try {
      const rows = await invoke<TitleCleanupIgnore[]>("get_title_cleanup_ignores");
      const nextMap: Record<string, string> = {};
      rows.forEach((row) => {
        nextMap[row.itemId] = row.titleSnapshot;
      });
      setTitleCleanupIgnoreMap(nextMap);
    } catch {
      // ignore
    }
  }, []);

  const refreshLibrary = useCallback(async () => {
    if (!isTauri()) return;
    try {
      const items = await invoke<LibraryItem[]>("get_library_items");
      setLibraryItems(items);
      const inboxItems = await invoke<InboxItem[]>("get_inbox_items");
      setInbox(inboxItems);
      const duplicateGroups = await invoke<DuplicateGroup[]>("get_duplicate_groups");
      const titleGroups = await invoke<DuplicateGroup[]>("get_title_duplicate_groups");
      const fuzzyGroups = await invoke<DuplicateGroup[]>("get_fuzzy_duplicate_groups");
      setDuplicates(duplicateGroups);
      setTitleDuplicates(titleGroups);
      setFuzzyDuplicates(fuzzyGroups);
      const missing = await invoke<MissingFileItem[]>("get_missing_files");
      setMissingFiles(missing);
      const health = await invoke<LibraryHealth>("get_library_health");
      setLibraryHealth(health);
      await refreshTitleCleanupIgnores();
    } catch {
      setScanStatus("Could not refresh library data.");
    }
  }, [refreshTitleCleanupIgnores, setScanStatus]);

  const resetLibraryState = useCallback(() => {
    setLibraryItems([]);
    setInbox([]);
    setDuplicates([]);
    setTitleDuplicates([]);
    setFuzzyDuplicates([]);
    setMissingFiles([]);
    setLibraryHealth(null);
  }, []);

  useEffect(() => {
    const load = async () => {
      if (!isTauri()) {
        setLibraryReady(true);
        return;
      }
      try {
        const items = await invoke<LibraryItem[]>("get_library_items");
        setLibraryItems(items);
        const inboxItems = await invoke<InboxItem[]>("get_inbox_items");
        setInbox(inboxItems);
        const duplicateGroups = await invoke<DuplicateGroup[]>("get_duplicate_groups");
        const titleGroups = await invoke<DuplicateGroup[]>("get_title_duplicate_groups");
        const fuzzyGroups = await invoke<DuplicateGroup[]>("get_fuzzy_duplicate_groups");
        setDuplicates(duplicateGroups);
        setTitleDuplicates(titleGroups);
        setFuzzyDuplicates(fuzzyGroups);
        const missing = await invoke<MissingFileItem[]>("get_missing_files");
        setMissingFiles(missing);
        const health = await invoke<LibraryHealth>("get_library_health");
        setLibraryHealth(health);
        await refreshTitleCleanupIgnores();
      } catch {
        setScanStatus("Could not load library data.");
      } finally {
        setLibraryReady(true);
        try {
          await invoke("close_splashscreen");
        } catch {
          // Splash screen might not exist (e.g., in dev mode)
        }
      }
    };
    void load();
  }, [refreshTitleCleanupIgnores, setScanStatus]);

  return {
    libraryItems,
    libraryReady,
    inbox,
    duplicates,
    titleDuplicates,
    fuzzyDuplicates,
    missingFiles,
    libraryHealth,
    titleCleanupIgnoreMap,
    refreshLibrary,
    refreshTitleCleanupIgnores,
    resetLibraryState,
  };
}
