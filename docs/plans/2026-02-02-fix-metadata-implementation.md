# Fix Metadata Page Redesign - Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Redesign Fix Metadata page from single-item queue to full triage workflow with configurable filters, manual editing, and search.

**Architecture:** Three-panel layout (book list | metadata form | search results). Filter logic runs client-side on existing `libraryItems`. New `save_item_metadata` backend command for direct saves.

**Tech Stack:** React, TypeScript, Tailwind CSS, Tauri (Rust backend), SQLite

---

### Task 1: Add FixFilter Type

**Files:**
- Modify: `apps/desktop/src/types/library.ts`

**Step 1: Add the FixFilter type after LibraryFilter**

Add this type definition after line 12 (after `LibraryFilter`):

```typescript
export type FixFilter = {
  missingAuthor: boolean;
  missingTitle: boolean;
  missingCover: boolean;
  missingIsbn: boolean;
  missingYear: boolean;
  missingDescription: boolean;
  missingLanguage: boolean;
  missingSeries: boolean;
  includeIssues: boolean;
};
```

**Step 2: Add ItemMetadata type for manual saves**

Add after the FixFilter type:

```typescript
export type ItemMetadata = {
  title: string | null;
  authors: string[];
  publishedYear: number | null;
  language: string | null;
  isbn: string | null;
  series: string | null;
  seriesIndex: number | null;
  description: string | null;
};
```

**Step 3: Verify build**

Run: `cd apps/desktop && pnpm build`
Expected: Build succeeds

**Step 4: Commit**

```bash
git add apps/desktop/src/types/library.ts
git commit -m "feat(fix-metadata): add FixFilter and ItemMetadata types"
```

---

### Task 2: Add save_item_metadata Backend Command

**Files:**
- Modify: `apps/desktop/src-tauri/src/lib.rs`

**Step 1: Add ItemMetadata struct**

Add after the `ApplyMetadataProgress` struct (around line 1498):

```rust
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ItemMetadata {
  title: Option<String>,
  authors: Vec<String>,
  published_year: Option<i64>,
  language: Option<String>,
  isbn: Option<String>,
  series: Option<String>,
  series_index: Option<f64>,
  description: Option<String>,
}
```

**Step 2: Add save_item_metadata command**

Add after the `apply_fix_candidate` function (around line 1580):

```rust
#[tauri::command]
fn save_item_metadata(
  app: tauri::AppHandle,
  item_id: String,
  metadata: ItemMetadata,
) -> Result<(), String> {
  let conn = open_db(&app)?;
  let now = chrono::Utc::now().timestamp_millis();
  log::info!("saving manual metadata for item {}: {:?}", item_id, metadata.title);

  // Update items table
  conn.execute(
    "UPDATE items SET title = ?1, published_year = ?2, language = ?3, series = ?4, series_index = ?5, description = ?6, updated_at = ?7 WHERE id = ?8",
    params![
      metadata.title,
      metadata.published_year,
      metadata.language,
      metadata.series,
      metadata.series_index,
      metadata.description,
      now,
      item_id
    ],
  )
  .map_err(|err| err.to_string())?;

  // Update authors
  if !metadata.authors.is_empty() {
    conn
      .execute("DELETE FROM item_authors WHERE item_id = ?1", params![item_id])
      .map_err(|err| err.to_string())?;

    for author in &metadata.authors {
      let author_id: Option<String> = conn
        .query_row(
          "SELECT id FROM authors WHERE name = ?1",
          params![author],
          |row| row.get(0),
        )
        .optional()
        .map_err(|err| err.to_string())?;

      let author_id = match author_id {
        Some(id) => id,
        None => {
          let new_id = uuid::Uuid::new_v4().to_string();
          conn
            .execute(
              "INSERT INTO authors (id, name, created_at) VALUES (?1, ?2, ?3)",
              params![new_id, author, now],
            )
            .map_err(|err| err.to_string())?;
          new_id
        }
      };

      conn
        .execute(
          "INSERT OR IGNORE INTO item_authors (item_id, author_id) VALUES (?1, ?2)",
          params![item_id, author_id],
        )
        .map_err(|err| err.to_string())?;
    }
  }

  // Update ISBN in identifiers table
  if let Some(isbn) = &metadata.isbn {
    if !isbn.is_empty() {
      // Remove old ISBN
      conn
        .execute(
          "DELETE FROM identifiers WHERE item_id = ?1 AND type IN ('isbn10', 'isbn13')",
          params![item_id],
        )
        .map_err(|err| err.to_string())?;

      // Add new ISBN
      let isbn_type = if isbn.len() == 13 { "isbn13" } else { "isbn10" };
      conn
        .execute(
          "INSERT INTO identifiers (item_id, type, value) VALUES (?1, ?2, ?3)",
          params![item_id, isbn_type, isbn],
        )
        .map_err(|err| err.to_string())?;
    }
  }

  // Mark issues as resolved
  conn.execute(
    "UPDATE issues SET resolved_at = ?1 WHERE item_id = ?2 AND resolved_at IS NULL",
    params![now, item_id],
  )
  .map_err(|err| err.to_string())?;

  Ok(())
}
```

