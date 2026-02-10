import { convertFileSrc } from "@tauri-apps/api/core";
import { FileText, FolderOpen, HardDrive, Import, Minus, Plus, RefreshCw, Trash2 } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { SyncProgressBar } from "../components/ProgressBar";
import { Badge } from "../components/ui/Badge";
import { Button } from "../components/ui/Button";
import { Panel } from "../components/ui/Panel";
import type { EReaderBook, EReaderDevice, LibraryItem, SyncProgress, SyncQueueItem } from "../types/library";

type EReaderFilter = "all" | "in-library" | "on-device" | "not-on-device" | "device-only" | "queued";

type EReaderViewProps = {
  devices: EReaderDevice[];
  selectedDeviceId: string | null;
  setSelectedDeviceId: (id: string | null) => void;
  ereaderBooks: EReaderBook[];
  syncQueue: SyncQueueItem[];
  libraryItems: LibraryItem[];
  onAddDevice: (name: string, mountPath: string) => Promise<void>;
  onRemoveDevice: (deviceId: string) => Promise<void>;
  onScanDevice: (deviceId: string) => Promise<void>;
  onQueueAdd: (itemId: string) => Promise<void>;
  onQueueRemove: (ereaderPath: string) => Promise<void>;
  onQueueImport: (ereaderPath: string) => Promise<void>;
  onRemoveFromQueue: (queueId: string) => Promise<void>;
  onExecuteSync: () => void;
  onRefreshDevices: () => Promise<void>;
  scanning: boolean;
  syncing: boolean;
  syncProgress: SyncProgress | null;
};

type UnifiedItem = {
  id: string;
  title: string | null;
  authors: string[];
  status: "on-device" | "library-only" | "device-only" | "queued-add" | "queued-remove";
  confidence: "exact" | "isbn" | "title" | "fuzzy" | null;
  libraryItemId: string | null;
  ereaderPath: string | null;
  cover?: string | null;
  format?: string;
  filename?: string | null;
};

