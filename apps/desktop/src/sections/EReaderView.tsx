import { convertFileSrc } from "@tauri-apps/api/core";
import { useVirtualizer } from "@tanstack/react-virtual";
import { FileText, FolderOpen, HardDrive, Import, Minus, Plus, RefreshCw, Trash2 } from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
  type ComponentProps,
} from "react";
import { useTranslation } from "react-i18next";
import { ScanProgressBar, SyncProgressBar } from "../components/ProgressBar";
import { Badge } from "../components/ui/Badge";
import { Button } from "../components/ui/Button";
import { Panel } from "../components/ui/Panel";
import type { EReaderBook, EReaderDevice, LibraryItem, ScanProgress, SyncProgress, SyncQueueItem } from "../types/library";

type EReaderFilter = "on-device" | "device-only" | "queued" | "all";

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
  onQueueUpdate: (itemId: string, ereaderPath: string) => Promise<void>;
  onExecuteSync: () => void;
  onOpenChanges: () => void;
  onRefreshDevices: () => Promise<void>;
  scanning: boolean;
  scanProgress: ScanProgress | null;
  syncing: boolean;
  syncProgress: SyncProgress | null;
};

type UnifiedItem = {
  id: string;
  title: string | null;
  authors: string[];
  status:
    | "on-device"
    | "device-only"
    | "queued-add"
    | "queued-remove"
    | "queued-import"
    | "queued-update";
  confidence: "exact" | "isbn" | "title" | "fuzzy" | null;
  libraryItemId: string | null;
  ereaderPath: string | null;
  coverPath?: string | null;
  format?: string;
  filename?: string | null;
};

