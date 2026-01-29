# eReader Sync Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add an eReader section that syncs library books with external eReader devices.

**Architecture:** Manual folder selection for device connection, SQLite tables for device config and sync queue, Rust backend for file operations, React frontend for unified book view with inline actions.

**Tech Stack:** Tauri 2.x (Rust), React 19, TypeScript, SQLite (rusqlite), Tailwind CSS

---

## Phase 1: Core Infrastructure

### Task 1: Database Migration

**Files:**
- Create: `packages/core/drizzle/0004_ereader.sql`

**Step 1: Create migration file**

```sql
-- eReader device configurations
CREATE TABLE IF NOT EXISTS ereader_devices (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  mount_path TEXT NOT NULL,
  device_type TEXT DEFAULT 'generic',
  books_subfolder TEXT DEFAULT '',
  last_connected_at INTEGER,
  created_at INTEGER NOT NULL
);

-- Sync queue for pending operations
CREATE TABLE IF NOT EXISTS ereader_sync_queue (
  id TEXT PRIMARY KEY,
  device_id TEXT NOT NULL,
  item_id TEXT,
  ereader_path TEXT,
  action TEXT NOT NULL,
  status TEXT DEFAULT 'pending',
  created_at INTEGER NOT NULL,
  FOREIGN KEY (device_id) REFERENCES ereader_devices(id) ON DELETE CASCADE
);

-- Index for faster lookups
CREATE INDEX IF NOT EXISTS idx_sync_queue_device ON ereader_sync_queue(device_id);
CREATE INDEX IF NOT EXISTS idx_sync_queue_status ON ereader_sync_queue(status);
```

**Step 2: Register migration in Rust backend**

Modify `src-tauri/src/lib.rs` - add after line ~24 (after MIGRATION_TAG_COLORS_SQL):

```rust
const MIGRATION_EREADER_SQL: &str = include_str!(
  "../../../../packages/core/drizzle/0004_ereader.sql"
);
```

Then in the `open_db` function, add after the tag colors migration execution:

```rust
conn.execute_batch(MIGRATION_EREADER_SQL).ok();
```

**Step 3: Verify migration loads**

Run: `cd /Users/brian/dev/projects/folio/apps/desktop/src-tauri && cargo check`
Expected: Compiles without errors

**Step 4: Commit**

```bash
git add packages/core/drizzle/0004_ereader.sql apps/desktop/src-tauri/src/lib.rs
git commit -m "feat(ereader): add database migration for devices and sync queue"
```

---

### Task 2: TypeScript Types

**Files:**
- Modify: `apps/desktop/src/types/library.ts`

**Step 1: Add eReader types**

Add at end of file:

```typescript
export type EReaderDevice = {
  id: string;
  name: string;
  mountPath: string;
  deviceType: "kobo" | "kindle" | "generic";
  booksSubfolder: string;
  lastConnectedAt: number | null;
  isConnected: boolean;
};

export type EReaderBook = {
  path: string;
  filename: string;
  title: string | null;
  authors: string[];
  fileHash: string;
  matchedItemId: string | null;
  matchConfidence: "exact" | "fuzzy" | null;
};

export type SyncQueueItem = {
  id: string;
  deviceId: string;
  action: "add" | "remove" | "import";
  itemId: string | null;
  ereaderPath: string | null;
  status: "pending" | "completed" | "error";
  createdAt: number;
};

export type SyncResult = {
  added: number;
  removed: number;
  imported: number;
  errors: string[];
};
```

**Step 2: Extend View type**

Find the View type and add "ereader":

```typescript
export type View =
  | "library"
  | "library-books"
  | "library-authors"
  | "library-series"
  | "inbox"
  | "duplicates"
  | "fix"
  | "changes"
  | "tags"
  | "ereader";
```

**Step 3: Verify TypeScript compiles**

Run: `cd /Users/brian/dev/projects/folio/apps/desktop && npx tsc --noEmit`
Expected: No errors

**Step 4: Commit**

```bash
git add apps/desktop/src/types/library.ts
git commit -m "feat(ereader): add TypeScript types for eReader feature"
```

---

### Task 3: Rust Structs and Device Management Commands

**Files:**
- Modify: `apps/desktop/src-tauri/src/lib.rs`

**Step 1: Add Rust structs**

Add after the existing struct definitions (around line 80):

```rust
#[derive(Serialize, Clone)]
struct EReaderDevice {
  id: String,
  name: String,
  mount_path: String,
  device_type: String,
  books_subfolder: String,
  last_connected_at: Option<i64>,
  is_connected: bool,
}

#[derive(Serialize, Clone)]
struct EReaderBook {
  path: String,
  filename: String,
  title: Option<String>,
  authors: Vec<String>,
  file_hash: String,
  matched_item_id: Option<String>,
  match_confidence: Option<String>,
}

#[derive(Serialize, serde::Deserialize, Clone)]
struct SyncQueueItem {
  id: String,
  device_id: String,
  action: String,
  item_id: Option<String>,
  ereader_path: Option<String>,
  status: String,
  created_at: i64,
}

#[derive(Serialize)]
struct SyncResult {
  added: i64,
  removed: i64,
  imported: i64,
  errors: Vec<String>,
}
```

**Step 2: Add device management commands**

Add before the `run()` function:

