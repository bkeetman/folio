import { invoke } from "@tauri-apps/api/core";
import { BookOpen, ChevronDown, ChevronUp, Grip, List, Loader2, RefreshCcw, Search, UserRound, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import { useTranslation } from "react-i18next";
import {
  AUTHOR_PROFILE_UPDATED_EVENT,
  emitAuthorProfileUpdated,
  type AuthorProfileUpdatedDetail,
} from "../lib/authorProfileEvents";
import type { Author, AuthorProfile, View } from "../types/library";

type AuthorsViewProps = {
  authors: Author[];
  selectedAuthorNames: string[];
  setSelectedItemId: Dispatch<SetStateAction<string | null>>;
  setSelectedAuthorNames: Dispatch<SetStateAction<string[]>>;
  setSelectedGenres: Dispatch<SetStateAction<string[]>>;
  setView: Dispatch<SetStateAction<View>>;
};

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ#".split("");
const CARD_BIO_PREVIEW_MAX = 220;
const AUTHORS_VIEW_MODE_STORAGE_KEY = "folio.authorsViewMode";

function normalizeAuthorKey(name: string): string {
  return name.trim().toLowerCase();
}

function truncateBio(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars).trimEnd()}...`;
}

function decodeHtmlEntities(value: string): string {
  if (typeof document === "undefined") return value;
  const textarea = document.createElement("textarea");
  textarea.innerHTML = value;
  return textarea.value;
}

function normalizeAuthorBio(value: string | null | undefined): string {
  if (!value) return "";
  const decoded = decodeHtmlEntities(value);
  const withLineBreaks = decoded
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<\/div>/gi, "\n");
  const withoutTags = withLineBreaks.replace(/<[^>]+>/g, " ");
  return withoutTags
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

function readInitialCardView(): boolean {
  if (typeof window === "undefined") return false;
  return window.localStorage.getItem(AUTHORS_VIEW_MODE_STORAGE_KEY) === "cards";
}

export function AuthorsView({
  authors,
  selectedAuthorNames,
  setSelectedItemId,
  setSelectedAuthorNames,
  setSelectedGenres,
  setView,
}: AuthorsViewProps) {
  const { t } = useTranslation();
  const initialCardView = readInitialCardView();
  const [searchQuery, setSearchQuery] = useState("");
  const [cardView, setCardView] = useState(initialCardView);
  const [expandedAuthorNames, setExpandedAuthorNames] = useState<Set<string>>(new Set());
  const [authorProfiles, setAuthorProfiles] = useState<Record<string, AuthorProfile>>({});
  const [authorProfilesLoading, setAuthorProfilesLoading] = useState(initialCardView);
  const [authorProfilesLoaded, setAuthorProfilesLoaded] = useState(false);
  const [authorProfilesError, setAuthorProfilesError] = useState<string | null>(null);
  const [authorEnrichingAll, setAuthorEnrichingAll] = useState(false);
  const [authorEnrichCancelling, setAuthorEnrichCancelling] = useState(false);
  const [authorEnrichProgress, setAuthorEnrichProgress] = useState<{ current: number; total: number } | null>(null);
  const [authorEnrichSummary, setAuthorEnrichSummary] = useState<{ updated: number; errors: number } | null>(null);
  const [authorEnrichingName, setAuthorEnrichingName] = useState<string | null>(null);
  const authorEnrichCancelRequestedRef = useRef(false);
  const sectionRefs = useRef<Record<string, HTMLDivElement | null>>({});

  const activeAuthor = selectedAuthorNames[0] ?? null;

  useEffect(() => {
    if (authorProfilesLoaded) return;
    setAuthorProfilesLoading(true);
    let cancelled = false;
    void invoke<AuthorProfile[]>("list_author_profiles")
      .then((profiles) => {
        if (cancelled) return;
        const byName: Record<string, AuthorProfile> = {};
        for (const profile of profiles) {
          byName[normalizeAuthorKey(profile.name)] = profile;
        }
        setAuthorProfiles(byName);
        setAuthorProfilesLoaded(true);
      })
      .catch((error) => {
        if (cancelled) return;
        console.error("Failed to load author profiles for card view", error);
        setAuthorProfilesError(
          t("authors.profileLoadFailed", {
            defaultValue: "Failed to load author card details.",
          })
        );
      })
      .finally(() => {
        if (!cancelled) {
          setAuthorProfilesLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [authorProfilesLoaded, t]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(AUTHORS_VIEW_MODE_STORAGE_KEY, cardView ? "cards" : "list");
  }, [cardView]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const handleProfileUpdated = (event: Event) => {
      const customEvent = event as CustomEvent<AuthorProfileUpdatedDetail>;
      const profile = customEvent.detail?.profile;
      if (!profile) return;
      const key = normalizeAuthorKey(profile.name);
      setAuthorProfiles((prev) => ({
        ...prev,
        [key]: profile,
      }));
    };
    window.addEventListener(AUTHOR_PROFILE_UPDATED_EVENT, handleProfileUpdated);
    return () => {
      window.removeEventListener(AUTHOR_PROFILE_UPDATED_EVENT, handleProfileUpdated);
    };
  }, []);

  const filteredAuthors = useMemo(() => {
    if (!searchQuery.trim()) return authors;
    const query = searchQuery.toLowerCase();
    return authors.filter((author) => author.name.toLowerCase().includes(query));
  }, [authors, searchQuery]);

  const groupedAuthors = useMemo(() => {
    const groups: Record<string, Author[]> = {};

    filteredAuthors.forEach((author) => {
      const firstChar = author.name.charAt(0).toUpperCase();
      const key = /[A-Z]/.test(firstChar) ? firstChar : "#";
      if (!groups[key]) groups[key] = [];
      groups[key].push(author);
    });

    Object.keys(groups).forEach((key) => {
      groups[key].sort((a, b) => a.name.localeCompare(b.name));
    });

    return groups;
  }, [filteredAuthors]);

  const availableLetters = useMemo(() => {
    return new Set(Object.keys(groupedAuthors));
  }, [groupedAuthors]);

  const handleAuthorSelect = (authorName: string, navigateToBooks = false) => {
    setSelectedItemId(null);
    setSelectedAuthorNames([authorName]);
    setSelectedGenres([]);
    if (navigateToBooks) {
      setView("library-books");
    }
  };

  const scrollToLetter = (letter: string) => {
    const ref = sectionRefs.current[letter];
    if (ref) {
      ref.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  };

  const toggleExpanded = (authorName: string) => {
    setExpandedAuthorNames((prev) => {
      const next = new Set(prev);
      if (next.has(authorName)) {
        next.delete(authorName);
      } else {
        next.add(authorName);
      }
      return next;
    });
  };

  const handleEnrichAllAuthors = async () => {
    if (authorEnrichingAll || authors.length === 0) return;
    setAuthorEnrichingAll(true);
    setAuthorEnrichCancelling(false);
    setAuthorEnrichSummary(null);
    setAuthorProfilesError(null);
    setAuthorEnrichProgress({ current: 0, total: authors.length });
    setAuthorEnrichingName(null);
    authorEnrichCancelRequestedRef.current = false;

    let updated = 0;
    let errors = 0;
    let cancelled = false;
    const nextProfiles: Record<string, AuthorProfile> = {};
    const flushProfiles = () => {
      const entries = Object.entries(nextProfiles);
      if (entries.length === 0) return;
      setAuthorProfiles((prev) => ({ ...prev, ...nextProfiles }));
      entries.forEach(([, profile]) => {
        emitAuthorProfileUpdated(profile);
      });
      Object.keys(nextProfiles).forEach((key) => {
        delete nextProfiles[key];
      });
    };

    try {
      for (let index = 0; index < authors.length; index += 1) {
        if (authorEnrichCancelRequestedRef.current) {
          cancelled = true;
          break;
        }
        const author = authors[index];
        setAuthorEnrichingName(author.name);
        try {
          const refreshed = await invoke<AuthorProfile | null>("enrich_author_metadata", {
            authorName: author.name,
          });
          if (refreshed) {
            nextProfiles[normalizeAuthorKey(refreshed.name)] = refreshed;
            updated += 1;
            if (Object.keys(nextProfiles).length >= 10) {
              flushProfiles();
            }
          }
        } catch (error) {
          console.error(`Failed to enrich metadata for author "${author.name}"`, error);
          errors += 1;
        }
        if ((index + 1) % 5 === 0 || index === authors.length - 1) {
          setAuthorEnrichProgress({ current: index + 1, total: authors.length });
        }
      }
      flushProfiles();
      setAuthorProfilesLoaded(true);
      if (!cancelled) {
        setAuthorEnrichSummary({ updated, errors });
      }
    } catch (error) {
      console.error("Failed to enrich author metadata in batch", error);
      setAuthorProfilesError(
        t("authors.enrichFailed", {
          defaultValue: "Failed to enrich author metadata.",
        })
      );
    } finally {
      setAuthorEnrichingAll(false);
      setAuthorEnrichCancelling(false);
      setAuthorEnrichProgress(null);
      setAuthorEnrichingName(null);
      authorEnrichCancelRequestedRef.current = false;
    }
  };

  const handleCancelEnrichAllAuthors = () => {
    if (!authorEnrichingAll) return;
    authorEnrichCancelRequestedRef.current = true;
    setAuthorEnrichCancelling(true);
  };

  return (
    <div className="flex gap-4">
      <div className="flex flex-1 flex-col gap-4">
        <div className="flex flex-col gap-2">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <div className="relative min-w-0 flex-1">
              <Search
                size={16}
                className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--app-ink-muted)]"
              />
              <input
                type="text"
                placeholder={t("authors.searchPlaceholder")}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full rounded-lg border border-[var(--app-border)] bg-app-surface px-4 py-2 pl-10 pr-10 text-sm text-app-ink placeholder:text-[var(--app-ink-muted)] focus:border-[rgba(208,138,70,0.6)] focus:outline-none"
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

            <div className="flex shrink-0 items-center gap-2 self-end sm:self-auto">
              {authorEnrichingAll ? (
                <button
                  type="button"
                  onClick={handleCancelEnrichAllAuthors}
                  disabled={authorEnrichCancelling}
                  className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-[var(--app-border-soft)] bg-app-surface px-3 text-[11px] font-medium text-app-ink-muted transition-colors hover:border-[var(--app-border)] hover:text-app-ink disabled:cursor-not-allowed disabled:opacity-55"
                >
                  {authorEnrichCancelling ? <Loader2 size={13} className="animate-spin" /> : <X size={13} />}
                  {t("changes.cancel", { defaultValue: "Cancel" })}
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => void handleEnrichAllAuthors()}
                  disabled={authors.length === 0}
                  className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-[var(--app-border-soft)] bg-app-surface px-3 text-[11px] font-medium text-app-ink-muted transition-colors hover:border-[var(--app-border)] hover:text-app-ink disabled:cursor-not-allowed disabled:opacity-55"
                >
                  <RefreshCcw size={13} />
                  {t("authors.enrichAll", { defaultValue: "Enrich all authors" })}
                </button>
              )}
              <div className="flex h-9 items-center rounded-lg border border-[var(--app-border-muted)] bg-app-surface p-1">
                <button
                  onClick={() => {
                    setCardView(true);
                    if (!authorProfilesLoaded) {
                      setAuthorProfilesLoading(true);
                      setAuthorProfilesError(null);
                    }
                  }}
                  className={`rounded p-1 transition-colors ${
                    cardView
                      ? "bg-app-ink/5 text-app-ink"
                      : "text-app-ink-muted hover:bg-app-surface-hover hover:text-app-ink"
                  }`}
                  title={t("authors.cardView", { defaultValue: "Card view" })}
                >
                  <Grip size={14} />
                </button>
                <button
                  onClick={() => setCardView(false)}
                  className={`rounded p-1 transition-colors ${
                    !cardView
                      ? "bg-app-ink/5 text-app-ink"
                      : "text-app-ink-muted hover:bg-app-surface-hover hover:text-app-ink"
                  }`}
                  title={t("authors.listView", { defaultValue: "List view" })}
                >
                  <List size={14} />
                </button>
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-[var(--app-ink-muted)]">
            <span>
              {filteredAuthors.length === authors.length
                ? t("authors.countAll", { count: authors.length })
                : t("authors.countFiltered", {
                    filtered: filteredAuthors.length,
                    total: authors.length,
                  })}
            </span>
            {authorEnrichingAll && authorEnrichProgress ? (
              <span className="inline-flex items-center gap-1 text-xs text-[var(--app-ink-muted)]">
                <Loader2 size={12} className="animate-spin" />
                {t("authors.enrichProgress", {
                  defaultValue: "{{current}} / {{total}} processed",
                  current: authorEnrichProgress.current,
                  total: authorEnrichProgress.total,
                })}
              </span>
            ) : authorEnrichSummary ? (
              <span className="text-xs text-[var(--app-ink-muted)]">
                {t("authors.enrichDone", {
                  defaultValue: "Author metadata refresh complete: {{updated}} updated, {{errors}} errors.",
                  updated: authorEnrichSummary.updated,
                  errors: authorEnrichSummary.errors,
                })}
              </span>
            ) : null}
          </div>
        </div>

        {filteredAuthors.length === 0 ? (
          <div className="rounded-lg border border-[var(--app-border)] bg-app-surface p-4">
            <div className="text-[13px] font-semibold">{t("authors.noneTitle")}</div>
            <div className="text-xs text-[var(--app-ink-muted)]">{t("authors.noneHint")}</div>
          </div>
        ) : cardView ? (
          <div className="space-y-3">
            {authorProfilesError ? (
              <div className="rounded-lg border border-red-500/30 bg-red-500/5 p-3 text-xs text-red-400">
                {authorProfilesError}
              </div>
            ) : null}
            {authorProfilesLoading && !authorProfilesLoaded ? (
              <div className="flex items-center gap-2 text-xs text-[var(--app-ink-muted)]">
                <Loader2 size={13} className="animate-spin" />
                {t("authors.loadingCards", { defaultValue: "Loading author cards..." })}
              </div>
            ) : null}
            <div className="grid grid-cols-[repeat(auto-fill,minmax(250px,1fr))] gap-3">
              {filteredAuthors.map((author) => {
                const profile = authorProfiles[normalizeAuthorKey(author.name)];
                const bio = normalizeAuthorBio(profile?.bio);
                const hasLongBio = bio.length > CARD_BIO_PREVIEW_MAX;
                const isExpanded = expandedAuthorNames.has(author.name);
                const isActive = activeAuthor === author.name;
                const shownBio = hasLongBio && !isExpanded ? truncateBio(bio, CARD_BIO_PREVIEW_MAX) : bio;
                const isCardEnriching = authorEnrichingAll && authorEnrichingName === author.name;

                return (
                  <article
                    key={author.name}
                    role="button"
                    tabIndex={0}
                    className={`relative cursor-pointer rounded-xl border p-3 transition ${
                      isActive
                        ? "border-[rgba(208,138,70,0.65)] bg-[rgba(208,138,70,0.09)]"
                        : "border-[var(--app-border)] bg-app-surface hover:border-[rgba(208,138,70,0.4)] hover:bg-app-surface-hover"
                    }`}
                    onClick={() => handleAuthorSelect(author.name)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        handleAuthorSelect(author.name);
                      }
                      }}
                    >
                    {isCardEnriching ? (
                      <div className="pointer-events-none absolute inset-0 z-20 rounded-xl border border-[rgba(208,138,70,0.45)] bg-[rgba(9,10,12,0.35)]">
                        <div className="absolute right-2 top-2 inline-flex items-center gap-1 rounded-md border border-[var(--app-border-soft)] bg-app-surface/90 px-2 py-1 text-[10px] font-medium text-app-ink">
                          <Loader2 size={11} className="animate-spin text-app-accent" />
                          {t("topbar.loading", { defaultValue: "Loading" })}
                        </div>
                      </div>
                    ) : null}
                    <div className="flex items-start gap-3">
                      <div className="h-16 w-16 shrink-0 overflow-hidden rounded-lg border border-[var(--app-border-soft)] bg-app-bg/60">
                        {profile?.photoUrl ? (
                          <img className="h-full w-full object-cover" src={profile.photoUrl} alt={author.name} />
                        ) : (
                          <div className="flex h-full w-full items-center justify-center text-[var(--app-ink-muted)]">
                            <UserRound size={18} />
                          </div>
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-semibold text-app-ink">{author.name}</div>
                        <div className="mt-1 inline-flex rounded-full border border-[var(--app-border-soft)] bg-app-bg/40 px-2 py-0.5 text-[10px] text-[var(--app-ink-muted)]">
                          {t("inspector.booksByAuthor", {
                            defaultValue: "{{count}} books",
                            count: author.bookCount,
                          })}
                        </div>
                      </div>
                    </div>

                    <div className="mt-3 min-h-[52px]">
                      {shownBio ? (
                        <p className="break-words text-xs leading-relaxed text-[var(--app-ink-soft)]">{shownBio}</p>
                      ) : (
                        <p className="text-xs text-[var(--app-ink-muted)]">
                          {t("authors.noBio", {
                            defaultValue: "No author description yet.",
                          })}
                        </p>
                      )}
                      {hasLongBio ? (
                        <button
                          className="mt-1 inline-flex items-center gap-1 text-[11px] text-[var(--app-accent-strong)] hover:underline"
                          onClick={(event) => {
                            event.stopPropagation();
                            toggleExpanded(author.name);
                          }}
                        >
                          {isExpanded ? (
                            <>
                              <ChevronUp size={12} />
                              {t("authors.collapse", { defaultValue: "Show less" })}
                            </>
                          ) : (
                            <>
                              <ChevronDown size={12} />
                              {t("authors.expand", { defaultValue: "Read more" })}
                            </>
                          )}
                        </button>
                      ) : null}
                    </div>

                    <div className="mt-3 flex items-center gap-2">
                      <button
                        className="inline-flex h-8 items-center justify-center gap-1 rounded-lg border border-[var(--app-border-soft)] bg-app-bg/35 px-3 text-xs text-[var(--app-accent-strong)] transition hover:border-[var(--app-accent)] hover:bg-app-accent/10"
                        onClick={(event) => {
                          event.stopPropagation();
                          handleAuthorSelect(author.name, true);
                        }}
                      >
                        <BookOpen size={12} />
                        {t("authors.showBooks", { defaultValue: "Show books" })}
                      </button>
                    </div>
                  </article>
                );
              })}
            </div>
          </div>
        ) : (
          <div className="flex gap-4">
            <div className="flex-1">
              <div className="flex flex-col gap-6">
                {ALPHABET.filter((letter) => groupedAuthors[letter]).map((letter) => (
                  <div
                    key={letter}
                    ref={(el) => {
                      sectionRefs.current[letter] = el;
                    }}
                  >
                    <div className="sticky top-0 z-10 mb-2 bg-[var(--app-bg)] py-1">
                      <span className="text-lg font-semibold text-[var(--app-accent-strong)]">{letter}</span>
                      <span className="ml-2 text-xs text-[var(--app-ink-muted)]">
                        {groupedAuthors[letter].length}
                      </span>
                    </div>
                    <div className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-2">
                      {groupedAuthors[letter].map((author) => {
                        const isActive = activeAuthor === author.name;
                        const profile = authorProfiles[normalizeAuthorKey(author.name)];
                        return (
                          <button
                            key={author.name}
                            className={`flex items-center gap-2 rounded-lg border px-2.5 py-2 text-left text-sm transition ${
                              isActive
                                ? "border-[rgba(208,138,70,0.65)] bg-[rgba(208,138,70,0.12)]"
                                : "border-[var(--app-border)] bg-app-surface hover:border-[rgba(208,138,70,0.4)] hover:bg-app-surface-hover"
                            }`}
                            onClick={() => handleAuthorSelect(author.name)}
                          >
                            <div className="h-6 w-6 shrink-0 overflow-hidden rounded-md border border-[var(--app-border-soft)] bg-app-bg/60">
                              {profile?.photoUrl ? (
                                <img className="h-full w-full object-cover" src={profile.photoUrl} alt={author.name} />
                              ) : (
                                <div className="flex h-full w-full items-center justify-center text-[var(--app-ink-muted)]">
                                  <UserRound size={12} />
                                </div>
                              )}
                            </div>
                            <span className="min-w-0 flex-1 truncate font-medium">{author.name}</span>
                            <span className="shrink-0 text-xs text-[var(--app-ink-muted)]">{author.bookCount}</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="sticky top-4 flex h-fit flex-col items-center gap-0.5 rounded-lg border border-[var(--app-border)] bg-app-surface px-1 py-2">
              {ALPHABET.map((letter) => {
                const isAvailable = availableLetters.has(letter);
                return (
                  <button
                    key={letter}
                    className={`h-5 w-6 rounded text-[11px] font-medium transition ${
                      isAvailable
                        ? "text-[var(--app-ink)] hover:bg-[rgba(208,138,70,0.15)] hover:text-[var(--app-accent-strong)]"
                        : "cursor-default text-[var(--app-ink-muted)]/40"
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
        )}
      </div>
    </div>
  );
}
