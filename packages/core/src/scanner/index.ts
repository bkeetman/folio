import { readdir, stat } from "fs/promises";
import path from "path";
import { randomUUID } from "crypto";
import { and, eq, like } from "drizzle-orm";
import type { FolioDb } from "../db";
import {
  files,
  items,
  scanEntries,
  scanSessions,
} from "../db/schema";
import { sha256File } from "./hash";

type ScanOptions = {
  includeExtensions?: string[];
};

type ScanStats = {
  added: number;
  unchanged: number;
  updated: number;
  moved: number;
  missing: number;
};

const defaultExtensions = [".epub", ".pdf"];

export async function scanRoot(
  db: FolioDb,
  rootPath: string,
  options: ScanOptions = {}
): Promise<ScanStats> {
  const extensions = new Set(
    (options.includeExtensions ?? defaultExtensions).map((ext) => ext.toLowerCase())
  );
  const now = Date.now();
  const sessionId = randomUUID();
  const stats: ScanStats = {
    added: 0,
    unchanged: 0,
    updated: 0,
    moved: 0,
    missing: 0,
  };

  db.insert(scanSessions).values({
    id: sessionId,
    rootPath,
    startedAt: now,
    status: "running",
  });

  const seenPaths = new Set<string>();

  for await (const filePath of walkFiles(rootPath, extensions)) {
    seenPaths.add(filePath);
    const fileStat = await stat(filePath);
    const filename = path.basename(filePath);
    const extension = path.extname(filePath).toLowerCase();
    const sizeBytes = fileStat.size;
    const modifiedAt = fileStat.mtimeMs;

    const existingByPath = db
      .select()
      .from(files)
      .where(eq(files.path, filePath))
      .get();

    if (
      existingByPath &&
      existingByPath.modifiedAt === modifiedAt &&
      existingByPath.sizeBytes === sizeBytes
    ) {
      stats.unchanged += 1;
      db.insert(scanEntries).values({
        id: randomUUID(),
        sessionId,
        path: filePath,
        modifiedAt,
        sizeBytes,
        sha256: existingByPath.sha256 ?? undefined,
        action: "unchanged",
        fileId: existingByPath.id,
      });
      continue;
    }

    const sha256 = await sha256File(filePath);
    const existingByHash = db
      .select()
      .from(files)
      .where(and(eq(files.sha256, sha256), eq(files.hashAlgo, "sha256")))
      .get();

    if (existingByHash && existingByHash.path !== filePath) {
      stats.moved += 1;
      db
        .update(files)
        .set({
          path: filePath,
          filename,
          extension,
          sizeBytes,
          modifiedAt,
          updatedAt: now,
          status: "active",
        })
        .where(eq(files.id, existingByHash.id));

      db.insert(scanEntries).values({
        id: randomUUID(),
        sessionId,
        path: filePath,
        modifiedAt,
        sizeBytes,
        sha256,
        action: "moved",
        fileId: existingByHash.id,
      });
      continue;
    }

    if (existingByPath) {
      stats.updated += 1;
      db
        .update(files)
        .set({
          filename,
          extension,
          sizeBytes,
          modifiedAt,
          sha256,
          hashAlgo: "sha256",
          updatedAt: now,
          status: "active",
        })
        .where(eq(files.id, existingByPath.id));
      db.insert(scanEntries).values({
        id: randomUUID(),
        sessionId,
        path: filePath,
        modifiedAt,
        sizeBytes,
        sha256,
        action: "updated",
        fileId: existingByPath.id,
      });
      continue;
    }

    const itemId = randomUUID();
    const fileId = randomUUID();

    db.insert(items).values({
      id: itemId,
      createdAt: now,
      updatedAt: now,
    });

    db.insert(files).values({
      id: fileId,
      itemId,
      path: filePath,
      filename,
      extension,
      sizeBytes,
      modifiedAt,
      sha256,
      hashAlgo: "sha256",
      createdAt: now,
      updatedAt: now,
      status: "active",
    });

    stats.added += 1;
    db.insert(scanEntries).values({
      id: randomUUID(),
      sessionId,
      path: filePath,
      modifiedAt,
      sizeBytes,
      sha256,
      action: "added",
      fileId,
    });
  }

  const existingPaths = db
    .select({ path: files.path, id: files.id })
    .from(files)
    .where(and(like(files.path, `${rootPath}%`), eq(files.status, "active")))
    .all();

  for (const entry of existingPaths) {
    if (seenPaths.has(entry.path)) continue;
    stats.missing += 1;
    db
      .update(files)
      .set({ status: "missing", updatedAt: now })
      .where(eq(files.id, entry.id));
    db.insert(scanEntries).values({
      id: randomUUID(),
      sessionId,
      path: entry.path,
      action: "missing",
      fileId: entry.id,
    });
  }

  db
    .update(scanSessions)
    .set({ status: "success", endedAt: Date.now() })
    .where(eq(scanSessions.id, sessionId));

  return stats;
}

async function* walkFiles(
  rootPath: string,
  extensions: Set<string>
): AsyncGenerator<string> {
  const stack = [rootPath];
  while (stack.length) {
    const current = stack.pop();
    if (!current) continue;
    const entries = await readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      const entryPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(entryPath);
        continue;
      }
      if (!entry.isFile()) continue;
      const ext = path.extname(entry.name).toLowerCase();
      if (!extensions.has(ext)) continue;
      yield entryPath;
    }
  }
}
