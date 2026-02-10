import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
import { AlertCircle, ArrowLeft, FileUp, FolderUp, Loader2 } from "lucide-react";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "../components/ui";
import type {
  ImportCandidate,
  ImportDuplicate,
  ImportRequest,
  ImportScanResult,
  OperationProgress,
} from "../types/library";

type ImportViewProps = {
  onCancel: () => void;
  onImportStart: (request: ImportRequest) => Promise<void>;
  libraryRoot: string | null;
  template: string;
};

type ImportState =
  | "selecting"
  | "scanning"
  | "reviewing"
  | "confirming"
  | "error";

type ImportMode = "move" | "copy";

type DuplicateAction = "skip" | "replace" | "add-format";

function normalizeFormat(value: string): string {
  return value.trim().toLowerCase().replace(/^\./, "");
}

function hasSameFormat(dup: ImportDuplicate): boolean {
  const incoming = normalizeFormat(dup.extension);
  return dup.existingFormats.some((format) => normalizeFormat(format) === incoming);
}

export function ImportView({ onCancel, onImportStart, libraryRoot, template }: ImportViewProps) {
  const { t } = useTranslation();
  // UI state
  const [state, setState] = useState<ImportState>("selecting");
  const [importMode, setImportMode] = useState<ImportMode>(() => {
    const saved = localStorage.getItem("importMode");
    return (saved === "copy" || saved === "move") ? saved : "move";
  });

  const updateImportMode = (newMode: ImportMode) => {
    setImportMode(newMode);
    localStorage.setItem("importMode", newMode);
  };
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [scanProgress, setScanProgress] = useState<OperationProgress | null>(null);

  // Scan results
  const [scanResult, setScanResult] = useState<ImportScanResult | null>(null);

  // Selection state for new books
  const [selectedNewBooks, setSelectedNewBooks] = useState<Set<string>>(new Set());

  // Selection state for duplicates: Map of candidate id -> action
  const [duplicateActions, setDuplicateActions] = useState<Map<string, DuplicateAction>>(
    new Map()
  );

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

  // Helper to scan paths and populate results
  const scanPaths = async (paths: string[]) => {
    setState("scanning");
    setScanProgress({
      itemId: "import-scan",
      status: "pending",
      message: t("importView.collectingFiles"),
      current: 0,
      total: 0,
    });
    const unlisten = await listen<OperationProgress>("import-scan-progress", (event) => {
      setScanProgress(event.payload);
    });
    try {
      const result = await invoke<ImportScanResult>("scan_for_import", { paths });
      setScanResult(result);

      // Pre-select all new books
      setSelectedNewBooks(new Set(result.newBooks.map((book) => book.id)));

      // Set smart defaults for duplicate actions
      const defaultActions = new Map<string, DuplicateAction>();
      for (const dup of result.duplicates) {
        // Duplicates are never auto-imported; user can opt in per row.
        defaultActions.set(dup.id, "skip");
      }
      setDuplicateActions(defaultActions);

      setState("reviewing");
    } catch (err) {
      setErrorMessage(String(err));
      setState("selecting");
    } finally {
      unlisten();
    }
  };

  // Handlers
  const handleSelectFiles = async () => {
    try {
      const selected = await open({
        multiple: true,
        filters: [
          { name: t("importView.filterAllEbooks"), extensions: ["epub", "pdf", "mobi", "EPUB", "PDF", "MOBI"] },
          { name: t("importView.filterEpub"), extensions: ["epub", "EPUB"] },
          { name: t("importView.filterPdf"), extensions: ["pdf", "PDF"] },
          { name: t("importView.filterMobi"), extensions: ["mobi", "MOBI"] },
        ],
      });
      if (!selected || (Array.isArray(selected) && selected.length === 0)) return;

      const paths = Array.isArray(selected) ? selected : [selected];
      await scanPaths(paths);
    } catch (err) {
      setErrorMessage(String(err));
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
      setErrorMessage(String(err));
    }
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
    if (!libraryRoot) {
      setErrorMessage(t("importView.libraryRootNotConfigured"));
      setState("error");
      return;
    }

    if (!scanResult) {
      setErrorMessage(t("importView.noScanResults"));
      setState("error");
      return;
    }

    setErrorMessage(null);

    try {
      // Build candidates list from scanResult
      const allCandidates = [
        ...scanResult.newBooks.map((b) => ({ ...b, matchedItemId: null, matchType: null })),
        ...scanResult.duplicates.map((d) => ({ ...d })),
      ];

      // Convert duplicateActions Map to object for serialization
      const duplicateActionsObj: Record<string, string> = {};
      for (const [id, action] of duplicateActions) {
        duplicateActionsObj[id] = action;
      }

      await onImportStart({
        mode: importMode,
        libraryRoot,
        template,
        newBookIds: Array.from(selectedNewBooks),
        duplicateActions: duplicateActionsObj,
        candidates: allCandidates,
      });
    } catch (err) {
      setErrorMessage(String(err));
      setState("error");
    }
  };

  const handleBack = () => {
    if (state === "reviewing") {
      setState("selecting");
      setScanResult(null);
      setSelectedNewBooks(new Set());
      setDuplicateActions(new Map());
      setErrorMessage(null);
    } else if (state === "confirming") {
      setState("reviewing");
    } else if (state === "error") {
      // If we have scan results, go back to reviewing to retry
      // Otherwise go back to selecting
      if (scanResult) {
        setState("reviewing");
        setErrorMessage(null);
      } else {
        setState("selecting");
        setErrorMessage(null);
      }
    }
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
        <h2 className="text-2xl font-semibold text-app-ink">{t("importView.title")}</h2>
        <p className="mt-2 text-sm text-app-ink-muted">
          {t("importView.subtitle")}
        </p>
      </div>

      <div className="flex gap-4">
        <button
          onClick={() => void handleSelectFiles()}
          className="flex flex-col items-center gap-3 rounded-xl border-2 border-dashed border-[var(--app-border-soft)] bg-app-panel p-8 transition-all hover:border-app-accent hover:bg-app-accent/5"
        >
          <FileUp size={40} className="text-app-ink-muted" />
          <div className="text-center">
            <div className="font-medium text-app-ink">{t("importView.selectFiles")}</div>
            <div className="text-xs text-app-ink-muted">{t("importView.selectFilesHint")}</div>
          </div>
        </button>

        <button
          onClick={() => void handleSelectFolder()}
          className="flex flex-col items-center gap-3 rounded-xl border-2 border-dashed border-app-border bg-white p-8 transition-all hover:border-app-accent hover:bg-app-accent/5"
        >
          <FolderUp size={40} className="text-app-ink-muted" />
          <div className="text-center">
            <div className="font-medium text-app-ink">{t("importView.selectFolder")}</div>
            <div className="text-xs text-app-ink-muted">{t("importView.selectFolderHint")}</div>
          </div>
        </button>
      </div>

      <Button variant="ghost" onClick={onCancel}>
        {t("importView.cancel")}
      </Button>
    </div>
  );

  // Render scanning screen
  const renderScanningScreen = () => (
    <div className="flex flex-1 flex-col items-center justify-center gap-4 p-8">
      <Loader2 size={48} className="animate-spin text-app-accent" />
      <div className="w-full max-w-xl text-center">
        <div className="font-medium text-app-ink">{t("importView.scanningTitle")}</div>
        <div className="text-sm text-app-ink-muted">
          {scanProgress?.message
            ? scanProgress.total > 0
              ? t("importView.scanningChecking", { item: scanProgress.message })
              : scanProgress.message
            : t("importView.scanningFallback")}
        </div>
        {scanProgress && scanProgress.total > 0 ? (
          <div className="mt-4">
            <div className="mb-2 flex items-center justify-between text-xs text-app-ink-muted">
              <span>
                {scanProgress.current} / {scanProgress.total}
              </span>
              <span>
                {Math.round((scanProgress.current / Math.max(scanProgress.total, 1)) * 100)}%
              </span>
            </div>
            <div className="h-2 w-full overflow-hidden rounded-full bg-app-border">
              <div
                className="h-full bg-app-accent transition-all"
                style={{
                  width: `${(scanProgress.current / Math.max(scanProgress.total, 1)) * 100}%`,
                }}
              />
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );

  // Render a single new book row
  const renderNewBookRow = (book: ImportCandidate) => (
    <label
      key={book.id}
      className="flex cursor-pointer items-center gap-3 rounded-lg border border-[var(--app-border-soft)] bg-app-panel px-4 py-3 transition-colors hover:bg-app-bg/50"
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
    const sameFormatExists = hasSameFormat(dup);
    const action = duplicateActions.get(dup.id) ?? "skip";

    return (
      <div
        key={dup.id}
        className="rounded-lg border border-[var(--app-border-soft)] bg-app-panel px-4 py-3"
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
              {dup.matchType === "hash"
                ? t("importView.duplicateExactMatch")
                : t("importView.duplicateMetadataMatch")}{" "}
              "{dup.matchedItemTitle}"
              {dup.existingFormats.length > 0 && (
                <span className="ml-1 text-app-ink-muted">
                  {t("importView.duplicateHasFormats", {
                    formats: dup.existingFormats.join(", ").toUpperCase(),
                  })}
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
            <span className="text-app-ink">{t("importView.skip")}</span>
          </label>

          <label className="flex cursor-pointer items-center gap-2 text-sm">
            <input
              type="radio"
              name={`dup-${dup.id}`}
              checked={action === "replace"}
              onChange={() => handleSetDuplicateAction(dup.id, "replace")}
              className="text-app-accent focus:ring-app-accent"
            />
            <span className="text-app-ink">{t("importView.replaceExisting")}</span>
          </label>

          {!sameFormatExists ? (
            <label className="flex cursor-pointer items-center gap-2 text-sm">
              <input
                type="radio"
                name={`dup-${dup.id}`}
                checked={action === "add-format"}
                onChange={() => handleSetDuplicateAction(dup.id, "add-format")}
                className="text-app-accent focus:ring-app-accent"
              />
              <span className="text-app-ink">{t("importView.addAsFormat")}</span>
            </label>
          ) : null}
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
          <h2 className="text-lg font-semibold text-app-ink">{t("importView.reviewTitle")}</h2>
          <p className="text-sm text-app-ink-muted">
            {t("importView.reviewSummary", {
              newCount: newBooks.length,
              duplicateCount: duplicates.length,
            })}
          </p>
        </div>
      </div>

      {/* Mode selection */}
      <div className="border-b border-app-border px-6 py-3">
        <div className="flex items-center gap-4">
          <span className="text-sm font-medium text-app-ink">{t("importView.importMode")}</span>
          <label className="flex cursor-pointer items-center gap-2 text-sm">
            <input
              type="radio"
              name="import-mode"
              checked={importMode === "copy"}
              onChange={() => updateImportMode("copy")}
              className="text-app-accent focus:ring-app-accent"
            />
            <span className="text-app-ink">{t("importView.copyFiles")}</span>
          </label>
          <label className="flex cursor-pointer items-center gap-2 text-sm">
            <input
              type="radio"
              name="import-mode"
              checked={importMode === "move"}
              onChange={() => updateImportMode("move")}
              className="text-app-accent focus:ring-app-accent"
            />
            <span className="text-app-ink">{t("importView.moveFiles")}</span>
          </label>
          <span className="text-xs text-app-ink-muted">
            {importMode === "copy"
              ? t("importView.originalsKept")
              : t("importView.originalsMoved")}
          </span>
        </div>
      </div>

      {/* Scrollable content */}
      <div className="flex-1 overflow-y-auto scrollbar-hide p-6">
        {/* New Books section */}
        {newBooks.length > 0 && (
          <div className="mb-6">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-sm font-semibold uppercase tracking-wider text-app-ink-muted">
                {t("importView.newBooksHeader", { count: newBooks.length })}
              </h3>
              <button
                onClick={handleSelectAllNewBooks}
                className="text-xs font-medium text-app-accent hover:underline"
              >
                {allNewBooksSelected ? t("importView.deselectAll") : t("importView.selectAll")}
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
                {t("importView.alreadyInLibraryHeader", { count: duplicates.length })}
              </h3>
              <p className="mt-1 text-xs text-app-ink-muted">
                {t("importView.duplicatesHint")}
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
            <div className="mt-4 font-medium text-app-ink">{t("importView.noBooksFound")}</div>
            <div className="text-sm text-app-ink-muted">
              {t("importView.noBooksFoundHint")}
            </div>
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between border-t border-app-border bg-app-bg/50 px-6 py-4">
        <div className="text-sm text-app-ink-muted">
          {t("importView.booksWillBeImported", {
            count: importCount,
            bookLabel: importCount === 1 ? t("importView.bookSingular") : t("importView.bookPlural"),
          })}
        </div>
        <div className="flex gap-3">
          <Button variant="ghost" onClick={onCancel}>
            {t("importView.cancel")}
          </Button>
          <Button
            variant="primary"
            onClick={() => void handleStartImport()}
            disabled={importCount === 0}
          >
            {t("importView.import")} {importCount > 0 ? `(${importCount})` : ""}
          </Button>
        </div>
      </div>
    </div>
  );

  // Render confirmation screen
  const renderConfirmingScreen = () => (
    <div className="flex flex-1 flex-col items-center justify-center gap-6 p-8">
      <div className="text-center">
        <h2 className="text-xl font-semibold text-app-ink">{t("importView.confirmTitle")}</h2>
        <p className="mt-2 text-sm text-app-ink-muted">
          {t("importView.confirmMessage", {
            mode: importMode === "copy" ? t("importView.modeCopy") : t("importView.modeMove"),
            count: importCount,
            bookLabel: importCount === 1 ? t("importView.bookSingular") : t("importView.bookPlural"),
          })}
        </p>
        {libraryRoot && (
          <p className="mt-1 text-xs text-app-ink-muted">
            {t("importView.libraryLabel")}: {libraryRoot}
          </p>
        )}
      </div>

      <div className="flex gap-3">
        <Button variant="ghost" onClick={handleBack}>
          {t("importView.back")}
        </Button>
        <Button variant="primary" onClick={() => void handleConfirmImport()}>
          {t("importView.confirmImport")}
        </Button>
      </div>
    </div>
  );

  // Render error screen
  const renderErrorScreen = () => (
    <div className="flex flex-1 flex-col items-center justify-center gap-6 p-8">
      <div className="flex h-16 w-16 items-center justify-center rounded-full bg-red-500/10 border border-red-500/20">
        <AlertCircle size={32} className="text-red-500" />
      </div>
      <div className="text-center">
        <h2 className="text-xl font-semibold text-app-ink">{t("importView.errorTitle")}</h2>
        <p className="mt-2 max-w-md text-sm text-app-ink-muted">
          {errorMessage ?? t("importView.errorFallback")}
        </p>
      </div>
      <div className="flex gap-3">
        <Button variant="outline" onClick={onCancel}>
          {t("importView.cancel")}
        </Button>
        <Button variant="primary" onClick={handleBack}>
          {t("importView.tryAgain")}
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
      {state === "error" && renderErrorScreen()}
    </section>
  );
}