**Step 3: Register the command**

Find the `invoke_handler` macro (around line 4390) and add `save_item_metadata` to the list:

```rust
save_item_metadata,
```

Add it after `apply_fix_candidate`.

**Step 4: Verify build**

Run: `cd apps/desktop/src-tauri && cargo check`
Expected: Build succeeds

**Step 5: Commit**

```bash
git add apps/desktop/src-tauri/src/lib.rs
git commit -m "feat(fix-metadata): add save_item_metadata backend command"
```

---

### Task 3: Add Fix Metadata State to App.tsx

**Files:**
- Modify: `apps/desktop/src/App.tsx`

**Step 1: Import new types**

Update the import from `./types/library` (around line 24) to include:

```typescript
import type {
  // ... existing imports ...
  FixFilter,
  ItemMetadata,
} from "./types/library";
```

**Step 2: Add default filter constant**

Add after the `sampleFixCandidates` constant (around line 197):

```typescript
const DEFAULT_FIX_FILTER: FixFilter = {
  missingAuthor: true,
  missingTitle: true,
  missingCover: true,
  missingIsbn: false,
  missingYear: false,
  missingDescription: false,
  missingLanguage: false,
  missingSeries: false,
  includeIssues: true,
};
```

**Step 3: Add state variables**

Add after the existing state declarations (around line 264, after `selectedSeries`):

```typescript
// Fix Metadata state
const [fixFilter, setFixFilter] = useState<FixFilter>(() => {
  const saved = localStorage.getItem("folio-fix-filter");
  return saved ? JSON.parse(saved) : DEFAULT_FIX_FILTER;
});
const [selectedFixItemId, setSelectedFixItemId] = useState<string | null>(null);
const [fixFormData, setFixFormData] = useState<ItemMetadata | null>(null);
const [fixSearchQuery, setFixSearchQuery] = useState("");
const [fixSaving, setFixSaving] = useState(false);
```

**Step 4: Add fixFilter persistence effect**

Add after the existing useEffect blocks (around line 590):

```typescript
// Persist fix filter to localStorage
useEffect(() => {
  localStorage.setItem("folio-fix-filter", JSON.stringify(fixFilter));
}, [fixFilter]);
```

**Step 5: Add booksNeedingFix useMemo**

Add after the `uniqueSeries` useMemo (around line 363):

```typescript
// Books needing metadata fixes based on filter
const booksNeedingFix = useMemo(() => {
  return libraryItems.filter((item) => {
    if (fixFilter.missingAuthor && item.authors.length === 0) return true;
    if (fixFilter.missingTitle && !item.title) return true;
    if (fixFilter.missingCover && !item.cover_path) return true;
    // For ISBN, we'd need to check identifiers - skip for now, handled by issues
    if (fixFilter.missingYear && !item.published_year) return true;
    if (fixFilter.missingLanguage && !item.language) return true;
    if (fixFilter.missingSeries && !item.series) return true;
    // includeIssues handled separately via inbox
    return false;
  });
}, [libraryItems, fixFilter]);

// Combine with inbox items if includeIssues is true
const allFixItems = useMemo(() => {
  const fixItemIds = new Set(booksNeedingFix.map((item) => item.id));
  const issueItemIds = fixFilter.includeIssues ? new Set(inbox.map((item) => item.id)) : new Set();

  // Merge: library items that need fixing + inbox items not already in the list
  const result = [...booksNeedingFix];
  if (fixFilter.includeIssues) {
    inbox.forEach((inboxItem) => {
      if (!fixItemIds.has(inboxItem.id)) {
        // Find the full library item if it exists
        const libraryItem = libraryItems.find((li) => li.id === inboxItem.id);
        if (libraryItem) {
          result.push(libraryItem);
        }
      }
    });
  }
  return result;
}, [booksNeedingFix, inbox, fixFilter.includeIssues, libraryItems]);
```

