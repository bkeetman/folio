import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createDb, type FolioDb } from "../db";
import { createFolioLibrary } from "./index";

const fixedNow = 1_700_000_000_000;

test("searches and reads books through the shared Folio interface", () => {
  using fixture = createFixture();
  fixture.seedBook({
    id: "book-dune",
    title: "Dune",
    authors: ["Frank Herbert"],
    isbn: "9780441172719",
  });
  fixture.seedBook({ id: "book-earthsea", title: "A Wizard of Earthsea" });

  const folio = createFolioLibrary(fixture.db);
  const results = folio.searchBooks({ query: "herbert", limit: 10 });

  assert.equal(results.length, 1);
  assert.deepEqual(results[0], {
    id: "book-dune",
    title: "Dune",
    authors: ["Frank Herbert"],
    publishedYear: null,
    language: null,
    isbn: "9780441172719",
    series: null,
    seriesIndex: null,
    description: null,
    formats: ["EPUB"],
    fileCount: 1,
  });
  assert.deepEqual(folio.getBook("book-dune"), results[0]);
});

test("proposes metadata without overwriting populated fields by default", () => {
  using fixture = createFixture();
  fixture.seedBook({ id: "book-dune", title: "Dune" });
  const folio = createFolioLibrary(fixture.db, {
    createId: () => "change-1",
    now: () => fixedNow,
  });

  const proposal = folio.proposeMetadataUpdate({
    itemId: "book-dune",
    changes: {
      title: "Dune Messiah",
      authors: ["Frank Herbert"],
      language: "en",
    },
    source: "ai:example-model",
    confidence: 0.82,
    reason: "Matched against a cited catalogue record.",
  });

  assert.equal(proposal.id, "change-1");
  assert.deepEqual(proposal.changes, {
    authors: ["Frank Herbert"],
    language: "en",
  });
  assert.equal(proposal.status, "pending");
  assert.equal(folio.getBook("book-dune")?.title, "Dune");
  assert.deepEqual(folio.listPendingChanges(), [proposal]);
});

test("rejects invalid metadata proposal fields with an actionable message", () => {
  using fixture = createFixture();
  fixture.seedBook({ id: "book-dune", title: "Dune" });
  const folio = createFolioLibrary(fixture.db);

  assert.throws(
    () =>
      folio.proposeMetadataUpdate({
        itemId: "book-dune",
        changes: { authors: 42 } as unknown as { authors: string[] },
        source: "ai:example-model",
        confidence: 0.8,
        reason: "Test invalid input.",
      }),
    /Invalid metadata changes: authors: Expected array, received number/,
  );
});

test("applies a proposed metadata change transactionally with provenance", () => {
  using fixture = createFixture();
  fixture.seedBook({ id: "book-dune", title: "Dune" });
  const folio = createFolioLibrary(fixture.db, {
    createId: (() => {
      const ids = ["change-1", "author-1", "field-1", "field-2"];
      return () => ids.shift() ?? randomUUID();
    })(),
    now: () => fixedNow,
  });
  const proposal = folio.proposeMetadataUpdate({
    itemId: "book-dune",
    changes: { authors: ["Frank Herbert"], language: "en" },
    source: "ai:example-model",
    confidence: 0.82,
    reason: "Matched against a cited catalogue record.",
  });

  const applied = folio.applyPendingChange(proposal.id);

  assert.equal(applied.status, "applied");
  assert.equal(applied.appliedAt, fixedNow);
  assert.throws(
    () => folio.previewPendingChange(proposal.id),
    /Metadata change is not pending: change-1/,
  );
  assert.deepEqual(folio.getBook("book-dune")?.authors, ["Frank Herbert"]);
  assert.equal(folio.getBook("book-dune")?.language, "en");
  assert.deepEqual(folio.listPendingChanges(), []);
  assert.deepEqual(folio.listPendingChanges({ status: "applied" }), [applied]);
  assert.deepEqual(folio.getFieldProvenance("book-dune"), [
    {
      field: "authors",
      source: "ai:example-model",
      confidence: 0.82,
      createdAt: fixedNow,
    },
    {
      field: "language",
      source: "ai:example-model",
      confidence: 0.82,
      createdAt: fixedNow,
    },
  ]);
});

