import { randomUUID } from "node:crypto";

import type { FolioDb } from "../db";
import { enrichByIsbn, enrichByTitleAuthor } from "../enrichment";
import {
  parseMetadataChanges,
  parseMetadataProposalPayload,
  type MetadataChanges,
  type MetadataExpectedValues,
  type MetadataProposalPayload,
} from "./metadata";

export {
  metadataChangesSchema,
  parseMetadataChanges,
  type MetadataChanges,
} from "./metadata";

const metadataChangeType = "folio_metadata";
const isbnTypes = ["ISBN10", "ISBN13", "OTHER", "isbn10", "isbn13", "other"];

export type BookRecord = {
  id: string;
  title: string | null;
  authors: string[];
  publishedYear: number | null;
  language: string | null;
  isbn: string | null;
  series: string | null;
  seriesIndex: number | null;
  description: string | null;
  formats: string[];
  fileCount: number;
};

export type MetadataProposalInput = {
  itemId: string;
  changes: MetadataChanges;
  source: string;
  confidence: number;
  reason: string;
  overwrite?: boolean;
};

export type PendingMetadataChange = {
  id: string;
  itemId: string;
  fileId: string;
  type: typeof metadataChangeType;
  changes: MetadataChanges;
  expected: MetadataExpectedValues;
  source: string;
  confidence: number;
  reason: string;
  overwrite: boolean;
  status: "pending" | "applied" | "error";
  createdAt: number;
  appliedAt: number | null;
  error: string | null;
};

export type MissingMetadataBook = BookRecord & {
  missingFields: Array<"title" | "authors" | "isbn">;
};

export type FieldProvenance = {
  field: string;
  source: string;
  confidence: number;
  createdAt: number;
};

export type MetadataChangePreview = {
  change: PendingMetadataChange;
  applicableChanges: MetadataChanges;
  conflicts: Array<keyof MetadataChanges>;
};

export type MetadataSuggestion = {
  itemId: string;
  changes: MetadataChanges;
  source: string;
  confidence: number;
  coverUrl?: string;
  sourceUrl?: string;
};

export type FolioLibrary = {
  searchBooks(input?: { query?: string; limit?: number }): BookRecord[];
  getBook(itemId: string): BookRecord | null;
  findMissingMetadata(input?: { limit?: number }): MissingMetadataBook[];
  suggestMetadata(itemId: string): Promise<MetadataSuggestion[]>;
  proposeMetadataUpdate(input: MetadataProposalInput): PendingMetadataChange;
  listPendingChanges(input?: {
    status?: PendingMetadataChange["status"];
  }): PendingMetadataChange[];
  previewPendingChange(changeId: string): MetadataChangePreview;
  applyPendingChange(changeId: string): PendingMetadataChange;
  getFieldProvenance(itemId: string): FieldProvenance[];
};

type FolioLibraryDependencies = {
  createId?: () => string;
  now?: () => number;
  suggestMetadata?: (book: BookRecord) => Promise<MetadataSuggestion[]>;
};

type PendingChangeRow = {
  id: string;
  file_id: string;
  changes_json: string | null;
  status: PendingMetadataChange["status"];
  created_at: number;
  applied_at: number | null;
  error: string | null;
};

