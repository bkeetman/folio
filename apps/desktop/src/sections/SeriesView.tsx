import { useMemo, useState, useRef } from "react";
import type { Dispatch, SetStateAction } from "react";
import type { View } from "../types/library";
import { Search } from "lucide-react";

type Series = {
  name: string;
  bookCount: number;
};

type SeriesViewProps = {
  series: Series[];
  setSelectedSeries: Dispatch<SetStateAction<string[]>>;
  setView: Dispatch<SetStateAction<View>>;
};

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ#".split("");

export function SeriesView({
  series,
  setSelectedSeries,
  setView,
}: SeriesViewProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const sectionRefs = useRef<Record<string, HTMLDivElement | null>>({});

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
                <div className="grid grid-cols-[repeat(auto-fill,minmax(250px,1fr))] gap-2">
                  {groupedSeries[letter].map((s) => (
                    <button
                      key={s.name}
                      className="flex items-center justify-between rounded-lg border border-[var(--app-border)] bg-white/80 px-3 py-2 text-left text-sm transition hover:border-[rgba(208,138,70,0.4)] hover:bg-white"
                      onClick={() => handleSeriesClick(s.name)}
                    >
                      <span className="font-medium truncate">{s.name}</span>
                      <span className="ml-2 shrink-0 text-xs text-[var(--app-ink-muted)]">
                        {s.bookCount} {s.bookCount === 1 ? "boek" : "boeken"}
                      </span>
                    </button>
                  ))}
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
