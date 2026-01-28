import {
  integer,
  real,
  sqliteTable,
  text,
  primaryKey,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

const timestamps = {
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
};

export const items = sqliteTable("items", {
  id: text("id").primaryKey(),
  title: text("title"),
  subtitle: text("subtitle"),
  description: text("description"),
  language: text("language"),
  publishedYear: integer("published_year"),
  series: text("series"),
  seriesIndex: real("series_index"),
  ...timestamps,
});

export const files = sqliteTable("files", {
  id: text("id").primaryKey(),
  itemId: text("item_id").references(() => items.id),
  path: text("path").notNull(),
  filename: text("filename").notNull(),
  extension: text("extension").notNull(),
  mimeType: text("mime_type"),
  sizeBytes: integer("size_bytes"),
  sha256: text("sha256"),
  hashAlgo: text("hash_algo").default("sha256"),
  modifiedAt: integer("modified_at", { mode: "timestamp_ms" }),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  status: text("status").default("active"),
});

export const authors = sqliteTable("authors", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  sortName: text("sort_name"),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
});

export const itemAuthors = sqliteTable(
  "item_authors",
  {
    itemId: text("item_id")
      .notNull()
      .references(() => items.id),
    authorId: text("author_id")
      .notNull()
      .references(() => authors.id),
    role: text("role").default("author"),
    ord: integer("ord").default(0),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.itemId, table.authorId, table.role] }),
  })
);

export const identifiers = sqliteTable(
  "identifiers",
  {
    id: text("id").primaryKey(),
    itemId: text("item_id")
      .notNull()
      .references(() => items.id),
    type: text("type").notNull(),
    value: text("value").notNull(),
    source: text("source"),
    confidence: real("confidence").default(0),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => ({
    uniq: uniqueIndex("identifiers_type_value").on(table.type, table.value),
  })
);

export const tags = sqliteTable("tags", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  normalized: text("normalized").notNull(),
  color: text("color"),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
});

export const itemTags = sqliteTable(
  "item_tags",
  {
    itemId: text("item_id")
      .notNull()
      .references(() => items.id),
    tagId: text("tag_id")
      .notNull()
      .references(() => tags.id),
    source: text("source"),
    confidence: real("confidence").default(0),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.itemId, table.tagId] }),
  })
);

export const covers = sqliteTable("covers", {
  id: text("id").primaryKey(),
  itemId: text("item_id")
    .notNull()
    .references(() => items.id),
  source: text("source").notNull(),
  url: text("url"),
  localPath: text("local_path"),
  width: integer("width"),
  height: integer("height"),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
});

export const enrichmentSources = sqliteTable("enrichment_sources", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  rateLimitPerMin: integer("rate_limit_per_min"),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
});

export const enrichmentResults = sqliteTable("enrichment_results", {
  id: text("id").primaryKey(),
  itemId: text("item_id")
    .notNull()
    .references(() => items.id),
  sourceId: text("source_id")
    .notNull()
    .references(() => enrichmentSources.id),
  queryType: text("query_type").notNull(),
  query: text("query").notNull(),
  responseJson: text("response_json").notNull(),
  confidence: real("confidence").default(0),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
});

export const itemFieldSources = sqliteTable("item_field_sources", {
  id: text("id").primaryKey(),
  itemId: text("item_id")
    .notNull()
    .references(() => items.id),
  field: text("field").notNull(),
  source: text("source").notNull(),
  confidence: real("confidence").default(0),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
});

export const issues = sqliteTable("issues", {
  id: text("id").primaryKey(),
  itemId: text("item_id").references(() => items.id),
  fileId: text("file_id").references(() => files.id),
  type: text("type").notNull(),
  message: text("message"),
  severity: text("severity").default("info"),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  resolvedAt: integer("resolved_at", { mode: "timestamp_ms" }),
});

export const scanSessions = sqliteTable("scan_sessions", {
  id: text("id").primaryKey(),
  rootPath: text("root_path").notNull(),
  startedAt: integer("started_at", { mode: "timestamp_ms" }).notNull(),
  endedAt: integer("ended_at", { mode: "timestamp_ms" }),
  status: text("status").notNull(),
});

export const scanEntries = sqliteTable("scan_entries", {
  id: text("id").primaryKey(),
  sessionId: text("session_id")
    .notNull()
    .references(() => scanSessions.id),
  path: text("path").notNull(),
  modifiedAt: integer("modified_at", { mode: "timestamp_ms" }),
  sizeBytes: integer("size_bytes"),
  sha256: text("sha256"),
  action: text("action").notNull(),
  fileId: text("file_id").references(() => files.id),
});
