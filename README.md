# Folio

Calm, modern, Mac-first personal book library.

## Installation on macOS

Since the app allows you to manage your local files but is not signed with a paid Apple Developer certificate, macOS will quarantine the downloaded file.

**(1) Download** the `.dmg` from [Releases](https://github.com/bkeetman/folio/releases).

**(2) Install** by dragging Folio to your Applications folder.

**(3) Run this command** in your Terminal to allow the app to run:

```bash
xattr -cr /Applications/Folio.app
```

Then you can open Folio normally.

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

## Releases

- Tag a release (e.g. `v0.1.0`) and push it to trigger the GitHub Actions release workflow.
- Installers are published to GitHub Releases.
- GitHub Pages serves the `docs/` folder as a download page.

## Auto-updater

- The updater reads `https://bkeetman.github.io/folio/latest.json`.
- `docs/latest.json` is now generated and committed by the release workflow.

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
