# Domain Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the Rust-owned domain database, identity, idempotency, and crash-safe clean-rebuild foundation required by Folio's simplified Save and File-operation model without switching production workflows to an incomplete schema.

**Architecture:** Add a focused `domain` module beside the current Tauri adapter. It owns database configuration, one squashed baseline, Library and Actor identities, accepted-command idempotency, and the rebuild phase marker. The existing application remains on its current database path until the final cutover phase; this foundation is exercised through Rust tests and explicit test paths, never by dual-writing production data.

**Tech Stack:** Rust 1.77.2, rusqlite 0.32 with bundled SQLite, serde/serde_json, uuid, sha2, walkdir, Tauri 2.9.6, cargo test.

**Spec:** [`CONTEXT.md`](../../../CONTEXT.md), [`ADR-0001`](../../adr/0001-runtime-and-schema-ownership.md), [`ADR-0002`](../../adr/0002-library-mutation-and-file-operation-persistence.md), [`ADR-0003`](../../adr/0003-rebuild-library-at-domain-model-cutover.md), and [`ADR-0004`](../../adr/0004-one-local-domain-host-for-every-client.md).

## Global Constraints

- Node is 22.x; pnpm is 10.28.2; TypeScript is 5.9.x; Tauri CLI is 2.9.6.
- Rust commands return contextual `Result` errors and never panic in normal flows.
- SQLite connections always enable foreign keys, WAL, and a bounded busy timeout.
- There is one Rust owner for production Library writes; TypeScript never opens new domain tables directly.
- Do not dual-write the legacy and domain schemas.
- Do not activate the clean cutover until Library mutation, File operation, desktop, organizer/e-reader, and headless adapters have migrated.
- The clean rebuild never mutates physical book files and never imports legacy catalog or queue rows.
- Use `spawn_blocking` when Tauri invokes database, scan, or filesystem-heavy work.
- Preserve unrelated dirty worktree changes and stage only files named by the current task.

## Program Sequence

This repository-wide change has independent review gates. Implement them in this order:

1. **Domain foundation — this plan:** database boundary, baseline schema, identities, idempotency, cutover marker, and rebuild-root scanning primitives.
2. **Library mutation and proposal plan:** Edit drafts, field-level Review, per-book Save transactions, mutation history, covers, Revert, and batch results.
3. **File-operation plan:** durable state machine, attempts, checkpoints, scheduler, safe publication, Recovery Bin, Retry, Reconcile, Locate, and Replace file.
4. **Desktop workflow plan:** single-book editor, batch editor, Library return anchor, Activity, Problems, and History projections.
5. **Organizer and e-reader plan:** migrate planning to the shared File-operation interface and remove their execution queues.
6. **Domain-host plan:** local authenticated host, generated schemas, CLI/MCP proposal-review-Save surface, pagination, actor identity, and idempotency.
7. **Cutover plan:** activate the clean rebuild, remove legacy Changes/direct writers, delete TypeScript ownership paths, and run the adversarial acceptance matrix from issue #28.

Each later plan consumes committed interfaces from its predecessor. Do not write all seven subsystems in one branch or activate a partial cutover.

---

### Task 1: Establish the Rust domain database boundary

**Files:**
- Create: `apps/desktop/src-tauri/src/domain/mod.rs`
- Create: `apps/desktop/src-tauri/src/domain/error.rs`
- Create: `apps/desktop/src-tauri/src/domain/db.rs`
- Modify: `apps/desktop/src-tauri/src/lib.rs`

**Interfaces:**
- Produces: `DomainError`, `DomainConnectionOptions`, `open_domain_connection(path, options)`.
- Consumes: only `rusqlite`, `std::path`, and existing dependency versions.

- [ ] **Step 1: Write connection tests before the module is exported**

