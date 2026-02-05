# Import Books Feature Design

## Overview

A single-screen import wizard for adding books from external locations (Downloads folder, inbox folder) into the Folio library. Triggered by the existing "Add Books" sidebar button.

### Goals

- Import books from outside the library folder structure
- Detect duplicates before importing (reuse existing duplicate detection)
- Support move or copy modes (reuse Organizer logic)
- Clear, no-surprises UX showing exactly what will happen before it happens

### Non-Goals

- Bulk migration from other library software (future feature)
- Automatic inbox watching/hot folder (future feature)

## User Flow

1. **Click "Add Books"** → File/folder picker dialog appears
2. **Select files or folder** → App scans and parses metadata
3. **Review screen appears** → Shows parsed books split into "New" and "Already in Library" sections
4. **Make decisions** → Toggle move/copy, check/uncheck new books, choose skip/replace/add-format for duplicates
5. **Click Import** → Files are processed, moved/copied into library structure, database updated

## File Selection

### Picker Behavior

- Two options: "Select Files" or "Select Folder"
- File filter: `.epub`, `.pdf` extensions
- Folder selection scans recursively for supported files
- Stores last used path for quick access on next use

### After Selection

- Loading state: "Scanning X files..."
- Parse metadata using existing `extractMetadataForFile()`
- Compute SHA256 hash for duplicate detection
- Compare against library using existing duplicate logic:
  - Hash match (exact duplicate)
  - Title + author match (likely duplicate)

### Edge Cases

- No supported files found → Show message, return to library
- All files are duplicates → Still show review screen (user might want to replace/add formats)
- Parse errors → Show file in list with warning icon, allow skip

## Review Screen UI

```
┌─────────────────────────────────────────────────┐
│ Import Books                          [Cancel]  │
├─────────────────────────────────────────────────┤
│ Mode: ○ Move  ○ Copy                            │
├─────────────────────────────────────────────────┤
│ ┌─ New Books (3) ──────────── [Select All] ───┐ │
│ │ ☑ 📕 Book Title 1 - Author    EPUB  1.2MB  │ │
│ │ ☑ 📕 Book Title 2 - Author    PDF   3.4MB  │ │
│ │ ☑ 📕 Book Title 3 - Author    EPUB  0.8MB  │ │
│ └─────────────────────────────────────────────┘ │
│ ┌─ Already in Library (2) ────────────────────┐ │
│ │ ⚠ Book Title 4              EPUB  1.1MB    │ │
│ │   Matches: "Book Title 4" (exact file)      │ │
│ │   ○ Skip  ○ Replace  ● Add format           │ │
│ │                                              │ │
│ │ ⚠ Book Title 5              PDF   2.3MB    │ │
│ │   Matches: "Book Title 5" (title & author)  │ │
│ │   ○ Skip  ● Replace  ○ Add format           │ │
│ └─────────────────────────────────────────────┘ │
├─────────────────────────────────────────────────┤
│        Moving 3 new, replacing 1, adding 1      │
│                          [Import 5 books]       │
└─────────────────────────────────────────────────┘
```

### Header Area

- Title: "Import Books"
- Cancel button (top right) - returns to Library view
- Move/Copy radio toggle - defaults to last used choice

### New Books Section

- Collapsible section header with count: "New Books (3)"
- Each row shows:
  - Checkbox (checked by default)
  - Cover thumbnail (if extracted from EPUB)
  - Title and Author
  - Format badge (EPUB/PDF) and file size
  - Expandable details: full path, year, identifiers
- "Select All / Deselect All" toggle in section header

### Already in Library Section

- Collapsible section header: "Already in Library (2)"
- Each row shows:
  - Warning icon (amber)
  - Incoming book: title, author, format, size
  - "Matches:" link to existing library item
  - Match type: "exact file" (hash) or "title & author"
  - Radio options with smart defaults:
    - **Skip** - default for exact hash match
    - **Replace file** - default for same format, different hash
    - **Add format** - default for different format (e.g., PDF when EPUB exists)

