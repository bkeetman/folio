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

type LibraryItemFacet = {
  itemId: string;
  tags: LibraryItem["tags"];
  isbn: string | null;
};

type UseLibraryDataArgs = {
  setScanStatus: (value: string | null) => void;
};

function nowMs() {
  return (typeof performance !== "undefined" ? performance.now() : Date.now());
}

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

  const applyTitleCleanupIgnores = useCallback((rows: TitleCleanupIgnore[]) => {
    const nextMap: Record<string, string> = {};
    rows.forEach((row) => {
      nextMap[row.itemId] = row.titleSnapshot;
    });
    setTitleCleanupIgnoreMap(nextMap);
  }, []);

  const hydrateLibraryFacets = useCallback(async () => {
    if (!isTauri()) return;
    const started = nowMs();
    try {
      const facets = await invoke<LibraryItemFacet[]>("get_library_item_facets");
      const byItemId = new Map(facets.map((facet) => [facet.itemId, facet]));
      setLibraryItems((previous) =>
        previous.map((item) => {
          const facet = byItemId.get(item.id);
          if (!facet) return item;
          return {
            ...item,
            tags: facet.tags ?? [],
            isbn: facet.isbn ?? null,
          };
        })
      );
      console.info(
        `[perf] hydrateLibraryFacets facets=${facets.length} durationMs=${Math.round(nowMs() - started)}`
      );
    } catch {
      // ignore facet hydration errors
    }
  }, []);

  const loadSecondaryLibraryData = useCallback(
    async (phase: "initialLoad" | "refreshLibrary", isActive?: () => boolean) => {
      if (!isTauri()) return;
      const started = nowMs();
      try {
        const [
          inboxItems,
          duplicateGroups,
          titleGroups,
          fuzzyGroups,
          missing,
          health,
          titleCleanupIgnoreRows,
        ] = await Promise.all([
          invoke<InboxItem[]>("get_inbox_items"),
          invoke<DuplicateGroup[]>("get_duplicate_groups"),
          invoke<DuplicateGroup[]>("get_title_duplicate_groups"),
          invoke<DuplicateGroup[]>("get_fuzzy_duplicate_groups"),
          invoke<MissingFileItem[]>("get_missing_files"),
          invoke<LibraryHealth>("get_library_health"),
          invoke<TitleCleanupIgnore[]>("get_title_cleanup_ignores"),
        ]);

        if (isActive && !isActive()) return;

        setInbox(inboxItems);
        setDuplicates(duplicateGroups);
        setTitleDuplicates(titleGroups);
        setFuzzyDuplicates(fuzzyGroups);
        setMissingFiles(missing);
        setLibraryHealth(health);
        applyTitleCleanupIgnores(titleCleanupIgnoreRows);

        console.info(
          `[perf] ${phase} secondary durationMs=${Math.round(nowMs() - started)}`
        );
      } catch {
        if (phase === "refreshLibrary") {
          setScanStatus("Could not refresh library data.");
        }
      }
    },
    [applyTitleCleanupIgnores, setScanStatus]
  );

  const refreshLibrary = useCallback(async () => {
    if (!isTauri()) return;
    const started = nowMs();
    try {
      const items = await invoke<LibraryItem[]>("get_library_items_light");
      setLibraryItems(items);
      void hydrateLibraryFacets();
      console.info(
        `[perf] refreshLibrary quick lightItems=${items.length} durationMs=${Math.round(nowMs() - started)}`
      );
      void loadSecondaryLibraryData("refreshLibrary");
    } catch {
      setScanStatus("Could not refresh library data.");
    }
  }, [hydrateLibraryFacets, loadSecondaryLibraryData, setScanStatus]);

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
    let active = true;
    const load = async () => {
      if (!isTauri()) {
        setLibraryReady(true);
        return;
      }
      const started = nowMs();
      try {
        const items = await invoke<LibraryItem[]>("get_library_items_light");
        if (!active) return;
        setLibraryItems(items);
        void hydrateLibraryFacets();
        console.info(
          `[perf] initialLoad quick lightItems=${items.length} durationMs=${Math.round(nowMs() - started)}`
        );
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
      void loadSecondaryLibraryData("initialLoad", () => active);
    };
    void load();
    return () => {
      active = false;
    };
  }, [hydrateLibraryFacets, loadSecondaryLibraryData, setScanStatus]);

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
    resetLibraryState,
  };
}
