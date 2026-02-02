import { useMemo, useState, useRef } from "react";
import type { Dispatch, SetStateAction } from "react";
import type { BookDisplay, View } from "../types/library";
import { Search, ChevronDown, ChevronRight } from "lucide-react";
import { getLanguageFlag } from "../lib/languageFlags";

type Series = {
  name: string;
  bookCount: number;
};

type SeriesViewProps = {
  series: Series[];
  books: BookDisplay[];
  setSelectedSeries: Dispatch<SetStateAction<string[]>>;
  setView: Dispatch<SetStateAction<View>>;
  onSelectBook: (bookId: string) => void;
};

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ#".split("");

export function SeriesView({
  series,
  books,
  setSelectedSeries,
  setView,
  onSelectBook,
}: SeriesViewProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const sectionRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const [expandedSeries, setExpandedSeries] = useState<Set<string>>(new Set());

  // Group books by series name
  const booksBySeries = useMemo(() => {
    const grouped: Record<string, BookDisplay[]> = {};
    books.forEach((book) => {
      if (book.series) {
        if (!grouped[book.series]) grouped[book.series] = [];
        grouped[book.series].push(book);
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
      <div className="rounded-lg border border-[var(--app-border)] bg-white/70 p-4">
        <div className="text-[13px] font-semibold">Geen series gevonden</div>
        <div className="text-xs text-[var(--app-ink-muted)]">
          Serie-informatie wordt uit boek-metadata gehaald.
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
            className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--app-ink-muted)]"
          />
          <input
            type="text"
            placeholder="Zoek serie..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full rounded-lg border border-[var(--app-border)] bg-white/80 py-2 pl-10 pr-4 text-sm placeholder:text-[var(--app-ink-muted)] focus:border-[rgba(208,138,70,0.6)] focus:outline-none"
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
            ? `${series.length} series`
            : `${filteredSeries.length} van ${series.length} series`}
        </div>

        {/* Series list grouped by letter */}
        {filteredSeries.length === 0 ? (
          <div className="rounded-lg border border-[var(--app-border)] bg-white/70 p-4">
            <div className="text-[13px] font-semibold">Geen series gevonden</div>
            <div className="text-xs text-[var(--app-ink-muted)]">
              Probeer een andere zoekterm.
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
                    const seriesBooks = booksBySeries[s.name] ?? [];
                    return (
                      <div
                        key={s.name}
                        className="rounded-lg border border-[var(--app-border)] bg-white/80 transition"
                      >
                        {/* Series header */}
                        <div className="flex items-center">
                          <button
                            className="flex flex-1 items-center gap-2 px-3 py-2 text-left text-sm transition hover:bg-[rgba(208,138,70,0.04)]"
                            onClick={() => toggleExpanded(s.name)}
                          >
                            {isExpanded ? (
                              <ChevronDown size={16} className="shrink-0 text-[var(--app-ink-muted)]" />
                            ) : (
                              <ChevronRight size={16} className="shrink-0 text-[var(--app-ink-muted)]" />
                            )}
                            <span className="font-medium truncate">{s.name}</span>
                            <span className="ml-auto shrink-0 text-xs text-[var(--app-ink-muted)]">
                              {s.bookCount} {s.bookCount === 1 ? "boek" : "boeken"}
                            </span>
                          </button>
                          <button
                            className="px-3 py-2 text-xs text-[var(--app-accent-strong)] hover:underline"
                            onClick={() => handleSeriesClick(s.name)}
                          >
                            Toon alle
                          </button>
                        </div>
                        {/* Expanded books list */}
                        {isExpanded && seriesBooks.length > 0 && (
                          <div className="border-t border-[var(--app-border)] bg-[rgba(255,253,249,0.6)]">
                            {seriesBooks.map((book, i) => (
                              <button
                                key={book.id}
                                className={`flex w-full items-center gap-3 px-3 py-2 text-left text-sm transition hover:bg-[rgba(208,138,70,0.06)] ${
                                  i < seriesBooks.length - 1 ? "border-b border-[var(--app-border)]/50" : ""
                                }`}
                                onClick={() => onSelectBook(book.id)}
                              >
                                {/* Series index */}
                                <span className="w-8 shrink-0 text-center">
                                  {book.seriesIndex ? (
                                    <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-[rgba(208,138,70,0.15)] text-xs font-semibold text-[var(--app-accent-strong)]">
                                      {book.seriesIndex}
                                    </span>
                                  ) : (
                                    <span className="text-xs text-[var(--app-ink-muted)]">—</span>
                                  )}
                                </span>
                                {/* Cover thumbnail */}
                                <div className="h-10 w-7 shrink-0 overflow-hidden rounded border border-[var(--app-border)] bg-[#fffaf4]">
                                  {book.cover ? (
                                    <img src={book.cover} alt="" className="h-full w-full object-cover" />
                                  ) : (
                                    <div className="flex h-full w-full items-center justify-center text-[6px] text-[var(--app-ink-muted)]">
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
                                <span className="shrink-0 rounded bg-[var(--app-bg)] px-1.5 py-0.5 text-[10px] uppercase text-[var(--app-ink-muted)]">
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
      <div className="sticky top-4 flex h-fit flex-col items-center gap-0.5 rounded-lg border border-[var(--app-border)] bg-white/80 px-1 py-2">
        {ALPHABET.map((letter) => {
          const isAvailable = availableLetters.has(letter);
          return (
            <button
              key={letter}
              className={`w-6 h-5 text-[11px] font-medium rounded transition ${
                isAvailable
                  ? "text-[var(--app-ink)] hover:bg-[rgba(208,138,70,0.15)] hover:text-[var(--app-accent-strong)]"
                  : "text-[var(--app-ink-muted)]/40 cursor-default"
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
