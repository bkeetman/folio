import { invoke, isTauri } from "@tauri-apps/api/core";
import { Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { ItemSpinner, ProgressBar } from "../components/ProgressBar";
import { cn } from "../lib/utils";
import type { OperationProgress, PendingChange } from "../types/library";
import { Button } from "../components/ui";

type ChangesViewProps = {
  pendingChangesStatus: "pending" | "applied" | "error";
  setPendingChangesStatus: (status: "pending" | "applied" | "error") => void;
  changesSourceFilter: "all" | "library" | "ereader";
  setChangesSourceFilter: (value: "all" | "library" | "ereader") => void;
  changesDeviceFilter: string | null;
  clearChangesDeviceFilter: () => void;
  pendingChangesApplying: boolean;
  pendingChangesLoading: boolean;
  pendingChanges: PendingChange[];
  selectedChangeIds: Set<string>;
  toggleChangeSelection: (id: string) => void;
  handleApplyAllChanges: () => void;
  handleApplySelectedChanges: () => void;
  handleApplyChange: (id: string) => void;
  handleRemoveChange: (id: string) => void;
  handleRemoveAllChanges: () => void;
  handleRemoveSelectedChanges: () => void;
  confirmDeleteOpen: boolean;
  confirmDeleteIds: string[];
  setConfirmDeleteOpen: (open: boolean) => void;
  setConfirmDeleteIds: (ids: string[]) => void;
  handleConfirmDelete: () => void;
  applyingChangeIds: Set<string>;
  changeProgress: OperationProgress | null;
};

type MetadataField = {
  key: string;
  labelKey: string;
};

type CoverBlob = {
  mime: string;
  bytes: number[];
};

type PendingCoverPreview = {
  fromCover?: CoverBlob | null;
  toCover?: CoverBlob | null;
};

const METADATA_FIELDS: MetadataField[] = [
  { key: "title", labelKey: "changes.fields.title" },
  { key: "author", labelKey: "changes.fields.author" },
  { key: "authors", labelKey: "changes.fields.author" },
  { key: "isbn", labelKey: "changes.fields.isbn" },
  { key: "description", labelKey: "changes.fields.description" },
  { key: "language", labelKey: "changes.fields.language" },
  { key: "publishedYear", labelKey: "changes.fields.year" },
  { key: "published_year", labelKey: "changes.fields.year" },
  { key: "series", labelKey: "changes.fields.series" },
  { key: "seriesIndex", labelKey: "changes.fields.seriesIndex" },
  { key: "series_index", labelKey: "changes.fields.seriesIndex" },
];

function parseChangesJson(changesJson: string | null | undefined): Record<string, unknown> | null {
  if (!changesJson) return null;
  try {
    const parsed: unknown = JSON.parse(changesJson);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

function extractMetadataPayload(
  changeType: string,
  parsed: Record<string, unknown> | null
): Record<string, unknown> | null {
  if (!parsed) return null;
  if (changeType === "item_metadata") {
    const metadata = parsed.metadata;
    if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return null;
    return metadata as Record<string, unknown>;
  }
  if (changeType === "fix_candidate") {
    const candidate = parsed.candidate;
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) return null;
    const candidateData = candidate as Record<string, unknown>;
    const identifiers = Array.isArray(candidateData.identifiers)
      ? candidateData.identifiers
          .map((value) => String(value ?? "").trim())
          .filter(Boolean)
      : [];
    const firstIsbn = identifiers.find((value) => value.length === 10 || value.length === 13) ?? null;
    return {
      title: candidateData.title,
      authors: candidateData.authors,
      isbn: firstIsbn,
      description: candidateData.description,
      language: candidateData.language,
      published_year: candidateData.published_year,
    };
  }
  if (changeType === "epub_meta") {
    return parsed;
  }
  return null;
}

function changeTypeLabel(changeType: string, t: (key: string) => string): string {
  if (changeType === "rename") return t("changes.renameFile");
  if (changeType === "delete") return t("changes.deleteFile");
  if (changeType === "epub_meta") return t("changes.updateEpubMetadata");
  if (changeType === "epub_cover") return t("changes.updateEpubCover");
  if (changeType === "item_metadata") return t("changes.updateItemMetadata");
  if (changeType === "fix_candidate") return t("changes.applyMetadataMatch");
  if (changeType === "item_tag_add") return t("changes.addTagToBook");
  if (changeType === "item_tag_remove") return t("changes.removeTagFromBook");
  if (changeType === "relink_missing") return t("changes.relinkMissingFile");
  if (changeType === "deactivate_missing") return t("changes.removeMissingFile");
  if (changeType === "ereader_add") return t("changes.sendToEreader");
  if (changeType === "ereader_remove") return t("changes.removeFromEreader");
  if (changeType === "ereader_import") return t("changes.importFromEreader");
  if (changeType === "ereader_update") return t("changes.updateOnEreader");
  return t("changes.updateMetadata");
}

function formatMetadataValue(value: unknown, t: (key: string) => string): string {
  if (value === null || value === undefined || value === "") return t("changes.valueCleared");
  if (Array.isArray(value)) {
    const items = value
      .map((item) => String(item).trim())
      .filter(Boolean);
    return items.length ? items.join(", ") : t("changes.valueCleared");
  }
  if (typeof value === "boolean") return value ? t("changes.yes") : t("changes.no");
  return String(value);
}

function formatFileName(path: string | null | undefined): string {
  if (!path) return "";
  const parts = path.split(/[\\/]/);
  return parts[parts.length - 1] || path;
}

function PendingCoverDiff({ changeId }: { changeId: string }) {
  const { t } = useTranslation();
  const [loading, setLoading] = useState(false);
  const [fromCoverUrl, setFromCoverUrl] = useState<string | null>(null);
  const [toCoverUrl, setToCoverUrl] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let active = true;
    let nextFromUrl: string | null = null;
    let nextToUrl: string | null = null;

    const loadPreview = async () => {
      if (!isTauri()) {
        if (!active) return;
        setLoaded(true);
        return;
      }
      setLoading(true);
      try {
        const preview = await invoke<PendingCoverPreview | null>("get_pending_cover_preview", {
          changeId,
        });
        if (!active) return;
        if (preview?.fromCover?.bytes?.length) {
          const blob = new Blob([new Uint8Array(preview.fromCover.bytes)], {
            type: preview.fromCover.mime || "image/jpeg",
          });
          nextFromUrl = URL.createObjectURL(blob);
        }
        if (preview?.toCover?.bytes?.length) {
          const blob = new Blob([new Uint8Array(preview.toCover.bytes)], {
            type: preview.toCover.mime || "image/jpeg",
          });
          nextToUrl = URL.createObjectURL(blob);
        }
        setFromCoverUrl(nextFromUrl);
        setToCoverUrl(nextToUrl);
      } catch {
        if (!active) return;
        setFromCoverUrl(null);
        setToCoverUrl(null);
      } finally {
        if (active) {
          setLoading(false);
          setLoaded(true);
        }
      }
    };

    void loadPreview();

    return () => {
      active = false;
      if (nextFromUrl) URL.revokeObjectURL(nextFromUrl);
      if (nextToUrl) URL.revokeObjectURL(nextToUrl);
    };
  }, [changeId]);

  if (loading) {
    return (
      <div className="text-[11px] text-[var(--app-ink-muted)]">
        {t("changes.loadingCoverPreview")}
      </div>
    );
  }

  if (!fromCoverUrl && !toCoverUrl) {
    return loaded ? (
      <div className="text-[11px] text-[var(--app-ink-muted)]">
        {t("changes.coverPreviewUnavailable")}
      </div>
    ) : null;
  }

  return (
    <div className="mt-1 rounded-md border border-[var(--app-border-soft)] bg-[var(--app-bg-secondary)] p-1.5">
      <div className="text-[10px] font-medium uppercase tracking-[0.08em] text-[var(--app-ink-muted)]">
        {t("changes.coverWillChange")}
      </div>
      <div className="mt-1.5 grid max-w-[180px] grid-cols-2 gap-1.5">
        <div>
          <div className="mb-1 text-[9px] uppercase tracking-[0.08em] text-[var(--app-ink-muted)]">
            {t("changes.coverBefore")}
          </div>
          <div className="flex h-20 w-14 items-center justify-center overflow-hidden rounded border border-[var(--app-border-soft)] bg-[var(--app-surface)]">
            {fromCoverUrl ? (
              <img src={fromCoverUrl} alt="" className="h-full w-full object-cover" />
            ) : (
              <span className="text-[10px] text-[var(--app-ink-muted)]">—</span>
            )}
          </div>
        </div>
        <div>
          <div className="mb-1 text-[9px] uppercase tracking-[0.08em] text-[var(--app-ink-muted)]">
            {t("changes.coverAfter")}
          </div>
          <div className="flex h-20 w-14 items-center justify-center overflow-hidden rounded border border-[var(--app-border-soft)] bg-[var(--app-surface)]">
            {toCoverUrl ? (
              <img src={toCoverUrl} alt="" className="h-full w-full object-cover" />
            ) : (
              <span className="text-[10px] text-[var(--app-ink-muted)]">—</span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export function ChangesView({
  pendingChangesStatus,
  setPendingChangesStatus,
  changesSourceFilter,
  setChangesSourceFilter,
  changesDeviceFilter,
  clearChangesDeviceFilter,
  pendingChangesApplying,
  pendingChangesLoading,
  pendingChanges,
  selectedChangeIds,
  toggleChangeSelection,
  handleApplyAllChanges,
  handleApplySelectedChanges,
  handleApplyChange,
  handleRemoveChange,
  handleRemoveAllChanges,
  handleRemoveSelectedChanges,
  confirmDeleteOpen,
  confirmDeleteIds,
  setConfirmDeleteOpen,
  setConfirmDeleteIds,
  handleConfirmDelete,
  applyingChangeIds,
  changeProgress,
}: ChangesViewProps) {
  const { t } = useTranslation();
  const hasPendingItems = pendingChanges.some((change) => change.status === "pending");

  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2 rounded-md border border-[var(--app-border)] bg-app-surface/70 p-2">
        <span className="text-[11px] uppercase tracking-[0.08em] text-[var(--app-ink-muted)]">
          {t("changes.source")}
        </span>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setChangesSourceFilter("all")}
          disabled={changesSourceFilter === "all"}
        >
          {t("changes.sources.all")}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setChangesSourceFilter("library")}
          disabled={changesSourceFilter === "library"}
        >
          {t("changes.sources.library")}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setChangesSourceFilter("ereader")}
          disabled={changesSourceFilter === "ereader"}
        >
          {t("changes.sources.ereader")}
        </Button>
        {changesDeviceFilter ? (
          <button
            type="button"
            onClick={clearChangesDeviceFilter}
            className="ml-2 rounded-full border border-[var(--app-border-soft)] bg-app-bg px-2 py-1 text-[10px] uppercase tracking-[0.08em] text-[var(--app-ink-muted)] hover:border-[var(--app-accent)] hover:text-[var(--app-ink)]"
          >
            {t("changes.deviceFilterActive")} {changesDeviceFilter} ×
          </button>
        ) : null}
      </div>
      <div className="flex flex-wrap items-center gap-2 rounded-md border border-[var(--app-border)] bg-app-surface/70 p-2">
        <div className="flex gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setPendingChangesStatus("pending")}
            disabled={pendingChangesStatus === "pending"}
          >
            {t("changes.pending")}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setPendingChangesStatus("applied")}
            disabled={pendingChangesStatus === "applied"}
          >
            {t("changes.applied")}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setPendingChangesStatus("error")}
            disabled={pendingChangesStatus === "error"}
          >
            {t("changes.errors")}
          </Button>
        </div>
        <Button
          variant="primary"
          size="sm"
          onClick={handleApplyAllChanges}
          disabled={pendingChangesApplying || !hasPendingItems}
        >
          {t("changes.applyAll")}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={handleApplySelectedChanges}
          disabled={!selectedChangeIds.size || pendingChangesApplying}
        >
          {t("changes.applySelected")}
        </Button>
        <div className="h-4 w-px bg-[var(--app-border)]" />
        <Button
          variant="ghost"
          size="sm"
          onClick={handleRemoveSelectedChanges}
          disabled={!selectedChangeIds.size || pendingChangesApplying}
        >
          {t("changes.removeSelected")}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={handleRemoveAllChanges}
          disabled={pendingChangesApplying || !hasPendingItems}
        >
          {t("changes.removeAll")}
        </Button>
      </div>

      {/* Progress bar when applying changes */}
      <ProgressBar
        progress={changeProgress}
        label={t("changes.applying")}
        variant="accent"
        show={pendingChangesApplying && changeProgress !== null}
      />

      <div className="flex flex-col gap-1.5">
        {pendingChanges.length ? (
          pendingChanges.map((change) => {
            const isApplying = applyingChangeIds.has(change.id);
            const parsedChanges = parseChangesJson(change.changes_json);
            const metadataPayload = extractMetadataPayload(change.change_type, parsedChanges);
            const isMetadataChange =
              change.change_type === "epub_meta" ||
              change.change_type === "item_metadata" ||
              change.change_type === "fix_candidate";
            const hasCoverUpdate =
              change.change_type === "epub_cover" ||
              (change.change_type === "epub_meta" && parsedChanges?.apply_cover === true);
            const shownMetadataFields = METADATA_FIELDS.filter(({ key }, index, fields) => {
              if (!metadataPayload) return false;
              if (!(key in metadataPayload)) return false;
              if (key === "author" && "authors" in metadataPayload) return false;
              if (key === "published_year" && "publishedYear" in metadataPayload) return false;
              if (key === "series_index" && "seriesIndex" in metadataPayload) return false;
              return fields.findIndex((field) => field.key === key) === index;
            });
            const hasMetadataDetails = shownMetadataFields.length > 0;
            const statusLabel = isApplying
              ? t("changes.applying")
              : change.status === "error"
                ? t("changes.error")
                : change.status === "applied"
                  ? t("changes.applied")
                  : t("changes.pending");
            return (
              <div
                key={change.id}
                className={cn(
                  "rounded-md border p-2",
                  isApplying
                    ? "border-[rgba(208,138,70,0.6)] bg-[rgba(208,138,70,0.08)]"
                    : "border-[var(--app-border)] bg-app-surface/70"
                )}
              >
                <div className="flex items-start gap-2">
                  <label className="mt-1 shrink-0">
                    {isApplying ? (
                      <ItemSpinner isProcessing={true} size={14} variant="accent" />
                    ) : (
                      <input
                        type="checkbox"
                        checked={selectedChangeIds.has(change.id)}
                        onChange={() => toggleChangeSelection(change.id)}
                        disabled={change.status !== "pending"}
                      />
                    )}
                  </label>

                  <div className="min-w-0 flex-1">
                    <div className="flex min-w-0 items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <div className="text-[12px] font-semibold text-[var(--app-ink)]">
                            {changeTypeLabel(change.change_type, t)}
                          </div>
                          <span className="rounded-full border border-[var(--app-border-soft)] bg-app-bg px-1.5 py-0.5 text-[9px] uppercase tracking-[0.08em] text-[var(--app-ink-muted)]">
                            {statusLabel}
                          </span>
                        </div>
                        {change.from_path ? (
                          <div className="mt-0.5 truncate text-[11px] text-[var(--app-ink-muted)]">
                            {formatFileName(change.from_path)}
                          </div>
                        ) : null}
                      </div>

                      <div className="flex shrink-0 items-center gap-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 px-2"
                          onClick={() => handleApplyChange(change.id)}
                          disabled={pendingChangesApplying || change.status !== "pending"}
                        >
                          {isApplying ? <Loader2 size={13} className="animate-spin" /> : t("changes.apply")}
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 px-2"
                          onClick={() => handleRemoveChange(change.id)}
                          disabled={pendingChangesApplying || change.status !== "pending"}
                        >
                          {t("changes.remove")}
                        </Button>
                      </div>
                    </div>

                    <div className="mt-1.5 flex flex-col gap-1.5">
                      {change.from_path ? (
                        <div className="truncate text-[10px] text-[var(--app-ink-muted)]">
                          {change.from_path}
                        </div>
                      ) : null}
                      {change.to_path ? (
                        <div className="truncate text-[10px] text-[var(--app-ink-muted)]">
                          {t("changes.newPath")}: {change.to_path}
                        </div>
                      ) : null}

                      {hasMetadataDetails ? (
                        <div className="rounded-md border border-[var(--app-border-soft)] bg-[var(--app-bg-secondary)] p-1.5">
                          <div className="text-[10px] font-medium uppercase tracking-[0.08em] text-[var(--app-ink-muted)]">
                            {t("changes.plannedMetadataUpdates")}
                          </div>
                          <div className="mt-1 grid gap-1 sm:grid-cols-3 lg:grid-cols-4">
                            {shownMetadataFields.map((field) => (
                              <div
                                key={field.key}
                                className="rounded-sm border border-[var(--app-border-soft)] bg-[var(--app-surface)] p-1.5"
                              >
                                <div className="text-[9px] uppercase tracking-[0.08em] text-[var(--app-ink-muted)]">
                                  {t(field.labelKey)}
                                </div>
                                <div className="mt-0.5 text-[11px] text-[var(--app-ink)]">
                                  {formatMetadataValue(metadataPayload?.[field.key], t)}
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      ) : isMetadataChange && change.changes_json ? (
                        <div className="text-[11px] text-[var(--app-ink-muted)]">
                          {t("changes.unreadableMetadata")}
                        </div>
                      ) : null}

                      {hasCoverUpdate ? (
                        <PendingCoverDiff changeId={change.id} />
                      ) : null}

                      {change.error ? (
                        <div className="rounded border border-red-500/30 bg-red-500/10 px-1.5 py-1 text-[11px] text-red-300">
                          {t("changes.errorLabel")}: {change.error}
                        </div>
                      ) : null}
                    </div>
                  </div>
                </div>
              </div>
            );
          })
        ) : (
          <div className="text-xs text-[var(--app-ink-muted)]">
            {pendingChangesLoading ? t("changes.loading") : t("changes.noPending")}
          </div>
        )}
      </div>

      {confirmDeleteOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30">
          <div className="w-full max-w-sm rounded-md border border-[var(--app-border)] bg-[var(--app-surface)] p-4 shadow-panel">
            <div className="text-[13px] font-semibold">{t("changes.deleteFilesQuestion")}</div>
            <div className="text-xs text-[var(--app-ink-muted)]">
              {t("changes.deleteFilesCount", { count: confirmDeleteIds.length })}
            </div>
            <div className="mt-3 flex justify-end gap-2">
              <Button
                variant="ghost"
                onClick={() => {
                  setConfirmDeleteOpen(false);
                  setConfirmDeleteIds([]);
                }}
              >
                {t("changes.cancel")}
              </Button>
              <Button variant="danger" onClick={handleConfirmDelete}>
                {t("changes.delete")}
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
