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
                    {change.change_type === "rename"
                      ? t("changes.renameFile")
                      : change.change_type === "delete"
                        ? t("changes.deleteFile")
                        : t("changes.updateEpubMetadata")}
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
                    {change.from_path ?? ""}
                  </div>
                  {change.to_path ? (
                    <div className="text-xs text-[var(--app-ink-muted)]">→ {change.to_path}</div>
                  ) : null}
                  {change.changes_json ? (
                    <div className="text-xs text-[var(--app-ink-muted)]">{change.changes_json}</div>
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
