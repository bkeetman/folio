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
new schema, and rebuilds the Library by scanning the user's book files. It does
not migrate legacy catalog metadata, tags, categories, cover choices, proposals,
history, problems, queues, or operation records.

The cutover never moves, rewrites, or deletes book files. Legacy queue commands,
tables, adapters, and executors are removed from the active design rather than
dual-written or retained behind compatibility seams. The backup is a recovery
artifact for the old application, not an import source for the new model.

## Consequences

Users of the pre-domain build must regenerate their Library and lose database-only
customization. In return, the production model starts from one coherent schema,
one migration ledger, and no executable legacy ambiguity. Future schema versions
still migrate atomically in place; this clean rebuild is a one-time cutover only.