export function createFolioLibrary(
  db: FolioDb,
  dependencies: FolioLibraryDependencies = {},
): FolioLibrary {
  const createId = dependencies.createId ?? randomUUID;
  const now = dependencies.now ?? Date.now;
  const sqlite = db.$client;

  async function suggestMetadata(itemId: string): Promise<MetadataSuggestion[]> {
    const book = getBook(itemId);
    if (!book) throw new Error(`Book not found: ${itemId}`);
    if (dependencies.suggestMetadata) return dependencies.suggestMetadata(book);
    const candidates = book.isbn
      ? await enrichByIsbn(db, itemId, book.isbn)
      : book.title
        ? await enrichByTitleAuthor(db, itemId, book.title, book.authors[0])
        : [];
    return candidates.map((candidate) => {
      const changes: MetadataChanges = {};
      if (candidate.title) changes.title = candidate.title;
      if (candidate.authors?.length) changes.authors = candidate.authors;
      if (candidate.publishedYear) changes.publishedYear = candidate.publishedYear;
      if (candidate.description) changes.description = candidate.description;
      const isbn = candidate.identifiers?.find((value) => value.trim());
      if (isbn) changes.isbn = isbn;
      return {
        itemId,
        changes,
        source: candidate.source,
        confidence: candidate.confidence,
        ...(candidate.coverUrl ? { coverUrl: candidate.coverUrl } : {}),
        ...(candidate.sourceUrl ? { sourceUrl: candidate.sourceUrl } : {}),
      };
    });
  }

  function getBook(itemId: string): BookRecord | null {
    const row = sqlite
      .prepare(
        `SELECT id, title, published_year, language, series, series_index, description
         FROM items
         WHERE id = ?
           AND EXISTS (
             SELECT 1 FROM files WHERE files.item_id = items.id AND files.status = 'active'
           )`,
      )
      .get(itemId) as
      | {
          id: string;
          title: string | null;
          published_year: number | null;
          language: string | null;
          series: string | null;
          series_index: number | null;
          description: string | null;
        }
      | undefined;
    if (!row) return null;

    const authors = sqlite
      .prepare(
        `SELECT authors.name
         FROM item_authors
         JOIN authors ON authors.id = item_authors.author_id
         WHERE item_authors.item_id = ?
         ORDER BY item_authors.ord, authors.name COLLATE NOCASE`,
      )
      .all(itemId) as Array<{ name: string }>;
    const identifier = sqlite
      .prepare(
        `SELECT value
         FROM identifiers
         WHERE item_id = ? AND type IN (${isbnTypes.map(() => "?").join(", ")})
         ORDER BY CASE WHEN upper(type) = 'ISBN13' THEN 0 WHEN upper(type) = 'ISBN10' THEN 1 ELSE 2 END,
                  created_at DESC
         LIMIT 1`,
      )
      .get(itemId, ...isbnTypes) as { value: string } | undefined;
    const fileRows = sqlite
      .prepare(
        `SELECT extension
         FROM files
         WHERE item_id = ? AND status = 'active'
         ORDER BY created_at, id`,
      )
      .all(itemId) as Array<{ extension: string }>;
    const formats = Array.from(
      new Set(
        fileRows
          .map(({ extension }) => extension.replace(/^\./, "").trim().toUpperCase())
          .filter(Boolean),
      ),
    );

    return {
      id: row.id,
      title: row.title,
      authors: authors.map(({ name }) => name),
      publishedYear: row.published_year,
      language: row.language,
      isbn: identifier?.value ?? null,
      series: row.series,
      seriesIndex: row.series_index,
      description: row.description,
      formats,
      fileCount: fileRows.length,
    };
  }

  function searchBooks(input: { query?: string; limit?: number } = {}): BookRecord[] {
    const query = input.query?.trim().toLowerCase() ?? "";
    const limit = normalizeLimit(input.limit, 50);
    const pattern = `%${escapeLike(query)}%`;
    const rows = sqlite
      .prepare(
        `SELECT items.id
         FROM items
         WHERE EXISTS (
           SELECT 1 FROM files WHERE files.item_id = items.id AND files.status = 'active'
         )
           AND (
             ? = ''
             OR lower(COALESCE(items.title, '')) LIKE ? ESCAPE '\\'
             OR EXISTS (
               SELECT 1
               FROM item_authors
               JOIN authors ON authors.id = item_authors.author_id
               WHERE item_authors.item_id = items.id
                 AND lower(authors.name) LIKE ? ESCAPE '\\'
             )
             OR EXISTS (
               SELECT 1 FROM identifiers
               WHERE identifiers.item_id = items.id
                 AND lower(identifiers.value) LIKE ? ESCAPE '\\'
             )
           )
         ORDER BY COALESCE(items.title, '') COLLATE NOCASE, items.id
         LIMIT ?`,
      )
      .all(query, pattern, pattern, pattern, limit) as Array<{ id: string }>;
    return rows.flatMap(({ id }) => {
      const book = getBook(id);
      return book ? [book] : [];
    });
  }

  function findMissingMetadata(
    input: { limit?: number } = {},
  ): MissingMetadataBook[] {
    const limit = normalizeLimit(input.limit, 100);
    const rows = sqlite
      .prepare(
        `SELECT items.id
         FROM items
         WHERE EXISTS (
           SELECT 1 FROM files WHERE files.item_id = items.id AND files.status = 'active'
         )
           AND (
             trim(COALESCE(items.title, '')) = ''
             OR NOT EXISTS (SELECT 1 FROM item_authors WHERE item_authors.item_id = items.id)
             OR NOT EXISTS (
               SELECT 1 FROM identifiers
               WHERE identifiers.item_id = items.id
                 AND identifiers.type IN (${isbnTypes.map(() => "?").join(", ")})
                 AND trim(identifiers.value) != ''
             )
           )
         ORDER BY items.id
         LIMIT ?`,
      )
      .all(...isbnTypes, limit) as Array<{ id: string }>;
    return rows
      .flatMap(({ id }) => {
        const book = getBook(id);
        return book ? [book] : [];
      })
      .map((book) => {
        const missingFields: MissingMetadataBook["missingFields"] = [];
        if (!book.title?.trim()) missingFields.push("title");
        if (!book.authors.length) missingFields.push("authors");
        if (!book.isbn?.trim()) missingFields.push("isbn");
        return { ...book, missingFields };
      })
      .filter(({ missingFields }) => missingFields.length > 0);
  }

  function proposeMetadataUpdate(
    input: MetadataProposalInput,
  ): PendingMetadataChange {
    const book = getBook(input.itemId);
    if (!book) throw new Error(`Book not found: ${input.itemId}`);
    const source = requireText(input.source, "source");
    const reason = requireText(input.reason, "reason");
    if (!Number.isFinite(input.confidence) || input.confidence < 0 || input.confidence > 1) {
      throw new Error("Confidence must be a number between 0 and 1.");
    }
    const overwrite = input.overwrite ?? false;
    const changes = sanitizeChanges(input.changes, book, overwrite);
    if (!Object.keys(changes).length) {
      throw new Error("No safe metadata changes remain after validation.");
    }
    const file = sqlite
      .prepare(
        `SELECT id, path FROM files
         WHERE item_id = ?
         ORDER BY (status = 'active') DESC, created_at, id
         LIMIT 1`,
      )
      .get(input.itemId) as { id: string; path: string } | undefined;
    if (!file) throw new Error(`No file record found for book: ${input.itemId}`);

    const payload: MetadataProposalPayload = {
      version: 1,
      itemId: input.itemId,
      changes,
      expected: expectedValues(book, changes),
      source,
      confidence: input.confidence,
      reason,
      overwrite,
    };
    const changeId = createId();
    sqlite
      .prepare(
        `INSERT INTO pending_changes
           (id, file_id, type, from_path, to_path, changes_json, status, created_at)
         VALUES (?, ?, ?, ?, NULL, ?, 'pending', ?)`,
      )
      .run(changeId, file.id, metadataChangeType, file.path, JSON.stringify(payload), now());
    return getPendingChange(changeId);
  }

  function listPendingChanges(
    input: { status?: PendingMetadataChange["status"] } = {},
  ): PendingMetadataChange[] {
    const status = input.status ?? "pending";
    const rows = sqlite
      .prepare(
        `SELECT id, file_id, changes_json, status, created_at, applied_at, error
         FROM pending_changes
         WHERE type = ? AND status = ?
         ORDER BY created_at DESC, id`,
      )
      .all(metadataChangeType, status) as PendingChangeRow[];
    return rows.map(toPendingMetadataChange);
  }

  function getPendingChange(changeId: string): PendingMetadataChange {
    const row = sqlite
      .prepare(
        `SELECT id, file_id, changes_json, status, created_at, applied_at, error
         FROM pending_changes
         WHERE id = ? AND type = ?`,
      )
      .get(changeId, metadataChangeType) as PendingChangeRow | undefined;
    if (!row) throw new Error(`Metadata change not found: ${changeId}`);
    return toPendingMetadataChange(row);
  }

  function applyPendingChange(changeId: string): PendingMetadataChange {
    const apply = sqlite.transaction(() => {
      const preview = previewPendingChange(changeId);
      const pending = preview.change;
      if (pending.status !== "pending") {
        throw new Error(`Metadata change is not pending: ${changeId}`);
      }
      if (preview.conflicts.length) {
        throw new Error(
          `Metadata changed since this proposal was created: ${preview.conflicts.join(", ")}.`,
        );
      }
      const appliedAt = now();

      for (const [field, value] of Object.entries(preview.applicableChanges) as Array<
        [keyof MetadataChanges, MetadataChanges[keyof MetadataChanges]]
      >) {
        applyMetadataField(pending.itemId, field, value, pending, appliedAt);
      }
      sqlite
        .prepare(
          `UPDATE pending_changes
           SET status = 'applied', applied_at = ?, error = NULL
           WHERE id = ? AND status = 'pending'`,
        )
        .run(appliedAt, changeId);
    });
    apply();
    return getPendingChange(changeId);
  }

  function previewPendingChange(changeId: string): MetadataChangePreview {
    const change = getPendingChange(changeId);
    if (change.status !== "pending") {
      throw new Error(`Metadata change is not pending: ${changeId}`);
    }
    const current = getBook(change.itemId);
    if (!current) throw new Error(`Book not found: ${change.itemId}`);
    const conflicts = (Object.keys(change.expected) as Array<keyof MetadataChanges>).filter(
      (field) => !metadataValuesEqual(current[field], change.expected[field]),
    );
    return {
      change,
      applicableChanges: conflicts.length
        ? {}
        : sanitizeChanges(change.changes, current, change.overwrite),
      conflicts,
    };
  }

  function applyMetadataField(
    itemId: string,
    field: keyof MetadataChanges,
    value: MetadataChanges[keyof MetadataChanges],
    pending: PendingMetadataChange,
    appliedAt: number,
  ) {
    if (field === "authors") {
      const authorNames = value as string[];
      sqlite.prepare("DELETE FROM item_authors WHERE item_id = ?").run(itemId);
      authorNames.forEach((name, index) => {
        const normalizedName = normalizeAuthorName(name);
        const existing = sqlite
          .prepare("SELECT id FROM authors WHERE normalized_name = ? LIMIT 1")
          .get(normalizedName) as { id: string } | undefined;
        const authorId = existing?.id ?? createId();
        if (!existing) {
          sqlite
            .prepare(
              `INSERT INTO authors (id, name, normalized_name, created_at, updated_at)
               VALUES (?, ?, ?, ?, ?)`,
            )
            .run(authorId, name, normalizedName, appliedAt, appliedAt);
        }
        sqlite
          .prepare(
            `INSERT OR IGNORE INTO item_authors (item_id, author_id, role, ord)
             VALUES (?, ?, 'author', ?)`,
          )
          .run(itemId, authorId, index);
      });
    } else if (field === "isbn") {
      sqlite
        .prepare(
          `DELETE FROM identifiers
           WHERE item_id = ? AND type IN (${isbnTypes.map(() => "?").join(", ")})`,
        )
        .run(itemId, ...isbnTypes);
      const isbn = value as string;
      const type = isbn.length === 13 ? "ISBN13" : isbn.length === 10 ? "ISBN10" : "OTHER";
      sqlite
        .prepare(
          `INSERT INTO identifiers
             (id, item_id, type, value, source, confidence, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(createId(), itemId, type, isbn, pending.source, pending.confidence, appliedAt);
    } else {
      const column = scalarColumns[field];
      if (!column) throw new Error(`Unsupported metadata field: ${field}`);
      sqlite
        .prepare(`UPDATE items SET ${column} = ?, updated_at = ? WHERE id = ?`)
        .run(value, appliedAt, itemId);
    }

    sqlite
      .prepare(
        `INSERT INTO item_field_sources
           (id, item_id, field, source, confidence, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(createId(), itemId, fieldToSourceName(field), pending.source, pending.confidence, appliedAt);
  }

  function getFieldProvenance(itemId: string): FieldProvenance[] {
    const rows = sqlite
      .prepare(
        `SELECT field, source, confidence, created_at
         FROM item_field_sources
         WHERE item_id = ?
         ORDER BY created_at, field COLLATE NOCASE, rowid`,
      )
      .all(itemId) as Array<{
      field: string;
      source: string;
      confidence: number;
      created_at: number;
    }>;
    return rows.map((row) => ({
      field: row.field,
      source: row.source,
      confidence: row.confidence,
      createdAt: row.created_at,
    }));
  }

  return {
    searchBooks,
    getBook,
    findMissingMetadata,
    suggestMetadata,
    proposeMetadataUpdate,
    listPendingChanges,
    previewPendingChange,
    applyPendingChange,
    getFieldProvenance,
  };
}

const scalarColumns: Partial<Record<keyof MetadataChanges, string>> = {
  title: "title",
  publishedYear: "published_year",
  language: "language",
  series: "series",
  seriesIndex: "series_index",
  description: "description",
};

function sanitizeChanges(
  requestedInput: MetadataChanges,
  current: BookRecord,
  overwrite: boolean,
): MetadataChanges {
  const requested = parseMetadataChanges(requestedInput);
  const changes: MetadataChanges = {};
  const textFields = ["title", "language", "isbn", "series", "description"] as const;
  for (const field of textFields) {
    const value = requested[field];
    if (value === undefined) continue;
    const cleaned = value.trim();
    if (!cleaned) continue;
    if (!overwrite && hasValue(current[field])) continue;
    changes[field] = cleaned;
  }
  if (requested.authors !== undefined) {
    const authors = Array.from(
      new Map(
        requested.authors
          .map((name) => name.trim())
          .filter(Boolean)
          .filter((name) => Boolean(normalizeAuthorName(name)))
          .map((name) => [normalizeAuthorName(name), name]),
      ).values(),
    );
    if (authors.length && (overwrite || !current.authors.length)) changes.authors = authors;
  }
  if (requested.publishedYear !== undefined) {
    if (!Number.isInteger(requested.publishedYear) || requested.publishedYear < 1000 || requested.publishedYear > 9999) {
      throw new Error("Published year must be a four-digit year.");
    }
    if (overwrite || current.publishedYear === null) changes.publishedYear = requested.publishedYear;
  }
  if (requested.seriesIndex !== undefined) {
    if (!Number.isFinite(requested.seriesIndex) || requested.seriesIndex <= 0) {
      throw new Error("Series index must be a positive number.");
    }
    if (overwrite || current.seriesIndex === null) changes.seriesIndex = requested.seriesIndex;
  }
  return changes;
}

function toPendingMetadataChange(row: PendingChangeRow): PendingMetadataChange {
  if (!row.changes_json) throw new Error(`Metadata change has no payload: ${row.id}`);
  let rawPayload: unknown;
  try {
    rawPayload = JSON.parse(row.changes_json);
  } catch {
    throw new Error(`Invalid metadata proposal ${row.id}: payload is not valid JSON.`);
  }
  const payload = parseMetadataProposalPayload(rawPayload, row.id);
  return {
    id: row.id,
    itemId: payload.itemId,
    fileId: row.file_id,
    type: metadataChangeType,
    changes: payload.changes,
    expected: payload.expected,
    source: payload.source,
    confidence: payload.confidence,
    reason: payload.reason,
    overwrite: payload.overwrite,
    status: row.status,
    createdAt: row.created_at,
    appliedAt: row.applied_at,
    error: row.error,
  };
}

function normalizeLimit(value: number | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  if (!Number.isInteger(value) || value < 1) throw new Error("Limit must be a positive integer.");
  return Math.min(value, 500);
}

function requireText(value: string, field: string): string {
  const cleaned = value.trim();
  if (!cleaned) throw new Error(`${field} cannot be empty.`);
  return cleaned;
}

function hasValue(value: unknown): boolean {
  if (typeof value === "string") return Boolean(value.trim());
  return value !== null && value !== undefined;
}

function normalizeAuthorName(value: string): string {
  return value
    .trim()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .toLowerCase();
}

function fieldToSourceName(field: keyof MetadataChanges): string {
  if (field === "publishedYear") return "published_year";
  if (field === "seriesIndex") return "series_index";
  return field;
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, "\\$&");
}

function expectedValues(
  book: BookRecord,
  changes: MetadataChanges,
): MetadataExpectedValues {
  return Object.fromEntries(
    (Object.keys(changes) as Array<keyof MetadataChanges>).map((field) => [field, book[field]]),
  ) as MetadataExpectedValues;
}

function metadataValuesEqual(left: unknown, right: unknown): boolean {
  if (Array.isArray(left) || Array.isArray(right)) {
    return Array.isArray(left) && Array.isArray(right) && JSON.stringify(left) === JSON.stringify(right);
  }
  return left === right;
}
