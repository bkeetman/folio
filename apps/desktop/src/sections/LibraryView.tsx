import type { Dispatch, SetStateAction } from "react";
import { LibraryGrid } from "../components/LibraryGrid";
import { getTagColorClass } from "../lib/tagColors";
import type { BookDisplay, LibraryFilter, Tag } from "../types/library";

type LibraryViewProps = {
  isDesktop: boolean;
  libraryItemsLength: number;
  filteredBooks: BookDisplay[];
  selectedItemId: string | null;
  setSelectedItemId: Dispatch<SetStateAction<string | null>>;
  libraryFilter: LibraryFilter;
  setLibraryFilter: Dispatch<SetStateAction<LibraryFilter>>;
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
};

export function LibraryView({
  isDesktop,
  libraryItemsLength,
  filteredBooks,
  selectedItemId,
  setSelectedItemId,
  libraryFilter,
  setLibraryFilter,
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
}: LibraryViewProps) {
  const hasActiveFilter = selectedAuthorNames.length > 0 || selectedSeries.length > 0;

  return (
    <>
      {/* Active filter indicator */}
      {hasActiveFilter && (
        <div className="flex items-center gap-2 rounded-lg border border-[rgba(208,138,70,0.4)] bg-[rgba(208,138,70,0.08)] px-3 py-2">
          <span className="text-xs text-[var(--app-ink-muted)]">Filter:</span>
          {selectedAuthorNames.map((name) => (
            <span
              key={name}
              className="inline-flex items-center gap-1 rounded-full border border-[rgba(208,138,70,0.6)] bg-[rgba(208,138,70,0.12)] px-2 py-0.5 text-xs"
            >
              Auteur: {name}
              <button
                className="ml-1 text-[var(--app-ink-muted)] hover:text-[var(--app-ink)]"
                onClick={() => setSelectedAuthorNames((prev) => prev.filter((n) => n !== name))}
              >
                ×
              </button>
            </span>
          ))}
          {selectedSeries.map((name) => (
            <span
              key={name}
              className="inline-flex items-center gap-1 rounded-full border border-[rgba(208,138,70,0.6)] bg-[rgba(208,138,70,0.12)] px-2 py-0.5 text-xs"
            >
              Serie: {name}
              <button
                className="ml-1 text-[var(--app-ink-muted)] hover:text-[var(--app-ink)]"
                onClick={() => setSelectedSeries((prev) => prev.filter((n) => n !== name))}
              >
                ×
              </button>
            </span>
          ))}
          <button
            className="text-xs text-[var(--app-ink-muted)] hover:text-[var(--app-ink)] hover:underline"
            onClick={() => {
              setSelectedAuthorNames([]);
              setSelectedSeries([]);
            }}
          >
            Wis filters
          </button>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <button
          className={
            libraryFilter === "all"
              ? "rounded-full border border-[rgba(208,138,70,0.6)] bg-[rgba(208,138,70,0.12)] px-3 py-1 text-xs"
              : "rounded-full border border-[var(--app-border)] bg-white/80 px-3 py-1 text-xs hover:bg-white"
          }
          onClick={() => setLibraryFilter("all")}
        >
          All
        </button>
        <button
          className={
            libraryFilter === "epub"
              ? "rounded-full border border-[rgba(208,138,70,0.6)] bg-[rgba(208,138,70,0.12)] px-3 py-1 text-xs"
              : "rounded-full border border-[var(--app-border)] bg-white/80 px-3 py-1 text-xs hover:bg-white"
          }
          onClick={() => setLibraryFilter("epub")}
        >
          EPUB
        </button>
        <button
          className={
            libraryFilter === "pdf"
              ? "rounded-full border border-[rgba(208,138,70,0.6)] bg-[rgba(208,138,70,0.12)] px-3 py-1 text-xs"
              : "rounded-full border border-[var(--app-border)] bg-white/80 px-3 py-1 text-xs hover:bg-white"
          }
          onClick={() => setLibraryFilter("pdf")}
        >
          PDF
        </button>
        <button
          className={
            libraryFilter === "needs-metadata"
              ? "rounded-full border border-[rgba(208,138,70,0.6)] bg-[rgba(208,138,70,0.12)] px-3 py-1 text-xs"
              : "rounded-full border border-[var(--app-border)] bg-white/80 px-3 py-1 text-xs hover:bg-white"
          }
          onClick={() => setLibraryFilter("needs-metadata")}
        >
          Needs Metadata
        </button>
        <button
          className={
            libraryFilter === "tagged"
              ? "rounded-full border border-[rgba(208,138,70,0.6)] bg-[rgba(208,138,70,0.12)] px-3 py-1 text-xs"
              : "rounded-full border border-[var(--app-border)] bg-white/80 px-3 py-1 text-xs hover:bg-white"
          }
          onClick={() => setLibraryFilter("tagged")}
        >
          Tagged
        </button>
        {tags.length > 0 && (
          <div className="flex flex-wrap items-center gap-1">
            <span className="text-[10px] uppercase tracking-[0.12em] text-[var(--app-ink-muted)]">
              Tags
            </span>
            <button
              className={
                selectedTagIds.length === 0
                  ? "rounded-full border border-[rgba(208,138,70,0.6)] bg-[rgba(208,138,70,0.12)] px-2 py-0.5 text-[11px]"
                  : "rounded-full border border-[var(--app-border)] bg-white/80 px-2 py-0.5 text-[11px] hover:bg-white"
              }
              onClick={() => setSelectedTagIds([])}
            >
              All
            </button>
            {tags.map((tag) => {
              const active = selectedTagIds.includes(tag.id);
              return (
                <button
                  key={tag.id}
                  className={
                    active
                      ? `rounded-full border px-2 py-0.5 text-[11px] ${getTagColorClass(tag.color)}`
                      : "rounded-full border border-[var(--app-border)] bg-white/80 px-2 py-0.5 text-[11px] hover:bg-white"
                  }
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
        <div className="rounded-lg border border-[var(--app-border)] bg-white/70 p-4">
          <div className="text-[13px] font-semibold">Library is empty</div>
          <div className="text-xs text-[var(--app-ink-muted)]">
            Scan a folder to import books.
          </div>
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
      />
    </>
  );
}
