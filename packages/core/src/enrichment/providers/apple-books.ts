import type {
  BookMetadata,
  MetadataProvider,
  MetadataSearchInput,
  ProviderRequestContext,
} from "./types";

const ITUNES_SEARCH_URL = "https://itunes.apple.com/search";
const ITUNES_LOOKUP_URL = "https://itunes.apple.com/lookup";
const DEFAULT_COUNTRY = "US";
const DEFAULT_LIMIT = 5;

type FetchLike = typeof fetch;

type AppleBooksProviderOptions = {
  country?: string;
  limit?: number;
  maxRetries?: number;
  minIntervalMs?: number;
  fetcher?: FetchLike;
};

type AppleSearchResponse = {
  resultCount?: number;
  results?: unknown[];
};

type AppleBookRaw = {
  trackId?: number;
  trackName?: string;
  artistName?: string;
  releaseDate?: string;
  description?: string;
  trackViewUrl?: string;
  artworkUrl100?: string;
  artworkUrl60?: string;
  averageUserRating?: number;
  userRatingCount?: number;
  kind?: string;
};

export class AppleBooksProvider implements MetadataProvider {
  readonly name = "applebooks" as const;

  private readonly country: string;
  private readonly limit: number;
  private readonly maxRetries: number;
  private readonly fetcher: FetchLike;
  private readonly limiter: RateLimiter;

  constructor(options: AppleBooksProviderOptions = {}) {
    this.country = normalizeCountryCode(options.country);
    this.limit = clamp(options.limit ?? DEFAULT_LIMIT, 1, 20);
    this.maxRetries = clamp(options.maxRetries ?? 3, 0, 5);
    this.fetcher = options.fetcher ?? fetch;
    this.limiter = createRateLimiter(options.minIntervalMs ?? 350);
  }

  async search(input: MetadataSearchInput): Promise<BookMetadata[]> {
    if (input.isbn) {
      return this.fetchByIsbn(input.isbn, input);
    }

    const title = normalizeText(input.title);
    const author = normalizeText(input.author);
    if (!title && !author) return [];

    const term = [title, author].filter(Boolean).join(" ");
    const params = new URLSearchParams({
      term,
      media: "ebook",
      entity: "ebook",
      country: normalizeCountryCode(input.country ?? this.country),
      limit: String(clamp(input.limit ?? this.limit, 1, 20)),
    });
    const payload = await this.fetchJsonWithRetry(`${ITUNES_SEARCH_URL}?${params.toString()}`);
    if (!payload) return [];
    return this.normalizeResults(payload.results, {
      queryType: "title_author",
      title,
      author,
    });
  }

  async fetchByIsbn(
    isbn: string,
    input: Omit<MetadataSearchInput, "isbn"> = {}
  ): Promise<BookMetadata[]> {
    const normalized = normalizeIsbn(isbn);
    if (!normalized) return [];

    const params = new URLSearchParams({
      isbn: normalized,
      entity: "ebook",
      country: normalizeCountryCode(input.country ?? this.country),
      limit: String(clamp(input.limit ?? this.limit, 1, 20)),
    });
    const payload = await this.fetchJsonWithRetry(`${ITUNES_LOOKUP_URL}?${params.toString()}`);
    if (!payload) return [];
    return this.normalizeResults(payload.results, {
      queryType: "isbn",
      isbn: normalized,
    });
  }

  getCoverUrl(raw: unknown): string | undefined {
    const book = isAppleBookRaw(raw) ? raw : null;
    if (!book) return undefined;
    const base = normalizeText(book.artworkUrl100) ?? normalizeText(book.artworkUrl60);
    if (!base) return undefined;
    return toHighResArtwork(base);
  }

  normalizeResult(raw: unknown, context: ProviderRequestContext): BookMetadata | null {
    if (!isAppleBookRaw(raw)) return null;
    if (raw.kind && raw.kind !== "ebook") return null;

    const title = normalizeText(raw.trackName);
    const author = normalizeText(raw.artistName);
    if (!title && !author) return null;

    const publishedYear = parseYear(raw.releaseDate);
    const identifiers = context.isbn ? [context.isbn] : undefined;
    const ratingBoost = normalizeRating(raw.averageUserRating, raw.userRatingCount);
    const matchScore =
      context.queryType === "isbn"
        ? 0.98
        : scoreTitleAuthorMatch(title, [author].filter(Boolean) as string[], context.title, context.author);

    const confidence = clamp(0.45 + matchScore * 0.45 + ratingBoost, 0.45, 0.99);
    return {
      title,
      authors: author ? [author] : undefined,
      publishedYear,
      description: normalizeText(raw.description),
      identifiers,
      coverUrl: this.getCoverUrl(raw),
      sourceId: raw.trackId ? String(raw.trackId) : undefined,
      sourceUrl: normalizeText(raw.trackViewUrl),
      source: this.name,
      confidence,
      raw,
    };
  }

