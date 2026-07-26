import { BookOpen, FileText, FolderOpen, Globe, HardDrive, Loader2, PencilLine, RefreshCcw, UserRound } from "lucide-react";
import type { Dispatch, SetStateAction } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { invokeCapability, type CapabilityState } from "../platform/native";
import { AuthorPhotoImage } from "../components/AuthorPhotoImage";
import { Badge, Button, Separator } from "../components/ui";
import { emitAuthorProfileUpdated } from "../lib/authorProfileEvents";
import { getLanguageFlag, getLanguageName, isKnownLanguageCode } from "../lib/languageFlags";
import { getTagColorClass } from "../lib/tagColors";
import type { AuthorProfile, FileItem, Tag, View } from "../types/library";

type EReaderSyncStatus = {
  isOnDevice: boolean;
  isInQueue: boolean;
  matchConfidence: "exact" | "isbn" | "title" | "fuzzy" | null;
};

const AUTHOR_BOOKS_PAGE_SIZE = 8;
const EMPTY_AUTHOR_BOOK_COVER_URLS: Record<string, string> = {};
const EMPTY_AUTHOR_BOOK_COVER_LOADING_IDS: Record<string, boolean> = {};

type AuthorBooksPaginationState = {
  authorName: string | null;
  visibleCount: number;
};

type AuthorBookCoverState = {
  authorName: string | null;
  urls: Record<string, string>;
  loadingIds: Record<string, boolean>;
  errors: Record<string, string>;
};

type ItemFileState = {
  itemId: string | null;
  capability: CapabilityState<FileItem[]>;
};

type RevealFileState = {
  itemId: string | null;
  path: string;
  capability: CapabilityState<void>;
};

type AuthorBookCoverLoadResult =
  | { bookId: string; status: "success"; url: string | null }
  | { bookId: string; status: "unsupported" }
  | { bookId: string; status: "error"; message: string };

function formatMetadataDate(timestampMs: number | null): string | null {
  if (!timestampMs) return null;
  const parsed = new Date(timestampMs);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toLocaleDateString();
}

function hasAuthorMetadata(profile: AuthorProfile | null): boolean {
  if (!profile) return false;
  const hasBio = Boolean(profile.bio && profile.bio.trim().length > 0);
  const hasPhoto = Boolean(profile.photoUrl && profile.photoUrl.trim().length > 0);
  return hasBio || hasPhoto;
}

function hasFetchedAuthorMetadata(profile: AuthorProfile | null): boolean {
  if (!profile) return false;
  return Boolean(profile.metadataUpdatedAt || (profile.metadataSource && profile.metadataSource.trim().length > 0));
}

function authorProfileKey(name: string): string {
  return name.trim().toLowerCase();
}

function formatAuthorMetadataSource(source: string | null | undefined): string | null {
  const value = source?.trim();
  if (!value) return null;
  const normalized = value.toLowerCase();
  if (normalized === "openlibrary") return "Open Library";
  if (normalized === "wikipedia") return "Wikipedia";
  if (normalized === "wikidata") return "Wikidata";
  if (normalized === "merged") return "Merged sources";
  return value;
}

type InspectorProps = {
  allBooks: Array<{
    id: string;
    title: string;
    authors: string[];
    year: number | string;
    format: string;
    cover: string | null;
  }>;
  selectedItem: {
    id: string;
    title: string;
    author: string;
    authors?: string[];
    year: number | string;
    format: string;
    status: string;
    cover: string | null;
    series?: string | null;
    seriesIndex?: number | null;
    language?: string | null;
    genres?: string[];
  } | null;
  // Available languages for this book (other editions in different languages)
  availableLanguages?: string[];
  selectedTags: Tag[];
  availableTags: Tag[];
  handleAddTag: (tagId: string) => void;
  handleRemoveTag: (tagId: string) => void;
  clearCoverOverride: (itemId: string) => void;
  fetchCoverOverride: (itemId: string) => void;
  // Navigation
  setView: Dispatch<SetStateAction<View>>;
  selectedAuthorNames: string[];
  setSelectedAuthorNames: Dispatch<SetStateAction<string[]>>;
  setSelectedSeries: Dispatch<SetStateAction<string[]>>;
  setSelectedGenres: Dispatch<SetStateAction<string[]>>;
  onNavigateToEdit: () => void;
  // eReader sync
  ereaderConnected: boolean;
  ereaderSyncStatus: EReaderSyncStatus | null;
  onQueueEreaderAdd: (itemId: string) => void;
  width: number;
};

