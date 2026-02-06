import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useCallback, useEffect, useState } from "react";
import type {
  ActivityLogItem,
  EReaderBook,
  EReaderDevice,
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

    listen<{ added: number; removed: number; imported: number; errors: string[] }>(
      "sync-complete",
      (event) => {
        setEreaderSyncProgress(null);
        setEreaderSyncing(false);
        const parts: string[] = [];
        if (event.payload.added > 0) parts.push(`${event.payload.added} added`);
        if (event.payload.removed > 0) parts.push(`${event.payload.removed} removed`);
        if (event.payload.imported > 0) parts.push(`${event.payload.imported} imported`);
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
          void refreshQueue(selectedEreaderDeviceId);
        }
      }
    ).then((stop) => {
      unlistenSyncComplete = stop;
    });

    return () => {
      if (unlistenSyncProgress) unlistenSyncProgress();
      if (unlistenSyncComplete) unlistenSyncComplete();
    };
  }, [isDesktop, ereaderSyncing, refreshQueue, selectedEreaderDeviceId, setActivityLog, setScanStatus]);

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
    try {
      const books = await invoke<EReaderBook[]>("scan_ereader", { deviceId });
      setEreaderBooks(books);
    } catch {
      setScanStatus("Could not scan eReader device.");
    } finally {
      setEreaderScanning(false);
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
    setEreaderSyncing(true);
    try {
      const result = await invoke<{
        added: number;
        removed: number;
        imported: number;
        errors: string[];
      }>("execute_sync", {
        deviceId: selectedEreaderDeviceId,
      });

      await refreshQueue(selectedEreaderDeviceId);

      const books = await invoke<EReaderBook[]>("scan_ereader", { deviceId: selectedEreaderDeviceId });
      setEreaderBooks(books);

      await refreshLibrary();

      const parts: string[] = [];
      if (result.added > 0) parts.push(`${result.added} added`);
      if (result.removed > 0) parts.push(`${result.removed} removed`);
      if (result.imported > 0) parts.push(`${result.imported} imported`);
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
    handleRemoveFromEreaderQueue,
    handleExecuteEreaderSync,
  };
}
