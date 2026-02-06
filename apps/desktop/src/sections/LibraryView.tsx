import { Filter, X } from "lucide-react";
import type { Dispatch, SetStateAction } from "react";
import { LibraryGrid } from "../components/LibraryGrid";
import { getTagColorClass } from "../lib/tagColors";
import { cn } from "../lib/utils";
import type { BookDisplay, LibraryFilter, LibrarySort, Tag } from "../types/library";

type LibraryViewProps = {
  isDesktop: boolean;
  libraryItemsLength: number;
  filteredBooks: BookDisplay[];
  selectedItemId: string | null;
  setSelectedItemId: Dispatch<SetStateAction<string | null>>;
  libraryFilter: LibraryFilter;
  setLibraryFilter: Dispatch<SetStateAction<LibraryFilter>>;
  librarySort: LibrarySort;
  setLibrarySort: Dispatch<SetStateAction<LibrarySort>>;
  tags: Tag[];
  selectedTagIds: string[];
  setSelectedTagIds: Dispatch<SetStateAction<string[]>>;
  grid: boolean;
  coverRefreshToken: number;
  fetchCoverOverride: (itemId: string) => void;
  clearCoverOverride: (itemId: string) => void;
  // Active navigation filters
  selectedAuthorNames: string[];
  setSelectedAuthorNames: Dispatch<SetStateAction<string[]>>;
  selectedSeries: string[];
  setSelectedSeries: Dispatch<SetStateAction<string[]>>;
  enrichingItems: Set<string>;
};