Add these tests to `domain/db.rs`:

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn opens_with_required_sqlite_pragmas() {
        let db = tempfile_path("pragmas.sqlite");
        let conn = open_domain_connection(&db, DomainConnectionOptions::default()).unwrap();

        assert_eq!(conn.query_row("PRAGMA foreign_keys", [], |row| row.get::<_, i64>(0)).unwrap(), 1);
        assert_eq!(conn.query_row("PRAGMA journal_mode", [], |row| row.get::<_, String>(0)).unwrap(), "wal");
        assert_eq!(conn.query_row("PRAGMA busy_timeout", [], |row| row.get::<_, i64>(0)).unwrap(), 5_000);
    }

    #[test]
    fn reports_the_database_path_in_open_errors() {
        let result = open_domain_connection(
            std::path::Path::new("/definitely/missing-parent/domain.sqlite"),
            DomainConnectionOptions::default(),
        );
        let message = result.unwrap_err().to_string();
        assert!(message.contains("domain.sqlite"));
    }
}
```

Use a small `tempfile_path(name: &str) -> PathBuf` helper backed by `std::env::temp_dir()` and a UUID; remove the file at the end of the successful test. Do not add a dependency solely for test temp paths.

- [ ] **Step 2: Run the focused test and verify the missing-module failure**

Run:

```bash
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml domain::db::tests
```

Expected: compilation fails because `domain`, `DomainConnectionOptions`, and `open_domain_connection` do not exist.

- [ ] **Step 3: Implement the database boundary**

Define these exact public shapes:

```rust
#[derive(Debug, Clone, Copy)]
pub struct DomainConnectionOptions {
    pub busy_timeout_ms: u64,
}

impl Default for DomainConnectionOptions {
    fn default() -> Self {
        Self { busy_timeout_ms: 5_000 }
    }
}

pub fn open_domain_connection(
    path: &std::path::Path,
    options: DomainConnectionOptions,
) -> Result<rusqlite::Connection, DomainError>;
```

`open_domain_connection` must open the exact supplied path and then execute:

```sql
PRAGMA foreign_keys = ON;
PRAGMA journal_mode = WAL;
PRAGMA synchronous = FULL;
```

Set `busy_timeout` through rusqlite using `Duration::from_millis(options.busy_timeout_ms)`. `DomainError` must preserve a stable variant and human context:

```rust
pub enum DomainError {
    Database { context: String, source: rusqlite::Error },
    Io { context: String, source: std::io::Error },
    InvalidState { context: String },
    Validation { context: String },
}
```

Implement `Display` and `std::error::Error`; do not expose debug stack output as the user message.

- [ ] **Step 4: Export the module without changing existing `open_db` callers**

Add only:

```rust
mod domain;
```

near the existing Rust module declarations in `lib.rs`. Do not redirect current Tauri commands or migrations yet.

- [ ] **Step 5: Run the focused tests**

Run:

```bash
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml domain::db::tests
```

Expected: both tests pass.

- [ ] **Step 6: Commit the boundary**

```bash
git add apps/desktop/src-tauri/src/domain apps/desktop/src-tauri/src/lib.rs
git commit -m "refactor: establish domain database boundary"
```

---

### Task 2: Add the squashed domain baseline

**Files:**
- Create: `apps/desktop/src-tauri/src/domain/schema.rs`
- Create: `apps/desktop/src-tauri/src/domain/schema/0000_domain_baseline.sql`
- Create: `apps/desktop/src-tauri/src/domain/identity.rs`
- Modify: `apps/desktop/src-tauri/src/domain/mod.rs`
- Test: `apps/desktop/src-tauri/src/domain/schema.rs`

**Interfaces:**
- Consumes: `open_domain_connection` from Task 1.
- Produces: `initialize_domain_schema(&mut Connection) -> Result<LibraryIdentity, DomainError>`, `read_library_identity(&Connection)`.

- [ ] **Step 1: Write failing baseline tests**

Test a fresh connection with these assertions:

```rust
const REQUIRED_TABLES: &[&str] = &[
    "domain_migrations",
    "libraries",
    "actors",
    "accepted_commands",
    "rebuild_roots",
    "rebuild_file_observations",
];
```

Assert every name exists in `sqlite_schema`, `PRAGMA foreign_key_check` returns no rows, exactly one `libraries` row exists, and reopening does not create a second Library identity.

- [ ] **Step 2: Run the test and verify failure**

```bash
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml domain::schema::tests
```

Expected: FAIL because `initialize_domain_schema` and the baseline SQL do not exist.

- [ ] **Step 3: Create the baseline schema with explicit invariants**

Use this foundation schema exactly; later implementation plans extend this same unreleased baseline before the production cutover:

```sql
CREATE TABLE domain_migrations (
  id TEXT PRIMARY KEY NOT NULL,
  applied_at_ms INTEGER NOT NULL
);

CREATE TABLE libraries (
  id TEXT PRIMARY KEY NOT NULL,
  schema_version INTEGER NOT NULL CHECK (schema_version = 1),
  created_at_ms INTEGER NOT NULL
);

CREATE TABLE actors (
  id TEXT PRIMARY KEY NOT NULL,
  installation_id TEXT NOT NULL UNIQUE,
  created_at_ms INTEGER NOT NULL
);

