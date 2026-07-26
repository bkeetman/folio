import { useEffect, type Dispatch, type SetStateAction } from "react";

import { isTauri, listen } from "../platform/native";
import type {
  ActivityLogItem,
  ApplyMetadataProgress,
  OperationProgress,
} from "../types/library";

type UseOperationEventListenersArgs = {
  isDesktop: boolean;
  setScanStatus: Dispatch<SetStateAction<string | null>>;
  handleScan: () => void | Promise<void>;
  setActivityLog: Dispatch<SetStateAction<ActivityLogItem[]>>;
};

export function useOperationEventListeners({
  isDesktop,
  setScanStatus,
  handleScan,
  setActivityLog,
}: UseOperationEventListenersArgs) {
  useEffect(() => {
    if (!isTauri()) return;
    let unlisten: (() => void) | undefined;
    void listen("menu-scan-folder", () => {
      void handleScan();
    }).then((stop) => {
      unlisten = stop;
    });
    return () => unlisten?.();
  }, [handleScan]);

  useEffect(() => {
    if (!isDesktop) return;
    let unlisten: (() => void) | undefined;
    void listen<OperationProgress>("import-scan-progress", (event) => {
      const { status, current, total, message } = event.payload;
      if (status === "done") {
        const completionMessage = message ?? `Import scan complete (${total} files).`;
        setScanStatus(completionMessage);
        setActivityLog((previous) => [
          {
            id: `import-scan-${Date.now()}`,
            type: "scan",
            message: completionMessage,
            timestamp: Date.now(),
          },
          ...previous,
        ]);
        return;
      }

      const progressLabel = total > 0 ? `Import scan ${current}/${total}` : "Import scan";
      setScanStatus(message ? `${progressLabel}: ${message}` : progressLabel);
    }).then((stop) => {
      unlisten = stop;
    });
    return () => unlisten?.();
  }, [isDesktop, setActivityLog, setScanStatus]);

  useEffect(() => {
    if (!isDesktop) return;
    let unlisten: (() => void) | undefined;
    void listen<ApplyMetadataProgress>("apply-metadata-progress", (event) => {
      const { message, current, total, step } = event.payload;
      setScanStatus(step === "done" ? "Metadata apply complete." : `${message} (${current}/${total})`);
    }).then((stop) => {
      unlisten = stop;
    });
    return () => unlisten?.();
  }, [isDesktop, setScanStatus]);
}
