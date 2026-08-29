import {
  useCallback,
  useDeferredValue,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
  type Dispatch,
  type SetStateAction,
} from "react";
import { confirm, invoke, isTauri, open } from "./platform/native";
import { OperationStatusPanel } from "./components/OperationStatusPanel";
import { SyncConfirmDialog } from "./components/SyncConfirmDialog";
import { useChangesFeature } from "./features/changes/useChangesFeature";
import { useCoverOverrides } from "./hooks/useCoverOverrides";
import { useDebouncedValue } from "./hooks/useDebouncedValue";
import { useEreader } from "./hooks/useEreader";
import { useLibraryData } from "./hooks/useLibraryData";
import { useLibraryIssueHandlers } from "./hooks/useLibraryIssueHandlers";
import { useLibraryOperations } from "./hooks/useLibraryOperations";
import { useLibrarySelectors } from "./hooks/useLibrarySelectors";
import { useMetadataActions } from "./hooks/useMetadataActions";
import { useMetadataSettings } from "./hooks/useMetadataSettings";
import { useOperationEventListeners } from "./hooks/useOperationEventListeners";
import { useOrganizer } from "./hooks/useOrganizer";
import { useTheme } from "./hooks/useTheme";
import { useUpdater } from "./hooks/useUpdater";
import {
  sampleBooks,
  sampleDuplicateGroups,
  sampleInboxItems,
  sampleTags,
} from "./lib/sampleData";
import { TAG_COLORS } from "./lib/tagColors";
import { useOperationCoordinator } from "./operations/useOperationCoordinator";
import { AppRoutes } from "./sections/AppRoutes";
import { Inspector } from "./sections/Inspector";
import { Sidebar } from "./sections/Sidebar";
import { StatusBar } from "./sections/StatusBar";
import { TopToolbar } from "./sections/TopToolbar";
import type {
  ActivityLogItem,
  EnrichmentCandidate,
  FixFilter,
  LibraryFilter,
  LibrarySort,
  MetadataSourceSetting,
  Tag,
  View,
} from "./types/library";

const DEFAULT_METADATA_SOURCES: MetadataSourceSetting[] = [
  {
    id: "open-library",
    label: "Open Library",
    enabled: true,
    sourceType: "builtin",
    endpoint: "https://openlibrary.org",
  },
  {
    id: "google-books",
    label: "Google Books",
    enabled: true,
    sourceType: "builtin",
    endpoint: "https://www.googleapis.com/books/v1",
  },
  {
    id: "apple-books",
    label: "Apple Books",
    enabled: true,
    sourceType: "builtin",
    endpoint: "https://itunes.apple.com",
  },
  {
    id: "wikidata",
    label: "Wikidata",
    enabled: true,
    sourceType: "builtin",
    endpoint: "https://www.wikidata.org/w/api.php",
  },
  {
    id: "wikipedia",
    label: "Wikipedia",
    enabled: true,
    sourceType: "builtin",
    endpoint: "https://en.wikipedia.org/api/rest_v1",
  },
  {
    id: "isfdb",
    label: "ISFDB",
    enabled: false,
    sourceType: "isfdb",
    endpoint: "https://www.isfdb.org/cgi-bin/se.cgi",
  },
  {
    id: "internet-archive",
    label: "Internet Archive",
    enabled: false,
    sourceType: "builtin",
    endpoint: "https://archive.org/advancedsearch.php",
  },
  {
    id: "openbd",
    label: "OpenBD (Japan)",
    enabled: false,
    sourceType: "builtin",
    endpoint: "https://api.openbd.jp/v1/get",
  },
];

const LIBRARY_SORT_STORAGE_KEY = "folio.librarySort";
const LIBRARY_SORT_LEGACY_SESSION_KEY = "folio.session.librarySort";
const LIBRARY_SORT_VALUES: LibrarySort[] = [
  "default",
  "title-asc",
  "title-desc",
  "author-asc",
  "year-desc",
  "year-asc",
  "recent",
];

