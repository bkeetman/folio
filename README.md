# Folio

Calm, modern, Mac-first personal book library.

## Development

```bash
node -v # should be 22.x
pnpm install
pnpm dev
```

## Tauri app

```bash
cargo install tauri-cli --locked --version 2.9.6
pnpm -C apps/desktop dev:tauri
```

## Database (local)

```bash
pnpm -C packages/core db:generate
pnpm -C packages/core db:migrate
```

## Scan a folder

```bash
pnpm -C packages/core scan "/path/to/books" --db "./folio.db"
```

## Enrich an item

```bash
pnpm -C packages/core enrich --item <id> --isbn <isbn> --db "./folio.db"
```

## List items

```bash
pnpm -C packages/core list --db "./folio.db"
```

## Workspace layout

- `apps/desktop` — Tauri + React app
- `packages/core` — core services (scanner, metadata, enrichment, organizer)
