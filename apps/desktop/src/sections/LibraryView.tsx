import type { Dispatch, SetStateAction } from "react";
import type { LibraryFilter, Tag } from "../types/library";
import { getTagColorClass } from "../lib/tagColors";

type LibraryViewProps = {
  isDesktop: boolean;
  libraryItemsLength: number;
  filteredBooks: Array<{
    id: string;
    title: string;
    author: string;
    format: string;
    year: number | string;
    status: string;
    cover: string | null;
    tags?: Tag[];
  }>;
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

      {grid ? (
        <div className="grid grid-cols-[repeat(auto-fit,minmax(170px,1fr))] gap-3 rounded-lg bg-[linear-gradient(180deg,rgba(255,255,255,0.45),rgba(255,255,255,0.45)),repeating-linear-gradient(to_bottom,rgba(44,38,33,0.05)_0px,rgba(44,38,33,0.05)_2px,transparent_2px,transparent_190px)] p-3">
          {filteredBooks.map((book) => (
            <article
              key={book.id}
              className={
                selectedItemId === book.id
                  ? "flex cursor-pointer flex-col overflow-hidden rounded-md border border-[rgba(201,122,58,0.6)] bg-[#fffdf9] shadow-[0_16px_24px_rgba(201,122,58,0.18)] transition"
                  : "flex cursor-pointer flex-col overflow-hidden rounded-md border border-[rgba(44,38,33,0.08)] bg-[#fffdf9] shadow-[0_10px_18px_rgba(30,22,15,0.06)] transition hover:shadow-[0_18px_26px_rgba(24,18,12,0.1)]"
              }
              onClick={() => setSelectedItemId(book.id)}
              role="button"
              tabIndex={0}
              onKeyDown={(event) => {
                if (event.key === "Enter") setSelectedItemId(book.id);
              }}
            >
              <div className="relative aspect-[3/4] overflow-hidden rounded-t-md border-b border-[rgba(44,38,33,0.06)] bg-[linear-gradient(135deg,#efe3d1,#f2e7d9)]">
                {book.cover ? (
                  <img
                    key={`${book.id}-${coverRefreshToken}-${book.cover ?? "none"}`}
                    className="absolute inset-0 h-full w-full object-cover bg-[#f7f1e7]"
                    src={book.cover}
                    alt=""
                    onError={() => {
                      clearCoverOverride(book.id);
                      void fetchCoverOverride(book.id);
                    }}
                  />
                ) : null}
                {book.cover ? (
                  <div className="absolute left-2 top-2 rounded-md bg-[rgba(255,255,255,0.9)] px-2 py-0.5 text-[10px] uppercase tracking-[0.12em]">
                    {book.format}
                  </div>
                ) : (
                  <div className="relative z-10 flex flex-col gap-2 p-3">
                    <div className="rounded-md bg-[rgba(255,255,255,0.8)] px-2 py-0.5 text-[10px] uppercase tracking-[0.12em]">
                      {book.format}
                    </div>
                    <div className="text-[13px] font-semibold leading-snug">
                      {book.title}
                    </div>
                  </div>
                )}
              </div>
              <div className="flex flex-col gap-1 px-3 py-2">
                <div className="text-[13px] font-semibold">{book.title}</div>
                {(book.tags ?? []).length ? (
                  <div className="flex flex-wrap gap-1">
                    {(book.tags ?? []).slice(0, 3).map((tag) => (
                      <span
                        key={tag.id}
                        className={`rounded-full border px-2 py-0.5 text-[10px] ${getTagColorClass(tag.color)}`}
                      >
                        {tag.name}
                      </span>
                    ))}
                  </div>
                ) : null}
                <div className="grid gap-1">
                  <div className="flex items-center justify-between gap-2 text-xs text-[var(--app-ink-muted)]">
                    <span className="text-[10px] uppercase tracking-[0.12em]">
                      Auteur
                    </span>
                    <span className="text-[var(--app-ink)]">{book.author}</span>
                  </div>
                  <div className="flex items-center justify-between gap-2 text-xs text-[var(--app-ink-muted)]">
                    <span className="text-[10px] uppercase tracking-[0.12em]">
                      Jaar
                    </span>
                    <span className="text-[var(--app-ink)]">{book.year}</span>
                  </div>
                </div>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border border-[var(--app-border)] bg-[#fffdf9]">
          <div className="grid grid-cols-[56px_2fr_1.5fr_0.6fr_0.8fr] gap-3 bg-[#f9f4ee] px-4 py-2 text-[10px] uppercase tracking-[0.12em] text-[var(--app-ink-muted)]">
            <div></div>
            <div>Titel</div>
            <div>Auteur</div>
            <div>Jaar</div>
            <div>Formaat</div>
          </div>
          {filteredBooks.map((book) => (
            <div
              key={book.id}
              className={
                selectedItemId === book.id
                  ? "grid cursor-pointer grid-cols-[56px_2fr_1.5fr_0.6fr_0.8fr] gap-3 border-t border-[var(--app-border)] bg-[rgba(201,122,58,0.12)] px-4 py-2"
                  : "grid cursor-pointer grid-cols-[56px_2fr_1.5fr_0.6fr_0.8fr] gap-3 border-t border-[var(--app-border)] px-4 py-2 hover:bg-[rgba(201,122,58,0.06)]"
              }
              onClick={() => setSelectedItemId(book.id)}
              role="button"
              tabIndex={0}
              onKeyDown={(event) => {
                if (event.key === "Enter") setSelectedItemId(book.id);
              }}
            >
              <div className="grid h-16 w-12 place-items-center overflow-hidden rounded-md border border-[rgba(44,38,33,0.12)] bg-[#fffaf4]">
                {book.cover ? (
                  <img
                    key={`${book.id}-${coverRefreshToken}-${book.cover ?? "none"}`}
                    className="h-full w-full object-contain"
                    src={book.cover}
                    alt=""
                    onError={() => {
                      clearCoverOverride(book.id);
                      void fetchCoverOverride(book.id);
                    }}
                  />
                ) : (
                  <div className="text-[10px] uppercase tracking-[0.12em] text-[var(--app-ink-muted)]">
                    {book.format}
                  </div>
                )}
              </div>
              <div className="flex flex-col gap-1">
                <div className="text-sm font-semibold">{book.title}</div>
                {(book.tags ?? []).length ? (
                  <div className="flex flex-wrap gap-1">
                    {(book.tags ?? []).slice(0, 2).map((tag) => (
                      <span
                        key={tag.id}
                        className={`rounded-full border px-2 py-0.5 text-[10px] ${getTagColorClass(tag.color)}`}
                      >
                        {tag.name}
                      </span>
                    ))}
                  </div>
                ) : null}
              </div>
              <div className="text-xs text-[var(--app-ink-muted)]">
                {book.author}
              </div>
              <div className="text-xs text-[var(--app-ink-muted)]">
                {book.year}
              </div>
              <div className="text-xs text-[var(--app-ink-muted)]">
                {book.format}
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
