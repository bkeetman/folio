import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";

export function resolveFolioDbPath(explicitPath?: string): string {
  const requested = explicitPath?.trim() || process.env.FOLIO_DB?.trim();
  if (requested) {
    const resolved = path.resolve(requested);
    if (!existsSync(resolved)) throw new Error(`Folio database not found: ${resolved}`);
    return resolved;
  }

  const candidates = defaultDbCandidates();
  const existing = candidates.find((candidate) => existsSync(candidate));
  if (existing) return existing;
  throw new Error(
    `Folio database not found. Pass --db <path> or set FOLIO_DB. Searched: ${candidates.join(", ")}`,
  );
}

function defaultDbCandidates(): string[] {
  const home = os.homedir();
  const platformPath =
    process.platform === "darwin"
      ? path.join(home, "Library", "Application Support", "com.folio.app", "folio.db")
      : process.platform === "win32"
        ? path.join(process.env.APPDATA || path.join(home, "AppData", "Roaming"), "com.folio.app", "folio.db")
        : path.join(process.env.XDG_DATA_HOME || path.join(home, ".local", "share"), "com.folio.app", "folio.db");
  return [path.resolve("folio.db"), platformPath];
}