export function EReaderView({
  devices,
  selectedDeviceId,
  setSelectedDeviceId,
  ereaderBooks,
  syncQueue,
  libraryItems,
  onAddDevice,
  onRemoveDevice,
  onScanDevice,
  onQueueAdd,
  onQueueRemove,
  onQueueImport,
  onRemoveFromQueue,
  onExecuteSync,
  onRefreshDevices,
  scanning,
  syncing,
  syncProgress,
}: EReaderViewProps) {
  const { t } = useTranslation();
  const [filter, setFilter] = useState<EReaderFilter>("all");

  const selectedDevice = devices.find((d) => d.id === selectedDeviceId) ?? null;
  const pendingQueue = syncQueue.filter((q) => q.status === "pending");

  // Build unified list of items
  const unifiedItems: UnifiedItem[] = [];

  // Helper to get extension/format
  const getFormat = (filename: string) => {
    return filename.split(".").pop()?.toUpperCase() || "UNKNOWN";
  };

  // Add library items
  libraryItems.forEach((lib) => {
    const onDevice = ereaderBooks.find((eb) => eb.matchedItemId === lib.id);
    const inQueue = pendingQueue.find((q) => q.itemId === lib.id);

    let status: UnifiedItem["status"] = "library-only";
    if (inQueue?.action === "add") status = "queued-add";
    else if (inQueue?.action === "remove") status = "queued-remove";
    else if (onDevice) status = "on-device";

    const format = lib.formats.length > 0 ? lib.formats[0].toUpperCase() : "UNKNOWN";

    unifiedItems.push({
      id: `lib-${lib.id}`,
      title: lib.title,
      authors: lib.authors,
      status,
      confidence: (onDevice?.matchConfidence as "exact" | "isbn" | "title" | "fuzzy" | null) ?? null,
      libraryItemId: lib.id,
      ereaderPath: onDevice?.path ?? null,
      cover: lib.cover_path ? convertFileSrc(lib.cover_path) : null,
      format,
      filename: onDevice?.filename ?? null,
    });
  });

  // Add device-only items
  ereaderBooks.forEach((eb) => {
    // Filter out hidden/system files (like ._ files from macOS)
    if (eb.filename.startsWith(".")) return;

    if (!eb.matchedItemId) {
      const inQueue = pendingQueue.find((q) => q.ereaderPath === eb.path);
      unifiedItems.push({
        id: `dev-${eb.path}`,
        title: eb.title,
        authors: eb.authors,
        status: inQueue?.action === "import" ? "queued-add" : "device-only",
        confidence: null,
        libraryItemId: null,
        ereaderPath: eb.path,
        cover: null,
        format: getFormat(eb.filename),
        filename: eb.filename,
      });
    }
  });

  // Apply filter
  const filteredItems = unifiedItems.filter((item) => {
    switch (filter) {
      case "in-library":
        return item.libraryItemId !== null;
      case "on-device":
        return item.status === "on-device"; // Both in library AND on device
      case "not-on-device":
        return item.status === "library-only" || item.status === "queued-add";
      case "device-only":
        return item.status === "device-only";
      case "queued":
        return item.status === "queued-add" || item.status === "queued-remove";
      default:
        return true;
    }
  });

  const StatusBadge = ({ status, confidence }: { status: UnifiedItem["status"]; confidence: UnifiedItem["confidence"] }) => {
    // Different labels/colors based on match confidence
    const getOnDeviceBadge = () => {
      switch (confidence) {
        case "exact":
          return { label: t("ereader.synced"), variant: "success", title: t("ereader.exactFileMatch") };
        case "isbn":
          return { label: t("ereader.synced"), variant: "success", title: t("ereader.matchedByIsbn") };
        case "title":
          return { label: t("ereader.synced"), variant: "info", title: t("ereader.matchedByTitle") };
        case "fuzzy":
          return { label: t("ereader.syncedMaybe"), variant: "warning", title: t("ereader.fuzzyMatchVerify") };
        default:
          return { label: t("ereader.synced"), variant: "info", title: t("ereader.onDevice") };
      }
    };

    const badges: Record<string, { label: string; variant: "default" | "muted" | "accent" | "success" | "warning" | "info" | "danger"; title?: string }> = {
      "on-device": getOnDeviceBadge() as any,
      "library-only": { label: t("ereader.library"), variant: "muted", title: t("ereader.onlyInLibrary") },
      "device-only": { label: t("ereader.device"), variant: "warning", title: t("ereader.onlyOnDevice") },
      "queued-add": { label: t("ereader.queueAdd"), variant: "muted", title: t("ereader.queuedToAdd") },
      "queued-remove": { label: t("ereader.queueRemove"), variant: "danger", title: t("ereader.queuedToRemove") },
    };
    const badge = badges[status];

    return (
      <Badge variant={badge.variant as any} className="whitespace-nowrap" title={badge.title}>
        {badge.label}
      </Badge>
    );
  };

  const ActionButton = ({ item }: { item: UnifiedItem }) => {
    if (item.status === "queued-add") {
      return (
        <span className="text-xs text-[var(--app-text-muted)] italic flex items-center gap-1">
          <Plus size={12} /> {t("ereader.queueAdd")}
        </span>
      );
    }
    if (item.status === "queued-remove") {
      return (
        <span className="text-xs text-[var(--app-text-muted)] italic flex items-center gap-1">
          <Minus size={12} /> {t("ereader.queueRemove")}
        </span>
      );
    }

    if (item.status === "library-only" && item.libraryItemId) {
      return (
        <Button
          size="sm"
          variant="ghost"
          onClick={() => onQueueAdd(item.libraryItemId!)}
          className="h-7 w-7 text-emerald-600 hover:text-emerald-700 hover:bg-emerald-50 p-0"
          title={t("ereader.addToDevice")}
        >
          <Plus size={16} />
        </Button>
      );
    }
    if (item.status === "on-device" && item.ereaderPath) {
      return (
        <Button
          size="sm"
          variant="ghost"
          onClick={() => onQueueRemove(item.ereaderPath!)}
          className="h-7 w-7 text-[var(--app-text-muted)] hover:text-red-600 hover:bg-red-50 p-0"
          title={t("ereader.removeFromDevice")}
        >
          <Trash2 size={16} />
        </Button>
      );
    }
    if (item.status === "device-only" && item.ereaderPath) {
      return (
        <Button
          size="sm"
          variant="outline"
          onClick={() => onQueueImport(item.ereaderPath!)}
          className="h-7 text-xs"
          title={t("ereader.addToLibrary")}
        >
          {t("ereader.import")}
        </Button>
      );
    }
    return null;
  };

  // No device configured - show setup
  if (devices.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4 text-center p-8">
        <div className="w-16 h-16 rounded-full bg-[var(--app-accent)]/10 flex items-center justify-center">
          <HardDrive className="w-8 h-8 text-[var(--app-accent)]" />
        </div>
        <h2 className="text-xl font-semibold">{t("ereader.noConnected")}</h2>
        <p className="text-sm text-[var(--app-text-muted)] max-w-md">
          {t("ereader.connectHint")}
        </p>
        <Button
          onClick={async () => {
            const { open } = await import("@tauri-apps/plugin-dialog");
            const selection = await open({ directory: true, multiple: false });
            if (typeof selection === "string") {
              const name = selection.split("/").pop() || t("ereader.deviceDefaultName");
              await onAddDevice(name, selection);
            }
          }}
          className="mt-2"
        >
          <FolderOpen className="w-4 h-4 mr-2" />
          {t("ereader.selectFolder")}
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-[var(--app-border)]">
        <div className="flex items-center gap-3">
          <select
            value={selectedDeviceId ?? ""}
            onChange={(e) => setSelectedDeviceId(e.target.value || null)}
            className="px-3 py-1.5 rounded-md border border-[var(--app-border)] bg-[var(--app-bg)] text-sm"
          >
            {devices.map((device) => (
              <option key={device.id} value={device.id}>
                {device.name}
              </option>
            ))}
          </select>
          {selectedDevice && (
            <>
              <button
                onClick={() => onRefreshDevices()}
                className={`flex items-center gap-1.5 text-xs hover:underline ${selectedDevice.isConnected ? "text-emerald-600" : "text-amber-600"}`}
                title={t("ereader.refreshConnectionStatus")}
              >
                <span
                  className={`w-2 h-2 rounded-full ${selectedDevice.isConnected ? "bg-emerald-500" : "bg-amber-500"}`}
                />
                {selectedDevice.isConnected ? t("ereader.connected") : t("ereader.disconnected")}
              </button>
              <button
                onClick={() => {
                  if (confirm(t("ereader.removeDeviceConfirm", { name: selectedDevice.name }))) {
                    onRemoveDevice(selectedDevice.id);
                  }
                }}
                className="p-1 rounded text-[var(--app-text-muted)] hover:text-red-600 hover:bg-red-50"
                title={t("ereader.removeDevice")}
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => selectedDeviceId && onScanDevice(selectedDeviceId)}
            disabled={!selectedDevice?.isConnected || scanning}
          >
            <RefreshCw className={`w-4 h-4 mr-2 ${scanning ? "animate-spin" : ""}`} />
            {scanning ? t("ereader.scanning") : t("ereader.scanDevice")}
          </Button>
          {(pendingQueue.length > 0 || syncing) && (
            <Button size="sm" onClick={onExecuteSync} disabled={syncing}>
              {syncing ? (
                <>
                  <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
                  {t("ereader.syncing")}
                </>
              ) : (
                t("ereader.syncCount", { count: pendingQueue.length })
              )}
            </Button>
          )}
        </div>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-2 p-4 border-b border-[var(--app-border)]">
        <span className="text-sm text-[var(--app-text-muted)]">{t("ereader.filter")}</span>
        {(["all", "in-library", "on-device", "not-on-device", "device-only", "queued"] as const).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`px-3 py-1 text-xs rounded-full transition-colors ${filter === f
              ? "bg-[var(--app-accent)] text-white"
              : "bg-[var(--app-bg-secondary)] hover:bg-[var(--app-bg-tertiary)]"
              }`}
          >
            {f === "all" && t("ereader.filters.all")}
            {f === "in-library" && t("ereader.filters.inLibrary")}
            {f === "on-device" && t("ereader.filters.onDevice")}
            {f === "not-on-device" && t("ereader.filters.notOnDevice")}
            {f === "device-only" && t("ereader.filters.deviceOnly")}
            {f === "queued" && t("ereader.filters.queued")}
          </button>
        ))}
      </div>

      {/* Sync Progress */}
      {syncing && syncProgress && (
        <div className="p-4 border-b border-[var(--app-border)]">
          <SyncProgressBar
            syncing={syncing}
            progress={syncProgress}
            variant="accent"
          />
        </div>
      )}

      {/* Sync Queue (collapsible) */}
      {pendingQueue.length > 0 && !syncing && (
        <div className="border-b border-[var(--app-border)] bg-[var(--app-bg-secondary)]">
          <div className="p-3">
            <h3 className="text-sm font-medium mb-2">{t("ereader.syncQueue", { count: pendingQueue.length })}</h3>
            <div className="space-y-1">
              {pendingQueue.map((item) => (
                <div key={item.id} className="flex items-center justify-between text-sm py-1">
                  <span className="flex items-center gap-2">
                    <span
                      className={
                        item.action === "add"
                          ? "text-emerald-600"
                          : item.action === "remove"
                            ? "text-red-600"
                            : "text-blue-600"
                      }
                    >
                      {item.action === "add" ? <Plus size={14} /> : item.action === "remove" ? <Minus size={14} /> : <Import size={14} />}
                    </span>
                    <span className="font-medium text-app-ink">{item.action === "add" ? t("ereader.add") : item.action === "remove" ? t("ereader.remove") : t("ereader.import")}</span>
                    <span className="text-[var(--app-text-muted)]">
                      {item.itemId
                        ? libraryItems.find((i) => i.id === item.itemId)?.title
                        : item.ereaderPath?.split("/").pop() ?? t("ereader.unknown")}
                    </span>
                  </span>
                  <button
                    onClick={() => onRemoveFromQueue(item.id)}
                    className="text-xs text-[var(--app-text-muted)] hover:text-red-600"
                  >
                    {t("ereader.cancel")}
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Book List */}
      <div className="flex-1 overflow-hidden p-4">
        <Panel className="flex flex-col h-full overflow-hidden p-0 bg-app-surface/50">
          {!selectedDevice?.isConnected ? (
            <div className="flex flex-col items-center justify-center h-full text-[var(--app-text-muted)] py-8">
              <HardDrive className="w-12 h-12 mb-4 opacity-20" />
              <p>{t("ereader.deviceDisconnected")}</p>
            </div>
          ) : ereaderBooks.length === 0 && libraryItems.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-[var(--app-text-muted)] py-8">
              <RefreshCw className="w-12 h-12 mb-4 opacity-20" />
              <p>{t("ereader.clickScanHint")}</p>
            </div>
          ) : filteredItems.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-[var(--app-text-muted)] py-8">
              <p>{t("ereader.noBooksForFilter")}</p>
            </div>
          ) : (
            <div className="flex flex-col h-full">
              {/* Table Header */}
              {/* Table Body */}
              <div className="flex-1 overflow-y-auto">
                {/* Table Header */}
                <div className="sticky top-0 z-10 grid grid-cols-[48px_2fr_100px_140px_100px] gap-4 border-b border-app-border bg-app-bg-secondary px-4 py-3 text-[10px] uppercase tracking-[0.12em] text-app-ink-muted backdrop-blur-sm">
                  <div></div>
                  <div>{t("ereader.table.titleAuthor")}</div>
                  <div>{t("ereader.table.format")}</div>
                  <div>{t("ereader.table.status")}</div>
                  <div className="text-right">{t("ereader.table.action")}</div>
                </div>

                <div className="divide-y divide-app-border">
                  {filteredItems.map((item) => (
                    <div
                      key={item.id}
                      className="group grid grid-cols-[48px_2fr_100px_140px_100px] items-center gap-4 px-4 py-3 hover:bg-app-surface-hover transition-colors"
                    >
                      {/* Cover */}
                      <div className="relative aspect-[2/3] w-9 overflow-hidden rounded bg-app-bg-tertiary border border-app-border shadow-sm">
                        {item.cover ? (
                          <img
                            src={item.cover}
                            alt=""
                            className="h-full w-full object-cover"
                            loading="lazy"
                          />
                        ) : (
                          <div className="flex h-full w-full items-center justify-center text-app-ink-muted/30">
                            <FileText size={16} />
                          </div>
                        )}
                      </div>

                      {/* Title & Author */}
                      <div className="flex flex-col min-w-0 pr-4">
                        <div className="truncate text-sm font-medium text-app-ink group-hover:text-app-accent-strong transition-colors">
                          {item.title || item.filename || t("ereader.unknownTitle")}
                        </div>
                        <div className="truncate text-xs text-app-ink-muted">
                          {item.authors.length > 0 ? item.authors.join(", ") : t("ereader.unknownAuthor")}
                        </div>
                      </div>

                      {/* Format */}
                      <div>
                        {item.format && (
                          <span className="inline-flex items-center rounded border border-[var(--app-border-soft)] bg-app-bg/50 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider text-app-ink-muted/80">
                            {item.format}
                          </span>
                        )}
                      </div>

                      {/* Status */}
                      <div>
                        <StatusBadge status={item.status} confidence={item.confidence} />
                      </div>

                      {/* Actions */}
                      <div className="flex justify-end">
                        <ActionButton item={item} />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </Panel>
      </div>
    </div>
  );
}
