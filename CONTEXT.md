# Folio

Folio manages a library of books and keeps its catalog state and physical book files deliberately distinguishable.

## Language

**Library**:
The canonical catalog of books, metadata, covers, and known files. After Save, the Library is the source of truth even while derived file work is still running.
_Avoid_: Database, collection state

**Library membership**:
Whether Folio actively manages a book. Removing Library membership does not move or delete any physical file.
_Avoid_: File existence, deletion

**Library workspace**:
The current discovery context of query, filters, ordering, presentation, explicit selection, and return position within the Library.
_Avoid_: Search page, filter state

**Covers view**:
The calm, visual presentation of a Library workspace in which book covers are the primary browsing affordance.
_Avoid_: Grid page, card mode

**Details view**:
The compact presentation of the same Library workspace in which a result table and focused book inspection remain visible together.
_Avoid_: List page, workbench mode

**Result set**:
The books currently shown by the Library workspace after applying its query, filters, and ordering. It is distinct from the books explicitly selected for batch work.
_Avoid_: Library, selection

**Batch selection**:
The explicit set of books chosen for one batch workflow. It may include books outside the current Result set and never implicitly expands when that Result set changes.
_Avoid_: Current results, filtered books

**Batch field operation**:
An explicit instruction in an Edit draft that preserves, replaces, clears, adds, or removes a field value for every book in the Batch selection. Blank input is never itself an operation.
_Avoid_: Bulk patch, implicit clear

**Mixed field value**:
The state in which books in a Batch selection do not share the same value for a field. It conveys variation rather than an edit and remains preserved until an explicit Batch field operation changes it.
_Avoid_: Empty value, unknown value

**Individual-only field**:
A field whose intended value must be chosen for each book separately and therefore cannot receive a Batch field operation.
_Avoid_: Unsupported field, disabled field

**Edit draft**:
The unsaved metadata and cover choices being composed for one or more books. An edit draft ends at one explicit Save or Cancel boundary.
_Avoid_: Pending change, queued change

**Library mutation**:
A change committed to the Library by Save. It is distinct from the file operations derived from it.
_Avoid_: Change, pending change

**Mutation field**:
The immutable before-and-after evidence for one field changed by a Library mutation, including the value's origin and the reason it was chosen.
_Avoid_: Current field source, change field

**Library version**:
A monotone per-book revision identifying the Library state produced by a successful effective Save.
_Avoid_: Updated time, database version

**Save correlation**:
The durable identity grouping all independent per-book results created by one explicit single-book or batch Save action.
_Avoid_: Batch transaction, queue group

**Idempotency identity**:
A caller-supplied identity that makes replaying the same command return its original result while rejecting different intent under the same identity.
_Avoid_: Request ID, operation ID

**Cover asset**:
An immutable, content-addressed cover image that may be referenced by Library mutations and Desired file states.
_Avoid_: Cover file, current cover row

**Managed file**:
A physical book file known to the Library by a stable identity. Its path and fingerprint are observed attributes and may change without changing that identity.
_Avoid_: File path, Library item

**Metadata candidate**:
An ephemeral metadata or cover result returned by an external provider. It is not targeted durable intent and may be copied into an edit draft.
_Avoid_: Proposal, match, metadata change

**Metadata proposal**:
A durable, immutable, and reviewable set of field-level metadata or cover suggestions for one book at a specific Library version. Choosing its values only updates an edit draft; review decisions are recorded separately, and it is not Library state until Save.
_Avoid_: Candidate, metadata change, automatic fix

**Proposal field**:
One immutable suggested value within a metadata proposal, carrying its expected value, provenance, confidence, and independent review outcome.
_Avoid_: Change field, patch

**Metadata confidence**:
A Folio-calibrated category describing the strength of evidence for a suggested or stored value. It informs review but never grants permission to write.
_Avoid_: Provider score, trust, auto-accept

**File operation**:
A persistent unit of work that changes or reconciles physical book files. It is the common lifecycle behind automatic file tasks and confirmed destructive file operations.
_Avoid_: Change, queue entry

**Operation attempt**:
One immutable scheduler claim and execution try for a File operation, with its own worker identity, checkpoints, and result.
_Avoid_: Retry, job run

**Operation blocker**:
A current external condition, such as an absent e-reader, that keeps a queued File operation from being executable without making it a Problem.
_Avoid_: Waiting state, error

**Desired file state**:
A versioned description of the metadata, cover, location, and presence that a managed physical file should have according to the Library and any confirmed destructive file operation.
_Avoid_: Pending change, target change

**File task**:
An automatically started file operation that brings a physical book file into agreement with its desired file state, such as writing EPUB metadata or a cover.
_Avoid_: Change, pending change, sync change

**Destructive file operation**:
A file operation for moving, overwriting, or deleting physical files that requires an explicit preview and confirmation before execution.
_Avoid_: File task

**Destructive confirmation**:
Immutable evidence authorizing one reviewed move, overwrite, or delete only while its exact recorded preconditions still hold.
_Avoid_: Approval flag, confirmed state

**Organizer plan**:
A reviewable set of exact copy or move destinations derived from the current Library and physical files. It creates durable File operations only after confirmation.
_Avoid_: Organizer changes, rename queue

**Device copy**:
A physical derivative of a Library file placed on a specific e-reader. It never owns Library membership or change the known path of the Library file.
_Avoid_: Synced Library file, managed source

**Recovery Bin**:
Folio-managed temporary storage for removed or replaced local book files, retained for 30 days so the physical action can be restored independently of Library history.
_Avoid_: Trash, backup folder, deleted files

**Recovery copy**:
The exact prior physical version of a rewritten, replaced, or overwritten local book file held in the Recovery Bin. Restoring it is separate from reverting Library metadata.
_Avoid_: Backup, file undo, Library revert

**Activity**:
A user-facing projection of running or recently completed file operations. Activity describes execution but does not own or queue that work.
_Avoid_: Changes, queue

**Problem**:
A user-facing projection of a failed operation or inconsistent Library and file state that needs a concrete recovery action, such as Retry, Locate, or Reconcile.
_Avoid_: Error row, failed change

**Retry**:
Repeat a File operation only after Folio has proved that the earlier attempt changed nothing and its original preconditions still hold.
_Avoid_: Reapply, resume, try again

**Reconcile**:
Compare the actual file state with the desired file state after divergence or an uncertain outcome, then resolve the difference or derive safe follow-up work.
_Avoid_: Retry, force apply

**Revert**:
A new Library mutation that restores selected values from an earlier recorded state without erasing the intervening history.
_Avoid_: Undo, rollback