type BadgeConfig = {
  label: string;
  variant: NonNullable<ComponentProps<typeof Badge>["variant"]>;
  title?: string;
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
  onQueueRemove,
  onQueueImport,
  onQueueUpdate,
  onExecuteSync,
  onOpenChanges,
  onRefreshDevices,
  scanning,
  scanProgress,
  syncing,
  syncProgress,
}: EReaderViewProps) {
  const { t } = useTranslation();
  const [filter, setFilter] = useState<EReaderFilter>("on-device");
  const [isFilterPending, startFilterTransition] = useTransition();

  const selectedDevice = devices.find((d) => d.id === selectedDeviceId) ?? null;
  const pendingQueue = useMemo(
    () => syncQueue.filter((q) => q.status === "pending"),
    [syncQueue]
  );
  const libraryItemsById = useMemo(
    () => new Map(libraryItems.map((item) => [item.id, item])),
    [libraryItems]
  );
  const coverSrcCacheRef = useRef<Map<string, string>>(new Map());

  // Helper to get extension/format
  const getFormat = (filename: string) => filename.split(".").pop()?.toUpperCase() || "UNKNOWN";

  const pendingQueueByDevicePath = useMemo(() => {
    const map = new Map<string, SyncQueueItem>();
    pendingQueue.forEach((item) => {
      if (item.ereaderPath && !map.has(item.ereaderPath)) {
        map.set(item.ereaderPath, item);
      }
    });
    return map;
  }, [pendingQueue]);

  const unifiedItems = useMemo(() => {
    const items: UnifiedItem[] = [];
    const seenQueuedAddItemIds = new Set<string>();

    const visibleDeviceBooks = ereaderBooks.filter((book) => !book.filename.startsWith("."));
    visibleDeviceBooks.forEach((book) => {
      // Filter out hidden/system files (like ._ files from macOS)
      const queued = pendingQueueByDevicePath.get(book.path);
      const matchedLibraryItem = book.matchedItemId ? libraryItemsById.get(book.matchedItemId) ?? null : null;
      const status: UnifiedItem["status"] =
        queued?.action === "remove"
          ? "queued-remove"
          : queued?.action === "update"
            ? "queued-update"
          : queued?.action === "import"
            ? "queued-import"
            : matchedLibraryItem
              ? "on-device"
              : "device-only";
      if (queued?.action === "add" && matchedLibraryItem) {
        seenQueuedAddItemIds.add(matchedLibraryItem.id);
      }

      items.push({
        id: `dev-${book.path}`,
        title: matchedLibraryItem?.title ?? book.title,
        authors: matchedLibraryItem?.authors ?? book.authors,
        status,
        confidence:
          (book.matchConfidence as "exact" | "isbn" | "title" | "fuzzy" | null) ?? null,
        libraryItemId: matchedLibraryItem?.id ?? null,
        ereaderPath: book.path,
        coverPath: matchedLibraryItem?.cover_path ?? null,
        format: getFormat(book.filename),
        filename: book.filename,
      });
    });

    pendingQueue.forEach((queueItem) => {
      if (queueItem.action !== "add" || !queueItem.itemId) return;
      if (seenQueuedAddItemIds.has(queueItem.itemId)) return;
      const libraryItem = libraryItemsById.get(queueItem.itemId);
      if (!libraryItem) return;
      seenQueuedAddItemIds.add(queueItem.itemId);
      items.push({
        id: `queue-add-${queueItem.id}`,
        title: libraryItem.title,
        authors: libraryItem.authors,
        status: "queued-add",
        confidence: null,
        libraryItemId: libraryItem.id,
        ereaderPath: null,
        coverPath: libraryItem.cover_path ?? null,
        format:
          libraryItem.formats.length > 0 ? libraryItem.formats[0].toUpperCase() : "UNKNOWN",
        filename: null,
      });
    });

    return items;
  }, [ereaderBooks, libraryItemsById, pendingQueue, pendingQueueByDevicePath]);

  // Apply filter
  const itemsByFilter = useMemo(() => {
    const buckets: Record<EReaderFilter, UnifiedItem[]> = {
      "on-device": [],
      "device-only": [],
      queued: [],
      all: [],
    };

    unifiedItems.forEach((item) => {
      buckets.all.push(item);
      if (
        item.status === "on-device" ||
        item.status === "queued-remove" ||
        item.status === "queued-update"
      ) {
        buckets["on-device"].push(item);
      }
      if (item.status === "device-only" || item.status === "queued-import") {
        buckets["device-only"].push(item);
      }
      if (
        item.status === "queued-add" ||
        item.status === "queued-remove" ||
        item.status === "queued-import" ||
        item.status === "queued-update"
      ) {
        buckets.queued.push(item);
      }
    });

    return buckets;
  }, [unifiedItems]);

  const filteredItems = itemsByFilter[filter];
  const stats = useMemo(() => {
    const onDeviceCount = unifiedItems.filter(
      (item) =>
        item.status === "on-device" ||
        item.status === "queued-remove" ||
        item.status === "queued-update" ||
        item.status === "device-only" ||
        item.status === "queued-import"
    ).length;
    const matchedCount = unifiedItems.filter(
      (item) => item.libraryItemId !== null && item.status !== "queued-add"
    ).length;
    const deviceOnlyCount = unifiedItems.filter(
      (item) =>
        item.status === "device-only" ||
        item.status === "queued-import" ||
        (item.status === "queued-remove" && item.libraryItemId === null)
    ).length;
    return {
      onDeviceCount,
      matchedCount,
      deviceOnlyCount,
      queuedCount: pendingQueue.length,
    };
  }, [pendingQueue.length, unifiedItems]);
  const getCoverSrc = useCallback((coverPath: string | null | undefined) => {
    if (!coverPath) return null;

    const cached = coverSrcCacheRef.current.get(coverPath);
    if (cached) return cached;

    const src = convertFileSrc(coverPath);
    coverSrcCacheRef.current.set(coverPath, src);
    return src;
  }, []);

  const listRef = useRef<HTMLDivElement | null>(null);
  const rowVirtualizer = useVirtualizer({
    count: filteredItems.length,
    getScrollElement: () => listRef.current,
    estimateSize: () => 76,
    overscan: 8,
    enabled: filteredItems.length > 0,
  });
  const virtualRows = rowVirtualizer.getVirtualItems();

  useEffect(() => {
    rowVirtualizer.scrollToIndex(0, { align: "start" });
  }, [filter, rowVirtualizer]);

  const StatusBadge = ({ status, confidence }: { status: UnifiedItem["status"]; confidence: UnifiedItem["confidence"] }) => {
    // Different labels/colors based on match confidence
    const getOnDeviceBadge = (): BadgeConfig => {
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

    const badges: Record<UnifiedItem["status"], BadgeConfig> = {
      "on-device": getOnDeviceBadge(),
      "device-only": { label: t("ereader.device"), variant: "warning", title: t("ereader.onlyOnDevice") },
      "queued-add": { label: t("ereader.queueAdd"), variant: "muted", title: t("ereader.queuedToAdd") },
      "queued-remove": { label: t("ereader.queueRemove"), variant: "danger", title: t("ereader.queuedToRemove") },
      "queued-import": { label: t("ereader.queueImport"), variant: "info", title: t("ereader.queuedToImport") },
      "queued-update": { label: t("ereader.queueUpdate"), variant: "info", title: t("ereader.queuedToUpdate") },
    };
    const badge = badges[status];

    return (
      <Badge variant={badge.variant} className="whitespace-nowrap" title={badge.title}>
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
    if (item.status === "queued-import") {
      return (
        <span className="text-xs text-[var(--app-text-muted)] italic flex items-center gap-1">
          <Import size={12} /> {t("ereader.queueImport")}
        </span>
      );
    }
    if (item.status === "queued-update") {
      return (
        <span className="text-xs text-[var(--app-text-muted)] italic flex items-center gap-1">
          <RefreshCw size={12} /> {t("ereader.queueUpdate")}
        </span>
      );
    }

    if (item.status === "on-device" && item.ereaderPath) {
      return (
        <div className="flex items-center gap-1">
          <Button
            size="sm"
            variant="outline"
            onClick={() => onQueueUpdate(item.libraryItemId!, item.ereaderPath!)}
            className="h-7 w-7 p-0"
            title={t("ereader.syncFromLibrary")}
          >
            <RefreshCw size={14} />
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => onQueueRemove(item.ereaderPath!)}
            className="h-7 w-7 text-[var(--app-text-muted)] hover:text-red-600 hover:bg-red-50 p-0"
            title={t("ereader.removeFromDevice")}
          >
            <Trash2 size={16} />
          </Button>
        </div>
      );
    }
    if (item.status === "device-only" && item.ereaderPath) {
      return (
        <div className="flex items-center gap-1">
          <Button
            size="sm"
            variant="outline"
            onClick={() => onQueueImport(item.ereaderPath!)}
            className="h-7 text-xs"
            title={t("ereader.addToLibrary")}
          >
            {t("ereader.import")}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => onQueueRemove(item.ereaderPath!)}
            className="h-7 w-7 text-[var(--app-text-muted)] hover:text-red-600 hover:bg-red-50 p-0"
            title={t("ereader.removeFromDevice")}
          >
            <Trash2 size={16} />
          </Button>
        </div>
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
            className="min-w-[138px] justify-center whitespace-nowrap"
          >
            <RefreshCw className={`w-4 h-4 mr-2 ${scanning ? "animate-spin" : ""}`} />
            {scanning ? t("ereader.scanning") : t("ereader.scanDevice")}
          </Button>
          {(pendingQueue.length > 0 || syncing) && (
            <>
              <Button
                variant="outline"
                size="sm"
                onClick={onOpenChanges}
                className="min-w-[180px] justify-center whitespace-nowrap"
              >
                {t("ereader.reviewInChanges", { count: pendingQueue.length })}
              </Button>
              <Button
                variant="primary"
                size="sm"
                onClick={onExecuteSync}
                disabled={syncing}
                className="min-w-[150px] justify-center whitespace-nowrap"
              >
                {syncing ? (
                  <>
                    <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
                    {t("ereader.syncing")}
                  </>
                ) : (
                  t("ereader.applyQueued", { count: pendingQueue.length })
                )}
              </Button>
            </>
          )}
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2 p-4 border-b border-[var(--app-border)]">
        <span className="inline-flex items-center gap-2 text-sm text-[var(--app-text-muted)]">
          {t("ereader.filter")}
          <span className="inline-flex h-3 w-3 items-center justify-center">
            <RefreshCw
              size={12}
              className={`text-app-accent transition-opacity duration-150 ${isFilterPending ? "animate-spin opacity-100" : "opacity-0"}`}
            />
          </span>
        </span>
        {(["on-device", "device-only", "queued", "all"] as const).map((f) => (
          <button
            key={f}
            onClick={() =>
              startFilterTransition(() => {
                setFilter(f);
              })
            }
            className={`px-3 py-1 text-xs rounded-full transition-colors ${filter === f
              ? "bg-[var(--app-accent)] text-white"
              : "bg-[var(--app-bg-secondary)] hover:bg-[var(--app-bg-tertiary)]"
              }`}
          >
            {f === "on-device" && t("ereader.filters.onDevice")}
            {f === "device-only" && t("ereader.filters.deviceOnly")}
            {f === "queued" && t("ereader.filters.queued")}
            {f === "all" && t("ereader.filters.all")}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-2 px-4 pb-3 sm:grid-cols-4">
        <div className="rounded-md border border-[var(--app-border-soft)] bg-app-surface/70 px-3 py-2">
          <div className="text-[10px] uppercase tracking-[0.08em] text-[var(--app-text-muted)]">
            {t("ereader.stats.onDevice")}
          </div>
          <div className="text-base font-semibold text-app-ink">{stats.onDeviceCount}</div>
        </div>
        <div className="rounded-md border border-[var(--app-border-soft)] bg-app-surface/70 px-3 py-2">
          <div className="text-[10px] uppercase tracking-[0.08em] text-[var(--app-text-muted)]">
            {t("ereader.stats.matched")}
          </div>
          <div className="text-base font-semibold text-app-ink">{stats.matchedCount}</div>
        </div>
        <div className="rounded-md border border-[var(--app-border-soft)] bg-app-surface/70 px-3 py-2">
          <div className="text-[10px] uppercase tracking-[0.08em] text-[var(--app-text-muted)]">
            {t("ereader.stats.deviceOnly")}
          </div>
          <div className="text-base font-semibold text-app-ink">{stats.deviceOnlyCount}</div>
        </div>
        <div className="rounded-md border border-[var(--app-border-soft)] bg-app-surface/70 px-3 py-2">
          <div className="text-[10px] uppercase tracking-[0.08em] text-[var(--app-text-muted)]">
            {t("ereader.stats.queued")}
          </div>
          <div className="text-base font-semibold text-app-ink">{stats.queuedCount}</div>
        </div>
      </div>

      {/* Sync Progress */}
      {scanning && (
        <div className="p-4 border-b border-[var(--app-border)]">
          <ScanProgressBar scanning={scanning} progress={scanProgress} variant="accent" />
        </div>
      )}

      {syncing && syncProgress && (
        <div className="p-4 border-b border-[var(--app-border)]">
          <SyncProgressBar
            syncing={syncing}
            progress={syncProgress}
            variant="accent"
          />
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
          ) : ereaderBooks.length === 0 ? (
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
              <div className="flex-1 overflow-y-auto scrollbar-hide" ref={listRef}>
                <div className="sticky top-0 z-10 grid grid-cols-[48px_2fr_100px_140px_100px] gap-4 border-b border-app-border bg-app-bg-secondary px-4 py-3 text-[10px] uppercase tracking-[0.12em] text-app-ink-muted backdrop-blur-sm">
                  <div></div>
                  <div>{t("ereader.table.titleAuthor")}</div>
                  <div>{t("ereader.table.format")}</div>
                  <div>{t("ereader.table.status")}</div>
                  <div className="text-right">{t("ereader.table.action")}</div>
                </div>

                <div className="relative" style={{ height: rowVirtualizer.getTotalSize() }}>
                  {virtualRows.map((virtualRow) => {
                    const item = filteredItems[virtualRow.index];
                    if (!item) return null;
                    const coverSrc = getCoverSrc(item.coverPath);

                    return (
                      <div
                        key={item.id}
                        className="absolute left-0 top-0 w-full border-b border-app-border"
                        style={{ transform: `translateY(${virtualRow.start}px)` }}
                      >
                        <div className="group grid grid-cols-[48px_2fr_100px_140px_100px] items-center gap-4 px-4 py-3 hover:bg-app-surface-hover transition-colors">
                          <div className="relative aspect-[2/3] w-9 overflow-hidden rounded bg-app-bg-tertiary border border-app-border shadow-sm">
                            {coverSrc ? (
                              <img
                                src={coverSrc}
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

                          <div className="flex flex-col min-w-0 pr-4">
                            <div className="truncate text-sm font-medium text-app-ink group-hover:text-app-accent-strong transition-colors">
                              {item.title || item.filename || t("ereader.unknownTitle")}
                            </div>
                            <div className="truncate text-xs text-app-ink-muted">
                              {item.authors.length > 0
                                ? item.authors.join(", ")
                                : t("ereader.unknownAuthor")}
                            </div>
                          </div>

                          <div>
                            {item.format ? (
                              <span className="inline-flex items-center rounded border border-[var(--app-border-soft)] bg-app-bg/50 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider text-app-ink-muted/80">
                                {item.format}
                              </span>
                            ) : null}
                          </div>

                          <div>
                            <StatusBadge status={item.status} confidence={item.confidence} />
                          </div>

                          <div className="flex justify-end">
                            <ActionButton item={item} />
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          )}
        </Panel>
      </div>
    </div>
  );
}
