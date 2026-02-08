import { useMemo } from "react";
import { cleanupMetadataTitle, normalizeTitleSnapshot } from "../lib/metadataCleanup";
import type {
  Author,
  Category,
  InboxItem,
  ItemMetadata,
  LibraryFilter,
  LibraryItem,
  LibrarySort,
  ScanProgress,
  Tag,
} from "../types/library";

export type FilteredBook = {
  id: string;
  title: string;
  author: string;
  authors: string[];
  format: string;
  year: number | string;
  status: string;
  cover: string | null;
  tags: Tag[];
  language: string | null;
  series: string | null;
  seriesIndex: number | null;
  genres: string[];
  createdAt: number;
};

type UseLibrarySelectorsArgs = {
  libraryItems: LibraryItem[];
  coverOverrides: Record<string, string | null>;
  fixFilter: {
    missingAuthor: boolean;
    missingTitle: boolean;
    missingCover: boolean;
    missingIsbn: boolean;
    missingYear: boolean;
    missingLanguage: boolean;
    missingSeries: boolean;
    missingDescription: boolean;
    includeIssues: boolean;
  };
  inbox: InboxItem[];
  titleCleanupIgnoreMap: Record<string, string>;
  libraryFilter: LibraryFilter;
  selectedTagIds: string[];
  selectedAuthorNames: string[];
  selectedSeries: string[];
  selectedGenres: string[];
  query: string;
  isDesktop: boolean;
  sampleBooks: Array<{
    id: string;
    title: string;
    author: string;
    format: string;
    year: number;
    status: string;
    cover: string | null;
    tags: Tag[];
  }>;
  librarySort: LibrarySort;
  tags: Tag[];
  selectedItemId: string | null;
  scanProgress: ScanProgress | null;
  scanStartedAt: number | null;
  currentTimeMs: number;
};

function formatEta(totalSeconds: number) {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes > 0) {
    return `${minutes}m ${seconds}s`;
  }
  return `${seconds}s`;
}

function normalizeSeriesKey(value: string) {
  return value.trim().toLocaleLowerCase();
}

