import { Filter, X } from "lucide-react";
import type { Dispatch, RefObject, SetStateAction } from "react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { LibraryGrid } from "../components/LibraryGrid";
import { BatchOperationsBar } from "../components/library/BatchOperationsBar";
import { LibraryToolbar } from "../components/library/LibraryToolbar";
import type {
  BatchMetadataUpdatePayload,
  BookDisplay,
  LibraryFilter,
  LibrarySort,
  Tag,
} from "../types/library";

type LibraryViewProps = {
  isDesktop: boolean;
  libraryItemsLength: number;
  filteredBooks: BookDisplay[];
  selectedItemId: string | null;
  selectedBatchItemIds: Set<string>;
  setSelectedItemId: Dispatch<SetStateAction<string | null>>;
  onToggleBatchSelect: (id: string) => void;
  onSetBatchSelection: (ids: string[]) => void;
  onClearBatchSelection: () => void;
  onApplyBatchMetadata: (payload: BatchMetadataUpdatePayload) => Promise<void>;
  onRemoveSelectedBooks: (itemIds: string[]) => Promise<boolean>;
  libraryFilter: LibraryFilter;
  setLibraryFilter: Dispatch<SetStateAction<LibraryFilter>>;
  librarySort: LibrarySort;
  setLibrarySort: Dispatch<SetStateAction<LibrarySort>>;
  tags: Tag[];
  selectedTagIds: string[];
  setSelectedTagIds: Dispatch<SetStateAction<string[]>>;
  grid: boolean;
  setGrid: Dispatch<SetStateAction<boolean>>;
  fetchCoverOverride: (itemId: string) => void;
  clearCoverOverride: (itemId: string) => void;
  onVisibleItemIdsChange: (ids: string[]) => void;
  scrollContainerRef: RefObject<HTMLElement | null>;
  // Active navigation filters
  selectedAuthorNames: string[];
  setSelectedAuthorNames: Dispatch<SetStateAction<string[]>>;
  selectedSeries: string[];
  setSelectedSeries: Dispatch<SetStateAction<string[]>>;
  selectedGenres: string[];
  setSelectedGenres: Dispatch<SetStateAction<string[]>>;
  enrichingItems: Set<string>;
};

export function LibraryView({
  isDesktop,
  libraryItemsLength,
  filteredBooks,
  selectedItemId,
  selectedBatchItemIds,
  setSelectedItemId,
  onToggleBatchSelect,
  onSetBatchSelection,
  onClearBatchSelection,
  onApplyBatchMetadata,
  onRemoveSelectedBooks,
  libraryFilter,
  setLibraryFilter,
  librarySort,
  setLibrarySort,
  tags,
  selectedTagIds,
  setSelectedTagIds,
  grid,
  setGrid,
  fetchCoverOverride,
  clearCoverOverride,
  onVisibleItemIdsChange,
  scrollContainerRef,
  selectedAuthorNames,
  setSelectedAuthorNames,
  selectedSeries,
  setSelectedSeries,
  selectedGenres,
  setSelectedGenres,
  enrichingItems,
}: LibraryViewProps) {
  const { t } = useTranslation();
  const [batchPanelOpen, setBatchPanelOpen] = useState(false);

  const hasActiveFilter =
    selectedAuthorNames.length > 0 || selectedSeries.length > 0 || selectedGenres.length > 0;
  const selectedBatchCount = selectedBatchItemIds.size;

  return (
    <>
      {/* Active Filter Bar (Navigation Filters) */}
      {hasActiveFilter && (
        <div className="flex items-center gap-2 rounded-lg border-[var(--app-accent)] border-opacity-20 bg-app-accent/5 px-3 py-2 mb-2">
          <Filter size={14} className="text-app-accent" />
          <div className="flex flex-wrap gap-2 text-xs">
            {selectedAuthorNames.map((name) => (
              <span
                key={name}
                className="inline-flex items-center gap-1 rounded bg-app-surface/80 px-1.5 py-0.5 shadow-sm border-[var(--app-accent)] border-opacity-20 text-app-ink"
              >
                <span className="text-app-ink-muted">{t("library.authorPrefix")}</span> {name}
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
                className="inline-flex items-center gap-1 rounded bg-app-surface/80 px-1.5 py-0.5 shadow-sm border-[var(--app-accent)] border-opacity-20 text-app-ink"
              >
                <span className="text-app-ink-muted">{t("library.seriesPrefix")}</span> {name}
                <button
                  className="ml-0.5 text-app-accent hover:text-app-accent-strong"
                  onClick={() => setSelectedSeries((prev) => prev.filter((n) => n !== name))}
                >
                  <X size={12} />
                </button>
              </span>
            ))}
            {selectedGenres.map((name) => (
              <span
                key={name}
                className="inline-flex items-center gap-1 rounded bg-app-surface/80 px-1.5 py-0.5 shadow-sm border-[var(--app-accent)] border-opacity-20 text-app-ink"
              >
                <span className="text-app-ink-muted">{t("library.categoryPrefix")}</span> {name}
                <button
                  className="ml-0.5 text-app-accent hover:text-app-accent-strong"
                  onClick={() => setSelectedGenres((prev) => prev.filter((n) => n !== name))}
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
                setSelectedGenres([]);
              }}
            >
              {t("library.clearAll")}
            </button>
          </div>
        </div>
      )}

      {/* Main Toolbar */}
      <LibraryToolbar
        libraryFilter={libraryFilter}
        setLibraryFilter={setLibraryFilter}
        librarySort={librarySort}
        setLibrarySort={setLibrarySort}
        tags={tags}
        selectedTagIds={selectedTagIds}
        setSelectedTagIds={setSelectedTagIds}
        batchPanelOpen={batchPanelOpen}
        setBatchPanelOpen={setBatchPanelOpen}
        selectedBatchCount={selectedBatchCount}
        grid={grid}
        setGrid={setGrid}
      />

      {/* Batch Operations Bar */}
      {(batchPanelOpen || selectedBatchCount > 0) && (
        <div className="mb-4 mt-2">
          <BatchOperationsBar
            filteredBooks={filteredBooks}
            selectedBatchItemIds={selectedBatchItemIds}
            onSetBatchSelection={onSetBatchSelection}
            onClearBatchSelection={onClearBatchSelection}
            onApplyBatchMetadata={onApplyBatchMetadata}
            onRemoveSelectedBooks={onRemoveSelectedBooks}
            tags={tags}
            isDesktop={isDesktop}
            onClose={() => setBatchPanelOpen(false)}
          />
        </div>
      )}

      {isDesktop && !libraryItemsLength ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-app-border p-12 text-center mt-8">
          <div className="mb-2 text-sm font-semibold text-app-ink">{t("library.empty")}</div>
          <p className="text-xs text-app-ink-muted">{t("library.emptyHint")}</p>
        </div>
      ) : null}

      <LibraryGrid
        books={filteredBooks}
        selectedItemId={selectedItemId}
        selectedBatchItemIds={selectedBatchItemIds}
        onSelect={setSelectedItemId}
        onToggleBatchSelect={onToggleBatchSelect}
        fetchCoverOverride={fetchCoverOverride}
        clearCoverOverride={clearCoverOverride}
        onVisibleItemIdsChange={onVisibleItemIdsChange}
        viewMode={grid ? "grid" : "list"}
        enrichingItems={enrichingItems}
        scrollContainerRef={scrollContainerRef}
      />
    </>
  );
}
