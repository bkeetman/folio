# ADR-0004: One local domain host for every client

- Status: Accepted
- Date: 2026-08-30
- Tracking issue: [#39](https://github.com/bkeetman/folio/issues/39)

## Context

Folio's existing TypeScript CLI and MCP server open SQLite directly and combine
proposal application with canonical metadata writes. Keeping that path beside
the Rust desktop domain would recreate multiple meanings for Save, conflict,
idempotency, background work, and machine output.

## Decision

Exactly one local Rust Domain host owns each production Library. Desktop, CLI,
and MCP attach through a user-only local socket or named pipe and call the same
proposal, Library-mutation, and File-operation modules. An OS lock prevents a
second host; clients never fall back to direct SQLite access. Development and
tests may choose an explicit alternate data directory, but production commands
do not accept arbitrary database paths.

The host starts on demand, remains while clients are connected or executable
work is running, and may stop after an idle grace period. Durable queued work
resumes on the next start. A versioned handshake rejects incompatible clients.
The local transport uses OS permissions and an installation-bound credential.

Headless writes preserve the interactive Edit draft boundary. Draft review
returns a durable review identity bound to selected values and their expected
field values. Unrelated Library changes are rebased; an overlapping change
returns `Needs review` for only that book. `review_invalid` is reserved for an
unknown, discarded, consumed, tampered, or different-Library identity. A batch
review identity contains independent per-book segments so one stale target
cannot block unrelated books. Only a distinct Save with that review identity and
a caller-supplied idempotency identity creates per-book Library mutations. The
host records a Save correlation and its per-book intents before processing,
resumes unfinished results after a crash, and never reprocesses completed
results. Save cannot be cancelled after it starts. A correlation is
`running`, `resolved`, or `needs_attention` and reports counts for unfinished
and every per-book outcome. Its per-book order is frozen before execution so
paginated results remain stable. Unresolved results expose Review latest, Save
again with new review evidence and idempotency, and Discard unresolved; none
blindly repeats prior intent. CLI exposes these through `folio saves
show|recover|discard`; MCP exposes `get_save_result`, `recover_save_result`, and
`discard_save_result`. Recovery creates a new Edit draft, after which the normal
review and Save commands remain mandatory. Recover and discard require explicit
book identities or `allUnresolved: true`. Recovery returns a new draft identity;
its eventual Save correlation retains lineage to the original correlation.
Discard closes only the selected recovery actions and never rewrites immutable
Save results or open proposal fields.

CLI and MCP machine contracts are generated from the same Rust types and JSON
Schemas. Responses use a versioned data-or-error envelope; business outcomes
remain structured results. Completed Save correlations retain a permanent
summary, while detailed progress may compact after 30 days. Adapters may repeat
the same idempotent Save for classified transient SQLite-busy or local-transport
failures, but stop after three total attempts or two seconds. Validation,
conflict, and permanent storage failures are never retried automatically.
General Library cursors are bound to a Library revision and return
`cursor_stale` after that revision changes. Save-result cursors instead use the
correlation's immutable intent order.

One installation-bound local Actor owns decisions across desktop, CLI, MCP, and
host restarts; ephemeral sessions remain separate audit evidence. Idempotency is
scoped by Library identity, Actor, and command kind. A command rejected before
durable acceptance does not claim its identity. Once accepted, canonical intent
and result remain with Library history. Concurrent identical commands join one
execution, while a reused identity with different canonical intent returns
`idempotency_conflict`. A clean rebuild creates a new Library identity.

Machine errors contain a stable code, human message, retryability of `never`,
`same_request`, or `after_user_action`, and optional code-specific details. The
envelope always identifies its schema and request. Per-book Save outcomes remain
data rather than errors. The initial stable codes are `invalid_request`,
`not_found`, `review_invalid`, `cursor_stale`, `idempotency_conflict`,
`precondition_changed`, `temporarily_unavailable`, `host_unavailable`,
`protocol_incompatible`, `storage_unavailable`, `permission_denied`,
`invariant_violation`, and `internal`.

## Consequences

CLI and MCP no longer work as independent SQLite utilities, and the direct
`changes apply`, metadata-apply, and enrichment-write routes disappear at the
clean baseline. In return, every entry point shares one concurrency model, one
proposal lifecycle, one Save contract, one scheduler, and one versioned machine
interface.
