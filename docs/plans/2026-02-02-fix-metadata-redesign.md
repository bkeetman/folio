# Fix Metadata Page Redesign

## Overview

Redesign the Fix Metadata page from a single-item queue processor to a full metadata triage and editing workflow.

**Goals:**
- See all books needing fixes at once
- Configurable filters for what counts as "needs fixing"
- Manual metadata editing when search fails
- Streamlined workflow: select → search/edit → save → next

## Layout

Three-panel layout within the main content area:

```
┌─────────────────────────────────────────────────────────────────┐
│ Fix Metadata                                    [Filter: ▼]     │
├──────────────────┬──────────────────────────────────────────────┤
│ NEEDS FIXING (12)│  CURRENT METADATA          SEARCH RESULTS    │
│                  │  ┌─────────────────┐       ┌───────────────┐ │
│ 👤 Book Title 1  │  │ Title: [____]   │       │ Results here  │ │
│ ● Book Title 2 ← │  │ Author: [____]  │       │               │ │
│ 🖼 Book Title 3  │  │ Year: [____]    │       │ [Search]      │ │
│ ⚠️ Book Title 4  │  │ ...more fields  │       │               │ │
│                  │  │ [Save Changes]  │       │               │ │
└──────────────────┴──────────────────────────────────────────────┘
```

- **Left panel**: Scrollable list of books needing fixes
- **Center panel**: Editable metadata form
- **Right panel**: Search results from APIs

## Filter Configuration

Dropdown with checkboxes for what to include:

| Field | Default |
|-------|---------|
| Missing Author | ☑ On |
| Missing Title | ☑ On |
| Missing Cover | ☑ On |
| Missing ISBN | ☐ Off |
| Missing Year | ☐ Off |
| Missing Description | ☐ Off |
| Missing Language | ☐ Off |
| Missing Series | ☐ Off |
| Items in issues table | ☑ On |

- OR logic: book appears if missing ANY checked field
- Filter saved to localStorage
- Count updates dynamically in header

## Book List Panel

Each row shows:
- Icon indicating primary issue type
- Truncated book title

**Icons:**
- 👤 Missing author
- 🖼 Missing cover
- 📖 Missing title
- ⚠️ In issues table (scan-detected problem)

**Priority** (when multiple issues): title > author > cover > other

**Behavior:**
- Click to select (highlights row)
- After saving, book disappears if it passes filter
- Next book auto-selects

## Metadata Editor Form

Editable fields:
- Title (text)
- Author(s) (text, comma-separated)
- Year (number)
- Language (dropdown: nl, en, de, fr, es, it, pt, etc.)
- ISBN (text)
- Series (text)
- Series Index (number)
- Description (textarea)

**Buttons:**
- **Save Changes**: Write to database, remove from list if now passes filter
- **Use as Search Query**: Take title + author, trigger search in right panel

## Search Results Panel

- Editable search query field (pre-fills with title)
- "Search Sources" button
- Results show: cover, title, author, year, source, confidence %
- "Apply This" button per result: copies metadata to form AND saves

**States:**
- Loading: spinner + "Searching..."
- Empty: "No results found. Try editing the search query or fill in metadata manually."
- Error: toast notification

## Edge Cases

1. **No books need fixing**: Show "All books have complete metadata! 🎉"
2. **Book has no title**: Show "Untitled" in list, empty field in form
3. **Search returns nothing**: Show suggestion to edit query or use manual entry
4. **Apply fails**: Error toast, keep form populated for retry
5. **Multiple issues**: Book appears once with highest-priority icon

## Technical Implementation

### Data Source

Filter `libraryItems` client-side (already loaded in App.tsx) instead of relying only on `issues` table. This provides:
- Faster filtering (no API call)
- Real-time updates as metadata changes
- Consistent with rest of app

### API Endpoints

**Existing (reuse):**
- `search_candidates(query, item_id)` - search Google Books + Open Library
- `apply_fix_candidate(item_id, candidate)` - apply metadata from search result

**New:**
- `save_item_metadata(item_id, metadata)` - direct save for manual edits

### Files to Modify

| File | Changes |
|------|---------|
| `src/sections/FixView.tsx` | Complete rewrite with new layout |
| `src/App.tsx` | Add filter state, pass new props, add save handler |
| `src/types/library.ts` | Add FixFilter type |
| `src-tauri/src/lib.rs` | Add `save_item_metadata` command |

### State Management

New state in App.tsx:
```typescript
const [fixFilter, setFixFilter] = useState<FixFilter>({
  missingAuthor: true,
  missingTitle: true,
  missingCover: true,
  missingIsbn: false,
  missingYear: false,
  missingDescription: false,
  missingLanguage: false,
  missingSeries: false,
  includeIssues: true,
});
const [selectedFixItemId, setSelectedFixItemId] = useState<string | null>(null);
```

Filter logic:
```typescript
const booksNeedingFix = useMemo(() => {
  return libraryItems.filter(item => {
    if (fixFilter.missingAuthor && item.authors.length === 0) return true;
    if (fixFilter.missingTitle && !item.title) return true;
    if (fixFilter.missingCover && !item.cover_path) return true;
    // ... etc
    return false;
  });
}, [libraryItems, fixFilter]);
```

## Verification

1. Build test: `cd apps/desktop && pnpm build`
2. Functional tests:
   - Filter shows correct books based on checkboxes
   - Selecting book shows its metadata in form
   - Manual edit + Save updates database
   - Search returns results, Apply works
   - Book disappears from list after being fixed
   - Empty state shows when all fixed