test("preview and apply reject a proposal when reviewed metadata changed", () => {
  using fixture = createFixture();
  fixture.seedBook({ id: "book-dune", title: "Dune" });
  const folio = createFolioLibrary(fixture.db, {
    createId: () => "change-1",
    now: () => fixedNow,
  });
  const proposal = folio.proposeMetadataUpdate({
    itemId: "book-dune",
    changes: { title: "Dune Messiah" },
    source: "ai:example-model",
    confidence: 0.8,
    reason: "A deliberately conflicting proposal.",
    overwrite: true,
  });
  fixture.db.$client
    .prepare("UPDATE items SET title = 'Dune (manually reviewed)' WHERE id = 'book-dune'")
    .run();

  const preview = folio.previewPendingChange(proposal.id);

  assert.deepEqual(preview.applicableChanges, {});
  assert.deepEqual(preview.conflicts, ["title"]);
  assert.throws(
    () => folio.applyPendingChange(proposal.id),
    /Metadata changed since this proposal was created: title/,
  );
  assert.equal(folio.getBook("book-dune")?.title, "Dune (manually reviewed)");
  assert.equal(folio.listPendingChanges()[0]?.status, "pending");
});

test("finds books whose canonical metadata is incomplete", () => {
  using fixture = createFixture();
  fixture.seedBook({ id: "complete", title: "Dune", authors: ["Frank Herbert"], isbn: "9780441172719" });
  fixture.seedBook({ id: "missing-author", title: "Neuromancer", isbn: "9780441569595" });
  fixture.seedBook({ id: "missing-title", authors: ["Ursula K. Le Guin"] });

  const folio = createFolioLibrary(fixture.db);

  assert.deepEqual(
    folio.findMissingMetadata({ limit: 10 }).map(({ id, missingFields }) => ({ id, missingFields })),
    [
      { id: "missing-author", missingFields: ["authors"] },
      { id: "missing-title", missingFields: ["title", "isbn"] },
    ],
  );
});

test("applies the missing-metadata limit after excluding complete books", () => {
  using fixture = createFixture();
  fixture.seedBook({ id: "complete-first", title: "A Book", authors: ["An Author"], isbn: "9780000000001" });
  fixture.seedBook({ id: "missing-later", title: "Z Book", isbn: "9780000000002" });

  const folio = createFolioLibrary(fixture.db);

  assert.deepEqual(
    folio.findMissingMetadata({ limit: 1 }).map(({ id }) => id),
    ["missing-later"],
  );
});

test("returns enrichment suggestions without applying them", async () => {
  using fixture = createFixture();
  fixture.seedBook({ id: "book-dune", title: "Dune", authors: ["Frank Herbert"] });
  const folio = createFolioLibrary(fixture.db, {
    suggestMetadata: async (book) => [
      {
        itemId: book.id,
        changes: { publishedYear: 1965, language: "en" },
        source: "openlibrary",
        confidence: 0.91,
        sourceUrl: "https://openlibrary.org/example",
      },
    ],
  });

  const suggestions = await folio.suggestMetadata("book-dune");

  assert.deepEqual(suggestions, [
    {
      itemId: "book-dune",
      changes: { publishedYear: 1965, language: "en" },
      source: "openlibrary",
      confidence: 0.91,
      sourceUrl: "https://openlibrary.org/example",
    },
  ]);
  assert.equal(folio.getBook("book-dune")?.publishedYear, null);
});

type SeedBook = {
  id: string;
  title?: string;
  authors?: string[];
  isbn?: string;
};

