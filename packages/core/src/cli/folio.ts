#!/usr/bin/env node

import path from "node:path";
import { pathToFileURL } from "node:url";

import { createDb } from "../db";
import { createFolioLibrary, parseMetadataChanges, type MetadataChanges } from "../folio";
import { resolveFolioDbPath } from "../folio/db-path";
import { scanRoot } from "../scanner";

type CliIo = {
  stdout: (value: string) => void;
  stderr: (value: string) => void;
};

const defaultIo: CliIo = {
  stdout: (value) => process.stdout.write(value),
  stderr: (value) => process.stderr.write(value),
};

export async function runFolioCli(
  argv: string[],
  io: CliIo = defaultIo,
): Promise<number> {
  try {
    if (!argv.length || argv.includes("--help") || argv.includes("-h")) {
      io.stdout(helpText);
      return 0;
    }
    const parsed = parseArguments(argv);
    validateInvocation(parsed);
    const dbPath = resolveFolioDbPath(parsed.options.get("db"));
    const db = createDb(dbPath);
    try {
      const folio = createFolioLibrary(db);
      const [group, action, ...positionals] = parsed.positionals;

      if (group === "books" && action === "search") {
        const books = folio.searchBooks({
          query: positionals.join(" "),
          limit: parseLimit(parsed.options.get("limit")),
        });
        writeResult(io, books, parsed.flags.has("json"), formatBookList);
        return 0;
      }
      if (group === "books" && action === "show") {
        const itemId = requirePositional(positionals[0], "book id");
        const book = folio.getBook(itemId);
        if (!book) throw new Error(`Book not found: ${itemId}`);
        writeResult(io, book, parsed.flags.has("json"), (value) => JSON.stringify(value, null, 2));
        return 0;
      }
      if (group === "books" && action === "missing") {
        const books = folio.findMissingMetadata({
          limit: parseLimit(parsed.options.get("limit")),
        });
        writeResult(io, books, parsed.flags.has("json"), (value) =>
          value.map((book) => `${book.id}  ${book.title ?? "Untitled"}  [${book.missingFields.join(", ")}]`).join("\n"),
        );
        return 0;
      }
      if (group === "metadata" && action === "suggest") {
        const itemId = requirePositional(positionals[0], "book id");
        const suggestions = await folio.suggestMetadata(itemId);
        writeResult(io, suggestions, parsed.flags.has("json"), (value) => JSON.stringify(value, null, 2));
        return 0;
      }
      if (group === "metadata" && action === "propose") {
        const itemId = requirePositional(positionals[0], "book id");
        const changes = parseChanges(parsed.options.get("changes"));
        const proposal = folio.proposeMetadataUpdate({
          itemId,
          changes,
          source: requireOption(parsed.options, "source"),
          confidence: parseConfidence(requireOption(parsed.options, "confidence")),
          reason: requireOption(parsed.options, "reason"),
          overwrite: parsed.flags.has("overwrite"),
        });
        writeResult(io, proposal, parsed.flags.has("json"), (value) =>
          `Queued metadata proposal ${value.id} for ${value.itemId}: ${Object.keys(value.changes).join(", ")}`,
        );
        return 0;
      }
      if (group === "changes" && action === "list") {
        const status = parseStatus(parsed.options.get("status"));
        const changes = folio.listPendingChanges({ status });
        writeResult(io, changes, parsed.flags.has("json"), (value) =>
          value.map((change) => `${change.id}  ${change.itemId}  ${Object.keys(change.changes).join(", ")}`).join("\n"),
        );
        return 0;
      }
      if (group === "changes" && action === "apply") {
        const changeId = requirePositional(positionals[0], "change id");
        if (parsed.flags.has("dry-run")) {
          const preview = folio.previewPendingChange(changeId);
          writeResult(io, { dryRun: true, preview }, parsed.flags.has("json"), (value) =>
            value.preview.conflicts.length
              ? `Dry run: ${value.preview.change.id} conflicts on ${value.preview.conflicts.join(", ")}.`
              : `Dry run: would apply ${value.preview.change.id} (${Object.keys(value.preview.applicableChanges).join(", ")})`,
          );
          return 0;
        }
        const applied = folio.applyPendingChange(changeId);
        writeResult(io, applied, parsed.flags.has("json"), (value) =>
          `Applied metadata proposal ${value.id} to ${value.itemId}.`,
        );
        return 0;
      }
      if (group === "scan") {
        const rootPath = path.resolve(requirePositional(action, "folder path"));
        const stats = await scanRoot(db, rootPath);
        writeResult(io, stats, parsed.flags.has("json"), (value) =>
          `Scan complete: added=${value.added} updated=${value.updated} moved=${value.moved} unchanged=${value.unchanged} missing=${value.missing}`,
        );
        return 0;
      }

      throw new Error(`Unknown command: ${parsed.positionals.join(" ")}`);
    } finally {
      db.$client.close();
    }
  } catch (error) {
    io.stderr(`${error instanceof Error ? error.message : String(error)}\n`);
    return 1;
  }
}

type ParsedArguments = {
  positionals: string[];
  options: Map<string, string>;
  flags: Set<string>;
};

const valueOptions = new Set([
  "db",
  "limit",
  "changes",
  "source",
  "confidence",
  "reason",
  "status",
]);
const booleanFlags = new Set(["json", "overwrite", "dry-run"]);

