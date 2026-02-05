# Import Books Feature Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add an "Import Books" wizard that lets users import books from external folders into their library with duplicate detection and move/copy options.

**Architecture:** Single-screen review flow with two sections (New Books / Already in Library). Backend handles file scanning, metadata extraction, and duplicate detection. Frontend shows results and lets user make decisions before import.

**Tech Stack:** Tauri commands (Rust), React components (TypeScript), existing metadata/organizer infrastructure.

---

## Task 1: Add "import" View Type

**Files:**
- Modify: `apps/desktop/src/types/library.ts:1-15`

**Step 1: Add the view type**

Add `"import"` to the View union type:

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
  | "ereader"
  | "organize"
  | "missing-files"
  | "settings"
  | "edit"
  | "import";  // Add this line
```

**Step 2: Commit**

```bash
git add apps/desktop/src/types/library.ts
git commit -m "feat(import): add import view type"
```

---

## Task 2: Add Import Types

**Files:**
- Modify: `apps/desktop/src/types/library.ts` (append to end)

**Step 1: Add import-specific types**

Append these types at the end of the file:

```typescript
export type ImportCandidate = {
  id: string;
  filePath: string;
  filename: string;
  title: string | null;
  authors: string[];
  publishedYear: number | null;
  language: string | null;
  identifiers: string[];
  hash: string;
  sizeBytes: number;
  extension: string;
  hasCover: boolean;
};

export type ImportDuplicate = ImportCandidate & {
  matchedItemId: string;
  matchedItemTitle: string;
  matchType: "hash" | "metadata";
  existingFormats: string[];
};

export type ImportScanResult = {
  newBooks: ImportCandidate[];
  duplicates: ImportDuplicate[];
};
```

**Step 2: Commit**

```bash
git add apps/desktop/src/types/library.ts
git commit -m "feat(import): add ImportCandidate and ImportDuplicate types"
```

---

## Task 3: Create ImportView Component Shell

**Files:**
- Create: `apps/desktop/src/sections/ImportView.tsx`

**Step 1: Create the component file**

```typescript
import { ArrowLeft, FileUp, FolderUp, Loader2 } from "lucide-react";
import { useState } from "react";
import { Button } from "../components/ui";
import type { ImportCandidate, ImportDuplicate } from "../types/library";

type ImportViewProps = {
  onCancel: () => void;
  onImportComplete: () => void;
  libraryRoot: string | null;
};

type ImportMode = "move" | "copy";
type DuplicateAction = "skip" | "replace" | "add-format";
type ImportStatus = "selecting" | "scanning" | "reviewing" | "confirming" | "importing" | "done" | "error";