  private normalizeResults(
    results: unknown[] | undefined,
    context: ProviderRequestContext
  ): BookMetadata[] {
    if (!Array.isArray(results) || results.length === 0) return [];

    return results
      .map((entry) => this.normalizeResult(entry, context))
      .filter((entry): entry is BookMetadata => Boolean(entry))
      .sort((a, b) => b.confidence - a.confidence)
      .slice(0, this.limit);
  }

  private async fetchJsonWithRetry(url: string): Promise<AppleSearchResponse | null> {
    const jitterMs = 50;
    for (let attempt = 0; attempt <= this.maxRetries; attempt += 1) {
      await this.limiter.wait();
      try {
        const response = await this.fetcher(url, {
          headers: {
            Accept: "application/json",
          },
        });
        if (response.status === 429 || response.status === 503) {
          const retryAfterMs = getRetryAfterMs(response);
          if (attempt < this.maxRetries) {
            await sleep(retryAfterMs ?? Math.min(4000, 500 * (attempt + 1)) + jitterMs);
            continue;
          }
        }

        if (!response.ok) {
          if (response.status >= 500 && attempt < this.maxRetries) {
            await sleep(Math.min(4000, 500 * (attempt + 1)) + jitterMs);
            continue;
          }
          return null;
        }

        const payload = (await response.json()) as AppleSearchResponse;
        if (!Array.isArray(payload.results)) return { results: [] };
        return payload;
      } catch {
        if (attempt >= this.maxRetries) {
          return null;
        }
        await sleep(Math.min(4000, 500 * (attempt + 1)) + jitterMs);
      }
    }
    return null;
  }
}

function normalizeCountryCode(value: string | undefined): string {
  const normalized = normalizeText(value)?.toUpperCase();
  if (!normalized) return DEFAULT_COUNTRY;
  return normalized.slice(0, 2);
}

function normalizeIsbn(value: string): string | null {
  const normalized = value.replace(/[^0-9Xx]/g, "").toUpperCase();
  if (normalized.length === 10 || normalized.length === 13) return normalized;
  return null;
}

function parseYear(value?: string): number | undefined {
  if (!value) return undefined;
  const match = value.match(/\b(\d{4})\b/);
  if (!match) return undefined;
  return Number(match[1]);
}

function normalizeText(value: string | undefined | null): string | undefined {
  const normalized = value?.trim();
  return normalized ? normalized : undefined;
}

function scoreTitleAuthorMatch(
  title: string | undefined,
  authors: string[],
  expectedTitle?: string,
  expectedAuthor?: string
) {
  const titleScore = expectedTitle ? similarity(title ?? "", expectedTitle) : 0.7;
  const authorSource = authors.join(" ");
  const authorScore = expectedAuthor ? similarity(authorSource, expectedAuthor) : 0.7;
  return titleScore * 0.7 + authorScore * 0.3;
}

function normalizeRating(rating?: number, votes?: number): number {
  if (typeof rating !== "number" || Number.isNaN(rating)) return 0;
  const safeVotes = typeof votes === "number" && votes > 0 ? votes : 0;
  const voteWeight = Math.min(1, Math.log10(safeVotes + 1) / 2);
  return clamp((rating / 5) * 0.08 * voteWeight, 0, 0.08);
}

function similarity(a: string, b: string): number {
  const aTokens = tokenize(a);
  const bTokens = tokenize(b);
  if (!aTokens.size || !bTokens.size) return 0.2;
  const intersection = [...aTokens].filter((token) => bTokens.has(token)).length;
  const union = new Set([...aTokens, ...bTokens]).size;
  return intersection / union;
}

function tokenize(value: string): Set<string> {
  return new Set(
    value
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter(Boolean)
  );
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function toHighResArtwork(url: string): string {
  const secure = url.replace(/^http:\/\//, "https://");
  return secure
    .replace(/\/\d+x\d+bb\.(jpg|png)$/i, "/1200x1200bb.$1")
    .replace(/\/source\/\d+x\d+bb\.(jpg|png)$/i, "/source/1200x1200bb.$1");
}

function isAppleBookRaw(value: unknown): value is AppleBookRaw {
  if (!value || typeof value !== "object") return false;
  return "trackName" in value || "artistName" in value || "trackId" in value;
}

function getRetryAfterMs(response: Response): number | null {
  const header = response.headers.get("retry-after");
  if (!header) return null;
  const seconds = Number(header);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);

  const timestamp = Date.parse(header);
  if (Number.isNaN(timestamp)) return null;
  return Math.max(0, timestamp - Date.now());
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

type RateLimiter = {
  wait: () => Promise<void>;
};

function createRateLimiter(minIntervalMs: number): RateLimiter {
  let last = 0;
  return {
    async wait() {
      const now = Date.now();
      const elapsed = now - last;
      if (elapsed < minIntervalMs) {
        await sleep(minIntervalMs - elapsed);
      }
      last = Date.now();
    },
  };
}
