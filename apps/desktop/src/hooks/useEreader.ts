import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useCallback, useEffect, useState } from "react";
import type {
  ActivityLogItem,
  EReaderBook,
  EReaderDevice,
  ScanProgress,
  SyncProgress,
  SyncQueueItem,
} from "../types/library";

type UseEreaderArgs = {
  isDesktop: boolean;
  refreshLibrary: () => Promise<void>;
  setScanStatus: (value: string | null) => void;
  setActivityLog: React.Dispatch<React.SetStateAction<ActivityLogItem[]>>;
};

export function useEreader({
  isDesktop,
  refreshLibrary,
  setScanStatus,
  setActivityLog,
}: UseEreaderArgs) {
  const [ereaderDevices, setEreaderDevices] = useState<EReaderDevice[]>([]);
  const [selectedEreaderDeviceId, setSelectedEreaderDeviceId] = useState<string | null>(null);
  const [ereaderBooks, setEreaderBooks] = useState<EReaderBook[]>([]);
  const [ereaderSyncQueue, setEreaderSyncQueue] = useState<SyncQueueItem[]>([]);
  const [ereaderScanning, setEreaderScanning] = useState(false);
  const [ereaderScanProgress, setEreaderScanProgress] = useState<ScanProgress | null>(null);
  const [ereaderSyncDialogOpen, setEreaderSyncDialogOpen] = useState(false);
  const [ereaderSyncing, setEreaderSyncing] = useState(false);
  const [ereaderSyncProgress, setEreaderSyncProgress] = useState<SyncProgress | null>(null);

  const refreshDevices = useCallback(async () => {
    try {
      const devices = await invoke<EReaderDevice[]>("list_ereader_devices");
      setEreaderDevices(devices);
      return devices;
    } catch {
      setEreaderDevices([]);
      return [];
    }
  }, []);

  const refreshQueue = useCallback(
    async (deviceId: string) => {
      try {
        const queue = await invoke<SyncQueueItem[]>("get_sync_queue", { deviceId });
        setEreaderSyncQueue(queue);
        return queue;
      } catch {
        setEreaderSyncQueue([]);
        return [];
      }
    },
    []
  );

  // Load eReader devices and poll connection status periodically
  useEffect(() => {
    if (!isDesktop) return;
    const loadEreaderDevices = async () => {
      const devices = await refreshDevices();
      if (devices.length > 0 && !selectedEreaderDeviceId) {
        setSelectedEreaderDeviceId(devices[0].id);
      }
    };
    void loadEreaderDevices();
    const interval = window.setInterval(loadEreaderDevices, 3000);
    return () => window.clearInterval(interval);
  }, [isDesktop, refreshDevices, selectedEreaderDeviceId]);

  // Load sync queue when device changes
  useEffect(() => {
    if (!isDesktop || !selectedEreaderDeviceId) return;
    void refreshQueue(selectedEreaderDeviceId);
  }, [isDesktop, selectedEreaderDeviceId, refreshQueue]);

  // Listen for eReader scan progress events
  useEffect(() => {
    if (!isDesktop) return;
    let unlistenScanProgress: (() => void) | undefined;

    listen<ScanProgress>("ereader-scan-progress", (event) => {
      setEreaderScanProgress(event.payload);
    }).then((stop) => {
      unlistenScanProgress = stop;
    });

    return () => {
      if (unlistenScanProgress) unlistenScanProgress();
    };
  }, [isDesktop]);

  // Listen for eReader sync progress events
  useEffect(() => {
    if (!isDesktop) return;
    let unlistenSyncProgress: (() => void) | undefined;
    let unlistenSyncComplete: (() => void) | undefined;

    listen<SyncProgress>("sync-progress", (event) => {
      console.log("sync-progress event:", event.payload);
      setEreaderSyncProgress(event.payload);
      if (!ereaderSyncing) setEreaderSyncing(true);
    }).then((stop) => {
      unlistenSyncProgress = stop;
    });

    listen<{ added: number; removed: number; imported: number; updated: number; errors: string[] }>(
      "sync-complete",
      (event) => {
        setEreaderSyncProgress(null);
        setEreaderSyncing(false);
        const parts: string[] = [];
        if (event.payload.added > 0) parts.push(`${event.payload.added} added`);
        if (event.payload.removed > 0) parts.push(`${event.payload.removed} removed`);
        if (event.payload.imported > 0) parts.push(`${event.payload.imported} imported`);
        if (event.payload.updated > 0) parts.push(`${event.payload.updated} updated`);
        if (event.payload.errors.length > 0) parts.push(`${event.payload.errors.length} errors`);
        setScanStatus(`Sync complete: ${parts.join(", ")}`);
        setActivityLog((prev) => [
          {
            id: `sync-${Date.now()}`,
            type: "sync",
            message: `Synced: ${parts.join(", ")}`,
            timestamp: Date.now(),
          },
          ...prev,
        ]);
        setEreaderSyncDialogOpen(false);
        if (selectedEreaderDeviceId) {
          const deviceId = selectedEreaderDeviceId;
          void (async () => {
            await refreshQueue(deviceId);
            try {
              const books = await invoke<EReaderBook[]>("scan_ereader", { deviceId });
              setEreaderBooks(books);
            } catch {
              // ignore transient rescan failures
            }
            await refreshLibrary();
          })();
        }
      }
    ).then((stop) => {
      unlistenSyncComplete = stop;
    });

    return () => {
      if (unlistenSyncProgress) unlistenSyncProgress();
      if (unlistenSyncComplete) unlistenSyncComplete();
    };
  }, [
    isDesktop,
    ereaderSyncing,
    refreshLibrary,
    refreshQueue,
    selectedEreaderDeviceId,
    setActivityLog,
    setScanStatus,
  ]);

  const handleAddEreaderDevice = async (name: string, mountPath: string) => {
    if (!isTauri()) return;
    try {
      const device = await invoke<EReaderDevice>("add_ereader_device", { name, mountPath });
      setEreaderDevices((prev) => [...prev, device]);
      setSelectedEreaderDeviceId(device.id);
    } catch {
      setScanStatus("Could not add eReader device.");
    }
  };

  const handleRemoveEreaderDevice = async (deviceId: string) => {
    if (!isTauri()) return;
    try {
      await invoke("remove_ereader_device", { deviceId });
      setEreaderDevices((prev) => prev.filter((d) => d.id !== deviceId));
      if (selectedEreaderDeviceId === deviceId) {
        setSelectedEreaderDeviceId(null);
      }
    } catch {
      setScanStatus("Could not remove eReader device.");
    }
  };

  const handleScanEreaderDevice = async (deviceId: string) => {
    if (!isTauri()) return;
    setEreaderScanning(true);
    setEreaderScanProgress(null);
    try {
      const books = await invoke<EReaderBook[]>("scan_ereader", { deviceId });
      setEreaderBooks(books);
    } catch {
      setScanStatus("Could not scan eReader device.");
    } finally {
      setEreaderScanning(false);
      setTimeout(() => {
        setEreaderScanProgress(null);
      }, 800);
    }
  };

  const handleQueueEreaderAdd = async (itemId: string) => {
    if (!isTauri() || !selectedEreaderDeviceId) return;
    try {
      const item = await invoke<SyncQueueItem>("queue_sync_action", {
        deviceId: selectedEreaderDeviceId,
        action: "add",
        itemId,
        ereaderPath: null,
      });
      setEreaderSyncQueue((prev) => [...prev, item]);
    } catch {
      setScanStatus("Could not queue book for sync.");
    }
  };

  const handleQueueEreaderRemove = async (ereaderPath: string) => {
    if (!isTauri() || !selectedEreaderDeviceId) return;
    try {
      const item = await invoke<SyncQueueItem>("queue_sync_action", {
        deviceId: selectedEreaderDeviceId,
        action: "remove",
        itemId: null,
        ereaderPath,
      });
      setEreaderSyncQueue((prev) => [...prev, item]);
    } catch {
      setScanStatus("Could not queue book for removal.");
    }
  };

  const handleQueueEreaderImport = async (ereaderPath: string) => {
    if (!isTauri() || !selectedEreaderDeviceId) return;
    try {
      const item = await invoke<SyncQueueItem>("queue_sync_action", {
        deviceId: selectedEreaderDeviceId,
        action: "import",
        itemId: null,
        ereaderPath,
      });
      setEreaderSyncQueue((prev) => [...prev, item]);
    } catch {
      setScanStatus("Could not queue book for import.");
    }
  };

  const handleQueueEreaderUpdate = async (itemId: string, ereaderPath: string) => {
    if (!isTauri() || !selectedEreaderDeviceId) return;
    try {
      const item = await invoke<SyncQueueItem>("queue_sync_action", {
        deviceId: selectedEreaderDeviceId,
        action: "update",
        itemId,
        ereaderPath,
      });
      setEreaderSyncQueue((prev) => [...prev, item]);
    } catch {
      setScanStatus("Could not queue book for update.");
    }
  };

  const handleRemoveFromEreaderQueue = async (queueId: string) => {
    if (!isTauri()) return;
    try {
      await invoke("remove_from_sync_queue", { queueId });
      setEreaderSyncQueue((prev) => prev.filter((q) => q.id !== queueId));
    } catch {
      setScanStatus("Could not remove from sync queue.");
    }
  };

  const handleExecuteEreaderSync = async () => {
    if (!isTauri() || !selectedEreaderDeviceId) return;
    const pendingIds = ereaderSyncQueue
      .filter((item) => item.status === "pending")
      .map((item) => item.id);
    if (pendingIds.length === 0) {
      setEreaderSyncDialogOpen(false);
      return;
    }
    setEreaderSyncing(true);
    try {
      const result = await invoke<{
        added: number;
        removed: number;
        imported: number;
        updated: number;
        errors: string[];
      }>("apply_sync_queue_changes", {
        ids: pendingIds,
      });

      await refreshQueue(selectedEreaderDeviceId);

      const books = await invoke<EReaderBook[]>("scan_ereader", { deviceId: selectedEreaderDeviceId });
      setEreaderBooks(books);

      await refreshLibrary();

      const parts: string[] = [];
      if (result.added > 0) parts.push(`${result.added} added`);
      if (result.removed > 0) parts.push(`${result.removed} removed`);
      if (result.imported > 0) parts.push(`${result.imported} imported`);
      if (result.updated > 0) parts.push(`${result.updated} updated`);
      if (result.errors.length > 0) parts.push(`${result.errors.length} errors`);

      setScanStatus(`Sync complete: ${parts.join(", ")}`);
      setEreaderSyncDialogOpen(false);
    } catch {
      setScanStatus("Sync failed.");
    } finally {
      setEreaderSyncing(false);
    }
  };

  return {
    ereaderDevices,
    selectedEreaderDeviceId,
    setSelectedEreaderDeviceId,
    ereaderBooks,
    ereaderSyncQueue,
    ereaderScanning,
    ereaderScanProgress,
    ereaderSyncDialogOpen,
    setEreaderSyncDialogOpen,
    ereaderSyncing,
    ereaderSyncProgress,
    refreshDevices,
    handleAddEreaderDevice,
    handleRemoveEreaderDevice,
    handleScanEreaderDevice,
    handleQueueEreaderAdd,
    handleQueueEreaderRemove,
    handleQueueEreaderImport,
    handleQueueEreaderUpdate,
    handleRemoveFromEreaderQueue,
    handleExecuteEreaderSync,
  };
}
