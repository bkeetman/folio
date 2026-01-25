import { randomUUID } from "crypto";
import { and, eq, gte } from "drizzle-orm";
import type { FolioDb } from "../db";
import { enrichmentResults, enrichmentSources } from "../db/schema";

type EnrichmentSourceName = "openlibrary" | "googlebooks";

type EnrichedCandidate = {
  title?: string;
  authors?: string[];
  publishedYear?: number;
  identifiers?: string[];
  source: EnrichmentSourceName;
  confidence: number;
  raw: unknown;
};

const cacheTtlMs = 1000 * 60 * 60 * 24 * 30;

const rateLimiters: Record<EnrichmentSourceName, RateLimiter> = {
  openlibrary: createRateLimiter(1000),
  googlebooks: createRateLimiter(250),
};

export async function enrichByIsbn(
  db: FolioDb,
  itemId: string,
  isbn: string
): Promise<EnrichedCandidate[]> {
  const results: EnrichedCandidate[] = [];
  const openLibrary = await fetchWithCache(
    db,
    itemId,
    "openlibrary",
    `isbn:${isbn}`,
    () => fetchOpenLibraryIsbn(isbn)
  );
  if (openLibrary) results.push(openLibrary);

  const google = await fetchWithCache(
    db,
    itemId,
    "googlebooks",
    `isbn:${isbn}`,
    () => fetchGoogleBooksIsbn(isbn)
  );
  if (google) results.push(...google);

  return results;
}

async function fetchWithCache(
  db: FolioDb,
  itemId: string,
  source: EnrichmentSourceName,
  query: string,
  fetcher: () => Promise<EnrichedCandidate | EnrichedCandidate[] | null>
) {
  const sourceId = await getOrCreateSource(db, source);
  const since = Date.now() - cacheTtlMs;
  const cached = db
    .select()
    .from(enrichmentResults)
    .where(
      and(
        eq(enrichmentResults.sourceId, sourceId),
        eq(enrichmentResults.query, query),
        gte(enrichmentResults.createdAt, since)
      )
    )
    .all();

  if (cached.length) {
    return cached
      .map((row) => ({
        ...JSON.parse(row.responseJson),
        source,
        confidence: row.confidence ?? 0,
      }))
      .flat();
  }

  const result = await fetcher();
  if (!result) return null;
  const results = Array.isArray(result) ? result : [result];
  for (const entry of results) {
    db.insert(enrichmentResults).values({
      id: randomUUID(),
      itemId,
      sourceId,
      queryType: query.startsWith("isbn:") ? "isbn" : "title_author",
      query,
      responseJson: JSON.stringify(entry),
      confidence: entry.confidence,
      createdAt: Date.now(),
    });
  }

  return results;
}

async function fetchOpenLibraryIsbn(isbn: string): Promise<EnrichedCandidate | null> {
  await rateLimiters.openlibrary.wait();
  const response = await fetch(`https://openlibrary.org/isbn/${isbn}.json`);
  if (!response.ok) return null;
  const data = await response.json();
  const authors = await fetchOpenLibraryAuthors(data?.authors ?? []);
  return {
    title: data?.title,
    authors,
    publishedYear: parseYear(data?.publish_date),
    identifiers: [isbn],
    source: "openlibrary",
    confidence: 0.9,
    raw: data,
  };
}

async function fetchOpenLibraryAuthors(
  authors: Array<{ key: string }>
): Promise<string[]> {
  const names: string[] = [];
  for (const author of authors.slice(0, 3)) {
    await rateLimiters.openlibrary.wait();
    const response = await fetch(`https://openlibrary.org${author.key}.json`);
    if (!response.ok) continue;
    const data = await response.json();
    if (data?.name) names.push(data.name);
  }
  return names;
}

async function fetchGoogleBooksIsbn(
  isbn: string
): Promise<EnrichedCandidate[] | null> {
  await rateLimiters.googlebooks.wait();
  const response = await fetch(
    `https://www.googleapis.com/books/v1/volumes?q=isbn:${isbn}`
  );
  if (!response.ok) return null;
  const data = await response.json();
  const items = Array.isArray(data?.items) ? data.items : [];
  return items.slice(0, 5).map((item: any, index: number) => {
    const info = item.volumeInfo ?? {};
    return {
      title: info.title,
      authors: info.authors,
      publishedYear: parseYear(info.publishedDate),
      identifiers: info.industryIdentifiers?.map((id: any) => id.identifier),
      source: "googlebooks",
      confidence: index === 0 ? 0.85 : 0.7,
      raw: item,
    } as EnrichedCandidate;
  });
}

async function getOrCreateSource(db: FolioDb, name: EnrichmentSourceName) {
  const existing = db
    .select()
    .from(enrichmentSources)
    .where(eq(enrichmentSources.name, name))
    .get();
  if (existing) return existing.id;

  const id = randomUUID();
  db.insert(enrichmentSources).values({
    id,
    name,
    rateLimitPerMin: name === "openlibrary" ? 60 : 240,
    createdAt: Date.now(),
  });
  return id;
}

function parseYear(value?: string) {
  if (!value) return undefined;
  const match = value.match(/\b(\d{4})\b/);
  if (!match) return undefined;
  return Number(match[1]);
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
        await new Promise((resolve) => setTimeout(resolve, minIntervalMs - elapsed));
      }
      last = Date.now();
    },
  };
}