function parseArguments(argv: string[]): ParsedArguments {
  const positionals: string[] = [];
  const options = new Map<string, string>();
  const flags = new Set<string>();
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (!argument.startsWith("--")) {
      positionals.push(argument);
      continue;
    }
    const name = argument.slice(2);
    if (!valueOptions.has(name)) {
      if (!booleanFlags.has(name)) throw new Error(`Unknown option: --${name}.`);
      flags.add(name);
      continue;
    }
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`Missing value for --${name}.`);
    options.set(name, value);
    index += 1;
  }
  return { positionals, options, flags };
}

type CommandShape = {
  minPositionals: number;
  maxPositionals: number;
  options: string[];
  flags: string[];
};

const commandShapes: Record<string, CommandShape> = {
  "books search": { minPositionals: 2, maxPositionals: Infinity, options: ["db", "limit"], flags: ["json"] },
  "books show": { minPositionals: 3, maxPositionals: 3, options: ["db"], flags: ["json"] },
  "books missing": { minPositionals: 2, maxPositionals: 2, options: ["db", "limit"], flags: ["json"] },
  "metadata suggest": { minPositionals: 3, maxPositionals: 3, options: ["db"], flags: ["json"] },
  "metadata propose": {
    minPositionals: 3,
    maxPositionals: 3,
    options: ["db", "changes", "source", "confidence", "reason"],
    flags: ["json", "overwrite"],
  },
  "changes list": { minPositionals: 2, maxPositionals: 2, options: ["db", "status"], flags: ["json"] },
  "changes apply": { minPositionals: 3, maxPositionals: 3, options: ["db"], flags: ["json", "dry-run"] },
  scan: { minPositionals: 2, maxPositionals: 2, options: ["db"], flags: ["json"] },
};

function validateInvocation(parsed: ParsedArguments) {
  const [group, action] = parsed.positionals;
  const commandName = group === "scan" ? "scan" : `${group ?? ""} ${action ?? ""}`.trim();
  const shape = commandShapes[commandName];
  if (!shape) throw new Error(`Unknown command: ${parsed.positionals.join(" ")}`);
  if (
    parsed.positionals.length < shape.minPositionals ||
    parsed.positionals.length > shape.maxPositionals
  ) {
    throw new Error(`Invalid number of arguments for ${commandName}. Run folio --help for usage.`);
  }
  for (const option of parsed.options.keys()) {
    if (!shape.options.includes(option)) {
      throw new Error(`Option --${option} is not valid for ${commandName}.`);
    }
  }
  for (const flag of parsed.flags) {
    if (!shape.flags.includes(flag)) {
      throw new Error(`Option --${flag} is not valid for ${commandName}.`);
    }
  }
}

function writeResult<T>(
  io: CliIo,
  value: T,
  json: boolean,
  formatHuman: (value: T) => string,
) {
  const output = json ? JSON.stringify(value, null, 2) : formatHuman(value);
  io.stdout(`${output}${output.endsWith("\n") ? "" : "\n"}`);
}

function formatBookList(books: ReturnType<ReturnType<typeof createFolioLibrary>["searchBooks"]>) {
  if (!books.length) return "No books found.";
  return books
    .map((book) => `${book.id}  ${book.title ?? "Untitled"} — ${book.authors.join(", ") || "Unknown author"}`)
    .join("\n");
}

function parseChanges(value: string | undefined): MetadataChanges {
  if (!value) throw new Error("Missing required option --changes <json>.");
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error("--changes must contain valid JSON.");
  }
  if (!parsed || Array.isArray(parsed) || typeof parsed !== "object") {
    throw new Error("--changes must be a JSON object.");
  }
  return parseMetadataChanges(parsed);
}

function parseLimit(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const limit = Number(value);
  if (!Number.isInteger(limit) || limit < 1) throw new Error("--limit must be a positive integer.");
  return limit;
}

function parseConfidence(value: string): number {
  const confidence = Number(value);
  if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) {
    throw new Error("--confidence must be between 0 and 1.");
  }
  return confidence;
}

function parseStatus(value: string | undefined): "pending" | "applied" | "error" {
  if (value === undefined) return "pending";
  if (value === "pending" || value === "applied" || value === "error") return value;
  throw new Error("--status must be pending, applied, or error.");
}

function requireOption(options: Map<string, string>, name: string): string {
  const value = options.get(name)?.trim();
  if (!value) throw new Error(`Missing required option --${name}.`);
  return value;
}

function requirePositional(value: string | undefined, label: string): string {
  if (!value?.trim()) throw new Error(`Missing ${label}.`);
  return value;
}

const helpText = `Folio CLI

Usage:
  folio books search [query] [--limit n] [--json] [--db path]
  folio books show <book-id> [--json] [--db path]
  folio books missing [--limit n] [--json] [--db path]
  folio metadata suggest <book-id> [--json] [--db path]
  folio metadata propose <book-id> --changes <json> --source <name> --confidence <0..1> --reason <text> [--overwrite] [--json] [--db path]
  folio changes list [--status pending|applied|error] [--json] [--db path]
  folio changes apply <change-id> [--dry-run] [--json] [--db path]
  folio scan <folder> [--json] [--db path]

Database lookup order: --db, FOLIO_DB, ./folio.db, then the Folio desktop app data folder.
`;

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await runFolioCli(process.argv.slice(2));
}
