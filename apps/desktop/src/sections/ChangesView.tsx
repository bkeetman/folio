import { Loader2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { ItemSpinner, ProgressBar } from "../components/ProgressBar";
import type { OperationProgress, PendingChange } from "../types/library";
import { Button } from "../components/ui";

type ChangesViewProps = {
  pendingChangesStatus: "pending" | "applied" | "error";
  setPendingChangesStatus: (status: "pending" | "applied" | "error") => void;
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

export function ChangesView({
  pendingChangesStatus,
  setPendingChangesStatus,
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
  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2 rounded-md border border-[var(--app-border)] bg-white/70 p-2">
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
          disabled={pendingChangesApplying || !pendingChanges.length}
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
          disabled={pendingChangesApplying || !pendingChanges.length}
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

      <div className="flex flex-col gap-2">
        {pendingChanges.length ? (
          pendingChanges.map((change) => {
            const isApplying = applyingChangeIds.has(change.id);
            const parsedChanges = parseChangesJson(change.changes_json);
            const metadataPayload = extractMetadataPayload(change.change_type, parsedChanges);
            const isMetadataChange =
              change.change_type === "epub_meta" ||
              change.change_type === "item_metadata" ||
              change.change_type === "fix_candidate";
            const shownMetadataFields = METADATA_FIELDS.filter(({ key }, index, fields) => {
              if (!metadataPayload) return false;
              if (!(key in metadataPayload)) return false;
              if (key === "author" && "authors" in metadataPayload) return false;
              if (key === "published_year" && "publishedYear" in metadataPayload) return false;
              if (key === "series_index" && "seriesIndex" in metadataPayload) return false;
              return fields.findIndex((field) => field.key === key) === index;
            });
            const hasMetadataDetails = shownMetadataFields.length > 0;
            return (
              <div
                key={change.id}
                className={
                  isApplying
                    ? "flex items-start gap-3 rounded-md border border-[rgba(208,138,70,0.6)] bg-[rgba(208,138,70,0.08)] p-3"
                    : "flex items-start gap-3 rounded-md border border-[var(--app-border)] bg-white/70 p-3"
                }
              >
                <label className="mt-1">
                  {isApplying ? (
                    <ItemSpinner isProcessing={true} size={16} variant="accent" />
                  ) : (
                    <input
                      type="checkbox"
                      checked={selectedChangeIds.has(change.id)}
                      onChange={() => toggleChangeSelection(change.id)}
                      disabled={change.status !== "pending"}
                    />
                  )}
                </label>
                <div className="flex flex-1 flex-col gap-1">
                  <div className="text-[13px] font-semibold">
                    {changeTypeLabel(change.change_type, t)}
                  </div>
                  <div className="text-[10px] uppercase tracking-[0.12em] text-[var(--app-ink-muted)]">
                    {isApplying
                      ? t("changes.applying")
                      : change.status === "error"
                        ? t("changes.error")
                        : change.status === "applied"
                          ? t("changes.applied")
                          : t("changes.pending")}
                  </div>
                  <div className="text-xs text-[var(--app-ink-muted)]">
                    {change.from_path ? formatFileName(change.from_path) : ""}
                  </div>
                  {change.from_path ? (
                    <div className="text-[11px] text-[var(--app-ink-muted)]">{change.from_path}</div>
                  ) : null}
                  {change.to_path ? (
                    <>
                      <div className="text-xs text-[var(--app-ink-muted)]">
                        {t("changes.newPath")}: {formatFileName(change.to_path)}
                      </div>
                      <div className="text-[11px] text-[var(--app-ink-muted)]">{change.to_path}</div>
                    </>
                  ) : null}
                  {hasMetadataDetails ? (
                    <div className="mt-1 rounded-md border border-[var(--app-border-soft)] bg-[var(--app-bg-secondary)] p-2">
                      <div className="text-[11px] font-medium text-[var(--app-ink)]">
                        {t("changes.plannedMetadataUpdates")}
                      </div>
                      <div className="mt-2 grid gap-2 sm:grid-cols-2">
                        {shownMetadataFields.map((field) => (
                          <div key={field.key} className="rounded-sm border border-[var(--app-border-soft)] bg-[var(--app-surface)] p-2">
                            <div className="text-[10px] uppercase tracking-[0.08em] text-[var(--app-ink-muted)]">
                              {t(field.labelKey)}
                            </div>
                            <div className="mt-1 text-xs text-[var(--app-ink)]">
                              {formatMetadataValue(metadataPayload?.[field.key], t)}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : isMetadataChange && change.changes_json ? (
                    <div className="text-xs text-[var(--app-ink-muted)]">
                      {t("changes.unreadableMetadata")}
                    </div>
                  ) : null}
                  {change.error ? (
                    <div className="text-xs text-[var(--app-ink-muted)]">{t("changes.errorLabel")}: {change.error}</div>
                  ) : null}
                </div>
                <div className="flex gap-1">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleApplyChange(change.id)}
                    disabled={pendingChangesApplying || change.status !== "pending"}
                  >
                    {isApplying ? <Loader2 size={14} className="animate-spin" /> : t("changes.apply")}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleRemoveChange(change.id)}
                    disabled={pendingChangesApplying || change.status !== "pending"}
                  >
                    {t("changes.remove")}
                  </Button>
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
          <div className="w-full max-w-sm rounded-md border border-[var(--app-border)] bg-white p-4 shadow-panel">
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