```rust
#[tauri::command]
fn add_ereader_device(
  app: tauri::AppHandle,
  name: String,
  mount_path: String,
) -> Result<EReaderDevice, String> {
  let conn = open_db(&app)?;
  let now = chrono::Utc::now().timestamp_millis();
  let id = Uuid::new_v4().to_string();
  let is_connected = std::path::Path::new(&mount_path).exists();

  conn.execute(
    "INSERT INTO ereader_devices (id, name, mount_path, device_type, books_subfolder, last_connected_at, created_at) VALUES (?1, ?2, ?3, 'generic', '', ?4, ?5)",
    params![id, name, mount_path, if is_connected { Some(now) } else { None }, now],
  ).map_err(|err| err.to_string())?;

  log::info!("added ereader device: {} at {}", name, mount_path);

  Ok(EReaderDevice {
    id,
    name,
    mount_path,
    device_type: "generic".to_string(),
    books_subfolder: String::new(),
    last_connected_at: if is_connected { Some(now) } else { None },
    is_connected,
  })
}

#[tauri::command]
fn list_ereader_devices(app: tauri::AppHandle) -> Result<Vec<EReaderDevice>, String> {
  let conn = open_db(&app)?;
  let mut stmt = conn
    .prepare("SELECT id, name, mount_path, device_type, books_subfolder, last_connected_at FROM ereader_devices ORDER BY name")
    .map_err(|err| err.to_string())?;

  let rows = stmt
    .query_map(params![], |row| {
      let mount_path: String = row.get(2)?;
      let is_connected = std::path::Path::new(&mount_path).exists();
      Ok(EReaderDevice {
        id: row.get(0)?,
        name: row.get(1)?,
        mount_path,
        device_type: row.get(3)?,
        books_subfolder: row.get::<_, Option<String>>(4)?.unwrap_or_default(),
        last_connected_at: row.get(5)?,
        is_connected,
      })
    })
    .map_err(|err| err.to_string())?;

  let mut devices = Vec::new();
  for row in rows {
    devices.push(row.map_err(|err| err.to_string())?);
  }
  Ok(devices)
}

#[tauri::command]
fn remove_ereader_device(app: tauri::AppHandle, device_id: String) -> Result<(), String> {
  let conn = open_db(&app)?;
  conn.execute("DELETE FROM ereader_sync_queue WHERE device_id = ?1", params![device_id])
    .map_err(|err| err.to_string())?;
  conn.execute("DELETE FROM ereader_devices WHERE id = ?1", params![device_id])
    .map_err(|err| err.to_string())?;
  log::info!("removed ereader device: {}", device_id);
  Ok(())
}

#[tauri::command]
fn check_device_connected(app: tauri::AppHandle, device_id: String) -> Result<bool, String> {
  let conn = open_db(&app)?;
  let mount_path: Option<String> = conn
    .query_row(
      "SELECT mount_path FROM ereader_devices WHERE id = ?1",
      params![device_id],
      |row| row.get(0),
    )
    .optional()
    .map_err(|err| err.to_string())?;

  match mount_path {
    Some(path) => {
      let connected = std::path::Path::new(&path).exists();
      if connected {
        let now = chrono::Utc::now().timestamp_millis();
        conn.execute(
          "UPDATE ereader_devices SET last_connected_at = ?1 WHERE id = ?2",
          params![now, device_id],
        ).ok();
      }
      Ok(connected)
    }
    None => Err("Device not found".to_string()),
  }
}
```

**Step 3: Register commands in invoke_handler**

In the `run()` function, add to `tauri::generate_handler![]`:

```rust
add_ereader_device,
list_ereader_devices,
remove_ereader_device,
check_device_connected,
```

**Step 4: Verify compilation**

Run: `cd /Users/brian/dev/projects/folio/apps/desktop/src-tauri && cargo check`
Expected: Compiles without errors

**Step 5: Commit**

```bash
git add apps/desktop/src-tauri/src/lib.rs
git commit -m "feat(ereader): add device management commands"
```

---

### Task 4: Basic EReaderView Component (Setup State)

**Files:**
- Create: `apps/desktop/src/sections/EReaderView.tsx`

**Step 1: Create the component file**

```tsx
import { useEffect, useState } from "react";
import { HardDrive, FolderOpen, RefreshCw, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { EReaderDevice, EReaderBook, SyncQueueItem, LibraryItem } from "@/types/library";

type EReaderFilter = "all" | "in-library" | "not-on-device" | "device-only" | "queued";

type EReaderViewProps = {
  devices: EReaderDevice[];
  selectedDeviceId: string | null;
  setSelectedDeviceId: (id: string | null) => void;
  ereaderBooks: EReaderBook[];
  syncQueue: SyncQueueItem[];
  libraryItems: LibraryItem[];
  onAddDevice: (name: string, mountPath: string) => Promise<void>;
  onRemoveDevice: (deviceId: string) => Promise<void>;
  onScanDevice: (deviceId: string) => Promise<void>;
  onQueueAdd: (itemId: string) => Promise<void>;
  onQueueRemove: (ereaderPath: string) => Promise<void>;
  onQueueImport: (ereaderPath: string) => Promise<void>;
  onRemoveFromQueue: (queueId: string) => Promise<void>;
  onExecuteSync: () => Promise<void>;
  scanning: boolean;
};

export function EReaderView({
  devices,
  selectedDeviceId,
  setSelectedDeviceId,
  ereaderBooks,
  syncQueue,
  libraryItems,
  onAddDevice,
  onRemoveDevice,
  onScanDevice,
  onQueueAdd,
  onQueueRemove,
  onQueueImport,
  onRemoveFromQueue,
  onExecuteSync,
  scanning,
}: EReaderViewProps) {
  const [filter, setFilter] = useState<EReaderFilter>("all");
  const [showAddDevice, setShowAddDevice] = useState(false);
  const [newDeviceName, setNewDeviceName] = useState("");

  const selectedDevice = devices.find((d) => d.id === selectedDeviceId) ?? null;
  const pendingQueue = syncQueue.filter((q) => q.status === "pending");

  // No device configured - show setup
  if (devices.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4 text-center p-8">
        <div className="w-16 h-16 rounded-full bg-[var(--app-accent)]/10 flex items-center justify-center">
          <HardDrive className="w-8 h-8 text-[var(--app-accent)]" />
        </div>
        <h2 className="text-xl font-semibold">No eReader Connected</h2>
        <p className="text-sm text-[var(--app-text-muted)] max-w-md">
          Connect your eReader and select its folder to start syncing your library.
        </p>
        <Button
          onClick={async () => {
            const { open } = await import("@tauri-apps/plugin-dialog");
            const selection = await open({ directory: true, multiple: false });
            if (typeof selection === "string") {
              const name = selection.split("/").pop() || "eReader";
              await onAddDevice(name, selection);
            }
          }}
          className="mt-2"
        >
          <FolderOpen className="w-4 h-4 mr-2" />
          Select eReader Folder
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-[var(--app-border)]">
        <div className="flex items-center gap-3">
          <select
            value={selectedDeviceId ?? ""}
            onChange={(e) => setSelectedDeviceId(e.target.value || null)}
            className="px-3 py-1.5 rounded-md border border-[var(--app-border)] bg-[var(--app-bg)] text-sm"
          >
            {devices.map((device) => (
              <option key={device.id} value={device.id}>
                {device.name}
              </option>
            ))}
          </select>
          {selectedDevice && (
            <span className={`flex items-center gap-1.5 text-xs ${selectedDevice.isConnected ? "text-emerald-600" : "text-amber-600"}`}>
              <span className={`w-2 h-2 rounded-full ${selectedDevice.isConnected ? "bg-emerald-500" : "bg-amber-500"}`} />
              {selectedDevice.isConnected ? "Connected" : "Disconnected"}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => selectedDeviceId && onScanDevice(selectedDeviceId)}
            disabled={!selectedDevice?.isConnected || scanning}
          >
            <RefreshCw className={`w-4 h-4 mr-2 ${scanning ? "animate-spin" : ""}`} />
            {scanning ? "Scanning..." : "Scan Device"}
          </Button>
          {pendingQueue.length > 0 && (
            <Button size="sm" onClick={onExecuteSync}>
              Sync ({pendingQueue.length})
            </Button>
          )}
        </div>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-2 p-4 border-b border-[var(--app-border)]">
        <span className="text-sm text-[var(--app-text-muted)]">Filter:</span>
        {(["all", "in-library", "not-on-device", "device-only", "queued"] as const).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`px-3 py-1 text-xs rounded-full transition-colors ${
              filter === f
                ? "bg-[var(--app-accent)] text-white"
                : "bg-[var(--app-bg-secondary)] hover:bg-[var(--app-bg-tertiary)]"
            }`}
          >
            {f === "all" && "All"}
            {f === "in-library" && "In Library"}
            {f === "not-on-device" && "Not on Device"}
            {f === "device-only" && "Device Only"}
            {f === "queued" && "Queued"}
          </button>
        ))}
      </div>

      {/* Sync Queue (collapsible) */}
      {pendingQueue.length > 0 && (
        <div className="border-b border-[var(--app-border)] bg-[var(--app-bg-secondary)]">
          <div className="p-3">
            <h3 className="text-sm font-medium mb-2">Sync Queue ({pendingQueue.length} pending)</h3>
            <div className="space-y-1">
              {pendingQueue.map((item) => (
                <div key={item.id} className="flex items-center justify-between text-sm py-1">
                  <span className="flex items-center gap-2">
                    <span className={item.action === "add" ? "text-emerald-600" : item.action === "remove" ? "text-red-600" : "text-blue-600"}>
                      {item.action === "add" ? "+" : item.action === "remove" ? "−" : "↓"}
                    </span>
                    <span>{item.action === "add" ? "Add" : item.action === "remove" ? "Remove" : "Import"}</span>
                    <span className="text-[var(--app-text-muted)]">
                      {item.itemId ? libraryItems.find((i) => i.id === item.itemId)?.title : item.ereaderPath?.split("/").pop()}
                    </span>
                  </span>
                  <button
                    onClick={() => onRemoveFromQueue(item.id)}
                    className="text-xs text-[var(--app-text-muted)] hover:text-red-600"
                  >
                    Cancel
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Book List */}
      <div className="flex-1 overflow-auto p-4">
        {!selectedDevice?.isConnected ? (
          <div className="text-center text-[var(--app-text-muted)] py-8">
            Device is disconnected. Please reconnect to scan and sync.
          </div>
        ) : ereaderBooks.length === 0 ? (
          <div className="text-center text-[var(--app-text-muted)] py-8">
            Click "Scan Device" to see books on your eReader.
          </div>
        ) : (
          <div className="text-center text-[var(--app-text-muted)] py-8">
            {ereaderBooks.length} books found on device.
            {/* Full book list will be implemented in Phase 2 */}
          </div>
        )}
      </div>
    </div>
  );
}
```

