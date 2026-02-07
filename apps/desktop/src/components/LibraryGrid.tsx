import { useEffect, useMemo, useRef, useState } from "react";
import type { RefObject } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useTranslation } from "react-i18next";
import type { BookDisplay } from "../types/library";
import { BookCard } from "./BookCard";

type LibraryGridProps = {
  books: BookDisplay[];
  selectedItemId: string | null;
  onSelect: (id: string) => void;
  fetchCoverOverride: (id: string) => void;
  clearCoverOverride: (id: string) => void;
  viewMode: "grid" | "list";
  enrichingItems?: Set<string>;
  scrollContainerRef: RefObject<HTMLElement | null>;
};

const GRID_MIN_CARD_WIDTH = 170;
const GRID_GAP = 12;
const GRID_PADDING_X = 24;

export function LibraryGrid({
  books,
  selectedItemId,
  onSelect,
  fetchCoverOverride,
  clearCoverOverride,
  viewMode,
  enrichingItems,
  scrollContainerRef,
}: LibraryGridProps) {
  const { t } = useTranslation();
  const gridRef = useRef<HTMLDivElement | null>(null);
  const [gridWidth, setGridWidth] = useState(0);

  useEffect(() => {
    if (viewMode !== "grid") return;
    const node = gridRef.current;
    if (!node) return;

    const updateWidth = () => {
      setGridWidth(node.clientWidth);
    };

    updateWidth();

    const observer = new ResizeObserver(() => {
      updateWidth();
    });
    observer.observe(node);

    return () => {
      observer.disconnect();
    };
  }, [viewMode]);

  const laneCount = useMemo(() => {
    const usableWidth = Math.max(0, gridWidth - GRID_PADDING_X);
    if (usableWidth <= 0) return 1;
    return Math.max(1, Math.floor((usableWidth + GRID_GAP) / (GRID_MIN_CARD_WIDTH + GRID_GAP)));
  }, [gridWidth]);

  const rowCount = Math.ceil(books.length / laneCount);

  // eslint-disable-next-line react-hooks/incompatible-library
  const listVirtualizer = useVirtualizer({
    count: books.length,
    getScrollElement: () => scrollContainerRef.current,
    estimateSize: () => 78,
    overscan: 10,
    enabled: viewMode === "list",
  });

  const gridVirtualizer = useVirtualizer({
    count: rowCount,
    getScrollElement: () => scrollContainerRef.current,
    estimateSize: () => 360,
    overscan: 4,
    enabled: viewMode === "grid",
  });

  if (viewMode === "list") {
    const virtualRows = listVirtualizer.getVirtualItems();

    return (
      <div className="overflow-hidden rounded-lg border border-app-border bg-app-panel surface-gradient shadow-sm">
        <div className="grid grid-cols-[56px_2fr_1.5fr_0.6fr_0.8fr] gap-3 bg-app-bg-secondary px-4 py-2 text-[10px] uppercase tracking-[0.12em] text-app-ink-muted">
          <div></div>
          <div>{t("library.columnTitle")}</div>
          <div>{t("library.columnAuthor")}</div>
          <div>{t("library.columnYear")}</div>
          <div>{t("library.columnFormat")}</div>
        </div>

        <div className="relative" style={{ height: listVirtualizer.getTotalSize() }}>
          {virtualRows.map((virtualRow) => {
            const book = books[virtualRow.index];
            if (!book) return null;
            return (
              <div
                key={book.id}
                className="absolute left-0 top-0 w-full"
                style={{ transform: `translateY(${virtualRow.start}px)` }}
              >
                <BookCard
                  book={book}
                  selected={selectedItemId === book.id}
                  onSelect={onSelect}
                  fetchCoverOverride={fetchCoverOverride}
                  clearCoverOverride={clearCoverOverride}
                  viewMode="list"
                  isEnriching={enrichingItems?.has(book.id) ?? false}
                />
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  const virtualRows = gridVirtualizer.getVirtualItems();

  return (
    <div
      ref={gridRef}
      className="rounded-lg bg-app-bg/10 p-3 shadow-inner ring-1 ring-white/5"
    >
      <div className="relative" style={{ height: gridVirtualizer.getTotalSize() }}>
        {virtualRows.map((virtualRow) => {
          const startIndex = virtualRow.index * laneCount;
          const rowBooks = books.slice(startIndex, startIndex + laneCount);

          return (
            <div
              key={virtualRow.index}
              className="absolute left-0 top-0 grid w-full gap-3"
              style={{
                transform: `translateY(${virtualRow.start}px)`,
                gridTemplateColumns: `repeat(${laneCount}, minmax(0, 1fr))`,
              }}
            >
              {rowBooks.map((book) => (
                <BookCard
                  key={book.id}
                  book={book}
                  selected={selectedItemId === book.id}
                  onSelect={onSelect}
                  fetchCoverOverride={fetchCoverOverride}
                  clearCoverOverride={clearCoverOverride}
                  viewMode="grid"
                  isEnriching={enrichingItems?.has(book.id) ?? false}
                />
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}
