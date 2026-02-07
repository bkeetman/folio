# Apple Books Metadata Provider (Folio)

## 1) Apple iTunes Search API overview

### Endpoints
- Search: `https://itunes.apple.com/search`
- Lookup: `https://itunes.apple.com/lookup`

### Query patterns
- ISBN lookup:
```text
https://itunes.apple.com/lookup?isbn=9780316069359&entity=ebook&country=US
```
- Title + author search:
```text
https://itunes.apple.com/search?term=clean+code+robert+martin&media=ebook&entity=ebook&country=US&limit=5
```

### Relevant response fields for ebooks
- `trackName` (title)
- `artistName` (author/publisher display)
- `releaseDate` (publication date source for year)
- `description`
- `artworkUrl60`, `artworkUrl100` (cover URLs; can be upscaled by replacing size segment)
- `trackViewUrl` (Apple Books page)
- `trackId` (stable source id)
- `averageUserRating`, `userRatingCount` (optional confidence signal)
- `genres`, `genreIds` (optional categorization input)

### Rate limits and best practices
- Apple’s docs describe search calls as roughly **~20 requests/minute** guidance (subject to change).
- Use local throttling + retries on `429` and transient `5xx`.
- Cache query results (Folio already caches `enrichment_results`).
- Keep `limit` low (`5` is usually enough for merge workflows).

### Quirks
- Country-specific catalog: `country=US` and `country=NL` can return different books, prices, and covers.
- Missing fields are common (`description`, ratings, and sometimes sparse author strings).
- ISBN lookup may return no result even when title search returns candidates.
- Cover URLs are usually `.../100x100bb.jpg`; higher sizes are typically available by replacing with `1200x1200bb.jpg`.
- No API key required.

References:
- [Apple Search API docs](https://performance-partners.apple.com/resources/documentation/itunes-store-web-service-search-api/)
- [Apple Lookup API docs](https://performance-partners.apple.com/resources/documentation/itunes-store-web-service-search-api/#lookup)

## 2) MetadataProvider interface (TypeScript)

Source file: `packages/core/src/enrichment/providers/types.ts`

```ts
export type MetadataProvider = {
  readonly name: MetadataSourceName;
  search: (input: MetadataSearchInput) => Promise<BookMetadata[]>;
  fetchByIsbn: (isbn: string, input?: Omit<MetadataSearchInput, "isbn">) => Promise<BookMetadata[]>;
  getCoverUrl: (raw: unknown) => string | undefined;
  normalizeResult: (raw: unknown, context: ProviderRequestContext) => BookMetadata | null;
};
```

## 3) AppleBooksProvider implementation (TypeScript)

Source file: `packages/core/src/enrichment/providers/apple-books.ts`

Implemented features:
- `search({ title, author })` via iTunes Search endpoint.
- `fetchByIsbn(isbn)` via iTunes Lookup endpoint.
- normalization to common `BookMetadata`.
- high-res cover URL extraction (`100x100bb` -> `1200x1200bb`).
- empty result handling.
- retry logic for `429`, `503`, and transient network errors.
- request throttling via internal rate limiter.

## 4) Sample usage: call provider + merge with other providers

```ts
import {
  AppleBooksProvider,
  mergeProviderResults,
  scoreWithProviderWeight,
  type BookMetadata,
} from "@folio/core";

const apple = new AppleBooksProvider({ country: "US" });

async function fetchMergedMetadata(input: { isbn?: string; title?: string; author?: string }) {
  const appleResults = input.isbn
    ? await apple.fetchByIsbn(input.isbn)
    : await apple.search({ title: input.title, author: input.author, limit: 5 });

  // Replace these with your existing Open Library / Google / bol.com adapters.
  const openLibraryResults: BookMetadata[] = [];
  const googleBooksResults: BookMetadata[] = [];
  const bolResults: BookMetadata[] = [];

  const all = [...appleResults, ...openLibraryResults, ...googleBooksResults, ...bolResults];
  const ranked = scoreWithProviderWeight(all);
  const merged = mergeProviderResults(all);

  return { merged, ranked };
}
```

## 5) Fallback and conflict strategy

### Fallback order
1. Apple Books
2. Google Books
3. Open Library
4. bol.com

If provider result has no title + no author + no cover, skip it immediately.

### Conflict resolution
- Rank by `weightedConfidence = providerConfidence * providerWeight`.
- Field strategy:
  - `title`, `publishedYear`, `sourceUrl`: take top-ranked candidate.
  - `authors`: take top-ranked non-empty.
  - `coverUrl`: prefer highest inferred image resolution, then confidence.
  - `identifiers`: union + dedupe across providers.
  - `description`: prefer longest non-empty text.

This is implemented in `packages/core/src/enrichment/providers/merge.ts`.

## 6) Tests

Source file: `packages/core/src/enrichment/providers/apple-books.test.ts`

Covered:
- normalization/parsing + high-res cover upgrade.
- empty API response handling.
- mocked rate-limit retry (`429` + `retry-after`).

Run:
```bash
pnpm -C packages/core exec tsx --test src/enrichment/providers/apple-books.test.ts
```

## 7) Integration plan for Folio

### File placement
- `packages/core/src/enrichment/providers/types.ts`
- `packages/core/src/enrichment/providers/apple-books.ts`
- `packages/core/src/enrichment/providers/merge.ts`
- `packages/core/src/enrichment/providers/index.ts`
- wired into: `packages/core/src/enrichment/index.ts`

### Settings/configuration
- No Apple API key needed.
- Set country in provider constructor:
```ts
new AppleBooksProvider({ country: "US" });
```
- Optional knobs:
  - `limit`
  - `maxRetries`
  - `minIntervalMs`

### Environment/setup
- No extra env var required.
- Optional app-level setting recommendation: add metadata country in Folio settings UI and pass it into `AppleBooksProvider`.
