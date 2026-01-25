import path from "path";
import { createDb } from "../db";
import { enrichByIsbn, enrichByTitleAuthor, applyEnrichmentCandidate } from "../enrichment";
import { items } from "../db/schema";
import { eq } from "drizzle-orm";

const args = process.argv.slice(2);
const dbPathArg = getArgValue(args, "--db");
const itemId = getArgValue(args, "--item");
const isbn = getArgValue(args, "--isbn");
const title = getArgValue(args, "--title");
const author = getArgValue(args, "--author");

if (!itemId) {
  process.stderr.write("Usage: pnpm enrich --item <id> [--isbn <isbn> | --title <title> --author <author>] [--db path]\n");
  process.exit(1);
}

const dbPath = dbPathArg ? path.resolve(dbPathArg) : path.resolve("folio.db");
const db = createDb(dbPath);
const item = db.select().from(items).where(eq(items.id, itemId)).get();
if (!item) {
  process.stderr.write(`Item not found: ${itemId}\n`);
  process.exit(1);
}

let candidates: Awaited<ReturnType<typeof enrichByIsbn>> = [];

if (isbn) {
  candidates = await enrichByIsbn(db, itemId, isbn);
} else if (title) {
  candidates = await enrichByTitleAuthor(db, itemId, title, author);
} else {
  process.stderr.write("Provide either --isbn or --title for enrichment.\n");
  process.exit(1);
}

if (!candidates.length) {
  process.stdout.write("No enrichment candidates returned.\n");
  process.exit(0);
}

const [best] = candidates;
applyEnrichmentCandidate(db, itemId, best);
process.stdout.write(
  `Applied enrichment from ${best.source} with ${(best.confidence * 100).toFixed(0)}% confidence.\n`
);

function getArgValue(argsList: string[], name: string) {
  const index = argsList.indexOf(name);
  if (index === -1) return undefined;
  return argsList[index + 1];
}
