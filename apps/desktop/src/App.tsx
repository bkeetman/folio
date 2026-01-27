import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import "./App.css";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { Button, Panel, SidebarItem } from "./components/ui";
import { MatchModal } from "./components/MatchModal";

type View = "library" | "inbox" | "duplicates" | "fix" | "changes";

type LibraryItem = {
  id: string;
  title: string | null;
  published_year: number | null;
  authors: string[];
  file_count: number;
  formats: string[];
  cover_path?: string | null;
};

type ScanStats = {
  added: number;
  updated: number;
  moved: number;
  unchanged: number;
  missing: number;
};

type ScanProgress = {
  processed: number;
  total: number;
  current: string;
};

type InboxItem = {
  id: string;
  title: string;
  reason: string;
};

type DuplicateGroup = {
  id: string;
  title: string;
  files: string[];
  file_ids: string[];
  file_paths: string[];
};

type PendingChange = {
  id: string;
  file_id: string;
  change_type: string;
  from_path?: string | null;
  to_path?: string | null;
  changes_json?: string | null;
  status: string;
  created_at: number;
  applied_at?: number | null;
  error?: string | null;
};

type LibraryHealth = {
  total: number;
  missing_isbn: number;
  duplicates: number;
  complete: number;
  missing_cover: number;
};

type EnrichmentCandidate = {
  id: string;
  title: string | null;
  authors: string[];
  published_year: number | null;
  identifiers: string[];
  cover_url?: string | null;
  source: string;
  confidence: number;
};

type OrganizePlan = {
  mode: string;
  library_root: string;
  template: string;
  entries: Array<{
    file_id: string;
    source_path: string;
    target_path: string;
    action: string;
  }>;
};

