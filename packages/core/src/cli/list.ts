import path from "path";
import { createDb } from "../db";
import { listLibraryItems } from "../library";

const args = process.argv.slice(2);
const dbPathArg = getArgValue(args, "--db");
const dbPath = dbPathArg ? path.resolve(dbPathArg) : path.resolve("folio.db");

const db = createDb(dbPath);
const items = listLibraryItems(db);

if (!items.length) {
  process.stdout.write("No items found.\n");
  process.exit(0);
}

for (const item of items) {
  const title = item.title ?? "Untitled";
  const authors = item.authorNames.length ? item.authorNames.join(", ") : "Unknown";
  const formats = item.formats.length ? item.formats.join(", ") : "";
  process.stdout.write(`${title} — ${authors} (${formats})\n`);
}

function getArgValue(argsList: string[], name: string) {
  const index = argsList.indexOf(name);
  if (index === -1) return undefined;
  return argsList[index + 1];
}
