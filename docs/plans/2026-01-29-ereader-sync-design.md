# eReader Sync Feature Design

**Date:** 2026-01-29
**Status:** Approved

## Overview

Add an eReader section to Folio that allows users to:
- Connect any eReader device (Kobo, Kindle, etc.) that mounts as an external drive
- See which library books are on the device and which aren't
- Queue books to add or remove from the device
- Import device-only books into the library
- Execute sync with preview confirmation

## Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Device detection | Manual folder selection | Simple, reliable, works across all devices |
| Book matching | Hash first, then fuzzy title+author | Exact matches for identical files, fuzzy catches different editions |
| Sync workflow | Inline actions with queue | Fits existing "review before apply" pattern |
| View structure | Single unified view with filters | Everything in one place, less navigation |
| Device-only books | Show with import option | Full visibility, lets user consolidate |
| Sync execution | Preview confirmation dialog | Prevents accidental syncs |

---

## Data Model

### New Tables

**`ereader_devices`** - Configured eReader connections

```sql
CREATE TABLE ereader_devices (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  mount_path TEXT NOT NULL,
  device_type TEXT,
  books_subfolder TEXT DEFAULT '',
  last_connected_at INTEGER,
  created_at INTEGER
);
```

**`ereader_sync_queue`** - Pending sync operations

```sql
CREATE TABLE ereader_sync_queue (
  id TEXT PRIMARY KEY,
  device_id TEXT NOT NULL,
  item_id TEXT,
  ereader_path TEXT,
  action TEXT NOT NULL,
  status TEXT DEFAULT 'pending',
  created_at INTEGER,
  FOREIGN KEY (device_id) REFERENCES ereader_devices(id)
);
```

### TypeScript Types

```typescript
type EReaderDevice = {
  id: string;
  name: string;
  mountPath: string;
  deviceType: "kobo" | "kindle" | "generic";
  booksSubfolder: string;
  lastConnectedAt: number | null;
  isConnected: boolean;
};

type EReaderBook = {
  path: string;
  filename: string;
  title: string | null;
  author: string | null;
  fileHash: string;
  matchedItemId: string | null;
  matchConfidence: "exact" | "fuzzy" | null;
};

type SyncQueueItem = {
  id: string;
  action: "add" | "remove" | "import";
  libraryItem?: LibraryItem;
  ereaderBook?: EReaderBook;
};

type SyncResult = {
  added: number;
  removed: number;
  imported: number;
  errors: string[];
};
```

---

## Backend Commands

### Device Management

```rust
fn add_ereader_device(name: String, mount_path: String) -> Result<EReaderDevice, String>
fn list_ereader_devices() -> Result<Vec<EReaderDevice>, String>
fn remove_ereader_device(device_id: String) -> Result<(), String>
fn check_device_connected(device_id: String) -> Result<bool, String>
```

### Scanning & Matching

```rust
fn scan_ereader(device_id: String) -> Result<Vec<EReaderBook>, String>
```

Scanning process:
1. Walk device folder recursively for EPUB/PDF files
2. Extract metadata from each file (reuse existing EPUB parsing)
3. Compute SHA256 hash
4. Match against library:
   - First: exact hash match → confidence "exact"
   - Second: fuzzy title+author match → confidence "fuzzy"
5. Emit progress events

### Sync Queue Management

```rust
fn queue_sync_action(
  device_id: String,
  action: String,
  item_id: Option<String>,
  ereader_path: Option<String>
) -> Result<SyncQueueItem, String>

fn remove_from_sync_queue(queue_id: String) -> Result<(), String>
fn get_sync_queue(device_id: String) -> Result<Vec<SyncQueueItem>, String>
fn clear_sync_queue(device_id: String) -> Result<(), String>
```

### Sync Execution

```rust
fn execute_sync(device_id: String) -> Result<SyncResult, String>
```

Execution process:
- **"add"**: Copy file from library to device (respecting `books_subfolder`)
- **"remove"**: Delete file from device
- **"import"**: Copy file from device to library, trigger indexing

---

## Frontend Design

### View Type Extension

```typescript
type View =
  | "library" | "library-books" | "library-authors" | "library-series"
  | "inbox" | "duplicates" | "fix" | "changes" | "tags"
  | "ereader"  // new
```

### EReaderView Layout

