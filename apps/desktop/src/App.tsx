import { getVersion } from "@tauri-apps/api/app";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { relaunch } from "@tauri-apps/plugin-process";
import { check } from "@tauri-apps/plugin-updater";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { MatchModal } from "./components/MatchModal";
import { ScanProgressBar } from "./components/ProgressBar";
import { SyncConfirmDialog } from "./components/SyncConfirmDialog";
import { TAG_COLORS } from "./lib/tagColors";
import { AuthorsView } from "./sections/AuthorsView";
import { BookEditView } from "./sections/BookEditView";
import { ChangesView } from "./sections/ChangesView";
import { DuplicatesView } from "./sections/DuplicatesView";
import { EReaderView } from "./sections/EReaderView";
import { FixView } from "./sections/FixView";
import { InboxView } from "./sections/InboxView";
import { Inspector } from "./sections/Inspector";
import { LibraryView } from "./sections/LibraryView";
import { OrganizerView } from "./sections/OrganizerView"; // Re-adding import
import { SeriesView } from "./sections/SeriesView";
import { Sidebar } from "./sections/Sidebar";
import { StatusBar } from "./sections/StatusBar";
import { TagsView } from "./sections/TagsView";
import { TopToolbar } from "./sections/TopToolbar";
import type {
  ActivityLogItem,
  Author,
  DuplicateGroup,
  EnrichmentCandidate,
  EReaderBook,
  EReaderDevice,
  FixFilter,
  InboxItem,
  ItemMetadata,
  LibraryFilter,
  LibraryHealth,
  LibraryItem,
  OperationProgress,
  OperationStats,
  OrganizePlan,
  PendingChange,
  ScanProgress,
  ScanStats,
  SyncProgress,
  SyncQueueItem,
  Tag,
  View
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

const duplicateGroups = [
  {
    id: "d1",
    title: "The Shallows",
    files: ["The Shallows.epub", "The Shallows (1).epub"],
    file_ids: ["d1-file-1", "d1-file-2"],
    file_paths: ["/samples/The Shallows.epub", "/samples/The Shallows (1).epub"],
  },
  {
    id: "d2",
    title: "Silent Spring",
    files: ["Silent Spring.pdf", "Silent Spring - copy.pdf"],
    file_ids: ["d2-file-1", "d2-file-2"],
    file_paths: ["/samples/Silent Spring.pdf", "/samples/Silent Spring - copy.pdf"],
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
  const [selectedTagIds, setSelectedTagIds] = useState<string[]>([]);
  const [scanStatus, setScanStatus] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  const [scanStartedAt, setScanStartedAt] = useState<number | null>(null);
  const [scanProgress, setScanProgress] = useState<ScanProgress | null>(null);
  const [enriching, setEnriching] = useState(false);
  const [enrichingItems, setEnrichingItems] = useState<Set<string>>(new Set());
  const [enrichProgress, setEnrichProgress] = useState<OperationProgress | null>(null);
  const [libraryItems, setLibraryItems] = useState<LibraryItem[]>([]);
  const [libraryReady, setLibraryReady] = useState(false);
  const [inbox, setInbox] = useState<InboxItem[]>([]);
  const [duplicates, setDuplicates] = useState<DuplicateGroup[]>([]);
  const [fixCandidates, setFixCandidates] = useState<EnrichmentCandidate[]>([]);
  const [fixLoading, setFixLoading] = useState(false);
  const [organizePlan, setOrganizePlan] = useState<OrganizePlan | null>(null);
  const [organizeStatus, setOrganizeStatus] = useState<string | null>(null);
  const [organizeMode, setOrganizeMode] = useState("copy");
  const [organizeTemplate, setOrganizeTemplate] = useState(
    "{Author}/{Title} ({Year}) [{ISBN13}].{ext}"
  );
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const [matchOpen, setMatchOpen] = useState(false);
  const [matchCandidates, setMatchCandidates] = useState<EnrichmentCandidate[]>([]);
  const [matchLoading, setMatchLoading] = useState(false);
  const [matchApplying, setMatchApplying] = useState<string | null>(null);
  const [matchApplyProgress, setMatchApplyProgress] = useState<{
    step: string;
    message: string;
    current: number;
    total: number;
  } | null>(null);
  const [matchQuery, setMatchQuery] = useState("");
  const [coverRefreshToken, setCoverRefreshToken] = useState(0);


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
  const [coverOverrides, setCoverOverrides] = useState<Record<string, string | null>>({});
  const coverOverrideRef = useRef<Record<string, string | null>>({});
  const [libraryHealth, setLibraryHealth] = useState<LibraryHealth | null>(null);
  const [duplicateKeepSelection, setDuplicateKeepSelection] = useState<
    Record<string, string>
  >({});
  const [pendingChanges, setPendingChanges] = useState<PendingChange[]>([]);
  const [pendingChangesLoading, setPendingChangesLoading] = useState(false);
  const [pendingChangesApplying, setPendingChangesApplying] = useState(false);
  const [pendingChangesStatus, setPendingChangesStatus] = useState<
    "pending" | "applied" | "error"
  >("pending");
  const [applyingChangeIds, setApplyingChangeIds] = useState<Set<string>>(new Set());
  const [changeProgress, setChangeProgress] = useState<OperationProgress | null>(null);
  const [updateStatus, setUpdateStatus] = useState<string | null>(null);
  const [appVersion, setAppVersion] = useState<string | null>(null);
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

  // eReader state
  const [ereaderDevices, setEreaderDevices] = useState<EReaderDevice[]>([]);
  const [selectedEreaderDeviceId, setSelectedEreaderDeviceId] = useState<string | null>(null);
  const [ereaderBooks, setEreaderBooks] = useState<EReaderBook[]>([]);
  const [ereaderSyncQueue, setEreaderSyncQueue] = useState<SyncQueueItem[]>([]);
  const [ereaderScanning, setEreaderScanning] = useState(false);
  const [ereaderSyncDialogOpen, setEreaderSyncDialogOpen] = useState(false);
  const [ereaderSyncing, setEreaderSyncing] = useState(false);
  const [ereaderSyncProgress, setEreaderSyncProgress] = useState<SyncProgress | null>(null);

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

  const checkForUpdates = useCallback(async (silent = false) => {
    if (!isTauri()) return;
    try {
      console.info("[updater] check start", { silent });
      if (!silent) setUpdateStatus("Checking for updates…");
      const result = await check();
      if (!result) {
        console.info("[updater] no update available");
        if (!silent) setUpdateStatus("No updates found.");
        return;
      }
      console.info("[updater] update available", {
        version: result.version,
        currentVersion: result.currentVersion,
      });
      setUpdateStatus(`Update ${result.version} available. Downloading…`);
      await result.downloadAndInstall();
      console.info("[updater] download complete, relaunching");
      setUpdateStatus("Update downloaded. Restarting…");
      await relaunch();
    } catch (error) {
      console.error("[updater] check failed", error);
      if (!silent) {
        const message = error instanceof Error ? error.message : String(error ?? "Update failed.");
        setUpdateStatus(`Update failed: ${message}`);
      }
    }
  }, []);

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
  const isDesktop =
    isTauri() ||
    (typeof window !== "undefined" &&
      Boolean((window as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__));

  // Derived filter data
  const uniqueAuthors = useMemo((): Author[] => {
    const counts = new Map<string, number>();
    libraryItems.forEach((item) => {
      item.authors.forEach((author) => {
        counts.set(author, (counts.get(author) || 0) + 1);
      });
    });
    return Array.from(counts.entries())
      .map(([name, bookCount]) => ({ name, bookCount }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [libraryItems]);

  const uniqueSeries = useMemo((): Array<{ name: string; bookCount: number }> => {
    const series = new Map<string, number>();
    libraryItems.forEach((item) => {
      if (item.series) {
        series.set(item.series, (series.get(item.series) || 0) + 1);
      }
    });
    return Array.from(series.entries())
      .map(([name, bookCount]) => ({ name, bookCount }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [libraryItems]);

  // Books needing metadata fixes based on filter
  const booksNeedingFix = useMemo(() => {
    return libraryItems.filter((item) => {
      if (fixFilter.missingAuthor && item.authors.length === 0) return true;
      if (fixFilter.missingTitle && !item.title) return true;
      if (fixFilter.missingCover && !item.cover_path) return true;
      if (fixFilter.missingYear && !item.published_year) return true;
      if (fixFilter.missingLanguage && !item.language) return true;
      if (fixFilter.missingSeries && !item.series) return true;
      return false;
    });
  }, [libraryItems, fixFilter]);

  // Combine with inbox items if includeIssues is true
  const allFixItems = useMemo(() => {
    const fixItemIds = new Set(booksNeedingFix.map((item) => item.id));

    const result = [...booksNeedingFix];
    if (fixFilter.includeIssues) {
      inbox.forEach((inboxItem) => {
        if (!fixItemIds.has(inboxItem.id)) {
          const libraryItem = libraryItems.find((li) => li.id === inboxItem.id);
          if (libraryItem) {
            result.push(libraryItem);
          }
        }
      });
    }
    return result;
  }, [booksNeedingFix, inbox, fixFilter.includeIssues, libraryItems]);

  useEffect(() => {
    if (!isDesktop) return;
    getVersion()
      .then((version) => setAppVersion(version))
      .catch(() => {
        setAppVersion(null);
      });
  }, [isDesktop]);

  const filteredBooks = useMemo(() => {
    const base = isDesktop
      ? libraryItems.map((item) => ({
        id: item.id,
        title: item.title ?? "Untitled",
        author: item.authors.length ? item.authors.join(", ") : "Unknown",
        authors: item.authors,
        format: item.formats[0] ?? "FILE",
        year: item.published_year ?? "—",
        status: item.title && item.authors.length ? "Complete" : "Needs Metadata",
        cover: typeof coverOverrides[item.id] === "string" ? coverOverrides[item.id] : null,
        tags: item.tags ?? [],
        language: item.language ?? null,
        series: item.series ?? null,
        seriesIndex: item.series_index ?? null,
      }))
      : sampleBooks.map((book) => ({
        ...book,
        authors: [book.author],
        language: null as string | null,
        series: null as string | null,
        seriesIndex: null as number | null,
      }));

    // Format filter
    const filteredByFormat = base.filter((book) => {
      const normalizedFormat = String(book.format)
        .replace(".", "")
        .toLowerCase();
      switch (libraryFilter) {
        case "epub":
          return normalizedFormat.includes("epub");
        case "pdf":
          return normalizedFormat.includes("pdf");
        case "needs-metadata":
          return book.status !== "Complete";
        case "tagged":
          return (book.tags ?? []).length > 0;
        default:
          return true;
      }
    });

    // Tag filter (AND-logic)
    const filteredByTags = selectedTagIds.length
      ? filteredByFormat.filter((book) =>
        selectedTagIds.every((tagId) =>
          (book.tags ?? []).some((tag) => tag.id === tagId)
        )
      )
      : filteredByFormat;

    // Author filter (for navigation from Authors view)
    const filteredByAuthors = selectedAuthorNames.length
      ? filteredByTags.filter((book) =>
        selectedAuthorNames.some((name) => book.authors.includes(name))
      )
      : filteredByTags;

    // Series filter (for navigation from Series view)
    const filteredBySeries = selectedSeries.length
      ? filteredByAuthors.filter(
        (book) => book.series && selectedSeries.includes(book.series)
      )
      : filteredByAuthors;

    // Search query
    if (!query) return filteredBySeries;
    const lowered = query.toLowerCase();
    return filteredBySeries.filter(
      (book) =>
        book.title.toLowerCase().includes(lowered) ||
        book.author.toLowerCase().includes(lowered)
    );
  }, [
    query,
    libraryItems,
    isDesktop,
    coverOverrides,
    libraryFilter,
    selectedTagIds,
    selectedAuthorNames,
    selectedSeries,
  ]);

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

  useEffect(() => {
    void checkForUpdates(true);
  }, [checkForUpdates]);

  // Load eReader devices and poll connection status periodically
  useEffect(() => {
    if (!isDesktop) return;
    const loadEreaderDevices = async () => {
      try {
        const devices = await invoke<EReaderDevice[]>("list_ereader_devices");
        setEreaderDevices(devices);
        if (devices.length > 0 && !selectedEreaderDeviceId) {
          setSelectedEreaderDeviceId(devices[0].id);
        }
      } catch {
        setEreaderDevices([]);
      }
    };
    void loadEreaderDevices();
    // Poll every 3 seconds to detect device connect/disconnect
    const interval = window.setInterval(loadEreaderDevices, 3000);
    return () => window.clearInterval(interval);
  }, [isDesktop, selectedEreaderDeviceId]);

  // Load sync queue when device changes
  useEffect(() => {
    if (!isDesktop || !selectedEreaderDeviceId) return;
    const loadQueue = async () => {
      try {
        const queue = await invoke<SyncQueueItem[]>("get_sync_queue", { deviceId: selectedEreaderDeviceId });
        setEreaderSyncQueue(queue);
      } catch {
        setEreaderSyncQueue([]);
      }
    };
    void loadQueue();
  }, [isDesktop, selectedEreaderDeviceId]);

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

  const selectedItem = useMemo(() => {
    if (!selectedItemId) return null;
    return filteredBooks.find((book) => book.id === selectedItemId) ?? null;
  }, [filteredBooks, selectedItemId]);

  const selectedTags = useMemo(() => selectedItem?.tags ?? [], [selectedItem]);
  const availableTags = useMemo(
    () => tags.filter((tag) => !selectedTags.some((selected) => selected.id === tag.id)),
    [tags, selectedTags]
  );

  // Find available languages for the selected item (other editions with same title/author)
  const availableLanguages = useMemo(() => {
    if (!selectedItem) return [];
    const normalizeTitle = (t: string) => t.toLowerCase().replace(/[^\w\s]/g, "").trim();
    const selectedTitle = normalizeTitle(selectedItem.title);
    const selectedAuthor = selectedItem.author.toLowerCase();

    const languages = new Set<string>();
    libraryItems.forEach((item) => {
      if (!item.language) return;
      const itemTitle = normalizeTitle(item.title ?? "");
      const itemAuthors = item.authors.map((a) => a.toLowerCase());
      // Match if title is similar and at least one author matches
      if (itemTitle === selectedTitle && itemAuthors.some((a) => selectedAuthor.includes(a) || a.includes(selectedAuthor))) {
        languages.add(item.language);
      }
    });
    return Array.from(languages).sort();
  }, [selectedItem, libraryItems]);

  const scanEtaSeconds = useMemo(() => {
    if (!scanProgress || !scanStartedAt || scanProgress.total === 0) return null;
    const elapsedSeconds = (Date.now() - scanStartedAt) / 1000;
    if (elapsedSeconds < 1 || scanProgress.processed === 0) return null;
    const rate = scanProgress.processed / elapsedSeconds;
    if (!Number.isFinite(rate) || rate <= 0) return null;
    const remaining = (scanProgress.total - scanProgress.processed) / rate;
    if (!Number.isFinite(remaining) || remaining < 0) return null;
    return Math.round(remaining);
  }, [scanProgress, scanStartedAt]);
  const scanEtaLabel = scanEtaSeconds !== null ? formatEta(scanEtaSeconds) : null;

  const getCandidateCoverUrl = (candidate: EnrichmentCandidate) => {
    if (candidate.cover_url) return candidate.cover_url;
    const isbn = candidate.identifiers
      .map((value) => value.replace(/[^0-9Xx]/g, "").toUpperCase())
      .find((value) => value.length === 13 || value.length === 10);
    if (!isbn) return null;
    return `https://covers.openlibrary.org/b/isbn/${isbn}-M.jpg`;
  };

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
        const duplicateGroups = await invoke<DuplicateGroup[]>(
          "get_duplicate_groups"
        );
        setDuplicates(duplicateGroups);
        const health = await invoke<LibraryHealth>("get_library_health");
        setLibraryHealth(health);
        setCoverRefreshToken((value) => value + 1);
      } catch {
        setScanStatus("Could not load library data.");
      } finally {
        setLibraryReady(true);
      }
    };
    load();
  }, []);

  const refreshLibrary = useCallback(async () => {
    if (!isTauri()) return;
    try {
      const items = await invoke<LibraryItem[]>("get_library_items");
      setLibraryItems(items);
      const inboxItems = await invoke<InboxItem[]>("get_inbox_items");
      setInbox(inboxItems);
      const duplicateGroups = await invoke<DuplicateGroup[]>(
        "get_duplicate_groups"
      );
      setDuplicates(duplicateGroups);
      const health = await invoke<LibraryHealth>("get_library_health");
      setLibraryHealth(health);
      setCoverRefreshToken((value) => value + 1);
    } catch {
      setScanStatus("Could not refresh library data.");
    }
  }, []);

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
      setLibraryItems([]);
      setInbox([]);
      setDuplicates([]);
      await refreshLibrary();
    } catch (error) {
      if (error instanceof Error) {
        setScanStatus(`Could not clear library: ${error.message}`);
      } else {
        setScanStatus("Could not clear library.");
      }
    }
  };

  useEffect(() => {
    if (!scanning) return;
    const interval = setInterval(() => {
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

  // Listen for eReader sync progress events
  useEffect(() => {
    if (!isDesktop) return;
    let unlistenSyncProgress: (() => void) | undefined;
    let unlistenSyncComplete: (() => void) | undefined;

    listen<SyncProgress>("sync-progress", (event) => {
      console.log("sync-progress event:", event.payload);
      setEreaderSyncProgress(event.payload);
      if (!ereaderSyncing) setEreaderSyncing(true);
    }).then((stop) => {
      unlistenSyncProgress = stop;
    });

    listen<{ added: number; removed: number; imported: number; errors: string[] }>("sync-complete", (event) => {
      setEreaderSyncProgress(null);
      setEreaderSyncing(false);
      const parts: string[] = [];
      if (event.payload.added > 0) parts.push(`${event.payload.added} added`);
      if (event.payload.removed > 0) parts.push(`${event.payload.removed} removed`);
      if (event.payload.imported > 0) parts.push(`${event.payload.imported} imported`);
      if (event.payload.errors.length > 0) parts.push(`${event.payload.errors.length} errors`);
      setScanStatus(`Sync complete: ${parts.join(", ")}`);
      setActivityLog((prev) => [
        {
          id: `sync-${Date.now()}`,
          type: "sync",
          message: `Synced: ${parts.join(", ")}`,
          timestamp: Date.now(),
        },
        ...prev,
      ]);
      setEreaderSyncDialogOpen(false);
      // Refresh the queue
      if (selectedEreaderDeviceId) {
        invoke<SyncQueueItem[]>("get_sync_queue", { deviceId: selectedEreaderDeviceId })
          .then(setEreaderSyncQueue)
          .catch(() => setEreaderSyncQueue([]));
      }
    }).then((stop) => {
      unlistenSyncComplete = stop;
    });

    return () => {
      if (unlistenSyncProgress) unlistenSyncProgress();
      if (unlistenSyncComplete) unlistenSyncComplete();
    };
  }, [isDesktop, ereaderSyncing, selectedEreaderDeviceId]);

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
  }, [isDesktop]); // Removed enriching and refreshLibrary from deps to prevent re-registration

  // Listen for apply-metadata-progress events (single item metadata apply)
  useEffect(() => {
    if (!isDesktop) return;
    let unlisten: (() => void) | undefined;

    listen<{ itemId: string; step: string; message: string; current: number; total: number }>(
      "apply-metadata-progress",
      (event) => {
        setMatchApplyProgress({
          step: event.payload.step,
          message: event.payload.message,
          current: event.payload.current,
          total: event.payload.total,
        });
      }
    ).then((stop) => {
      unlisten = stop;
    });

    return () => {
      if (unlisten) unlisten();
    };
  }, [isDesktop]);

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
          status: pendingChangesStatus,
        });
        setPendingChanges(result);
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
  }, [isDesktop]);

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

  const handleOpenMatchModal = async () => {
    if (!selectedItemId) return;
    setMatchQuery(selectedItem?.title ?? "");
    setMatchOpen(true);
    if (!isTauri()) {
      setMatchCandidates(sampleFixCandidates);
      return;
    }
    setMatchLoading(true);
    try {
      const candidates = await invoke<EnrichmentCandidate[]>(
        "get_fix_candidates",
        {
          itemId: selectedItemId,
        }
      );
      setMatchCandidates(candidates.slice(0, 5));
    } catch {
      setScanStatus("Could not fetch match candidates.");
      setMatchCandidates([]);
    } finally {
      setMatchLoading(false);
    }
  };

  const handleMatchSearch = async () => {
    if (!matchQuery.trim()) return;
    if (!isTauri()) {
      setMatchCandidates(sampleFixCandidates);
      return;
    }
    setMatchLoading(true);
    try {
      const candidates = await invoke<EnrichmentCandidate[]>("search_candidates", {
        query: matchQuery,
        itemId: selectedItemId ?? undefined,
      });
      setMatchCandidates(candidates.slice(0, 5));
    } catch {
      setScanStatus("Could not search metadata sources.");
      setMatchCandidates([]);
    } finally {
      setMatchLoading(false);
    }
  };

  const handleMatchApply = async (candidate: EnrichmentCandidate) => {
    if (!selectedItemId || !isTauri()) return;
    setMatchApplying(candidate.id);
    setMatchApplyProgress(null);
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
      setMatchOpen(false);
      setMatchCandidates([]);
      // Clear any cached cover and fetch the new one from the backend
      clearCoverOverride(selectedItemId);
      await fetchCoverOverride(selectedItemId);
      await refreshLibrary();
    } catch {
      setScanStatus("Could not apply metadata.");
    } finally {
      setMatchApplying(null);
      setMatchApplyProgress(null);
    }
  };

  const handlePlanOrganize = async () => {
    if (!isTauri()) {
      setOrganizeStatus("Organizer requires the Tauri desktop runtime.");
      return;
    }
    try {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const selection = await open({ directory: true, multiple: false });
      if (typeof selection !== "string") return;
      const plan = await invoke<OrganizePlan>("plan_organize", {
        mode: organizeMode,
        libraryRoot: selection,
        template: organizeTemplate,
      });
      setOrganizePlan(plan);
      setOrganizeStatus(`Prepared ${plan.entries.length} actions.`);
    } catch {
      setOrganizeStatus("Could not prepare organize plan.");
    }
  };

  const handleApplyOrganize = async () => {
    if (!organizePlan || !isTauri()) return;
    try {
      const logPath = await invoke<string>("apply_organize", {
        plan: organizePlan,
      });
      setOrganizeStatus(`Organized files. Log saved to ${logPath}`);
      setActivityLog((prev) => [
        {
          id: `organize-${Date.now()}`,
          type: "organize",
          message: `Organized ${organizePlan.entries.length} items`,
          timestamp: Date.now(),
        },
        ...prev,
      ]);
      await refreshLibrary();
    } catch (err) {
      console.error("Organize error:", err);
      setOrganizeStatus(`Error: ${err}`);
    }
  };

  const handleQueueOrganize = async () => {
    if (!organizePlan || !isTauri()) return;
    try {
      const created = await invoke<number>("generate_pending_changes_from_organize", {
        plan: organizePlan,
      });
      setOrganizeStatus(`Queued ${created} changes for review.`);
      setView("changes");
    } catch {
      setOrganizeStatus("Could not queue organize plan.");
    }
  };

  const handleResolveDuplicate = async (groupId: string, keepFileId: string) => {
    if (!isTauri()) return;
    try {
      await invoke("resolve_duplicate_group", { groupId, keepFileId });
      setScanStatus("Duplicate resolved.");
      await refreshLibrary();
      setDuplicateKeepSelection((prev) => {
        const next = { ...prev };
        delete next[groupId];
        return next;
      });
    } catch {
      setScanStatus("Could not resolve duplicate.");
    }
  };

  // eReader handlers
  const handleAddEreaderDevice = async (name: string, mountPath: string) => {
    if (!isTauri()) return;
    try {
      const device = await invoke<EReaderDevice>("add_ereader_device", { name, mountPath });
      setEreaderDevices((prev) => [...prev, device]);
      setSelectedEreaderDeviceId(device.id);
    } catch {
      setScanStatus("Could not add eReader device.");
    }
  };

  const handleRemoveEreaderDevice = async (deviceId: string) => {
    if (!isTauri()) return;
    try {
      await invoke("remove_ereader_device", { deviceId });
      setEreaderDevices((prev) => prev.filter((d) => d.id !== deviceId));
      if (selectedEreaderDeviceId === deviceId) {
        setSelectedEreaderDeviceId(null);
      }
    } catch {
      setScanStatus("Could not remove eReader device.");
    }
  };

  const handleScanEreaderDevice = async (deviceId: string) => {
    if (!isTauri()) return;
    setEreaderScanning(true);
    try {
      const books = await invoke<EReaderBook[]>("scan_ereader", { deviceId });
      setEreaderBooks(books);
    } catch {
      setScanStatus("Could not scan eReader device.");
    } finally {
      setEreaderScanning(false);
    }
  };

  const handleQueueEreaderAdd = async (itemId: string) => {
    if (!isTauri() || !selectedEreaderDeviceId) return;
    try {
      const item = await invoke<SyncQueueItem>("queue_sync_action", {
        deviceId: selectedEreaderDeviceId,
        action: "add",
        itemId,
        ereaderPath: null,
      });
      setEreaderSyncQueue((prev) => [...prev, item]);
    } catch {
      setScanStatus("Could not queue book for sync.");
    }
  };

  const handleQueueEreaderRemove = async (ereaderPath: string) => {
    if (!isTauri() || !selectedEreaderDeviceId) return;
    try {
      const item = await invoke<SyncQueueItem>("queue_sync_action", {
        deviceId: selectedEreaderDeviceId,
        action: "remove",
        itemId: null,
        ereaderPath,
      });
      setEreaderSyncQueue((prev) => [...prev, item]);
    } catch {
      setScanStatus("Could not queue book for removal.");
    }
  };

  const handleQueueEreaderImport = async (ereaderPath: string) => {
    if (!isTauri() || !selectedEreaderDeviceId) return;
    try {
      const item = await invoke<SyncQueueItem>("queue_sync_action", {
        deviceId: selectedEreaderDeviceId,
        action: "import",
        itemId: null,
        ereaderPath,
      });
      setEreaderSyncQueue((prev) => [...prev, item]);
    } catch {
      setScanStatus("Could not queue book for import.");
    }
  };

  const handleRemoveFromEreaderQueue = async (queueId: string) => {
    if (!isTauri()) return;
    try {
      await invoke("remove_from_sync_queue", { queueId });
      setEreaderSyncQueue((prev) => prev.filter((q) => q.id !== queueId));
    } catch {
      setScanStatus("Could not remove from sync queue.");
    }
  };

  const handleOpenSyncDialog = () => {
    setEreaderSyncDialogOpen(true);
  };

  const handleExecuteEreaderSync = async () => {
    if (!isTauri() || !selectedEreaderDeviceId) return;
    setEreaderSyncing(true);
    try {
      const result = await invoke<{ added: number; removed: number; imported: number; errors: string[] }>("execute_sync", {
        deviceId: selectedEreaderDeviceId,
      });

      // Refresh data
      const queue = await invoke<SyncQueueItem[]>("get_sync_queue", { deviceId: selectedEreaderDeviceId });
      setEreaderSyncQueue(queue);

      const books = await invoke<EReaderBook[]>("scan_ereader", { deviceId: selectedEreaderDeviceId });
      setEreaderBooks(books);

      await refreshLibrary();

      // Show result
      const parts = [];
      if (result.added > 0) parts.push(`${result.added} added`);
      if (result.removed > 0) parts.push(`${result.removed} removed`);
      if (result.imported > 0) parts.push(`${result.imported} imported`);
      if (result.errors.length > 0) parts.push(`${result.errors.length} errors`);

      setScanStatus(`Sync complete: ${parts.join(", ")}`);
      setEreaderSyncDialogOpen(false);
    } catch {
      setScanStatus("Sync failed.");
    } finally {
      setEreaderSyncing(false);
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
        scanStatus={scanStatus}
        scanning={scanning}
        scanStartedAt={scanStartedAt}
        scanProgress={scanProgress}

        libraryHealth={libraryHealth}
        handleClearLibrary={handleClearLibrary}
        appVersion={appVersion}
        ereaderConnected={ereaderDevices.some((d) => d.isConnected)}
        activityLog={activityLog}
      />

      <main className="flex h-screen flex-col gap-4 overflow-y-auto px-6 py-4">
        <TopToolbar
          view={view}
          scanning={scanning}
          handleScan={handleScan}
          handlePlanOrganize={handlePlanOrganize}
          setView={setView}
          checkForUpdates={checkForUpdates}
          query={query}
          setQuery={setQuery}
          grid={grid}
          setGrid={setGrid}
          libraryReady={libraryReady}
          updateStatus={updateStatus}
        />

        <ScanProgressBar
          scanning={scanning}
          progress={scanProgress}
          etaLabel={scanEtaLabel}
          variant="accent"
        />

        <div className="flex flex-col gap-4">
          <section className="flex flex-col gap-4">
            {(view === "library" || view === "library-books") && !libraryReady && isDesktop ? (
              <div className="flex flex-col items-center justify-center gap-4 py-16">
                <div className="h-8 w-8 animate-spin rounded-full border-2 border-[var(--app-accent)] border-t-transparent" />
                <div className="text-sm text-[var(--app-ink-muted)]">Loading library...</div>
              </div>
            ) : null}

            {(view === "library" || view === "library-books") && libraryReady ? (
              <LibraryView
                isDesktop={isDesktop}
                libraryItemsLength={libraryItems.length}
                filteredBooks={filteredBooks}
                selectedItemId={selectedItemId}
                setSelectedItemId={setSelectedItemId}
                libraryFilter={libraryFilter}
                setLibraryFilter={setLibraryFilter}
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
              />
            ) : null}

            {view === "library-authors" ? (
              <AuthorsView
                authors={uniqueAuthors}
                setSelectedAuthorNames={setSelectedAuthorNames}
                setView={setView}
              />
            ) : null}

            {view === "library-series" ? (
              <SeriesView
                series={uniqueSeries}
                books={filteredBooks}
                setSelectedSeries={setSelectedSeries}
                setView={setView}
                onSelectBook={(bookId) => {
                  setSelectedItemId(bookId);
                  setView("library-books");
                }}
              />
            ) : null}

            {view === "inbox" ? (
              <InboxView items={isDesktop ? inbox : inboxItems} />
            ) : null}

            {view === "duplicates" ? (
              <DuplicatesView
                groups={isDesktop ? duplicates : duplicateGroups}
                duplicateKeepSelection={duplicateKeepSelection}
                setDuplicateKeepSelection={setDuplicateKeepSelection}
                handleResolveDuplicate={handleResolveDuplicate}
              />
            ) : null}

            {view === "fix" ? (
              <FixView
                items={allFixItems}
                inboxItems={isDesktop ? inbox : []}
                selectedItemId={selectedFixItemId}
                setSelectedItemId={setSelectedFixItemId}
                fixFilter={fixFilter}
                setFixFilter={setFixFilter}
                formData={fixFormData}
                setFormData={setFixFormData}
                searchQuery={fixSearchQuery}
                setSearchQuery={setFixSearchQuery}
                searchLoading={fixLoading}
                searchCandidates={fixCandidates}
                onSearch={() => {
                  if (!selectedFixItemId) return;
                  handleFetchCandidatesForItem(selectedFixItemId);
                }}
                onSearchWithQuery={async (query: string) => {
                  if (!selectedFixItemId || !isTauri()) return;
                  setFixLoading(true);
                  try {
                    const candidates = await invoke<EnrichmentCandidate[]>("search_candidates", {
                      query,
                      itemId: selectedFixItemId,
                    });
                    setFixCandidates(candidates);
                  } catch {
                    setScanStatus("Could not search metadata sources.");
                    setFixCandidates([]);
                  } finally {
                    setFixLoading(false);
                  }
                }}
                onApplyCandidate={async (candidate) => {
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
                    setFixCandidates([]);
                  } catch {
                    setScanStatus("Could not apply metadata.");
                  }
                }}
                onSaveMetadata={async (id, data) => {
                  if (!isDesktop) return;
                  setFixSaving(true);
                  try {
                    await invoke("save_item_metadata", { itemId: id, metadata: data });
                    setScanStatus("Metadata saved.");
                    await refreshLibrary();
                  } catch (e) {
                    console.error("Failed to save metadata", e);
                    setScanStatus("Could not save metadata.");
                  } finally {
                    setFixSaving(false);
                  }
                }}
                saving={fixSaving}
                getCandidateCoverUrl={getCandidateCoverUrl}
                isDesktop={isDesktop}
              />
            ) : null}

            {view === "changes" ? (
              <ChangesView
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
                confirmDeleteOpen={confirmDeleteOpen}
                confirmDeleteIds={confirmDeleteIds}
                setConfirmDeleteOpen={setConfirmDeleteOpen}
                setConfirmDeleteIds={setConfirmDeleteIds}
                handleConfirmDelete={handleConfirmDelete}
                applyingChangeIds={applyingChangeIds}
                changeProgress={changeProgress}
              />
            ) : null}

            {view === "organize" ? (
              <OrganizerView
                organizeMode={organizeMode}
                setOrganizeMode={setOrganizeMode}
                organizeTemplate={organizeTemplate}
                setOrganizeTemplate={setOrganizeTemplate}
                organizePlan={organizePlan}
                handlePlanOrganize={handlePlanOrganize}
                handleApplyOrganize={handleApplyOrganize}
                handleQueueOrganize={handleQueueOrganize}
                organizeStatus={organizeStatus}
              />
            ) : null}

            {view === "edit" ? (
              <BookEditView
                selectedItemId={selectedItemId}
                libraryItems={libraryItems}
                setView={setView}
                previousView={previousView}
                isDesktop={isDesktop}
                onItemUpdate={refreshLibrary}
                coverUrl={selectedItemId ? coverOverrides[selectedItemId] : null}
                onFetchCover={fetchCoverOverride}
                onClearCover={clearCoverOverride}
              />
            ) : null}


            {view === "tags" ? (
              <TagsView
                tags={tags}
                newTagName={newTagName}
                setNewTagName={setNewTagName}
                newTagColor={newTagColor}
                setNewTagColor={setNewTagColor}
                handleCreateTag={handleCreateTag}
              />
            ) : null}

            {view === "ereader" ? (
              <EReaderView
                devices={ereaderDevices}
                selectedDeviceId={selectedEreaderDeviceId}
                setSelectedDeviceId={setSelectedEreaderDeviceId}
                ereaderBooks={ereaderBooks}
                syncQueue={ereaderSyncQueue}
                libraryItems={libraryItems}
                onAddDevice={handleAddEreaderDevice}
                onRemoveDevice={handleRemoveEreaderDevice}
                onScanDevice={handleScanEreaderDevice}
                onQueueAdd={handleQueueEreaderAdd}
                onQueueRemove={handleQueueEreaderRemove}
                onQueueImport={handleQueueEreaderImport}
                onRemoveFromQueue={handleRemoveFromEreaderQueue}
                onExecuteSync={handleOpenSyncDialog}
                onRefreshDevices={async () => {
                  try {
                    const devices = await invoke<EReaderDevice[]>("list_ereader_devices");
                    setEreaderDevices(devices);
                  } catch {
                    // ignore
                  }
                }}
                scanning={ereaderScanning}
                syncing={ereaderSyncing}
                syncProgress={ereaderSyncProgress}
              />
            ) : null}
          </section>
        </div>

        <MatchModal
          open={matchOpen}
          itemTitle={selectedItem?.title ?? "Untitled"}
          itemAuthor={selectedItem?.author ?? "Unknown"}
          query={matchQuery}
          loading={matchLoading}
          applyingId={matchApplying}
          applyProgress={matchApplyProgress}
          candidates={matchCandidates}
          onQueryChange={setMatchQuery}
          onSearch={handleMatchSearch}
          onApply={handleMatchApply}
          onClose={() => setMatchOpen(false)}
        />

        <SyncConfirmDialog
          open={ereaderSyncDialogOpen}
          onClose={() => setEreaderSyncDialogOpen(false)}
          onConfirm={handleExecuteEreaderSync}
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
          handleAddTag={handleAddTag}
          handleRemoveTag={handleRemoveTag}
          handleOpenMatchModal={handleOpenMatchModal}
          isDesktop={isDesktop}
          clearCoverOverride={clearCoverOverride}
          fetchCoverOverride={fetchCoverOverride}
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
          onQueueEreaderAdd={handleQueueEreaderAdd}
          onNavigateToEdit={() => {
            setPreviousView(view);
            setView("edit");
          }}
        />
      ) : null}
    </div>
  );
}

function formatEta(totalSeconds: number) {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes > 0) {
    return `${minutes}m ${seconds}s`;
  }
  return `${seconds}s`;
}

export default App;
