import { useState, useMemo } from "react";
import { ArrowLeft, FileUp, FolderUp, Loader2, Check, AlertCircle } from "lucide-react";
import { Button } from "../components/ui";
import type { ImportCandidate, ImportDuplicate, ImportScanResult } from "../types/library";

type ImportViewProps = {
  onCancel: () => void;
  onImportComplete: () => void;
  libraryRoot: string | null;
};

type ImportState =
  | "selecting"
  | "scanning"
  | "reviewing"
  | "confirming"
  | "importing"
  | "done"
  | "error";

type ImportMode = "move" | "copy";

type DuplicateAction = "skip" | "replace" | "add-format";

export function ImportView({ onCancel, onImportComplete, libraryRoot }: ImportViewProps) {
  // UI state
  const [state, setState] = useState<ImportState>("selecting");
  const [importMode, setImportMode] = useState<ImportMode>("copy");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Scan results
  const [scanResult, setScanResult] = useState<ImportScanResult | null>(null);

  // Selection state for new books
  const [selectedNewBooks, setSelectedNewBooks] = useState<Set<string>>(new Set());

  // Selection state for duplicates: Map of candidate id -> action
  const [duplicateActions, setDuplicateActions] = useState<Map<string, DuplicateAction>>(
    new Map()
  );

  // Import progress
  const [importProgress, setImportProgress] = useState<{
    current: number;
    total: number;
    currentFile: string;
  } | null>(null);

  // Import stats
  const [importStats, setImportStats] = useState<{
    imported: number;
    skipped: number;
    errors: number;
  } | null>(null);

  // Derived state - memoize to avoid recreating on every render
  const newBooks = useMemo(() => scanResult?.newBooks ?? [], [scanResult]);
  const duplicates = useMemo(() => scanResult?.duplicates ?? [], [scanResult]);

  const allNewBooksSelected = useMemo(
    () => newBooks.length > 0 && newBooks.every((book) => selectedNewBooks.has(book.id)),
    [newBooks, selectedNewBooks]
  );

  // Count items to be imported
  const importCount = useMemo(() => {
    let count = selectedNewBooks.size;
    for (const [, action] of duplicateActions) {
      if (action !== "skip") {
        count += 1;
      }
    }
    return count;
  }, [selectedNewBooks, duplicateActions]);

  // Handlers
  const handleSelectFiles = async () => {
    // TODO: Task 6 - Wire up file selection via Tauri dialog
    // For now, simulate scanning
    setState("scanning");

    // Simulate scan delay for UI testing
    setTimeout(() => {
      // TODO: Replace with actual scan results from Tauri command
      setScanResult({ newBooks: [], duplicates: [] });
      setState("reviewing");
    }, 1000);
  };

  const handleSelectFolder = async () => {
    // TODO: Task 6 - Wire up folder selection via Tauri dialog
    // For now, simulate scanning
    setState("scanning");

    // Simulate scan delay for UI testing
    setTimeout(() => {
      // TODO: Replace with actual scan results from Tauri command
      setScanResult({ newBooks: [], duplicates: [] });
      setState("reviewing");
    }, 1000);
  };

  const handleToggleNewBook = (bookId: string) => {
    setSelectedNewBooks((prev) => {
      const next = new Set(prev);
      if (next.has(bookId)) {
        next.delete(bookId);
      } else {
        next.add(bookId);
      }
      return next;
    });
  };

  const handleSelectAllNewBooks = () => {
    if (allNewBooksSelected) {
      setSelectedNewBooks(new Set());
    } else {
      setSelectedNewBooks(new Set(newBooks.map((book) => book.id)));
    }
  };

  const handleSetDuplicateAction = (candidateId: string, action: DuplicateAction) => {
    setDuplicateActions((prev) => {
      const next = new Map(prev);
      next.set(candidateId, action);
      return next;
    });
  };

  const handleStartImport = async () => {
    if (importCount === 0) return;

    setState("confirming");
  };

  const handleConfirmImport = async () => {
    setState("importing");
    setImportProgress({ current: 0, total: importCount, currentFile: "" });

    // TODO: Task 7 - Wire up actual import execution via Tauri command
    // For now, simulate import progress
    let current = 0;
    const interval = setInterval(() => {
      current += 1;
      if (current >= importCount) {
        clearInterval(interval);
        setImportStats({ imported: importCount, skipped: 0, errors: 0 });
        setState("done");
      } else {
        setImportProgress({ current, total: importCount, currentFile: "simulated-file.epub" });
      }
    }, 500);
  };

  const handleBack = () => {
    if (state === "reviewing" || state === "error") {
      setState("selecting");
      setScanResult(null);
      setSelectedNewBooks(new Set());
      setDuplicateActions(new Map());
      setErrorMessage(null);
    } else if (state === "confirming") {
      setState("reviewing");
    }
  };

  const handleDone = () => {
    onImportComplete();
  };

  // Format file size
  const formatBytes = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`;
    const kb = bytes / 1024;
    if (kb < 1024) return `${kb.toFixed(1)} KB`;
    const mb = kb / 1024;
    return `${mb.toFixed(1)} MB`;
  };

  // Render selection screen
  const renderSelectingScreen = () => (
    <div className="flex flex-1 flex-col items-center justify-center gap-8 p-8">
      <div className="text-center">
        <h2 className="text-2xl font-semibold text-app-ink">Import Books</h2>
        <p className="mt-2 text-sm text-app-ink-muted">
          Add books to your library by selecting files or a folder
        </p>
      </div>

      <div className="flex gap-4">
        <button
          onClick={() => void handleSelectFiles()}
          className="flex flex-col items-center gap-3 rounded-xl border-2 border-dashed border-app-border bg-white p-8 transition-all hover:border-app-accent hover:bg-app-accent/5"
        >
          <FileUp size={40} className="text-app-ink-muted" />
          <div className="text-center">
            <div className="font-medium text-app-ink">Select Files</div>
            <div className="text-xs text-app-ink-muted">Choose one or more ebooks</div>
          </div>
        </button>

        <button
          onClick={() => void handleSelectFolder()}
          className="flex flex-col items-center gap-3 rounded-xl border-2 border-dashed border-app-border bg-white p-8 transition-all hover:border-app-accent hover:bg-app-accent/5"
        >
          <FolderUp size={40} className="text-app-ink-muted" />
          <div className="text-center">
            <div className="font-medium text-app-ink">Select Folder</div>
            <div className="text-xs text-app-ink-muted">Scan a folder for ebooks</div>
          </div>
        </button>
      </div>

      <Button variant="ghost" onClick={onCancel}>
        Cancel
      </Button>
    </div>
  );

  // Render scanning screen
  const renderScanningScreen = () => (
    <div className="flex flex-1 flex-col items-center justify-center gap-4 p-8">
      <Loader2 size={48} className="animate-spin text-app-accent" />
      <div className="text-center">
        <div className="font-medium text-app-ink">Scanning for books...</div>
        <div className="text-sm text-app-ink-muted">
          Checking files and looking for duplicates
        </div>
      </div>
    </div>
  );

  // Render a single new book row
  const renderNewBookRow = (book: ImportCandidate) => (
    <label
      key={book.id}
      className="flex cursor-pointer items-center gap-3 rounded-lg border border-app-border bg-white px-4 py-3 transition-colors hover:bg-app-bg/50"
    >
      <input
        type="checkbox"
        checked={selectedNewBooks.has(book.id)}
        onChange={() => handleToggleNewBook(book.id)}
        className="h-4 w-4 rounded border-app-border text-app-accent focus:ring-app-accent"
      />
      <div className="min-w-0 flex-1">
        <div className="truncate font-medium text-app-ink">
          {book.title ?? book.filename}
        </div>
        <div className="flex items-center gap-2 text-xs text-app-ink-muted">
          {book.authors.length > 0 && (
            <span className="truncate">{book.authors.join(", ")}</span>
          )}
          {book.publishedYear && <span>{book.publishedYear}</span>}
          <span className="uppercase">{book.extension}</span>
          <span>{formatBytes(book.sizeBytes)}</span>
        </div>
      </div>
    </label>
  );

  // Render a single duplicate row
  const renderDuplicateRow = (dup: ImportDuplicate) => {
    const action = duplicateActions.get(dup.id) ?? "skip";

    return (
      <div
        key={dup.id}
        className="rounded-lg border border-app-border bg-white px-4 py-3"
      >
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0 flex-1">
            <div className="truncate font-medium text-app-ink">
              {dup.title ?? dup.filename}
            </div>
            <div className="flex items-center gap-2 text-xs text-app-ink-muted">
              {dup.authors.length > 0 && (
                <span className="truncate">{dup.authors.join(", ")}</span>
              )}
              <span className="uppercase">{dup.extension}</span>
              <span>{formatBytes(dup.sizeBytes)}</span>
            </div>
            <div className="mt-1 text-xs text-amber-600">
              {dup.matchType === "hash" ? "Exact match" : "Metadata match"} with "{dup.matchedItemTitle}"
              {dup.existingFormats.length > 0 && (
                <span className="ml-1 text-app-ink-muted">
                  (has {dup.existingFormats.join(", ").toUpperCase()})
                </span>
              )}
            </div>
          </div>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-4">
          <label className="flex cursor-pointer items-center gap-2 text-sm">
            <input
              type="radio"
              name={`dup-${dup.id}`}
              checked={action === "skip"}
              onChange={() => handleSetDuplicateAction(dup.id, "skip")}
              className="text-app-accent focus:ring-app-accent"
            />
            <span className="text-app-ink">Skip</span>
          </label>

          <label className="flex cursor-pointer items-center gap-2 text-sm">
            <input
              type="radio"
              name={`dup-${dup.id}`}
              checked={action === "replace"}
              onChange={() => handleSetDuplicateAction(dup.id, "replace")}
              className="text-app-accent focus:ring-app-accent"
            />
            <span className="text-app-ink">Replace existing</span>
          </label>

          <label className="flex cursor-pointer items-center gap-2 text-sm">
            <input
              type="radio"
              name={`dup-${dup.id}`}
              checked={action === "add-format"}
              onChange={() => handleSetDuplicateAction(dup.id, "add-format")}
              className="text-app-accent focus:ring-app-accent"
            />
            <span className="text-app-ink">Add as format</span>
          </label>
        </div>
      </div>
    );
  };

  // Render review screen
  const renderReviewingScreen = () => (
    <div className="flex flex-1 flex-col overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-3 border-b border-app-border px-6 py-4">
        <button
          onClick={handleBack}
          className="rounded-md p-1 text-app-ink-muted hover:bg-app-bg hover:text-app-ink"
        >
          <ArrowLeft size={20} />
        </button>
        <div>
          <h2 className="text-lg font-semibold text-app-ink">Review Import</h2>
          <p className="text-sm text-app-ink-muted">
            {newBooks.length} new, {duplicates.length} duplicates found
          </p>
        </div>
      </div>

      {/* Mode selection */}
      <div className="border-b border-app-border px-6 py-3">
        <div className="flex items-center gap-4">
          <span className="text-sm font-medium text-app-ink">Import mode:</span>
          <label className="flex cursor-pointer items-center gap-2 text-sm">
            <input
              type="radio"
              name="import-mode"
              checked={importMode === "copy"}
              onChange={() => setImportMode("copy")}
              className="text-app-accent focus:ring-app-accent"
            />
            <span className="text-app-ink">Copy files</span>
          </label>
          <label className="flex cursor-pointer items-center gap-2 text-sm">
            <input
              type="radio"
              name="import-mode"
              checked={importMode === "move"}
              onChange={() => setImportMode("move")}
              className="text-app-accent focus:ring-app-accent"
            />
            <span className="text-app-ink">Move files</span>
          </label>
          <span className="text-xs text-app-ink-muted">
            {importMode === "copy"
              ? "Original files will be kept"
              : "Original files will be moved to library"}
          </span>
        </div>
      </div>

      {/* Scrollable content */}
      <div className="flex-1 overflow-y-auto p-6">
        {/* New Books section */}
        {newBooks.length > 0 && (
          <div className="mb-6">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-sm font-semibold uppercase tracking-wider text-app-ink-muted">
                New Books ({newBooks.length})
              </h3>
              <button
                onClick={handleSelectAllNewBooks}
                className="text-xs font-medium text-app-accent hover:underline"
              >
                {allNewBooksSelected ? "Deselect all" : "Select all"}
              </button>
            </div>
            <div className="flex flex-col gap-2">
              {newBooks.map(renderNewBookRow)}
            </div>
          </div>
        )}

        {/* Duplicates section */}
        {duplicates.length > 0 && (
          <div>
            <div className="mb-3">
              <h3 className="text-sm font-semibold uppercase tracking-wider text-app-ink-muted">
                Already in Library ({duplicates.length})
              </h3>
              <p className="mt-1 text-xs text-app-ink-muted">
                These files match existing books. Choose what to do with each.
              </p>
            </div>
            <div className="flex flex-col gap-2">
              {duplicates.map(renderDuplicateRow)}
            </div>
          </div>
        )}

        {/* Empty state */}
        {newBooks.length === 0 && duplicates.length === 0 && (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <div className="text-4xl opacity-20">📚</div>
            <div className="mt-4 font-medium text-app-ink">No books found</div>
            <div className="text-sm text-app-ink-muted">
              No supported ebook files were found in the selected location.
            </div>
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between border-t border-app-border bg-app-bg/50 px-6 py-4">
        <div className="text-sm text-app-ink-muted">
          {importCount} {importCount === 1 ? "book" : "books"} will be imported
        </div>
        <div className="flex gap-3">
          <Button variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={() => void handleStartImport()}
            disabled={importCount === 0}
          >
            Import {importCount > 0 ? `(${importCount})` : ""}
          </Button>
        </div>
      </div>
    </div>
  );

  // Render confirmation screen
  const renderConfirmingScreen = () => (
    <div className="flex flex-1 flex-col items-center justify-center gap-6 p-8">
      <div className="text-center">
        <h2 className="text-xl font-semibold text-app-ink">Confirm Import</h2>
        <p className="mt-2 text-sm text-app-ink-muted">
          You are about to {importMode === "copy" ? "copy" : "move"}{" "}
          <span className="font-medium text-app-ink">{importCount}</span>{" "}
          {importCount === 1 ? "book" : "books"} to your library.
        </p>
        {libraryRoot && (
          <p className="mt-1 text-xs text-app-ink-muted">
            Library: {libraryRoot}
          </p>
        )}
      </div>

      <div className="flex gap-3">
        <Button variant="ghost" onClick={handleBack}>
          Back
        </Button>
        <Button variant="primary" onClick={() => void handleConfirmImport()}>
          Confirm Import
        </Button>
      </div>
    </div>
  );

  // Render importing screen
  const renderImportingScreen = () => (
    <div className="flex flex-1 flex-col items-center justify-center gap-4 p-8">
      <Loader2 size={48} className="animate-spin text-app-accent" />
      <div className="text-center">
        <div className="font-medium text-app-ink">Importing books...</div>
        {importProgress && (
          <>
            <div className="mt-2 text-sm text-app-ink-muted">
              {importProgress.current} of {importProgress.total}
            </div>
            <div className="mx-auto mt-3 h-2 w-64 overflow-hidden rounded-full bg-app-border/40">
              <div
                className="h-full rounded-full bg-app-accent transition-all duration-300"
                style={{
                  width: `${(importProgress.current / importProgress.total) * 100}%`,
                }}
              />
            </div>
            {importProgress.currentFile && (
              <div className="mt-2 max-w-md truncate text-xs text-app-ink-muted">
                {importProgress.currentFile}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );

  // Render done screen
  const renderDoneScreen = () => (
    <div className="flex flex-1 flex-col items-center justify-center gap-6 p-8">
      <div className="flex h-16 w-16 items-center justify-center rounded-full bg-green-100">
        <Check size={32} className="text-green-600" />
      </div>
      <div className="text-center">
        <h2 className="text-xl font-semibold text-app-ink">Import Complete</h2>
        {importStats && (
          <div className="mt-2 text-sm text-app-ink-muted">
            <span className="font-medium text-app-ink">{importStats.imported}</span> books
            imported
            {importStats.skipped > 0 && (
              <span>
                , <span className="font-medium">{importStats.skipped}</span> skipped
              </span>
            )}
            {importStats.errors > 0 && (
              <span className="text-red-600">
                , <span className="font-medium">{importStats.errors}</span> errors
              </span>
            )}
          </div>
        )}
      </div>
      <Button variant="primary" onClick={handleDone}>
        Done
      </Button>
    </div>
  );

  // Render error screen
  const renderErrorScreen = () => (
    <div className="flex flex-1 flex-col items-center justify-center gap-6 p-8">
      <div className="flex h-16 w-16 items-center justify-center rounded-full bg-red-100">
        <AlertCircle size={32} className="text-red-600" />
      </div>
      <div className="text-center">
        <h2 className="text-xl font-semibold text-app-ink">Import Failed</h2>
        <p className="mt-2 max-w-md text-sm text-app-ink-muted">
          {errorMessage ?? "An error occurred while importing books."}
        </p>
      </div>
      <div className="flex gap-3">
        <Button variant="ghost" onClick={handleBack}>
          Try Again
        </Button>
        <Button variant="outline" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  );

  return (
    <section className="flex h-full flex-col bg-app-bg">
      {state === "selecting" && renderSelectingScreen()}
      {state === "scanning" && renderScanningScreen()}
      {state === "reviewing" && renderReviewingScreen()}
      {state === "confirming" && renderConfirmingScreen()}
      {state === "importing" && renderImportingScreen()}
      {state === "done" && renderDoneScreen()}
      {state === "error" && renderErrorScreen()}
    </section>
  );
}