**Step 6: Add handleSaveItemMetadata callback**

Add after `handleMatchApply` (around line 1282):

```typescript
const handleSaveItemMetadata = useCallback(
  async (itemId: string, metadata: ItemMetadata) => {
    if (!isTauri()) return;
    setFixSaving(true);
    try {
      await invoke("save_item_metadata", { itemId, metadata });
      setScanStatus("Metadata saved.");
      await refreshLibrary();
      // Auto-select next item if current one is no longer in list
      const stillInList = allFixItems.some((item) => item.id === itemId);
      if (!stillInList && allFixItems.length > 0) {
        const nextItem = allFixItems.find((item) => item.id !== itemId);
        if (nextItem) {
          setSelectedFixItemId(nextItem.id);
        } else {
          setSelectedFixItemId(null);
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setScanStatus(`Could not save metadata: ${message}`);
    } finally {
      setFixSaving(false);
    }
  },
  [refreshLibrary, allFixItems]
);
```

**Step 7: Update FixView props**

Find where FixView is rendered (around line 1600) and replace the entire block:

```typescript
{view === "fix" ? (
  <FixView
    items={allFixItems}
    inboxItems={inbox}
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
    onSearch={handleFetchCandidates}
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
    onApplyCandidate={handleApplyCandidate}
    onSaveMetadata={handleSaveItemMetadata}
    saving={fixSaving}
    getCandidateCoverUrl={getCandidateCoverUrl}
    isDesktop={isDesktop}
  />
) : null}
```

**Step 8: Verify build**