**Step 2: Verify TypeScript compiles**

Run: `cd /Users/brian/dev/projects/folio/apps/desktop && npx tsc --noEmit`
Expected: No errors

**Step 3: Commit**

```bash
git add apps/desktop/src/sections/EReaderView.tsx
git commit -m "feat(ereader): add basic EReaderView component with setup flow"
```

---

### Task 5: Integrate EReaderView into App.tsx

**Files:**
- Modify: `apps/desktop/src/App.tsx`

**Step 1: Add imports**

Add with other section imports:

```typescript
import { EReaderView } from "./sections/EReaderView";
```

Add with other type imports:

```typescript
import type {
  // ... existing imports
  EReaderDevice,
  EReaderBook,
  SyncQueueItem,
} from "./types/library";
```

**Step 2: Add state variables**

Add after existing state declarations (around line 240):

```typescript
const [ereaderDevices, setEreaderDevices] = useState<EReaderDevice[]>([]);
const [selectedEreaderDeviceId, setSelectedEreaderDeviceId] = useState<string | null>(null);
const [ereaderBooks, setEreaderBooks] = useState<EReaderBook[]>([]);
const [ereaderSyncQueue, setEreaderSyncQueue] = useState<SyncQueueItem[]>([]);
const [ereaderScanning, setEreaderScanning] = useState(false);
```

**Step 3: Add data loading effect**

Add after other useEffect hooks:

```typescript
useEffect(() => {
  if (!isDesktop) return;
  const loadEreaderDevices = async () => {
    try {
      const devices = await invoke<EReaderDevice[]>("list_ereader_devices");
      setEreaderDevices(devices);
      if (devices.length > 0 && !selectedEreaderDeviceId) {
        setSelectedEreaderDeviceId(devices[0].id);
      }
    } catch {
      setEreaderDevices([]);
    }
  };
  void loadEreaderDevices();
}, [isDesktop, selectedEreaderDeviceId]);
```

**Step 4: Add handler functions**

Add after other handler functions:

```typescript
const handleAddEreaderDevice = async (name: string, mountPath: string) => {
  if (!isTauri()) return;
  try {
    const device = await invoke<EReaderDevice>("add_ereader_device", { name, mountPath });
    setEreaderDevices((prev) => [...prev, device]);
    setSelectedEreaderDeviceId(device.id);
  } catch {
    setScanStatus("Could not add eReader device.");
  }
};

const handleRemoveEreaderDevice = async (deviceId: string) => {
  if (!isTauri()) return;
  try {
    await invoke("remove_ereader_device", { deviceId });
    setEreaderDevices((prev) => prev.filter((d) => d.id !== deviceId));
    if (selectedEreaderDeviceId === deviceId) {
      setSelectedEreaderDeviceId(null);
    }
  } catch {
    setScanStatus("Could not remove eReader device.");
  }
};

const handleScanEreaderDevice = async (deviceId: string) => {
  if (!isTauri()) return;
  setEreaderScanning(true);
  try {
    const books = await invoke<EReaderBook[]>("scan_ereader", { deviceId });
    setEreaderBooks(books);
  } catch {
    setScanStatus("Could not scan eReader device.");
  } finally {
    setEreaderScanning(false);
  }
};

const handleQueueEreaderAdd = async (itemId: string) => {
  if (!isTauri() || !selectedEreaderDeviceId) return;
  try {
    const item = await invoke<SyncQueueItem>("queue_sync_action", {
      deviceId: selectedEreaderDeviceId,
      action: "add",
      itemId,
      ereaderPath: null,
    });
    setEreaderSyncQueue((prev) => [...prev, item]);
  } catch {
    setScanStatus("Could not queue book for sync.");
  }
};

const handleQueueEreaderRemove = async (ereaderPath: string) => {
  if (!isTauri() || !selectedEreaderDeviceId) return;
  try {
    const item = await invoke<SyncQueueItem>("queue_sync_action", {
      deviceId: selectedEreaderDeviceId,
      action: "remove",
      itemId: null,
      ereaderPath,
    });
    setEreaderSyncQueue((prev) => [...prev, item]);
  } catch {
    setScanStatus("Could not queue book for removal.");
  }
};

const handleQueueEreaderImport = async (ereaderPath: string) => {
  if (!isTauri() || !selectedEreaderDeviceId) return;
  try {
    const item = await invoke<SyncQueueItem>("queue_sync_action", {
      deviceId: selectedEreaderDeviceId,
      action: "import",
      itemId: null,
      ereaderPath,
    });
    setEreaderSyncQueue((prev) => [...prev, item]);
  } catch {
    setScanStatus("Could not queue book for import.");
  }
};

const handleRemoveFromEreaderQueue = async (queueId: string) => {
  if (!isTauri()) return;
  try {
    await invoke("remove_from_sync_queue", { queueId });
    setEreaderSyncQueue((prev) => prev.filter((q) => q.id !== queueId));
  } catch {
    setScanStatus("Could not remove from sync queue.");
  }
};

const handleExecuteEreaderSync = async () => {
  if (!isTauri() || !selectedEreaderDeviceId) return;
  // Will be implemented with sync confirmation dialog
  setScanStatus("Sync execution not yet implemented.");
};
```

