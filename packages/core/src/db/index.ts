import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import * as schema from "./schema";

export type FolioDb = ReturnType<typeof createDb>;

export function createDb(filePath: string) {
  const sqlite = new Database(filePath);
  return drizzle(sqlite, { schema });
}
