import { ChevronDown, ChevronRight, Search } from "lucide-react";
import type { Dispatch, SetStateAction } from "react";
import { useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { getLanguageFlag } from "../lib/languageFlags";
import type { BookDisplay, View } from "../types/library";

type Series = {
  name: string;
  bookCount: number;
};

function summarizeSeriesAuthors(seriesBooks: BookDisplay[]): string {
  const uniqueByKey = new Map<string, string>();
  seriesBooks.forEach((book) => {
    const authors = book.authors.length
      ? book.authors
      : book.author.split(",").map((value) => value.trim()).filter(Boolean);
    authors.forEach((author) => {
      const normalized = author.trim().toLocaleLowerCase();
      if (!normalized || uniqueByKey.has(normalized)) return;
      uniqueByKey.set(normalized, author.trim());
    });
  });

  const uniqueAuthors = Array.from(uniqueByKey.values());

  if (uniqueAuthors.length === 0) return "";
  if (uniqueAuthors.length <= 2) return uniqueAuthors.join(", ");
  return `${uniqueAuthors[0]}, ${uniqueAuthors[1]} +${uniqueAuthors.length - 2}`;
}

function normalizeSeriesKey(value: string) {
  return value.trim().toLocaleLowerCase();
}

type SeriesViewProps = {
  series: Series[];
  books: BookDisplay[];
  setSelectedSeries: Dispatch<SetStateAction<string[]>>;
  setSelectedGenres: Dispatch<SetStateAction<string[]>>;
  setView: Dispatch<SetStateAction<View>>;
  onSelectBook: (bookId: string) => void;
};

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ#".split("");

export function SeriesView({
  series,
  books,
  setSelectedSeries,
  setSelectedGenres,
  setView,
  onSelectBook,
}: SeriesViewProps) {
  const { t } = useTranslation();
  const [searchQuery, setSearchQuery] = useState("");
  const sectionRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const [expandedSeries, setExpandedSeries] = useState<Set<string>>(new Set());

  // Group books by series name
  const booksBySeries = useMemo(() => {
    const grouped: Record<string, BookDisplay[]> = {};
    books.forEach((book) => {
      if (book.series) {
        const key = normalizeSeriesKey(book.series);
        if (!key) return;
        if (!grouped[key]) grouped[key] = [];
        grouped[key].push(book);
      }
    });
    // Sort books within each series by seriesIndex
    Object.keys(grouped).forEach((key) => {
      grouped[key].sort((a, b) => (a.seriesIndex ?? 999) - (b.seriesIndex ?? 999));
    });
    return grouped;
  }, [books]);

  const toggleExpanded = (seriesName: string) => {
    setExpandedSeries((prev) => {
      const next = new Set(prev);
      if (next.has(seriesName)) {
        next.delete(seriesName);
      } else {
        next.add(seriesName);
      }
      return next;
    });
  };

  // Filter series by search query
  const filteredSeries = useMemo(() => {
    if (!searchQuery.trim()) return series;
    const query = searchQuery.toLowerCase();
    return series.filter((s) => s.name.toLowerCase().includes(query));
  }, [series, searchQuery]);

  // Group series by first letter
  const groupedSeries = useMemo(() => {
    const groups: Record<string, Series[]> = {};

    filteredSeries.forEach((s) => {
      const firstChar = s.name.charAt(0).toUpperCase();
      const key = /[A-Z]/.test(firstChar) ? firstChar : "#";
      if (!groups[key]) groups[key] = [];
      groups[key].push(s);
    });

    // Sort each group alphabetically
    Object.keys(groups).forEach((key) => {
      groups[key].sort((a, b) => a.name.localeCompare(b.name));
    });

    return groups;
  }, [filteredSeries]);

  // Get available letters (letters that have series)
  const availableLetters = useMemo(() => {
    return new Set(Object.keys(groupedSeries));
  }, [groupedSeries]);

  const handleSeriesClick = (seriesName: string) => {
    setSelectedSeries([seriesName]);
    setSelectedGenres([]);
    setView("library-books");
  };

  const scrollToLetter = (letter: string) => {
    const ref = sectionRefs.current[letter];
    if (ref) {
      ref.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  };

  if (series.length === 0) {
    return (
      <div className="rounded-lg border border-app-border bg-app-surface/70 p-4">
        <div className="text-[13px] font-semibold">{t("series.noneTitle")}</div>
        <div className="text-xs text-app-ink-muted">
          {t("series.emptyHint")}
        </div>
      </div>
    );
  }

  return (
    <div className="flex gap-4">
      {/* Main content */}
      <div className="flex-1 flex flex-col gap-4">
        {/* Search bar */}
        <div className="relative">
          <Search
            size={16}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-app-ink-muted"
          />
          <input
            type="text"
            placeholder={t("series.searchPlaceholder")}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full rounded-lg border border-app-border bg-app-surface/50 py-2 pl-10 pr-4 text-sm placeholder:text-app-ink-muted focus:border-app-accent/40 focus:outline-none transition-colors"
          />
          {searchQuery && (
            <button
              className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--app-ink-muted)] hover:text-[var(--app-ink)]"
              onClick={() => setSearchQuery("")}
            >
              ×
            </button>
          )}
        </div>

        {/* Stats */}
        <div className="text-sm text-[var(--app-ink-muted)]">
          {filteredSeries.length === series.length
            ? t("series.countAll", { count: series.length })
            : t("series.countFiltered", { filtered: filteredSeries.length, total: series.length })}
        </div>

        {/* Series list grouped by letter */}
        {filteredSeries.length === 0 ? (
          <div className="rounded-lg border border-app-border bg-app-surface/70 p-4">
            <div className="text-[13px] font-semibold">{t("series.noneTitle")}</div>
            <div className="text-xs text-app-ink-muted">
              {t("series.noneHint")}
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-6">
            {ALPHABET.filter((letter) => groupedSeries[letter]).map((letter) => (
              <div
                key={letter}
                ref={(el) => {
                  sectionRefs.current[letter] = el;
                }}
              >
                <div className="sticky top-0 z-10 mb-2 bg-[var(--app-bg)] py-1">
                  <span className="text-lg font-semibold text-[var(--app-accent-strong)]">
                    {letter}
                  </span>
                  <span className="ml-2 text-xs text-[var(--app-ink-muted)]">
                    {groupedSeries[letter].length}
                  </span>
                </div>
                <div className="flex flex-col gap-2">
                  {groupedSeries[letter].map((s) => {
                    const isExpanded = expandedSeries.has(s.name);
                    const seriesBooks = booksBySeries[normalizeSeriesKey(s.name)] ?? [];
                    const seriesAuthors = summarizeSeriesAuthors(seriesBooks);
                    return (
                      <div
                        key={s.name}
                        className="rounded-lg border border-transparent bg-app-surface/10 hover:bg-app-surface/20 transition overflow-hidden"
                      >
                        {/* Series header */}
                        <div className="flex items-center">
                          <button
                            className="flex flex-1 items-center gap-2 px-3 py-2.5 text-left text-sm transition hover:bg-app-accent/5 group"
                            onClick={() => toggleExpanded(s.name)}
                          >
                            {isExpanded ? (
                              <ChevronDown size={14} className="shrink-0 text-app-ink-muted group-hover:text-app-accent transition-colors" strokeWidth={2.5} />
                            ) : (
                              <ChevronRight size={14} className="shrink-0 text-app-ink-muted group-hover:text-app-accent transition-colors" strokeWidth={2.5} />
                            )}
                            <span className="min-w-0 flex-1">
                              <span className="block truncate font-semibold text-app-ink">{s.name}</span>
                              {seriesAuthors ? (
                                <span className="block truncate text-[11px] text-app-ink-muted/80">
                                  {seriesAuthors}
                                </span>
                              ) : null}
                            </span>
                            <span className="ml-auto shrink-0 text-[10px] font-medium text-app-ink-muted uppercase tracking-wider bg-app-bg-secondary px-1.5 py-0.5 rounded">
                              {t("series.booksCount", { count: s.bookCount })}
                            </span>
                          </button>
                          <button
                            className="px-3 py-2 text-xs text-[var(--app-accent-strong)] hover:underline"
                            onClick={() => handleSeriesClick(s.name)}
                          >
                            {t("series.showAll")}
                          </button>
                        </div>
                        {/* Expanded books list */}
                        {isExpanded && seriesBooks.length > 0 && (
                          <div className="border-t border-transparent bg-app-bg/5">
                            {seriesBooks.map((book) => (
                              <button
                                key={book.id}
                                className={`flex w-full items-center gap-3 px-3 py-2 text-left text-sm transition hover:bg-app-accent/10`}
                                onClick={() => onSelectBook(book.id)}
                              >
                                {/* Series index */}
                                <span className="w-8 shrink-0 text-center">
                                  {book.seriesIndex ? (
                                    <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-app-accent/20 text-[10px] font-bold text-app-accent-strong ring-1 ring-[var(--app-accent)] ring-opacity-20">
                                      {book.seriesIndex}
                                    </span>
                                  ) : (
                                    <span className="text-[10px] text-app-ink-muted">—</span>
                                  )}
                                </span>
                                {/* Cover thumbnail */}
                                <div className="h-10 w-7 shrink-0 overflow-hidden rounded border border-[var(--app-border-muted)] bg-app-bg/10">
                                  {book.cover ? (
                                    <img src={book.cover} alt="" className="h-full w-full object-cover" />
                                  ) : (
                                    <div className="flex h-full w-full items-center justify-center text-[6px] text-app-ink-muted/60">
                                      {book.format}
                                    </div>
                                  )}
                                </div>
                                {/* Book info */}
                                <div className="flex min-w-0 flex-1 flex-col">
                                  <span className="truncate font-medium">{book.title}</span>
                                  <span className="truncate text-xs text-[var(--app-ink-muted)]">{book.author}</span>
                                </div>
                                {/* Language flag */}
                                {book.language && (
                                  <span className="shrink-0 text-sm">{getLanguageFlag(book.language)}</span>
                                )}
                                {/* Format badge */}
                                <span className="shrink-0 rounded bg-app-bg/40 px-1.5 py-0.5 text-[10px] uppercase text-app-ink-muted">
                                  {book.format}
                                </span>
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Alphabet index */}
      <div className="sticky top-4 flex h-fit flex-col items-center gap-0.5 rounded-lg border border-[var(--app-border-soft)] bg-app-surface/60 backdrop-blur-sm px-1 py-2">
        {ALPHABET.map((letter) => {
          const isAvailable = availableLetters.has(letter);
          return (
            <button
              key={letter}
              className={`w-6 h-5 text-[11px] font-medium rounded transition ${isAvailable
                ? "text-app-ink hover:bg-app-accent/20 hover:text-[var(--app-accent-strong)]"
                : "text-app-ink-muted/30 cursor-default"
                }`}
              onClick={() => isAvailable && scrollToLetter(letter)}
              disabled={!isAvailable}
            >
              {letter}
            </button>
          );
        })}
      </div>
    </div>
  );
}
