import { randomUUID } from "crypto";
import { and, eq, gte } from "drizzle-orm";
import type { FolioDb } from "../db";
import {
  authors,
  enrichmentResults,
  enrichmentSources,
  identifiers,
  itemAuthors,
  itemFieldSources,
  items,
} from "../db/schema";
import { AppleBooksProvider } from "./providers";
export * from "./providers";

type EnrichmentSourceName = "openlibrary" | "googlebooks" | "applebooks";

type EnrichedCandidate = {
  title?: string;
  authors?: string[];
  publishedYear?: number;
  description?: string;
  coverUrl?: string;
  sourceUrl?: string;
  identifiers?: string[];
  source: EnrichmentSourceName;
  confidence: number;
  raw: unknown;
};

const cacheTtlMs = 1000 * 60 * 60 * 24 * 30;

const rateLimiters: Record<EnrichmentSourceName, RateLimiter> = {
  openlibrary: createRateLimiter(1000),
  googlebooks: createRateLimiter(250),
  applebooks: createRateLimiter(250),
};

const appleBooksProvider = new AppleBooksProvider();

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
  results.push(...toCandidateArray(openLibrary));

  const google = await fetchWithCache(
    db,
    itemId,
    "googlebooks",
    `isbn:${isbn}`,
    () => fetchGoogleBooksIsbn(isbn)
  );
  results.push(...toCandidateArray(google));

  const apple = await fetchWithCache(
    db,
    itemId,
    "applebooks",
    `isbn:${isbn}`,
    () => fetchAppleBooksIsbn(isbn)
  );
  results.push(...toCandidateArray(apple));

  return results;
}

export async function enrichByTitleAuthor(
  db: FolioDb,
  itemId: string,
  title: string,
  author?: string
): Promise<EnrichedCandidate[]> {
  const queryKey = `title:${title}|author:${author ?? ""}`;
  const openLibrary = await fetchWithCache(
    db,
    itemId,
    "openlibrary",
    queryKey,
    () => fetchOpenLibrarySearch(title, author)
  );

  const google = await fetchWithCache(
    db,
    itemId,
    "googlebooks",
    queryKey,
    () => fetchGoogleBooksSearch(title, author)
  );

  const apple = await fetchWithCache(
    db,
    itemId,
    "applebooks",
    queryKey,
    () => fetchAppleBooksSearch(title, author)
  );

  const candidates = [
    ...toCandidateArray(openLibrary),
    ...toCandidateArray(google),
    ...toCandidateArray(apple),
  ];
  return candidates
    .map((candidate) => {
      const score = scoreCandidate(candidate, title, author);
      return {
        ...candidate,
        confidence: Math.min(0.95, candidate.confidence * score),
      };
    })
    .filter((candidate) => candidate.confidence >= 0.45)
    .sort((a, b) => b.confidence - a.confidence);
}

