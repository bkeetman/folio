import { AlertTriangle, BookOpen, ChevronDown, Image, Sparkles, User, X } from "lucide-react";
import type { Dispatch, SetStateAction } from "react";
import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { BookEditView } from "./BookEditView";
import { ProgressBar } from "../components/ProgressBar";
import { Button } from "../components/ui";
import type {
  EnrichmentCandidate,
  FixFilter,
  InboxItem,
  ItemMetadata,
  LibraryItem,
  OperationProgress,
} from "../types/library";

type FixViewProps = {
  items: LibraryItem[];
  inboxItems: InboxItem[];
  selectedItemId: string | null;
  setSelectedItemId: Dispatch<SetStateAction<string | null>>;
  fixFilter: FixFilter;
  setFixFilter: Dispatch<SetStateAction<FixFilter>>;
  searchQuery: string;
  setSearchQuery: Dispatch<SetStateAction<string>>;
  searchLoading: boolean;
  searchCandidates: EnrichmentCandidate[];
  onSearchWithQuery: (query: string) => Promise<void>;
  onApplyCandidate: (candidate: EnrichmentCandidate) => void;
  onSaveMetadata: (itemId: string, metadata: ItemMetadata) => Promise<void>;
  applyingCandidateId: string | null;
  getCandidateCoverUrl: (candidate: EnrichmentCandidate) => string | null;
  coverUrl: string | null;
  onFetchCover: (itemId: string, force?: boolean) => Promise<void>;
  onClearCover: (itemId: string) => void;
  onItemUpdate: () => Promise<void>;
  isDesktop: boolean;
  onQueueRemoveItem: (itemId: string) => Promise<void>;
  onEnrichAll: () => void;
  onCancelEnrich: () => void;
  enriching: boolean;
  enrichProgress: OperationProgress | null;
};

function getIssueIcon(item: LibraryItem, inboxItems: InboxItem[]) {
  if (!item.title) return <BookOpen size={14} className="text-amber-600" />;
  if (item.authors.length === 0) return <User size={14} className="text-amber-600" />;
  if (!item.cover_path) return <Image size={14} className="text-amber-600" />;
  if (inboxItems.some((inbox) => inbox.id === item.id)) {
    return <AlertTriangle size={14} className="text-amber-600" />;
  }
  return <AlertTriangle size={14} className="text-stone-400" />;
}

function getIssueReason(item: LibraryItem, inboxItems: InboxItem[]) {
  const match = inboxItems.find((inbox) => inbox.id === item.id);
  return match?.reason ?? null;
}

function buildDefaultMetadataQuery(item: LibraryItem): string {
  const isbn = item.isbn?.trim();
  if (isbn) return isbn;
  const title = item.title?.trim() ?? "";
  const author = item.authors[0]?.trim() ?? "";
  if (title && author) {
    return `${title} by ${author}`;
  }
  return title || author;
}

