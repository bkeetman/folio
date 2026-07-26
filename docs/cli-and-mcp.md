# Folio CLI and MCP server

Folio exposes the same local-library interface through a command-line tool and a local MCP server. Both use Folio's existing SQLite database and keep AI-authored metadata behind a propose/apply review step.

## Build

From the repository root:

```bash
pnpm -C packages/core build
```

This creates two executable entrypoints:

- `packages/core/dist/bin/folio.js`
- `packages/core/dist/bin/folio-mcp.js`

During development, use `pnpm folio --help` or `pnpm folio:mcp` from the repository root.

## Database selection

Both entrypoints use the first available option:

1. `--db /absolute/path/to/folio.db`
2. the `FOLIO_DB` environment variable
3. `./folio.db`
4. the Folio desktop app data directory

On macOS, the desktop database normally lives at:

```text
~/Library/Application Support/com.folio.app/folio.db
```

Use an explicit path in MCP configuration so the result does not depend on the client's working directory.

## CLI examples

```bash
pnpm folio books search "Ursula Le Guin" --json
pnpm folio books show <book-id> --json
pnpm folio books missing --limit 25 --json
pnpm folio metadata suggest <book-id> --json
```

Metadata suggestions include `coverUrl` and `sourceUrl` when the catalogue provider supplies them. Suggestions, including cover candidates, are read-only and are never applied automatically.

Queue a metadata proposal without overwriting populated fields:

```bash
pnpm folio metadata propose <book-id> \
  --changes '{"authors":["Ursula K. Le Guin"],"language":"en"}' \
  --source 'ai:model-name' \
  --confidence 0.9 \
  --reason 'Matched against a cited catalogue record' \
  --json
```

Review and apply it separately:

```bash
pnpm folio changes list --json
pnpm folio changes apply <change-id> --dry-run --json
pnpm folio changes apply <change-id> --json
```

Applying is transactional. The source and confidence are recorded in `item_field_sources`. Pass `--overwrite` while proposing only when replacing existing canonical metadata is intentional.

The proposal stores the reviewed old values. If metadata changes before apply, dry-run reports a conflict and apply refuses to overwrite the newer edit—even when the proposal was created with `--overwrite`.

## MCP configuration

Build first, then configure an MCP client to launch the bundled server over stdio. For example:

```json
{
  "mcpServers": {
    "folio": {
      "command": "/absolute/path/to/node",
      "args": [
        "/absolute/path/to/folio/packages/core/dist/bin/folio-mcp.js",
        "--db",
        "/absolute/path/to/folio.db"
      ]
    }
  }
}
```

The server offers these tools:

- `search_library`
- `get_book`
- `find_missing_metadata`
- `suggest_metadata`
- `propose_metadata_update`
- `list_metadata_changes`
- `apply_metadata_change`

Only `apply_metadata_change` changes canonical book metadata. `propose_metadata_update` writes a reviewable proposal to Folio's existing `pending_changes` table.

Folio desktop intentionally excludes `folio_metadata` proposals from its Changes screen for now. Review and apply them through the CLI or MCP tools, which share the validation, conflict detection, transaction, and provenance implementation.

## Trust model

- Catalogue lookups return suggestions and never apply them automatically.
- AI-generated facts should include a meaningful source and evidence in `reason`.
- Populated fields are preserved unless overwrite is explicitly enabled.
- Apply rechecks the current book state, so a stale proposal cannot silently replace newly entered metadata.
- MCP tool annotations mark catalogue lookups as open-world and metadata apply as destructive.
