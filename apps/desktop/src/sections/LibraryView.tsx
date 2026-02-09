import { Filter, X } from "lucide-react";
import type { Dispatch, RefObject, SetStateAction } from "react";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { LibraryGrid } from "../components/LibraryGrid";
import { PREDEFINED_BOOK_CATEGORIES } from "../lib/categories";
import { LANGUAGE_OPTIONS } from "../lib/languageFlags";
import { getTagColorClass } from "../lib/tagColors";
import { cn } from "../lib/utils";
import type {
  BatchAuthorMode,
  BatchMetadataUpdatePayload,
  BatchTagMode,
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
  libraryFilter: LibraryFilter;
  setLibraryFilter: Dispatch<SetStateAction<LibraryFilter>>;
  librarySort: LibrarySort;
  setLibrarySort: Dispatch<SetStateAction<LibrarySort>>;
  tags: Tag[];
  selectedTagIds: string[];
  setSelectedTagIds: Dispatch<SetStateAction<string[]>>;
  grid: boolean;
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
  libraryFilter,
  setLibraryFilter,
  librarySort,
  setLibrarySort,
  tags,
  selectedTagIds,
  setSelectedTagIds,
  grid,
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
  const [batchApplying, setBatchApplying] = useState(false);
  const [selectedBatchCategory, setSelectedBatchCategory] = useState("");
  const [batchCategories, setBatchCategories] = useState<string[]>([]);
  const [batchAuthorInput, setBatchAuthorInput] = useState("");
  const [batchAuthorMode, setBatchAuthorMode] = useState<BatchAuthorMode>("append");
  const [batchAdvancedOpen, setBatchAdvancedOpen] = useState(false);
  const [batchLanguage, setBatchLanguage] = useState("");
  const [batchClearLanguage, setBatchClearLanguage] = useState(false);
  const [batchYearInput, setBatchYearInput] = useState("");
  const [batchClearPublishedYear, setBatchClearPublishedYear] = useState(false);
  const [selectedBatchTagId, setSelectedBatchTagId] = useState("");
  const [batchTagIds, setBatchTagIds] = useState<string[]>([]);
  const [batchTagMode, setBatchTagMode] = useState<BatchTagMode>("append");
  const [batchClearTags, setBatchClearTags] = useState(false);
  const hasActiveFilter =
    selectedAuthorNames.length > 0 || selectedSeries.length > 0 || selectedGenres.length > 0;
  const selectedBatchCount = selectedBatchItemIds.size;
  const filteredBookIds = useMemo(() => filteredBooks.map((book) => book.id), [filteredBooks]);
  const tagMap = useMemo(() => new Map(tags.map((tag) => [tag.id, tag])), [tags]);
  const availableBatchCategories = useMemo(
    () =>
      PREDEFINED_BOOK_CATEGORIES.filter(
        (category) =>
          !batchCategories.some(
            (selected) =>
              selected.localeCompare(category, undefined, {
                sensitivity: "base",
              }) === 0
          )
      ),
    [batchCategories]
  );
  const availableBatchTags = useMemo(
    () => tags.filter((tag) => !batchTagIds.includes(tag.id)),
    [batchTagIds, tags]
  );
  const parsedBatchYear = useMemo(() => {
    const trimmed = batchYearInput.trim();
    if (!trimmed) {
      return { value: null as number | null, invalid: false };
    }
    const parsed = Number.parseInt(trimmed, 10);
    const maxYear = new Date().getFullYear() + 1;
    if (!Number.isFinite(parsed) || parsed < 1400 || parsed > maxYear) {
      return { value: null as number | null, invalid: true };
    }
    return { value: parsed, invalid: false };
  }, [batchYearInput]);
  const hasBatchDraft =
    batchCategories.length > 0 ||
    batchAuthorInput.trim().length > 0 ||
    batchClearLanguage ||
    batchLanguage.trim().length > 0 ||
    batchClearPublishedYear ||
    parsedBatchYear.value !== null ||
    batchClearTags ||
    batchTagIds.length > 0;

  const handleApplyBatch = async () => {
    if (batchApplying || selectedBatchCount === 0) return;
    if (!batchClearPublishedYear && parsedBatchYear.invalid) return;
    const parsedAuthors = batchAuthorInput
      .split(",")
      .map((value) => value.trim())
      .filter((value) => value.length > 0)
      .filter(
        (value, index, array) =>
          array.findIndex(
            (entry) =>
              entry.localeCompare(value, undefined, {
                sensitivity: "base",
              }) === 0
          ) === index
      );

    const payload: BatchMetadataUpdatePayload = {
      itemIds: Array.from(selectedBatchItemIds),
    };
    if (batchCategories.length > 0) {
      payload.genres = batchCategories;
    }
    if (parsedAuthors.length > 0) {
      payload.authors = parsedAuthors;
      payload.authorMode = batchAuthorMode;
    }
    if (batchClearLanguage) {
      payload.clearLanguage = true;
    } else if (batchLanguage.trim().length > 0) {
      payload.language = batchLanguage.trim();
    }
    if (batchClearPublishedYear) {
      payload.clearPublishedYear = true;
    } else if (parsedBatchYear.value !== null) {
      payload.publishedYear = parsedBatchYear.value;
    }
    if (batchClearTags) {
      payload.clearTags = true;
    } else if (batchTagIds.length > 0) {
      payload.tagIds = batchTagIds;
      payload.tagMode = batchTagMode;
    }
    if (
      !payload.genres &&
      !payload.authors &&
      !payload.clearLanguage &&
      payload.publishedYear === undefined &&
      !payload.clearPublishedYear &&
      payload.language === undefined &&
      !payload.tagIds &&
      !payload.clearTags
    ) {
      return;
    }

    setBatchApplying(true);
    try {
      await onApplyBatchMetadata(payload);
    } finally {
      setBatchApplying(false);
    }
  };

  return (
    <>
      {/* Active Filter Bar */}
      {hasActiveFilter && (
        <div className="flex items-center gap-2 rounded-lg border-[var(--app-accent)] border-opacity-20 bg-app-accent/5 px-3 py-2">
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
      <div className="sticky top-0 z-10 flex flex-wrap items-center gap-2 bg-app-bg/95 py-2 backdrop-blur-sm transition-all">
        <div className="flex h-8 items-center rounded-lg border border-[var(--app-border-muted)] bg-app-surface p-1">
          <FilterOption
            active={libraryFilter === "all"}
            onClick={() => setLibraryFilter("all")}
            label={t("library.all")}
          />
          <div className="mx-1 h-3 w-px bg-app-border/40" />
          <FilterOption
            active={libraryFilter === "epub"}
            onClick={() => setLibraryFilter("epub")}
            label={t("library.epub")}
          />
          <FilterOption
            active={libraryFilter === "pdf"}
            onClick={() => setLibraryFilter("pdf")}
            label={t("library.pdf")}
          />
          <FilterOption
            active={libraryFilter === "mobi"}
            onClick={() => setLibraryFilter("mobi")}
            label={t("library.mobi")}
          />
        </div>

        <div className="flex h-8 items-center rounded-lg border border-[var(--app-border-muted)] bg-app-surface p-1 ml-auto sm:ml-0">
          <FilterOption
            active={libraryFilter === "needs-metadata"}
            onClick={() => setLibraryFilter("needs-metadata")}
            label={t("library.missingMetadata")}
            warning
          />
          <div className="mx-1 h-3 w-px bg-app-border/40" />
          <FilterOption
            active={libraryFilter === "tagged"}
            onClick={() => setLibraryFilter("tagged")}
            label={t("library.tagged")}
          />
          <FilterOption
            active={libraryFilter === "categorized"}
            onClick={() => setLibraryFilter("categorized")}
            label={t("library.categorized")}
          />
        </div>

        <div className="ml-2 flex h-8 items-center gap-2 rounded-lg border border-[var(--app-border-muted)] bg-app-surface px-2">
          <span className="text-[10px] font-semibold uppercase tracking-[0.2em] text-app-ink-muted">
            {t("library.sort")}
          </span>
          <select
            value={librarySort}
            onChange={(event) => setLibrarySort(event.target.value as LibrarySort)}
            className="h-7 rounded-md border border-[var(--app-border-muted)] bg-app-surface/80 px-2 text-[11px] text-app-ink focus:outline-none focus:ring-1 focus:ring-app-accent"
          >
            <option value="default">{t("library.sortDefault")}</option>
            <option value="title-asc">{t("library.sortTitleAsc")}</option>
            <option value="title-desc">{t("library.sortTitleDesc")}</option>
            <option value="author-asc">{t("library.sortAuthorAsc")}</option>
            <option value="year-desc">{t("library.sortYearDesc")}</option>
            <option value="year-asc">{t("library.sortYearAsc")}</option>
            <option value="recent">{t("library.sortRecent")}</option>
          </select>
        </div>

        <button
          type="button"
          onClick={() => setBatchPanelOpen((current) => !current)}
          className={cn(
            "ml-2 inline-flex h-8 items-center rounded-md border px-2.5 text-[11px] font-medium transition-colors",
            batchPanelOpen
              ? "border-[var(--app-accent)] bg-app-accent/10 text-app-accent-strong"
              : "border-[var(--app-border-soft)] bg-app-surface text-app-ink-muted hover:text-app-ink"
          )}
        >
          {t("library.batchEdit")}
          {selectedBatchCount > 0 ? (
            <span className="ml-2 rounded-full bg-app-accent/15 px-1.5 py-0.5 text-[10px] text-app-accent-strong">
              {selectedBatchCount}
            </span>
          ) : null}
        </button>

        {tags.length > 0 && (
          <div className="flex items-center gap-1.5 ml-2 overflow-x-auto no-scrollbar py-1">
            <span className="text-[10px] uppercase font-bold tracking-wider text-app-ink-muted/50 select-none">
              {t("sidebar.tags")}
            </span>
            <button
              className={cn(
                "flex h-6 items-center rounded-full border px-2.5 text-[10px] font-medium transition-colors",
                selectedTagIds.length === 0
                  ? "border-app-ink/20 bg-app-ink/10 text-app-ink"
                  : "border-transparent text-app-ink-muted hover:bg-app-surface-hover"
              )}
              onClick={() => setSelectedTagIds([])}
            >
              {t("library.all")}
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
                      : "border-transparent bg-app-surface text-app-ink-muted hover:bg-app-surface-hover hover:text-app-ink"
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

      {(batchPanelOpen || selectedBatchCount > 0) && (
        <div className="rounded-lg border border-[var(--app-border-soft)] bg-app-surface/55 px-3 py-3 shadow-sm">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-app-ink-muted">
                {t("library.batchEdit")}
              </span>
              <span className="text-xs text-app-ink-muted">
                {t("library.batchSelectedCount", { count: selectedBatchCount })}
              </span>
            </div>
            <div className="flex flex-wrap gap-2 sm:ml-auto">
              <button
                type="button"
                className="rounded border border-[var(--app-border-soft)] px-2 py-1 text-[11px] text-app-ink-muted transition-colors hover:text-app-ink"
                onClick={() => onSetBatchSelection(filteredBookIds)}
              >
                {t("library.batchSelectFiltered", { count: filteredBooks.length })}
              </button>
              <button
                type="button"
                className="rounded border border-[var(--app-border-soft)] px-2 py-1 text-[11px] text-app-ink-muted transition-colors hover:text-app-ink disabled:cursor-not-allowed disabled:opacity-60"
                disabled={selectedBatchCount === 0}
                onClick={onClearBatchSelection}
              >
                {t("library.batchClearSelection")}
              </button>
            </div>
          </div>

          {batchPanelOpen ? (
            <div className="mt-3 space-y-3">
              <div>
                <label className="mb-1 block text-[11px] font-semibold uppercase tracking-[0.12em] text-app-ink-muted">
                  {t("library.batchCategories")}
                </label>
                <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
                  <select
                    value={selectedBatchCategory}
                    onChange={(event) => setSelectedBatchCategory(event.target.value)}
                    className="h-8 w-full min-w-0 rounded-md border border-[var(--app-border-soft)] bg-app-surface px-2 text-xs text-app-ink"
                  >
                    <option value="">{t("library.batchSelectCategory")}</option>
                    {availableBatchCategories.map((category) => (
                      <option key={category} value={category}>
                        {category}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    className="h-8 w-full rounded border border-[var(--app-border-soft)] px-3 text-xs text-app-ink-muted transition-colors hover:text-app-ink disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
                    disabled={!selectedBatchCategory}
                    onClick={() => {
                      if (!selectedBatchCategory) return;
                      setBatchCategories((current) => [...current, selectedBatchCategory]);
                      setSelectedBatchCategory("");
                    }}
                  >
                    {t("library.batchAddCategory")}
                  </button>
                </div>
                {batchCategories.length > 0 ? (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {batchCategories.map((genre) => (
                      <button
                        key={genre}
                        type="button"
                        className="inline-flex items-center rounded-full border border-[var(--app-border-soft)] bg-[var(--app-bg-secondary)] px-2 py-0.5 text-[11px] text-app-ink-muted hover:border-[var(--app-accent)] hover:text-[var(--app-accent-strong)]"
                        onClick={() =>
                          setBatchCategories((current) =>
                            current.filter(
                              (value) =>
                                value.localeCompare(genre, undefined, {
                                  sensitivity: "base",
                                }) !== 0
                            )
                          )
                        }
                      >
                        {genre}
                        <span className="ml-1 text-[10px]">×</span>
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>

              <div>
                <label className="mb-1 block text-[11px] font-semibold uppercase tracking-[0.12em] text-app-ink-muted">
                  {t("library.batchAuthors")}
                </label>
                <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_120px]">
                  <input
                    value={batchAuthorInput}
                    onChange={(event) => setBatchAuthorInput(event.target.value)}
                    placeholder={t("library.batchAuthorsPlaceholder")}
                    className="h-8 rounded-md border border-[var(--app-border-soft)] bg-app-surface px-2 text-xs text-app-ink"
                  />
                  <select
                    value={batchAuthorMode}
                    onChange={(event) => setBatchAuthorMode(event.target.value as BatchAuthorMode)}
                    className="h-8 rounded-md border border-[var(--app-border-soft)] bg-app-surface px-2 text-xs text-app-ink"
                  >
                    <option value="append">{t("library.batchAuthorModeAppend")}</option>
                    <option value="replace">{t("library.batchAuthorModeReplace")}</option>
                  </select>
                </div>
              </div>

              <div className="rounded-md border border-[var(--app-border-soft)] bg-app-surface/30 px-3 py-2">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-app-ink-muted">
                    {t("library.batchAdvanced")}
                  </span>
                  <button
                    type="button"
                    className="rounded border border-[var(--app-border-soft)] px-2 py-0.5 text-[10px] text-app-ink-muted transition-colors hover:text-app-ink"
                    onClick={() => setBatchAdvancedOpen((current) => !current)}
                  >
                    {batchAdvancedOpen
                      ? t("library.batchAdvancedHide")
                      : t("library.batchAdvancedShow")}
                  </button>
                </div>

                {batchAdvancedOpen ? (
                  <div className="mt-2 space-y-3">
                    <div className="grid gap-2 sm:grid-cols-2">
                      <div>
                        <div className="mb-1 flex items-center justify-between">
                          <label className="text-[11px] font-semibold text-app-ink-muted">
                            {t("library.batchLanguage")}
                          </label>
                          <label className="inline-flex items-center gap-1 text-[10px] text-app-ink-muted">
                            <input
                              type="checkbox"
                              checked={batchClearLanguage}
                              onChange={(event) => setBatchClearLanguage(event.target.checked)}
                            />
                            {t("library.batchClearLanguage")}
                          </label>
                        </div>
                        <select
                          value={batchLanguage}
                          onChange={(event) => setBatchLanguage(event.target.value)}
                          disabled={batchClearLanguage}
                          className="h-8 w-full rounded-md border border-[var(--app-border-soft)] bg-app-surface px-2 text-xs text-app-ink"
                        >
                          <option value="">{t("library.batchNoChange")}</option>
                          {LANGUAGE_OPTIONS.map((language) => (
                            <option key={language.code} value={language.code}>
                              {language.flag ? `${language.flag} ${language.name}` : language.name}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <div className="mb-1 flex items-center justify-between">
                          <label className="text-[11px] font-semibold text-app-ink-muted">
                            {t("library.batchPublicationYear")}
                          </label>
                          <label className="inline-flex items-center gap-1 text-[10px] text-app-ink-muted">
                            <input
                              type="checkbox"
                              checked={batchClearPublishedYear}
                              onChange={(event) =>
                                setBatchClearPublishedYear(event.target.checked)
                              }
                            />
                            {t("library.batchClearPublicationYear")}
                          </label>
                        </div>
                        <input
                          type="number"
                          value={batchYearInput}
                          onChange={(event) => setBatchYearInput(event.target.value)}
                          disabled={batchClearPublishedYear}
                          placeholder={t("library.batchPublicationYearPlaceholder")}
                          className="h-8 w-full rounded-md border border-[var(--app-border-soft)] bg-app-surface px-2 text-xs text-app-ink"
                        />
                        {!batchClearPublishedYear && parsedBatchYear.invalid ? (
                          <p className="mt-1 text-[10px] text-amber-500">
                            {t("library.batchPublicationYearInvalid")}
                          </p>
                        ) : null}
                      </div>
                    </div>

                    {tags.length > 0 ? (
                      <div>
                        <div className="mb-1 flex items-center justify-between">
                          <label className="text-[11px] font-semibold text-app-ink-muted">
                            {t("library.batchTags")}
                          </label>
                          <label className="inline-flex items-center gap-1 text-[10px] text-app-ink-muted">
                            <input
                              type="checkbox"
                              checked={batchClearTags}
                              onChange={(event) => setBatchClearTags(event.target.checked)}
                            />
                            {t("library.batchClearTags")}
                          </label>
                        </div>
                        <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto_120px]">
                          <select
                            value={selectedBatchTagId}
                            onChange={(event) => setSelectedBatchTagId(event.target.value)}
                            disabled={batchClearTags}
                            className="h-8 w-full rounded-md border border-[var(--app-border-soft)] bg-app-surface px-2 text-xs text-app-ink"
                          >
                            <option value="">{t("library.batchSelectTag")}</option>
                            {availableBatchTags.map((tag) => (
                              <option key={tag.id} value={tag.id}>
                                {tag.name}
                              </option>
                            ))}
                          </select>
                          <button
                            type="button"
                            className="h-8 rounded border border-[var(--app-border-soft)] px-3 text-xs text-app-ink-muted transition-colors hover:text-app-ink disabled:cursor-not-allowed disabled:opacity-60"
                            disabled={!selectedBatchTagId || batchClearTags}
                            onClick={() => {
                              if (!selectedBatchTagId) return;
                              setBatchTagIds((current) => [...current, selectedBatchTagId]);
                              setSelectedBatchTagId("");
                            }}
                          >
                            {t("library.batchAddTag")}
                          </button>
                          <select
                            value={batchTagMode}
                            onChange={(event) => setBatchTagMode(event.target.value as BatchTagMode)}
                            disabled={batchClearTags}
                            className="h-8 rounded-md border border-[var(--app-border-soft)] bg-app-surface px-2 text-xs text-app-ink"
                          >
                            <option value="append">{t("library.batchTagModeAppend")}</option>
                            <option value="replace">{t("library.batchTagModeReplace")}</option>
                            <option value="remove">{t("library.batchTagModeRemove")}</option>
                          </select>
                        </div>
                        {batchTagIds.length > 0 ? (
                          <div className="mt-2 flex flex-wrap gap-1.5">
                            {batchTagIds.map((tagId) => {
                              const tag = tagMap.get(tagId);
                              const label = tag?.name ?? tagId;
                              return (
                                <button
                                  key={tagId}
                                  type="button"
                                  className="inline-flex items-center rounded-full border border-[var(--app-border-soft)] bg-[var(--app-bg-secondary)] px-2 py-0.5 text-[11px] text-app-ink-muted hover:border-[var(--app-accent)] hover:text-[var(--app-accent-strong)]"
                                  disabled={batchClearTags}
                                  onClick={() =>
                                    setBatchTagIds((current) =>
                                      current.filter((value) => value !== tagId)
                                    )
                                  }
                                >
                                  {label}
                                  <span className="ml-1 text-[10px]">×</span>
                                </button>
                              );
                            })}
                          </div>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </div>

              <div className="flex flex-col gap-2 pt-1 sm:flex-row sm:items-center">
                <button
                  type="button"
                  className="w-full rounded border border-[var(--app-border-soft)] px-2.5 py-1 text-[11px] text-app-ink-muted transition-colors hover:text-app-ink sm:w-auto"
                  onClick={() => {
                    setBatchCategories([]);
                    setSelectedBatchCategory("");
                    setBatchAuthorInput("");
                    setBatchAuthorMode("append");
                    setBatchAdvancedOpen(false);
                    setBatchLanguage("");
                    setBatchClearLanguage(false);
                    setBatchYearInput("");
                    setBatchClearPublishedYear(false);
                    setBatchTagIds([]);
                    setSelectedBatchTagId("");
                    setBatchTagMode("append");
                    setBatchClearTags(false);
                  }}
                >
                  {t("library.batchResetFields")}
                </button>
                <button
                  type="button"
                  className="w-full rounded bg-[var(--app-accent)] px-2.5 py-1 text-[11px] font-semibold text-white transition-colors hover:bg-[var(--app-accent-hover)] disabled:cursor-not-allowed disabled:opacity-60 sm:ml-auto sm:w-auto"
                  disabled={
                    !hasBatchDraft ||
                    selectedBatchCount === 0 ||
                    batchApplying ||
                    (!batchClearPublishedYear && parsedBatchYear.invalid)
                  }
                  onClick={() => void handleApplyBatch()}
                >
                  {batchApplying
                    ? t("library.batchApplying")
                    : t("library.batchApplyToSelected")}
                </button>
              </div>
            </div>
          ) : null}
        </div>
      )}

      {isDesktop && !libraryItemsLength ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-app-border p-12 text-center">
          <div className="mb-2 text-sm font-semibold text-app-ink">{t("library.empty")}</div>
          <p className="text-xs text-app-ink-muted">{t("library.emptyHint")}</p>
        </div>
      ) : null
      }

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

function FilterOption({ active, onClick, label, warning }: { active: boolean; onClick: () => void; label: string; warning?: boolean }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "rounded px-3 py-1 text-[11px] font-medium transition-all",
        active
          ? warning
            ? "bg-amber-100/50 text-amber-700 shadow-sm dark:bg-amber-900/40 dark:text-amber-300"
            : "bg-app-ink/10 text-app-ink shadow-sm dark:bg-app-accent/20 dark:text-app-accent"
          : "text-app-ink-muted hover:bg-app-surface-hover hover:text-app-ink"
      )}
    >
      {label}
    </button>
  )
}
