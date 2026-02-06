import { getVersion } from "@tauri-apps/api/app";
import { isTauri } from "@tauri-apps/api/core";
import { relaunch } from "@tauri-apps/plugin-process";
import { check } from "@tauri-apps/plugin-updater";
import { useCallback, useEffect, useState } from "react";

type UseUpdaterArgs = {
  isDesktop: boolean;
  autoCheck?: boolean;
};

export function useUpdater({ isDesktop, autoCheck = true }: UseUpdaterArgs) {
  const [updateStatus, setUpdateStatus] = useState<string | null>(null);
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const [updateVersion, setUpdateVersion] = useState<string | null>(null);
  const [appVersion, setAppVersion] = useState<string | null>(null);

  const checkForUpdates = useCallback(async (silent = false) => {
    if (!isTauri()) return;
    try {
      console.info("[updater] check start", { silent });
      if (!silent) setUpdateStatus("Checking for updates…");
      const result = await check();
      if (!result) {
        console.info("[updater] no update available");
        setUpdateAvailable(false);
        setUpdateVersion(null);
        if (!silent) setUpdateStatus("No updates found.");
        return;
      }
      console.info("[updater] update available", {
        version: result.version,
        currentVersion: result.currentVersion,
      });
      setUpdateAvailable(true);
      setUpdateVersion(result.version);
      if (silent) return;
      setUpdateStatus(`Update ${result.version} available. Downloading…`);
      await result.downloadAndInstall();
      console.info("[updater] download complete, relaunching");
      setUpdateStatus("Update downloaded. Restarting…");
      await relaunch();
    } catch (error) {
      console.error("[updater] check failed", error);
      if (silent) return;
      const message = error instanceof Error ? error.message : String(error ?? "Update failed.");
      setUpdateStatus(`Update failed: ${message}`);
    }
  }, []);

  useEffect(() => {
    if (!isDesktop) return;
    getVersion()
      .then((version) => setAppVersion(version))
      .catch(() => {
        setAppVersion(null);
      });
  }, [isDesktop]);

  useEffect(() => {
    if (!autoCheck) return;
    const timeout = window.setTimeout(() => {
      void checkForUpdates(true);
    }, 0);
    return () => window.clearTimeout(timeout);
  }, [autoCheck, checkForUpdates]);

  return {
    appVersion,
    updateStatus,
    updateAvailable,
    updateVersion,
    checkForUpdates,
  };
}