**Step 5: Add view rendering**

Find the view rendering section and add the ereader case:

```typescript
{view === "ereader" && (
  <EReaderView
    devices={ereaderDevices}
    selectedDeviceId={selectedEreaderDeviceId}
    setSelectedDeviceId={setSelectedEreaderDeviceId}
    ereaderBooks={ereaderBooks}
    syncQueue={ereaderSyncQueue}
    libraryItems={libraryItems}
    onAddDevice={handleAddEreaderDevice}
    onRemoveDevice={handleRemoveEreaderDevice}
    onScanDevice={handleScanEreaderDevice}
    onQueueAdd={handleQueueEreaderAdd}
    onQueueRemove={handleQueueEreaderRemove}
    onQueueImport={handleQueueEreaderImport}
    onRemoveFromQueue={handleRemoveFromEreaderQueue}
    onExecuteSync={handleExecuteEreaderSync}
    scanning={ereaderScanning}
  />
)}
```

**Step 6: Verify TypeScript compiles**

Run: `cd /Users/brian/dev/projects/folio/apps/desktop && npx tsc --noEmit`
Expected: No errors

**Step 7: Commit**

```bash
git add apps/desktop/src/App.tsx
git commit -m "feat(ereader): integrate EReaderView into App.tsx with state and handlers"
```

---

### Task 6: Add eReader to Sidebar

**Files:**
- Modify: `apps/desktop/src/sections/Sidebar.tsx`

**Step 1: Add HardDrive icon import**

Add to lucide-react imports:

```typescript
import { /* existing icons */, HardDrive } from "lucide-react";
```

**Step 2: Add eReader section**

Find the sidebar navigation items and add after the Library section (before Tags or at an appropriate place):

```tsx
{/* eReader Section */}
<div className="space-y-1">
  <button
    onClick={() => setView("ereader")}
    className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors ${
      view === "ereader"
        ? "bg-[var(--app-accent)]/10 text-[var(--app-accent)]"
        : "hover:bg-[var(--app-bg-secondary)]"
    }`}
  >
    <HardDrive className="w-4 h-4" />
    <span>eReader</span>
  </button>
