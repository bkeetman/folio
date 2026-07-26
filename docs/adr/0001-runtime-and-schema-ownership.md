# ADR-0001: Runtime and schema ownership

- Status: Accepted
- Date: 2026-07-26
- Tracking issue: [#3](https://github.com/bkeetman/folio/issues/3)

## Context

Folio currently has two implementations of several domain capabilities:

- the shipped desktop application executes scanning, persistence, metadata
  enrichment, organizing, importing, and e-reader workflows in Rust through
  Tauri commands in `apps/desktop/src-tauri`;
- `packages/core` implements a second scanner, SQLite access through Drizzle,
  metadata parsing and enrichment, an organizer, and command-line adapters in
  TypeScript;
- the desktop package declares `@folio/core` as a dependency but does not import
  it;
- SQL migration files live under `packages/core/drizzle`, while the Rust
  runtime includes and applies those files directly;
- Rust `serde` structures and `apps/desktop/src/types/library.ts` manually
  describe the same Tauri command and event payloads.

This split has no explicit owner. A change to a scan rule, database column,
metadata merge, organizer invariant, or serialized payload can therefore land
in one implementation without the other. It also makes the Tauri command layer
shallow: transport, SQL, filesystem behavior, and workflow orchestration are
frequently implemented in the same module.

## Decision

Rust is the canonical runtime for all persistent Folio domain behavior. Tauri
and a future headless CLI are adapters at the runtime seam; neither adapter owns
domain behavior. React and TypeScript own presentation state and view models,
but not persistence or filesystem workflows.

The target shape is:

```text
React UI
  -> generated TypeScript command/event contracts
  -> Rust native-contract module and Tauri adapter
  -> Rust domain modules
       - library and persistence
       - scanning and import
       - metadata enrichment
       - organizing
       - e-reader sync
  -> SQLite and filesystem

Rust CLI adapter
  -> the same Rust domain modules
```

Each Rust domain module must expose a small, transport-independent interface
that returns domain results. A separate Rust native-contract module at the
Tauri seam owns serialized data transfer objects plus command and event
identifiers. Tauri commands translate between those contract types and domain
results. Database connections, filesystem traversal, network providers, and
progress emission remain implementation details or internal seams of the
owning domain module.

### Ownership map

| Capability | Canonical owner | Decision for duplicate implementations |
| --- | --- | --- |
| Library scanning and file identity | Rust scanning domain module | **Keep and extract** the active `scan_folder` behavior. **Remove** the legacy `scanner::scan_library` command after caller verification. **Remove** `packages/core/src/scanner` after the Rust CLI adapter reaches parity. |
| SQLite persistence and schema migrations | Rust library/persistence domain module | **Keep and extract** the Rust migration runner and database access. **Migrate** SQL files from `packages/core/drizzle` to a Rust-owned migrations directory. **Remove** the Drizzle schema, migrator, and TypeScript database writer after the migration gate. |
| Book and author metadata enrichment | Rust metadata domain module | **Keep and extract** active Rust enrichment and author metadata behavior. **Compare** the existing Rust and TypeScript Apple Books implementations, **migrate** TypeScript fixtures/tests and only behavior missing from Rust, then **remove** `packages/core/src/enrichment` and duplicate metadata parsers after parity. |
| Organizing and import planning/application | Rust organizer/import domain modules | **Keep and extract** the active Rust plan/apply workflows. **Remove** `packages/core/src/organizer` after its observable behavior is covered by Rust tests. |
| E-reader synchronization | Rust e-reader domain module | **Keep and extract** the existing Rust implementation. There is no second production adapter to preserve. |
| Shared command and event contracts | Rust native-contract module at the Tauri seam | **Keep** domain results transport-independent. **Migrate** serialized command/event data transfer objects and identifiers to the Rust native-contract module and generate TypeScript declarations from it. **Remove** matching handwritten transport types from the frontend and `packages/core` once consumers use generated declarations. |
| UI-only state and view models | React/TypeScript | **Keep** in `apps/desktop/src`. These types may compose or format generated contracts but must not redefine persistent domain invariants. |
| `packages/core` command-line tools | Temporary TypeScript adapter | **Keep without new domain behavior** during migration. **Migrate** supported `scan`, `list`, and `enrich` commands to a Rust CLI adapter over the canonical modules, then **remove** `packages/core`. |

### Contract seam

The Rust native-contract module owns the serialized interface used by native
commands and events. It is part of the adapter seam, not a domain module.
TypeScript declarations are generated artifacts, not a second source of truth.
Generation must preserve:

- command and event names;
- camel-case payload field names already consumed by the frontend;
- nullable versus required fields;
- stable enum/string values;
- error messages intended for users versus internal diagnostic context.

UI-only types remain handwritten when they do not cross the native seam.

### Database seam

The production Folio database means the database in the desktop application's
app-data directory, or any database explicitly designated for use by a released
Folio desktop or Rust CLI build. TypeScript tools must never write that
database.

Until the Rust CLI replacement ships, the existing TypeScript CLI may continue
to write explicitly separate CLI-owned development or throwaway databases.
Those databases are not supported as production desktop databases. The writer
cutover occurs per database, not per command. A database must never be shared
between TypeScript and Rust CLI commands. Once a database is opened or converted
for the Rust CLI toolchain, every command that writes that database must use
Rust.

SQL migration files are append-only and are co-located with the Rust
persistence implementation after consolidation.

The database file format remains an internal persistence detail. Tauri and CLI
callers use domain interfaces rather than SQL or table-shaped results.

## Migration order

1. **Freeze and characterize**
   - Do not add new domain behavior to `packages/core`.
   - Record whether the existing TypeScript CLI has real users or automation.
   - Add characterization tests for scan identity, migration application,
     metadata merging, organizer planning/application, and CLI output that must
     survive.

2. **Remove unused wiring and legacy entry points**
   - Remove the unused `@folio/core` desktop dependency.
   - Verify there are no callers of `scanner::scan_library`, then remove that
     command and its legacy Rust database/model modules.
   - Keep command names used by the React frontend unchanged.

3. **Extract deep Rust domain modules**
   - Move implementation out of the Tauri command module without changing
     behavior.
   - Keep Tauri commands small: validate/translate input, run blocking work off
     the UI thread, call the domain interface, and translate the result.
   - Test through each domain module's interface with temporary SQLite databases
     and directories.

4. **Consolidate persistence**
   - Move the migration SQL into the Rust persistence module.
   - Reconcile both existing migration ledgers: Drizzle's
     `__drizzle_migrations` history and Rust's `schema_migrations` history.
     Detect and test Drizzle-only, Rust-only, combined, and partially applied
     databases before recording the canonical Rust history.
   - Run each migration and its ledger insert in one transaction.
   - Add a pre-migration backup or equivalent recoverable checkpoint and verify
     recovery from interrupted or invalid migration SQL.
   - Prove representative existing databases upgrade in place before deleting
     the Drizzle schema and migration scripts.

5. **Generate native contracts**
   - Introduce the Rust native-contract module at the Tauri seam.
   - Generate TypeScript command and event declarations from its contract types.
   - Migrate frontend consumers incrementally while retaining compatible command
     names and payloads.
   - Delete handwritten duplicates only after all consumers compile against the
     generated declarations.

6. **Port unique TypeScript behavior**
   - Compare provider and parser behavior already present in both runtimes.
   - Port only behavior that is not yet available in Rust, and migrate reusable
     TypeScript fixtures and characterization tests.
   - Run the same fixtures against the Rust interfaces and compare observable
     results before removing the TypeScript implementation.

7. **Replace the CLI adapter and retire `packages/core`**
   - Add a Rust CLI adapter only for commands confirmed to be required.
   - Verify output and exit-code compatibility where scripts depend on them.
   - Cut over all writing commands together for each CLI database; do not mix
     TypeScript and Rust commands against the same database.
   - Remove the TypeScript scanner, database, enrichment, organizer, CLI code,
     package dependency, and workspace package.

Steps may ship separately, but a capability must never have two authoritative
writers. Until its migration gate passes, the current production Rust behavior
wins conflicts.

## Compatibility constraints

- Existing Folio databases must upgrade in place; migrations are append-only
  and never rewrite or renumber released migrations.
- There must be exactly one migration runner and one writer for a production
  database in a process.
- Tauri command names, event names, and serialized payloads remain compatible
  until all frontend consumers migrate together.
- Scanning must preserve file identity, moved-file detection, ignored sidecar
  rules, and cancellation/progress behavior.
- Metadata migration must preserve source attribution, confidence/merge rules,
  rate limiting, and the distinction between suggestions and applied changes.
- Organizer migration must preserve plan-before-apply behavior, collision
  handling, copy/move semantics, and recovery logs.
- Blocking database, filesystem, parsing, and network work must not run on the
  Tauri UI thread.
- No removal step may land before its replacement passes tests at the owning
  module's interface.

## Consequences

### Positive

- Every persistent rule has one owner and one place to fix it.
- Tauri and CLI callers share behavior instead of sharing copied code.
- Generated contracts make drift across the native seam detectable at build
  time.
- Domain tests can exercise real SQLite and filesystem behavior without a GUI.
- The Tauri command module becomes an adapter rather than the domain
  implementation.

### Costs and risks

- Extracting the current Rust command module is substantial and must be
  incremental.
- Provider and parser parity must be demonstrated before TypeScript code is
  removed.
- Contract generation adds a build step that must be deterministic.
- Existing CLI users may require a compatibility window or a documented
  replacement.

## Rejected alternatives

### TypeScript as the canonical domain runtime

This would require moving the shipped desktop's active database, filesystem,
organizer, enrichment, and e-reader workflows across the native seam. It would
also retain native adapters for filesystem and device access, increasing the
interface without reducing the number of runtimes.

### Permanent dual implementations

Keeping Rust for desktop and TypeScript for CLI makes behavioral and schema
drift a permanent maintenance requirement. Cross-runtime conformance tests
would detect some drift but would not establish ownership.

### Shared handwritten contracts

A manually maintained TypeScript package still duplicates the Rust serialized
types. Generation from the owning runtime provides a single source of truth and
turns drift into a build failure.
