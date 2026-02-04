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
  coverUrl: string | null;
  onFetchCover: (itemId: string, force?: boolean) => Promise<void>;
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

function getIssueReason(item: LibraryItem, inboxItems: InboxItem[]) {
  const match = inboxItems.find((inbox) => inbox.id === item.id);
  return match?.reason ?? null;
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
  coverUrl,
  onFetchCover,
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
      isbn: null,
      series: item.series ?? null,
      seriesIndex: item.series_index ?? null,
      description: null,
    });
    setSearchQuery(item.title ?? "");
    if (isDesktop && selectedItemId && !coverUrl) {
      void onFetchCover(selectedItemId);
    }
  }, [selectedItemId, items, setFormData, setSearchQuery, isDesktop, coverUrl, onFetchCover]);

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
          {items.map((item) => {
            const issueReason = getIssueReason(item, inboxItems);
            return (
              <button
                key={item.id}
                onClick={() => setSelectedItemId(item.id)}
                className={`w-full flex items-center gap-2 px-3 py-2 text-left text-xs hover:bg-[var(--app-bg)] transition-colors ${
                  item.id === selectedItemId ? "bg-[var(--app-accent)]/10 border-l-2 border-[var(--app-accent)]" : ""
                }`}
              >
                {getIssueIcon(item, inboxItems)}
                <span className="flex flex-col min-w-0">
                  <span className="truncate text-[var(--app-ink)]">
                    {item.title || "Untitled"}
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

      {/* Center Panel: Metadata Form */}
      <div className="flex-1 flex flex-col rounded-lg border border-[var(--app-border)] bg-white/70 overflow-hidden">
        <div className="border-b border-[var(--app-border)] px-4 py-2">
          <span className="text-xs font-semibold text-[var(--app-ink)]">CURRENT METADATA</span>
        </div>
        {selectedItem && formData ? (
          <div className="flex-1 overflow-y-auto p-4">
            <div className="flex gap-4">
              <div className="w-24 flex-shrink-0">
                <div className="h-36 w-24 overflow-hidden rounded-md border border-[var(--app-border)] bg-[#fffaf4]">
                  {coverUrl ? (
                    <img src={coverUrl} alt="" className="h-full w-full object-cover" />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center text-[10px] text-[var(--app-ink-muted)]">
                      No cover
                    </div>
                  )}
                </div>
              </div>
              <div className="flex-1 space-y-4">
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