CREATE TABLE accepted_commands (
  id TEXT PRIMARY KEY NOT NULL,
  library_id TEXT NOT NULL REFERENCES libraries(id),
  actor_id TEXT NOT NULL REFERENCES actors(id),
  command_kind TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  canonical_payload TEXT NOT NULL,
  result_json TEXT,
  accepted_at_ms INTEGER NOT NULL,
  completed_at_ms INTEGER,
  UNIQUE (library_id, actor_id, command_kind, idempotency_key)
);

CREATE TABLE rebuild_roots (
  id TEXT PRIMARY KEY NOT NULL,
  library_id TEXT NOT NULL REFERENCES libraries(id),
  canonical_path TEXT NOT NULL,
  ordinal INTEGER NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('pending', 'running', 'needs_attention', 'complete', 'removed')),
  cursor_json TEXT,
  error_json TEXT,
  UNIQUE (library_id, canonical_path),
  UNIQUE (library_id, ordinal)
);

CREATE TABLE rebuild_file_observations (
  id TEXT PRIMARY KEY NOT NULL,
  rebuild_root_id TEXT NOT NULL REFERENCES rebuild_roots(id),
  canonical_path TEXT NOT NULL,
  filesystem_identity TEXT,
  size_bytes INTEGER NOT NULL CHECK (size_bytes >= 0),
  modified_at_ms INTEGER NOT NULL,
  sha256 TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('stable', 'deferred', 'problem')),
  UNIQUE (rebuild_root_id, canonical_path)
);

CREATE INDEX accepted_commands_lookup
  ON accepted_commands(library_id, actor_id, command_kind, idempotency_key);
CREATE INDEX rebuild_roots_work
  ON rebuild_roots(library_id, state, ordinal);
CREATE INDEX rebuild_observations_identity
  ON rebuild_file_observations(rebuild_root_id, filesystem_identity);
```

Define the Library identity before `initialize_domain_schema`:

```rust
#[derive(Debug, Clone, PartialEq, Eq, Hash, serde::Serialize, serde::Deserialize)]
pub struct LibraryIdentity(pub String);
```

- [ ] **Step 4: Implement idempotent initialization**

`initialize_domain_schema` must use one immediate transaction, apply only migration `0000_domain_baseline`, insert one UUID Library identity on first creation, commit, and return that identity. Reopening returns the existing identity. A second Library row is an `InvalidState` error.

- [ ] **Step 5: Run schema tests and inspect the schema**

```bash
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml domain::schema::tests
```

Expected: all schema, constraint, and reopen tests pass.

- [ ] **Step 6: Commit the baseline**

```bash
git add apps/desktop/src-tauri/src/domain
git commit -m "feat: add squashed domain schema baseline"
```

---

### Task 3: Persist Actor and accepted-command idempotency

**Files:**
- Create: `apps/desktop/src-tauri/src/domain/identity.rs`
- Create: `apps/desktop/src-tauri/src/domain/idempotency.rs`
- Modify: `apps/desktop/src-tauri/src/domain/mod.rs`
- Test: `apps/desktop/src-tauri/src/domain/idempotency.rs`

**Interfaces:**
- Consumes: `LibraryIdentity`, the baseline `actors` and `accepted_commands` tables.
- Produces: `ActorIdentity`, `CommandIdentity`, `AcceptedCommandRepository::accept`.

- [ ] **Step 1: Write idempotency contract tests**

Cover these exact scenarios:

```rust
assert!(matches!(repo.accept(first.clone()).unwrap(), AcceptResult::Accepted { .. }));
assert!(matches!(repo.accept(first.clone()).unwrap(), AcceptResult::Replay { .. }));
assert!(matches!(repo.accept(changed_payload).unwrap_err(), DomainError::Validation { .. }));
```

Start two connections and two threads with the same Library, Actor, command kind, key, and canonical payload. Assert one durable row exists and both calls return the same command identity. Also assert an invalid command rejected by a supplied validation closure creates no row and the corrected request may reuse its key.

- [ ] **Step 2: Verify tests fail**

```bash
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml domain::idempotency::tests
```

Expected: compilation fails for missing repository types.

- [ ] **Step 3: Implement exact identity types**

```rust
#[derive(Debug, Clone, PartialEq, Eq, Hash, serde::Serialize, serde::Deserialize)]
pub struct ActorIdentity(pub String);

#[derive(Debug, Clone, PartialEq, Eq, Hash, serde::Serialize, serde::Deserialize)]
pub struct CommandIdentity(pub String);