export function Inspector({
  allBooks,
  selectedItem,
  availableLanguages = [],
  selectedTags,
  availableTags,
  handleAddTag,
  handleRemoveTag,
  clearCoverOverride,
  fetchCoverOverride,
  setView,
  selectedAuthorNames,
  setSelectedAuthorNames,
  setSelectedSeries,
  setSelectedGenres,
  ereaderConnected,
  ereaderSyncStatus,
  onQueueEreaderAdd,
  onNavigateToEdit,
  width,
}: InspectorProps) {
  const { t } = useTranslation();
  const compactLayout = width < 320;
  const hasKnownItemLanguage = isKnownLanguageCode(selectedItem?.language);
  const [fileState, setFileState] = useState<ItemFileState>({
    itemId: null,
    capability: { status: "unsupported", capability: "get_item_files" },
  });
  const [revealFileState, setRevealFileState] = useState<RevealFileState | null>(null);
  const [authorProfile, setAuthorProfile] = useState<AuthorProfile | null>(null);
  const [authorProfileLoading, setAuthorProfileLoading] = useState(false);
  const [authorProfileRefreshing, setAuthorProfileRefreshing] = useState(false);
  const [authorProfileError, setAuthorProfileError] = useState<string | null>(null);
  const [bookAuthorProfiles, setBookAuthorProfiles] = useState<Record<string, AuthorProfile | null>>({});
  const [bookAuthorProfilesLoading, setBookAuthorProfilesLoading] = useState(false);
  const [authorBooksPagination, setAuthorBooksPagination] = useState<AuthorBooksPaginationState>({
    authorName: null,
    visibleCount: AUTHOR_BOOKS_PAGE_SIZE,
  });
  const [authorBookCoverState, setAuthorBookCoverState] = useState<AuthorBookCoverState>({
    authorName: null,
    urls: {},
    loadingIds: {},
    errors: {},
  });
  const [authorBookCoverRetryVersion, setAuthorBookCoverRetryVersion] = useState(0);
  const authorBookCoverCacheRef = useRef<Map<string, string | null>>(new Map());
  const bookAuthorProfileCacheRef = useRef<Map<string, AuthorProfile | null>>(new Map());
  const autoFetchAttemptedRef = useRef<Set<string>>(new Set());
  const authorProfileLoadInFlightRef = useRef(false);
  const selectedItemId = selectedItem?.id ?? null;
  const selectedAuthorName = selectedAuthorNames[0] ?? null;
  const authorBooksVisibleCount =
    authorBooksPagination.authorName === selectedAuthorName
      ? authorBooksPagination.visibleCount
      : AUTHOR_BOOKS_PAGE_SIZE;
  const authorBookCoverUrls =
    authorBookCoverState.authorName === selectedAuthorName
      ? authorBookCoverState.urls
      : EMPTY_AUTHOR_BOOK_COVER_URLS;
  const authorBookCoverLoadingIds =
    authorBookCoverState.authorName === selectedAuthorName
      ? authorBookCoverState.loadingIds
      : EMPTY_AUTHOR_BOOK_COVER_LOADING_IDS;
  const authorBookCoverErrors =
    authorBookCoverState.authorName === selectedAuthorName
      ? authorBookCoverState.errors
      : EMPTY_AUTHOR_BOOK_COVER_URLS;
  const authorBookCoverErrorCount = Object.keys(authorBookCoverErrors).length;
  const authorMetadataLoading = authorProfileLoading || authorProfileRefreshing;
  const authorHasBio = Boolean(authorProfile?.bio && authorProfile.bio.trim().length > 0);
  const authorHasPhoto = Boolean(authorProfile?.photoUrl && authorProfile.photoUrl.trim().length > 0);
  const authorMetadataWasFetched = Boolean(authorProfile?.metadataSource || authorProfile?.metadataUpdatedAt);
  const bookAuthorNames = useMemo(() => {
    if (!selectedItem) return [] as string[];
    const fromList = (selectedItem.authors ?? [])
      .map((value) => value.trim())
      .filter((value) => value.length > 0);
    if (fromList.length > 0) return fromList;
    const fallback = selectedItem.author?.trim() ?? "";
    return fallback ? [fallback] : [];
  }, [selectedItem]);
  const selectedAuthorBooks = useMemo(() => {
    const normalizedAuthor = selectedAuthorName?.trim().toLocaleLowerCase() ?? "";
    if (!normalizedAuthor) return [] as typeof allBooks;
    const parseYear = (value: number | string) => {
      if (typeof value === "number") return value;
      const parsed = Number.parseInt(String(value), 10);
      return Number.isFinite(parsed) ? parsed : null;
    };
    return allBooks
      .filter((book) =>
        book.authors.some((author) => author.trim().toLocaleLowerCase() === normalizedAuthor)
      )
      .slice()
      .sort((a, b) => {
        const yearA = parseYear(a.year);
        const yearB = parseYear(b.year);
        if (yearA !== null && yearB !== null && yearA !== yearB) {
          return yearB - yearA;
        }
        if (yearA === null && yearB !== null) return 1;
        if (yearA !== null && yearB === null) return -1;
        return a.title.localeCompare(b.title, undefined, { sensitivity: "base" });
      });
  }, [allBooks, selectedAuthorName]);
  const visibleAuthorBooks = useMemo(
    () => selectedAuthorBooks.slice(0, authorBooksVisibleCount),
    [authorBooksVisibleCount, selectedAuthorBooks]
  );
  const remainingAuthorBookCount = Math.max(0, selectedAuthorBooks.length - visibleAuthorBooks.length);

  useEffect(() => {
    if (!selectedItemId) return;
    let cancelled = false;
    void invokeCapability<FileItem[]>(
      "get_item_files",
      { itemId: selectedItemId },
      (capability) => {
        if (cancelled) return;
        setFileState({ itemId: selectedItemId, capability });
        if (capability.status === "loading") {
          setRevealFileState(null);
        } else if (capability.status === "error") {
          console.error("Failed to load item files", capability.error.message);
        }
      },
    );
    return () => {
      cancelled = true;
    };
  }, [selectedItemId]);

  useEffect(() => {
    if (selectedItem || !selectedAuthorName) {
      authorProfileLoadInFlightRef.current = false;
      return;
    }
    let cancelled = false;
    authorProfileLoadInFlightRef.current = true;
    void invokeCapability<AuthorProfile | null>(
      "get_author_profile",
      { authorName: selectedAuthorName },
      (state) => {
        if (cancelled || state.status !== "loading") return;
        setAuthorProfile(null);
        setAuthorProfileLoading(true);
        setAuthorProfileRefreshing(false);
        setAuthorProfileError(null);
      },
    )
      .then((result) => {
        if (cancelled) return;
        if (result.status === "success") {
          setAuthorProfile(result.value);
          if (result.value) {
            emitAuthorProfileUpdated(result.value);
          }
          return;
        }
        setAuthorProfile(null);
        if (result.status === "error") {
          console.error("Failed to fetch author profile", result.error.message);
          setAuthorProfileError(
            t("inspector.authorProfileLoadFailed", {
              defaultValue: "Failed to load author details.",
            })
          );
        }
      })
      .finally(() => {
        if (!cancelled) {
          setAuthorProfileLoading(false);
        }
        authorProfileLoadInFlightRef.current = false;
      });
    return () => {
      cancelled = true;
      authorProfileLoadInFlightRef.current = false;
    };
  }, [selectedItem, selectedAuthorName, t]);

  useEffect(() => {
    if (!selectedItem || bookAuthorNames.length === 0) return;
    const cached: Record<string, AuthorProfile | null> = {};
    const missingAuthors: string[] = [];
    for (const authorName of bookAuthorNames) {
      const key = authorProfileKey(authorName);
      if (bookAuthorProfileCacheRef.current.has(key)) {
        cached[key] = bookAuthorProfileCacheRef.current.get(key) ?? null;
      } else {
        missingAuthors.push(authorName);
      }
    }
    let cancelled = false;
    void Promise.resolve().then(async () => {
      if (cancelled) return;
      setBookAuthorProfiles(cached);
      if (missingAuthors.length === 0) {
        setBookAuthorProfilesLoading(false);
        return;
      }

      setBookAuthorProfilesLoading(true);
      const results = await Promise.all(
        missingAuthors.map(async (authorName) => {
          const result = await invokeCapability<AuthorProfile | null>("get_author_profile", {
            authorName,
          });
          if (result.status === "success") {
            return [authorName, result.value] as const;
          }
          if (result.status === "error") {
            console.error(`Failed to load profile for author "${authorName}"`, result.error.message);
          }
          return [authorName, null] as const;
        }),
      );
      if (cancelled) return;

      const next: Record<string, AuthorProfile | null> = { ...cached };
      for (const [authorName, profile] of results) {
        const key = authorProfileKey(authorName);
        bookAuthorProfileCacheRef.current.set(key, profile);
        next[key] = profile;
      }
      setBookAuthorProfiles(next);
      setBookAuthorProfilesLoading(false);
    }).catch((error: unknown) => {
      if (!cancelled) {
        console.error("Failed to load book author profiles", error);
        setBookAuthorProfilesLoading(false);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [bookAuthorNames, selectedItem]);

  const selectedFileCapability =
    selectedItemId && fileState.itemId === selectedItemId
      ? fileState.capability
      : selectedItemId
        ? ({ status: "loading" } as const)
        : ({ status: "unsupported", capability: "get_item_files" } as const);
  const files =
    selectedFileCapability.status === "success" ? selectedFileCapability.value : [];
  const filesLoading = selectedFileCapability.status === "loading";
  const filesError =
    selectedFileCapability.status === "error" ? selectedFileCapability.error.message : null;
  const revealCapability =
    revealFileState?.itemId === selectedItemId ? revealFileState.capability : null;
  const revealLoading = revealCapability?.status === "loading";
  const revealError =
    revealCapability?.status === "error" ? revealCapability.error.message : null;

  const handleReveal = (path: string) => {
    void invokeCapability<void>("reveal_file", { path }, (capability) => {
      setRevealFileState({ itemId: selectedItemId, path, capability });
      if (capability.status === "error") {
        console.error("Failed to reveal file", capability.error.message);
      }
    });
  };

  const handleAuthorClick = (authorName: string) => {
    setSelectedAuthorNames([authorName]);
    setSelectedSeries([]);
    setSelectedGenres([]);
    setView("library-books");
  };

  const handleSeriesClick = (seriesName: string) => {
    setSelectedSeries([seriesName]);
    setSelectedAuthorNames([]);
    setSelectedGenres([]);
    setView("library-books");
  };

  const handleGenreClick = (genre: string) => {
    setSelectedGenres([genre]);
    setSelectedAuthorNames([]);
    setSelectedSeries([]);
    setView("library-books");
  };

  const handleOpenAuthorBooks = () => {
    if (!selectedAuthorName) return;
    setSelectedAuthorNames([selectedAuthorName]);
    setSelectedSeries([]);
    setSelectedGenres([]);
    setView("library-books");
  };

  const handleRefreshAuthorProfile = useCallback(
    async (options?: { silent?: boolean }) => {
      if (!selectedAuthorName || selectedItem) return;
      setAuthorProfileRefreshing(true);
      setAuthorProfileError(null);
      const result = await invokeCapability<AuthorProfile | null>("enrich_author_metadata", {
        authorName: selectedAuthorName,
      });
      if (result.status === "success") {
        setAuthorProfile(result.value);
        if (result.value) {
          emitAuthorProfileUpdated(result.value);
        }
      } else if (result.status === "error") {
        console.error("Failed to refresh author profile", result.error.message);
        if (!options?.silent) {
          setAuthorProfileError(
            t("inspector.authorProfileRefreshFailed", {
              defaultValue: "Failed to refresh author details.",
            })
          );
        }
      }
      setAuthorProfileRefreshing(false);
    },
    [selectedAuthorName, selectedItem, t]
  );

  useEffect(() => {
    if (selectedItem || !selectedAuthorName) return;
    if (authorProfileLoadInFlightRef.current || authorMetadataLoading) return;
    if (hasAuthorMetadata(authorProfile) || hasFetchedAuthorMetadata(authorProfile)) return;

    const key = selectedAuthorName.trim().toLowerCase();
    if (!key) return;
    if (autoFetchAttemptedRef.current.has(key)) return;
    autoFetchAttemptedRef.current.add(key);
    void Promise.resolve().then(() => handleRefreshAuthorProfile({ silent: true }));
  }, [
    selectedItem,
    selectedAuthorName,
    authorProfile,
    authorMetadataLoading,
    handleRefreshAuthorProfile,
  ]);

  useEffect(() => {
    for (const value of authorBookCoverCacheRef.current.values()) {
      if (value) URL.revokeObjectURL(value);
    }
    authorBookCoverCacheRef.current.clear();
  }, [selectedAuthorName]);

  useEffect(() => {
    if (!selectedAuthorName || visibleAuthorBooks.length === 0) return;
    const missingBookIds = visibleAuthorBooks
      .filter((book) => !book.cover && !authorBookCoverCacheRef.current.has(book.id))
      .map((book) => book.id);
    if (missingBookIds.length === 0) return;

    let cancelled = false;
    void Promise.resolve().then(async () => {
      if (cancelled) return;
      setAuthorBookCoverState((previous) => {
        const current = previous.authorName === selectedAuthorName
          ? previous
          : { authorName: selectedAuthorName, urls: {}, loadingIds: {}, errors: {} };
        const loadingIds = { ...current.loadingIds };
        const errors = { ...current.errors };
        for (const id of missingBookIds) {
          loadingIds[id] = true;
          delete errors[id];
        }
        return { ...current, loadingIds, errors };
      });

      const results: AuthorBookCoverLoadResult[] = await Promise.all(
        missingBookIds.map(async (bookId) => {
          const result = await invokeCapability<{ mime: string; bytes: number[] } | null>(
            "get_cover_blob",
            { itemId: bookId },
          );
          if (result.status === "success") {
            if (!result.value) {
              return { bookId, status: "success", url: null };
            }
            const blob = new Blob([new Uint8Array(result.value.bytes)], {
              type: result.value.mime,
            });
            return {
              bookId,
              status: "success",
              url: URL.createObjectURL(blob),
            };
          }
          if (result.status === "unsupported") {
            return { bookId, status: "unsupported" };
          }
          console.error(`Failed to load cover for book "${bookId}"`, result.error.message);
          return { bookId, status: "error", message: result.error.message };
        }),
      );
      if (cancelled) {
        for (const result of results) {
          if (result.status === "success" && result.url) {
            URL.revokeObjectURL(result.url);
          }
        }
        return;
      }

      const nextUrls: Record<string, string> = {};
      const nextErrors: Record<string, string> = {};
      for (const result of results) {
        if (result.status === "success") {
          authorBookCoverCacheRef.current.set(result.bookId, result.url);
          if (result.url) {
            nextUrls[result.bookId] = result.url;
          }
        } else if (result.status === "unsupported") {
          authorBookCoverCacheRef.current.set(result.bookId, null);
        } else {
          nextErrors[result.bookId] = result.message;
        }
      }
      setAuthorBookCoverState((previous) => {
        if (previous.authorName !== selectedAuthorName) return previous;
        const loadingIds = { ...previous.loadingIds };
        for (const id of missingBookIds) {
          delete loadingIds[id];
        }
        return {
          ...previous,
          urls: { ...previous.urls, ...nextUrls },
          loadingIds,
          errors: { ...previous.errors, ...nextErrors },
        };
      });
    }).catch((error: unknown) => {
      if (cancelled) return;
      const message = error instanceof Error ? error.message : String(error);
      console.error("Failed to load author book covers", message);
      setAuthorBookCoverState((previous) => {
        if (previous.authorName !== selectedAuthorName) return previous;
        const loadingIds = { ...previous.loadingIds };
        const errors = { ...previous.errors };
        for (const id of missingBookIds) {
          delete loadingIds[id];
          errors[id] = message;
        }
        return { ...previous, loadingIds, errors };
      });
    });

    return () => {
      cancelled = true;
    };
  }, [authorBookCoverRetryVersion, selectedAuthorName, visibleAuthorBooks]);

  useEffect(() => {
    const coverCache = authorBookCoverCacheRef.current;
    return () => {
      for (const value of coverCache.values()) {
        if (value) URL.revokeObjectURL(value);
      }
      coverCache.clear();
    };
  }, []);

  return (
    <aside className="flex h-screen flex-col gap-3 overflow-hidden border-l border-[var(--app-border-soft)] bg-[var(--app-surface)] px-3 py-4">
      <div className="flex items-center justify-between">
        <div className="text-[10px] font-semibold uppercase tracking-[0.2em] text-[var(--app-ink-muted)]">
          {t("inspector.details")}
        </div>
        <div className="rounded-full border border-app-border bg-app-surface/50 px-2 py-0.5 text-[10px] text-app-ink-muted">
          {t("inspector.inspector")}
        </div>
      </div>
      <Separator />
      {selectedItem ? (
        <div className="flex h-full flex-col overflow-y-auto pb-4 [&::-webkit-scrollbar]:hidden">
          <div className="rounded-md border border-[var(--app-border-muted)] bg-app-surface/40 p-3">
            <div className={compactLayout ? "flex flex-col gap-3" : "flex gap-3"}>
              <div
                className={
                  compactLayout
                    ? "mx-auto h-36 w-24 flex-none overflow-hidden rounded-md border border-[var(--app-border-muted)] bg-app-bg"
                    : "h-32 w-24 flex-none overflow-hidden rounded-md border border-[var(--app-border-muted)] bg-app-bg"
                }
              >
                {selectedItem.cover ? (
                  <img
                    className="h-full w-full object-cover"
                    src={selectedItem.cover}
                    alt=""
                    onError={() => {
                      clearCoverOverride(selectedItem.id);
                      void fetchCoverOverride(selectedItem.id);
                    }}
                  />
                ) : (
                  <div className="flex h-full w-full items-center justify-center text-[10px] uppercase tracking-[0.12em] text-[var(--app-ink-muted)]">
                    {selectedItem.format}
                  </div>
                )}
              </div>

              <div className="flex min-w-0 flex-1 flex-col gap-2">
                <div className="break-words text-[15px] font-semibold leading-tight">{selectedItem.title}</div>
                {bookAuthorNames.length > 0 ? (
                  <div className="space-y-1">
                    {bookAuthorNames.map((author, i) => {
                      const profile = bookAuthorProfiles[authorProfileKey(author)] ?? null;
                      const showAuthorCard = hasAuthorMetadata(profile) || hasFetchedAuthorMetadata(profile);
                      const metadataSourceLabel = hasAuthorMetadata(profile)
                        ? formatAuthorMetadataSource(profile?.metadataSource)
                        : null;
                      if (!showAuthorCard) {
                        return (
                          <div key={`${author}-${i}`}>
                            <button
                              className="text-left text-sm text-[var(--app-accent-strong)] hover:underline"
                              onClick={() => handleAuthorClick(author)}
                            >
                              {author}
                            </button>
                          </div>
                        );
                      }

                      return (
                        <button
                          key={`${author}-${i}`}
                          className="flex w-full items-start gap-2 rounded-md border border-[var(--app-border-soft)] bg-app-bg/30 px-2 py-1.5 text-left transition hover:border-[var(--app-accent)]/60 hover:bg-app-surface"
                          onClick={() => handleAuthorClick(author)}
                        >
                          <span className="flex h-9 w-9 flex-none items-center justify-center overflow-hidden rounded-full border border-[var(--app-border-soft)] bg-app-bg">
                            <AuthorPhotoImage
                              photoUrl={profile?.photoUrl}
                              retryKey={profile?.metadataUpdatedAt}
                              allowNetwork={false}
                              alt={author}
                              className="h-full w-full object-cover"
                              fallback={<UserRound size={16} className="text-[var(--app-ink-muted)]" />}
                            />
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block break-words text-sm leading-snug text-[var(--app-accent-strong)]">
                              {author}
                            </span>
                            {metadataSourceLabel ? (
                              <span className="mt-1 inline-flex rounded-full border border-[var(--app-border-soft)] bg-app-bg/50 px-1.5 py-0.5 text-[9px] text-[var(--app-ink-muted)]">
                                {metadataSourceLabel}
                              </span>
                            ) : null}
                          </span>
                        </button>
                      );
                    })}
                    {bookAuthorProfilesLoading ? (
                      <div className="flex items-center gap-1.5 text-[11px] text-[var(--app-ink-muted)]">
                        <Loader2 size={11} className="animate-spin" />
                        {t("inspector.loadingAuthorCards", { defaultValue: "Loading author info..." })}
                      </div>
                    ) : null}
                  </div>
                ) : (
                  <div className="text-xs text-[var(--app-ink-muted)]">{selectedItem.author}</div>
                )}
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="rounded-full border border-[var(--app-border-soft)] bg-app-bg/40 px-2 py-0.5 text-[11px] text-[var(--app-ink-muted)]">
                    {selectedItem.year}
                  </span>
                  <span className="rounded-full border border-[var(--app-border-soft)] bg-app-bg/40 px-2 py-0.5 text-[11px] text-[var(--app-ink-muted)]">
                    {selectedItem.format}
                  </span>
                </div>
                {selectedItem.series && (
                  <button
                    className="flex items-center gap-1 text-left text-xs text-[var(--app-accent-strong)] hover:underline"
                    onClick={() => handleSeriesClick(selectedItem.series!)}
                  >
                    <BookOpen size={12} />
                    {selectedItem.series}
                    {selectedItem.seriesIndex && (
                      <span className="ml-1 rounded bg-[rgba(208,138,70,0.15)] px-1.5 py-0.5 text-[10px] font-medium">
                        #{selectedItem.seriesIndex}
                      </span>
                    )}
                  </button>
                )}
                {selectedItem.language && hasKnownItemLanguage && (
                  <div className="flex items-center gap-1.5 text-xs text-[var(--app-ink-muted)]">
                    <span>{getLanguageFlag(selectedItem.language)}</span>
                    <span>{getLanguageName(selectedItem.language)}</span>
                  </div>
                )}
                {(selectedItem.genres ?? []).length > 0 ? (
                  <div className="space-y-1">
                    <div className="text-[10px] uppercase tracking-[0.12em] text-[var(--app-ink-muted)]">
                      {t("inspector.categories")}
                    </div>
                    <div className="flex flex-wrap items-center gap-1.5">
                    {(selectedItem.genres ?? []).slice(0, 6).map((genre) => (
                      <button
                        key={genre}
                        className="rounded-full border border-[var(--app-border-soft)] bg-app-bg/40 px-2 py-0.5 text-[10px] text-[var(--app-ink-muted)] hover:border-[var(--app-accent)] hover:text-[var(--app-accent-strong)]"
                        onClick={() => handleGenreClick(genre)}
                      >
                        {genre}
                      </button>
                    ))}
                    </div>
                  </div>
                ) : null}
              </div>
            </div>


            {filesLoading ? (
              <div className="mt-3 flex items-center gap-1.5 text-[11px] text-[var(--app-ink-muted)]">
                <Loader2 size={12} className="animate-spin" />
                {t("inspector.loadingFiles", { defaultValue: "Loading files..." })}
              </div>
            ) : filesError ? (
              <div className="mt-3 text-xs text-red-500">
                {t("inspector.filesLoadFailed", {
                  defaultValue: "Files could not be loaded.",
                })}
              </div>
            ) : files.length > 0 ? (
              <div className="mt-3">
                <div className="text-[10px] uppercase tracking-[0.12em] text-[var(--app-ink-muted)] mb-1">
                  {t("inspector.files")}
                </div>
                <div className="flex flex-col gap-1">
                  {files.map((file) => (
                    <div key={file.id} className="group flex items-center justify-between rounded border border-transparent bg-app-bg/30 px-2 py-1.5 hover:border-app-border hover:bg-app-surface">
                      <div className="flex items-center gap-2 overflow-hidden">
                        <FileText size={12} className="text-app-ink-muted flex-none" />
                        <div className="flex flex-col overflow-hidden">
                          <span className="truncate text-[11px] font-medium leading-none" title={file.filename}>
                            {file.filename}
                          </span>
                          <span className="truncate text-[9px] text-app-ink-muted leading-tight" title={file.path}>
                            {file.path}
                          </span>
                        </div>
                      </div>
                      <button
                        onClick={() => handleReveal(file.path)}
                        disabled={revealLoading}
                        className="hidden opacity-0 group-hover:block group-hover:opacity-100 p-1 hover:bg-app-bg rounded transition-all"
                        title={t("inspector.revealInFinder")}
                      >
                        {revealLoading && revealFileState?.path === file.path ? (
                          <Loader2 size={12} className="animate-spin text-app-ink-muted" />
                        ) : (
                          <FolderOpen size={12} className="text-app-ink-muted" />
                        )}
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}

            <div className="mt-3">
              <div className="text-[10px] uppercase tracking-[0.12em] text-[var(--app-ink-muted)]">
                {t("inspector.tags")}
              </div>
              <div className="mt-2 flex flex-wrap gap-2">
                {selectedTags.length ? (
                  selectedTags.map((tag) => (
                    <button
                      key={tag.id}
                      className={`flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] ${getTagColorClass(tag.color)}`}
                      onClick={() => handleRemoveTag(tag.id)}
                    >
                      {tag.name}
                      <span className="text-[10px]">×</span>
                    </button>
                  ))
                ) : (
                  <span className="text-xs text-[var(--app-ink-muted)]">{t("inspector.noTagsYet")}</span>
                )}
              </div>

              <div className="mt-3">
                <div className="text-[10px] uppercase tracking-[0.12em] text-[var(--app-ink-muted)]">
                  {t("inspector.addTag")}
                </div>
                <div className="mt-2 flex flex-wrap gap-2">
                  {availableTags.length ? (
                    availableTags.map((tag) => (
                      <button
                        key={tag.id}
                        className={`rounded-full border px-2 py-0.5 text-[11px] hover:bg-app-surface-hover ${getTagColorClass(tag.color)}`}
                        onClick={() => handleAddTag(tag.id)}
                      >
                        {tag.name}
                      </button>
                    ))
                  ) : (
                    <span className="text-xs text-[var(--app-ink-muted)]">{t("inspector.noTagsAvailable")}</span>
                  )}
                </div>
              </div>
            </div>

            {/* Available languages (other editions) */}
            {availableLanguages.length > 1 && (
              <div className="mt-3">
                <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-[0.12em] text-[var(--app-ink-muted)]">
                  <Globe size={12} />
                  {t("inspector.availableLanguages")}
                </div>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {availableLanguages.filter((lang) => isKnownLanguageCode(lang)).map((lang) => {
                    const flag = getLanguageFlag(lang);
                    const name = getLanguageName(lang);
                    const isCurrent = lang === selectedItem.language;
                    return (
                      <span
                        key={lang}
                        className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] ${isCurrent
                          ? "border-[var(--app-accent)] border-opacity-40 bg-app-accent/10"
                          : "border-[var(--app-border-soft)] bg-app-surface/50"
                          }`}
                        title={name}
                      >
                        {flag && <span>{flag}</span>}
                        <span>{name}</span>
                      </span>
                    );
                  })}
                </div>
              </div>
            )}

            <div className="mt-3 grid grid-cols-2 gap-2">
              <Button
                variant="toolbar"
                size="sm"
                className="w-full justify-center"
                onClick={() => files[0] && handleReveal(files[0].path)}
                disabled={files.length === 0 || filesLoading || revealLoading}
              >
                {revealLoading ? (
                  <Loader2 size={14} className="animate-spin" />
                ) : (
                  <FolderOpen size={14} />
                )}
                {t("inspector.reveal")}
              </Button>
              <Button
                variant="toolbar"
                size="sm"
                className="w-full justify-center"
                onClick={onNavigateToEdit}
              >
                <PencilLine size={14} />
                {t("inspector.edit")}
              </Button>
            </div>
            {revealError ? (
              <div className="mt-2 text-xs text-red-500">
                {t("inspector.revealFailed", {
                  defaultValue: "The file could not be shown in Finder.",
                })}
              </div>
            ) : null}

            {/* eReader Sync Section */}
            {ereaderConnected && (
              <div className="mt-3 pt-3 border-t border-[var(--app-border)]">
                <div className="text-[10px] uppercase tracking-[0.12em] text-[var(--app-ink-muted)] mb-2">
                  {t("inspector.ereader")}
                </div>
                {ereaderSyncStatus?.isOnDevice ? (
                  <div className="flex items-center gap-2">
                    <Badge
                      variant="success"
                      className="inline-flex items-center gap-1.5 px-2 py-1 text-xs font-medium normal-case tracking-normal"
                    >
                      <HardDrive size={12} />
                      {t("inspector.synced")}
                    </Badge>
                    {ereaderSyncStatus.matchConfidence === "fuzzy" && (
                      <span className="text-[10px] text-[var(--app-ink-muted)]">({t("inspector.fuzzyMatch")})</span>
                    )}
                  </div>
                ) : ereaderSyncStatus?.isInQueue ? (
                  <Badge
                    variant="info"
                    className="inline-flex items-center gap-1.5 px-2 py-1 text-xs font-medium normal-case tracking-normal"
                  >
                    <HardDrive size={12} />
                    {t("inspector.inQueue")}
                  </Badge>
                ) : (
                  <Button
                    variant="toolbar"
                    size="sm"
                    className="w-full justify-center"
                    onClick={() => onQueueEreaderAdd(selectedItem.id)}
                  >
                    <HardDrive size={14} />
                    {t("inspector.sendToEreader")}
                  </Button>
                )}
              </div>
            )}
          </div>
        </div>
      ) : selectedAuthorName ? (
        <div className="flex h-full flex-col overflow-y-auto pb-4 [&::-webkit-scrollbar]:hidden">
          <div className="rounded-md border border-[var(--app-border-muted)] bg-app-surface/40 p-3">
            <div className={compactLayout ? "flex flex-col gap-3" : "flex gap-3"}>
              <div
                className={
                  compactLayout
                    ? "relative mx-auto h-36 w-24 flex-none overflow-hidden rounded-md border border-[var(--app-border-muted)] bg-app-bg"
                    : "relative h-32 w-24 flex-none overflow-hidden rounded-md border border-[var(--app-border-muted)] bg-app-bg"
                }
              >
                <AuthorPhotoImage
                  photoUrl={authorProfile?.photoUrl}
                  retryKey={authorProfile?.metadataUpdatedAt}
                  allowNetwork
                  alt={authorProfile?.name ?? selectedAuthorName}
                  className="h-full w-full object-cover"
                  loadingFallback={
                    <div className="flex h-full w-full items-center justify-center text-[var(--app-ink-muted)]">
                      <Loader2 size={14} className="animate-spin" />
                    </div>
                  }
                  fallback={
                    <div className="flex h-full w-full items-center justify-center text-[var(--app-ink-muted)]">
                      <UserRound size={22} />
                    </div>
                  }
                />
                {authorMetadataLoading ? (
                  <div className="absolute inset-0 flex items-center justify-center bg-app-bg/45">
                    <Loader2 size={14} className="animate-spin text-[var(--app-ink-muted)]" />
                  </div>
                ) : null}
              </div>

              <div className="flex min-w-0 flex-1 flex-col gap-2">
                <div className="flex items-start justify-between gap-2">
                  <div className="break-words text-[15px] font-semibold leading-tight">
                    {authorProfile?.name ?? selectedAuthorName}
                  </div>
                  <button
                    type="button"
                    className="inline-flex h-5 w-5 flex-none items-center justify-center rounded text-[var(--app-ink-muted)]/80 transition hover:bg-app-bg/35 hover:text-[var(--app-ink)] disabled:cursor-not-allowed disabled:opacity-40"
                    title={t("inspector.refresh", { defaultValue: "Refresh" })}
                    onClick={() => void handleRefreshAuthorProfile()}
                    disabled={authorMetadataLoading}
                  >
                    {authorMetadataLoading ? (
                      <Loader2 size={11} className="animate-spin" />
                    ) : (
                      <RefreshCcw size={11} />
                    )}
                  </button>
                </div>
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="rounded-full border border-[var(--app-border-soft)] bg-app-bg/40 px-2 py-0.5 text-[11px] text-[var(--app-ink-muted)]">
                    {t("inspector.booksByAuthor", {
                      defaultValue: "{{count}} books",
                      count: authorProfile?.bookCount ?? 0,
                    })}
                  </span>
                  {hasAuthorMetadata(authorProfile) && authorProfile?.metadataSource ? (
                    <span className="rounded-full border border-[var(--app-border-soft)] bg-app-bg/40 px-2 py-0.5 text-[11px] text-[var(--app-ink-muted)]">
                      {formatAuthorMetadataSource(authorProfile.metadataSource)}
                    </span>
                  ) : null}
                  {authorMetadataLoading ? (
                    <span className="inline-flex items-center gap-1 rounded-full border border-[var(--app-border-soft)] bg-app-bg/40 px-2 py-0.5 text-[11px] text-[var(--app-ink-muted)]">
                      <Loader2 size={10} className="animate-spin" />
                      {t("inspector.fetchingMetadata", { defaultValue: "Fetching metadata..." })}
                    </span>
                  ) : null}
                </div>
                {formatMetadataDate(authorProfile?.metadataUpdatedAt ?? null) ? (
                  <div className="text-xs text-[var(--app-ink-muted)]">
                    {t("inspector.updated", { defaultValue: "Updated" })}: {formatMetadataDate(authorProfile?.metadataUpdatedAt ?? null)}
                  </div>
                ) : null}
              </div>
            </div>

            {authorProfileError ? (
              <div className="mt-3 text-xs text-red-500">{authorProfileError}</div>
            ) : (
              <div className="mt-3">
                {authorMetadataLoading ? (
                  <div className="mb-2 flex items-center gap-1.5 text-[11px] text-[var(--app-ink-muted)]">
                    <Loader2 size={12} className="animate-spin" />
                    {t("inspector.fetchingAuthorDetails", { defaultValue: "Fetching author details..." })}
                  </div>
                ) : null}
                {authorHasBio ? (
                  <div className="rounded-md border border-[var(--app-border-soft)] bg-app-bg/30 p-2.5 text-xs leading-relaxed text-[var(--app-ink-soft)]">
                    {authorProfile?.bio}
                  </div>
                ) : (
                  <div className="text-xs text-[var(--app-ink-muted)]">
                    {authorMetadataWasFetched
                      ? authorHasPhoto
                        ? t("inspector.noAuthorBioAfterFetch", {
                            defaultValue:
                              "Metadata was fetched automatically, but no biography was found yet.",
                          })
                        : t("inspector.noAuthorProfileAfterFetch", {
                            defaultValue:
                              "Metadata was fetched automatically, but no biography or photo was found yet.",
                          })
                      : t("inspector.noAuthorProfileYet", {
                          defaultValue: "No author details yet. Metadata is fetched automatically.",
                        })}
                  </div>
                )}
              </div>
            )}

            {selectedAuthorBooks.length > 0 ? (
              <div className="mt-3">
                <div className="mb-1.5 flex items-center justify-between">
                  <div className="text-[10px] uppercase tracking-[0.12em] text-[var(--app-ink-muted)]">
                    {t("inspector.books", { defaultValue: "Books" })}
                  </div>
                  <div className="text-[10px] text-[var(--app-ink-muted)]">
                    {visibleAuthorBooks.length}/{selectedAuthorBooks.length}
                  </div>
                </div>
                <div className="space-y-1.5">
                  {visibleAuthorBooks.map((book) => {
                    const coverUrl = book.cover ?? authorBookCoverUrls[book.id] ?? null;
                    const isCoverLoading = Boolean(authorBookCoverLoadingIds[book.id]);
                    return (
                      <div
                        key={book.id}
                        className="flex items-center gap-2 rounded-md border border-[var(--app-border-soft)] bg-app-bg/30 px-2 py-1.5"
                      >
                        <div className="flex h-11 w-8 flex-none items-center justify-center overflow-hidden rounded border border-[var(--app-border-soft)] bg-app-bg">
                          {coverUrl ? (
                            <img src={coverUrl} alt="" className="h-full w-full object-cover" />
                          ) : isCoverLoading ? (
                            <Loader2 size={10} className="animate-spin text-[var(--app-ink-muted)]" />
                          ) : (
                            <span className="text-[8px] font-medium uppercase tracking-[0.1em] text-[var(--app-ink-muted)]">
                              {book.format}
                            </span>
                          )}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="line-clamp-2 text-[11px] font-medium leading-snug text-app-ink">
                            {book.title}
                          </div>
                          <div className="mt-0.5 text-[10px] text-[var(--app-ink-muted)]">{book.year}</div>
                        </div>
                      </div>
                    );
                  })}
                </div>
                {authorBookCoverErrorCount > 0 ? (
                  <div className="mt-2 flex items-center justify-between gap-2 rounded-md border border-red-500/30 bg-red-500/5 px-2 py-1.5">
                    <span className="text-[11px] text-red-500">
                      {t("inspector.coverLoadFailed", {
                        defaultValue: "Some covers could not be loaded.",
                      })}
                    </span>
                    <Button
                      variant="toolbar"
                      size="sm"
                      className="h-7 px-2 text-[11px]"
                      onClick={() => setAuthorBookCoverRetryVersion((version) => version + 1)}
                    >
                      {t("common.retry", { defaultValue: "Retry" })}
                    </Button>
                  </div>
                ) : null}
                {selectedAuthorBooks.length > AUTHOR_BOOKS_PAGE_SIZE ? (
                  <div className="mt-2 flex gap-2">
                    {remainingAuthorBookCount > 0 ? (
                      <Button
                        variant="toolbar"
                        size="sm"
                        className="h-7 px-2.5 text-[11px]"
                        onClick={() =>
                          setAuthorBooksPagination({
                            authorName: selectedAuthorName,
                            visibleCount: authorBooksVisibleCount + AUTHOR_BOOKS_PAGE_SIZE,
                          })
                        }
                      >
                        {t("inspector.showMoreBooks", {
                          defaultValue: "Show {{count}} more",
                          count: Math.min(AUTHOR_BOOKS_PAGE_SIZE, remainingAuthorBookCount),
                        })}
                      </Button>
                    ) : null}
                    {authorBooksVisibleCount > AUTHOR_BOOKS_PAGE_SIZE ? (
                      <Button
                        variant="toolbar"
                        size="sm"
                        className="h-7 px-2.5 text-[11px]"
                        onClick={() =>
                          setAuthorBooksPagination({
                            authorName: selectedAuthorName,
                            visibleCount: AUTHOR_BOOKS_PAGE_SIZE,
                          })
                        }
                      >
                        {t("inspector.showLessBooks", { defaultValue: "Show less" })}
                      </Button>
                    ) : null}
                  </div>
                ) : null}
              </div>
            ) : null}

            <div className="mt-3">
              <Button
                variant="toolbar"
                size="sm"
                className="w-full justify-center"
                onClick={handleOpenAuthorBooks}
              >
                <BookOpen size={14} />
                {t("inspector.showBooks", { defaultValue: "Show books" })}
              </Button>
            </div>
          </div>
        </div>
      ) : (
        <div className="text-xs text-[var(--app-ink-muted)]">
          {t("inspector.selectBookOrAuthor", {
            defaultValue: "Select a book or author to see details.",
          })}
        </div>
      )}
    </aside>
  );
}