```
┌─────────────────────────────────────────────────────────────────┐
│ [Device: ▾ dropdown]  [🟢 Connected]    [Scan Device] [Sync (3)]│
├─────────────────────────────────────────────────────────────────┤
│ Filter: [All] [In Library] [Not on Device] [Device Only]        │
│         [Queued for Sync]                                       │
├─────────────────────────────────────────────────────────────────┤
│ ┌─ Sync Queue (3 pending) ──────────────────────────────── [▼] │
│ │  + Add "The Shallows" to device            [Cancel]          │
│ │  + Add "Silent Spring" to device           [Cancel]          │
│ │  − Remove "Old Book" from device           [Cancel]          │
│ └──────────────────────────────────────────────────────────────┘
├─────────────────────────────────────────────────────────────────┤
│ ┌──────┬─────────────────────────────────────┬─────────┬──────┐ │
│ │ Cover│ Title / Author                      │ Status  │Action│ │
│ ├──────┼─────────────────────────────────────┼─────────┼──────┤ │
│ │ [img]│ The Shallows                        │ ✓ On    │  −   │ │
│ │      │ Nicholas Carr                       │ Device  │      │ │
│ ├──────┼─────────────────────────────────────┼─────────┼──────┤ │
│ │ [img]│ Silent Spring                       │ Library │  +   │ │
│ │      │ Rachel Carson                       │ Only    │      │ │
│ ├──────┼─────────────────────────────────────┼─────────┼──────┤ │
│ │ [img]│ Unknown Book.epub                   │ Device  │ [Add │ │
│ │      │ Unknown Author                      │ Only    │  to  │ │
│ │      │                                     │         │ Lib] │ │
│ └──────┴─────────────────────────────────────┴─────────┴──────┘ │
└─────────────────────────────────────────────────────────────────┘
```

### Status Badges

| Badge | Color | Meaning |
|-------|-------|---------|
| ✓ On Device | Green | Exact hash match |
| ≈ On Device | Blue | Fuzzy match (same title/author) |
| Library Only | Gray | Not on device |
| Device Only | Amber | Not in library |
| Queued + | Purple | Pending add |
| Queued − | Red | Pending remove |

### First-Time Setup

When no device is configured:

```
┌─────────────────────────────────────────────────┐
│                                                 │
│       📱 No eReader Connected                   │
│                                                 │
│   Connect your eReader and select its folder    │
│   to start syncing your library.                │
│                                                 │
│        [Select eReader Folder]                  │
│                                                 │
└─────────────────────────────────────────────────┘
```

### Sync Confirmation Dialog

```
┌─────────────────────────────────────────────────┐
│         Sync to [Device Name]                   │
├─────────────────────────────────────────────────┤
│                                                 │
│  Ready to sync the following changes:           │
│                                                 │
│  ➕ Add to device (2 books)                     │
│     • The Shallows — Nicholas Carr              │
│     • Silent Spring — Rachel Carson             │
│                                                 │
│  ➖ Remove from device (1 book)                 │
│     • Old Book — Unknown Author                 │
│                                                 │
│  📥 Import to library (1 book)                  │
│     • Found on Device.epub                      │
│                                                 │
├─────────────────────────────────────────────────┤
│              [Cancel]    [Sync Now]             │
└─────────────────────────────────────────────────┘
```

---

## User Workflow

1. **Connect device** → Go to eReader view → Click "Select eReader Folder" → Choose mounted volume → Enter device name
2. **Scan** → Click "Scan Device" → Progress indicator → Books appear with match status
3. **Queue changes** → Click + to add library books to device, − to remove, "Add to Library" for device-only books
4. **Review** → Sync Queue section shows pending changes, can cancel individual items
5. **Execute** → Click "Sync" button → Confirmation dialog → "Sync Now" → Progress → Done summary

---

## Edge Cases

| Situation | Behavior |
|-----------|----------|
| Device disconnected mid-scan | Show error, retain partial results |
| Device disconnected mid-sync | Stop sync, show what completed, keep remaining items in queue |
| File deleted from library but queued for add | Remove from queue, show warning |
| Duplicate filenames on device | Show both, match by hash |
| Unsupported file format on device | Skip, only index EPUB/PDF |
| Device folder no longer exists | Show "Disconnected" status, disable scan/sync |
| Book modified on device after sync | Re-scan detects new hash, shows as "changed" |
| Filename conflict when adding | Append number: `Book.epub` → `Book (1).epub` |

---

## File Changes

| File | Changes |
|------|---------|
| `packages/core/drizzle/0004_ereader.sql` | New migration |
| `src-tauri/src/lib.rs` | 10 new Tauri commands |
| `src/types/library.ts` | New types, extend View |
| `src/sections/EReaderView.tsx` | New component |
| `src/sections/Sidebar.tsx` | Add eReader menu item |
| `src/components/SyncConfirmDialog.tsx` | New dialog |
| `src/App.tsx` | State and handlers |

---

## Implementation Order

1. Database migration (tables)
2. Backend: device management commands
3. Backend: scan command with matching logic
4. Backend: sync queue commands
5. Backend: execute sync command
6. Frontend: types and state
7. Frontend: EReaderView component
8. Frontend: Sidebar integration
9. Frontend: SyncConfirmDialog
10. Testing & polish

---

## Estimated Scope

Medium-large feature, approximately 800-1000 lines of new code.