export function FixView({
  items,
  inboxItems,
  selectedItemId,
  setSelectedItemId,
  fixFilter,
  setFixFilter,
  searchQuery,
  setSearchQuery,
  searchLoading,
  searchCandidates,
  onSearchWithQuery,
  onApplyCandidate,
  onSaveMetadata,
  applyingCandidateId,
  getCandidateCoverUrl,
  coverUrl,
  onFetchCover,
  onClearCover,
  onItemUpdate,
  isDesktop,
  onQueueRemoveItem,
  onEnrichAll,
  onCancelEnrich,
  enriching,
  enrichProgress,
}: FixViewProps) {
  const { t } = useTranslation();
  const enrichLabel =
    items.length > 0
      ? t("fixView.needsFixingCountShort", { count: items.length })
      : t("fixView.needsFixingListEmpty");

  const renderEnrichToolbar = () => {
    if (!isDesktop) return null;
    return (
      <div className="rounded-lg border border-[var(--app-border)] bg-white/70 px-3 py-2">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-wider text-[var(--app-ink)]">
              {t("fixView.metadataEnrichment")}
            </div>
            <div className="text-[11px] text-[var(--app-ink-muted)]">{enrichLabel}</div>
          </div>
          {enriching ? (
            <Button
              variant="outline"
              size="sm"
              onClick={onCancelEnrich}
              className="gap-2 border-[var(--app-border-soft)] bg-[var(--app-bg-secondary)] text-[var(--app-ink)] shadow-sm hover:border-[var(--app-border)] hover:bg-[var(--app-bg-tertiary)]"
            >
              <X size={14} className="text-red-400" />
              {t("fixView.cancel")}
            </Button>
          ) : (
            <Button
              variant="default"
              size="sm"
              onClick={onEnrichAll}
              className="gap-2 shadow-sm"
              disabled={items.length === 0}
            >
              <Sparkles size={14} />
              {t("fixView.enrichNeedsFixing")}
            </Button>
          )}
        </div>
      </div>
    );
  };

  // Initialize form data when selection changes
  useEffect(() => {
    if (!selectedItemId) {
      setSearchQuery("");
      return;
    }
    const item = items.find((i) => i.id === selectedItemId);
    if (!item) {
      setSearchQuery("");
      return;
    }
    setSearchQuery(buildDefaultMetadataQuery(item));
    if (isDesktop && selectedItemId && !coverUrl) {
      void onFetchCover(selectedItemId);
    }
  }, [selectedItemId, items, setSearchQuery, isDesktop, coverUrl, onFetchCover]);

  // Auto-select first item if none selected, or if selected item no longer exists
  useEffect(() => {
    if (items.length === 0) {
      if (selectedItemId) setSelectedItemId(null);
      return;
    }
    const selectedStillExists = items.some((i) => i.id === selectedItemId);
    if (!selectedStillExists) {
      setSelectedItemId(items[0].id);
    }
  }, [selectedItemId, items, setSelectedItemId]);

  if (items.length === 0) {
    const hasActiveFilters = Object.values(fixFilter).some(Boolean);
    return (
      <section className="flex flex-col gap-4">
        {renderEnrichToolbar()}
        <ProgressBar
          progress={enrichProgress}
          label={t("fixView.enrichingLibrary")}
          variant="purple"
          show={enriching && enrichProgress !== null}
        />
        <div className="flex flex-col items-center justify-center gap-4 py-16">
          <div className="text-4xl">🎉</div>
          <div className="text-lg font-medium text-[var(--app-ink)]">{t("fixView.allComplete")}</div>
          <div className="text-sm text-[var(--app-ink-muted)]">{t("fixView.nothingNeedsFixing")}</div>
          <div className="flex items-center gap-2">
            {!fixFilter.includeIssues ? (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setFixFilter((current) => ({ ...current, includeIssues: true }))}
              >
                {t("fixView.showItemsWithIssues")}
              </Button>
            ) : null}
            {hasActiveFilters ? (
              <Button
                variant="ghost"
                size="sm"
                onClick={() =>
                  setFixFilter({
                    missingAuthor: true,
                    missingTitle: true,
                    missingCover: true,
                    missingIsbn: false,
                    missingYear: false,
                    missingDescription: false,
                    missingLanguage: false,
                    missingSeries: false,
                    includeIssues: true,
                  })
                }
              >
                {t("fixView.resetFilters")}
              </Button>
            ) : null}
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="flex flex-col gap-4">
      <ProgressBar
        progress={enrichProgress}
        label={t("fixView.enrichingLibrary")}
        variant="purple"
        show={enriching && enrichProgress !== null}
      />
      <div className="flex h-[calc(100vh-240px)] gap-4">
        {/* Left Panel: Book List */}
        <div className="w-56 flex-shrink-0 flex flex-col rounded-lg border border-[var(--app-border)] bg-white/70 overflow-hidden">
          <div className="flex items-center justify-between border-b border-[var(--app-border)] px-3 py-2">
            <span className="text-xs font-semibold text-[var(--app-ink)]">
              {t("fixView.needsFixingCount", { count: items.length })}
            </span>
            <FilterDropdown filter={fixFilter} setFilter={setFixFilter} />
          </div>
          {isDesktop ? (
            <div className="flex items-center justify-between gap-2 border-b border-[var(--app-border)] px-3 py-2 bg-[var(--app-bg)]/35">
              <span className="truncate text-[10px] text-[var(--app-ink-muted)]">
                {enrichLabel}
              </span>
              {enriching ? (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={onCancelEnrich}
                  className="h-7 gap-1 px-2 text-[11px] border-[var(--app-border-soft)] bg-[var(--app-bg-secondary)] text-[var(--app-ink)] hover:border-[var(--app-border)] hover:bg-[var(--app-bg-tertiary)]"
                >
                  <X size={12} className="text-red-400" />
                  {t("fixView.cancel")}
                </Button>
              ) : (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={onEnrichAll}
                  className="h-7 gap-1 px-2 text-[11px]"
                  disabled={items.length === 0}
                >
                  <Sparkles size={12} />
                  {t("fixView.enrichAction")}
                </Button>
              )}
            </div>
          ) : null}
          <div className="flex-1 overflow-y-auto scrollbar-hide">
            {items.map((item) => {
              const issueReason = getIssueReason(item, inboxItems);
              return (
                <button
                  key={item.id}
                  onClick={() => {
                    setSelectedItemId(item.id);
                    setSearchQuery(buildDefaultMetadataQuery(item));
                  }}
                  className={`w-full flex items-center gap-2 px-3 py-2 text-left text-xs hover:bg-[var(--app-bg)] transition-colors ${item.id === selectedItemId ? "bg-[var(--app-accent)]/10 border-l-2 border-[var(--app-accent)]" : ""
                    }`}
                >
                  {getIssueIcon(item, inboxItems)}
                  <span className="flex flex-col min-w-0">
                    <span className="truncate text-[var(--app-ink)]">
                      {item.title || t("fixView.untitled")}
                    </span>
                    {issueReason ? (
                      <span className="truncate text-[10px] text-[var(--app-ink-muted)]">
                        {issueReason}
                      </span>
                    ) : null}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto scrollbar-hide rounded-lg border border-[var(--app-border)] bg-white/70 p-4">
          <BookEditView
            selectedItemId={selectedItemId}
            libraryItems={items}
            previousView="fix"
            isDesktop={isDesktop}
            onItemUpdate={onItemUpdate}
            coverUrl={coverUrl}
            onFetchCover={onFetchCover}
            onClearCover={onClearCover}
            detailsVersion={0}
            matchQuery={searchQuery}
            onMatchQueryChange={setSearchQuery}
            matchLoading={searchLoading}
            matchCandidates={searchCandidates}
            onMatchSearch={(query) => {
              void onSearchWithQuery(query);
            }}
            onMatchApply={(candidate) => {
              onApplyCandidate(candidate);
            }}
            matchApplyingId={applyingCandidateId}
            onQueueRemoveItem={onQueueRemoveItem}
            getCandidateCoverUrl={getCandidateCoverUrl}
            onSaveMetadata={onSaveMetadata}
            embedded
          />
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
  const { t } = useTranslation();
  return (
    <div className="relative group">
      <button className="flex items-center gap-1 text-[10px] text-[var(--app-ink-muted)] hover:text-[var(--app-ink)]">
        {t("fixView.filter")} <ChevronDown size={12} />
      </button>
      <div className="absolute right-0 top-full mt-1 w-48 rounded-md border border-[var(--app-border)] bg-white shadow-lg opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all z-10">
        <div className="p-2 border-b border-[var(--app-border)]">
          <span className="text-[10px] font-semibold text-[var(--app-ink-muted)]">{t("fixView.showBooksMissing")}</span>
        </div>
        <div className="p-2 space-y-1">
          <FilterCheckbox label={t("fixView.author")} checked={filter.missingAuthor} onChange={(v) => setFilter({ ...filter, missingAuthor: v })} />
          <FilterCheckbox label={t("fixView.title")} checked={filter.missingTitle} onChange={(v) => setFilter({ ...filter, missingTitle: v })} />
          <FilterCheckbox label={t("fixView.cover")} checked={filter.missingCover} onChange={(v) => setFilter({ ...filter, missingCover: v })} />
          <FilterCheckbox label={t("fixView.isbn")} checked={filter.missingIsbn} onChange={(v) => setFilter({ ...filter, missingIsbn: v })} />
          <FilterCheckbox label={t("fixView.year")} checked={filter.missingYear} onChange={(v) => setFilter({ ...filter, missingYear: v })} />
          <FilterCheckbox label={t("fixView.language")} checked={filter.missingLanguage} onChange={(v) => setFilter({ ...filter, missingLanguage: v })} />
          <FilterCheckbox label={t("fixView.series")} checked={filter.missingSeries} onChange={(v) => setFilter({ ...filter, missingSeries: v })} />
        </div>
        <div className="p-2 border-t border-[var(--app-border)]">
          <span className="text-[10px] font-semibold text-[var(--app-ink-muted)]">{t("fixView.alsoShow")}</span>
          <div className="mt-1">
            <FilterCheckbox label={t("fixView.itemsWithIssues")} checked={filter.includeIssues} onChange={(v) => setFilter({ ...filter, includeIssues: v })} />
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
