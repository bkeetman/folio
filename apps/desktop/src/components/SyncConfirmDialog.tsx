import { X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { SyncProgressBar } from "./ProgressBar";
import { Button } from "./ui";
import type { SyncQueueItem, LibraryItem, SyncProgress } from "../types/library";

type SyncConfirmDialogProps = {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  onOpenChanges: () => void;
  deviceName: string;
  queue: SyncQueueItem[];
  libraryItems: LibraryItem[];
  syncing: boolean;
  syncProgress: SyncProgress | null;
};

export function SyncConfirmDialog({
  open,
  onClose,
  onConfirm,
  onOpenChanges,
  deviceName,
  queue,
  libraryItems,
  syncing,
  syncProgress,
}: SyncConfirmDialogProps) {
  const { t } = useTranslation();
  if (!open) return null;

  const pendingItems = queue.filter((q) => q.status === "pending");
  const addItems = pendingItems.filter((q) => q.action === "add");
  const removeItems = pendingItems.filter((q) => q.action === "remove");
  const importItems = pendingItems.filter((q) => q.action === "import");
  const updateItems = pendingItems.filter((q) => q.action === "update");

  const getItemTitle = (item: SyncQueueItem) => {
    if (item.itemId) {
      const lib = libraryItems.find((l) => l.id === item.itemId);
      return lib?.title ?? "Unknown";
    }
    return item.ereaderPath?.split("/").pop() ?? "Unknown";
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4">
      <div className="absolute inset-0" onClick={onClose} role="presentation" />
      <div
        className="relative w-full max-w-xl rounded-lg border border-[var(--app-border)] bg-[var(--app-panel)] shadow-panel"
        role="dialog"
        aria-modal="true"
        onClick={(event) => event.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-[var(--app-border)] p-4">
          <h2 className="text-lg font-semibold">{t("ereader.queuedChangesFor", { name: deviceName })}</h2>
          <Button variant="ghost" size="icon" onClick={onClose} aria-label={t("changes.cancel")}>
            <X className="w-5 h-5" />
          </Button>
        </div>

        {/* Content */}
        <div className="max-h-[60vh] space-y-4 overflow-auto p-4">
          <p className="text-xs text-[var(--app-ink-muted)]">{t("ereader.sameAsChangesHint")}</p>
          {syncing && syncProgress ? (
            <SyncProgressBar
              syncing={syncing}
              progress={syncProgress}
              variant="accent"
            />
          ) : (
            <p className="text-sm text-[var(--app-ink-muted)]">{t("ereader.readyToApplyQueued")}</p>
          )}

          {!syncing && addItems.length > 0 && (
            <div className="rounded-md border border-[var(--app-border-soft)] bg-[var(--app-bg-secondary)] p-3">
              <h3 className="mb-2 text-sm font-medium text-emerald-400">
                + {t("ereader.addToDeviceCount", { count: addItems.length })}
              </h3>
              <ul className="ml-6 space-y-1 text-sm text-[var(--app-ink-muted)]">
                {addItems.map((item) => (
                  <li key={item.id}>{getItemTitle(item)}</li>
                ))}
              </ul>
            </div>
          )}

          {!syncing && removeItems.length > 0 && (
            <div className="rounded-md border border-[var(--app-border-soft)] bg-[var(--app-bg-secondary)] p-3">
              <h3 className="mb-2 text-sm font-medium text-red-400">
                - {t("ereader.removeFromDeviceCount", { count: removeItems.length })}
              </h3>
              <ul className="ml-6 space-y-1 text-sm text-[var(--app-ink-muted)]">
                {removeItems.map((item) => (
                  <li key={item.id}>{getItemTitle(item)}</li>
                ))}
              </ul>
            </div>
          )}

          {!syncing && importItems.length > 0 && (
            <div className="rounded-md border border-[var(--app-border-soft)] bg-[var(--app-bg-secondary)] p-3">
              <h3 className="mb-2 text-sm font-medium text-blue-400">
                {t("ereader.importToLibraryCount", { count: importItems.length })}
              </h3>
              <ul className="ml-6 space-y-1 text-sm text-[var(--app-ink-muted)]">
                {importItems.map((item) => (
                  <li key={item.id}>{getItemTitle(item)}</li>
                ))}
              </ul>
            </div>
          )}

          {!syncing && updateItems.length > 0 && (
            <div className="rounded-md border border-[var(--app-border-soft)] bg-[var(--app-bg-secondary)] p-3">
              <h3 className="mb-2 text-sm font-medium text-amber-400">
                {t("ereader.updateOnDeviceCount", { count: updateItems.length })}
              </h3>
              <ul className="ml-6 space-y-1 text-sm text-[var(--app-ink-muted)]">
                {updateItems.map((item) => (
                  <li key={item.id}>{getItemTitle(item)}</li>
                ))}
              </ul>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-2 border-t border-[var(--app-border)] p-4">
          <Button variant="outline" size="sm" onClick={onClose} disabled={syncing}>
            {t("changes.cancel")}
          </Button>
          <Button variant="outline" size="sm" onClick={onOpenChanges} disabled={syncing}>
            {t("ereader.openChanges")}
          </Button>
          <Button variant="primary" size="sm" onClick={onConfirm} disabled={syncing}>
            {syncing ? (
              <span className="flex items-center gap-2">
                <span className="h-3 w-3 animate-spin rounded-full border-2 border-white/40 border-t-white" />
                {t("ereader.syncing")}
              </span>
            ) : (
              t("ereader.applyQueuedNow")
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}
