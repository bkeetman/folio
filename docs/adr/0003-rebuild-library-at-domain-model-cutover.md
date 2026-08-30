# ADR-0003: Rebuild the Library at the domain-model cutover

- Status: Accepted
- Date: 2026-08-30
- Tracking issue: [#29](https://github.com/bkeetman/folio/issues/29)
- Supersedes: the legacy migration and version-zero baseline decision in ADR-0002

## Context

Folio has not been distributed widely, and its current catalog can be regenerated
from the user's book files. Translating heterogeneous legacy queues, incomplete
history, uncertain filesystem effects, and two migration ledgers into the new
domain model would add permanent compatibility complexity for data that does not
need to survive.

## Decision

When Folio encounters the pre-domain schema, it offers one explicit
**Back up and rebuild Library** cutover. After confirmation it preserves the old
database as a timestamped backup, creates a fresh database containing only the
new schema, and asks the user to confirm the book folder used to rebuild the
Library. The latest legacy scan or organizer root may prefill that picker only
as a suggestion. It does not migrate legacy catalog metadata, tags, categories,
cover choices, proposals, history, problems, queues, operation records,
organizer settings, metadata-source settings, or e-reader configuration.

The cutover never moves, rewrites, or deletes book files. Legacy queue commands,
tables, adapters, and executors are removed from the active design rather than
dual-written or retained behind compatibility seams. The backup is a recovery
artifact for the old application, not an import source for the new model.

Database creation is atomic and produces a valid empty Library before scanning.
The subsequent scan is a normal resumable import with visible progress, so an
interruption can be continued without repeating cutover. Derived `covers` and
`author-photos` caches move beside the timestamped backup; `imports` and all
user book locations remain untouched. Existing WebView presentation preferences
remain outside this database boundary.

The new schema starts from one squashed baseline and one Rust-owned migration
ledger. Future schema versions use atomic in-place migrations from that baseline.
The pre-rebuild database and derived-cache backup is retained for 30 days, its
exact location is shown after cutover, and it may then be removed automatically.

## Consequences

Users of the pre-domain build must regenerate their Library and lose database-only
customization and reconfigure organizer, metadata sources, and e-readers. In
return, the production model starts from one coherent schema, one migration
ledger, and no executable legacy ambiguity. Future schema versions still migrate
atomically in place; this clean rebuild is a one-time cutover only.
