import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useCallback, useEffect, useRef, useState } from "react";
import { ScanProgressBar } from "./components/ProgressBar";
import { SyncConfirmDialog } from "./components/SyncConfirmDialog";
import { useEreader } from "./hooks/useEreader";
import { useLibraryData } from "./hooks/useLibraryData";
import { useLibrarySelectors } from "./hooks/useLibrarySelectors";
import { useOrganizer } from "./hooks/useOrganizer";
import { useUpdater } from "./hooks/useUpdater";
import { normalizeTitleSnapshot } from "./lib/metadataCleanup";
import { TAG_COLORS } from "./lib/tagColors";
import { AppRoutes } from "./sections/AppRoutes";
import { Inspector } from "./sections/Inspector";
import { Sidebar } from "./sections/Sidebar";
import { StatusBar } from "./sections/StatusBar";
import { TopToolbar } from "./sections/TopToolbar";
import type {
  ActivityLogItem,
  DuplicateGroup,
  EnrichmentCandidate,
  FixFilter,
  ItemMetadata,
  LibraryFilter,
  LibrarySort,
  OperationProgress,
  OperationStats,
  PendingChange,
  ScanProgress,
  ScanStats,
  Tag,
  View,
} from "./types/library";

const sampleBooks = [
  {
    id: "1",
    title: "The Shallows",
    author: "Nicholas Carr",
    format: "EPUB",
    year: 2010,
    status: "Complete",
    cover: null,
    tags: [{ id: "t1", name: "Favorites", color: "amber" }],
  },
  {
    id: "2",
    title: "Silent Spring",
    author: "Rachel Carson",
    format: "PDF",
    year: 1962,
    status: "Complete",
    cover: null,
    tags: [],
  },
  {
    id: "3",
    title: "The Left Hand of Darkness",
    author: "Ursula K. Le Guin",
    format: "EPUB",
    year: 1969,
    status: "Needs ISBN",
    cover: null,
    tags: [{ id: "t2", name: "To Review", color: "sky" }],
  },
  {
    id: "4",
    title: "Braiding Sweetgrass",
    author: "Robin Wall Kimmerer",
    format: "PDF",
    year: 2013,
    status: "Needs Cover",
    cover: null,
    tags: [],
  },
  {
    id: "5",
    title: "The Book of Tea",
    author: "Kakuzo Okakura",
    format: "EPUB",
    year: 1906,
    status: "Complete",
    cover: null,
    tags: [{ id: "t3", name: "Classic", color: "emerald" }],
  },
];


const sampleTags: Tag[] = [
  { id: "t1", name: "Favorites", color: "amber" },
  { id: "t2", name: "To Review", color: "sky" },
  { id: "t3", name: "Classic", color: "emerald" },
];


const inboxItems = [
  { id: "i1", title: "Notes on the Synthesis", reason: "Missing author" },
  { id: "i2", title: "Design of Everyday Things", reason: "Missing ISBN" },
  { id: "i3", title: "A New Ecology", reason: "Missing cover" },
];

const duplicateGroups: DuplicateGroup[] = [
  {
    id: "d1",
    kind: "hash",
    title: "The Shallows",
    files: ["The Shallows.epub", "The Shallows (1).epub"],
    file_ids: ["d1-file-1", "d1-file-2"],
    file_paths: ["/samples/The Shallows.epub", "/samples/The Shallows (1).epub"],
    file_titles: ["The Shallows", "The Shallows"],
    file_authors: ["Nicholas Carr", "Nicholas Carr"],
    file_sizes: [1_048_576, 1_048_576],
  },
  {
    id: "d2",
    kind: "hash",
    title: "Silent Spring",
    files: ["Silent Spring.pdf", "Silent Spring - copy.pdf"],
    file_ids: ["d2-file-1", "d2-file-2"],
    file_paths: ["/samples/Silent Spring.pdf", "/samples/Silent Spring - copy.pdf"],
    file_titles: ["Silent Spring", "Silent Spring"],
    file_authors: ["Rachel Carson", "Rachel Carson"],
    file_sizes: [2_097_152, 2_097_152],
  },
];



