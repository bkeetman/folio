# ADR-0002: Library mutation and file-operation persistence

- Status: Accepted
- Date: 2026-08-29
- Tracking issue: [#38](https://github.com/bkeetman/folio/issues/38)

## Context

Folio previously represented metadata writes, EPUB rewrites, organizer actions,
and e-reader copies in several heterogeneous queues. That made Save ambiguous,
mixed Library state with physical execution, and made retries unsafe after an
uncertain filesystem outcome. Folio needs durable history and recoverable
background work without turning the entire application into an event-sourced
system.

## Decision

Every effective Save commits one immutable Library mutation per book and
increments that book's monotone Library version. One Save correlation groups
the independent per-book results of a single-book or batch action. Commands
carry an idempotency identity: replaying identical intent returns the original
result, while different intent under the same identity is rejected.

The same per-book transaction records the new Library state, changed fields
with copied before-and-after provenance, cover asset references, proposal
outcomes, immutable Desired file-state revisions, and any safe File operations
required to realize those revisions, together with that book's durable Save
result. Batch Save uses an independent transaction per book. No physical file
side effect occurs inside this transaction. File operations target stable
Managed-file or Device-copy identities; paths and fingerprints are
preconditions, never identity.

Save uses field-level optimistic concurrency. When the Library version changed,
fields untouched by the draft are rebased onto the latest version. Only a draft
field whose current value also differs from its expected value becomes a Save
conflict.

Cover assets are immutable and content-addressed. Review places a candidate in
temporary staging and validates it. Before Save, Folio publishes the asset
durably under its content identity; the successful Save transaction only adds
the reference. An unreferenced asset left by a crash is harmless and may be
garbage-collected. Assets remain while referenced by current Library state,
mutation or Revert history, or Desired file state. Reverting Library values
creates a new mutation and never rewrites history; Series and Series position
are restored as one consistency group. Restoring a physical EPUB uses its
separate Recovery copy.

Proposal review maps provider genres to the controlled Category vocabulary and
requires explicit intent to create an unmatched Author. Unknown Categories are
not created implicitly. Merely inspecting a review does not change proposal
state; confirming a review may resolve an already-equal field as `satisfied`.
Only valid high-confidence additions to empty fields may be selected by default,
and confidence never authorizes Save.

File operations use one authoritative current row plus append-only transition,
attempt, and checkpoint records. Their lifecycle is `queued` to `running`, then
`succeeded`, `failed`, or `needs_reconciliation`; queued work may also become
`superseded`. An Operation blocker can make queued work temporarily
unclaimable. A newer Desired file-state revision supersedes older waiting safe
work, while a running operation may produce at most one follow-up operation.
Destructive work never coalesces.

Only the owning Rust File-operation module changes operation state, using
compare-and-swap transitions. Its scheduler claims executable work atomically
with a worker identity, unique claim token, and short lease. Every claim creates
an immutable Operation attempt. External side effects append durable
checkpoints for verified preconditions, a durable Recovery copy when required,
validated staging, publication, target verification, and source retirement when
required. Staging is flushed and validated on the target filesystem before an
atomic same-directory rename. Paths are canonicalized using the target
filesystem's case and Unicode behavior and a resolved parent directory; a target
itself may not be a symlink. Any collision or fingerprint change since preview
makes only that action stale and returns it to review. Folio never derives a new
name or overwrite implicitly. An expired running lease is inspected and may become
`needs_reconciliation`; it is never blindly requeued. Retry is permitted only
when Folio can prove no effect occurred and original preconditions still hold;
it transitions the same failed operation back to `queued` and the next claim
creates a new immutable attempt. Reconcile records the conclusion of an
uncertain operation and creates a linked new operation when follow-up work is
required.

A move, delete, or overwrite that displaces a different existing target requires
an immutable Destructive confirmation containing the reviewed plan, exact
action, target fingerprints, actor, and time. Replacing bytes of the same
fingerprint-validated Managed file or Device copy is a safe File task. A
destructive File operation is created only after confirmation, and the
confirmation becomes unusable when its preconditions change rather than merely
because time passes.

Recovery copies live in a Folio-managed Recovery Bin on the source filesystem.
Required capacity is verified before changing the source, and the 30-day
retention period begins only when the operation succeeds. Cleanup waits while a
volume is unavailable. A successful Organizer copy creates a new Managed-file
identity for the same book; a move preserves the original identity and changes
its observed path only after physical success.

A missing Managed file leaves Library membership intact and produces a Problem;
removing membership is a separate action. Membership removal supersedes queued
safe file work and waits for running safe work to finish or require Reconcile.
Confirmed destructive work must finish or be explicitly cancelled before
membership ends. If an e-reader disappears before publication, its work becomes
blocked waiting for that exact device. Disconnection after possible publication
requires Reconcile against the same device identity.

Library mutations, field evidence, proposal decisions, Save correlations, and
idempotency identities are retained with Library history. Detailed operation
transitions, attempts, and checkpoints remain available for 30 days after
resolution and may then compact into a permanent immutable summary. Recovery
copies may be removed after 30 days, but their tombstones and operation
summaries remain. Activity and Problems are projections: Problems derive from
failed or inconsistent operations, while notification seen/dismissed state is
stored separately.

The external Rust seams are two deep modules. The Library-mutation module owns
Save, Revert, and mutation history. The File-operation module owns destructive
confirmation, recovery actions, Activity, and scheduler execution. Tauri and a
future CLI are adapters over the same interfaces. The transaction seam used by
Save is internal so callers cannot partially record Library state and file
intent.

Cutover from the pre-domain database is governed by ADR-0003 and deliberately
does not translate legacy queues or catalog history into this model. The Rust
migration runner must still apply future migrations and their ledger markers
atomically and configure foreign keys, WAL, and a busy timeout.

## Consequences

Save becomes the single commit point for Library truth while filesystem work
can remain asynchronous and observable. Durable intent, claims, and checkpoints
make crash recovery and Retry decisions evidence-based. The cost is a richer
schema and a one-time clean rebuild from the pre-domain database, but callers
see two small interfaces rather than queue-specific rules.

## Rejected alternatives

A single heterogeneous Changes queue preserves the ambiguity between proposed,
committed, and executed work. Full event sourcing would add projection and
replay complexity beyond Folio's needs. Path-addressed tasks and blind retries
cannot safely distinguish moved, externally modified, or partially published
files.
