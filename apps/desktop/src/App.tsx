import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { ProgressBar, ScanProgressBar } from "./components/ProgressBar";
import { SyncConfirmDialog } from "./components/SyncConfirmDialog";
import { useDebouncedValue } from "./hooks/useDebouncedValue";
import { useEreader } from "./hooks/useEreader";
import { useLibraryData } from "./hooks/useLibraryData";
import { useLibrarySelectors } from "./hooks/useLibrarySelectors";
import { useOrganizer } from "./hooks/useOrganizer";
import { useTheme } from "./hooks/useTheme";
import { useUpdater } from "./hooks/useUpdater";
import {
  sampleBooks,
  sampleDuplicateGroups,
  sampleFixCandidates,
  sampleInboxItems,
  sampleTags,
} from "./lib/sampleData";
import { TAG_COLORS } from "./lib/tagColors";
import { AppRoutes } from "./sections/AppRoutes";
import { Inspector } from "./sections/Inspector";
import { Sidebar } from "./sections/Sidebar";
import { StatusBar } from "./sections/StatusBar";
import { TopToolbar } from "./sections/TopToolbar";
import type {
  ActivityLogItem,
  ApplyMetadataProgress,
  BatchMetadataUpdatePayload,
  BatchMetadataUpdateResult,
  DuplicateGroup,
  EnrichmentCandidate,
  FixFilter,
  ImportRequest,
  ItemMetadata,
  LibraryFilter,
  LibrarySort,
  MetadataLookupSettings,
  MetadataSourceSetting,
  OperationProgress,
  OperationStats,
  PendingChange,
  ScanProgress,
  ScanStats,
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

function App() {
  const readInitialInspectorWidth = () => {
    if (typeof window === "undefined") return 320;
    const raw = window.localStorage.getItem("folio.inspectorWidth");
    const parsed = raw ? Number.parseInt(raw, 10) : NaN;
    if (!Number.isFinite(parsed)) return 320;
    return Math.min(460, Math.max(260, parsed));
  };
  const [view, setView] = useState<View>("library-books");
  const [previousView, setPreviousView] = useState<View>("library-books");
  const [activityLog, setActivityLog] = useState<ActivityLogItem[]>([]); // New State
  const [grid, setGrid] = useState(true);
  const [queryInput, setQueryInput] = useState("");
  const debouncedQuery = useDebouncedValue(queryInput, 180);
  const query = useDeferredValue(debouncedQuery);
  const [libraryFilter, setLibraryFilter] = useState<LibraryFilter>("all");
  const [librarySort, setLibrarySort] = useState<LibrarySort>("default");
  const [selectedTagIds, setSelectedTagIds] = useState<string[]>([]);
  const [scanStatus, setScanStatus] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  const [scanStartedAt, setScanStartedAt] = useState<number | null>(null);
  const [scanProgress, setScanProgress] = useState<ScanProgress | null>(null);
  const [currentTimeMs, setCurrentTimeMs] = useState(() => Date.now());
  const [enriching, setEnriching] = useState(false);
  const [enrichingItems, setEnrichingItems] = useState<Set<string>>(new Set());
  const [enrichProgress, setEnrichProgress] = useState<OperationProgress | null>(null);
  const [fixCandidates, setFixCandidates] = useState<EnrichmentCandidate[]>([]);
  const [fixLoading, setFixLoading] = useState(false);
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const [selectedBatchItemIds, setSelectedBatchItemIds] = useState<Set<string>>(new Set());
  const [editMatchQuery, setEditMatchQuery] = useState("");
  const [editMatchLoading, setEditMatchLoading] = useState(false);
  const [editMatchCandidates, setEditMatchCandidates] = useState<EnrichmentCandidate[]>([]);
  const [editMatchApplying, setEditMatchApplying] = useState<string | null>(null);
  const [editDetailsVersion, setEditDetailsVersion] = useState(0);
  const mainScrollRef = useRef<HTMLElement | null>(null);
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
  const [fixApplyingCandidateId, setFixApplyingCandidateId] = useState<string | null>(null);
  const fixSearchRequestIdRef = useRef(0);
  const [coverOverrides, setCoverOverrides] = useState<Record<string, string | null>>({});
  const coverOverrideRef = useRef<Record<string, string | null>>({});
  const coverFetchQueueRef = useRef<string[]>([]);
  const queuedCoverFetchesRef = useRef<Set<string>>(new Set());
  const inFlightCoverFetchesRef = useRef<Set<string>>(new Set());
  const activeCoverFetchesRef = useRef(0);
  const [duplicateKeepSelection, setDuplicateKeepSelection] = useState<
    Record<string, string>
  >({});
  const [pendingChanges, setPendingChanges] = useState<PendingChange[]>([]);
  const [pendingChangesCount, setPendingChangesCount] = useState(0);
  const [pendingChangesLoading, setPendingChangesLoading] = useState(false);
  const [pendingChangesApplying, setPendingChangesApplying] = useState(false);
  const [pendingChangesStatus, setPendingChangesStatus] = useState<
    "pending" | "applied" | "error"
  >("pending");
  const pendingChangesStatusRef = useRef<"pending" | "applied" | "error">("pending");
  const [applyingChangeIds, setApplyingChangeIds] = useState<Set<string>>(new Set());
  const [changeProgress, setChangeProgress] = useState<OperationProgress | null>(null);
  const [importProgress, setImportProgress] = useState<OperationProgress | null>(null);
  const [importingBooks, setImportingBooks] = useState(false);
  const [normalizingDescriptions, setNormalizingDescriptions] = useState(false);
  const [batchFixingTitles, setBatchFixingTitles] = useState(false);
  const [metadataSources, setMetadataSources] =
    useState<MetadataSourceSetting[]>(DEFAULT_METADATA_SOURCES);
  const [metadataSourcesSaving, setMetadataSourcesSaving] = useState(false);
  const [tags, setTags] = useState<Tag[]>([]);
  const [newTagName, setNewTagName] = useState("");
  const [newTagColor, setNewTagColor] = useState(TAG_COLORS[0].value);
  const [selectedChangeIds, setSelectedChangeIds] = useState<Set<string>>(
    new Set()
  );
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const [confirmDeleteIds, setConfirmDeleteIds] = useState<string[]>([]);

  // Navigation filter states (for linking from Authors/Series views)
  const [selectedAuthorNames, setSelectedAuthorNames] = useState<string[]>([]);
  const [selectedSeries, setSelectedSeries] = useState<string[]>([]);
  const [selectedGenres, setSelectedGenres] = useState<string[]>([]);

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
  } = useOrganizer({ isDesktop });

  const {
    ereaderDevices,
    selectedEreaderDeviceId,
    setSelectedEreaderDeviceId,
    ereaderBooks,
    ereaderSyncQueue,
    ereaderScanning,
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
    handleRemoveFromEreaderQueue,
    handleExecuteEreaderSync,
  } = useEreader({
    isDesktop,
    refreshLibrary,
    setScanStatus,
    setActivityLog,
  });

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
  const libraryItemsById = useMemo(
    () => new Map(libraryItems.map((item) => [item.id, item])),
    [libraryItems]
  );

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

  useEffect(() => {
    pendingChangesStatusRef.current = pendingChangesStatus;
  }, [pendingChangesStatus]);

  const refreshPendingChanges = useCallback(async () => {
    if (!isTauri()) return 0;
    try {
      const result = await invoke<PendingChange[]>("get_pending_changes", {
        status: "pending",
      });
      setPendingChangesCount(result.length);
      if (pendingChangesStatus === "pending") {
        setPendingChanges(result);
      }
      return result.length;
    } catch {
      return 0;
    }
  }, [pendingChangesStatus]);

  useEffect(() => {
    if (!isDesktop) return;
    void refreshPendingChanges();
  }, [isDesktop, refreshPendingChanges]);

  const toggleChangeSelection = (id: string) => {
    setSelectedChangeIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const clearChangeSelection = () => {
    setSelectedChangeIds(new Set());
  };

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

  const fetchCoverOverride = useCallback(async (itemId: string, force = false) => {
    if (!isTauri()) return;
    if (!force && typeof coverOverrideRef.current[itemId] === "string") return;
    try {
      const result = await invoke<{ mime: string; bytes: number[] } | null>(
        "get_cover_blob",
        { itemId }
      );
      if (!result) return;
      const blob = new Blob([new Uint8Array(result.bytes)], { type: result.mime });
      const url = URL.createObjectURL(blob);
      setCoverOverrides((prev) => {
        const next = { ...prev, [itemId]: url };
        const previous = prev[itemId];
        if (previous) URL.revokeObjectURL(previous);
        coverOverrideRef.current = next;
        return next;
      });
    } catch {
      return;
    }
  }, []);

  const clearCoverOverride = useCallback((itemId: string) => {
    setCoverOverrides((prev) => {
      const next = { ...prev, [itemId]: null };
      const previous = prev[itemId];
      if (previous) URL.revokeObjectURL(previous);
      coverOverrideRef.current = next;
      return next;
    });
  }, []);

  const refreshCoverForItem = useCallback(
    async (itemId: string) => {
      clearCoverOverride(itemId);
      await fetchCoverOverride(itemId, true);
    },
    [clearCoverOverride, fetchCoverOverride]
  );

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

  const drainVisibleCoverQueue = useCallback(() => {
    if (!isTauri()) return;
    const maxConcurrent = 4;
    while (
      activeCoverFetchesRef.current < maxConcurrent &&
      coverFetchQueueRef.current.length > 0
    ) {
      const itemId = coverFetchQueueRef.current.shift();
      if (!itemId) break;
      queuedCoverFetchesRef.current.delete(itemId);
      if (typeof coverOverrideRef.current[itemId] === "string") {
        continue;
      }
      const item = libraryItemsById.get(itemId);
      if (!item?.cover_path) {
        continue;
      }
      if (inFlightCoverFetchesRef.current.has(itemId)) {
        continue;
      }
      inFlightCoverFetchesRef.current.add(itemId);
      activeCoverFetchesRef.current += 1;
      void fetchCoverOverride(itemId).finally(() => {
        inFlightCoverFetchesRef.current.delete(itemId);
        activeCoverFetchesRef.current = Math.max(0, activeCoverFetchesRef.current - 1);
        drainVisibleCoverQueue();
      });
    }
  }, [fetchCoverOverride, libraryItemsById]);

  const handleVisibleItemIdsChange = useCallback(
    (visibleItemIds: string[]) => {
      if (!isTauri()) return;
      visibleItemIds.forEach((itemId) => {
        if (typeof coverOverrideRef.current[itemId] === "string") {
          return;
        }
        if (
          queuedCoverFetchesRef.current.has(itemId) ||
          inFlightCoverFetchesRef.current.has(itemId)
        ) {
          return;
        }
        const item = libraryItemsById.get(itemId);
        if (!item?.cover_path) {
          return;
        }
        queuedCoverFetchesRef.current.add(itemId);
        coverFetchQueueRef.current.push(itemId);
      });
      drainVisibleCoverQueue();
    },
    [drainVisibleCoverQueue, libraryItemsById]
  );

  useEffect(() => {
    return () => {
      Object.values(coverOverrideRef.current).forEach((url) => {
        if (url) URL.revokeObjectURL(url);
      });
    };
  }, []);

  useEffect(() => {
    if (!isDesktop) return;
    const activeIds = new Set(libraryItems.map((item) => item.id));
    setCoverOverrides((prev) => {
      let changed = false;
      const next = { ...prev };
      Object.keys(next).forEach((id) => {
        if (!activeIds.has(id)) {
          const previous = next[id];
          if (previous) URL.revokeObjectURL(previous);
          delete next[id];
          changed = true;
        }
      });
      coverOverrideRef.current = next;
      return changed ? next : prev;
    });

    coverFetchQueueRef.current = coverFetchQueueRef.current.filter((id) => activeIds.has(id));
    queuedCoverFetchesRef.current = new Set(
      Array.from(queuedCoverFetchesRef.current).filter((id) => activeIds.has(id))
    );
    inFlightCoverFetchesRef.current = new Set(
      Array.from(inFlightCoverFetchesRef.current).filter((id) => activeIds.has(id))
    );
  }, [libraryItems, isDesktop]);

  useEffect(() => {
    if (!isDesktop || view !== "changes") return;
    if (!isTauri()) return;
    let active = true;
    const load = async () => {
      setPendingChangesLoading(true);
      try {
        const result = await invoke<PendingChange[]>("get_pending_changes", {
          status: pendingChangesStatus,
        });
        if (active) {
          setPendingChanges(result);
          if (pendingChangesStatus === "pending") {
            setPendingChangesCount(result.length);
          }
        }
      } catch {
        if (active) {
          setPendingChanges([]);
          if (pendingChangesStatus === "pending") {
            setPendingChangesCount(0);
          }
        }
      } finally {
        if (active) setPendingChangesLoading(false);
      }
    };
    void load();
    const interval = window.setInterval(load, 8000);
    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, [view, isDesktop, pendingChangesStatus]);

  const handleApplyChange = async (changeId: string) => {
    if (!isTauri()) return;
    try {
      setPendingChangesApplying(true);
      await invoke("apply_pending_changes", { ids: [changeId] });
      const result = await invoke<PendingChange[]>("get_pending_changes", {
        status: pendingChangesStatus,
      });
      setPendingChanges(result);
      if (pendingChangesStatus === "pending") {
        setPendingChangesCount(result.length);
      } else {
        void refreshPendingChanges();
      }
    } catch {
      setScanStatus("Could not apply change.");
    } finally {
      setPendingChangesApplying(false);
    }
  };

  const handleApplySelectedChanges = async () => {
    if (!isTauri()) return;
    const ids = Array.from(selectedChangeIds);
    if (!ids.length) return;
    const selectedDeletes = pendingChanges
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
      await invoke("apply_pending_changes", { ids });
      const result = await invoke<PendingChange[]>("get_pending_changes", {
        status: pendingChangesStatus,
      });
      setPendingChanges(result);
      if (pendingChangesStatus === "pending") {
        setPendingChangesCount(result.length);
      } else {
        void refreshPendingChanges();
      }
      clearChangeSelection();
    } catch {
      setScanStatus("Could not apply changes.");
    } finally {
      setPendingChangesApplying(false);
    }
  };

  const handleConfirmDelete = async () => {
    if (!confirmDeleteIds.length) return;
    try {
      setPendingChangesApplying(true);
      await invoke("apply_pending_changes", { ids: confirmDeleteIds });
      const result = await invoke<PendingChange[]>("get_pending_changes", {
        status: pendingChangesStatus,
      });
      setPendingChanges(result);
      if (pendingChangesStatus === "pending") {
        setPendingChangesCount(result.length);
      } else {
        void refreshPendingChanges();
      }
      clearChangeSelection();
    } catch {
      setScanStatus("Could not apply delete changes.");
    } finally {
      setPendingChangesApplying(false);
      setConfirmDeleteIds([]);
      setConfirmDeleteOpen(false);
    }
  };

  const handleApplyAllChanges = async () => {
    if (!isTauri()) return;
    try {
      setPendingChangesApplying(true);
      await invoke("apply_pending_changes", { ids: [] });
      const result = await invoke<PendingChange[]>("get_pending_changes", {
        status: pendingChangesStatus,
      });
      setPendingChanges(result);
      if (pendingChangesStatus === "pending") {
        setPendingChangesCount(result.length);
      } else {
        void refreshPendingChanges();
      }
    } catch {
      setScanStatus("Could not apply changes.");
    } finally {
      setPendingChangesApplying(false);
    }
  };

  const handleRemoveChange = async (changeId: string) => {
    if (!isTauri()) return;
    try {
      await invoke("remove_pending_changes", { ids: [changeId] });
      const result = await invoke<PendingChange[]>("get_pending_changes", {
        status: pendingChangesStatus,
      });
      setPendingChanges(result);
      if (pendingChangesStatus === "pending") {
        setPendingChangesCount(result.length);
      } else {
        void refreshPendingChanges();
      }
      setSelectedChangeIds((prev) => {
        const next = new Set(prev);
        next.delete(changeId);
        return next;
      });
    } catch {
      setScanStatus("Could not remove change.");
    }
  };

  const handleRemoveSelectedChanges = async () => {
    if (!isTauri() || !selectedChangeIds.size) return;
    try {
      await invoke("remove_pending_changes", { ids: Array.from(selectedChangeIds) });
      const result = await invoke<PendingChange[]>("get_pending_changes", {
        status: pendingChangesStatus,
      });
      setPendingChanges(result);
      if (pendingChangesStatus === "pending") {
        setPendingChangesCount(result.length);
      } else {
        void refreshPendingChanges();
      }
      setSelectedChangeIds(new Set());
    } catch {
      setScanStatus("Could not remove changes.");
    }
  };

  const handleRemoveAllChanges = async () => {
    if (!isTauri()) return;
    try {
      await invoke("remove_pending_changes", { ids: [] });
      const result = await invoke<PendingChange[]>("get_pending_changes", {
        status: pendingChangesStatus,
      });
      setPendingChanges(result);
      if (pendingChangesStatus === "pending") {
        setPendingChangesCount(result.length);
      } else {
        void refreshPendingChanges();
      }
      setSelectedChangeIds(new Set());
    } catch {
      setScanStatus("Could not remove changes.");
    }
  };

  const getCandidateCoverUrl = (candidate: EnrichmentCandidate) => {
    if (candidate.cover_url) return candidate.cover_url;
    const isbn = candidate.identifiers
      .map((value) => value.replace(/[^0-9Xx]/g, "").toUpperCase())
      .find((value) => value.length === 13 || value.length === 10);
    if (!isbn) return null;
    return `https://covers.openlibrary.org/b/isbn/${isbn}-M.jpg`;
  };

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
  }, [refreshLibrary, scanning]);

  const handleEnrichAll = useCallback(async (itemIds?: string[]) => {
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
  }, [enriching]);

  const handleCancelEnrich = useCallback(async () => {
    if (!isTauri()) return;
    try {
      await invoke("cancel_enrich");
      setScanStatus("Cancelling enrichment...");
    } catch (error) {
      console.error("Failed to cancel enrich:", error);
    }
  }, []);

  const handleClearLibrary = async () => {
    if (!isTauri()) {
      setScanStatus("Clear requires the Tauri desktop runtime.");
      return;
    }
    const { confirm } = await import("@tauri-apps/plugin-dialog");
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
  }, [normalizingDescriptions, runLibraryMutationPipeline]);

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
  }, [batchFixingTitles, runLibraryMutationPipeline]);

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
        setMetadataSources(DEFAULT_METADATA_SOURCES);
      });
    return () => {
      cancelled = true;
    };
  }, []);

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
    []
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

  const handleImportCancel = () => {
    setView("library-books");
  };

  const handleImportStart = useCallback(async (request: ImportRequest) => {
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
      setView("library-books");
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
  }, [importingBooks, refreshLibrary]);

  const handleChooseRoot = async () => {
    if (!isTauri()) return;
    const { open } = await import("@tauri-apps/plugin-dialog");
    const selection: string | string[] | null = await open({
      directory: true,
      multiple: false,
    });
    if (typeof selection !== "string") return;
    setOrganizeRoot(selection);
  };

  const handleRelinkMissing = async (fileId: string) => {
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
  };

  const handleRemoveMissing = async (fileId: string) => {
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
  };

  const handleRemoveAllMissing = async () => {
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
  };

  const handleRescanMissing = async () => {
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
  };

  useEffect(() => {
    if (!scanning) return;
    const interval = setInterval(() => {
      setCurrentTimeMs(Date.now());
      setScanStatus((prev) => prev ?? "Scanning...");
    }, 1000);
    return () => clearInterval(interval);
  }, [scanning]);

  useEffect(() => {
    if (!isTauri()) return;
    let unlisten: (() => void) | undefined;
    listen("menu-scan-folder", () => {
      handleScan();
    }).then((stop) => {
      unlisten = stop;
    });
    return () => {
      if (unlisten) unlisten();
    };
  }, [handleScan]);

  useEffect(() => {
    if (!isDesktop) return;
    let unlistenProgress: (() => void) | undefined;
    let unlistenComplete: (() => void) | undefined;
    let unlistenImportScan: (() => void) | undefined;

    listen<ScanProgress>("scan-progress", (event) => {
      setScanProgress(event.payload);
      if (!scanning) setScanning(true);
      if (!scanStartedAt) setScanStartedAt(Date.now());
    }).then((stop) => {
      unlistenProgress = stop;
    });

    listen<ScanStats>("scan-complete", (event) => {
      setScanProgress(null);
      setScanning(false);
      setScanStatus(
        `Scan complete: ${event.payload.added} added, ${event.payload.updated} updated, ${event.payload.moved} moved.`
      );
      setActivityLog((prev) => [
        {
          id: `scan-${Date.now()}`,
          type: "scan",
          message: `Scanned: ${event.payload.added} new, ${event.payload.updated} updated`,
          timestamp: Date.now(),
        },
        ...prev,
      ]);
    }).then((stop) => {
      unlistenComplete = stop;
    });

    listen<OperationProgress>("import-scan-progress", (event) => {
      const { status, current, total, message } = event.payload;
      if (status === "done") {
        setScanStatus(message ?? `Import scan complete (${total} files).`);
        setActivityLog((prev) => [
          {
            id: `import-scan-${Date.now()}`,
            type: "scan",
            message: message ?? `Import scan complete (${total} files).`,
            timestamp: Date.now(),
          },
          ...prev,
        ]);
        return;
      }

      const progressLabel =
        total > 0
          ? `Import scan ${current}/${total}`
          : "Import scan";
      setScanStatus(message ? `${progressLabel}: ${message}` : progressLabel);
    }).then((stop) => {
      unlistenImportScan = stop;
    });

    let unlistenError: (() => void) | undefined;
    listen<string>("scan-error", (event) => {
      setScanProgress(null);
      setScanning(false);
      setScanStatus(`Scan failed: ${event.payload}`);
      setActivityLog((prev) => [
        {
          id: `scan-err-${Date.now()}`,
          type: "error",
          message: `Scan failed: ${event.payload}`,
          timestamp: Date.now(),
        },
        ...prev,
      ]);
    }).then((stop) => {
      unlistenError = stop;
    });

    return () => {
      if (unlistenProgress) unlistenProgress();
      if (unlistenComplete) unlistenComplete();
      if (unlistenImportScan) unlistenImportScan();
      if (unlistenError) unlistenError();
    };
  }, [isDesktop, scanStartedAt, scanning]);

  // Listen for enrich progress events
  useEffect(() => {
    if (!isDesktop) return;
    let unlistenProgress: (() => void) | undefined;
    let unlistenComplete: (() => void) | undefined;
    let unlistenCancelled: (() => void) | undefined;

    listen<OperationProgress>("enrich-progress", (event) => {
      console.log("enrich-progress event:", event.payload);
      setEnrichProgress(event.payload);
      setEnrichingItems((prev) => {
        const next = new Set(prev);
        if (event.payload.status === "processing" || event.payload.status === "pending") {
          next.add(event.payload.itemId);
        } else {
          next.delete(event.payload.itemId);
        }
        return next;
      });
      setEnriching(true);
    }).then((stop) => {
      unlistenProgress = stop;
    });

    listen<OperationStats>("enrich-complete", (event) => {
      console.log("enrich-complete event:", event.payload);
      setEnrichProgress(null);
      setEnriching(false);
      setEnrichingItems(new Set());
      setScanStatus(
        `Enrichment complete: ${event.payload.processed} enriched, ${event.payload.skipped} skipped, ${event.payload.errors} errors.`
      );
      setActivityLog((prev) => [
        {
          id: `enrich-${Date.now()}`,
          type: "enrich",
          message: `Enriched ${event.payload.processed} items`,
          timestamp: Date.now(),
        },
        ...prev,
      ]);
      // Refresh library to show new covers
      void refreshLibrary();
    }).then((stop) => {
      unlistenComplete = stop;
    });

    listen<OperationStats>("enrich-cancelled", (event) => {
      console.log("enrich-cancelled event:", event.payload);
      setEnrichProgress(null);
      setEnriching(false);
      setEnrichingItems(new Set());
      setScanStatus(
        `Enrichment cancelled: ${event.payload.processed} enriched before cancellation.`
      );
      // Refresh library to show any new covers from before cancellation
      void refreshLibrary();
    }).then((stop) => {
      unlistenCancelled = stop;
    });

    return () => {
      if (unlistenProgress) unlistenProgress();
      if (unlistenComplete) unlistenComplete();
      if (unlistenCancelled) unlistenCancelled();
    };
  }, [isDesktop, refreshLibrary]);

  // Listen for change progress events
  useEffect(() => {
    if (!isDesktop) return;
    let unlistenProgress: (() => void) | undefined;
    let unlistenComplete: (() => void) | undefined;

    listen<OperationProgress>("change-progress", (event) => {
      console.log("change-progress event:", event.payload);
      setChangeProgress(event.payload);
      setApplyingChangeIds((prev) => {
        const next = new Set(prev);
        if (event.payload.status === "processing") {
          next.add(event.payload.itemId);
        } else {
          next.delete(event.payload.itemId);
        }
        return next;
      });
      setPendingChangesApplying(true);
    }).then((stop) => {
      unlistenProgress = stop;
    });

    listen<OperationStats>("change-complete", async (event) => {
      console.log("change-complete event:", event.payload);
      setChangeProgress(null);
      setApplyingChangeIds(new Set());
      setPendingChangesApplying(false);
      setScanStatus(
        `Changes complete: ${event.payload.processed} applied, ${event.payload.errors} errors.`
      );
      // Refresh the pending changes list
      try {
        const result = await invoke<PendingChange[]>("get_pending_changes", {
          status: pendingChangesStatusRef.current,
        });
        setPendingChanges(result);
        if (pendingChangesStatusRef.current === "pending") {
          setPendingChangesCount(result.length);
        } else {
          await refreshPendingChanges();
        }
        await refreshLibrary();
      } catch {
        // ignore
      }
    }).then((stop) => {
      unlistenComplete = stop;
    });

    return () => {
      if (unlistenProgress) unlistenProgress();
      if (unlistenComplete) unlistenComplete();
    };
  }, [isDesktop, refreshLibrary, refreshPendingChanges]);

  useEffect(() => {
    if (!isDesktop) return;
    let unlisten: (() => void) | undefined;
    listen<ApplyMetadataProgress>("apply-metadata-progress", (event) => {
      const { message, current, total, step } = event.payload;
      const progressMessage =
        step === "done" ? "Metadata apply complete." : `${message} (${current}/${total})`;
      setScanStatus(progressMessage);
    }).then((stop) => {
      unlisten = stop;
    });
    return () => {
      if (unlisten) unlisten();
    };
  }, [isDesktop]);

  useEffect(() => {
    // Invalidate in-flight Fix Metadata searches and clear stale results on selection change.
    fixSearchRequestIdRef.current += 1;
    setFixCandidates([]);
    setFixLoading(false);
  }, [selectedFixItemId]);

  const handleSearchFixWithQuery = async (queryValue: string) => {
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
  };

  const handleApplyFixCandidate = async (candidate: EnrichmentCandidate) => {
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
  };

  const handleSaveFixMetadata = async (id: string, data: ItemMetadata) => {
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
    } catch (e) {
      console.error("Failed to save metadata", e);
      setScanStatus("Could not apply metadata change.");
    }
  };

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
    [runLibraryMutationPipeline]
  );

  const loadEditMatchCandidates = async (itemId: string) => {
    if (!isTauri()) {
      setEditMatchCandidates(sampleFixCandidates);
      return;
    }
    setEditMatchLoading(true);
    try {
      const candidates = await invoke<EnrichmentCandidate[]>(
        "get_fix_candidates",
        { itemId }
      );
      setEditMatchCandidates(candidates);
    } catch {
      setScanStatus("Could not fetch match candidates.");
      setEditMatchCandidates([]);
    } finally {
      setEditMatchLoading(false);
    }
  };

  const handleEditMatchSearch = async (query: string) => {
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
  };

  const handleEditMatchApply = async (candidate: EnrichmentCandidate) => {
    if (!selectedItemId || !isTauri()) return;
    setEditMatchApplying(candidate.id);
    try {
      await invoke("apply_fix_candidate", {
        itemId: selectedItemId,
        candidate,
      });
      await refreshCoverForItem(selectedItemId);
      await refreshLibrary();
      const queued = await refreshPendingChanges();
      setScanStatus(
        queued > 0
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
  };

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

  useEffect(() => {
    if (view !== "edit") return;
    if (!selectedItemId) return;
    setEditMatchQuery(selectedItem?.title ?? "");
    void loadEditMatchCandidates(selectedItemId);
  }, [view, selectedItemId, selectedItem?.title]);

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

  const handleResolveDuplicate = async (group: DuplicateGroup, keepFileId: string) => {
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
  };

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
    [duplicateKeepSelection, pickBestDuplicate, refreshLibrary, refreshPendingChanges]
  );

  const handleOpenSyncDialog = () => {
    setEreaderSyncDialogOpen(true);
  };

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

  useEffect(() => {
    if (mainScrollRef.current) {
      mainScrollRef.current.scrollTo({ top: 0, behavior: "auto" });
    }
  }, [view]);

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
        setView={setView}
        scanning={scanning}
        handleScan={() => setView("import")}
        libraryHealth={libraryHealth}
        pendingChangesCount={pendingChangesCount}
        duplicateCount={duplicateActionCount}
        missingFilesCount={missingFiles.length}
        fixActionCount={fixActionCount}
        ereaderPendingCount={ereaderPendingCount}
        handleClearLibrary={() => void handleClearLibrary()}
        appVersion={appVersion}
        ereaderConnected={ereaderDevices.some((d) => d.isConnected)}
      />

      <main ref={mainScrollRef} className="flex h-screen flex-col gap-4 overflow-y-auto px-6 py-4">
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
            scanProgress={scanProgress}
            importProgress={importProgress}
            activityLog={activityLog}
          />
        )}

        <ScanProgressBar
          scanning={scanning}
          progress={scanProgress}
          etaLabel={scanEtaLabel}
          variant="accent"
        />
        <ProgressBar
          show={importingBooks}
          progress={importProgress}
          label="Importing"
          variant="blue"
        />

        <div className="flex flex-col gap-4">
          <AppRoutes
            view={view}
            setView={setView}
            isDesktop={isDesktop}
            libraryReady={libraryReady}
            libraryItemsLength={libraryItems.length}
            sortedBooks={sortedBooks}
            allBooks={allBooks}
            selectedItemId={selectedItemId}
            selectedBatchItemIds={selectedBatchItemIds}
            setSelectedItemId={setSelectedItemId}
            onToggleBatchSelect={handleToggleBatchSelection}
            onSetBatchSelection={handleSetBatchSelection}
            onClearBatchSelection={handleClearBatchSelection}
            onApplyBatchMetadata={handleApplyBatchMetadata}
            libraryFilter={libraryFilter}
            setLibraryFilter={setLibraryFilter}
            librarySort={librarySort}
            setLibrarySort={setLibrarySort}
            tags={tags}
            selectedTagIds={selectedTagIds}
            setSelectedTagIds={setSelectedTagIds}
            grid={grid}
            setGrid={setGrid}
            fetchCoverOverride={fetchCoverOverride}
            clearCoverOverride={clearCoverOverride}
            onVisibleItemIdsChange={handleVisibleItemIdsChange}
            scrollContainerRef={mainScrollRef}
            selectedAuthorNames={selectedAuthorNames}
            setSelectedAuthorNames={setSelectedAuthorNames}
            selectedSeries={selectedSeries}
            setSelectedSeries={setSelectedSeries}
            selectedGenres={selectedGenres}
            setSelectedGenres={setSelectedGenres}
            onEnrichAll={handleEnrichAll}
            onCancelEnrich={handleCancelEnrich}
            enriching={enriching}
            enrichingItems={enrichingItems}
            enrichProgress={enrichProgress}
            uniqueAuthors={uniqueAuthors}
            uniqueSeries={uniqueSeries}
            uniqueCategories={uniqueCategories}
            inbox={inbox}
            sampleInboxItems={sampleInboxItems}
            duplicates={duplicates}
            sampleDuplicateGroups={sampleDuplicateGroups}
            titleDuplicates={titleDuplicates}
            fuzzyDuplicates={fuzzyDuplicates}
            duplicateKeepSelection={duplicateKeepSelection}
            setDuplicateKeepSelection={setDuplicateKeepSelection}
            handleResolveDuplicate={handleResolveDuplicate}
            handleAutoSelectAll={handleAutoSelectDuplicates}
            handleResolveAll={handleResolveAllDuplicates}
            allFixItems={allFixItems}
            fixIssues={fixIssues}
            selectedFixItemId={selectedFixItemId}
            setSelectedFixItemId={setSelectedFixItemId}
            fixFilter={fixFilter}
            setFixFilter={setFixFilter}
            fixSearchQuery={fixSearchQuery}
            setFixSearchQuery={setFixSearchQuery}
            fixLoading={fixLoading}
            fixCandidates={fixCandidates}
            fixCoverUrl={selectedFixItemId ? coverOverrides[selectedFixItemId] : null}
            onFetchFixCover={fetchCoverOverride}
            onSearchFixWithQuery={handleSearchFixWithQuery}
            onApplyFixCandidate={handleApplyFixCandidate}
            onSaveFixMetadata={handleSaveFixMetadata}
            fixApplyingCandidateId={fixApplyingCandidateId}
            getCandidateCoverUrl={getCandidateCoverUrl}
            pendingChangesStatus={pendingChangesStatus}
            setPendingChangesStatus={setPendingChangesStatus}
            pendingChangesApplying={pendingChangesApplying}
            pendingChangesLoading={pendingChangesLoading}
            pendingChanges={pendingChanges}
            selectedChangeIds={selectedChangeIds}
            toggleChangeSelection={toggleChangeSelection}
            handleApplyAllChanges={handleApplyAllChanges}
            handleApplySelectedChanges={handleApplySelectedChanges}
            handleApplyChange={handleApplyChange}
            handleRemoveChange={handleRemoveChange}
            handleRemoveAllChanges={handleRemoveAllChanges}
            handleRemoveSelectedChanges={handleRemoveSelectedChanges}
            confirmDeleteOpen={confirmDeleteOpen}
            confirmDeleteIds={confirmDeleteIds}
            setConfirmDeleteOpen={setConfirmDeleteOpen}
            setConfirmDeleteIds={setConfirmDeleteIds}
            handleConfirmDelete={handleConfirmDelete}
            applyingChangeIds={applyingChangeIds}
            changeProgress={changeProgress}
            organizeMode={organizeMode}
            setOrganizeMode={setOrganizeMode}
            organizeRoot={organizeRoot}
            organizeTemplate={organizeTemplate}
            setOrganizeTemplate={setOrganizeTemplate}
            organizePlan={organizePlan}
            handlePlanOrganize={handlePlanOrganize}
            handleApplyOrganize={handleApplyOrganize}
            organizeStatus={organizeStatus}
            organizeProgress={organizeProgress}
            organizing={organizing}
            organizeLog={organizeLog}
            onImportCancel={handleImportCancel}
            onImportStart={handleImportStart}
            onChooseRoot={handleChooseRoot}
            onNormalizeDescriptions={handleNormalizeDescriptions}
            normalizingDescriptions={normalizingDescriptions}
            onBatchFixTitles={handleBatchFixTitles}
            batchFixingTitles={batchFixingTitles}
            metadataSources={metadataSources}
            onSetMetadataSourceEnabled={handleSetMetadataSourceEnabled}
            metadataSourcesSaving={metadataSourcesSaving}
            themeMode={themeMode}
            setThemeMode={setThemeMode}
            missingFiles={missingFiles}
            onRelinkMissing={handleRelinkMissing}
            onRemoveMissing={handleRemoveMissing}
            onRemoveAllMissing={handleRemoveAllMissing}
            onRescanMissing={handleRescanMissing}
            libraryItems={libraryItems}
            previousView={previousView}
            onEditItemUpdate={async () => {
              await refreshLibrary();
              await refreshPendingChanges();
            }}
            editCoverUrl={selectedItemId ? coverOverrides[selectedItemId] : null}
            detailsVersion={editDetailsVersion}
            matchQuery={editMatchQuery}
            onMatchQueryChange={setEditMatchQuery}
            matchLoading={editMatchLoading}
            matchCandidates={editMatchCandidates}
            onMatchSearch={handleEditMatchSearch}
            onMatchApply={handleEditMatchApply}
            matchApplyingId={editMatchApplying}
            onQueueRemoveItem={handleQueueRemoveItem}
            newTagName={newTagName}
            setNewTagName={setNewTagName}
            newTagColor={newTagColor}
            setNewTagColor={setNewTagColor}
            handleCreateTag={handleCreateTag}
            handleUpdateTag={handleUpdateTag}
            ereaderDevices={ereaderDevices}
            selectedEreaderDeviceId={selectedEreaderDeviceId}
            setSelectedEreaderDeviceId={setSelectedEreaderDeviceId}
            ereaderBooks={ereaderBooks}
            ereaderSyncQueue={ereaderSyncQueue}
            onAddEreaderDevice={handleAddEreaderDevice}
            onRemoveEreaderDevice={handleRemoveEreaderDevice}
            onScanEreaderDevice={handleScanEreaderDevice}
            onQueueEreaderAdd={handleQueueEreaderAdd}
            onQueueEreaderRemove={handleQueueEreaderRemove}
            onQueueEreaderImport={handleQueueEreaderImport}
            onRemoveFromQueue={handleRemoveFromEreaderQueue}
            onExecuteSync={handleOpenSyncDialog}
            onRefreshDevices={async () => {
              await refreshEreaderDevices();
            }}
            ereaderScanning={ereaderScanning}
            ereaderSyncing={ereaderSyncing}
            ereaderSyncProgress={ereaderSyncProgress}
          />
        </div>

        <SyncConfirmDialog
          open={ereaderSyncDialogOpen}
          onClose={() => setEreaderSyncDialogOpen(false)}
          onConfirm={() => void handleExecuteEreaderSync()}
          deviceName={ereaderDevices.find((d) => d.id === selectedEreaderDeviceId)?.name ?? "eReader"}
          queue={ereaderSyncQueue}
          libraryItems={libraryItems}
          syncing={ereaderSyncing}
          syncProgress={ereaderSyncProgress}
        />

        <StatusBar
          scanStatus={scanStatus}
          updateStatus={updateStatus}
          isDesktop={isDesktop}
          appVersion={appVersion}
        />
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
            selectedItem={selectedItem}
            availableLanguages={availableLanguages}
            selectedTags={selectedTags}
            availableTags={availableTags}
            handleAddTag={(tagId) => void handleAddTag(tagId)}
            handleRemoveTag={(tagId) => void handleRemoveTag(tagId)}
            clearCoverOverride={clearCoverOverride}
            fetchCoverOverride={(itemId) => void fetchCoverOverride(itemId)}
            setView={setView}
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
              setPreviousView(view);
              setView("edit");
            }}
            width={inspectorWidth}
          />
        </div>
      ) : null}
    </div>
  );
}

export default App;