export function applyEnrichmentCandidate(
  db: FolioDb,
  itemId: string,
  candidate: EnrichedCandidate
) {
  const now = Date.now();
  const item = db.select().from(items).where(eq(items.id, itemId)).get();
  if (!item) return;

  const updates: Partial<typeof items.$inferInsert> = {};
  if (!item.title && candidate.title) updates.title = candidate.title;
  if (!item.publishedYear && candidate.publishedYear)
    updates.publishedYear = candidate.publishedYear;
  if (!item.description && candidate.description)
    updates.description = candidate.description;
  if (Object.keys(updates).length) {
    updates.updatedAt = now;
    db.update(items).set(updates).where(eq(items.id, itemId));
    if (updates.title) {
      db.insert(itemFieldSources).values({
        id: randomUUID(),
        itemId,
        field: "title",
        source: candidate.source,
        confidence: candidate.confidence,
        createdAt: now,
      });
    }
    if (updates.publishedYear) {
      db.insert(itemFieldSources).values({
        id: randomUUID(),
        itemId,
        field: "published_year",
        source: candidate.source,
        confidence: candidate.confidence,
        createdAt: now,
      });
    }
    if (updates.description) {
      db.insert(itemFieldSources).values({
        id: randomUUID(),
        itemId,
        field: "description",
        source: candidate.source,
        confidence: candidate.confidence,
        createdAt: now,
      });
    }
  }

  if (candidate.authors?.length) {
    for (const name of candidate.authors) {
      const existing = db
        .select()
        .from(authors)
        .where(eq(authors.name, name))
        .get();
      const authorId = existing?.id ?? randomUUID();
      if (!existing) {
        db.insert(authors).values({
          id: authorId,
          name,
          createdAt: now,
          updatedAt: now,
        });
      }
      db
        .insert(itemAuthors)
        .values({ itemId, authorId, role: "author", ord: 0 })
        .onConflictDoNothing();
    }
  }

  if (candidate.identifiers?.length) {
    for (const raw of candidate.identifiers) {
      if (!raw) continue;
      db
        .insert(identifiers)
        .values({
          id: randomUUID(),
          itemId,
          type: raw.length === 10 ? "ISBN10" : raw.length === 13 ? "ISBN13" : "OTHER",
          value: raw,
          source: candidate.source,
          confidence: candidate.confidence,
          createdAt: now,
        })
        .onConflictDoNothing();
    }
  }
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

async function fetchOpenLibrarySearch(
  title: string,
  author?: string
): Promise<EnrichedCandidate[] | null> {
  await rateLimiters.openlibrary.wait();
  const params = new URLSearchParams({
    title,
  });
  if (author) params.set("author", author);
  const response = await fetch(`https://openlibrary.org/search.json?${params}`);
  if (!response.ok) return null;
  const data = await response.json();
  const docs = Array.isArray(data?.docs) ? data.docs : [];
  return docs.slice(0, 5).map((doc: any, index: number) => {
    const confidence = 0.7 - index * 0.05;
    return {
      title: doc.title,
      authors: doc.author_name,
      publishedYear: doc.first_publish_year,
      identifiers: doc.isbn,
      source: "openlibrary",
      confidence,
      raw: doc,
    } as EnrichedCandidate;
  });
}

async function fetchGoogleBooksSearch(
  title: string,
  author?: string
): Promise<EnrichedCandidate[] | null> {
  await rateLimiters.googlebooks.wait();
  const terms = [`intitle:${title}`];
  if (author) terms.push(`inauthor:${author}`);
  const response = await fetch(
    `https://www.googleapis.com/books/v1/volumes?q=${encodeURIComponent(
      terms.join("+")
    )}`
  );
  if (!response.ok) return null;
  const data = await response.json();
  const items = Array.isArray(data?.items) ? data.items : [];
  return items.slice(0, 5).map((item: any, index: number) => {
    const info = item.volumeInfo ?? {};
    const confidence = 0.75 - index * 0.05;
    return {
      title: info.title,
      authors: info.authors,
      publishedYear: parseYear(info.publishedDate),
      identifiers: info.industryIdentifiers?.map((id: any) => id.identifier),
      source: "googlebooks",
      confidence,
      raw: item,
    } as EnrichedCandidate;
  });
}

async function fetchAppleBooksIsbn(
  isbn: string
): Promise<EnrichedCandidate[] | null> {
  await rateLimiters.applebooks.wait();
  const results = await appleBooksProvider.fetchByIsbn(isbn);
  return mapAppleBooks(results);
}

async function fetchAppleBooksSearch(
  title: string,
  author?: string
): Promise<EnrichedCandidate[] | null> {
  await rateLimiters.applebooks.wait();
  const results = await appleBooksProvider.search({ title, author });
  return mapAppleBooks(results);
}

function mapAppleBooks(
  results: Awaited<ReturnType<AppleBooksProvider["search"]>>
): EnrichedCandidate[] | null {
  if (!results.length) return null;
  return results.slice(0, 5).map((entry, index) => ({
    title: entry.title,
    authors: entry.authors,
    publishedYear: entry.publishedYear,
    description: entry.description,
    coverUrl: entry.coverUrl,
    sourceUrl: entry.sourceUrl,
    identifiers: entry.identifiers,
    source: "applebooks",
    confidence: clampConfidence(entry.confidence - index * 0.03),
    raw: entry.raw,
  }));
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
    rateLimitPerMin:
      name === "openlibrary" ? 60 : name === "googlebooks" ? 240 : 170,
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

function scoreCandidate(
  candidate: EnrichedCandidate,
  title: string,
  author?: string
) {
  const titleScore = similarity(candidate.title ?? "", title);
  const authorScore = author
    ? similarity((candidate.authors ?? []).join(" "), author)
    : 1;
  return Math.max(0.2, titleScore * 0.7 + authorScore * 0.3);
}

function similarity(a: string, b: string) {
  const aTokens = tokenize(a);
  const bTokens = tokenize(b);
  if (!aTokens.size || !bTokens.size) return 0.2;
  const intersection = [...aTokens].filter((token) => bTokens.has(token)).length;
  const union = new Set([...aTokens, ...bTokens]).size;
  return intersection / union;
}

function tokenize(value: string) {
  return new Set(
    value
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter(Boolean)
  );
}

function clampConfidence(value: number) {
  return Math.min(0.99, Math.max(0.2, value));
}

function toCandidateArray(
  value: EnrichedCandidate | EnrichedCandidate[] | null
): EnrichedCandidate[] {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
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