export function LibraryView({
  isDesktop,
  libraryItemsLength,
  filteredBooks,
  selectedItemId,
  setSelectedItemId,
  libraryFilter,
  setLibraryFilter,
  librarySort,
  setLibrarySort,
  tags,
  selectedTagIds,
  setSelectedTagIds,
  grid,
  coverRefreshToken,
  fetchCoverOverride,
  clearCoverOverride,
  selectedAuthorNames,
  setSelectedAuthorNames,
  selectedSeries,
  setSelectedSeries,
  enrichingItems,
}: LibraryViewProps) {
  const hasActiveFilter = selectedAuthorNames.length > 0 || selectedSeries.length > 0;

  return (
    <>
      {/* Active Filter Bar */}
      {hasActiveFilter && (
        <div className="flex items-center gap-2 rounded-lg border border-app-accent/20 bg-app-accent/5 px-3 py-2">
          <Filter size={14} className="text-app-accent" />
          <div className="flex flex-wrap gap-2 text-xs">
            {selectedAuthorNames.map((name) => (
              <span
                key={name}
                className="inline-flex items-center gap-1 rounded bg-white px-1.5 py-0.5 shadow-sm border border-app-accent/20 text-app-ink"
              >
                <span className="text-app-ink-muted">Author:</span> {name}
                <button
                  className="ml-0.5 text-app-accent hover:text-app-accent-strong"
                  onClick={() => setSelectedAuthorNames((prev) => prev.filter((n) => n !== name))}
                >
                  <X size={12} />
                </button>
              </span>
            ))}
            {selectedSeries.map((name) => (
              <span
                key={name}
                className="inline-flex items-center gap-1 rounded bg-white px-1.5 py-0.5 shadow-sm border border-app-accent/20 text-app-ink"
              >
                <span className="text-app-ink-muted">Series:</span> {name}
                <button
                  className="ml-0.5 text-app-accent hover:text-app-accent-strong"
                  onClick={() => setSelectedSeries((prev) => prev.filter((n) => n !== name))}
                >
                  <X size={12} />
                </button>
              </span>
            ))}
            <button
              className="ml-2 text-app-ink-muted hover:text-app-accent underline decoration-dotted underline-offset-2"
              onClick={() => {
                setSelectedAuthorNames([]);
                setSelectedSeries([]);
              }}
            >
              Clear all
            </button>
          </div>
        </div>
      )}

      {/* Main Toolbar */}
      <div className="sticky top-0 z-10 flex flex-wrap items-center gap-2 bg-app-bg/95 py-2 backdrop-blur-sm transition-all">
        <div className="flex h-8 items-center rounded-lg border border-app-border bg-app-surface p-1 shadow-sm">
          <FilterOption
            active={libraryFilter === "all"}
            onClick={() => setLibraryFilter("all")}
            label="All"
          />
          <div className="mx-1 h-3 w-px bg-app-border/40" />
          <FilterOption
            active={libraryFilter === "epub"}
            onClick={() => setLibraryFilter("epub")}
            label="EPUB"
          />
          <FilterOption
            active={libraryFilter === "pdf"}
            onClick={() => setLibraryFilter("pdf")}
            label="PDF"
          />
        </div>

        <div className="flex h-8 items-center rounded-lg border border-app-border bg-app-surface p-1 shadow-sm ml-auto sm:ml-0">
          <FilterOption
            active={libraryFilter === "needs-metadata"}
            onClick={() => setLibraryFilter("needs-metadata")}
            label="Missing Metadata"
            warning
          />
          <div className="mx-1 h-3 w-px bg-app-border/40" />
          <FilterOption
            active={libraryFilter === "tagged"}
            onClick={() => setLibraryFilter("tagged")}
            label="Tagged"
          />
        </div>

        <div className="ml-2 flex h-8 items-center gap-2 rounded-lg border border-app-border bg-app-surface px-2 shadow-sm">
          <span className="text-[10px] font-semibold uppercase tracking-[0.2em] text-app-ink-muted">
            Sort
          </span>
          <select
            value={librarySort}
            onChange={(event) => setLibrarySort(event.target.value as LibrarySort)}
            className="h-7 rounded-md border border-[var(--app-border)] bg-white px-2 text-[11px]"
          >
            <option value="default">Default</option>
            <option value="title-asc">Title A–Z</option>
            <option value="title-desc">Title Z–A</option>
            <option value="author-asc">Author A–Z</option>
            <option value="year-desc">Year (newest)</option>
            <option value="year-asc">Year (oldest)</option>
            <option value="recent">Recently added</option>
          </select>
        </div>

        {tags.length > 0 && (
          <div className="flex items-center gap-1.5 ml-2 overflow-x-auto no-scrollbar py-1">
            <span className="text-[10px] uppercase font-bold tracking-wider text-app-ink-muted/50 select-none">
              Tags
            </span>
            <button
              className={cn(
                "flex h-6 items-center rounded-full border px-2.5 text-[10px] font-medium transition-colors",
                selectedTagIds.length === 0
                  ? "border-app-ink/20 bg-app-ink/5 text-app-ink"
                  : "border-transparent text-app-ink-muted hover:bg-black/5"
              )}
              onClick={() => setSelectedTagIds([])}
            >
              All
            </button>
            {tags.map((tag) => {
              const active = selectedTagIds.includes(tag.id);
              return (
                <button
                  key={tag.id}
                  className={cn(
                    "flex h-6 items-center rounded-full border text-[10px] font-medium px-2.5 transition-all",
                    active
                      ? getTagColorClass(tag.color)
                      : "border-transparent bg-app-surface text-app-ink-muted hover:bg-black/5 hover:text-app-ink"
                  )}
                  onClick={() => {
                    setSelectedTagIds((prev) =>
                      prev.includes(tag.id)
                        ? prev.filter((id) => id !== tag.id)
                        : [...prev, tag.id]
                    );
                  }}
                >
                  {tag.name}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {isDesktop && !libraryItemsLength ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-app-border p-12 text-center">
          <div className="mb-2 text-sm font-semibold text-app-ink">Empty Library</div>
          <p className="text-xs text-app-ink-muted">Scan a folder to add books to your collection.</p>
        </div>
      ) : null}

      <LibraryGrid
        books={filteredBooks}
        selectedItemId={selectedItemId}
        onSelect={setSelectedItemId}
        coverRefreshToken={coverRefreshToken}
        fetchCoverOverride={fetchCoverOverride}
        clearCoverOverride={clearCoverOverride}
        viewMode={grid ? "grid" : "list"}
        enrichingItems={enrichingItems}
      />
    </>
  );
}

function FilterOption({ active, onClick, label, warning }: { active: boolean; onClick: () => void; label: string; warning?: boolean }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "rounded px-3 py-1 text-[11px] font-medium transition-all",
        active
          ? warning
            ? "bg-amber-100/50 text-amber-700 shadow-sm"
            : "bg-app-ink/5 text-app-ink shadow-sm"
          : "text-app-ink-muted hover:bg-black/5 hover:text-app-ink"
      )}
    >
      {label}
    </button>
  )
}