function createFixture() {
  const directory = mkdtempSync(path.join(os.tmpdir(), "folio-library-test-"));
  const db = createDb(path.join(directory, "folio.db"));
  db.$client.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE items (
      id TEXT PRIMARY KEY NOT NULL,
      title TEXT,
      subtitle TEXT,
      description TEXT,
      language TEXT,
      published_year INTEGER,
      series TEXT,
      series_index REAL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE files (
      id TEXT PRIMARY KEY NOT NULL,
      item_id TEXT REFERENCES items(id),
      path TEXT NOT NULL,
      filename TEXT NOT NULL,
      extension TEXT NOT NULL,
      mime_type TEXT,
      size_bytes INTEGER,
      sha256 TEXT,
      hash_algo TEXT DEFAULT 'sha256',
      modified_at INTEGER,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      status TEXT DEFAULT 'active'
    );
    CREATE TABLE authors (
      id TEXT PRIMARY KEY NOT NULL,
      name TEXT NOT NULL,
      normalized_name TEXT,
      sort_name TEXT,
      bio TEXT,
      photo_url TEXT,
      metadata_source TEXT,
      metadata_source_id TEXT,
      metadata_updated_at INTEGER,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE UNIQUE INDEX authors_normalized_name ON authors(normalized_name);
    CREATE TABLE item_authors (
      item_id TEXT NOT NULL REFERENCES items(id),
      author_id TEXT NOT NULL REFERENCES authors(id),
      role TEXT DEFAULT 'author',
      ord INTEGER DEFAULT 0,
      PRIMARY KEY(item_id, author_id, role)
    );
    CREATE TABLE identifiers (
      id TEXT PRIMARY KEY NOT NULL,
      item_id TEXT NOT NULL REFERENCES items(id),
      type TEXT NOT NULL,
      value TEXT NOT NULL,
      source TEXT,
      confidence REAL DEFAULT 0,
      created_at INTEGER NOT NULL
    );
    CREATE UNIQUE INDEX identifiers_type_value ON identifiers(type, value);
    CREATE TABLE item_field_sources (
      id TEXT PRIMARY KEY NOT NULL,
      item_id TEXT NOT NULL REFERENCES items(id),
      field TEXT NOT NULL,
      source TEXT NOT NULL,
      confidence REAL DEFAULT 0,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE pending_changes (
      id TEXT PRIMARY KEY NOT NULL,
      file_id TEXT NOT NULL REFERENCES files(id),
      type TEXT NOT NULL,
      from_path TEXT,
      to_path TEXT,
      changes_json TEXT,
      status TEXT DEFAULT 'pending',
      created_at INTEGER NOT NULL,
      applied_at INTEGER,
      error TEXT
    );
  `);

  const seedBook = ({ id, title, authors = [], isbn }: SeedBook) => {
    db.$client.prepare(
      "INSERT INTO items (id, title, created_at, updated_at) VALUES (?, ?, ?, ?)",
    ).run(id, title ?? null, fixedNow, fixedNow);
    db.$client.prepare(
      "INSERT INTO files (id, item_id, path, filename, extension, created_at, updated_at, status) VALUES (?, ?, ?, ?, ?, ?, ?, 'active')",
    ).run(`file-${id}`, id, `/books/${id}.epub`, `${id}.epub`, ".epub", fixedNow, fixedNow);
    authors.forEach((name, index) => {
      const authorId = `author-${id}-${index}`;
      db.$client.prepare(
        "INSERT INTO authors (id, name, normalized_name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
      ).run(authorId, name, name.toLowerCase(), fixedNow, fixedNow);
      db.$client.prepare(
        "INSERT INTO item_authors (item_id, author_id, role, ord) VALUES (?, ?, 'author', ?)",
      ).run(id, authorId, index);
    });
    if (isbn) {
      db.$client.prepare(
        "INSERT INTO identifiers (id, item_id, type, value, source, confidence, created_at) VALUES (?, ?, 'ISBN13', ?, 'fixture', 1, ?)",
      ).run(`isbn-${id}`, id, isbn, fixedNow);
    }
  };

  return {
    db,
    seedBook,
    [Symbol.dispose]() {
      db.$client.close();
      rmSync(directory, { force: true, recursive: true });
    },
  } satisfies { db: FolioDb; seedBook: (book: SeedBook) => void; [Symbol.dispose](): void };
}
