import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { check } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import type {
  Author,
  DuplicateGroup,
  EnrichmentCandidate,
  EReaderBook,
  EReaderDevice,
  InboxItem,
  LibraryFilter,
  LibraryHealth,
  LibraryItem,
  OrganizePlan,
  PendingChange,
  ScanProgress,
  ScanStats,
  SyncQueueItem,
  Tag,
  View,
} from "./types/library";
import { MatchModal } from "./components/MatchModal";
import { TAG_COLORS } from "./lib/tagColors";
import { Sidebar } from "./sections/Sidebar";
import { TopToolbar } from "./sections/TopToolbar";
import { LibraryView } from "./sections/LibraryView";
import { Inspector } from "./sections/Inspector";
import { StatusBar } from "./sections/StatusBar";
import { InboxView } from "./sections/InboxView";
import { DuplicatesView } from "./sections/DuplicatesView";
import { FixView } from "./sections/FixView";
import { ChangesView } from "./sections/ChangesView";
import { TagsView } from "./sections/TagsView";
import { AuthorsView } from "./sections/AuthorsView";
import { SeriesView } from "./sections/SeriesView";
import { EReaderView } from "./sections/EReaderView";

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

const samplePendingChanges: PendingChange[] = [
  {
    id: "pc1",
    file_id: "f1",
    change_type: "rename",
    from_path: "/samples/Old Name.epub",
    to_path: "/samples/New Name.epub",
    status: "pending",
    created_at: Date.now(),
  },
  {
    id: "pc2",
    file_id: "f2",
    change_type: "epub_meta",
    from_path: "/samples/Book.epub",
    changes_json: "{\"title\":\"New Title\",\"author\":\"New Author\"}",
    status: "pending",
    created_at: Date.now(),
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
  const [grid, setGrid] = useState(true);
  const [query, setQuery] = useState("");
  const [libraryFilter, setLibraryFilter] = useState<LibraryFilter>("all");
  const [selectedTagIds, setSelectedTagIds] = useState<string[]>([]);
  const [scanStatus, setScanStatus] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  const [scanStartedAt, setScanStartedAt] = useState<number | null>(null);
  const [scanProgress, setScanProgress] = useState<ScanProgress | null>(null);
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
  const [matchQuery, setMatchQuery] = useState("");
  const [coverRefreshToken, setCoverRefreshToken] = useState(0);
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
          series: item.series ?? null,
        }))
      : sampleBooks.map((book) => ({
          ...book,
          authors: [book.author],
          series: null as string | null,
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

  const fetchCoverOverride = useCallback(async (itemId: string) => {
    if (!isTauri()) return;
    if (typeof coverOverrideRef.current[itemId] === "string") return;
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

  // Load eReader devices
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
        const stats = await invoke<ScanStats>("scan_folder", {
          root: selection,
        });
        setScanStatus(
          `Scan complete: ${stats.added} added, ${stats.updated} updated, ${stats.moved} moved.`
        );
        await refreshLibrary();
        setScanProgress(null);
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
    }).then((stop) => {
      unlistenComplete = stop;
    });

    let unlistenError: (() => void) | undefined;
    listen<string>("scan-error", (event) => {
      setScanProgress(null);
      setScanning(false);
      setScanStatus(`Scan failed: ${event.payload}`);
    }).then((stop) => {
      unlistenError = stop;
    });

    return () => {
      if (unlistenProgress) unlistenProgress();
      if (unlistenComplete) unlistenComplete();
      if (unlistenError) unlistenError();
    };
  }, [isDesktop, scanStartedAt, scanning]);

  const currentFixItem = inbox.length ? inbox[0] : inboxItems[0] ?? null;
  const candidateList = isDesktop ? fixCandidates : sampleFixCandidates;

  const handleFetchCandidates = async () => {
    if (!currentFixItem) return;
    if (!isTauri()) {
      setFixCandidates([]);
      return;
    }
    setFixLoading(true);
    try {
      const candidates = await invoke<EnrichmentCandidate[]>(
        "get_fix_candidates",
        {
          itemId: currentFixItem.id,
        }
      );
      setFixCandidates(candidates);
    } catch {
      setScanStatus("Could not fetch enrichment candidates.");
    } finally {
      setFixLoading(false);
    }
  };

  const handleApplyCandidate = async (candidate: EnrichmentCandidate) => {
    if (!currentFixItem || !isTauri()) return;
    try {
      await invoke("apply_fix_candidate", {
        itemId: currentFixItem.id,
        candidate,
      });
      const queued = await refreshPendingChanges();
      setScanStatus(
        queued > 0
          ? `Metadata updated. ${queued} file changes queued.`
          : "Metadata updated."
      );
      await fetchCoverOverride(currentFixItem.id);
      await refreshLibrary();
      setFixCandidates([]);
    } catch {
      setScanStatus("Could not apply metadata.");
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
      await refreshLibrary();
    } catch {
      setOrganizeStatus("Could not apply organize plan.");
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
        scanEtaLabel={scanEtaLabel}
        organizeMode={organizeMode}
        setOrganizeMode={setOrganizeMode}
        organizeTemplate={organizeTemplate}
        setOrganizeTemplate={setOrganizeTemplate}
        organizePlan={organizePlan}
        handleApplyOrganize={handleApplyOrganize}
        handleQueueOrganize={handleQueueOrganize}
        organizeStatus={organizeStatus}
        libraryHealth={libraryHealth}
        handleClearLibrary={handleClearLibrary}
        appVersion={appVersion}
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

        {scanning && scanProgress ? (
          <div className="flex flex-col gap-2 rounded-lg border border-[var(--app-border)] bg-white/70 px-3 py-2">
            <div className="text-[10px] uppercase tracking-[0.2em] text-[var(--app-ink-muted)]">
              Scanning {scanProgress.processed} of {scanProgress.total || "?"}
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-[rgba(208,138,70,0.2)]">
              <div
                className="h-full rounded-full bg-[linear-gradient(90deg,var(--app-accent),var(--app-accent-strong))] transition-[width] duration-200"
                style={{
                  width:
                    scanProgress.total > 0
                      ? `${Math.min(
                          100,
                          Math.round(
                            (scanProgress.processed / scanProgress.total) * 100
                          )
                        )}%`
                      : "6%",
                }}
              />
            </div>
            <div className="truncate text-[10px] text-[var(--app-ink-muted)]">
              {scanProgress.current}
            </div>
            {scanEtaSeconds !== null ? (
              <div className="text-[10px] text-[var(--app-ink-muted)]">
                ETA {formatEta(scanEtaSeconds)}
              </div>
            ) : null}
          </div>
        ) : scanning ? (
          <div className="flex flex-col gap-2 rounded-lg border border-[var(--app-border)] bg-white/70 px-3 py-2">
            <div className="text-[10px] uppercase tracking-[0.2em] text-[var(--app-ink-muted)]">
              Preparing scan…
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-[rgba(208,138,70,0.2)]">
              <div className="h-full w-1/3 animate-pulse rounded-full bg-[linear-gradient(90deg,var(--app-accent),var(--app-accent-strong))]" />
            </div>
            <div className="text-[10px] text-[var(--app-ink-muted)]">Collecting files…</div>
          </div>
        ) : null}

        <div className="flex flex-col gap-4">
          <section className="flex flex-col gap-4">
            {(view === "library" || view === "library-books") ? (
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
                setSelectedSeries={setSelectedSeries}
                setView={setView}
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
                currentFixItem={currentFixItem}
                fixLoading={fixLoading}
                candidateList={candidateList}
                getCandidateCoverUrl={getCandidateCoverUrl}
                handleFetchCandidates={handleFetchCandidates}
                handleApplyCandidate={handleApplyCandidate}
                isDesktop={isDesktop}
              />
            ) : null}

            {view === "changes" ? (
              <ChangesView
                pendingChangesStatus={pendingChangesStatus}
                setPendingChangesStatus={setPendingChangesStatus}
                pendingChangesApplying={pendingChangesApplying}
                pendingChangesLoading={pendingChangesLoading}
                pendingChanges={isDesktop ? pendingChanges : samplePendingChanges}
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
                scanning={ereaderScanning}
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
          candidates={matchCandidates}
          onQueryChange={setMatchQuery}
          onSearch={handleMatchSearch}
          onApply={handleMatchApply}
          onClose={() => setMatchOpen(false)}
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