const sampleFixCandidates: EnrichmentCandidate[] = [
  {
    id: "c1",
    title: "The Left Hand of Darkness",
    authors: ["Ursula K. Le Guin"],
    published_year: 1969,
    identifiers: [],
    confidence: 0.92,
    source: "Open Library",
  },
  {
    id: "c2",
    title: "Left Hand of Darkness",
    authors: ["U. K. Le Guin"],
    published_year: 1969,
    identifiers: [],
    confidence: 0.86,
    source: "Google Books",
  },
  {
    id: "c3",
    title: "The Left Hand of Darkness (Anniversary)",
    authors: ["Ursula Le Guin"],
    published_year: 2004,
    identifiers: [],
    confidence: 0.74,
    source: "Open Library",
  },
  {
    id: "c4",
    title: "The Left Hand of Darkness",
    authors: ["Ursula K. Le Guin"],
    published_year: 1976,
    identifiers: [],
    confidence: 0.71,
    source: "Google Books",
  },
  {
    id: "c5",
    title: "The Left Hand of Darkness",
    authors: ["Ursula K. LeGuin"],
    published_year: 1969,
    identifiers: [],
    confidence: 0.67,
    source: "Open Library",
  },
];

function App() {
  const [view, setView] = useState<View>("library-books");
  const [previousView, setPreviousView] = useState<View>("library-books");
  const [activityLog, setActivityLog] = useState<ActivityLogItem[]>([]); // New State
  const [grid, setGrid] = useState(true);
  const [query, setQuery] = useState("");
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
  const [editMatchQuery, setEditMatchQuery] = useState("");
  const [editMatchLoading, setEditMatchLoading] = useState(false);
  const [editMatchCandidates, setEditMatchCandidates] = useState<EnrichmentCandidate[]>([]);
  const [editMatchApplying, setEditMatchApplying] = useState<string | null>(null);
  const [editDetailsVersion, setEditDetailsVersion] = useState(0);


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
  const [fixFormData, setFixFormData] = useState<ItemMetadata | null>(null);
  const [fixSearchQuery, setFixSearchQuery] = useState("");
  const [fixSaving, setFixSaving] = useState(false);
  const [markingTitleCorrectId, setMarkingTitleCorrectId] = useState<string | null>(null);
  const [coverOverrides, setCoverOverrides] = useState<Record<string, string | null>>({});
  const coverOverrideRef = useRef<Record<string, string | null>>({});
  const [duplicateKeepSelection, setDuplicateKeepSelection] = useState<
    Record<string, string>
  >({});
  const [duplicateApplyNow, setDuplicateApplyNow] = useState(false);
  const [pendingChanges, setPendingChanges] = useState<PendingChange[]>([]);
  const [pendingChangesLoading, setPendingChangesLoading] = useState(false);
  const [pendingChangesApplying, setPendingChangesApplying] = useState(false);
  const [pendingChangesStatus, setPendingChangesStatus] = useState<
    "pending" | "applied" | "error"
  >("pending");
  const pendingChangesStatusRef = useRef<"pending" | "applied" | "error">("pending");
  const [applyingChangeIds, setApplyingChangeIds] = useState<Set<string>>(new Set());
  const [changeProgress, setChangeProgress] = useState<OperationProgress | null>(null);
  const [normalizingDescriptions, setNormalizingDescriptions] = useState(false);
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
    coverRefreshToken,
    refreshLibrary,
    refreshTitleCleanupIgnores,
    resetLibraryState,
  } = useLibraryData({ setScanStatus });

  const {
    appVersion,
    updateStatus,
    updateAvailable,
    updateVersion,
    checkForUpdates,
  } = useUpdater({ isDesktop });

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
    handleQueueOrganize,
  } = useOrganizer({ isDesktop, refreshLibrary, setActivityLog });

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
    enrichableCount,
    fixIssues,
    allFixItems,
    filteredBooks,
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
    pendingChangesStatusRef.current = pendingChangesStatus;
  }, [pendingChangesStatus]);

  const refreshPendingChanges = useCallback(async () => {
    if (!isTauri()) return 0;
    try {
      const result = await invoke<PendingChange[]>("get_pending_changes", {
        status: "pending",
      });
      if (pendingChangesStatus === "pending") {
        setPendingChanges(result);
      }
      return result.length;
    } catch {
      return 0;
    }
  }, [pendingChangesStatus]);

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

    const itemsToLoad = libraryItems.filter(
      (item) =>
        item.cover_path &&
        typeof coverOverrideRef.current[item.id] !== "string"
    );
    if (!itemsToLoad.length) return;
    void Promise.all(itemsToLoad.map((item) => fetchCoverOverride(item.id)));
  }, [libraryItems, isDesktop, fetchCoverOverride]);

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
        if (active) setPendingChanges(result);
      } catch {
        if (active) setPendingChanges([]);
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
        await invoke("add_tag_to_item", { itemId: selectedItemId, tagId });
        await refreshLibrary();
      } catch {
        return;
      }
    },
    [selectedItemId, refreshLibrary]
  );

  const handleRemoveTag = useCallback(
    async (tagId: string) => {
      if (!selectedItemId) return;
      if (!isTauri()) return;
      try {
        await invoke("remove_tag_from_item", { itemId: selectedItemId, tagId });
        await refreshLibrary();
      } catch {
        return;
      }
    },
    [selectedItemId, refreshLibrary]
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

  const handleEnrichAll = useCallback(async () => {
    if (!isTauri()) {
      setScanStatus("Enrich requires the Tauri desktop runtime.");
      return;
    }
    if (enriching) return;
    const needsEnrichment = libraryItems.some(
      (item) =>
        !item.cover_path || item.authors.length === 0 || item.published_year === null
    );
    if (!needsEnrichment) {
      setScanStatus("No items need enrichment.");
      return;
    }
    setEnriching(true);
    setEnrichProgress(null);
    setEnrichingItems(new Set());
    setScanStatus("Enriching library...");
    try {
      // This returns immediately, progress comes via events
      await invoke("enrich_all");
    } catch (error) {
      const message =
        error instanceof Error ? error.message : String(error ?? "Enrich failed.");
      setScanStatus(`Enrich failed: ${message}`);
      setEnriching(false);
      setEnrichingItems(new Set());
    }
  }, [enriching, libraryItems]);

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
      const result = await invoke<{ itemsUpdated: number; filesQueued: number }>(
        "normalize_item_descriptions"
      );
      await refreshLibrary();
      if (result.itemsUpdated > 0) {
        setScanStatus(
          `Cleaned descriptions for ${result.itemsUpdated} items and queued ${result.filesQueued} EPUB file updates.`
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
  }, [normalizingDescriptions, refreshLibrary]);

  const handleImportCancel = () => {
    setView("library-books");
  };

  const handleImportComplete = () => {
    setView("library-books");
    refreshLibrary();
  };

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
      await invoke("relink_missing_file", { fileId, newPath: selection });
      await refreshLibrary();
      setScanStatus("File relinked.");
    } catch (err) {
      console.error("Failed to relink file", err);
      setScanStatus("Could not relink file.");
    }
  };

  const handleRemoveMissing = async (fileId: string) => {
    if (!isTauri()) return;
    try {
      await invoke("remove_missing_file", { fileId });
      await refreshLibrary();
      setScanStatus("Missing file removed.");
    } catch (err) {
      console.error("Failed to remove missing file", err);
      setScanStatus("Could not remove missing file.");
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
  }, [isDesktop, refreshLibrary]);

  const handleFetchCandidatesForItem = async (itemId: string) => {
    if (!isTauri()) {
      setFixCandidates([]);
      return;
    }
    setFixLoading(true);
    try {
      const candidates = await invoke<EnrichmentCandidate[]>(
        "get_fix_candidates",
        { itemId }
      );
      setFixCandidates(candidates);
    } catch {
      setScanStatus("Could not fetch enrichment candidates.");
    } finally {
      setFixLoading(false);
    }
  };

  const handleSearchFixWithQuery = async (queryValue: string) => {
    if (!selectedFixItemId || !isTauri()) return;
    setFixLoading(true);
    try {
      const candidates = await invoke<EnrichmentCandidate[]>("search_candidates", {
        query: queryValue,
        itemId: selectedFixItemId,
      });
      setFixCandidates(candidates);
    } catch {
      setScanStatus("Could not search metadata sources.");
      setFixCandidates([]);
    } finally {
      setFixLoading(false);
    }
  };

  const handleApplyFixCandidate = async (candidate: EnrichmentCandidate) => {
    if (!selectedFixItemId || !isTauri()) return;
    try {
      await invoke("apply_fix_candidate", {
        itemId: selectedFixItemId,
        candidate,
      });
      const queued = await refreshPendingChanges();
      setScanStatus(
        queued > 0
          ? `Metadata updated. ${queued} file changes queued.`
          : "Metadata updated."
      );
      await refreshLibrary();
      clearCoverOverride(selectedFixItemId);
      await fetchCoverOverride(selectedFixItemId, true);
      setFixCandidates([]);
    } catch {
      setScanStatus("Could not apply metadata.");
    }
  };

  const handleSaveFixMetadata = async (id: string, data: ItemMetadata) => {
    if (!isDesktop) return;
    setFixSaving(true);
    try {
      await invoke("save_item_metadata", { itemId: id, metadata: data });
      setScanStatus("Metadata saved.");
      await refreshLibrary();
      clearCoverOverride(id);
      await fetchCoverOverride(id, true);
    } catch (e) {
      console.error("Failed to save metadata", e);
      setScanStatus("Could not save metadata.");
    } finally {
      setFixSaving(false);
    }
  };

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
    try {
      const candidates = await invoke<EnrichmentCandidate[]>("search_candidates", {
        query,
        itemId: selectedItemId ?? undefined,
      });
      setEditMatchCandidates(candidates);
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
      const queued = await refreshPendingChanges();
      setScanStatus(
        queued > 0
          ? `Metadata updated. ${queued} file changes queued.`
          : "Metadata updated."
      );
      // Clear cached cover and fetch the updated one
      clearCoverOverride(selectedItemId);
      await fetchCoverOverride(selectedItemId);
      await refreshLibrary();
      setEditDetailsVersion((value) => value + 1);
    } catch {
      setScanStatus("Could not apply metadata.");
    } finally {
      setEditMatchApplying(null);
    }
  };

  useEffect(() => {
    if (view !== "edit") return;
    if (!selectedItemId) return;
    setEditMatchQuery(selectedItem?.title ?? "");
    void loadEditMatchCandidates(selectedItemId);
  }, [view, selectedItemId, selectedItem?.title]);

  const handleMarkTitleCorrect = async (itemId: string, title: string) => {
    if (!isTauri()) return;
    const snapshot = normalizeTitleSnapshot(title);
    if (!snapshot) return;

    setMarkingTitleCorrectId(itemId);
    try {
      await invoke("set_title_cleanup_ignored", {
        itemId,
        titleSnapshot: snapshot,
        ignored: true,
      });
      await refreshTitleCleanupIgnores();
      setScanStatus("Marked title as correct.");
    } catch {
      setScanStatus("Could not mark title as correct.");
    } finally {
      setMarkingTitleCorrectId(null);
    }
  };

  const pickBestDuplicate = useCallback((group: DuplicateGroup) => {
    const scoreFile = (fileName: string, filePath: string) => {
      const lowerPath = filePath.toLowerCase();
      let score = 0;
      if (lowerPath.endsWith(".epub")) score += 50;
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
      setScanStatus("Duplicate resolved.");
      await refreshLibrary();
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
    async (groups: DuplicateGroup[], applyNow: boolean) => {
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
        if (applyNow) {
          await invoke("apply_pending_changes", { ids: [] });
          setView("changes");
        }
        setScanStatus(`Resolved ${resolved} duplicate groups.`);
        await refreshLibrary();
      } catch {
        setScanStatus("Could not resolve duplicates.");
      }
    },
    [duplicateKeepSelection, pickBestDuplicate, refreshLibrary]
  );

  const handleOpenSyncDialog = () => {
    setEreaderSyncDialogOpen(true);
  };

  const handleQueueOrganizeAndView = async () => {
    const created = await handleQueueOrganize();
    if (created !== null) {
      setView("changes");
    }
  };

  return (
    <div
      className={
        view === "library" || view === "library-books" || view === "library-authors" || view === "library-series"
          ? "grid h-screen grid-cols-[210px_minmax(0,1fr)_240px] overflow-hidden bg-[var(--app-bg)] text-[var(--app-ink)]"
          : "grid h-screen grid-cols-[210px_minmax(0,1fr)] overflow-hidden bg-[var(--app-bg)] text-[var(--app-ink)]"
      }
    >
        <Sidebar
          view={view}
          setView={setView}
          scanning={scanning}
          handleScan={() => setView("import")}
          libraryHealth={libraryHealth}
          pendingChangesCount={pendingChangesStatus === "pending" ? pendingChanges.length : 0}
          duplicateCount={duplicates.length}
          missingFilesCount={missingFiles.length}
          handleClearLibrary={() => void handleClearLibrary()}
          appVersion={appVersion}
          ereaderConnected={ereaderDevices.some((d) => d.isConnected)}
        />

      <main className="flex h-screen flex-col gap-4 overflow-y-auto px-6 py-4">
        <TopToolbar
          view={view}
          checkForUpdates={(silent) => void checkForUpdates(silent)}
          query={query}
          setQuery={setQuery}
          grid={grid}
          setGrid={setGrid}
          libraryReady={libraryReady}
          updateStatus={updateStatus}
          updateAvailable={updateAvailable}
          updateVersion={updateVersion}
          scanStatus={scanStatus}
          scanProgress={scanProgress}
          activityLog={activityLog}
        />

        <ScanProgressBar
          scanning={scanning}
          progress={scanProgress}
          etaLabel={scanEtaLabel}
          variant="accent"
        />

        <div className="flex flex-col gap-4">
          <AppRoutes
            view={view}
            setView={setView}
            isDesktop={isDesktop}
            libraryReady={libraryReady}
            libraryItemsLength={libraryItems.length}
            sortedBooks={sortedBooks}
            filteredBooks={filteredBooks}
            selectedItemId={selectedItemId}
            setSelectedItemId={setSelectedItemId}
            libraryFilter={libraryFilter}
            setLibraryFilter={setLibraryFilter}
            librarySort={librarySort}
            setLibrarySort={setLibrarySort}
            tags={tags}
            selectedTagIds={selectedTagIds}
            setSelectedTagIds={setSelectedTagIds}
            grid={grid}
            coverRefreshToken={coverRefreshToken}
            fetchCoverOverride={fetchCoverOverride}
            clearCoverOverride={clearCoverOverride}
            selectedAuthorNames={selectedAuthorNames}
            setSelectedAuthorNames={setSelectedAuthorNames}
            selectedSeries={selectedSeries}
            setSelectedSeries={setSelectedSeries}
            onEnrichAll={handleEnrichAll}
            onCancelEnrich={handleCancelEnrich}
            enriching={enriching}
            enrichingItems={enrichingItems}
            enrichProgress={enrichProgress}
            enrichableCount={enrichableCount}
            uniqueAuthors={uniqueAuthors}
            uniqueSeries={uniqueSeries}
            inbox={inbox}
            sampleInboxItems={inboxItems}
            duplicates={duplicates}
            sampleDuplicateGroups={duplicateGroups}
            titleDuplicates={titleDuplicates}
            fuzzyDuplicates={fuzzyDuplicates}
            duplicateKeepSelection={duplicateKeepSelection}
            setDuplicateKeepSelection={setDuplicateKeepSelection}
            handleResolveDuplicate={handleResolveDuplicate}
            handleAutoSelectAll={handleAutoSelectDuplicates}
            handleResolveAll={handleResolveAllDuplicates}
            duplicateApplyNow={duplicateApplyNow}
            setDuplicateApplyNow={setDuplicateApplyNow}
            allFixItems={allFixItems}
            fixIssues={fixIssues}
            selectedFixItemId={selectedFixItemId}
            setSelectedFixItemId={setSelectedFixItemId}
            fixFilter={fixFilter}
            setFixFilter={setFixFilter}
            fixFormData={fixFormData}
            setFixFormData={setFixFormData}
            fixSearchQuery={fixSearchQuery}
            setFixSearchQuery={setFixSearchQuery}
            fixLoading={fixLoading}
            fixCandidates={fixCandidates}
            fixCoverUrl={selectedFixItemId ? coverOverrides[selectedFixItemId] : null}
            onFetchFixCover={fetchCoverOverride}
            onSearchFixCandidates={() => {
              if (!selectedFixItemId) return;
              handleFetchCandidatesForItem(selectedFixItemId);
            }}
            onSearchFixWithQuery={handleSearchFixWithQuery}
            onApplyFixCandidate={handleApplyFixCandidate}
            onSaveFixMetadata={handleSaveFixMetadata}
            onNavigateToEdit={(itemId) => {
              setSelectedItemId(itemId);
              setPreviousView("fix");
              setView("edit");
            }}
            onMarkTitleCorrect={handleMarkTitleCorrect}
            markingTitleCorrectId={markingTitleCorrectId}
            fixSaving={fixSaving}
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
            handleQueueOrganize={handleQueueOrganizeAndView}
            organizeStatus={organizeStatus}
            organizeProgress={organizeProgress}
            organizing={organizing}
            organizeLog={organizeLog}
            onImportCancel={handleImportCancel}
            onImportComplete={handleImportComplete}
            onChooseRoot={handleChooseRoot}
            onNormalizeDescriptions={handleNormalizeDescriptions}
            normalizingDescriptions={normalizingDescriptions}
            missingFiles={missingFiles}
            onRelinkMissing={handleRelinkMissing}
            onRemoveMissing={handleRemoveMissing}
            onRescanMissing={handleRescanMissing}
            libraryItems={libraryItems}
            previousView={previousView}
            onEditItemUpdate={refreshLibrary}
            editCoverUrl={selectedItemId ? coverOverrides[selectedItemId] : null}
            detailsVersion={editDetailsVersion}
            matchQuery={editMatchQuery}
            onMatchQueryChange={setEditMatchQuery}
            matchLoading={editMatchLoading}
            matchCandidates={editMatchCandidates}
            onMatchSearch={handleEditMatchSearch}
            onMatchApply={handleEditMatchApply}
            matchApplyingId={editMatchApplying}
            newTagName={newTagName}
            setNewTagName={setNewTagName}
            newTagColor={newTagColor}
            setNewTagColor={setNewTagColor}
            handleCreateTag={handleCreateTag}
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

      {(view === "library" || view === "library-books" || view === "library-authors" || view === "library-series") ? (
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
        />
      ) : null}
    </div>
  );
}

export default App;
