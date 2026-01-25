import { useEffect, useMemo, useState } from "react";
import "./App.css";
import { invoke, isTauri } from "@tauri-apps/api/core";

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

const fixCandidates = [
  {
    id: "c1",
    title: "The Left Hand of Darkness",
    author: "Ursula K. Le Guin",
    year: 1969,
    confidence: 0.92,
    source: "Open Library",
  },
  {
    id: "c2",
    title: "Left Hand of Darkness",
    author: "U. K. Le Guin",
    year: 1969,
    confidence: 0.86,
    source: "Google Books",
  },
  {
    id: "c3",
    title: "The Left Hand of Darkness (Anniversary)",
    author: "Ursula Le Guin",
    year: 2004,
    confidence: 0.74,
    source: "Open Library",
  },
  {
    id: "c4",
    title: "The Left Hand of Darkness",
    author: "Ursula K. Le Guin",
    year: 1976,
    confidence: 0.71,
    source: "Google Books",
  },
  {
    id: "c5",
    title: "The Left Hand of Darkness",
    author: "Ursula K. LeGuin",
    year: 1969,
    confidence: 0.67,
    source: "Open Library",
  },
];

function App() {
  const [view, setView] = useState<View>("library");
  const [grid, setGrid] = useState(true);
  const [query, setQuery] = useState("");
  const [scanStatus, setScanStatus] = useState<string | null>(null);
  const [libraryItems, setLibraryItems] = useState<LibraryItem[]>([]);
  const [libraryReady, setLibraryReady] = useState(false);

  const filteredBooks = useMemo(() => {
    const base = libraryItems.length
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
  }, [query, libraryItems]);

  useEffect(() => {
    const load = async () => {
      if (!isTauri()) {
        setLibraryReady(true);
        return;
      }
      try {
        const items = await invoke<LibraryItem[]>("get_library_items");
        setLibraryItems(items);
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
    } catch (error) {
      setScanStatus("Could not refresh library data.");
    }
  };

  const handleScan = async () => {
    try {
      if (!isTauri()) {
        setScanStatus("Scan requires the Tauri desktop runtime.");
        return;
      }
      const { open } = await import("@tauri-apps/api/dialog");
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
      } else if (Array.isArray(selection) && selection.length) {
        setScanStatus("Scanning...");
        const stats = await invoke<ScanStats>("scan_folder", {
          root: selection[0],
        });
        setScanStatus(
          `Scan complete: ${stats.added} added, ${stats.updated} updated, ${stats.moved} moved.`
        );
        await refreshLibrary();
      } else {
        setScanStatus("Scan cancelled.");
      }
    } catch (error) {
      if (error instanceof Error) {
        setScanStatus(error.message);
      } else {
        setScanStatus("Scan failed.");
      }
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
          <button
            className={view === "library" ? "nav-item active" : "nav-item"}
            onClick={() => setView("library")}
          >
            Library
          </button>
          <button
            className={view === "inbox" ? "nav-item active" : "nav-item"}
            onClick={() => setView("inbox")}
          >
            Inbox
          </button>
          <button
            className={view === "duplicates" ? "nav-item active" : "nav-item"}
            onClick={() => setView("duplicates")}
          >
            Duplicates
          </button>
          <button
            className={view === "fix" ? "nav-item active" : "nav-item"}
            onClick={() => setView("fix")}
          >
            Fix Metadata
          </button>
        </nav>

        <div className="sidebar-panel">
          <div className="panel-title">Quick Actions</div>
          <button className="primary" onClick={handleScan}>Scan Folder</button>
          <button className="ghost">Organize Files</button>
          <button className="ghost">Run Enrichment</button>
          {scanStatus ? <div className="scan-status">{scanStatus}</div> : null}
        </div>

        <div className="sidebar-panel">
          <div className="panel-title">Library Health</div>
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
        </div>
      </aside>

      <main className="main">
        <header className="topbar">
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

          <div className="topbar-actions">
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
              <button
                className={grid ? "active" : ""}
                onClick={() => setGrid(true)}
              >
                Grid
              </button>
              <button
                className={!grid ? "active" : ""}
                onClick={() => setGrid(false)}
              >
                List
              </button>
            </div>
          </div>
        </header>

        {view === "library" && (
          <section className="content">
            <div className="filter-row">
              <button className="chip active">All</button>
              <button className="chip">EPUB</button>
              <button className="chip">PDF</button>
              <button className="chip">Needs Metadata</button>
              <button className="chip">Tagged</button>
            </div>

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
          </section>
        )}

        {view === "inbox" && (
          <section className="content">
            <div className="inbox">
              {inboxItems.map((item) => (
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
              {duplicateGroups.map((group) => (
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
                <div className="meta-row">
                  <span>Title</span>
                  <strong>The Left Hand of Darkness</strong>
                </div>
                <div className="meta-row">
                  <span>Author</span>
                  <strong>Ursula K. Le Guin</strong>
                </div>
                <div className="meta-row">
                  <span>ISBN</span>
                  <strong>Missing</strong>
                </div>
                <div className="meta-row">
                  <span>Year</span>
                  <strong>Unknown</strong>
                </div>
                <button className="primary">Search Sources</button>
              </div>

              <div className="fix-results">
                <div className="panel-title">Top Matches</div>
                <div className="candidate-grid">
                  {fixCandidates.map((candidate) => (
                    <div key={candidate.id} className="candidate-card">
                      <div className="candidate-head">
                        <span className="candidate-source">{candidate.source}</span>
                        <span className="candidate-score">
                          {Math.round(candidate.confidence * 100)}%
                        </span>
                      </div>
                      <div className="card-title">{candidate.title}</div>
                      <div className="card-meta">{candidate.author}</div>
                      <div className="card-meta">{candidate.year}</div>
                      <button className="ghost">Use This</button>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </section>
        )}
      </main>
    </div>
  );
}

export default App;