const sampleBooks = [
  {
    id: "1",
    title: "The Shallows",
    author: "Nicholas Carr",
    format: "EPUB",
    year: 2010,
    status: "Complete",
    cover: null,
  },
  {
    id: "2",
    title: "Silent Spring",
    author: "Rachel Carson",
    format: "PDF",
    year: 1962,
    status: "Complete",
    cover: null,
  },
  {
    id: "3",
    title: "The Left Hand of Darkness",
    author: "Ursula K. Le Guin",
    format: "EPUB",
    year: 1969,
    status: "Needs ISBN",
    cover: null,
  },
  {
    id: "4",
    title: "Braiding Sweetgrass",
    author: "Robin Wall Kimmerer",
    format: "PDF",
    year: 2013,
    status: "Needs Cover",
    cover: null,
  },
  {
    id: "5",
    title: "The Book of Tea",
    author: "Kakuzo Okakura",
    format: "EPUB",
    year: 1906,
    status: "Complete",
    cover: null,
  },
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
  const [view, setView] = useState<View>("library");
  const [grid, setGrid] = useState(true);
  const [query, setQuery] = useState("");
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
  const [selectedChangeIds, setSelectedChangeIds] = useState<Set<string>>(
    new Set()
  );
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const [confirmDeleteIds, setConfirmDeleteIds] = useState<string[]>([]);

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
  const isDesktop =
    isTauri() ||
    (typeof window !== "undefined" &&
      Boolean((window as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__));

  const filteredBooks = useMemo(() => {
    const base = isDesktop
      ? libraryItems.map((item) => ({
          coverOverride: coverOverrides[item.id],
          id: item.id,
          title: item.title ?? "Untitled",
          author: item.authors.length ? item.authors.join(", ") : "Unknown",
          format: item.formats[0] ?? "FILE",
          year: item.published_year ?? "—",
          status: item.title && item.authors.length ? "Complete" : "Needs Metadata",
          cover: typeof coverOverrides[item.id] === "string" ? coverOverrides[item.id] : null,
        }))
      : sampleBooks;
    if (!query) return base;
    const lowered = query.toLowerCase();
    return base.filter(
      (book) =>
        book.title.toLowerCase().includes(lowered) ||
        book.author.toLowerCase().includes(lowered)
    );
  }, [query, libraryItems, isDesktop, coverOverrides]);

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
      await fetchCoverOverride(selectedItemId);
      await refreshLibrary();
    } catch {
      setScanStatus("Could not apply metadata.");
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

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">F</div>
          <div>
            <div className="brand-title">Folio</div>
            <div className="brand-subtitle">Calm library</div>
          </div>
        </div>

        <nav className="nav">
          <SidebarItem active={view === "library"} onClick={() => setView("library")}>
            Library
          </SidebarItem>
          <SidebarItem active={view === "inbox"} onClick={() => setView("inbox")}>
            Inbox
          </SidebarItem>
          <SidebarItem
            active={view === "duplicates"}
            onClick={() => setView("duplicates")}
          >
            Duplicates
          </SidebarItem>
          <SidebarItem active={view === "fix"} onClick={() => setView("fix")}>
            Fix Metadata
          </SidebarItem>
          <SidebarItem active={view === "changes"} onClick={() => setView("changes")}>
            Changes
          </SidebarItem>
        </nav>

        <Panel title="Activity">
          {scanStatus ? (
            <div className="scan-status">
              {scanStatus}
              {scanning && scanStartedAt ? (
                <div className="scan-timer">
                  {Math.floor((Date.now() - scanStartedAt) / 1000)}s elapsed
                </div>
              ) : null}
              {scanProgress ? (
                <div className="scan-progress">
                  <div className="scan-progress-label">
                    {scanProgress.processed} / {scanProgress.total || "?"}
                  </div>
                  <div className="scan-progress-bar">
                    <div
                      className="scan-progress-fill"
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
                  <div className="scan-progress-file">
                    {scanProgress.current}
                  </div>
                  {scanEtaSeconds !== null ? (
                    <div className="scan-progress-eta">
                      ETA {formatEta(scanEtaSeconds)}
                    </div>
                  ) : null}
                </div>
              ) : null}
            </div>
          ) : (
            <div className="scan-status muted">No recent activity.</div>
          )}
        </Panel>

        <Panel title="Organizer">
          <div className="organizer-row">
            <span>Mode</span>
            <select
              value={organizeMode}
              onChange={(event) => setOrganizeMode(event.target.value)}
            >
              <option value="reference">Reference</option>
              <option value="copy">Copy</option>
              <option value="move">Move</option>
            </select>
          </div>
          <input
            className="organizer-input"
            value={organizeTemplate}
            onChange={(event) => setOrganizeTemplate(event.target.value)}
          />
          {organizePlan ? (
            <div className="organizer-preview">
              <div>{organizePlan.entries.length} planned</div>
              {organizePlan.entries.slice(0, 3).map((entry) => (
                <div key={entry.file_id} className="organizer-path">
                  {entry.target_path}
                </div>
              ))}
              <div className="organizer-actions">
                <Button variant="primary" onClick={handleApplyOrganize}>
                  Apply Plan
                </Button>
                <Button variant="ghost" onClick={handleQueueOrganize}>
                  Queue Changes
                </Button>
              </div>
            </div>
          ) : null}
          {organizeStatus ? <div className="scan-status">{organizeStatus}</div> : null}
        </Panel>

        <Panel title="Library Health">
          <div className="health-row">
            <span>Complete</span>
            <strong>
              {libraryHealth
                ? `${Math.round(
                    (libraryHealth.complete / Math.max(1, libraryHealth.total)) * 100
                  )}%`
                : "—"}
            </strong>
          </div>
          <div className="health-row">
            <span>Missing ISBN</span>
            <strong>{libraryHealth ? libraryHealth.missing_isbn : "—"}</strong>
          </div>
          <div className="health-row">
            <span>Missing Cover</span>
            <strong>{libraryHealth ? libraryHealth.missing_cover : "—"}</strong>
          </div>
          <div className="health-row">
            <span>Duplicates</span>
            <strong>{libraryHealth ? libraryHealth.duplicates : "—"}</strong>
          </div>
        </Panel>

        <Panel title="Danger Zone" className="danger">
          <Button variant="danger" onClick={handleClearLibrary}>
            Clear Library
          </Button>
          <div className="danger-note">
            Removes all Folio data. Your files remain untouched.
          </div>
        </Panel>
      </aside>

      <main className="main">
        <header className="toolbar">
          <div className="title-block">
            <h1>
              {view === "library" && "Your Library"}
              {view === "inbox" && "Inbox"}
              {view === "duplicates" && "Duplicates"}
              {view === "fix" && "Fix Metadata"}
              {view === "changes" && "File Changes"}
            </h1>
            <p>
              {view === "library" && "Browse and shape your calm stack."}
              {view === "inbox" && "New or incomplete entries waiting on you."}
              {view === "duplicates" && "Resolve duplicates detected by hash."}
              {view === "fix" && "Choose the best metadata match."}
              {view === "changes" && "Review and apply planned file updates."}
            </p>
          </div>

          <div className="toolbar-actions">
            <div className="toolbar-group">
              <Button
                variant="toolbar"
                size="sm"
                onClick={handleScan}
                disabled={scanning}
              >
                {scanning ? "Scanning…" : "Scan"}
              </Button>
              <Button variant="toolbar" size="sm" onClick={handlePlanOrganize}>
                Organize
              </Button>
              <Button variant="toolbar" size="sm" onClick={() => setView("fix")}> 
                Enrich
              </Button>
            </div>
            <div className="search">
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search title or author"
              />
            </div>
            {view === "library" && !libraryReady ? (
              <div className="library-status">Loading library...</div>
            ) : null}
            <div className="view-toggle">
              <Button
                variant="toolbar"
                size="sm"
                className={grid ? "active" : ""}
                onClick={() => setGrid(true)}
              >
                Grid
              </Button>
              <Button
                variant="toolbar"
                size="sm"
                className={!grid ? "active" : ""}
                onClick={() => setGrid(false)}
              >
                List
              </Button>
            </div>
          </div>
        </header>

        {scanning && scanProgress ? (
          <div className="library-progress">
            <div className="library-progress-label">
              Scanning {scanProgress.processed} of {scanProgress.total || "?"}
            </div>
            <div className="library-progress-bar">
              <div
                className="library-progress-fill"
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
            <div className="library-progress-file">{scanProgress.current}</div>
            {scanEtaSeconds !== null ? (
              <div className="library-progress-eta">
                ETA {formatEta(scanEtaSeconds)}
              </div>
            ) : null}
          </div>
        ) : scanning ? (
          <div className="library-progress">
            <div className="library-progress-label">Preparing scan…</div>
            <div className="library-progress-bar indeterminate">
              <div className="library-progress-fill" />
            </div>
            <div className="library-progress-file">Collecting files…</div>
          </div>
        ) : null}

        <div className="workspace">
          <section className="content">
            {view === "library" && (
              <>
                <div className="filter-row">
                  <button className="chip active">All</button>
                  <button className="chip">EPUB</button>
                  <button className="chip">PDF</button>
                  <button className="chip">Needs Metadata</button>
                  <button className="chip">Tagged</button>
                </div>

                {isDesktop && !libraryItems.length ? (
                  <div className="empty-state">
                    <div className="card-title">Library is empty</div>
                    <div className="card-meta">Scan a folder to import books.</div>
                  </div>
                ) : grid ? (
                  <div className="grid">
                    {filteredBooks.map((book) => (
                      <article
                        key={book.id}
                        className={
                          selectedItemId === book.id
                            ? "card selected"
                            : "card"
                        }
                        onClick={() => setSelectedItemId(book.id)}
                        role="button"
                        tabIndex={0}
                        onKeyDown={(event) => {
                          if (event.key === "Enter") setSelectedItemId(book.id);
                        }}
                      >
                        <div className={`cover ${book.cover ? "has-cover" : ""}`}>
                            {book.cover ? (
                              <img
                                key={`${book.id}-${coverRefreshToken}-${book.cover ?? "none"}`}
                                className="cover-image"
                                src={book.cover}
                                alt=""
                                onError={() => {
                                  clearCoverOverride(book.id);
                                  void fetchCoverOverride(book.id);
                                }}
                              />
                            ) : null}
                          {book.cover ? (
                            <div className="cover-badge">{book.format}</div>
                          ) : (
                            <div className="cover-fallback">
                              <div className="cover-badge">{book.format}</div>
                              <div className="cover-title">{book.title}</div>
                            </div>
                          )}
                        </div>
                        <div className="card-body">
                          <div className="card-title">{book.title}</div>
                          <div className="card-meta-grid">
                            <div className="meta-row">
                              <span className="meta-label">Auteur</span>
                              <span className="meta-value">{book.author}</span>
                            </div>
                            <div className="meta-row">
                              <span className="meta-label">Jaar</span>
                              <span className="meta-value">{book.year}</span>
                            </div>
                            <div className="meta-row">
                              <span className="meta-label">Formaat</span>
                              <span className="meta-value">{book.format}</span>
                            </div>
                            <div className="meta-row">
                              <span className="meta-label">Status</span>
                              <span className="meta-value">{book.status}</span>
                            </div>
                          </div>
                        </div>
                      </article>
                    ))}
                  </div>
                ) : (
                  <div className="list-table">
                    <div className="list-header">
                      <div></div>
                      <div>Titel</div>
                      <div>Auteur</div>
                      <div>Jaar</div>
                      <div>Formaat</div>
                      <div>Status</div>
                    </div>
                    {filteredBooks.map((book) => (
                      <div
                        key={book.id}
                        className={
                          selectedItemId === book.id
                            ? "list-row selected"
                            : "list-row"
                        }
                        onClick={() => setSelectedItemId(book.id)}
                        role="button"
                        tabIndex={0}
                        onKeyDown={(event) => {
                          if (event.key === "Enter") setSelectedItemId(book.id);
                        }}
                      >
                        <div className="list-cover">
                            {book.cover ? (
                              <img
                                key={`${book.id}-${coverRefreshToken}-${book.cover ?? "none"}`}
                                className="list-cover-image"
                                src={book.cover}
                                alt=""
                                onError={() => {
                                  clearCoverOverride(book.id);
                                  void fetchCoverOverride(book.id);
                                }}
                              />
                          ) : (
                            <div className="list-cover-fallback">{book.format}</div>
                          )}
                        </div>
                        <div className="list-title">{book.title}</div>
                        <div className="list-meta">{book.author}</div>
                        <div className="list-meta">{book.year}</div>
                        <div className="list-meta">{book.format}</div>
                        <div className="status-pill">{book.status}</div>
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}

            {view === "inbox" && (
              <section className="content">
                <div className="inbox">
                  {(isDesktop ? inbox : inboxItems).map((item) => (
                    <div key={item.id} className="inbox-row">
                      <div>
                        <div className="card-title">{item.title}</div>
                        <div className="card-meta">{item.reason}</div>
                      </div>
                      <div className="inbox-actions">
                        <Button variant="ghost">Fix</Button>
                        <Button variant="ghost">Ignore</Button>
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {view === "duplicates" && (
              <section className="content">
                <div className="duplicate-list">
                    {(isDesktop ? duplicates : duplicateGroups).map((group) => (
                      <div key={group.id} className="duplicate-card">
                        <div>
                          <div className="card-title">{group.title}</div>
                          <div className="card-meta">
                            {group.files.length} matching files
                          </div>
                          <ul>
                            {group.files.map((file, index) => {
                              const fileId = group.file_ids[index] ?? file;
                              const filePath = group.file_paths[index] ?? file;
                              const isSelected =
                                duplicateKeepSelection[group.id] === fileId;
                              return (
                                <li key={fileId} className="duplicate-option">
                                  <label>
                                    <input
                                      type="radio"
                                      name={`duplicate-${group.id}`}
                                      value={fileId}
                                      checked={isSelected}
                                      onChange={() =>
                                        setDuplicateKeepSelection((prev) => ({
                                          ...prev,
                                          [group.id]: fileId,
                                        }))
                                      }
                                    />
                                    <span className="duplicate-filename">{file}</span>
                                    <span className="duplicate-path">{filePath}</span>
                                  </label>
                                </li>
                              );
                            })}
                          </ul>
                        </div>
                      <Button
                        variant="ghost"
                        onClick={() =>
                          handleResolveDuplicate(
                            group.id,
                            duplicateKeepSelection[group.id]
                          )
                        }
                        disabled={!duplicateKeepSelection[group.id]}
                      >
                        Resolve
                      </Button>
                      </div>
                    ))}
                </div>
              </section>
            )}

            {view === "fix" && (
              <section className="content">
                <div className="fix-layout">
                  <div className="fix-current">
                    <div className="panel-title">Current Metadata</div>
                    {currentFixItem ? (
                      <>
                        <div className="meta-row">
                          <span>Title</span>
                          <strong>{currentFixItem.title}</strong>
                        </div>
                        <div className="meta-row">
                          <span>Issue</span>
                          <strong>{currentFixItem.reason}</strong>
                        </div>
                        <Button variant="primary" onClick={handleFetchCandidates}>
                          {fixLoading ? "Searching..." : "Search Sources"}
                        </Button>
                      </>
                    ) : (
                      <div className="card-meta">No items need fixes.</div>
                    )}
                  </div>

                  <div className="fix-results">
                    <div className="panel-title">Top Matches</div>
                    {candidateList.length ? (
                      <div className="candidate-grid">
                        {candidateList.map((candidate) => {
                          const coverUrl = getCandidateCoverUrl(candidate);
                          return (
                            <div key={candidate.id} className="candidate-card">
                              <div className="candidate-cover">
                                {coverUrl ? (
                                  <img
                                    className="candidate-cover-image"
                                    src={coverUrl}
                                    alt=""
                                    onError={(event) => {
                                      event.currentTarget.style.display = "none";
                                    }}
                                  />
                                ) : (
                                  <div className="candidate-cover-fallback">No cover</div>
                                )}
                              </div>
                              <div className="candidate-info">
                                <div className="candidate-head">
                                  <span className="candidate-source">{candidate.source}</span>
                                  <span className="candidate-score">
                                    {Math.round(candidate.confidence * 100)}%
                                  </span>
                                </div>
                                <div className="card-title">
                                  {candidate.title ?? "Untitled"}
                                </div>
                                <div className="card-meta">
                                  {candidate.authors.join(", ")}
                                </div>
                                <div className="card-meta">
                                  {candidate.published_year ?? "Unknown"}
                                </div>
                                <Button
                                  variant="ghost"
                                  onClick={() => handleApplyCandidate(candidate)}
                                  disabled={!currentFixItem || fixLoading || !isDesktop}
                                >
                                  Use This
                                </Button>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    ) : (
                      <div className="card-meta">
                        {fixLoading ? "Searching..." : "No candidates found."}
                      </div>
                    )}
                  </div>
                </div>
              </section>
            )}

            {view === "changes" && (
              <section className="content">
                <div className="changes-toolbar">
                  <div className="changes-filters">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setPendingChangesStatus("pending")}
                      disabled={pendingChangesStatus === "pending"}
                    >
                      Pending
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setPendingChangesStatus("applied")}
                      disabled={pendingChangesStatus === "applied"}
                    >
                      Applied
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setPendingChangesStatus("error")}
                      disabled={pendingChangesStatus === "error"}
                    >
                      Errors
                    </Button>
                  </div>
                  <Button
                    variant="primary"
                    size="sm"
                    onClick={handleApplyAllChanges}
                    disabled={pendingChangesApplying}
                  >
                    Apply All
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={handleApplySelectedChanges}
                    disabled={!selectedChangeIds.size || pendingChangesApplying}
                  >
                    Apply Selected
                  </Button>
                </div>
                <div className="change-list">
                  {(isDesktop ? pendingChanges : samplePendingChanges).length ? (
                    (isDesktop ? pendingChanges : samplePendingChanges).map((change) => (
                      <div key={change.id} className="change-card">
                        <label className="change-select">
                          <input
                            type="checkbox"
                            checked={selectedChangeIds.has(change.id)}
                            onChange={() => toggleChangeSelection(change.id)}
                            disabled={change.status !== "pending"}
                          />
                        </label>
                        <div className="change-body">
                          <div className="card-title">
                            {change.change_type === "rename"
                              ? "Rename File"
                              : change.change_type === "delete"
                                ? "Delete File"
                                : "Update EPUB Metadata"}
                          </div>
                          <div className="change-status">
                            {change.status === "error"
                              ? "Error"
                              : change.status === "applied"
                                ? "Applied"
                                : "Pending"}
                          </div>
                          <div className="card-meta">
                            {change.from_path ?? ""}
                          </div>
                          {change.to_path ? (
                            <div className="card-meta">→ {change.to_path}</div>
                          ) : null}
                          {change.changes_json ? (
                            <div className="card-meta">{change.changes_json}</div>
                          ) : null}
                          {change.error ? (
                            <div className="card-meta">Error: {change.error}</div>
                          ) : null}
                        </div>
                        <Button
                          variant="ghost"
                          onClick={() => handleApplyChange(change.id)}
                          disabled={pendingChangesApplying || change.status !== "pending"}
                        >
                          Apply
                        </Button>
                      </div>
                    ))
                  ) : (
                    <div className="card-meta">
                      {pendingChangesLoading
                        ? "Loading changes…"
                        : "No pending changes."}
                    </div>
                  )}
                </div>
                {confirmDeleteOpen ? (
                  <div className="confirm-overlay">
                    <div className="confirm-card">
                      <div className="card-title">Delete files?</div>
                      <div className="card-meta">
                        You are about to delete {confirmDeleteIds.length} file(s).
                      </div>
                      <div className="confirm-actions">
                        <Button variant="ghost" onClick={() => {
                          setConfirmDeleteOpen(false);
                          setConfirmDeleteIds([]);
                        }}>
                          Cancel
                        </Button>
                        <Button variant="danger" onClick={handleConfirmDelete}>
                          Delete
                        </Button>
                      </div>
                    </div>
                  </div>
                ) : null}
              </section>
            )}
          </section>

          <aside className="inspector">
            <div className="inspector-header">Details</div>
            {view !== "library" ? (
              <div className="card-meta">Select Library to inspect items.</div>
            ) : selectedItem ? (
              <div className="inspector-card">
                <div className="inspector-title">{selectedItem.title}</div>
                <div className="inspector-meta">{selectedItem.author}</div>
                <div className="inspector-meta">{selectedItem.year}</div>
                <div className="inspector-meta">{selectedItem.format}</div>
                <div className="inspector-meta">{selectedItem.status}</div>
                <div className="inspector-actions">
                  <Button variant="toolbar" size="sm">
                    Reveal
                  </Button>
                  <Button variant="toolbar" size="sm">
                    Edit
                  </Button>
                  <Button
                    variant="toolbar"
                    size="sm"
                    onClick={handleOpenMatchModal}
                    disabled={!isDesktop}
                  >
                    Match metadata
                  </Button>
                </div>
              </div>
            ) : (
              <div className="card-meta">Select a book to see details.</div>
            )}
          </aside>
        </div>

        <MatchModal
          open={matchOpen}
          itemTitle={selectedItem?.title ?? "Untitled"}
          itemAuthor={selectedItem?.author ?? "Unknown"}
          query={matchQuery}
          loading={matchLoading}
          candidates={matchCandidates}
          onQueryChange={setMatchQuery}
          onSearch={handleMatchSearch}
          onApply={handleMatchApply}
          onClose={() => setMatchOpen(false)}
        />
      </main>
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
