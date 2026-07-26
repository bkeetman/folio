#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

import { createDb } from "../db";
import {
  createFolioLibrary,
  type FolioLibrary,
  type MetadataChanges,
  metadataChangesSchema,
} from "../folio";
import { resolveFolioDbPath } from "../folio/db-path";

export function createFolioMcpServer(folio: FolioLibrary): McpServer {
  const server = new McpServer({ name: "folio", version: "0.1.0" });

  server.registerTool(
    "search_library",
    {
      title: "Search Folio library",
      description: "Search the local Folio book library by title, author, or identifier.",
      inputSchema: {
        query: z.string().optional().describe("Title, author, or ISBN. Omit to list books."),
        limit: z.number().int().min(1).max(500).optional(),
      },
      annotations: readOnlyAnnotations,
    },
    async ({ query, limit }) => toolResult({ books: folio.searchBooks({ query, limit }) }),
  );

  server.registerTool(
    "get_book",
    {
      title: "Get a Folio book",
      description: "Read one book and its canonical metadata from the local Folio library.",
      inputSchema: { itemId: z.string().min(1) },
      annotations: readOnlyAnnotations,
    },
    async ({ itemId }) => {
      const book = folio.getBook(itemId);
      if (!book) throw new Error(`Book not found: ${itemId}`);
      return toolResult({ book, provenance: folio.getFieldProvenance(itemId) });
    },
  );

  server.registerTool(
    "find_missing_metadata",
    {
      title: "Find incomplete Folio books",
      description: "List books missing a canonical title, author, or ISBN.",
      inputSchema: { limit: z.number().int().min(1).max(500).optional() },
      annotations: readOnlyAnnotations,
    },
    async ({ limit }) => toolResult({ books: folio.findMissingMetadata({ limit }) }),
  );

  server.registerTool(
    "suggest_metadata",
    {
      title: "Suggest book metadata",
      description:
        "Look up metadata candidates from Folio's configured catalogue sources. This does not alter canonical book metadata.",
      inputSchema: { itemId: z.string().min(1) },
      annotations: { ...readOnlyAnnotations, openWorldHint: true },
    },
    async ({ itemId }) => toolResult({ suggestions: await folio.suggestMetadata(itemId) }),
  );

  server.registerTool(
    "propose_metadata_update",
    {
      title: "Propose a metadata update",
      description:
        "Queue a reviewable metadata proposal. Existing populated fields are preserved unless overwrite is explicitly true.",
      inputSchema: {
        itemId: z.string().min(1),
        changes: metadataChangesSchema,
        source: z.string().min(1).describe("Source identifier, for example ai:model-name or openlibrary."),
        confidence: z.number().min(0).max(1),
        reason: z.string().min(1).describe("Why this proposal is credible, ideally including its evidence."),
        overwrite: z.boolean().optional().default(false),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async ({ itemId, changes, source, confidence, reason, overwrite }) =>
      toolResult({
        change: folio.proposeMetadataUpdate({
          itemId,
          changes: changes as MetadataChanges,
          source,
          confidence,
          reason,
          overwrite,
        }),
      }),
  );

  server.registerTool(
    "list_metadata_changes",
    {
      title: "List metadata proposals",
      description: "List reviewable Folio metadata proposals by status.",
      inputSchema: {
        status: z.enum(["pending", "applied", "error"]).optional().default("pending"),
      },
      annotations: readOnlyAnnotations,
    },
    async ({ status }) => toolResult({ changes: folio.listPendingChanges({ status }) }),
  );

  server.registerTool(
    "apply_metadata_change",
    {
      title: "Apply a metadata proposal",
      description:
        "Apply one previously queued Folio metadata proposal transactionally. Inspect it with list_metadata_changes first.",
      inputSchema: { changeId: z.string().min(1) },
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async ({ changeId }) => toolResult({ change: folio.applyPendingChange(changeId) }),
  );

  return server;
}

const readOnlyAnnotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} as const;

function toolResult(value: Record<string, unknown>) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }],
    structuredContent: value,
  };
}

async function startServer() {
  const dbPath = resolveFolioDbPath(readDbArgument(process.argv.slice(2)));
  const db = createDb(dbPath);
  const server = createFolioMcpServer(createFolioLibrary(db));
  const shutdown = async () => {
    try {
      await server.close();
      db.$client.close();
      process.exit(0);
    } catch (error) {
      process.stderr.write(
        `Folio MCP server shutdown failed: ${error instanceof Error ? error.message : String(error)}\n`,
      );
      process.exit(1);
    }
  };
  process.once("SIGINT", () => void shutdown());
  process.once("SIGTERM", () => void shutdown());
  try {
    await server.connect(new StdioServerTransport());
  } catch (error) {
    db.$client.close();
    throw error;
  }
}

function readDbArgument(argv: string[]): string | undefined {
  if (!argv.length) return undefined;
  if (argv.length !== 2 || argv[0] !== "--db") {
    throw new Error("Usage: folio-mcp [--db <path>].");
  }
  const value = argv[1];
  if (!value || value.startsWith("--")) throw new Error("Missing value for --db.");
  return value;
}

if (import.meta.url === new URL(process.argv[1] ?? "", "file:").href) {
  startServer().catch((error) => {
    process.stderr.write(`Folio MCP server failed: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  });
}
