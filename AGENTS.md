# AGENTS
# Folio repository guide for agentic coding.
# Keep this file up to date as the repo evolves.

## Workspace overview
- Monorepo with pnpm workspaces.
- apps/desktop: Tauri + React (Vite) desktop app.
- packages/core: Node/TS core services (scanner, metadata, enrichment, organizer).
- apps/desktop/src-tauri: Rust backend for Tauri.
- docs/: GitHub Pages download site (static).
- scripts/: release helper scripts (latest.json generation).

## Tooling versions
- Node: 22.x (see README).
- pnpm: 10.28.2 (root packageManager).
- Tauri CLI: 2.9.6.
- TypeScript: 5.9.x.

## Install
- From repo root: `pnpm install`.

## Common commands (root)
- Dev (desktop): `pnpm dev` (runs Vite in apps/desktop).
- Build (desktop): `pnpm build`.
- Lint (desktop): `pnpm lint`.

## Desktop app commands (apps/desktop)
- Dev: `pnpm -C apps/desktop dev`.
- Tauri dev: `pnpm -C apps/desktop dev:tauri`.
- Build: `pnpm -C apps/desktop build`.
- Tauri build: `pnpm -C apps/desktop build:tauri`.
- Lint: `pnpm -C apps/desktop lint`.

## Core package commands (packages/core)
- Build: `pnpm -C packages/core build`.
- DB generate: `pnpm -C packages/core db:generate`.
- DB migrate: `pnpm -C packages/core db:migrate`.
- CLI scan: `pnpm -C packages/core scan "<path>" --db "./folio.db"`.
- CLI enrich: `pnpm -C packages/core enrich --item <id> --isbn <isbn> --db "./folio.db"`.
- CLI list: `pnpm -C packages/core list --db "./folio.db"`.

## Tests
- No test runner configured in package scripts.
- If adding tests, document the single-test command here.
- Apple Books provider tests: `pnpm -C packages/core exec tsx --test src/enrichment/providers/apple-books.test.ts`.

## Linting and formatting
- ESLint config: `apps/desktop/eslint.config.js`.
- Flat config with `@eslint/js`, `typescript-eslint`, `eslint-plugin-react-hooks`, `eslint-plugin-react-refresh`.
- There is no Prettier or Biome config in repo.
- Formatting should follow existing files (2 spaces, trailing commas where present).

## TypeScript configuration
- apps/desktop uses Vite + React TS configs:
  - `apps/desktop/tsconfig.app.json`
  - `apps/desktop/tsconfig.node.json`
- packages/core uses `packages/core/tsconfig.json` with `strict: true`.

## Rust / Tauri
- Rust backend lives in `apps/desktop/src-tauri`.
- Tauri config: `apps/desktop/src-tauri/tauri.conf.json`.
- Cargo manifest: `apps/desktop/src-tauri/Cargo.toml`.
- Build commands are wired via Tauri CLI.

## Releases
- Tag a release (e.g. `v0.1.19`) and push to trigger GitHub Actions.
- Release workflow: `.github/workflows/release.yml`.
- Updater manifest is generated and committed via workflow (`docs/latest.json`).
- GitHub Pages deploys `docs/` via `.github/workflows/pages.yml`.
- Versioning must stay in sync:
  - `apps/desktop/src-tauri/tauri.conf.json` version
  - `apps/desktop/package.json` version
  - release tag (e.g. `v0.1.19`)

## Download page
- `docs/index.html` reads `docs/latest.json` at runtime.
- `scripts/generate-updater.js` builds `docs/latest.json` and now includes:
  - `platforms` (Tauri updater signature).
  - `downloads` (direct OS asset links).

## Coding conventions (general)
- Prefer small, focused changes; avoid refactors in bugfixes.
- Match existing patterns in each area (React, Node, Rust).
- Avoid `any` and TS ignore directives.
- Use explicit typing where inference is unclear.
- Use `const` by default; `let` only when reassigning.

## Imports
- Group imports by source:
  1) third-party
  2) workspace/internal
  3) relative
- Keep import order stable; avoid duplicate imports.
- Prefer named imports over default when modules export named APIs.

## React / UI (apps/desktop)
- Functional components, hooks-based.
- Keep components small and focused.
- Use `useEffect` dependencies correctly (no suppressed deps).
- Prefer lifting state rather than global mutable state.
- Avoid excessive re-renders; memoize only when needed.

## Styling
- Desktop UI uses Tailwind + shadcn/ui (see `apps/desktop/src/index.css` and `apps/desktop/src/components/ui`).
- Keep class names semantic and consistent with existing styles.
- Avoid adding new styling frameworks unless approved.

## Node / Core (packages/core)
- ES modules (`"type": "module"`).
- TypeScript strict mode enabled.
- Keep CLI input validation explicit and user-friendly.
- Prefer pure functions for core logic; isolate side effects.

## Rust
- Favor explicit error handling with `Result`.
- Avoid panics in normal flows.
- Keep Tauri commands small; push heavy logic to core helpers.

## Error handling
- Surface actionable error messages (include context, not stack traces for users).
- Never swallow errors silently.
- In UI, show user-facing errors; in core, propagate errors.

## Naming conventions
- TS/JS: camelCase for variables/functions, PascalCase for components and types.
- Rust: snake_case for functions/vars, PascalCase for types.
- Files: kebab-case or existing naming in the folder.

## Files to check before editing
- `apps/desktop/eslint.config.js` for lint rules.
- `apps/desktop/src-tauri/tauri.conf.json` for app version and updater config.
- `scripts/generate-updater.js` for release manifest logic.
- `docs/index.html` and `docs/style.css` for downloads page.

## Cursor / Copilot rules
- No `.cursorrules`, `.cursor/rules`, or `.github/copilot-instructions.md` found.

## Notes for agents
- Keep changes atomic; avoid mixing concerns in one commit.
- Do not edit unrelated files that are already dirty in the working tree.
- If you add tests, document the exact single-test command here.
