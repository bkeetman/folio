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
returns a durable review identity bound to selected values and expected Library
versions. Only a distinct Save with that review identity and a caller-supplied
idempotency identity creates per-book Library mutations. The host records a
Save correlation and its per-book intents before processing, resumes unfinished
results after a crash, and never reprocesses completed results. Save cannot be
cancelled after it starts.

CLI and MCP machine contracts are generated from the same Rust types and JSON
Schemas. Responses use a versioned data-or-error envelope; business outcomes
remain structured results. Completed Save correlations retain a permanent
summary, while detailed progress may compact after 30 days.

## Consequences

CLI and MCP no longer work as independent SQLite utilities, and the direct
`changes apply`, metadata-apply, and enrichment-write routes disappear at the
clean baseline. In return, every entry point shares one concurrency model, one
proposal lifecycle, one Save contract, one scheduler, and one versioned machine
interface.
