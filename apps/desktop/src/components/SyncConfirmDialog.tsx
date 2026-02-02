import { X } from "lucide-react";
import { SyncProgressBar } from "./ProgressBar";
import { Button } from "./ui";
import type { SyncQueueItem, LibraryItem, SyncProgress } from "../types/library";

type SyncConfirmDialogProps = {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
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
  deviceName,
  queue,
  libraryItems,
  syncing,
  syncProgress,
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
          {syncing && syncProgress ? (
            <SyncProgressBar
              syncing={syncing}
              progress={syncProgress}
              variant="accent"
            />
          ) : (
            <p className="text-sm text-[var(--app-text-muted)]">Ready to sync the following changes:</p>
          )}

          {!syncing && addItems.length > 0 && (
            <div>
              <h3 className="text-sm font-medium text-emerald-600 mb-2">
                + Add to device ({addItems.length} {addItems.length === 1 ? "book" : "books"})
              </h3>
              <ul className="space-y-1 text-sm text-[var(--app-text-muted)] ml-6">
                {addItems.map((item) => (
                  <li key={item.id}>{getItemTitle(item)}</li>
                ))}
              </ul>
            </div>
          )}

          {!syncing && removeItems.length > 0 && (
            <div>
              <h3 className="text-sm font-medium text-red-600 mb-2">
                - Remove from device ({removeItems.length} {removeItems.length === 1 ? "book" : "books"})
              </h3>
              <ul className="space-y-1 text-sm text-[var(--app-text-muted)] ml-6">
                {removeItems.map((item) => (
                  <li key={item.id}>{getItemTitle(item)}</li>
                ))}
              </ul>
            </div>
          )}

          {!syncing && importItems.length > 0 && (
            <div>
              <h3 className="text-sm font-medium text-blue-600 mb-2">
                Import to library ({importItems.length} {importItems.length === 1 ? "book" : "books"})
              </h3>
              <ul className="space-y-1 text-sm text-[var(--app-text-muted)] ml-6">
                {importItems.map((item) => (
                  <li key={item.id}>{getItemTitle(item)}</li>
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
            {syncing ? (
              <span className="flex items-center gap-2">
                <span className="h-3 w-3 animate-spin rounded-full border-2 border-white/40 border-t-white" />
                Syncing...
              </span>
            ) : (
              "Sync Now"
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}