export function ImportView({ onCancel, onImportComplete, libraryRoot }: ImportViewProps) {
  const [status, setStatus] = useState<ImportStatus>("selecting");
  const [mode, setMode] = useState<ImportMode>("move");
  const [newBooks, setNewBooks] = useState<ImportCandidate[]>([]);
  const [duplicates, setDuplicates] = useState<ImportDuplicate[]>([]);
  const [selectedNew, setSelectedNew] = useState<Set<string>>(new Set());
  const [duplicateActions, setDuplicateActions] = useState<Record<string, DuplicateAction>>({});
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<{ current: number; total: number; file: string } | null>(null);

  const handleSelectFiles = async () => {
    // TODO: Implement file selection
  };

  const handleSelectFolder = async () => {
    // TODO: Implement folder selection
  };

  const handleImport = async () => {
    // TODO: Implement import
  };

  const toggleNewBook = (id: string) => {
    setSelectedNew((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const setDuplicateAction = (id: string, action: DuplicateAction) => {
    setDuplicateActions((prev) => ({ ...prev, [id]: action }));
  };

  const selectAllNew = () => {
    setSelectedNew(new Set(newBooks.map((b) => b.id)));
  };

  const deselectAllNew = () => {
    setSelectedNew(new Set());
  };

  const selectedCount = selectedNew.size;
  const actionableduplicates = duplicates.filter((d) => duplicateActions[d.id] !== "skip");
  const totalToImport = selectedCount + actionableduplicates.length;

  // Selection screen
  if (status === "selecting") {
    return (
      <div className="flex flex-col gap-6 p-6">
        <div className="flex items-center gap-4">
          <Button variant="ghost" onClick={onCancel}>
            <ArrowLeft size={16} />
          </Button>
          <h1 className="text-2xl font-bold text-app-ink">Import Books</h1>
        </div>

        <div className="flex flex-col items-center justify-center gap-6 py-16 rounded-xl border border-dashed border-app-border bg-app-bg/30">
          <p className="text-app-ink-muted">Select files or a folder to import</p>
          <div className="flex gap-4">
            <Button variant="outline" onClick={handleSelectFiles}>
              <FileUp size={16} className="mr-2" />
              Select Files
            </Button>
            <Button variant="outline" onClick={handleSelectFolder}>
              <FolderUp size={16} className="mr-2" />
              Select Folder
            </Button>
          </div>
        </div>
      </div>
    );
  }

  // Scanning screen
  if (status === "scanning") {
    return (
      <div className="flex flex-col gap-6 p-6">
        <div className="flex items-center gap-4">
          <h1 className="text-2xl font-bold text-app-ink">Import Books</h1>
        </div>
        <div className="flex flex-col items-center justify-center gap-4 py-16">
          <Loader2 size={32} className="animate-spin text-app-accent" />
          <p className="text-app-ink-muted">Scanning files...</p>
        </div>
      </div>
    );
  }

  // Review screen
  return (
    <div className="flex flex-col gap-6 p-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Button variant="ghost" onClick={onCancel}>
            <ArrowLeft size={16} />
          </Button>
          <h1 className="text-2xl font-bold text-app-ink">Import Books</h1>
        </div>
      </div>

      {/* Mode selection */}
      <div className="flex items-center gap-4 rounded-xl border border-app-border bg-white p-4">
        <span className="text-sm font-medium text-app-ink-muted">Mode:</span>
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="radio"
            name="mode"
            checked={mode === "move"}
            onChange={() => setMode("move")}
          />
          <span className="text-sm">Move</span>
        </label>
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="radio"
            name="mode"
            checked={mode === "copy"}
            onChange={() => setMode("copy")}
          />
          <span className="text-sm">Copy</span>
        </label>
        <span className="text-xs text-app-ink-muted ml-4">
          {mode === "move" ? "Files will be moved to your library. Originals will be deleted." : "Files will be copied. Originals remain in place."}
        </span>
      </div>

      {/* New Books section */}
      {newBooks.length > 0 && (
        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-app-ink">
              New Books ({newBooks.length})
            </h2>
            <div className="flex gap-2">
              <Button variant="ghost" size="sm" onClick={selectAllNew}>
                Select All
              </Button>
              <Button variant="ghost" size="sm" onClick={deselectAllNew}>
                Deselect All
              </Button>
            </div>
          </div>
          <div className="flex flex-col gap-2 rounded-xl border border-app-border bg-white p-4">
            {newBooks.map((book) => (
              <label
                key={book.id}
                className="flex items-center gap-3 p-2 rounded-lg hover:bg-app-bg/50 cursor-pointer"
              >
                <input
                  type="checkbox"
                  checked={selectedNew.has(book.id)}
                  onChange={() => toggleNewBook(book.id)}
                />
                <div className="flex-1 min-w-0">
                  <div className="font-medium text-app-ink truncate">
                    {book.title || book.filename}
                  </div>
                  <div className="text-xs text-app-ink-muted truncate">
                    {book.authors.length > 0 ? book.authors.join(", ") : "Unknown author"}
                    {book.publishedYear ? ` · ${book.publishedYear}` : ""}
                  </div>
                </div>
                <div className="text-xs text-app-ink-muted uppercase">
                  {book.extension}
                </div>
                <div className="text-xs text-app-ink-muted">
                  {formatBytes(book.sizeBytes)}
                </div>
              </label>
            ))}
          </div>
        </div>
      )}

      {/* Duplicates section */}
      {duplicates.length > 0 && (
        <div className="flex flex-col gap-3">
          <h2 className="text-lg font-semibold text-app-ink">
            Already in Library ({duplicates.length})
          </h2>
          <div className="flex flex-col gap-2 rounded-xl border border-app-border bg-white p-4">
            {duplicates.map((dup) => (
              <div
                key={dup.id}
                className="flex flex-col gap-2 p-3 rounded-lg border border-app-border/50 bg-amber-50/30"
              >
                <div className="flex items-start gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-app-ink truncate">
                      {dup.title || dup.filename}
                    </div>
                    <div className="text-xs text-app-ink-muted">
                      Matches: "{dup.matchedItemTitle}" ({dup.matchType === "hash" ? "exact file" : "title & author"})
                    </div>
                  </div>
                  <div className="text-xs text-app-ink-muted uppercase">
                    {dup.extension}
                  </div>
                </div>
                <div className="flex items-center gap-4 ml-0">
                  <label className="flex items-center gap-1.5 cursor-pointer text-xs">
                    <input
                      type="radio"
                      name={`dup-${dup.id}`}
                      checked={duplicateActions[dup.id] === "skip" || !duplicateActions[dup.id]}
                      onChange={() => setDuplicateAction(dup.id, "skip")}
                    />
                    Skip
                  </label>
                  <label className="flex items-center gap-1.5 cursor-pointer text-xs">
                    <input
                      type="radio"
                      name={`dup-${dup.id}`}
                      checked={duplicateActions[dup.id] === "replace"}
                      onChange={() => setDuplicateAction(dup.id, "replace")}
                    />
                    Replace file
                  </label>
                  <label className="flex items-center gap-1.5 cursor-pointer text-xs">
                    <input
                      type="radio"
                      name={`dup-${dup.id}`}
                      checked={duplicateActions[dup.id] === "add-format"}
                      onChange={() => setDuplicateAction(dup.id, "add-format")}
                    />
                    Add format
                  </label>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Empty state */}
      {newBooks.length === 0 && duplicates.length === 0 && (
        <div className="flex flex-col items-center justify-center py-12 rounded-xl border border-dashed border-app-border bg-app-bg/30 text-app-ink-muted">
          <p>No books found to import.</p>
        </div>
      )}

      {/* Footer */}
      <div className="flex items-center justify-between border-t border-app-border pt-4">
        <div className="text-sm text-app-ink-muted">
          {status === "confirming"
            ? `${mode === "move" ? "Moving" : "Copying"} ${totalToImport} book${totalToImport !== 1 ? "s" : ""} to library`
            : `${totalToImport} book${totalToImport !== 1 ? "s" : ""} selected`}
        </div>
        {status === "importing" && progress && (
          <div className="flex items-center gap-2 text-xs text-app-ink-muted">
            <Loader2 size={14} className="animate-spin" />
            <span>{progress.current}/{progress.total}</span>
          </div>
        )}
        <Button
          variant="primary"
          onClick={handleImport}
          disabled={totalToImport === 0 || status === "importing"}
        >
          {status === "confirming" ? "Confirm Import" : status === "importing" ? "Importing..." : `Import ${totalToImport} book${totalToImport !== 1 ? "s" : ""}`}
        </Button>
      </div>

      {error && (
        <div className="p-4 rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm">
          {error}
        </div>
      )}
    </div>
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  const mb = kb / 1024;
  return `${mb.toFixed(1)} MB`;
}
```

**Step 2: Commit**

```bash
git add apps/desktop/src/sections/ImportView.tsx
git commit -m "feat(import): create ImportView component shell"
```

---

## Task 4: Add scan_for_import Tauri Command

**Files:**
- Modify: `apps/desktop/src-tauri/src/lib.rs`

**Step 1: Add import result structs after line ~200**

Find the `EReaderBook` struct and add after it:

```rust
#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct ImportCandidate {
  id: String,
  file_path: String,
  filename: String,
  title: Option<String>,
  authors: Vec<String>,
  published_year: Option<i64>,
  language: Option<String>,
  identifiers: Vec<String>,
  hash: String,
  size_bytes: i64,
  extension: String,
  has_cover: bool,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct ImportDuplicate {
  id: String,
  file_path: String,
  filename: String,
  title: Option<String>,
  authors: Vec<String>,
  published_year: Option<i64>,
  language: Option<String>,
  identifiers: Vec<String>,
  hash: String,
  size_bytes: i64,
  extension: String,
  has_cover: bool,
  matched_item_id: String,
  matched_item_title: String,
  match_type: String,
  existing_formats: Vec<String>,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct ImportScanResult {
  new_books: Vec<ImportCandidate>,
  duplicates: Vec<ImportDuplicate>,
}
```

**Step 2: Add the scan_for_import command**

Add this command function (find a suitable location near other scan-related functions):

```rust
#[tauri::command]
async fn scan_for_import(app: tauri::AppHandle, paths: Vec<String>) -> Result<ImportScanResult, String> {
  let app_handle = app.clone();
  tauri::async_runtime::spawn_blocking(move || scan_for_import_sync(app_handle, paths))
    .await
    .map_err(|err| err.to_string())?
}

fn scan_for_import_sync(app: tauri::AppHandle, paths: Vec<String>) -> Result<ImportScanResult, String> {
  let conn = open_db(&app)?;

  // Collect all book files from the paths
  let mut files_to_scan: Vec<std::path::PathBuf> = vec![];
  for path_str in &paths {
    let path = std::path::Path::new(path_str);
    if path.is_file() {
      let ext = path.extension().and_then(|e| e.to_str()).unwrap_or("").to_lowercase();
      if ext == "epub" || ext == "pdf" {
        files_to_scan.push(path.to_path_buf());
      }
    } else if path.is_dir() {
      for entry in WalkDir::new(path).into_iter().filter_map(|e| e.ok()) {
        if entry.file_type().is_file() {
          let ext = entry.path().extension().and_then(|e| e.to_str()).unwrap_or("").to_lowercase();
          if ext == "epub" || ext == "pdf" {
            files_to_scan.push(entry.path().to_path_buf());
          }
        }
      }
    }
  }

  // Get existing hashes and title/author combos from library
  let mut existing_hashes: std::collections::HashMap<String, (String, String)> = std::collections::HashMap::new();
  let mut stmt = conn.prepare(
    "SELECT f.sha256, i.id, COALESCE(i.title, '') FROM files f JOIN items i ON f.item_id = i.id WHERE f.sha256 IS NOT NULL"
  ).map_err(|e| e.to_string())?;
  let rows = stmt.query_map([], |row| {
    Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?, row.get::<_, String>(2)?))
  }).map_err(|e| e.to_string())?;
  for row in rows {
    if let Ok((hash, item_id, title)) = row {
      existing_hashes.insert(hash, (item_id, title));
    }
  }

  // Get existing title+author combinations
  let mut existing_titles: std::collections::HashMap<String, (String, String, Vec<String>)> = std::collections::HashMap::new();
  let mut stmt = conn.prepare(
    "SELECT i.id, LOWER(COALESCE(i.title, '')), COALESCE(i.title, ''), GROUP_CONCAT(LOWER(a.name), '|')
     FROM items i
     LEFT JOIN item_authors ia ON i.id = ia.item_id
     LEFT JOIN authors a ON ia.author_id = a.id
     GROUP BY i.id"
  ).map_err(|e| e.to_string())?;
  let rows = stmt.query_map([], |row| {
    Ok((
      row.get::<_, String>(0)?,
      row.get::<_, String>(1)?,
      row.get::<_, String>(2)?,
      row.get::<_, Option<String>>(3)?,
    ))
  }).map_err(|e| e.to_string())?;
  for row in rows {
    if let Ok((item_id, title_lower, title, authors_str)) = row {
      let authors: Vec<String> = authors_str.unwrap_or_default().split('|').map(|s| s.to_string()).collect();
      let key = format!("{}|{}", title_lower, authors.join("|"));
      existing_titles.insert(key, (item_id, title, get_item_formats(&conn, &item_id)));
    }
  }

  let mut new_books: Vec<ImportCandidate> = vec![];
  let mut duplicates: Vec<ImportDuplicate> = vec![];

  for file_path in files_to_scan {
    let path_str = file_path.to_string_lossy().to_string();
    let filename = file_path.file_name().and_then(|n| n.to_str()).unwrap_or("").to_string();
    let extension = file_path.extension().and_then(|e| e.to_str()).unwrap_or("").to_lowercase();

    // Get file size
    let size_bytes = std::fs::metadata(&file_path).map(|m| m.len() as i64).unwrap_or(0);

    // Compute hash
    let hash = match compute_sha256(&file_path) {
      Ok(h) => h,
      Err(_) => continue,
    };

    // Extract metadata
    let (title, authors, year, language, identifiers, has_cover) = extract_metadata_for_import(&file_path, &extension);

    let id = Uuid::new_v4().to_string();

    // Check for hash duplicate first
    if let Some((matched_id, matched_title)) = existing_hashes.get(&hash) {
      duplicates.push(ImportDuplicate {
        id,
        file_path: path_str,
        filename,
        title,
        authors,
        published_year: year,
        language,
        identifiers,
        hash,
        size_bytes,
        extension: extension.clone(),
        has_cover,
        matched_item_id: matched_id.clone(),
        matched_item_title: matched_title.clone(),
        match_type: "hash".to_string(),
        existing_formats: get_item_formats(&conn, matched_id),
      });
      continue;
    }

    // Check for title+author duplicate
    let title_lower = title.clone().unwrap_or_default().to_lowercase();
    let authors_lower: Vec<String> = authors.iter().map(|a| a.to_lowercase()).collect();
    let lookup_key = format!("{}|{}", title_lower, authors_lower.join("|"));

    if let Some((matched_id, matched_title, formats)) = existing_titles.get(&lookup_key) {
      duplicates.push(ImportDuplicate {
        id,
        file_path: path_str,
        filename,
        title,
        authors,
        published_year: year,
        language,
        identifiers,
        hash,
        size_bytes,
        extension: extension.clone(),
        has_cover,
        matched_item_id: matched_id.clone(),
        matched_item_title: matched_title.clone(),
        match_type: "metadata".to_string(),
        existing_formats: formats.clone(),
      });
      continue;
    }

    // New book
    new_books.push(ImportCandidate {
      id,
      file_path: path_str,
      filename,
      title,
      authors,
      published_year: year,
      language,
      identifiers,
      hash,
      size_bytes,
      extension,
      has_cover,
    });
  }

  Ok(ImportScanResult { new_books, duplicates })
}

fn get_item_formats(conn: &Connection, item_id: &str) -> Vec<String> {
  conn.prepare("SELECT DISTINCT LOWER(extension) FROM files WHERE item_id = ?1")
    .and_then(|mut stmt| {
      stmt.query_map([item_id], |row| row.get::<_, String>(0))
        .map(|rows| rows.filter_map(|r| r.ok()).collect())
    })
    .unwrap_or_default()
}

fn extract_metadata_for_import(path: &std::path::Path, ext: &str) -> (Option<String>, Vec<String>, Option<i64>, Option<String>, Vec<String>, bool) {
  match ext {
    "epub" => {
      match parser::parse_epub(path) {
        Ok(meta) => (
          meta.title,
          meta.authors,
          meta.published_year.map(|y| y as i64),
          meta.language,
          meta.identifiers,
          meta.cover_data.is_some(),
        ),
        Err(_) => (None, vec![], None, None, vec![], false),
      }
    }
    "pdf" => {
      match parser::parse_pdf(path) {
        Ok(meta) => (
          meta.title,
          meta.authors,
          meta.published_year.map(|y| y as i64),
          None,
          vec![],
          false,
        ),
        Err(_) => (None, vec![], None, None, vec![], false),
      }
    }
    _ => (None, vec![], None, None, vec![], false),
  }
}

fn compute_sha256(path: &std::path::Path) -> Result<String, std::io::Error> {
  let mut file = std::fs::File::open(path)?;
  let mut hasher = Sha256::new();
  let mut buffer = [0u8; 8192];
  loop {
    let bytes_read = file.read(&mut buffer)?;
    if bytes_read == 0 {
      break;
    }
    hasher.update(&buffer[..bytes_read]);
  }
  Ok(format!("{:x}", hasher.finalize()))
}
```

**Step 3: Register the command**

Find the `.invoke_handler(tauri::generate_handler![` line and add `scan_for_import` to the list.

**Step 4: Commit**

```bash
git add apps/desktop/src-tauri/src/lib.rs
git commit -m "feat(import): add scan_for_import Tauri command"
```

---

## Task 5: Add import_books Tauri Command

**Files:**
- Modify: `apps/desktop/src-tauri/src/lib.rs`

**Step 1: Add import request types**

Add after the ImportScanResult struct:

```rust
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ImportRequest {
  mode: String,  // "move" or "copy"
  library_root: String,
  template: String,
  new_book_ids: Vec<String>,
  duplicate_actions: std::collections::HashMap<String, String>,  // id -> "skip" | "replace" | "add-format"
  candidates: Vec<ImportCandidateInput>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ImportCandidateInput {
  id: String,
  file_path: String,
  filename: String,
  title: Option<String>,
  authors: Vec<String>,
  published_year: Option<i64>,
  language: Option<String>,
  identifiers: Vec<String>,
  hash: String,
  size_bytes: i64,
  extension: String,
  has_cover: bool,
  matched_item_id: Option<String>,
  match_type: Option<String>,
}
```

**Step 2: Add the import_books command**

```rust
#[tauri::command]
async fn import_books(app: tauri::AppHandle, request: ImportRequest) -> Result<OperationStats, String> {
  let app_handle = app.clone();
  tauri::async_runtime::spawn_blocking(move || import_books_sync(app_handle, request))
    .await
    .map_err(|err| err.to_string())?
}

fn import_books_sync(app: tauri::AppHandle, request: ImportRequest) -> Result<OperationStats, String> {
  let conn = open_db(&app)?;
  let mut stats = OperationStats {
    total: 0,
    processed: 0,
    skipped: 0,
    errors: 0,
  };

  // Build lookup of candidates by id
  let candidates_by_id: std::collections::HashMap<String, &ImportCandidateInput> =
    request.candidates.iter().map(|c| (c.id.clone(), c)).collect();

  // Process new books
  for book_id in &request.new_book_ids {
    stats.total += 1;
    let candidate = match candidates_by_id.get(book_id) {
      Some(c) => c,
      None => {
        stats.errors += 1;
        continue;
      }
    };

    let _ = app.emit("import-progress", OperationProgress {
      item_id: book_id.clone(),
      status: "processing".to_string(),
      message: Some(candidate.filename.clone()),
      current: stats.processed as i64 + stats.errors as i64 + stats.skipped as i64,
      total: (request.new_book_ids.len() + request.duplicate_actions.len()) as i64,
    });

    match import_new_book(&conn, &app, candidate, &request) {
      Ok(_) => stats.processed += 1,
      Err(e) => {
        log::error!("Failed to import {}: {}", candidate.file_path, e);
        stats.errors += 1;
      }
    }
  }

  // Process duplicates with actions
  for (dup_id, action) in &request.duplicate_actions {
    if action == "skip" {
      stats.skipped += 1;
      continue;
    }

    stats.total += 1;
    let candidate = match candidates_by_id.get(dup_id) {
      Some(c) => c,
      None => {
        stats.errors += 1;
        continue;
      }
    };

    let _ = app.emit("import-progress", OperationProgress {
      item_id: dup_id.clone(),
      status: "processing".to_string(),
      message: Some(candidate.filename.clone()),
      current: stats.processed as i64 + stats.errors as i64 + stats.skipped as i64,
      total: (request.new_book_ids.len() + request.duplicate_actions.len()) as i64,
    });

    let matched_item_id = match &candidate.matched_item_id {
      Some(id) => id,
      None => {
        stats.errors += 1;
        continue;
      }
    };

    match action.as_str() {
      "replace" => {
        match replace_file_for_item(&conn, &app, matched_item_id, candidate, &request) {
          Ok(_) => stats.processed += 1,
          Err(e) => {
            log::error!("Failed to replace file: {}", e);
            stats.errors += 1;
          }
        }
      }
      "add-format" => {
        match add_file_to_item(&conn, &app, matched_item_id, candidate, &request) {
          Ok(_) => stats.processed += 1,
          Err(e) => {
            log::error!("Failed to add format: {}", e);
            stats.errors += 1;
          }
        }
      }
      _ => {
        stats.skipped += 1;
      }
    }
  }

  let _ = app.emit("import-complete", stats.clone());
  Ok(stats)
}

fn import_new_book(
  conn: &Connection,
  app: &tauri::AppHandle,
  candidate: &ImportCandidateInput,
  request: &ImportRequest,
) -> Result<(), String> {
  let item_id = Uuid::new_v4().to_string();
  let file_id = Uuid::new_v4().to_string();
  let now = chrono::Utc::now().timestamp_millis();

  // Compute target path
  let target_path = compute_import_target_path(
    &request.library_root,
    &request.template,
    candidate,
  )?;

  // Ensure parent directory exists
  if let Some(parent) = std::path::Path::new(&target_path).parent() {
    std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
  }

  // Copy or move file
  let source = std::path::Path::new(&candidate.file_path);
  let target = std::path::Path::new(&target_path);

  if request.mode == "move" {
    std::fs::rename(source, target).or_else(|_| {
      std::fs::copy(source, target).and_then(|_| std::fs::remove_file(source))
    }).map_err(|e| e.to_string())?;
  } else {
    std::fs::copy(source, target).map_err(|e| e.to_string())?;
  }

  // Insert item
  conn.execute(
    "INSERT INTO items (id, title, published_year, language, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?5)",
    params![item_id, candidate.title, candidate.published_year, candidate.language, now],
  ).map_err(|e| e.to_string())?;

  // Insert file
  let file_size = std::fs::metadata(&target_path).map(|m| m.len() as i64).unwrap_or(candidate.size_bytes);
  conn.execute(
    "INSERT INTO files (id, item_id, path, filename, extension, size_bytes, sha256, hash_algo, status, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 'sha256', 'active', ?8, ?8)",
    params![file_id, item_id, target_path, candidate.filename, candidate.extension, file_size, candidate.hash, now],
  ).map_err(|e| e.to_string())?;

  // Insert authors
  for (idx, author_name) in candidate.authors.iter().enumerate() {
    let author_id = get_or_create_author(conn, author_name)?;
    conn.execute(
      "INSERT OR IGNORE INTO item_authors (item_id, author_id, role, ord) VALUES (?1, ?2, 'author', ?3)",
      params![item_id, author_id, idx as i64],
    ).map_err(|e| e.to_string())?;
  }

  // Insert identifiers
  for identifier in &candidate.identifiers {
    let ident_id = Uuid::new_v4().to_string();
    let (id_type, id_value) = parse_identifier(identifier);
    conn.execute(
      "INSERT INTO identifiers (id, item_id, type, value, source, confidence) VALUES (?1, ?2, ?3, ?4, 'embedded', 1.0)",
      params![ident_id, item_id, id_type, id_value],
    ).map_err(|e| e.to_string())?;
  }

  // Extract and save cover if EPUB
  if candidate.extension == "epub" && candidate.has_cover {
    if let Ok(cover_data) = extract_epub_cover(&target_path) {
      save_cover_for_item(conn, app, &item_id, &cover_data)?;
    }
  }

  Ok(())
}

fn replace_file_for_item(
  conn: &Connection,
  app: &tauri::AppHandle,
  item_id: &str,
  candidate: &ImportCandidateInput,
  request: &ImportRequest,
) -> Result<(), String> {
  let file_id = Uuid::new_v4().to_string();
  let now = chrono::Utc::now().timestamp_millis();

  // Compute target path
  let target_path = compute_import_target_path_for_existing(conn, &request.library_root, &request.template, item_id, candidate)?;

  // Ensure parent directory exists
  if let Some(parent) = std::path::Path::new(&target_path).parent() {
    std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
  }

  // Find existing file with same extension to replace
  let existing_file: Option<(String, String)> = conn.query_row(
    "SELECT id, path FROM files WHERE item_id = ?1 AND LOWER(extension) = ?2 AND status = 'active' LIMIT 1",
    params![item_id, candidate.extension.to_lowercase()],
    |row| Ok((row.get(0)?, row.get(1)?)),
  ).optional().map_err(|e| e.to_string())?;

  // Copy or move new file
  let source = std::path::Path::new(&candidate.file_path);
  let target = std::path::Path::new(&target_path);

  if request.mode == "move" {
    std::fs::rename(source, target).or_else(|_| {
      std::fs::copy(source, target).and_then(|_| std::fs::remove_file(source))
    }).map_err(|e| e.to_string())?;
  } else {
    std::fs::copy(source, target).map_err(|e| e.to_string())?;
  }

  // Mark old file as inactive and delete it
  if let Some((old_file_id, old_path)) = existing_file {
    conn.execute("UPDATE files SET status = 'inactive' WHERE id = ?1", params![old_file_id]).map_err(|e| e.to_string())?;
    let _ = std::fs::remove_file(&old_path); // Best effort delete
  }

  // Insert new file record
  let file_size = std::fs::metadata(&target_path).map(|m| m.len() as i64).unwrap_or(candidate.size_bytes);
  conn.execute(
    "INSERT INTO files (id, item_id, path, filename, extension, size_bytes, sha256, hash_algo, status, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 'sha256', 'active', ?8, ?8)",
    params![file_id, item_id, target_path, candidate.filename, candidate.extension, file_size, candidate.hash, now],
  ).map_err(|e| e.to_string())?;

  Ok(())
}

fn add_file_to_item(
  conn: &Connection,
  _app: &tauri::AppHandle,
  item_id: &str,
  candidate: &ImportCandidateInput,
  request: &ImportRequest,
) -> Result<(), String> {
  let file_id = Uuid::new_v4().to_string();
  let now = chrono::Utc::now().timestamp_millis();

  // Compute target path
  let target_path = compute_import_target_path_for_existing(conn, &request.library_root, &request.template, item_id, candidate)?;

  // Ensure parent directory exists
  if let Some(parent) = std::path::Path::new(&target_path).parent() {
    std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
  }

  // Copy or move file
  let source = std::path::Path::new(&candidate.file_path);
  let target = std::path::Path::new(&target_path);

  if request.mode == "move" {
    std::fs::rename(source, target).or_else(|_| {
      std::fs::copy(source, target).and_then(|_| std::fs::remove_file(source))
    }).map_err(|e| e.to_string())?;
  } else {
    std::fs::copy(source, target).map_err(|e| e.to_string())?;
  }

  // Insert file record
  let file_size = std::fs::metadata(&target_path).map(|m| m.len() as i64).unwrap_or(candidate.size_bytes);
  conn.execute(
    "INSERT INTO files (id, item_id, path, filename, extension, size_bytes, sha256, hash_algo, status, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 'sha256', 'active', ?8, ?8)",
    params![file_id, item_id, target_path, candidate.filename, candidate.extension, file_size, candidate.hash, now],
  ).map_err(|e| e.to_string())?;

  Ok(())
}

fn compute_import_target_path(
  library_root: &str,
  template: &str,
  candidate: &ImportCandidateInput,
) -> Result<String, String> {
  let author = candidate.authors.first().map(|a| sanitize_path_component(a)).unwrap_or_else(|| "Unknown".to_string());
  let title = candidate.title.as_ref().map(|t| sanitize_path_component(t)).unwrap_or_else(|| "Untitled".to_string());
  let year = candidate.published_year.map(|y| y.to_string()).unwrap_or_default();
  let isbn = candidate.identifiers.first().cloned().unwrap_or_default();
  let ext = &candidate.extension;

  let relative = template
    .replace("{Author}", &author)
    .replace("{Title}", &title)
    .replace("{Year}", &year)
    .replace("{ISBN}", &isbn)
    .replace("{ISBN13}", &isbn)
    .replace("{ext}", ext);

  let full_path = std::path::Path::new(library_root).join(&relative);
  Ok(full_path.to_string_lossy().to_string())
}

fn compute_import_target_path_for_existing(
  conn: &Connection,
  library_root: &str,
  template: &str,
  item_id: &str,
  candidate: &ImportCandidateInput,
) -> Result<String, String> {
  // Get metadata from existing item
  let (title, year): (Option<String>, Option<i64>) = conn.query_row(
    "SELECT title, published_year FROM items WHERE id = ?1",
    params![item_id],
    |row| Ok((row.get(0)?, row.get(1)?)),
  ).map_err(|e| e.to_string())?;

  let authors: Vec<String> = conn.prepare("SELECT a.name FROM authors a JOIN item_authors ia ON a.id = ia.author_id WHERE ia.item_id = ?1 ORDER BY ia.ord")
    .and_then(|mut stmt| stmt.query_map([item_id], |row| row.get::<_, String>(0)).map(|rows| rows.filter_map(|r| r.ok()).collect()))
    .unwrap_or_default();

  let isbn: Option<String> = conn.query_row(
    "SELECT value FROM identifiers WHERE item_id = ?1 AND type IN ('ISBN13', 'ISBN10') LIMIT 1",
    params![item_id],
    |row| row.get(0),
  ).optional().map_err(|e| e.to_string())?.flatten();

  let author = authors.first().map(|a| sanitize_path_component(a)).unwrap_or_else(|| "Unknown".to_string());
  let title_str = title.as_ref().map(|t| sanitize_path_component(t)).unwrap_or_else(|| "Untitled".to_string());
  let year_str = year.map(|y| y.to_string()).unwrap_or_default();
  let isbn_str = isbn.unwrap_or_default();
  let ext = &candidate.extension;

  let relative = template
    .replace("{Author}", &author)
    .replace("{Title}", &title_str)
    .replace("{Year}", &year_str)
    .replace("{ISBN}", &isbn_str)
    .replace("{ISBN13}", &isbn_str)
    .replace("{ext}", ext);

  let full_path = std::path::Path::new(library_root).join(&relative);
  Ok(full_path.to_string_lossy().to_string())
}

fn sanitize_path_component(s: &str) -> String {
  s.chars()
    .map(|c| match c {
      '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|' => '_',
      _ => c,
    })
    .collect::<String>()
    .trim()
    .to_string()
}

fn get_or_create_author(conn: &Connection, name: &str) -> Result<String, String> {
  let existing: Option<String> = conn.query_row(
    "SELECT id FROM authors WHERE LOWER(name) = LOWER(?1)",
    params![name],
    |row| row.get(0),
  ).optional().map_err(|e| e.to_string())?;

  if let Some(id) = existing {
    return Ok(id);
  }

  let id = Uuid::new_v4().to_string();
  conn.execute(
    "INSERT INTO authors (id, name, sort_name) VALUES (?1, ?2, ?2)",
    params![id, name],
  ).map_err(|e| e.to_string())?;
  Ok(id)
}

fn parse_identifier(identifier: &str) -> (&str, &str) {
  if identifier.starts_with("ISBN:") {
    let value = &identifier[5..];
    if value.len() == 13 {
      ("ISBN13", value)
    } else {
      ("ISBN10", value)
    }
  } else {
    ("OTHER", identifier)
  }
}
```

**Step 3: Register the command**

Add `import_books` to the invoke_handler list.

**Step 4: Commit**

```bash
git add apps/desktop/src-tauri/src/lib.rs
git commit -m "feat(import): add import_books Tauri command"
```

---

## Task 6: Wire Up File Selection in ImportView

**Files:**
- Modify: `apps/desktop/src/sections/ImportView.tsx`

**Step 1: Add imports and file selection logic**

Update the imports and add the selection handlers:

```typescript
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { ArrowLeft, FileUp, FolderUp, Loader2 } from "lucide-react";
import { useState } from "react";
import { Button } from "../components/ui";
import type { ImportCandidate, ImportDuplicate, ImportScanResult } from "../types/library";

// ... keep existing type definitions ...

export function ImportView({ onCancel, onImportComplete, libraryRoot }: ImportViewProps) {
  // ... keep existing state ...

  const handleSelectFiles = async () => {
    try {
      const selected = await open({
        multiple: true,
        filters: [{ name: "Books", extensions: ["epub", "pdf"] }],
      });
      if (!selected || (Array.isArray(selected) && selected.length === 0)) return;

      const paths = Array.isArray(selected) ? selected : [selected];
      await scanPaths(paths);
    } catch (err) {
      setError(String(err));
    }
  };

  const handleSelectFolder = async () => {
    try {
      const selected = await open({
        directory: true,
        multiple: false,
      });
      if (!selected) return;

      await scanPaths([selected]);
    } catch (err) {
      setError(String(err));
    }
  };

  const scanPaths = async (paths: string[]) => {
    setStatus("scanning");
    setError(null);
    try {
      const result = await invoke<ImportScanResult>("scan_for_import", { paths });
      setNewBooks(result.newBooks);
      setDuplicates(result.duplicates);

      // Pre-select all new books
      setSelectedNew(new Set(result.newBooks.map((b) => b.id)));

      // Set smart defaults for duplicates
      const defaultActions: Record<string, DuplicateAction> = {};
      for (const dup of result.duplicates) {
        if (dup.matchType === "hash") {
          defaultActions[dup.id] = "skip";
        } else if (dup.existingFormats.includes(dup.extension.toLowerCase())) {
          defaultActions[dup.id] = "replace";
        } else {
          defaultActions[dup.id] = "add-format";
        }
      }
      setDuplicateActions(defaultActions);

      setStatus("reviewing");
    } catch (err) {
      setError(String(err));
      setStatus("selecting");
    }
  };

  // ... rest of component stays the same ...
```

**Step 2: Commit**

```bash
git add apps/desktop/src/sections/ImportView.tsx
git commit -m "feat(import): wire up file and folder selection"
```

---

## Task 7: Wire Up Import Execution in ImportView

**Files:**
- Modify: `apps/desktop/src/sections/ImportView.tsx`

**Step 1: Add import execution and progress handling**

Add the listen import and update handleImport:

```typescript
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
// ... rest of imports ...

import type { ImportCandidate, ImportDuplicate, ImportScanResult, OperationProgress, OperationStats } from "../types/library";

// In the component:
  const handleImport = async () => {
    if (status === "reviewing") {
      setStatus("confirming");
      return;
    }

    if (!libraryRoot) {
      setError("Library root not configured. Please set it in Settings.");
      return;
    }

    setStatus("importing");
    setError(null);

    // Set up progress listener
    const unlisten = await listen<OperationProgress>("import-progress", (event) => {
      setProgress({
        current: event.payload.current,
        total: event.payload.total,
        file: event.payload.message || "",
      });
    });

    try {
      // Build candidates list (both new books and duplicates)
      const allCandidates = [
        ...newBooks.map((b) => ({ ...b, matchedItemId: null, matchType: null })),
        ...duplicates.map((d) => ({ ...d, matchedItemId: d.matchedItemId, matchType: d.matchType })),
      ];

      const result = await invoke<OperationStats>("import_books", {
        request: {
          mode,
          libraryRoot,
          template: "{Author}/{Title}.{ext}",  // TODO: Get from settings
          newBookIds: Array.from(selectedNew),
          duplicateActions,
          candidates: allCandidates,
        },
      });

      setStatus("done");
      setProgress(null);

      // Show success briefly then call completion callback
      setTimeout(() => {
        onImportComplete();
      }, 1500);
    } catch (err) {
      setError(String(err));
      setStatus("error");
    } finally {
      unlisten();
    }
  };
```

**Step 2: Add done/error states to the render**

Add after the footer section:

```typescript
      {/* Success state */}
      {status === "done" && (
        <div className="p-4 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-700 text-sm">
          Import complete! Refreshing library...
        </div>
      )}
```

**Step 3: Commit**

```bash
git add apps/desktop/src/sections/ImportView.tsx
git commit -m "feat(import): wire up import execution with progress"
```

---

## Task 8: Integrate ImportView into App.tsx

**Files:**
- Modify: `apps/desktop/src/App.tsx`

**Step 1: Import the ImportView component**

Add to imports (around line 18):

```typescript
import { ImportView } from "./sections/ImportView";
```

**Step 2: Add import state**

Add state variables (around line 230):

```typescript
const [importActive, setImportActive] = useState(false);
```

**Step 3: Update Sidebar Add Books handler**

Find the `handleScan` function and modify the Sidebar props to handle import:

```typescript
const handleAddBooks = useCallback(() => {
  setImportActive(true);
  setView("import");
}, []);
```

Update the Sidebar component to use `handleAddBooks` instead of `handleScan` for the Add Books button:

```typescript
<Sidebar
  // ... other props
  handleScan={handleAddBooks}  // Rename prop usage
  // ... other props
/>
```

**Step 4: Add ImportView rendering**

Find the view rendering section (around line 2247 after organize view) and add:

```typescript
{view === "import" ? (
  <ImportView
    onCancel={() => {
      setImportActive(false);
      setView("library-books");
    }}
    onImportComplete={() => {
      setImportActive(false);
      setView("library-books");
      refreshLibrary();
    }}
    libraryRoot={organizeRoot}
  />
) : null}
```

**Step 5: Commit**

```bash
git add apps/desktop/src/App.tsx
git commit -m "feat(import): integrate ImportView into App"
```

---

## Task 9: Add Import Settings Persistence

**Files:**
- Modify: `apps/desktop/src/sections/ImportView.tsx`

**Step 1: Add localStorage for mode preference**

Update the component to persist mode selection:

```typescript
export function ImportView({ onCancel, onImportComplete, libraryRoot }: ImportViewProps) {
  const [status, setStatus] = useState<ImportStatus>("selecting");
  const [mode, setMode] = useState<ImportMode>(() => {
    const saved = localStorage.getItem("importMode");
    return (saved === "copy" || saved === "move") ? saved : "move";
  });
  // ... rest of state ...

  const updateMode = (newMode: ImportMode) => {
    setMode(newMode);
    localStorage.setItem("importMode", newMode);
  };

  // Update the radio buttons to use updateMode instead of setMode
```

Update the radio onChange handlers:

```typescript
onChange={() => updateMode("move")}
// and
onChange={() => updateMode("copy")}
```

**Step 2: Commit**

```bash
git add apps/desktop/src/sections/ImportView.tsx
git commit -m "feat(import): persist import mode preference"
```

---

## Task 10: Add Template Support from Settings

**Files:**
- Modify: `apps/desktop/src/sections/ImportView.tsx`
- Modify: `apps/desktop/src/App.tsx`

**Step 1: Update ImportViewProps to accept template**

```typescript
type ImportViewProps = {
  onCancel: () => void;
  onImportComplete: () => void;
  libraryRoot: string | null;
  template: string;
};
```

**Step 2: Use template in import request**

Update the invoke call:

```typescript
const result = await invoke<OperationStats>("import_books", {
  request: {
    mode,
    libraryRoot,
    template,  // Use prop instead of hardcoded
    newBookIds: Array.from(selectedNew),
    duplicateActions,
    candidates: allCandidates,
  },
});
```

**Step 3: Pass template from App.tsx**

Update the ImportView rendering in App.tsx:

```typescript
<ImportView
  onCancel={() => {
    setImportActive(false);
    setView("library-books");
  }}
  onImportComplete={() => {
    setImportActive(false);
    setView("library-books");
    refreshLibrary();
  }}
  libraryRoot={organizeRoot}
  template={organizeTemplate}
/>
```

**Step 4: Commit**

```bash
git add apps/desktop/src/sections/ImportView.tsx apps/desktop/src/App.tsx
git commit -m "feat(import): use organizer template for import paths"
```

---

## Task 11: Test the Complete Flow

**Step 1: Build and run the app**

```bash
cd apps/desktop
pnpm tauri dev
```

**Step 2: Manual test checklist**

- [ ] Click "Add Books" in sidebar
- [ ] Select a folder with some EPUB/PDF files
- [ ] Verify scanning shows progress
- [ ] Verify new books appear in "New Books" section
- [ ] Verify duplicates appear in "Already in Library" section
- [ ] Toggle move/copy mode
- [ ] Select/deselect books
- [ ] Change duplicate actions
- [ ] Click Import and verify files are copied/moved
- [ ] Verify library refreshes with new books

**Step 3: Commit any fixes**

```bash
git add -A
git commit -m "fix(import): address issues found in testing"
```

---

## Summary

This plan implements the Import Books feature with:

1. **Types** - New view type and import-specific types
2. **Backend** - Two Tauri commands: `scan_for_import` and `import_books`
3. **Frontend** - ImportView component with file selection, review screen, and import execution
4. **Integration** - Wired into App.tsx with proper navigation and settings
5. **Persistence** - Mode preference saved to localStorage

The feature reuses:
- Existing metadata extraction from parser module
- Organizer's template system for file paths
- OperationProgress pattern for progress tracking
- Dialog plugin for file/folder selection