pub struct AcceptCommand<'a> {
    pub library: &'a LibraryIdentity,
    pub actor: &'a ActorIdentity,
    pub command_kind: &'a str,
    pub idempotency_key: &'a str,
    pub canonical_payload: &'a str,
}

pub enum AcceptResult {
    Accepted { command: CommandIdentity },
    Replay { command: CommandIdentity, result_json: Option<String> },
}
```

Canonical payload equality must be byte equality over canonical JSON generated before `accept`. Claim the key only inside the durable acceptance transaction. Map uniqueness races by rereading the winner and comparing payloads; never run a second command.

- [ ] **Step 4: Run the focused tests**

```bash
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml domain::idempotency::tests
```

Expected: replay, changed-intent conflict, validation reuse, and concurrent-join tests pass.

- [ ] **Step 5: Commit identities and idempotency**

```bash
git add apps/desktop/src-tauri/src/domain
git commit -m "feat: persist domain command identities"
```

---

### Task 4: Implement the crash-safe cutover coordinator

**Files:**
- Create: `apps/desktop/src-tauri/src/domain/rebuild.rs`
- Modify: `apps/desktop/src-tauri/src/domain/mod.rs`
- Test: `apps/desktop/src-tauri/src/domain/rebuild.rs`

**Interfaces:**
- Consumes: domain schema initialization and explicit filesystem paths.
- Produces: `RebuildCoordinator`, `RebuildMarker`, `CutoverPhase`, `CutoverPaths`.

- [ ] **Step 1: Write phase-recovery tests**

Model and test every durable phase:

```rust
pub enum CutoverPhase {
    PreflightComplete,
    LegacyCheckpointed,
    BackupCreated,
    DomainDatabaseValidated,
    DomainDatabasePublished,
    CacheBackupPending,
    Complete,
}
```

For each phase, write a marker, recreate the coordinator as if after process restart, call `recover()`, and assert it chooses exactly one of:

```rust
pub enum RecoveryDecision {
    KeepLegacyCanonical,
    PublishValidatedDomainDatabase,
    KeepPublishedDomainDatabase,
}
```

Also assert preflight rejects an empty root set, overlapping roots are canonicalized and deduplicated, an inaccessible root fails before backup, and no book file under a confirmed root is modified.

- [ ] **Step 2: Run and observe the missing implementation failure**

```bash
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml domain::rebuild::tests
```

- [ ] **Step 3: Implement durable marker writes**

Use this serialized marker shape:

```rust
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct RebuildMarker {
    pub cutover_id: String,
    pub phase: CutoverPhase,
    pub legacy_database: PathBuf,
    pub backup_database: PathBuf,
    pub temporary_domain_database: PathBuf,
    pub canonical_database: PathBuf,
    pub confirmed_roots: Vec<PathBuf>,
    pub updated_at_ms: i64,
}
```

Write marker changes to a sibling temporary file, call `sync_all`, rename within the marker directory, and sync the parent directory where the platform supports it. Never overwrite a marker in place.

- [ ] **Step 4: Implement the cutover sequence**

The coordinator must perform this exact order:

1. Canonicalize, overlap-deduplicate, and verify all confirmed roots.
2. Acquire the exclusive domain-host lock supplied by the caller.
3. Checkpoint the legacy WAL with `PRAGMA wal_checkpoint(TRUNCATE)`.
4. Copy the closed/checkpointed database to a timestamped backup and verify size plus SHA-256.
5. Create and initialize the temporary domain database.
6. Run `PRAGMA integrity_check` and `PRAGMA foreign_key_check` on the temporary database.
7. Rename the temporary database atomically to the canonical path.
8. Preserve the legacy backup and expose its path; never open it through the domain schema.
9. Mark cache backup pending outside the critical database publication section.

Marker advancement occurs only after the corresponding durable effect. A startup with an intact legacy canonical database before publication keeps it; a startup after publication keeps only the validated domain database.

- [ ] **Step 5: Run crash-point tests**

```bash
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml domain::rebuild::tests
```

Expected: every phase recovery test passes and no test leaves both databases ambiguously canonical.

- [ ] **Step 6: Commit the coordinator**

```bash
git add apps/desktop/src-tauri/src/domain
git commit -m "feat: add crash-safe library cutover coordinator"
```

---

### Task 5: Add resumable rebuild-root scanning primitives

**Files:**
- Create: `apps/desktop/src-tauri/src/domain/rebuild_scan.rs`
- Modify: `apps/desktop/src-tauri/src/domain/mod.rs`
- Test: `apps/desktop/src-tauri/src/domain/rebuild_scan.rs`

**Interfaces:**
- Consumes: confirmed canonical roots from `RebuildMarker`.
- Produces: `RebuildScanRepository`, `RootScanState`, `StableFileObservation`, `observe_stable_file`.

- [ ] **Step 1: Write scanner behavior tests**

Use temporary roots to assert:

- reachable roots continue when another root becomes unavailable;
- an unavailable root becomes `needs_attention` without changing completed roots;
- retry resumes from its stored cursor;
- explicit root removal preserves observations already committed;
- a file changed between pre- and post-extraction stat becomes `deferred`;
- a second unstable observation becomes `problem`;
- the same filesystem identity through two aliases yields one observation;
- equal hashes at two distinct filesystem identities yield two observations.

- [ ] **Step 2: Run the tests and observe failure**

```bash
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml domain::rebuild_scan::tests
```

- [ ] **Step 3: Implement stable observation**

```rust
pub struct StableFileObservation {
    pub canonical_path: PathBuf,
    pub filesystem_identity: Option<String>,
    pub size_bytes: u64,
    pub modified_at_ms: i64,
    pub sha256: String,
}

