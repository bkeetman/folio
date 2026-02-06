import type { ItemMetadata } from "../types/library";

type CleanupResult = {
  title: string | null;
  publishedYear: number | null;
  changed: boolean;
};

const YEAR_RE = /(19|20)\d{2}/;

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

export function normalizeTitleSnapshot(value: string): string {
  return normalizeWhitespace(value).toLowerCase();
}

function normalizeForCompare(value: string): string {
  return normalizeTitleSnapshot(value)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function matchesWithInitials(candidate: string, author: string): boolean {
  const candidateParts = candidate.split(/\s+/);
  const authorParts = author.split(/\s+/);
  if (candidateParts.length !== authorParts.length) return false;
  return candidateParts.every((cp, i) => {
    const ap = authorParts[i];
    if (cp === ap) return true;
    // "J." matches "John", "J. R." matches "John Ronald"
    const initialMatch = cp.match(/^([a-z])\.?$/);
    if (initialMatch && ap.length > 0 && ap[0] === initialMatch[1]) return true;
    return false;
  });
}

function authorMatches(candidate: string, author: string): boolean {
  const normCandidate = normalizeForCompare(candidate);
  const normAuthor = normalizeForCompare(author);
  if (normCandidate === normAuthor) return true;
  return matchesWithInitials(normCandidate, normAuthor);
}

function stripAuthorPrefix(title: string, authors: string[]): string {
  let current = title;
  // Iteratively strip author prefixes (handles "Author1 - Author2 - Title")
  let changed = true;
  while (changed) {
    changed = false;
    const match = current.match(/^\s*(.+?)\s+(?:-|–|—|:)\s+(.+)$/u);
    if (!match) break;

    const [, possibleAuthor, rest] = match;
    const isAuthorPrefix = authors.some((author) => authorMatches(possibleAuthor, author));
    if (isAuthorPrefix) {
      current = rest.trim();
      changed = true;
    }
  }
  return current;
}

function parseYear(rawTitle: string): number | null {
  const yearMatch =
    rawTitle.match(/\((19|20)\d{2}\)\s*$/u) ??
    rawTitle.match(/(?:\s+|[-:–—]\s*)(19|20)\d{2}\s*$/u);

  if (!yearMatch) return null;
  const yearString = yearMatch[0].match(YEAR_RE)?.[0];
  if (!yearString) return null;
  const year = Number(yearString);
  const currentYear = new Date().getFullYear() + 1;
  if (!Number.isFinite(year) || year < 1400 || year > currentYear) return null;
  return year;
}

function stripYearNoise(title: string): string {
  let cleaned = title;
  cleaned = cleaned.replace(/\s*\((19|20)\d{2}\)\s*$/gu, "").trim();
  cleaned = cleaned.replace(/\s*[-:–—]\s*(19|20)\d{2}\s*$/gu, "").trim();
  cleaned = cleaned.replace(/\s+(19|20)\d{2}\s*$/gu, "").trim();
  cleaned = cleaned.replace(/\s*\(\s*\)\s*$/gu, "").trim();
  return cleaned;
}

function stripTrailingCounter(title: string): string {
  return title.replace(/\s+[0-9]{1,2}\s*$/u, "").trim();
}

function stripDanglingSeparators(title: string): string {
  return title
    .replace(/^\s*[-:–—|]+\s*/u, "")
    .replace(/\s*[-:–—|]+\s*$/u, "")
    .trim();
}

export function cleanupMetadataTitle(metadata: ItemMetadata): CleanupResult {
  const rawTitle = normalizeWhitespace(metadata.title ?? "");
  if (!rawTitle) {
    return { title: metadata.title, publishedYear: metadata.publishedYear, changed: false };
  }

  let cleanedTitle = stripAuthorPrefix(rawTitle, metadata.authors);
  const inferredYear = metadata.publishedYear ?? parseYear(cleanedTitle);
  const hadYearToken = YEAR_RE.test(cleanedTitle);

  cleanedTitle = stripYearNoise(cleanedTitle);
  if (hadYearToken) {
    cleanedTitle = stripTrailingCounter(cleanedTitle);
  }
  cleanedTitle = stripDanglingSeparators(cleanedTitle);

  cleanedTitle = cleanedTitle.replace(/\s{2,}/g, " ").trim();
  const nextTitle = cleanedTitle || metadata.title;
  const changed = nextTitle !== metadata.title || inferredYear !== metadata.publishedYear;

  return {
    title: nextTitle,
    publishedYear: inferredYear,
    changed,
  };
}