function App() {
  const readInitialInspectorWidth = () => {
    if (typeof window === "undefined") return 320;
    const raw = window.localStorage.getItem("folio.inspectorWidth");
    const parsed = raw ? Number.parseInt(raw, 10) : NaN;
    if (!Number.isFinite(parsed)) return 320;
    return Math.min(460, Math.max(260, parsed));
  };
  const readInitialLibrarySort = () => {
    if (typeof window === "undefined") return "default" as LibrarySort;
    const raw =
      window.localStorage.getItem(LIBRARY_SORT_STORAGE_KEY) ??
      window.sessionStorage.getItem(LIBRARY_SORT_LEGACY_SESSION_KEY);
    if (!raw) return "default";
    return LIBRARY_SORT_VALUES.includes(raw as LibrarySort)
      ? (raw as LibrarySort)
      : "default";
  };
  const [view, setView] = useState<View>(() => {
    if (import.meta.env.DEV) {
      const params = new URLSearchParams(window.location.search);
      if (params.get("prototype") === "activity") return "changes";
    }
    return "library-books";
  });
  const [isViewTransitionPending, startViewTransition] = useTransition();
  const [pendingView, setPendingView] = useState<View | null>(null);
  const [previousView, setPreviousView] = useState<View>("library-books");
  const [activityLog, setActivityLog] = useState<ActivityLogItem[]>([]); // New State
  const [grid, setGrid] = useState(true);
  const [queryInput, setQueryInput] = useState("");
  const debouncedQuery = useDebouncedValue(queryInput, 180);
  const query = useDeferredValue(debouncedQuery);
  const [libraryFilter, setLibraryFilter] = useState<LibraryFilter>("all");
  const [librarySort, setLibrarySort] = useState<LibrarySort>(readInitialLibrarySort);
  const [selectedTagIds, setSelectedTagIds] = useState<string[]>([]);
  const [scanStatus, setScanStatus] = useState<string | null>(null);
  const [fixCandidates, setFixCandidates] = useState<EnrichmentCandidate[]>([]);
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const [selectedBatchItemIds, setSelectedBatchItemIds] = useState<Set<string>>(new Set());
  const [editMatchQuery, setEditMatchQuery] = useState("");
  const [editMatchCandidates, setEditMatchCandidates] = useState<EnrichmentCandidate[]>([]);
  const [editDetailsVersion, setEditDetailsVersion] = useState(0);
  const mainScrollRef = useRef<HTMLDivElement | null>(null);
  const savedScrollByViewRef = useRef<Partial<Record<View, number>>>({});
  const pendingScrollRestoreRef = useRef<{ view: View; top: number } | null>(null);
  const editReturnScrollRef = useRef<{ view: View; top: number } | null>(null);
  const scrollRestoreRafRef = useRef<number | null>(null);
  const [inspectorWidth, setInspectorWidth] = useState<number>(readInitialInspectorWidth);
  const [inspectorResizing, setInspectorResizing] = useState(false);


  // Fix View State
  const [fixFilter, setFixFilter] = useState<FixFilter>({
    missingAuthor: true,
    missingTitle: true,
    missingCover: true,
    missingIsbn: false,
    missingYear: false,
    missingLanguage: false,
    missingSeries: false,
    missingDescription: false,
    includeIssues: true,
  });
  const [selectedFixItemId, setSelectedFixItemId] = useState<string | null>(null);
  const [fixSearchQuery, setFixSearchQuery] = useState("");
  const fixSearchRequestIdRef = useRef(0);
  const [tags, setTags] = useState<Tag[]>([]);
  const [newTagName, setNewTagName] = useState("");
  const [newTagColor, setNewTagColor] = useState(TAG_COLORS[0].value);

  // Navigation filter states (for linking from Authors/Series views)
  const [selectedAuthorNames, setSelectedAuthorNames] = useState<string[]>([]);
  const [selectedSeries, setSelectedSeries] = useState<string[]>([]);
  const [selectedGenres, setSelectedGenres] = useState<string[]>([]);
  const operations = useOperationCoordinator();

  const setViewWithTransition = useCallback<Dispatch<SetStateAction<View>>>(
    (nextView) => {
      const resolvedView =
        typeof nextView === "function"
          ? (nextView as (previous: View) => View)(view)
          : nextView;
      if (resolvedView === view) return;

      const scrollContainer = mainScrollRef.current;
      if (scrollContainer) {
        savedScrollByViewRef.current[view] = scrollContainer.scrollTop;
      }

      // Restore previous scroll position for views that were already visited.
      const editReturnTarget = editReturnScrollRef.current;
      if (
        view === "edit" &&
        editReturnTarget &&
        editReturnTarget.view === resolvedView
      ) {
        pendingScrollRestoreRef.current = {
          view: resolvedView,
          top: editReturnTarget.top,
        };
      } else {
        const savedTop = savedScrollByViewRef.current[resolvedView];
        if (typeof savedTop === "number") {
          pendingScrollRestoreRef.current = { view: resolvedView, top: savedTop };
        } else {
          pendingScrollRestoreRef.current = null;
        }
      }
      if (view !== "edit") {
        editReturnScrollRef.current = null;
      }

      setPendingView(resolvedView);
      startViewTransition(() => {
        setView(resolvedView);
      });
    },
    [startViewTransition, view]
  );

  const restoreScrollPosition = useCallback((top: number) => {
    const scrollContainer = mainScrollRef.current;
    if (!scrollContainer) return;
    if (typeof window === "undefined") {
      scrollContainer.scrollTo({ top, behavior: "auto" });
      return;
    }

    if (scrollRestoreRafRef.current !== null) {
      window.cancelAnimationFrame(scrollRestoreRafRef.current);
      scrollRestoreRafRef.current = null;
    }

    const maxAttempts = 18;
    let attempts = 0;
    const run = () => {
      const container = mainScrollRef.current;
      if (!container) return;
      container.scrollTo({ top, behavior: "auto" });
      attempts += 1;

      const maxScrollableTop = Math.max(0, container.scrollHeight - container.clientHeight);
      const reachedTarget = Math.abs(container.scrollTop - top) <= 2;
      const targetIsReachable = maxScrollableTop >= top - 2;
      if (reachedTarget || (targetIsReachable && attempts >= 2) || attempts >= maxAttempts) {
        scrollRestoreRafRef.current = null;
        return;
      }
      scrollRestoreRafRef.current = window.requestAnimationFrame(run);
    };

    scrollRestoreRafRef.current = window.requestAnimationFrame(run);
  }, []);

  const isDesktop =
    isTauri() ||
    (typeof window !== "undefined" &&
      Boolean((window as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__));

  const {
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
  } = useLibraryData({ setScanStatus });

  const {
    scanning,
    scanStartedAt,
    scanProgress,
    currentTimeMs,
    enriching,
    enrichingItems,
    enrichProgress,
    handleScan,
    handleEnrichAll,
    handleCancelEnrich,
    handleImportCancel,
    handleImportStart,
  } = useLibraryOperations({
    operations,
    setScanStatus,
    setActivityLog,
    refreshLibrary,
    setViewWithTransition,
  });

  const {
    coverOverrides,
    fetchCoverOverride,
    clearCoverOverride,
    refreshCoverForItem,
    handleVisibleItemIdsChange,
  } = useCoverOverrides({
    isDesktop,
    libraryItems,
  });

  const {
    appVersion,
    updateStatus,
    updateAvailable,
    updateVersion,
    checkForUpdates,
  } = useUpdater({ isDesktop });

  const { themeMode, setThemeMode } = useTheme();

  const {
    organizePlan,
    organizeStatus,
    organizeProgress,
    organizing,
    organizeLog,
    organizeMode,
    setOrganizeMode,
    organizeRoot,
    setOrganizeRoot,
    organizeTemplate,
    setOrganizeTemplate,
    handlePlanOrganize,
    handleApplyOrganize,
  } = useOrganizer({ isDesktop, operations });

  const {
    ereaderDevices,
    selectedEreaderDeviceId,
    setSelectedEreaderDeviceId,
    ereaderBooks,
    ereaderSyncQueue,
    ereaderScanning,
    ereaderScanProgress,
    ereaderSyncDialogOpen,
    setEreaderSyncDialogOpen,
    ereaderSyncing,
    ereaderSyncProgress,
    refreshDevices: refreshEreaderDevices,
    handleAddEreaderDevice,
    handleRemoveEreaderDevice,
    handleScanEreaderDevice,
    handleQueueEreaderAdd,
    handleQueueEreaderRemove,
    handleQueueEreaderImport,
    handleQueueEreaderUpdate,
    handleExecuteEreaderSync,
  } = useEreader({
    isDesktop,
    refreshLibrary,
    setScanStatus,
    setActivityLog,
  });

  const changesFeature = useChangesFeature({
    enabled: isDesktop,
    active: view === "changes",
    refreshSignal: ereaderSyncQueue,
    refreshLibrary,
    reportStatus: setScanStatus,
  });
  const pendingChangesCount = changesFeature.pendingCount;
  const refreshPendingChanges = changesFeature.refreshPending;

  const {
    uniqueAuthors,
    uniqueSeries,
    uniqueCategories,
    fixIssues,
    allFixItems,
    allBooks,
    sortedBooks,
    selectedItem,
    selectedTags,
    availableTags,
    availableLanguages,
    scanEtaLabel,
  } = useLibrarySelectors({
    libraryItems,
    coverOverrides,
    fixFilter,
    inbox,
    titleCleanupIgnoreMap,
    libraryFilter,
    selectedTagIds,
    selectedAuthorNames,
    selectedSeries,
    selectedGenres,
    query,
    isDesktop,
    sampleBooks,
    librarySort,
    tags,
    selectedItemId,
    scanProgress,
    scanStartedAt,
    currentTimeMs,
  });

  useEffect(() => {
    const visibleIds = new Set(sortedBooks.map((item) => item.id));
    setSelectedBatchItemIds((previous) => {
      if (previous.size === 0) return previous;
      const next = new Set(
        Array.from(previous).filter((itemId) => visibleIds.has(itemId))
      );
      return next.size === previous.size ? previous : next;
    });
  }, [sortedBooks]);

  useEffect(() => {
    if (view === "library" || view === "library-books") return;
    setSelectedBatchItemIds(new Set());
  }, [view]);

  const handleToggleBatchSelection = useCallback((itemId: string) => {
    setSelectedBatchItemIds((previous) => {
      const next = new Set(previous);
      if (next.has(itemId)) {
        next.delete(itemId);
      } else {
        next.add(itemId);
      }
      return next;
    });
  }, []);

  const handleSetBatchSelection = useCallback((itemIds: string[]) => {
    setSelectedBatchItemIds(new Set(itemIds));
  }, []);

  const handleClearBatchSelection = useCallback(() => {
    setSelectedBatchItemIds(new Set());
  }, []);

  const refreshTags = useCallback(async () => {
    if (!isTauri()) {
      setTags(sampleTags);
      return;
    }
    try {
      const result = await invoke<Tag[]>("list_tags");
      setTags(result);
    } catch {
      setTags([]);
    }
  }, []);

  useEffect(() => {
    if (!isDesktop) return;
    void refreshTags();
  }, [isDesktop, refreshTags]);

  const handleCreateTag = useCallback(async () => {
    const name = newTagName.trim();
    if (!name) return;
    if (!isTauri()) {
      setTags((prev) => [
        ...prev,
        { id: `local-${Date.now()}`, name, color: newTagColor },
      ]);
      setNewTagName("");
      return;
    }
    try {
      await invoke<Tag>("create_tag", { name, color: newTagColor });
      setNewTagName("");
      await refreshTags();
    } catch {
      return;
    }
  }, [newTagName, newTagColor, refreshTags]);

  const handleUpdateTag = useCallback(async (tagId: string, name: string, color: string) => {
    if (!isTauri()) return;
    const trimmed = name.trim();
    if (!trimmed) return;
    try {
      await invoke<Tag>("update_tag", { tagId, name: trimmed, color });
      await refreshTags();
      setScanStatus("Tag updated.");
    } catch (error) {
      console.error("Failed to update tag", error);
      const message = error instanceof Error ? error.message : String(error);
      setScanStatus(`Could not update tag: ${message}`);
    }
  }, [refreshTags]);

  const runLibraryMutationPipeline = useCallback(
    async <T,>(
      mutation: () => Promise<T>,
      options?: {
        refreshCoverItemId?: string | null;
        refreshLibrary?: boolean | ((result: T) => boolean);
        refreshPendingChanges?: boolean | ((result: T) => boolean);
      }
    ): Promise<{ result: T; pendingChangesCount: number }> => {
      const result = await mutation();

      const shouldRefreshLibrary =
        typeof options?.refreshLibrary === "function"
          ? options.refreshLibrary(result)
          : options?.refreshLibrary ?? true;
      if (options?.refreshCoverItemId) {
        await refreshCoverForItem(options.refreshCoverItemId);
      }
      if (shouldRefreshLibrary) {
        await refreshLibrary();
      }

      const shouldRefreshPendingChanges =
        typeof options?.refreshPendingChanges === "function"
          ? options.refreshPendingChanges(result)
          : options?.refreshPendingChanges ?? false;
      const pendingChangesCount = shouldRefreshPendingChanges
        ? await refreshPendingChanges()
        : 0;

      return { result, pendingChangesCount };
    },
    [refreshCoverForItem, refreshLibrary, refreshPendingChanges]
  );

  const {
    fixLoading,
    editMatchLoading,
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
  } = useMetadataActions({
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
  });

  const handleAddTag = useCallback(
    async (tagId: string) => {
      if (!selectedItemId) return;
      if (!isTauri()) return;
      try {
        const { pendingChangesCount } = await runLibraryMutationPipeline(
          () => invoke("add_tag_to_item", { itemId: selectedItemId, tagId }),
          { refreshPendingChanges: true }
        );
        setScanStatus(
          pendingChangesCount > 0
            ? "Tag updated in library. Change queued in Changes."
            : "Tag updated."
        );
      } catch {
        return;
      }
    },
    [runLibraryMutationPipeline, selectedItemId]
  );

  const handleRemoveTag = useCallback(
    async (tagId: string) => {
      if (!selectedItemId) return;
      if (!isTauri()) return;
      try {
        const { pendingChangesCount } = await runLibraryMutationPipeline(
          () => invoke("remove_tag_from_item", { itemId: selectedItemId, tagId }),
          { refreshPendingChanges: true }
        );
        setScanStatus(
          pendingChangesCount > 0
            ? "Tag updated in library. Change queued in Changes."
            : "Tag updated."
        );
      } catch {
        return;
      }
    },
    [runLibraryMutationPipeline, selectedItemId]
  );

  const handleClearLibrary = async () => {
    if (!isTauri()) {
      setScanStatus("Clear requires the Tauri desktop runtime.");
      return;
    }
    const ok = await confirm(
      "This will delete all items, files, and metadata from Folio. Your book files are not deleted. Continue?",
      {
        title: "Clear Library",
        kind: "warning",
      }
    );
    if (!ok) return;
    try {
      await invoke("clear_library");
      setScanStatus("Library cleared.");
      resetLibraryState();
      await refreshLibrary();
    } catch (error) {
      if (error instanceof Error) {
        setScanStatus(`Could not clear library: ${error.message}`);
      } else {
        setScanStatus("Could not clear library.");
      }
    }
  };

  const {
    normalizingDescriptions,
    batchFixingTitles,
    metadataSources,
    metadataSourcesSaving,
    handleNormalizeDescriptions,
    handleBatchFixTitles,
    handleSetMetadataSourceEnabled,
  } = useMetadataSettings({
    initialMetadataSources: DEFAULT_METADATA_SOURCES,
    operations,
    setScanStatus,
    runLibraryMutationPipeline,
  });

  const handleChooseRoot = async () => {
    if (!isTauri()) return;
    const selection: string | string[] | null = await open({
      directory: true,
      multiple: false,
    });
    if (typeof selection !== "string") return;
    setOrganizeRoot(selection);
  };

  const {
    duplicateKeepSelection,
    setDuplicateKeepSelection,
    handleRelinkMissing,
    handleRemoveMissing,
    handleRemoveAllMissing,
    handleRescanMissing,
    handleResolveDuplicate,
    handleAutoSelectDuplicates,
    handleResolveAllDuplicates,
  } = useLibraryIssueHandlers({
    organizeRoot,
    setOrganizeRoot,
    refreshLibrary,
    refreshPendingChanges,
    runLibraryMutationPipeline,
    setScanStatus,
  });

  useOperationEventListeners({
    isDesktop,
    setScanStatus,
    handleScan,
    setActivityLog,
  });

  const handleQueueRemoveItem = useCallback(async (itemId: string) => {
    if (!isTauri()) return;
    setScanStatus("Removing book from library...");
    try {
      const queued = await invoke<number>("queue_remove_item", { itemId });
      await refreshLibrary();
      await refreshPendingChanges();
      setScanStatus(
        queued > 0
          ? `Book removed from library. ${queued} file delete change(s) queued in Changes.`
          : "Book removed from library."
      );
    } catch (error) {
      const message =
        error instanceof Error ? error.message : String(error ?? "Could not remove book.");
      setScanStatus(`Could not remove book: ${message}`);
    }
  }, [refreshLibrary, refreshPendingChanges]);

  const handleBatchRemoveItems = useCallback(
    async (itemIds: string[]) => {
      if (!isTauri() || itemIds.length === 0) return false;
      const count = itemIds.length;
      const noun = count === 1 ? "book" : "books";
      const confirmed = await confirm(
        `Remove ${count} ${noun} from your library? This queues file deletes in Changes. Files are only deleted after Apply in Changes.`,
        {
          title: "Remove selected books",
          kind: "warning",
        }
      );
      if (!confirmed) {
        return false;
      }

      setScanStatus(`Removing ${count} selected ${noun} from library...`);
      try {
        const { result: queued } = await runLibraryMutationPipeline(
          () => invoke<number>("queue_remove_items", { itemIds }),
          {
            refreshLibrary: true,
            refreshPendingChanges: true,
          }
        );
        setSelectedBatchItemIds(new Set());
        setSelectedItemId((previous) =>
          previous && itemIds.includes(previous) ? null : previous
        );
        setScanStatus(
          queued > 0
            ? `Removed ${count} ${noun}. ${queued} file delete change(s) queued in Changes.`
            : `Removed ${count} ${noun} from library.`
        );
        return true;
      } catch (error) {
        const message =
          error instanceof Error
            ? error.message
            : String(error ?? "Could not remove selected books.");
        setScanStatus(`Could not remove selected books: ${message}`);
        return false;
      }
    },
    [runLibraryMutationPipeline]
  );

  const handleRefreshItemAndChanges = useCallback(async () => {
    await refreshLibrary();
    await refreshPendingChanges();
  }, [refreshLibrary, refreshPendingChanges]);

  useEffect(() => {
    if (view !== "edit") return;
    if (!selectedItemId) return;
    setEditMatchQuery(selectedItem?.title ?? "");
    void loadEditMatchCandidates(selectedItemId);
  }, [view, selectedItemId, selectedItem?.title, loadEditMatchCandidates]);

  const handleOpenSyncDialog = () => {
    setEreaderSyncDialogOpen(true);
  };

  const handleOpenChangesFromEreader = useCallback(() => {
    setEreaderSyncDialogOpen(false);
    changesFeature.openForDevice(selectedEreaderDeviceId);
    setViewWithTransition("changes");
  }, [changesFeature, selectedEreaderDeviceId, setEreaderSyncDialogOpen, setViewWithTransition]);

  const duplicateActionCount = useMemo(() => {
    const actionableHash = duplicates.filter((group) => {
      const titles = group.file_titles.length ? group.file_titles : [group.title];
      const normalized = titles.map((title) => title.trim().toLowerCase());
      return new Set(normalized).size <= 1;
    }).length;
    return actionableHash + titleDuplicates.length + fuzzyDuplicates.length;
  }, [duplicates, titleDuplicates, fuzzyDuplicates]);

  const fixActionCount = useMemo(() => {
    const missingMetadataIds = new Set(
      libraryItems
        .filter((item) => !item.title || item.authors.length === 0 || !item.cover_path)
        .map((item) => item.id)
    );
    fixIssues.forEach((issue) => {
      missingMetadataIds.add(issue.id);
    });
    return missingMetadataIds.size;
  }, [libraryItems, fixIssues]);

  const ereaderPendingCount = useMemo(
    () => ereaderSyncQueue.filter((item) => item.status === "pending").length,
    [ereaderSyncQueue]
  );

  useLayoutEffect(() => {
    const scrollContainer = mainScrollRef.current;
    if (!scrollContainer) return;
    const pendingRestore = pendingScrollRestoreRef.current;
    if (pendingRestore && pendingRestore.view === view) {
      restoreScrollPosition(pendingRestore.top);
      pendingScrollRestoreRef.current = null;
      if (editReturnScrollRef.current?.view === view) {
        editReturnScrollRef.current = null;
      }
      return;
    }
    scrollContainer.scrollTo({ top: 0, behavior: "auto" });
  }, [restoreScrollPosition, view]);

  useEffect(() => {
    return () => {
      if (typeof window === "undefined") return;
      if (scrollRestoreRafRef.current !== null) {
        window.cancelAnimationFrame(scrollRestoreRafRef.current);
        scrollRestoreRafRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (pendingView === view) {
      setPendingView(null);
    }
  }, [pendingView, view]);

  useEffect(() => {
    // Safety net: prevent ending up on Edit without a selected item (blank content state).
    if (view === "edit" && !selectedItemId) {
      setView("library-books");
    }
  }, [view, selectedItemId]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem("folio.inspectorWidth", String(inspectorWidth));
  }, [inspectorWidth]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(LIBRARY_SORT_STORAGE_KEY, librarySort);
    window.sessionStorage.removeItem(LIBRARY_SORT_LEGACY_SESSION_KEY);
  }, [librarySort]);

  useEffect(() => {
    if (!inspectorResizing || typeof window === "undefined") return;

    const handleMouseMove = (event: MouseEvent) => {
      const nextWidth = Math.min(560, Math.max(260, Math.round(window.innerWidth - event.clientX)));
      setInspectorWidth(nextWidth);
    };

    const handleMouseUp = () => {
      setInspectorResizing(false);
    };

    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);

    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
  }, [inspectorResizing]);

  return (
    <div
      className="grid h-screen overflow-hidden bg-[var(--app-bg)] text-[var(--app-ink)]"
      style={
        view === "library" ||
          view === "library-books" ||
          view === "library-authors" ||
          view === "library-series" ||
          view === "library-categories"
          ? { gridTemplateColumns: `210px minmax(0,1fr) ${inspectorWidth}px` }
          : { gridTemplateColumns: "210px minmax(0,1fr)" }
      }
    >
      <Sidebar
        view={view}
        setView={setViewWithTransition}
        scanning={scanning}
        operationsBusy={operations.isBusy}
        handleScan={() => setViewWithTransition("import")}
        libraryHealth={libraryHealth}
        pendingChangesCount={pendingChangesCount}
        duplicateCount={duplicateActionCount}
        missingFilesCount={missingFiles.length}
        fixActionCount={fixActionCount}
        ereaderPendingCount={ereaderPendingCount}
        handleClearLibrary={() => void handleClearLibrary()}
        appVersion={appVersion}
        ereaderConnected={ereaderDevices.some((d) => d.isConnected)}
        navigationPending={isViewTransitionPending}
        pendingView={pendingView}
      />

      <main className="flex h-screen min-h-0 flex-col px-6 py-4">
        <div
          ref={mainScrollRef}
          className={`flex min-h-0 flex-1 flex-col gap-4 ${view === "ereader" ? "overflow-hidden" : "overflow-y-auto pr-2 scrollbar-gutter-stable"}`}
        >
          {view !== "edit" && (
            <TopToolbar
              view={view}
              checkForUpdates={(silent) => void checkForUpdates(silent)}
              query={queryInput}
              setQuery={setQueryInput}
              grid={grid}
              setGrid={setGrid}
              libraryReady={libraryReady}
              updateStatus={updateStatus}
              updateAvailable={updateAvailable}
              updateVersion={updateVersion}
              scanStatus={scanStatus}
              operationProgress={
                operations.state.status === "running" || operations.state.status === "cancelling"
                  ? operations.state.progress
                  : null
              }
              activityLog={activityLog}
            />
          )}

          <OperationStatusPanel
            state={operations.state}
            etaLabel={operations.isRunning("scan") ? scanEtaLabel : null}
            onCancel={
              (operations.state.status === "running" || operations.state.status === "cancelling") &&
              operations.state.kind === "enrich"
                ? handleCancelEnrich
                : undefined
            }
            onDismiss={operations.reset}
          />
          <fieldset
            disabled={operations.isBusy}
            className="flex min-h-0 flex-1 flex-col gap-4 border-0 p-0"
          >
            <AppRoutes
              view={view}
              setView={setViewWithTransition}
              isDesktop={isDesktop}
              library={{
                libraryReady,
                libraryItemsLength: libraryItems.length,
                sortedBooks,
                allBooks,
                selectedItemId,
                selectedBatchItemIds,
                setSelectedItemId,
                onToggleBatchSelect: handleToggleBatchSelection,
                onSetBatchSelection: handleSetBatchSelection,
                onClearBatchSelection: handleClearBatchSelection,
                onApplyBatchMetadata: handleApplyBatchMetadata,
                onRemoveSelectedBooks: handleBatchRemoveItems,
                libraryFilter,
                setLibraryFilter,
                librarySort,
                setLibrarySort,
                tags,
                selectedTagIds,
                setSelectedTagIds,
                grid,
                setGrid,
                fetchCoverOverride,
                clearCoverOverride,
                onVisibleItemIdsChange: handleVisibleItemIdsChange,
                scrollContainerRef: mainScrollRef,
                selectedAuthorNames,
                setSelectedAuthorNames,
                selectedSeries,
                setSelectedSeries,
                selectedGenres,
                setSelectedGenres,
                enrichingItems,
                uniqueAuthors,
                uniqueSeries,
                uniqueCategories,
                libraryItems,
              }}
              enrich={{
                onEnrichAll: handleEnrichAll,
                onCancelEnrich: handleCancelEnrich,
                enriching,
                enrichProgress,
              }}
              inbox={{
                inbox,
                sampleInboxItems,
              }}
              duplicates={{
                duplicates,
                sampleDuplicateGroups,
                titleDuplicates,
                fuzzyDuplicates,
                duplicateKeepSelection,
                setDuplicateKeepSelection,
                handleResolveDuplicate,
                handleAutoSelectAll: handleAutoSelectDuplicates,
                handleResolveAll: handleResolveAllDuplicates,
              }}
              fix={{
                allFixItems,
                fixIssues,
                selectedFixItemId,
                setSelectedFixItemId,
                fixFilter,
                setFixFilter,
                fixSearchQuery,
                setFixSearchQuery,
                fixLoading,
                fixCandidates,
                fixCoverUrl: selectedFixItemId ? coverOverrides[selectedFixItemId] : null,
                onFetchFixCover: fetchCoverOverride,
                onSearchFixWithQuery: handleSearchFixWithQuery,
                onApplyFixCandidate: handleApplyFixCandidate,
                onSaveFixMetadata: handleSaveFixMetadata,
                fixApplyingCandidateId,
                getCandidateCoverUrl,
                onItemUpdate: handleRefreshItemAndChanges,
                onQueueRemoveItem: handleQueueRemoveItem,
              }}
              changes={changesFeature.view}
              organizer={{
                organizeMode,
                setOrganizeMode,
                organizeRoot,
                organizeTemplate,
                setOrganizeTemplate,
                organizePlan,
                handlePlanOrganize,
                handleApplyOrganize,
                organizeStatus,
                organizeProgress,
                organizing,
                organizeLog,
                onImportCancel: handleImportCancel,
                onImportStart: handleImportStart,
              }}
              settings={{
                onChooseRoot: handleChooseRoot,
                onNormalizeDescriptions: handleNormalizeDescriptions,
                normalizingDescriptions,
                onBatchFixTitles: handleBatchFixTitles,
                batchFixingTitles,
                metadataSources,
                onSetMetadataSourceEnabled: handleSetMetadataSourceEnabled,
                metadataSourcesSaving,
                themeMode,
                setThemeMode,
              }}
              missingFiles={{
                missingFiles,
                onRelinkMissing: handleRelinkMissing,
                onRemoveMissing: handleRemoveMissing,
                onRemoveAllMissing: handleRemoveAllMissing,
                onRescanMissing: handleRescanMissing,
              }}
              edit={{
                previousView,
                onItemUpdate: handleRefreshItemAndChanges,
                editCoverUrl: selectedItemId ? coverOverrides[selectedItemId] : null,
                detailsVersion: editDetailsVersion,
                matchQuery: editMatchQuery,
                onMatchQueryChange: setEditMatchQuery,
                matchLoading: editMatchLoading,
                matchCandidates: editMatchCandidates,
                onMatchSearch: handleEditMatchSearch,
                onMatchApply: handleEditMatchApply,
                matchApplyingId: editMatchApplying,
                onQueueRemoveItem: handleQueueRemoveItem,
                getCandidateCoverUrl,
              }}
              tags={{
                tags,
                newTagName,
                setNewTagName,
                newTagColor,
                setNewTagColor,
                handleCreateTag,
                handleUpdateTag,
              }}
              ereader={{
                ereaderDevices,
                selectedEreaderDeviceId,
                setSelectedEreaderDeviceId,
                ereaderBooks,
                ereaderSyncQueue,
                onAddEreaderDevice: handleAddEreaderDevice,
                onRemoveEreaderDevice: handleRemoveEreaderDevice,
                onScanEreaderDevice: handleScanEreaderDevice,
                onQueueEreaderAdd: handleQueueEreaderAdd,
                onQueueEreaderRemove: handleQueueEreaderRemove,
                onQueueEreaderImport: handleQueueEreaderImport,
                onQueueEreaderUpdate: handleQueueEreaderUpdate,
                onExecuteSync: handleOpenSyncDialog,
                onOpenChangesFromEreader: handleOpenChangesFromEreader,
                onRefreshDevices: async () => {
                  await refreshEreaderDevices();
                },
                ereaderScanning,
                ereaderScanProgress,
                ereaderSyncing,
                ereaderSyncProgress,
              }}
            />
          </fieldset>
        </div>

        <SyncConfirmDialog
          open={ereaderSyncDialogOpen}
          onClose={() => setEreaderSyncDialogOpen(false)}
          onConfirm={() => void handleExecuteEreaderSync()}
          onOpenChanges={handleOpenChangesFromEreader}
          deviceName={ereaderDevices.find((d) => d.id === selectedEreaderDeviceId)?.name ?? "eReader"}
          queue={ereaderSyncQueue}
          libraryItems={libraryItems}
          syncing={ereaderSyncing}
          syncProgress={ereaderSyncProgress}
        />

        <div className="pt-3">
          <StatusBar
            scanStatus={scanStatus}
            updateStatus={updateStatus}
            isDesktop={isDesktop}
            appVersion={appVersion}
          />
        </div>
      </main>

      {(view === "library" ||
        view === "library-books" ||
        view === "library-authors" ||
        view === "library-series" ||
        view === "library-categories") ? (
        <div className="relative h-screen">
          <div
            className="absolute left-0 top-0 z-20 h-full w-1.5 -translate-x-1/2 cursor-col-resize bg-transparent transition-colors hover:bg-[var(--app-accent)]/30"
            onMouseDown={(event) => {
              event.preventDefault();
              setInspectorResizing(true);
            }}
          />
          <Inspector
            allBooks={allBooks}
            selectedItem={selectedItem}
            availableLanguages={availableLanguages}
            selectedTags={selectedTags}
            availableTags={availableTags}
            handleAddTag={(tagId) => void handleAddTag(tagId)}
            handleRemoveTag={(tagId) => void handleRemoveTag(tagId)}
            clearCoverOverride={clearCoverOverride}
            fetchCoverOverride={(itemId) => void fetchCoverOverride(itemId)}
            setView={setViewWithTransition}
            selectedAuthorNames={selectedAuthorNames}
            setSelectedAuthorNames={setSelectedAuthorNames}
            setSelectedSeries={setSelectedSeries}
            setSelectedGenres={setSelectedGenres}
            ereaderConnected={ereaderDevices.some((d) => d.isConnected)}
            ereaderSyncStatus={selectedItem ? (() => {
              const onDevice = ereaderBooks.find((eb) => eb.matchedItemId === selectedItem.id);
              const inQueue = ereaderSyncQueue.some((q) => q.itemId === selectedItem.id && q.status === "pending");
              return {
                isOnDevice: !!onDevice,
                isInQueue: inQueue,
                matchConfidence: (onDevice?.matchConfidence as "exact" | "isbn" | "title" | "fuzzy" | null) ?? null,
              };
            })() : null}
            onQueueEreaderAdd={(itemId) => void handleQueueEreaderAdd(itemId)}
            onNavigateToEdit={() => {
              const currentTop = mainScrollRef.current?.scrollTop ?? 0;
              editReturnScrollRef.current = { view, top: currentTop };
              setPreviousView(view);
              setViewWithTransition("edit");
            }}
            width={inspectorWidth}
          />
        </div>
      ) : null}
    </div>
  );
}

export default App;
