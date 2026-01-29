import { useMemo, useState, useRef } from "react";
import type { Dispatch, SetStateAction } from "react";
import type { Author, View } from "../types/library";
import { Search } from "lucide-react";

type AuthorsViewProps = {
  authors: Author[];
  setSelectedAuthorNames: Dispatch<SetStateAction<string[]>>;
  setView: Dispatch<SetStateAction<View>>;
};

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ#".split("");

export function AuthorsView({
  authors,
  setSelectedAuthorNames,
  setView,
}: AuthorsViewProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const sectionRefs = useRef<Record<string, HTMLDivElement | null>>({});

  // Filter authors by search query
  const filteredAuthors = useMemo(() => {
    if (!searchQuery.trim()) return authors;
    const query = searchQuery.toLowerCase();
    return authors.filter((author) =>
      author.name.toLowerCase().includes(query)
    );
  }, [authors, searchQuery]);

  // Group authors by first letter
  const groupedAuthors = useMemo(() => {
    const groups: Record<string, Author[]> = {};

    filteredAuthors.forEach((author) => {
      const firstChar = author.name.charAt(0).toUpperCase();
      const key = /[A-Z]/.test(firstChar) ? firstChar : "#";
      if (!groups[key]) groups[key] = [];
      groups[key].push(author);
    });

    // Sort each group alphabetically
    Object.keys(groups).forEach((key) => {
      groups[key].sort((a, b) => a.name.localeCompare(b.name));
    });

    return groups;
  }, [filteredAuthors]);

  // Get available letters (letters that have authors)
  const availableLetters = useMemo(() => {
    return new Set(Object.keys(groupedAuthors));
  }, [groupedAuthors]);

  const handleAuthorClick = (authorName: string) => {
    setSelectedAuthorNames([authorName]);
    setView("library-books");
  };

  const scrollToLetter = (letter: string) => {
    const ref = sectionRefs.current[letter];
    if (ref) {
      ref.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  };

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
            placeholder="Zoek auteur..."
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
          {filteredAuthors.length === authors.length
            ? `${authors.length} auteurs`
            : `${filteredAuthors.length} van ${authors.length} auteurs`}
        </div>

        {/* Authors list grouped by letter */}
        {filteredAuthors.length === 0 ? (
          <div className="rounded-lg border border-[var(--app-border)] bg-white/70 p-4">
            <div className="text-[13px] font-semibold">Geen auteurs gevonden</div>
            <div className="text-xs text-[var(--app-ink-muted)]">
              Probeer een andere zoekterm.
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-6">
            {ALPHABET.filter((letter) => groupedAuthors[letter]).map((letter) => (
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
                    {groupedAuthors[letter].length}
                  </span>
                </div>
                <div className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-2">
                  {groupedAuthors[letter].map((author) => (
                    <button
                      key={author.name}
                      className="flex items-center justify-between rounded-lg border border-[var(--app-border)] bg-white/80 px-3 py-2 text-left text-sm transition hover:border-[rgba(208,138,70,0.4)] hover:bg-white"
                      onClick={() => handleAuthorClick(author.name)}
                    >
                      <span className="font-medium truncate">{author.name}</span>
                      <span className="ml-2 shrink-0 text-xs text-[var(--app-ink-muted)]">
                        {author.bookCount}
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