</div>
```

**Step 3: Verify TypeScript compiles**

Run: `cd /Users/brian/dev/projects/folio/apps/desktop && npx tsc --noEmit`
Expected: No errors

**Step 4: Commit**

```bash
git add apps/desktop/src/sections/Sidebar.tsx
git commit -m "feat(ereader): add eReader navigation to sidebar"
```

---

## Phase 2: Scanning & Matching

### Task 7: Scan eReader Command

**Files:**
- Modify: `apps/desktop/src-tauri/src/lib.rs`

**Step 1: Add scan_ereader command**

Add before the `run()` function:

```rust
#[tauri::command]
fn scan_ereader(app: tauri::AppHandle, device_id: String) -> Result<Vec<EReaderBook>, String> {
  let conn = open_db(&app)?;

  // Get device info
  let (mount_path, books_subfolder): (String, String) = conn
    .query_row(
      "SELECT mount_path, COALESCE(books_subfolder, '') FROM ereader_devices WHERE id = ?1",
      params![device_id],
      |row| Ok((row.get(0)?, row.get(1)?)),
    )
    .map_err(|err| err.to_string())?;

  let scan_path = if books_subfolder.is_empty() {
    std::path::PathBuf::from(&mount_path)
  } else {
    std::path::PathBuf::from(&mount_path).join(&books_subfolder)
  };

  if !scan_path.exists() {
    return Err("Device folder does not exist".to_string());
  }

  log::info!("scanning ereader at: {}", scan_path.display());

  // Build a map of library items by hash and by title+author for matching
  let mut hash_map: std::collections::HashMap<String, String> = std::collections::HashMap::new();
  let mut title_map: std::collections::HashMap<String, (String, Vec<String>)> = std::collections::HashMap::new();

  let mut stmt = conn
    .prepare("SELECT items.id, items.title, files.sha256, GROUP_CONCAT(authors.name) as authors FROM items LEFT JOIN files ON files.item_id = items.id LEFT JOIN item_authors ON item_authors.item_id = items.id LEFT JOIN authors ON authors.id = item_authors.author_id WHERE files.sha256 IS NOT NULL GROUP BY items.id")
    .map_err(|err| err.to_string())?;

  let rows = stmt
    .query_map(params![], |row| {
      Ok((
        row.get::<_, String>(0)?,
        row.get::<_, Option<String>>(1)?,
        row.get::<_, Option<String>>(2)?,
        row.get::<_, Option<String>>(3)?,
      ))
    })
    .map_err(|err| err.to_string())?;

  for row in rows {
    let (item_id, title, hash, authors) = row.map_err(|err| err.to_string())?;
    if let Some(h) = hash {
      hash_map.insert(h, item_id.clone());
    }
    if let Some(t) = title {
      let author_list: Vec<String> = authors
        .unwrap_or_default()
        .split(',')
        .filter(|s| !s.trim().is_empty())
        .map(|s| s.trim().to_lowercase())
        .collect();
      title_map.insert(t.to_lowercase(), (item_id, author_list));
    }
  }

  let mut books: Vec<EReaderBook> = Vec::new();

  for entry in WalkDir::new(&scan_path)
    .into_iter()
    .filter_map(Result::ok)
    .filter(|e| e.file_type().is_file())
  {
    let path = entry.path();
    let ext = path.extension().and_then(|e| e.to_str()).unwrap_or("").to_lowercase();

    if ext != "epub" && ext != "pdf" {
      continue;
    }

    let filename = path.file_name().and_then(|n| n.to_str()).unwrap_or("").to_string();
    let path_str = path.to_string_lossy().to_string();

    // Compute hash
    let file_hash = match hash_file(path) {
      Ok(h) => h,
      Err(_) => continue,
    };

    // Try to extract metadata
    let (title, authors) = if ext == "epub" {
      match extract_epub_metadata(path) {
        Some(meta) => (meta.title, meta.authors),
        None => (None, vec![]),
      }
    } else {
      // For PDF, try to extract title from filename
      let stem = path.file_stem().and_then(|s| s.to_str()).map(|s| s.to_string());
      (stem, vec![])
    };

    // Match against library
    let (matched_item_id, match_confidence) = if let Some(item_id) = hash_map.get(&file_hash) {
      (Some(item_id.clone()), Some("exact".to_string()))
    } else if let Some(t) = &title {
      let key = t.to_lowercase();
      if let Some((item_id, lib_authors)) = title_map.get(&key) {
        // Check if authors match (fuzzy)
        let book_authors: Vec<String> = authors.iter().map(|a| a.to_lowercase()).collect();
        let author_match = lib_authors.is_empty() || book_authors.is_empty() ||
          lib_authors.iter().any(|la| book_authors.iter().any(|ba| ba.contains(la) || la.contains(ba)));
        if author_match {
          (Some(item_id.clone()), Some("fuzzy".to_string()))
        } else {
          (None, None)
        }
      } else {
        (None, None)
      }
    } else {
      (None, None)
    };

    books.push(EReaderBook {
      path: path_str,
      filename,
      title,
      authors,
      file_hash,
      matched_item_id,
      match_confidence,
    });
  }

  log::info!("scanned {} books from ereader", books.len());

  // Update last connected timestamp
  let now = chrono::Utc::now().timestamp_millis();
  conn.execute(
    "UPDATE ereader_devices SET last_connected_at = ?1 WHERE id = ?2",
    params![now, device_id],
  ).ok();

  Ok(books)
}
```

**Step 2: Register command**

Add `scan_ereader` to the `tauri::generate_handler![]` list.

**Step 3: Verify compilation**

Run: `cd /Users/brian/dev/projects/folio/apps/desktop/src-tauri && cargo check`
Expected: Compiles without errors

**Step 4: Commit**

```bash
git add apps/desktop/src-tauri/src/lib.rs
git commit -m "feat(ereader): add scan_ereader command with hash and fuzzy matching"
```

---

### Task 8: Enhanced Book List UI

**Files:**
- Modify: `apps/desktop/src/sections/EReaderView.tsx`

**Step 1: Replace the placeholder book list with full implementation**

Replace the book list section (the `{/* Book List */}` div) with:

```tsx
{/* Book List */}
<div className="flex-1 overflow-auto">
  {!selectedDevice?.isConnected ? (
    <div className="text-center text-[var(--app-text-muted)] py-8">
      Device is disconnected. Please reconnect to scan and sync.
    </div>
  ) : ereaderBooks.length === 0 && libraryItems.length === 0 ? (
    <div className="text-center text-[var(--app-text-muted)] py-8">
      Click "Scan Device" to see books on your eReader.
    </div>
  ) : (
    <table className="w-full">
      <thead className="sticky top-0 bg-[var(--app-bg)] border-b border-[var(--app-border)]">
        <tr className="text-left text-xs text-[var(--app-text-muted)]">
          <th className="p-3 font-medium">Title / Author</th>
          <th className="p-3 font-medium w-32">Status</th>
          <th className="p-3 font-medium w-24">Action</th>
        </tr>
      </thead>
      <tbody>
        {filteredItems.map((item) => (
          <tr key={item.id} className="border-b border-[var(--app-border)] hover:bg-[var(--app-bg-secondary)]">
            <td className="p-3">
              <div className="font-medium">{item.title || "Unknown Title"}</div>
              <div className="text-sm text-[var(--app-text-muted)]">
                {item.authors.length > 0 ? item.authors.join(", ") : "Unknown Author"}
              </div>
            </td>
            <td className="p-3">
              <StatusBadge status={item.status} confidence={item.confidence} />
            </td>
            <td className="p-3">
              <ActionButton item={item} />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )}
</div>
```

**Step 2: Add helper types and components inside EReaderView**

Add before the return statement:

```tsx
type UnifiedItem = {
  id: string;
  title: string | null;
  authors: string[];
  status: "on-device" | "library-only" | "device-only" | "queued-add" | "queued-remove";
  confidence: "exact" | "fuzzy" | null;
  libraryItemId: string | null;
  ereaderPath: string | null;
};

// Build unified list of items
const unifiedItems: UnifiedItem[] = [];

// Add library items
libraryItems.forEach((lib) => {
  const onDevice = ereaderBooks.find((eb) => eb.matchedItemId === lib.id);
  const inQueue = pendingQueue.find((q) => q.itemId === lib.id);

  let status: UnifiedItem["status"] = "library-only";
  if (inQueue?.action === "add") status = "queued-add";
  else if (inQueue?.action === "remove") status = "queued-remove";
  else if (onDevice) status = "on-device";

  unifiedItems.push({
    id: `lib-${lib.id}`,
    title: lib.title,
    authors: lib.authors,
    status,
    confidence: onDevice?.matchConfidence as "exact" | "fuzzy" | null,
    libraryItemId: lib.id,
    ereaderPath: onDevice?.path ?? null,
  });
});

// Add device-only items
ereaderBooks.forEach((eb) => {
  if (!eb.matchedItemId) {
    const inQueue = pendingQueue.find((q) => q.ereaderPath === eb.path);
    unifiedItems.push({
      id: `dev-${eb.path}`,
      title: eb.title,
      authors: eb.authors,
      status: inQueue?.action === "import" ? "queued-add" : "device-only",
      confidence: null,
      libraryItemId: null,
      ereaderPath: eb.path,
    });
  }
});

// Apply filter
const filteredItems = unifiedItems.filter((item) => {
  switch (filter) {
    case "in-library":
      return item.libraryItemId !== null;
    case "not-on-device":
      return item.status === "library-only" || item.status === "queued-add";
    case "device-only":
      return item.status === "device-only";
    case "queued":
      return item.status === "queued-add" || item.status === "queued-remove";
    default:
      return true;
  }
});

const StatusBadge = ({ status, confidence }: { status: UnifiedItem["status"]; confidence: "exact" | "fuzzy" | null }) => {
  const badges: Record<string, { label: string; className: string }> = {
    "on-device": { label: confidence === "exact" ? "✓ On Device" : "≈ On Device", className: confidence === "exact" ? "bg-emerald-100 text-emerald-700" : "bg-blue-100 text-blue-700" },
    "library-only": { label: "Library Only", className: "bg-gray-100 text-gray-600" },
    "device-only": { label: "Device Only", className: "bg-amber-100 text-amber-700" },
    "queued-add": { label: "Queued +", className: "bg-purple-100 text-purple-700" },
    "queued-remove": { label: "Queued −", className: "bg-red-100 text-red-700" },
  };
  const badge = badges[status];
  return <span className={`px-2 py-1 rounded text-xs font-medium ${badge.className}`}>{badge.label}</span>;
};

const ActionButton = ({ item }: { item: UnifiedItem }) => {
  if (item.status === "queued-add" || item.status === "queued-remove") {
    return null; // Can cancel from queue section
  }
  if (item.status === "library-only" && item.libraryItemId) {
    return (
      <button
        onClick={() => onQueueAdd(item.libraryItemId!)}
        className="p-1.5 rounded hover:bg-emerald-100 text-emerald-600"
        title="Add to device"
      >
        +
      </button>
    );
  }
  if (item.status === "on-device" && item.ereaderPath) {
    return (
      <button
        onClick={() => onQueueRemove(item.ereaderPath!)}
        className="p-1.5 rounded hover:bg-red-100 text-red-600"
        title="Remove from device"
      >
        −
      </button>
    );
  }
  if (item.status === "device-only" && item.ereaderPath) {
    return (
      <button
        onClick={() => onQueueImport(item.ereaderPath!)}
        className="px-2 py-1 rounded text-xs bg-blue-100 text-blue-700 hover:bg-blue-200"
        title="Add to library"
      >
        Add to Library
      </button>
    );
  }
  return null;
};
```

**Step 3: Verify TypeScript compiles**

Run: `cd /Users/brian/dev/projects/folio/apps/desktop && npx tsc --noEmit`
Expected: No errors

**Step 4: Commit**

```bash
git add apps/desktop/src/sections/EReaderView.tsx
git commit -m "feat(ereader): add full book list with status badges and action buttons"
```

---

## Phase 3: Sync Queue & Execution

### Task 9: Sync Queue Backend Commands

**Files:**
- Modify: `apps/desktop/src-tauri/src/lib.rs`

**Step 1: Add sync queue commands**

Add before the `run()` function:

```rust
#[tauri::command]
fn queue_sync_action(
  app: tauri::AppHandle,
  device_id: String,
  action: String,
  item_id: Option<String>,
  ereader_path: Option<String>,
) -> Result<SyncQueueItem, String> {
  let conn = open_db(&app)?;
  let now = chrono::Utc::now().timestamp_millis();
  let id = Uuid::new_v4().to_string();

  conn.execute(
    "INSERT INTO ereader_sync_queue (id, device_id, item_id, ereader_path, action, status, created_at) VALUES (?1, ?2, ?3, ?4, ?5, 'pending', ?6)",
    params![id, device_id, item_id, ereader_path, action, now],
  ).map_err(|err| err.to_string())?;

  log::info!("queued sync action: {} for device {}", action, device_id);

  Ok(SyncQueueItem {
    id,
    device_id,
    action,
    item_id,
    ereader_path,
    status: "pending".to_string(),
    created_at: now,
  })
}

#[tauri::command]
fn remove_from_sync_queue(app: tauri::AppHandle, queue_id: String) -> Result<(), String> {
  let conn = open_db(&app)?;
  conn.execute("DELETE FROM ereader_sync_queue WHERE id = ?1", params![queue_id])
    .map_err(|err| err.to_string())?;
  log::info!("removed from sync queue: {}", queue_id);
  Ok(())
}

#[tauri::command]
fn get_sync_queue(app: tauri::AppHandle, device_id: String) -> Result<Vec<SyncQueueItem>, String> {
  let conn = open_db(&app)?;
  let mut stmt = conn
    .prepare("SELECT id, device_id, action, item_id, ereader_path, status, created_at FROM ereader_sync_queue WHERE device_id = ?1 ORDER BY created_at")
    .map_err(|err| err.to_string())?;

  let rows = stmt
    .query_map(params![device_id], |row| {
      Ok(SyncQueueItem {
        id: row.get(0)?,
        device_id: row.get(1)?,
        action: row.get(2)?,
        item_id: row.get(3)?,
        ereader_path: row.get(4)?,
        status: row.get(5)?,
        created_at: row.get(6)?,
      })
    })
    .map_err(|err| err.to_string())?;

  let mut items = Vec::new();
  for row in rows {
    items.push(row.map_err(|err| err.to_string())?);
  }
  Ok(items)
}

#[tauri::command]
fn clear_sync_queue(app: tauri::AppHandle, device_id: String) -> Result<(), String> {
  let conn = open_db(&app)?;
  conn.execute("DELETE FROM ereader_sync_queue WHERE device_id = ?1", params![device_id])
    .map_err(|err| err.to_string())?;
  log::info!("cleared sync queue for device {}", device_id);
  Ok(())
}
```

**Step 2: Register commands**

Add to `tauri::generate_handler![]`:

```rust
queue_sync_action,
remove_from_sync_queue,
get_sync_queue,
clear_sync_queue,
```

**Step 3: Verify compilation**

Run: `cd /Users/brian/dev/projects/folio/apps/desktop/src-tauri && cargo check`
Expected: Compiles without errors

**Step 4: Commit**

```bash
git add apps/desktop/src-tauri/src/lib.rs
git commit -m "feat(ereader): add sync queue management commands"
```

---

### Task 10: Execute Sync Command

**Files:**
- Modify: `apps/desktop/src-tauri/src/lib.rs`

**Step 1: Add execute_sync command**

Add before the `run()` function:

```rust
#[tauri::command]
fn execute_sync(app: tauri::AppHandle, device_id: String) -> Result<SyncResult, String> {
  let conn = open_db(&app)?;
  let now = chrono::Utc::now().timestamp_millis();

  // Get device info
  let (mount_path, books_subfolder): (String, String) = conn
    .query_row(
      "SELECT mount_path, COALESCE(books_subfolder, '') FROM ereader_devices WHERE id = ?1",
      params![device_id],
      |row| Ok((row.get(0)?, row.get(1)?)),
    )
    .map_err(|err| err.to_string())?;

  let device_path = if books_subfolder.is_empty() {
    std::path::PathBuf::from(&mount_path)
  } else {
    std::path::PathBuf::from(&mount_path).join(&books_subfolder)
  };

  if !device_path.exists() {
    return Err("Device is not connected".to_string());
  }

  // Get pending queue items
  let mut stmt = conn
    .prepare("SELECT id, action, item_id, ereader_path FROM ereader_sync_queue WHERE device_id = ?1 AND status = 'pending'")
    .map_err(|err| err.to_string())?;

  let rows = stmt
    .query_map(params![device_id], |row| {
      Ok((
        row.get::<_, String>(0)?,
        row.get::<_, String>(1)?,
        row.get::<_, Option<String>>(2)?,
        row.get::<_, Option<String>>(3)?,
      ))
    })
    .map_err(|err| err.to_string())?;

  let mut added = 0i64;
  let mut removed = 0i64;
  let mut imported = 0i64;
  let mut errors: Vec<String> = Vec::new();

  for row in rows {
    let (queue_id, action, item_id, ereader_path) = row.map_err(|err| err.to_string())?;

    let result = match action.as_str() {
      "add" => {
        if let Some(item_id) = item_id {
          // Get file path from library
          let file_path: Option<String> = conn
            .query_row(
              "SELECT path FROM files WHERE item_id = ?1 AND status = 'active' LIMIT 1",
              params![item_id],
              |row| row.get(0),
            )
            .optional()
            .map_err(|err| err.to_string())?;

          if let Some(src) = file_path {
            let src_path = std::path::Path::new(&src);
            let filename = src_path.file_name().unwrap_or_default();
            let dest = resolve_collision_path(&device_path, filename.to_str().unwrap_or("book.epub"));

            match std::fs::copy(&src, &dest) {
              Ok(_) => {
                added += 1;
                log::info!("copied {} to {}", src, dest.display());
                Ok(())
              }
              Err(e) => Err(format!("Failed to copy: {}", e)),
            }
          } else {
            Err("Library file not found".to_string())
          }
        } else {
          Err("No item_id for add action".to_string())
        }
      }
      "remove" => {
        if let Some(path) = ereader_path {
          match std::fs::remove_file(&path) {
            Ok(_) => {
              removed += 1;
              log::info!("removed {}", path);
              Ok(())
            }
            Err(e) => Err(format!("Failed to remove: {}", e)),
          }
        } else {
          Err("No path for remove action".to_string())
        }
      }
      "import" => {
        if let Some(src) = ereader_path {
          // Import to library - copy to inbox or library folder
          // For now, we'll trigger a scan of the file
          let src_path = std::path::Path::new(&src);
          if src_path.exists() {
            // Get library root from settings or use a default
            let app_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
            let imports_dir = app_dir.join("imports");
            std::fs::create_dir_all(&imports_dir).map_err(|e| e.to_string())?;

            let filename = src_path.file_name().unwrap_or_default();
            let dest = imports_dir.join(filename);

            match std::fs::copy(&src, &dest) {
              Ok(_) => {
                imported += 1;
                log::info!("imported {} to {}", src, dest.display());
                // TODO: trigger indexing of the imported file
                Ok(())
              }
              Err(e) => Err(format!("Failed to import: {}", e)),
            }
          } else {
            Err("Source file not found".to_string())
          }
        } else {
          Err("No path for import action".to_string())
        }
      }
      _ => Err(format!("Unknown action: {}", action)),
    };

    match result {
      Ok(_) => {
        conn.execute(
          "UPDATE ereader_sync_queue SET status = 'completed' WHERE id = ?1",
          params![queue_id],
        ).ok();
      }
      Err(e) => {
        errors.push(e.clone());
        conn.execute(
          "UPDATE ereader_sync_queue SET status = 'error' WHERE id = ?1",
          params![queue_id],
        ).ok();
      }
    }
  }

  // Clean up completed items
  conn.execute(
    "DELETE FROM ereader_sync_queue WHERE device_id = ?1 AND status = 'completed'",
    params![device_id],
  ).ok();

  log::info!("sync complete: {} added, {} removed, {} imported, {} errors", added, removed, imported, errors.len());

  Ok(SyncResult { added, removed, imported, errors })
}

fn resolve_collision_path(dir: &std::path::Path, filename: &str) -> std::path::PathBuf {
  let base = dir.join(filename);
  if !base.exists() {
    return base;
  }

  let stem = std::path::Path::new(filename)
    .file_stem()
    .and_then(|s| s.to_str())
    .unwrap_or("file");
  let ext = std::path::Path::new(filename)
    .extension()
    .and_then(|s| s.to_str())
    .unwrap_or("");

  let mut index = 1;
  loop {
    let new_name = if ext.is_empty() {
      format!("{} ({})", stem, index)
    } else {
      format!("{} ({}).{}", stem, index, ext)
    };
    let candidate = dir.join(new_name);
    if !candidate.exists() {
      return candidate;
    }
    index += 1;
  }
}
```

**Step 2: Register command**

Add `execute_sync` to `tauri::generate_handler![]`.

**Step 3: Verify compilation**

Run: `cd /Users/brian/dev/projects/folio/apps/desktop/src-tauri && cargo check`
Expected: Compiles without errors

**Step 4: Commit**

```bash
git add apps/desktop/src-tauri/src/lib.rs
git commit -m "feat(ereader): add execute_sync command for file operations"
```

---

### Task 11: Sync Confirmation Dialog

**Files:**
- Create: `apps/desktop/src/components/SyncConfirmDialog.tsx`

**Step 1: Create dialog component**

```tsx
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { SyncQueueItem, LibraryItem } from "@/types/library";

type SyncConfirmDialogProps = {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  deviceName: string;
  queue: SyncQueueItem[];
  libraryItems: LibraryItem[];
  syncing: boolean;
};

export function SyncConfirmDialog({
  open,
  onClose,
  onConfirm,
  deviceName,
  queue,
  libraryItems,
  syncing,
}: SyncConfirmDialogProps) {
  if (!open) return null;

  const pendingItems = queue.filter((q) => q.status === "pending");
  const addItems = pendingItems.filter((q) => q.action === "add");
  const removeItems = pendingItems.filter((q) => q.action === "remove");
  const importItems = pendingItems.filter((q) => q.action === "import");

  const getItemTitle = (item: SyncQueueItem) => {
    if (item.itemId) {
      const lib = libraryItems.find((l) => l.id === item.itemId);
      return lib?.title ?? "Unknown";
    }
    return item.ereaderPath?.split("/").pop() ?? "Unknown";
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative bg-[var(--app-bg)] rounded-xl shadow-xl w-full max-w-md mx-4">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-[var(--app-border)]">
          <h2 className="text-lg font-semibold">Sync to {deviceName}</h2>
          <button onClick={onClose} className="p-1 rounded hover:bg-[var(--app-bg-secondary)]">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-4 space-y-4 max-h-[60vh] overflow-auto">
          <p className="text-sm text-[var(--app-text-muted)]">
            Ready to sync the following changes:
          </p>

          {addItems.length > 0 && (
            <div>
              <h3 className="text-sm font-medium text-emerald-600 mb-2">
                ➕ Add to device ({addItems.length} {addItems.length === 1 ? "book" : "books"})
              </h3>
              <ul className="space-y-1 text-sm text-[var(--app-text-muted)] ml-6">
                {addItems.map((item) => (
                  <li key={item.id}>• {getItemTitle(item)}</li>
                ))}
              </ul>
            </div>
          )}

          {removeItems.length > 0 && (
            <div>
              <h3 className="text-sm font-medium text-red-600 mb-2">
                ➖ Remove from device ({removeItems.length} {removeItems.length === 1 ? "book" : "books"})
              </h3>
              <ul className="space-y-1 text-sm text-[var(--app-text-muted)] ml-6">
                {removeItems.map((item) => (
                  <li key={item.id}>• {getItemTitle(item)}</li>
                ))}
              </ul>
            </div>
          )}

          {importItems.length > 0 && (
            <div>
              <h3 className="text-sm font-medium text-blue-600 mb-2">
                📥 Import to library ({importItems.length} {importItems.length === 1 ? "book" : "books"})
              </h3>
              <ul className="space-y-1 text-sm text-[var(--app-text-muted)] ml-6">
                {importItems.map((item) => (
                  <li key={item.id}>• {getItemTitle(item)}</li>
                ))}
              </ul>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-2 p-4 border-t border-[var(--app-border)]">
          <Button variant="outline" onClick={onClose} disabled={syncing}>
            Cancel
          </Button>
          <Button onClick={onConfirm} disabled={syncing}>
            {syncing ? "Syncing..." : "Sync Now"}
          </Button>
        </div>
      </div>
    </div>
  );
}
```

**Step 2: Verify TypeScript compiles**

Run: `cd /Users/brian/dev/projects/folio/apps/desktop && npx tsc --noEmit`
Expected: No errors

**Step 3: Commit**

```bash
git add apps/desktop/src/components/SyncConfirmDialog.tsx
git commit -m "feat(ereader): add sync confirmation dialog component"
```

---

### Task 12: Integrate Sync Dialog and Execute Handler

**Files:**
- Modify: `apps/desktop/src/App.tsx`
- Modify: `apps/desktop/src/sections/EReaderView.tsx`

**Step 1: Add dialog state and import in App.tsx**

Add import:
```typescript
import { SyncConfirmDialog } from "./components/SyncConfirmDialog";
```

Add state:
```typescript
const [ereaderSyncDialogOpen, setEreaderSyncDialogOpen] = useState(false);
const [ereaderSyncing, setEreaderSyncing] = useState(false);
```

**Step 2: Update handleExecuteEreaderSync in App.tsx**

Replace the placeholder implementation:

```typescript
const handleExecuteEreaderSync = async () => {
  if (!isTauri() || !selectedEreaderDeviceId) return;
  setEreaderSyncing(true);
  try {
    const result = await invoke<{ added: number; removed: number; imported: number; errors: string[] }>("execute_sync", {
      deviceId: selectedEreaderDeviceId,
    });

    // Refresh data
    const queue = await invoke<SyncQueueItem[]>("get_sync_queue", { deviceId: selectedEreaderDeviceId });
    setEreaderSyncQueue(queue);

    const books = await invoke<EReaderBook[]>("scan_ereader", { deviceId: selectedEreaderDeviceId });
    setEreaderBooks(books);

    await refreshLibrary();

    // Show result
    const parts = [];
    if (result.added > 0) parts.push(`${result.added} added`);
    if (result.removed > 0) parts.push(`${result.removed} removed`);
    if (result.imported > 0) parts.push(`${result.imported} imported`);
    if (result.errors.length > 0) parts.push(`${result.errors.length} errors`);

    setScanStatus(`Sync complete: ${parts.join(", ")}`);
    setEreaderSyncDialogOpen(false);
  } catch (e) {
    setScanStatus("Sync failed.");
  } finally {
    setEreaderSyncing(false);
  }
};

const handleOpenSyncDialog = () => {
  setEreaderSyncDialogOpen(true);
};
```

**Step 3: Add dialog to render**

Add before the closing `</div>` of the main app:

```tsx
<SyncConfirmDialog
  open={ereaderSyncDialogOpen}
  onClose={() => setEreaderSyncDialogOpen(false)}
  onConfirm={handleExecuteEreaderSync}
  deviceName={ereaderDevices.find((d) => d.id === selectedEreaderDeviceId)?.name ?? "eReader"}
  queue={ereaderSyncQueue}
  libraryItems={libraryItems}
  syncing={ereaderSyncing}
/>
```

**Step 4: Update EReaderView to use dialog**

Change the `onExecuteSync` prop usage to open the dialog:

In EReaderView.tsx, update the Sync button:
```tsx
<Button size="sm" onClick={onExecuteSync}>
  Sync ({pendingQueue.length})
</Button>
```

And update App.tsx to pass `handleOpenSyncDialog`:
```tsx
onExecuteSync={handleOpenSyncDialog}
```

**Step 5: Verify TypeScript compiles**

Run: `cd /Users/brian/dev/projects/folio/apps/desktop && npx tsc --noEmit`
Expected: No errors

**Step 6: Commit**

```bash
git add apps/desktop/src/App.tsx apps/desktop/src/sections/EReaderView.tsx
git commit -m "feat(ereader): integrate sync confirmation dialog and execute handler"
```

---

### Task 13: Load Sync Queue on Device Selection

**Files:**
- Modify: `apps/desktop/src/App.tsx`

**Step 1: Add effect to load queue when device changes**

Add or update the effect:

```typescript
useEffect(() => {
  if (!isDesktop || !selectedEreaderDeviceId) return;
  const loadQueue = async () => {
    try {
      const queue = await invoke<SyncQueueItem[]>("get_sync_queue", { deviceId: selectedEreaderDeviceId });
      setEreaderSyncQueue(queue);
    } catch {
      setEreaderSyncQueue([]);
    }
  };
  void loadQueue();
}, [isDesktop, selectedEreaderDeviceId]);
```

**Step 2: Verify TypeScript compiles**

Run: `cd /Users/brian/dev/projects/folio/apps/desktop && npx tsc --noEmit`
Expected: No errors

**Step 3: Commit**

```bash
git add apps/desktop/src/App.tsx
git commit -m "feat(ereader): load sync queue when device is selected"
```

---

### Task 14: Final Testing & Polish

**Step 1: Build and test the full application**

Run: `cd /Users/brian/dev/projects/folio/apps/desktop && npm run tauri dev`

Test the following:
1. Navigate to eReader section - should show "No eReader Connected"
2. Click "Select eReader Folder" - should open folder picker
3. After selecting folder, device appears in dropdown
4. Click "Scan Device" - should find books
5. Books show with correct status badges
6. Click + to queue adding a book
7. Queue section shows pending item
8. Click Sync button - confirmation dialog appears
9. Confirm sync - files are copied/removed
10. Status updates after sync

**Step 2: Fix any issues found during testing**

**Step 3: Final commit**

```bash
git add -A
git commit -m "feat(ereader): complete eReader sync feature implementation"
```

---

## Summary

This plan implements the eReader sync feature in 14 tasks across 3 phases:

- **Phase 1 (Tasks 1-6):** Core infrastructure - database, types, device management, basic UI
- **Phase 2 (Tasks 7-8):** Scanning & matching - scan command, book list with status
- **Phase 3 (Tasks 9-14):** Sync queue & execution - queue management, execute sync, confirmation dialog

Each task is small and focused, with verification steps and commits.
