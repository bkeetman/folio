import { sql } from "drizzle-orm";
import type { FolioDb } from "../db";
import { authors, files, itemAuthors, items } from "../db/schema";

export type LibraryItem = {
  id: string;
  title: string | null;
  publishedYear: number | null;
  authorNames: string[];
  fileCount: number;
  formats: string[];
};

export function listLibraryItems(db: FolioDb): LibraryItem[] {
  const rows = db
    .select({
      id: items.id,
      title: items.title,
      publishedYear: items.publishedYear,
      authorName: authors.name,
      fileCount: sql<number>`count(${files.id})`,
      format: files.extension,
    })
    .from(items)
    .leftJoin(itemAuthors, sql`${itemAuthors.itemId} = ${items.id}`)
    .leftJoin(authors, sql`${authors.id} = ${itemAuthors.authorId}`)
    .leftJoin(files, sql`${files.itemId} = ${items.id}`)
    .groupBy(items.id, authors.name, files.extension)
    .all();

  const map = new Map<string, LibraryItem>();
  for (const row of rows) {
    const existing = map.get(row.id);
    const formats = row.format ? [row.format] : [];
    const authorsList = row.authorName ? [row.authorName] : [];
    if (!existing) {
      map.set(row.id, {
        id: row.id,
        title: row.title ?? null,
        publishedYear: row.publishedYear ?? null,
        authorNames: authorsList,
        fileCount: row.fileCount ?? 0,
        formats,
      });
      continue;
    }
    existing.fileCount = row.fileCount ?? existing.fileCount;
    if (row.authorName && !existing.authorNames.includes(row.authorName)) {
      existing.authorNames.push(row.authorName);
    }
    if (row.format && !existing.formats.includes(row.format)) {
      existing.formats.push(row.format);
    }
  }

  return Array.from(map.values());
}