Run: `cd apps/desktop && pnpm build`
Expected: Build fails (FixView props don't match yet - expected)

**Step 9: Commit**

```bash
git add apps/desktop/src/App.tsx
git commit -m "feat(fix-metadata): add state management and handlers for new FixView"
```

---

### Task 4: Rewrite FixView Component

**Files:**
- Modify: `apps/desktop/src/sections/FixView.tsx`

**Step 1: Replace entire file**

Replace the entire contents of `FixView.tsx` with:

```typescript
import { BookOpen, Image, User, AlertTriangle, ChevronDown, Search, Save, Loader2 } from "lucide-react";
import type { Dispatch, SetStateAction } from "react";
import { useEffect } from "react";
import { Button, Input } from "../components/ui";
import type { EnrichmentCandidate, FixFilter, InboxItem, ItemMetadata, LibraryItem } from "../types/library";

type FixViewProps = {
  items: LibraryItem[];
  inboxItems: InboxItem[];
  selectedItemId: string | null;
  setSelectedItemId: Dispatch<SetStateAction<string | null>>;
  fixFilter: FixFilter;
  setFixFilter: Dispatch<SetStateAction<FixFilter>>;
  formData: ItemMetadata | null;
  setFormData: Dispatch<SetStateAction<ItemMetadata | null>>;
  searchQuery: string;
  setSearchQuery: Dispatch<SetStateAction<string>>;
  searchLoading: boolean;
  searchCandidates: EnrichmentCandidate[];
  onSearch: () => void;
  onSearchWithQuery: (query: string) => Promise<void>;
  onApplyCandidate: (candidate: EnrichmentCandidate) => void;
  onSaveMetadata: (itemId: string, metadata: ItemMetadata) => Promise<void>;
  saving: boolean;
  getCandidateCoverUrl: (candidate: EnrichmentCandidate) => string | null;
  isDesktop: boolean;
};

const LANGUAGES = [
  { code: "nl", name: "Dutch" },
  { code: "en", name: "English" },
  { code: "de", name: "German" },
  { code: "fr", name: "French" },
  { code: "es", name: "Spanish" },
  { code: "it", name: "Italian" },
  { code: "pt", name: "Portuguese" },
  { code: "ru", name: "Russian" },
  { code: "zh", name: "Chinese" },
  { code: "ja", name: "Japanese" },
];

function getIssueIcon(item: LibraryItem, inboxItems: InboxItem[]) {
  if (!item.title) return <BookOpen size={14} className="text-amber-600" />;
  if (item.authors.length === 0) return <User size={14} className="text-amber-600" />;
  if (!item.cover_path) return <Image size={14} className="text-amber-600" />;
  if (inboxItems.some((inbox) => inbox.id === item.id)) {
    return <AlertTriangle size={14} className="text-amber-600" />;
  }
  return <AlertTriangle size={14} className="text-stone-400" />;
}

export function FixView({
  items,
  inboxItems,
  selectedItemId,
  setSelectedItemId,
  fixFilter,
  setFixFilter,
  formData,
  setFormData,
  searchQuery,
  setSearchQuery,
  searchLoading,
  searchCandidates,
  onSearchWithQuery,
  onApplyCandidate,
  onSaveMetadata,
  saving,
  getCandidateCoverUrl,
  isDesktop,
}: FixViewProps) {
  // Initialize form data when selection changes
  useEffect(() => {
    if (!selectedItemId) {
      setFormData(null);
      setSearchQuery("");
      return;
    }
    const item = items.find((i) => i.id === selectedItemId);
    if (!item) {
      setFormData(null);
      setSearchQuery("");
      return;
    }
    setFormData({
      title: item.title,
      authors: item.authors,
      publishedYear: item.published_year,
      language: item.language ?? null,
      isbn: null, // Would need to fetch from identifiers
      series: item.series ?? null,
      seriesIndex: item.series_index ?? null,
      description: null, // Would need to fetch
    });
    setSearchQuery(item.title ?? "");
  }, [selectedItemId, items, setFormData, setSearchQuery]);

  // Auto-select first item if none selected
  useEffect(() => {
    if (!selectedItemId && items.length > 0) {
      setSelectedItemId(items[0].id);
    }
  }, [selectedItemId, items, setSelectedItemId]);

  if (items.length === 0) {
    return (
      <section className="flex flex-col items-center justify-center gap-4 py-16">
        <div className="text-4xl">🎉</div>
        <div className="text-lg font-medium text-[var(--app-ink)]">All books have complete metadata!</div>
        <div className="text-sm text-[var(--app-ink-muted)]">Nothing needs fixing based on your current filter.</div>
      </section>
    );
  }

  const selectedItem = items.find((i) => i.id === selectedItemId);

  return (
    <section className="flex gap-4 h-[calc(100vh-200px)]">
      {/* Left Panel: Book List */}
      <div className="w-56 flex-shrink-0 flex flex-col rounded-lg border border-[var(--app-border)] bg-white/70 overflow-hidden">
        <div className="flex items-center justify-between border-b border-[var(--app-border)] px-3 py-2">
          <span className="text-xs font-semibold text-[var(--app-ink)]">
            NEEDS FIXING ({items.length})
          </span>
          <FilterDropdown filter={fixFilter} setFilter={setFixFilter} />
        </div>
        <div className="flex-1 overflow-y-auto">
          {items.map((item) => (
            <button
              key={item.id}
              onClick={() => setSelectedItemId(item.id)}
              className={`w-full flex items-center gap-2 px-3 py-2 text-left text-xs hover:bg-[var(--app-bg)] transition-colors ${
                item.id === selectedItemId ? "bg-[var(--app-accent)]/10 border-l-2 border-[var(--app-accent)]" : ""
              }`}
            >
              {getIssueIcon(item, inboxItems)}
              <span className="truncate text-[var(--app-ink)]">
                {item.title || "Untitled"}
              </span>
            </button>
          ))}
        </div>
      </div>

      {/* Center Panel: Metadata Form */}
      <div className="flex-1 flex flex-col rounded-lg border border-[var(--app-border)] bg-white/70 overflow-hidden">
        <div className="border-b border-[var(--app-border)] px-4 py-2">
          <span className="text-xs font-semibold text-[var(--app-ink)]">CURRENT METADATA</span>
        </div>
        {selectedItem && formData ? (
          <div className="flex-1 overflow-y-auto p-4">
            <div className="space-y-4">
              <div>
                <label className="block text-[10px] uppercase tracking-wider text-[var(--app-ink-muted)] mb-1">
                  Title
                </label>
                <Input
                  value={formData.title ?? ""}
                  onChange={(e) => setFormData({ ...formData, title: e.target.value || null })}
                  className="w-full"
                />
              </div>

              <div>
                <label className="block text-[10px] uppercase tracking-wider text-[var(--app-ink-muted)] mb-1">
                  Author(s) <span className="normal-case">(comma-separated)</span>
                </label>
                <Input
                  value={formData.authors.join(", ")}
                  onChange={(e) =>
                    setFormData({
                      ...formData,
                      authors: e.target.value
                        .split(",")
                        .map((a) => a.trim())
                        .filter(Boolean),
                    })
                  }
                  className="w-full"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-[10px] uppercase tracking-wider text-[var(--app-ink-muted)] mb-1">
                    Year
                  </label>
                  <Input
                    type="number"
                    value={formData.publishedYear ?? ""}
                    onChange={(e) =>
                      setFormData({
                        ...formData,
                        publishedYear: e.target.value ? parseInt(e.target.value, 10) : null,
                      })
                    }
                    className="w-full"
                  />
                </div>
                <div>
                  <label className="block text-[10px] uppercase tracking-wider text-[var(--app-ink-muted)] mb-1">
                    Language
                  </label>
                  <select
                    value={formData.language ?? ""}
                    onChange={(e) => setFormData({ ...formData, language: e.target.value || null })}
                    className="w-full h-9 rounded-md border border-[var(--app-border)] bg-white px-3 text-sm"
                  >
                    <option value="">Select...</option>
                    {LANGUAGES.map((lang) => (
                      <option key={lang.code} value={lang.code}>
                        {lang.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-[10px] uppercase tracking-wider text-[var(--app-ink-muted)] mb-1">
                  ISBN
                </label>
                <Input
                  value={formData.isbn ?? ""}
                  onChange={(e) => setFormData({ ...formData, isbn: e.target.value || null })}
                  className="w-full"
                  placeholder="978..."
                />
              </div>

              <div className="grid grid-cols-[1fr_80px] gap-4">
                <div>
                  <label className="block text-[10px] uppercase tracking-wider text-[var(--app-ink-muted)] mb-1">
                    Series
                  </label>
                  <Input
                    value={formData.series ?? ""}
                    onChange={(e) => setFormData({ ...formData, series: e.target.value || null })}
                    className="w-full"
                  />
                </div>
                <div>
                  <label className="block text-[10px] uppercase tracking-wider text-[var(--app-ink-muted)] mb-1">
                    Index
                  </label>
                  <Input
                    type="number"
                    step="0.1"
                    value={formData.seriesIndex ?? ""}
                    onChange={(e) =>
                      setFormData({
                        ...formData,
                        seriesIndex: e.target.value ? parseFloat(e.target.value) : null,
                      })
                    }
                    className="w-full"
                  />
                </div>
              </div>

              <div>
                <label className="block text-[10px] uppercase tracking-wider text-[var(--app-ink-muted)] mb-1">
                  Description
                </label>
                <textarea
                  value={formData.description ?? ""}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value || null })}
                  className="w-full h-20 rounded-md border border-[var(--app-border)] bg-white px-3 py-2 text-sm resize-none"
                />
              </div>

              <div className="flex gap-2 pt-2">
                <Button
                  variant="primary"
                  onClick={() => onSaveMetadata(selectedItem.id, formData)}
                  disabled={saving || !isDesktop}
                  className="flex-1"
                >
                  {saving ? (
                    <span className="flex items-center gap-2">
                      <Loader2 size={14} className="animate-spin" />
                      Saving...
                    </span>
                  ) : (
                    <span className="flex items-center gap-2">
                      <Save size={14} />
                      Save Changes
                    </span>
                  )}
                </Button>
                <Button
                  variant="outline"
                  onClick={() => {
                    const query = [formData.title, formData.authors[0]].filter(Boolean).join(" ");
                    setSearchQuery(query);
                    onSearchWithQuery(query);
                  }}
                  disabled={searchLoading || !isDesktop}
                >
                  <Search size={14} />
                  Use as Search
                </Button>
              </div>
            </div>
          </div>
        ) : (
          <div className="flex-1 flex items-center justify-center text-sm text-[var(--app-ink-muted)]">
            Select a book to edit
          </div>
        )}
      </div>

      {/* Right Panel: Search Results */}
      <div className="w-72 flex-shrink-0 flex flex-col rounded-lg border border-[var(--app-border)] bg-white/70 overflow-hidden">
        <div className="border-b border-[var(--app-border)] px-4 py-2">
          <span className="text-xs font-semibold text-[var(--app-ink)]">SEARCH RESULTS</span>
        </div>
        <div className="p-3 border-b border-[var(--app-border)]">
          <div className="flex gap-2">
            <Input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search query..."
              className="flex-1 text-sm"
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  onSearchWithQuery(searchQuery);
                }
              }}
            />
            <Button
              variant="primary"
              size="sm"
              onClick={() => onSearchWithQuery(searchQuery)}
              disabled={searchLoading || !searchQuery.trim() || !isDesktop}
            >
              {searchLoading ? <Loader2 size={14} className="animate-spin" /> : <Search size={14} />}
            </Button>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto p-3">
          {searchLoading ? (
            <div className="flex items-center justify-center gap-2 py-8 text-sm text-[var(--app-ink-muted)]">
              <Loader2 size={16} className="animate-spin" />
              Searching...
            </div>
          ) : searchCandidates.length > 0 ? (
            <div className="space-y-3">
              {searchCandidates.map((candidate) => {
                const coverUrl = getCandidateCoverUrl(candidate);
                return (
                  <div
                    key={candidate.id}
                    className="rounded-md border border-[var(--app-border)] bg-white p-2"
                  >
                    <div className="flex gap-2">
                      <div className="h-16 w-11 flex-shrink-0 overflow-hidden rounded border border-[var(--app-border)] bg-[#fffaf4]">
                        {coverUrl ? (
                          <img
                            src={coverUrl}
                            alt=""
                            className="h-full w-full object-cover"
                            onError={(e) => {
                              e.currentTarget.style.display = "none";
                            }}
                          />
                        ) : (
                          <div className="h-full w-full flex items-center justify-center text-[8px] text-[var(--app-ink-muted)]">
                            No cover
                          </div>
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between gap-1 mb-0.5">
                          <span className="text-[9px] rounded-full bg-[rgba(201,122,58,0.12)] px-1.5 py-0.5 text-[var(--app-accent)]">
                            {candidate.source}
                          </span>
                          <span className="text-[9px] text-[var(--app-ink-muted)]">
                            {Math.round(candidate.confidence * 100)}%
                          </span>
                        </div>
                        <div className="text-xs font-medium truncate">{candidate.title}</div>
                        <div className="text-[10px] text-[var(--app-ink-muted)] truncate">
                          {candidate.authors.join(", ")}
                        </div>
                        <div className="text-[10px] text-[var(--app-ink-muted)]">
                          {candidate.published_year ?? "—"}
                        </div>
                      </div>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => onApplyCandidate(candidate)}
                      className="w-full mt-2 text-xs"
                      disabled={!isDesktop}
                    >
                      Apply This
                    </Button>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="text-center py-8 text-sm text-[var(--app-ink-muted)]">
              <p>No results found.</p>
              <p className="mt-1 text-xs">Try editing the search query or fill in metadata manually.</p>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

function FilterDropdown({
  filter,
  setFilter,
}: {
  filter: FixFilter;
  setFilter: Dispatch<SetStateAction<FixFilter>>;
}) {
  return (
    <div className="relative group">
      <button className="flex items-center gap-1 text-[10px] text-[var(--app-ink-muted)] hover:text-[var(--app-ink)]">
        Filter <ChevronDown size={12} />
      </button>
      <div className="absolute right-0 top-full mt-1 w-48 rounded-md border border-[var(--app-border)] bg-white shadow-lg opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all z-10">
        <div className="p-2 border-b border-[var(--app-border)]">
          <span className="text-[10px] font-semibold text-[var(--app-ink-muted)]">Show books missing:</span>
        </div>
        <div className="p-2 space-y-1">
          <FilterCheckbox label="Author" checked={filter.missingAuthor} onChange={(v) => setFilter({ ...filter, missingAuthor: v })} />
          <FilterCheckbox label="Title" checked={filter.missingTitle} onChange={(v) => setFilter({ ...filter, missingTitle: v })} />
          <FilterCheckbox label="Cover" checked={filter.missingCover} onChange={(v) => setFilter({ ...filter, missingCover: v })} />
          <FilterCheckbox label="ISBN" checked={filter.missingIsbn} onChange={(v) => setFilter({ ...filter, missingIsbn: v })} />
          <FilterCheckbox label="Year" checked={filter.missingYear} onChange={(v) => setFilter({ ...filter, missingYear: v })} />
          <FilterCheckbox label="Language" checked={filter.missingLanguage} onChange={(v) => setFilter({ ...filter, missingLanguage: v })} />
          <FilterCheckbox label="Series" checked={filter.missingSeries} onChange={(v) => setFilter({ ...filter, missingSeries: v })} />
        </div>
        <div className="p-2 border-t border-[var(--app-border)]">
          <span className="text-[10px] font-semibold text-[var(--app-ink-muted)]">Also show:</span>
          <div className="mt-1">
            <FilterCheckbox label="Items with issues" checked={filter.includeIssues} onChange={(v) => setFilter({ ...filter, includeIssues: v })} />
          </div>
        </div>
      </div>
    </div>
  );
}

function FilterCheckbox({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="flex items-center gap-2 text-xs text-[var(--app-ink)] cursor-pointer hover:bg-[var(--app-bg)] rounded px-1 py-0.5">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="rounded border-[var(--app-border)]"
      />
      {label}
    </label>
  );
}
```

**Step 2: Verify build**

Run: `cd apps/desktop && pnpm build`
Expected: Build succeeds

**Step 3: Commit**

```bash
git add apps/desktop/src/sections/FixView.tsx
git commit -m "feat(fix-metadata): rewrite FixView with three-panel layout"
```

---

### Task 5: Fix Remaining App.tsx Integration

**Files:**
- Modify: `apps/desktop/src/App.tsx`

**Step 1: Fix handleFetchCandidates to use selectedFixItemId**

Find `handleFetchCandidates` (around line 1165) and update it:

```typescript
const handleFetchCandidates = async () => {
  const itemId = selectedFixItemId;
  if (!itemId) return;
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
```

**Step 2: Fix handleApplyCandidate to use selectedFixItemId**

Find `handleApplyCandidate` (around line 1187) and update it:

```typescript
const handleApplyCandidate = async (candidate: EnrichmentCandidate) => {
  const itemId = selectedFixItemId;
  if (!itemId || !isTauri()) return;
  try {
    await invoke("apply_fix_candidate", {
      itemId,
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
    // Auto-select next item
    const stillInList = allFixItems.some((item) => item.id === itemId);
    if (!stillInList && allFixItems.length > 0) {
      const nextItem = allFixItems.find((item) => item.id !== itemId);
      if (nextItem) {
        setSelectedFixItemId(nextItem.id);
      }
    }
  } catch {
    setScanStatus("Could not apply metadata.");
  }
};
```

**Step 3: Add allFixItems to handleApplyCandidate dependencies**

Make sure `allFixItems` and `selectedFixItemId` are in scope for both handlers.

**Step 4: Verify build**

Run: `cd apps/desktop && pnpm build`
Expected: Build succeeds

**Step 5: Run the app and test**

Run: `cd apps/desktop && pnpm dev:tauri`

Test:
1. Navigate to Fix Metadata page
2. Verify book list appears on left
3. Select a book, verify form populates
4. Edit fields and click Save
5. Use Search and verify results appear
6. Apply a result and verify book updates

**Step 6: Commit**

```bash
git add apps/desktop/src/App.tsx
git commit -m "feat(fix-metadata): integrate new FixView with App state"
```

---

### Task 6: Final Polish and Testing

**Step 1: Test all filter combinations**

- Toggle each filter checkbox
- Verify book list updates correctly
- Verify filter persists after page refresh

**Step 2: Test empty state**

- With strict filters that match no books
- Verify "All books have complete metadata!" message shows

**Step 3: Test manual save flow**

- Edit metadata manually
- Save changes
- Verify book data updates in database
- Verify book disappears from list if it now passes filter

**Step 4: Test search and apply flow**

- Select book with bad metadata
- Edit search query
- Click Search
- Apply a result
- Verify metadata updates

**Step 5: Final commit**

```bash
git add -A
git commit -m "feat(fix-metadata): complete redesign with triage workflow

- Three-panel layout: book list, metadata form, search results
- Configurable filters for what counts as 'needs fixing'
- Manual metadata editing with direct save
- Search with editable query
- Auto-advance to next book after fixing"
```

---

## Verification Checklist

- [ ] Build succeeds: `pnpm build`
- [ ] App starts: `pnpm dev:tauri`
- [ ] Book list shows filtered items
- [ ] Filter dropdown works and persists
- [ ] Selecting book populates form
- [ ] Manual edit + Save works
- [ ] Search returns results
- [ ] Apply result updates metadata
- [ ] Book disappears from list when fixed
- [ ] Empty state shows when all fixed
