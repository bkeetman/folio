import path from "path";
import { createDb, scanRoot } from "../index";

const args = process.argv.slice(2);
const rootArg = args.find((arg) => !arg.startsWith("--"));
const dbPathArg = getArgValue(args, "--db");

if (!rootArg) {
  process.stderr.write("Usage: pnpm scan <root-path> [--db path]\n");
  process.exit(1);
}

const rootPath = path.resolve(rootArg);
const dbPath = dbPathArg ? path.resolve(dbPathArg) : path.resolve("folio.db");

const db = createDb(dbPath);
const stats = await scanRoot(db, rootPath);

process.stdout.write(
  `Scan complete. added=${stats.added} updated=${stats.updated} moved=${stats.moved} unchanged=${stats.unchanged} missing=${stats.missing}\n`
);

function getArgValue(argsList: string[], name: string) {
  const index = argsList.indexOf(name);
  if (index === -1) return undefined;
  return argsList[index + 1];
}