### Footer

- Summary text: "Moving X new, replacing Y, adding Z"
- Import button (primary) - disabled if nothing selected
- Dynamic count updates as user changes selections

## Duplicate Handling - Smart Defaults

| Scenario | Default Action | Rationale |
|----------|----------------|-----------|
| Exact hash match | Skip | Identical file already exists |
| Same format, different hash | Replace | Likely a better version |
| Different format | Add format | User wants both EPUB and PDF |

User can always override the default.

## Import Execution

### Confirmation Step

When user clicks "Import":
- Button changes to "Confirm Import"
- Summary shown inline: "Moving 3 new books, replacing 1 file, adding 1 format"
- Second click executes the import

### Processing

- Progress bar with current file name
- Uses existing `OperationProgress` event pattern
- Files moved/copied using Organizer's template system: `{Author}/{Title}.{ext}`
- Database records created/updated in transaction

### Database Operations

| Action | Database Changes |
|--------|------------------|
| New book | Create `items`, `files`, `authors`, `identifiers`, `covers` records |
| Replace | Update `files` record (new path, hash), keep item metadata |
| Add format | Add new `files` record linked to existing item |

### Completion

- Success message: "Imported 5 books"
- Options: "View in Library" or "Import More"
- If errors: list failed files with reasons

## Edge Cases

| Scenario | Behavior |
|----------|----------|
| No files selected | Picker closes, stay on current view |
| No supported files in folder | Message: "No EPUB or PDF files found" |
| All duplicates with exact hash | All default to "Skip", user can change |
| File read error | Show with error icon, default to skip |
| Import fails mid-way | Show partial success, list failures |
| Disk full | Error message, suggest Copy mode |
| File collision in target | Auto-rename (same as Organizer) |

## Implementation

### New Files

- `apps/desktop/src/sections/ImportView.tsx` - main review screen
- `apps/desktop/src-tauri/src/lib.rs` - add `import_books` command
- `packages/core/src/import/index.ts` - import logic (optional, could live in existing modules)

### Reuse Existing Code

| Need | Source |
|------|--------|
| File/folder picker | Tauri dialog plugin |
| Metadata extraction | `packages/core/src/metadata/extractMetadataForFile()` |
| Hash computation | `packages/core/src/scanner/computeFileHash()` |
| Duplicate detection | Logic from DuplicatesView |
| File move/copy | `packages/core/src/organizer/applyOrganization()` |
| Path templating | Organizer's template system |
| Progress events | Existing `OperationProgress` pattern |
| UI components | Button, radio, checkbox, progress bar |

### State Shape

```typescript
type ImportCandidate = {
  id: string
  filePath: string
  metadata: ExtractedMetadata
  hash: string
  sizeBytes: number
  extension: string
  cover?: { data: string; mimeType: string }  // base64
}

type DuplicateCandidate = ImportCandidate & {
  matchedItemId: string
  matchedItemTitle: string
  matchType: 'hash' | 'metadata'
  existingFormats: string[]  // ['epub'] to know if adding PDF is "add format"
}

type ImportState = {
  mode: 'move' | 'copy'
  newBooks: ImportCandidate[]
  duplicates: DuplicateCandidate[]
  selectedNew: Set<string>
  duplicateActions: Record<string, 'skip' | 'replace' | 'add-format'>
  status: 'reviewing' | 'confirming' | 'importing' | 'done' | 'error'
  progress?: { current: number; total: number; currentFile: string }
  error?: string
}
```

### Settings Persistence

- `localStorage.importMode`: last used move/copy choice
- `localStorage.importLastPath`: last picker location

## Future Enhancements (Out of Scope)

- Inbox folder watching (auto-import on file add)
- Bulk import from Calibre/other libraries
- Metadata enrichment during import
- Import queue (add to pending changes instead of immediate)
