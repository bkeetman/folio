import { useState } from "react";
import { HardDrive, FolderOpen, RefreshCw, Trash2 } from "lucide-react";
import { Button } from "../components/ui";
import type { EReaderDevice, EReaderBook, SyncQueueItem, LibraryItem, SyncProgress } from "../types/library";

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
  const [filter, setFilter] = useState<EReaderFilter>("all");

  const selectedDevice = devices.find((d) => d.id === selectedDeviceId) ?? null;
  const pendingQueue = syncQueue.filter((q) => q.status === "pending");

  // Build unified list of items
  const unifiedItems: UnifiedItem[] = [];

  // Add library items
  libraryItems.forEach((lib) => {
    const onDevice = ereaderBooks.find((eb) => eb.matchedItemId === lib.id);
    const inQueue = pendingQueue.find((q) => q.itemId === lib.id);

    let status: UnifiedItem["status"] = "library-only";
    if (inQueue?.action === "add") status = "queued-add";
    else if (inQueue?.action === "remove") status = "queued-remove";
    else if (onDevice) status = "on-device";

    unifiedItems.push({
      id: `lib-${lib.id}`,
      title: lib.title,
      authors: lib.authors,
      status,
      confidence: (onDevice?.matchConfidence as "exact" | "isbn" | "title" | "fuzzy" | null) ?? null,
      libraryItemId: lib.id,
      ereaderPath: onDevice?.path ?? null,
    });
  });

  // Add device-only items
  ereaderBooks.forEach((eb) => {
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
          return { label: "Synced", className: "bg-emerald-100 text-emerald-700", title: "Exact file match" };
        case "isbn":
          return { label: "Synced", className: "bg-emerald-100 text-emerald-700", title: "Matched by ISBN" };
        case "title":
          return { label: "Synced", className: "bg-blue-100 text-blue-700", title: "Matched by title" };
        case "fuzzy":
          return { label: "Synced?", className: "bg-sky-100 text-sky-700", title: "Fuzzy match - verify" };
        default:
          return { label: "Synced", className: "bg-blue-100 text-blue-700", title: "On device" };
      }
    };

    const badges: Record<string, { label: string; className: string; title?: string }> = {
      "on-device": getOnDeviceBadge(),
      "library-only": { label: "Library", className: "bg-gray-100 text-gray-600", title: "Only in library" },
      "device-only": { label: "Device", className: "bg-amber-100 text-amber-700", title: "Only on device" },
      "queued-add": { label: "Queue +", className: "bg-purple-100 text-purple-700", title: "Queued to add" },
      "queued-remove": { label: "Queue −", className: "bg-red-100 text-red-700", title: "Queued to remove" },
    };
    const badge = badges[status];
    return (
      <span
        className={`inline-block px-2 py-1 rounded text-xs font-medium whitespace-nowrap ${badge.className}`}
        title={badge.title}
      >
        {badge.label}
      </span>
    );
  };

  const ActionButton = ({ item }: { item: UnifiedItem }) => {
    if (item.status === "queued-add" || item.status === "queued-remove") {
      return null;
    }
    if (item.status === "library-only" && item.libraryItemId) {
      return (
        <button
          onClick={() => onQueueAdd(item.libraryItemId!)}
          className="px-2 py-1 rounded text-sm hover:bg-emerald-100 text-emerald-600 font-medium"
          title="Add to device"
        >
          +
        </button>
      );
    }
    if (item.status === "on-device" && item.ereaderPath) {
      return (
        <button
          onClick={() => onQueueRemove(item.ereaderPath!)}
          className="px-2 py-1 rounded text-sm hover:bg-red-100 text-red-600 font-medium"
          title="Remove from device"
        >
          −
        </button>
      );
    }
    if (item.status === "device-only" && item.ereaderPath) {
      return (
        <button
          onClick={() => onQueueImport(item.ereaderPath!)}
          className="px-2 py-1 rounded text-xs bg-blue-100 text-blue-700 hover:bg-blue-200"
          title="Add to library"
        >
          Add to Library
        </button>
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
        <h2 className="text-xl font-semibold">No eReader Connected</h2>
        <p className="text-sm text-[var(--app-text-muted)] max-w-md">
          Connect your eReader and select its folder to start syncing your library.
        </p>
        <Button
          onClick={async () => {
            const { open } = await import("@tauri-apps/plugin-dialog");
            const selection = await open({ directory: true, multiple: false });
            if (typeof selection === "string") {
              const name = selection.split("/").pop() || "eReader";
              await onAddDevice(name, selection);
            }
          }}
          className="mt-2"
        >
          <FolderOpen className="w-4 h-4 mr-2" />
          Select eReader Folder
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
                title="Click to refresh connection status"
              >
                <span
                  className={`w-2 h-2 rounded-full ${selectedDevice.isConnected ? "bg-emerald-500" : "bg-amber-500"}`}
                />
                {selectedDevice.isConnected ? "Connected" : "Disconnected"}
              </button>
              <button
                onClick={() => {
                  if (confirm(`Remove "${selectedDevice.name}" from Folio?`)) {
                    onRemoveDevice(selectedDevice.id);
                  }
                }}
                className="p-1 rounded text-[var(--app-text-muted)] hover:text-red-600 hover:bg-red-50"
                title="Remove device"
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
            {scanning ? "Scanning..." : "Scan Device"}
          </Button>
          {(pendingQueue.length > 0 || syncing) && (
            <Button size="sm" onClick={onExecuteSync} disabled={syncing}>
              {syncing ? (
                <>
                  <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
                  Syncing...
                </>
              ) : (
                `Sync (${pendingQueue.length})`
              )}
            </Button>
          )}
        </div>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-2 p-4 border-b border-[var(--app-border)]">
        <span className="text-sm text-[var(--app-text-muted)]">Filter:</span>
        {(["all", "in-library", "on-device", "not-on-device", "device-only", "queued"] as const).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`px-3 py-1 text-xs rounded-full transition-colors ${
              filter === f
                ? "bg-[var(--app-accent)] text-white"
                : "bg-[var(--app-bg-secondary)] hover:bg-[var(--app-bg-tertiary)]"
            }`}
          >
            {f === "all" && "All"}
            {f === "in-library" && "In Library"}
            {f === "on-device" && "On Device"}
            {f === "not-on-device" && "Not on Device"}
            {f === "device-only" && "Device Only"}
            {f === "queued" && "Queued"}
          </button>
        ))}
      </div>

      {/* Sync Progress */}
      {syncing && syncProgress && (
        <div className="p-4 border-b border-[var(--app-border)] bg-[rgba(207,217,210,0.35)]">
          <div className="flex items-center justify-between text-sm mb-2">
            <span className="font-medium">
              Syncing: {syncProgress.action === "add" ? "Adding" : syncProgress.action === "remove" ? "Removing" : "Importing"}
            </span>
            <span className="text-[var(--app-text-muted)]">
              {syncProgress.processed} / {syncProgress.total}
            </span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-[rgba(208,138,70,0.2)]">
            <div
              className="h-full rounded-full bg-[linear-gradient(90deg,var(--app-accent),var(--app-accent-strong))] transition-[width] duration-200"
              style={{
                width: syncProgress.total > 0
                  ? `${Math.round((syncProgress.processed / syncProgress.total) * 100)}%`
                  : "0%",
              }}
            />
          </div>
          <div className="mt-1 text-xs text-[var(--app-text-muted)] truncate">
            {syncProgress.current}
          </div>
        </div>
      )}

      {/* Sync Queue (collapsible) */}
      {pendingQueue.length > 0 && !syncing && (
        <div className="border-b border-[var(--app-border)] bg-[var(--app-bg-secondary)]">
          <div className="p-3">
            <h3 className="text-sm font-medium mb-2">Sync Queue ({pendingQueue.length} pending)</h3>
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
                      {item.action === "add" ? "+" : item.action === "remove" ? "−" : "↓"}
                    </span>
                    <span>{item.action === "add" ? "Add" : item.action === "remove" ? "Remove" : "Import"}</span>
                    <span className="text-[var(--app-text-muted)]">
                      {item.itemId
                        ? libraryItems.find((i) => i.id === item.itemId)?.title
                        : item.ereaderPath?.split("/").pop()}
                    </span>
                  </span>
                  <button
                    onClick={() => onRemoveFromQueue(item.id)}
                    className="text-xs text-[var(--app-text-muted)] hover:text-red-600"
                  >
                    Cancel
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Book List */}
      <div className="flex-1 overflow-auto">
        {!selectedDevice?.isConnected ? (
          <div className="text-center text-[var(--app-text-muted)] py-8">
            Device is disconnected. Please reconnect to scan and sync.
          </div>
        ) : ereaderBooks.length === 0 && libraryItems.length === 0 ? (
          <div className="text-center text-[var(--app-text-muted)] py-8">
            Click "Scan Device" to see books on your eReader.
          </div>
        ) : filteredItems.length === 0 ? (
          <div className="text-center text-[var(--app-text-muted)] py-8">No books match the current filter.</div>
        ) : (
          <table className="w-full">
            <thead className="sticky top-0 bg-[var(--app-bg)] border-b border-[var(--app-border)]">
              <tr className="text-left text-xs text-[var(--app-text-muted)]">
                <th className="p-3 font-medium">Title / Author</th>
                <th className="p-3 font-medium w-32">Status</th>
                <th className="p-3 font-medium w-24">Action</th>
              </tr>
            </thead>
            <tbody>
              {filteredItems.map((item) => (
                <tr key={item.id} className="border-b border-[var(--app-border)] hover:bg-[var(--app-bg-secondary)]">
                  <td className="p-3">
                    <div className="font-medium">{item.title || "Unknown Title"}</div>
                    <div className="text-sm text-[var(--app-text-muted)]">
                      {item.authors.length > 0 ? item.authors.join(", ") : "Unknown Author"}
                    </div>
                  </td>
                  <td className="p-3">
                    <StatusBadge status={item.status} confidence={item.confidence} />
                  </td>
                  <td className="p-3">
                    <ActionButton item={item} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