export function useLibrarySelectors({
  libraryItems,
  coverOverrides,
  fixFilter,
  inbox,
  titleCleanupIgnoreMap,
  libraryFilter,
  selectedTagIds,
  selectedAuthorNames,
  selectedSeries,
  selectedGenres,
  query,
  isDesktop,
  sampleBooks,
  librarySort,
  tags,
  selectedItemId,
  scanProgress,
  scanStartedAt,
  currentTimeMs,
}: UseLibrarySelectorsArgs) {
  const uniqueAuthors = useMemo((): Author[] => {
    const counts = new Map<string, number>();
    libraryItems.forEach((item) => {
      item.authors.forEach((author) => {
        counts.set(author, (counts.get(author) || 0) + 1);
      });
    });
    return Array.from(counts.entries())
      .map(([name, bookCount]) => ({ name, bookCount }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [libraryItems]);

  const uniqueSeries = useMemo((): Array<{ name: string; bookCount: number }> => {
    const series = new Map<string, { bookCount: number; variants: Map<string, number> }>();
    libraryItems.forEach((item) => {
      if (item.series) {
        const normalized = normalizeSeriesKey(item.series);
        if (!normalized) return;
        const existing = series.get(normalized);
        if (!existing) {
          series.set(normalized, {
            bookCount: 1,
            variants: new Map([[item.series, 1]]),
          });
          return;
        }
        existing.bookCount += 1;
        existing.variants.set(item.series, (existing.variants.get(item.series) ?? 0) + 1);
      }
    });
    return Array.from(series.values())
      .map(({ bookCount, variants }) => {
        const displayName = Array.from(variants.entries()).sort((a, b) => {
          if (b[1] !== a[1]) return b[1] - a[1];
          return a[0].localeCompare(b[0], undefined, { sensitivity: "base" });
        })[0]?.[0] ?? "";
        return { name: displayName, bookCount };
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [libraryItems]);

  const uniqueCategories = useMemo((): Category[] => {
    const counts = new Map<string, number>();
    libraryItems.forEach((item) => {
      (item.genres ?? []).forEach((genre) => {
        const normalized = genre.trim();
        if (!normalized) return;
        counts.set(normalized, (counts.get(normalized) ?? 0) + 1);
      });
    });
    return Array.from(counts.entries())
      .map(([name, bookCount]) => ({ name, bookCount }))
      .sort((a, b) => {
        if (b.bookCount !== a.bookCount) return b.bookCount - a.bookCount;
        return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
      });
  }, [libraryItems]);

  const booksNeedingFix = useMemo(() => {
    return libraryItems.filter((item) => {
      const hasCover = Boolean(item.cover_path) || typeof coverOverrides[item.id] === "string";
      const hasIsbn = Boolean(item.isbn && item.isbn.trim().length > 0);
      if (fixFilter.missingAuthor && item.authors.length === 0) return true;
      if (fixFilter.missingTitle && !item.title) return true;
      if (fixFilter.missingCover && !hasCover) return true;
      if (fixFilter.missingIsbn && !hasIsbn) return true;
      if (fixFilter.missingYear && !item.published_year) return true;
      if (fixFilter.missingLanguage && !item.language) return true;
      if (fixFilter.missingSeries && !item.series) return true;
      return false;
    });
  }, [libraryItems, fixFilter, coverOverrides]);

  const enrichableCount = useMemo(() => {
    return libraryItems.reduce((count, item) => {
      if (!item.cover_path || item.authors.length === 0 || item.published_year === null) {
        return count + 1;
      }
      return count;
    }, 0);
  }, [libraryItems]);

  const titleIssueItems = useMemo<InboxItem[]>(() => {
    return libraryItems
      .map((item) => {
        const metadata: ItemMetadata = {
          title: item.title,
          authors: item.authors,
          publishedYear: item.published_year,
          language: item.language ?? null,
          isbn: item.isbn ?? null,
          series: item.series ?? null,
          seriesIndex: item.series_index ?? null,
          description: null,
          genres: item.genres ?? [],
        };
        const cleaned = cleanupMetadataTitle(metadata);
        if (!cleaned.changed || !item.title) return null;
        const ignoredSnapshot = titleCleanupIgnoreMap[item.id];
        if (ignoredSnapshot && ignoredSnapshot === normalizeTitleSnapshot(item.title)) {
          return null;
        }
        return {
          id: item.id,
          title: item.title,
          reason: "Possible incorrect title",
        } satisfies InboxItem;
      })
      .filter((item): item is InboxItem => Boolean(item));
  }, [libraryItems, titleCleanupIgnoreMap]);

  const fixIssues = useMemo<InboxItem[]>(() => {
    const byId = new Map<string, InboxItem>();
    for (const issue of inbox) {
      byId.set(issue.id, issue);
    }
    for (const titleIssue of titleIssueItems) {
      const existing = byId.get(titleIssue.id);
      if (!existing) {
        byId.set(titleIssue.id, titleIssue);
        continue;
      }
      if (!existing.reason.toLowerCase().includes("possible incorrect title")) {
        byId.set(titleIssue.id, {
          ...existing,
          reason: `${existing.reason} · Possible incorrect title`,
        });
      }
    }
    return Array.from(byId.values());
  }, [inbox, titleIssueItems]);

  const allFixItems = useMemo(() => {
    const fixItemIds = new Set(booksNeedingFix.map((item) => item.id));

    const result = [...booksNeedingFix];
    if (fixFilter.includeIssues) {
      fixIssues.forEach((issue) => {
        if (!fixItemIds.has(issue.id)) {
          const libraryItem = libraryItems.find((li) => li.id === issue.id);
          if (libraryItem) {
            result.push(libraryItem);
          }
        }
      });
    }
    return result;
  }, [booksNeedingFix, fixIssues, fixFilter.includeIssues, libraryItems]);

  const allBooks = useMemo<FilteredBook[]>(() => {
    const base = isDesktop
      ? libraryItems.map((item) => ({
          id: item.id,
          title: item.title ?? "Untitled",
          author: item.authors.length ? item.authors.join(", ") : "Unknown",
          authors: item.authors,
          format: item.formats[0] ?? "FILE",
          year: item.published_year ?? "—",
          status: item.title && item.authors.length ? "Complete" : "Needs Metadata",
          cover: typeof coverOverrides[item.id] === "string" ? coverOverrides[item.id] : null,
          tags: item.tags ?? [],
          language: item.language ?? null,
          series: item.series ?? null,
          seriesIndex: item.series_index ?? null,
          genres: item.genres ?? [],
          createdAt: item.created_at,
        }))
      : sampleBooks.map((book, index) => ({
          ...book,
          authors: [book.author],
          language: null as string | null,
          series: null as string | null,
          seriesIndex: null as number | null,
          genres: [] as string[],
          createdAt: 1_000_000 - index * 1000,
        }));
    return base;
  }, [libraryItems, isDesktop, coverOverrides, sampleBooks]);

  const filteredBooks = useMemo<FilteredBook[]>(() => {
    const base = allBooks;

    const filteredByFormat = base.filter((book) => {
      const normalizedFormat = String(book.format)
        .replace(".", "")
        .toLowerCase();
      switch (libraryFilter) {
        case "epub":
          return normalizedFormat.includes("epub");
        case "pdf":
          return normalizedFormat.includes("pdf");
        case "mobi":
          return normalizedFormat.includes("mobi");
        case "needs-metadata":
          return book.status !== "Complete";
        case "tagged":
          return (book.tags ?? []).length > 0;
        case "categorized":
          return (book.genres ?? []).length > 0;
        default:
          return true;
      }
    });

    const filteredByTags = selectedTagIds.length
      ? filteredByFormat.filter((book) =>
          selectedTagIds.every((tagId) =>
            (book.tags ?? []).some((tag) => tag.id === tagId)
          )
        )
      : filteredByFormat;

    const filteredByAuthors = selectedAuthorNames.length
      ? filteredByTags.filter((book) =>
          selectedAuthorNames.some((name) => book.authors.includes(name))
        )
      : filteredByTags;

    const filteredBySeries = selectedSeries.length
      ? (() => {
          const selectedSeriesNormalized = new Set(
            selectedSeries.map(normalizeSeriesKey).filter(Boolean),
          );
          return filteredByAuthors.filter((book) =>
            book.series ? selectedSeriesNormalized.has(normalizeSeriesKey(book.series)) : false,
          );
        })()
      : filteredByAuthors;

    const filteredByGenres = selectedGenres.length
      ? filteredBySeries.filter((book) =>
          selectedGenres.some((genre) =>
            (book.genres ?? []).some(
              (bookGenre) =>
                bookGenre.localeCompare(genre, undefined, { sensitivity: "base" }) === 0,
            ),
          ),
        )
      : filteredBySeries;

    if (!query) return filteredByGenres;
    const lowered = query.toLowerCase();
    return filteredByGenres.filter(
      (book) =>
        book.title.toLowerCase().includes(lowered) ||
        book.author.toLowerCase().includes(lowered) ||
        (book.genres ?? []).some((genre) => genre.toLowerCase().includes(lowered))
    );
  }, [
    query,
    allBooks,
    libraryFilter,
    selectedTagIds,
    selectedAuthorNames,
    selectedSeries,
    selectedGenres,
  ]);

  const sortedBooks = useMemo(() => {
    if (librarySort === "default") return filteredBooks;

    const toLower = (value: string) => value.toLowerCase();
    const compareText = (a: string, b: string) =>
      a.localeCompare(b, undefined, { sensitivity: "base" });
    const getYearValue = (value: number | string) => {
      if (typeof value === "number") return value;
      const parsed = Number.parseInt(String(value), 10);
      return Number.isFinite(parsed) ? parsed : null;
    };

    const withIndex = filteredBooks.map((book, index) => ({ book, index }));

    withIndex.sort((a, b) => {
      const left = a.book;
      const right = b.book;
      let result = 0;

      switch (librarySort) {
        case "title-asc":
          result = compareText(toLower(left.title), toLower(right.title));
          break;
        case "title-desc":
          result = compareText(toLower(right.title), toLower(left.title));
          break;
        case "author-asc":
          result = compareText(toLower(left.author), toLower(right.author));
          break;
        case "year-desc": {
          const leftYear = getYearValue(left.year);
          const rightYear = getYearValue(right.year);
          if (leftYear === null && rightYear === null) result = 0;
          else if (leftYear === null) result = 1;
          else if (rightYear === null) result = -1;
          else result = rightYear - leftYear;
          break;
        }
        case "year-asc": {
          const leftYear = getYearValue(left.year);
          const rightYear = getYearValue(right.year);
          if (leftYear === null && rightYear === null) result = 0;
          else if (leftYear === null) result = 1;
          else if (rightYear === null) result = -1;
          else result = leftYear - rightYear;
          break;
        }
        case "recent":
          result = right.createdAt - left.createdAt;
          break;
        default:
          result = 0;
      }

      if (result !== 0) return result;
      return a.index - b.index;
    });

    return withIndex.map(({ book }) => book);
  }, [filteredBooks, librarySort]);

  const selectedItem = useMemo(() => {
    if (!selectedItemId) return null;
    return filteredBooks.find((book) => book.id === selectedItemId) ?? null;
  }, [filteredBooks, selectedItemId]);

  const selectedTags = useMemo(() => selectedItem?.tags ?? [], [selectedItem]);
  const availableTags = useMemo(
    () => tags.filter((tag) => !selectedTags.some((selected) => selected.id === tag.id)),
    [tags, selectedTags]
  );

  const availableLanguages = useMemo(() => {
    if (!selectedItem) return [];
    const normalizeTitle = (t: string) => t.toLowerCase().replace(/[^\w\s]/g, "").trim();
    const selectedTitle = normalizeTitle(selectedItem.title);
    const selectedAuthor = selectedItem.author.toLowerCase();

    const languages = new Set<string>();
    libraryItems.forEach((item) => {
      if (!item.language) return;
      const itemTitle = normalizeTitle(item.title ?? "");
      const itemAuthors = item.authors.map((a) => a.toLowerCase());
      if (itemTitle === selectedTitle && itemAuthors.some((a) => selectedAuthor.includes(a) || a.includes(selectedAuthor))) {
        languages.add(item.language);
      }
    });
    return Array.from(languages).sort();
  }, [selectedItem, libraryItems]);

  const scanEtaSeconds = useMemo(() => {
    if (!scanProgress || !scanStartedAt || scanProgress.total === 0) return null;
    const elapsedSeconds = (currentTimeMs - scanStartedAt) / 1000;
    if (elapsedSeconds < 1 || scanProgress.processed === 0) return null;
    const rate = scanProgress.processed / elapsedSeconds;
    if (!Number.isFinite(rate) || rate <= 0) return null;
    const remaining = (scanProgress.total - scanProgress.processed) / rate;
    if (!Number.isFinite(remaining) || remaining < 0) return null;
    return Math.round(remaining);
  }, [scanProgress, scanStartedAt, currentTimeMs]);
  const scanEtaLabel = scanEtaSeconds !== null ? formatEta(scanEtaSeconds) : null;

  return {
    uniqueAuthors,
    uniqueSeries,
    uniqueCategories,
    booksNeedingFix,
    enrichableCount,
    titleIssueItems,
    fixIssues,
    allFixItems,
    allBooks,
    filteredBooks,
    sortedBooks,
    selectedItem,
    selectedTags,
    availableTags,
    availableLanguages,
    scanEtaLabel,
  };
}