pub fn observe_stable_file<T>(
    path: &Path,
    extract: impl FnOnce(&Path) -> Result<T, DomainError>,
) -> Result<(StableFileObservation, T), ObservationError>;

pub enum ObservationError {
    ChangedDuringRead,
    Domain(DomainError),
}
```

Read metadata before extraction, calculate SHA-256 while reading the content used by extraction, then read metadata again. Treat size or modification-time changes as `ChangedDuringRead`. Do not infer book identity or import metadata in this task; the Library-mutation plan consumes only stable observations.

- [ ] **Step 4: Run scanner and schema tests**

```bash
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml domain::
```

Expected: independent-root, resume, instability, alias, and distinct-copy tests pass.

- [ ] **Step 5: Commit the scanning primitives**

```bash
git add apps/desktop/src-tauri/src/domain
git commit -m "feat: add resumable rebuild scanning primitives"
```

---

### Task 6: Verify the foundation without activating production cutover

**Files:**
- Modify: `AGENTS.md`
- Modify only if needed for module registration: `apps/desktop/src-tauri/src/lib.rs`

**Interfaces:**
- Consumes: all Task 1-5 interfaces.
- Produces: a documented focused test command and a stable seam for the next Library-mutation plan.

- [ ] **Step 1: Add the focused test command to `AGENTS.md`**

Under Tests, add:

```markdown
- Domain foundation tests: `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml domain::`.
```

- [ ] **Step 2: Run formatting**

```bash
cargo fmt --manifest-path apps/desktop/src-tauri/Cargo.toml -- --check
```

If it reports differences, run the same command without `--check`, inspect the domain-only diff, and rerun the check.

- [ ] **Step 3: Run the foundation suite**

```bash
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml domain::
```

Expected: every domain foundation test passes.

- [ ] **Step 4: Run the existing Rust suite**

```bash
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml
```

Expected: existing metadata, retry, parser, organizer, and e-reader tests remain green. The production `open_db` path still uses the existing application database.

- [ ] **Step 5: Run repository verification**

```bash
pnpm check
```

Expected: lint, TypeScript builds/tests, core tests, provider tests, and Rust tests pass.

- [ ] **Step 6: Inspect for forbidden partial activation**

```bash
rg -n "open_domain_connection|initialize_domain_schema|RebuildCoordinator" apps/desktop/src-tauri/src
```

Expected: references are confined to `domain/`, tests, and module registration. No existing Tauri command, CLI, MCP, or production startup path invokes cutover yet.

- [ ] **Step 7: Commit verification documentation**

```bash
git add AGENTS.md apps/desktop/src-tauri/src/domain apps/desktop/src-tauri/src/lib.rs
git commit -m "test: verify domain foundation"
```

## Self-Review Record

- **Spec coverage:** This phase covers the one-owner database boundary, squashed baseline, Library/Actor/idempotency identities, crash-safe pre-domain cutover primitives, and resumable root observation. Save semantics, File execution, UI, organizer/e-reader migration, and host adapters are explicitly sequenced as separate plans because they have independent review gates.
- **Completeness scan:** Every task names files, interfaces, commands, and expected outcomes; no unresolved implementation markers remain.
- **Type consistency:** `DomainError`, `LibraryIdentity`, `ActorIdentity`, `CommandIdentity`, `RebuildMarker`, and `StableFileObservation` are introduced once and consumed by exact name in later tasks.
