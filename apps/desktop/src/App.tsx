import { useCallback, useEffect, useMemo, useState } from "react";
import "./App.css";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { Button, Panel, SidebarItem } from "./components/ui";

type View = "library" | "inbox" | "duplicates" | "fix";

type LibraryItem = {
  id: string;
  title: string | null;
  published_year: number | null;
  authors: string[];
  file_count: number;
  formats: string[];
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
};

type EnrichmentCandidate = {
  id: string;
  title: string | null;
  authors: string[];
  published_year: number | null;
  identifiers: string[];
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
  },
  {
    id: "2",
    title: "Silent Spring",
    author: "Rachel Carson",
    format: "PDF",
    year: 1962,
    status: "Complete",
  },
  {
    id: "3",
    title: "The Left Hand of Darkness",
    author: "Ursula K. Le Guin",
    format: "EPUB",
    year: 1969,
    status: "Needs ISBN",
  },
  {
    id: "4",
    title: "Braiding Sweetgrass",
    author: "Robin Wall Kimmerer",
    format: "PDF",
    year: 2013,
    status: "Needs Cover",
  },
  {
    id: "5",
    title: "The Book of Tea",
    author: "Kakuzo Okakura",
    format: "EPUB",
    year: 1906,
    status: "Complete",
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
  },
  {
    id: "d2",
    title: "Silent Spring",
    files: ["Silent Spring.pdf", "Silent Spring - copy.pdf"],
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
  const isDesktop =
    isTauri() ||
    (typeof window !== "undefined" &&
      Boolean((window as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__));

  const filteredBooks = useMemo(() => {
    const base = isDesktop
      ? libraryItems.map((item) => ({
          id: item.id,
          title: item.title ?? "Untitled",
          author: item.authors.length ? item.authors.join(", ") : "Unknown",
          format: item.formats[0] ?? "FILE",
          year: item.published_year ?? "—",
          status: item.title && item.authors.length ? "Complete" : "Needs Metadata",
        }))
      : sampleBooks;
    if (!query) return base;
    const lowered = query.toLowerCase();
    return base.filter(
      (book) =>
        book.title.toLowerCase().includes(lowered) ||
        book.author.toLowerCase().includes(lowered)
    );
  }, [query, libraryItems, isDesktop]);

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
      } catch (error) {
        setScanStatus("Could not load library data.");
      } finally {
        setLibraryReady(true);
      }
    };
    load();
  }, []);

  const refreshLibrary = async () => {
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
    } catch (error) {
      setScanStatus("Could not refresh library data.");
    }
  };

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
      const selection = await open({ directory: true, multiple: false });
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
      } else if (Array.isArray(selection) && selection.length) {
        setScanStatus("Scanning...");
        const stats = await invoke<ScanStats>("scan_folder", {
          root: selection[0],
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
      if (error instanceof Error) {
        setScanStatus(error.message);
      } else {
        setScanStatus("Scan failed.");
      }
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

    return () => {
      if (unlistenProgress) unlistenProgress();
      if (unlistenComplete) unlistenComplete();
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
    } catch (error) {
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
      setScanStatus("Metadata updated.");
      await refreshLibrary();
      setFixCandidates([]);
    } catch (error) {
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
    } catch (error) {
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
    } catch (error) {
      setOrganizeStatus("Could not apply organize plan.");
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
              <Button variant="primary" onClick={handleApplyOrganize}>
                Apply Plan
              </Button>
            </div>
          ) : null}
          {organizeStatus ? <div className="scan-status">{organizeStatus}</div> : null}
        </Panel>

        <Panel title="Library Health">
          <div className="health-row">
            <span>Complete</span>
            <strong>82%</strong>
          </div>
          <div className="health-row">
            <span>Missing ISBN</span>
            <strong>12</strong>
          </div>
          <div className="health-row">
            <span>Duplicates</span>
            <strong>4</strong>
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
            </h1>
            <p>
              {view === "library" && "Browse and shape your calm stack."}
              {view === "inbox" && "New or incomplete entries waiting on you."}
              {view === "duplicates" && "Resolve duplicates detected by hash."}
              {view === "fix" && "Choose the best metadata match."}
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
              <Button variant="toolbar" size="sm">
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

        {view === "library" && (
          <section className="content">
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
            ) : (
              <div className={grid ? "grid" : "list"}>
                {filteredBooks.map((book) => (
                  <article key={book.id} className="card">
                    <div className="cover">
                      <div className="cover-badge">{book.format}</div>
                      <div className="cover-title">{book.title}</div>
                    </div>
                    <div className="card-body">
                      <div className="card-title">{book.title}</div>
                      <div className="card-meta">{book.author}</div>
                      <div className="card-meta">
                        {book.year} · {book.status}
                      </div>
                    </div>
                  </article>
                ))}
              </div>
            )}
          </section>
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
                    <button className="ghost">Fix</button>
                    <button className="ghost">Ignore</button>
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
                      {group.files.map((file) => (
                        <li key={file}>{file}</li>
                      ))}
                    </ul>
                  </div>
                  <button className="ghost">Resolve</button>
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
                    <button className="primary" onClick={handleFetchCandidates}>
                      {fixLoading ? "Searching..." : "Search Sources"}
                    </button>
                  </>
                ) : (
                  <div className="card-meta">No items need fixes.</div>
                )}
              </div>

              <div className="fix-results">
                <div className="panel-title">Top Matches</div>
                {candidateList.length ? (
                  <div className="candidate-grid">
                    {candidateList.map((candidate) => (
                      <div key={candidate.id} className="candidate-card">
                        <div className="candidate-head">
                          <span className="candidate-source">{candidate.source}</span>
                          <span className="candidate-score">
                            {Math.round(candidate.confidence * 100)}%
                          </span>
                        </div>
                        <div className="card-title">{candidate.title ?? "Untitled"}</div>
                        <div className="card-meta">{candidate.authors.join(", ")}</div>
                        <div className="card-meta">
                          {candidate.published_year ?? "Unknown"}
                        </div>
                        <button
                          className="ghost"
                          onClick={() => handleApplyCandidate(candidate)}
                          disabled={!currentFixItem || fixLoading || !isDesktop}
                        >
                          Use This
                        </button>
                      </div>
                    ))}
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
