import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useCallback, useEffect, useRef, useState } from "react";
import type {
  OperationProgress,
  OperationStats,
  OrganizerLog,
  OrganizerSettings,
  OrganizePlan,
} from "../types/library";

type UseOrganizerArgs = {
  isDesktop: boolean;
};

export function useOrganizer({
  isDesktop,
}: UseOrganizerArgs) {
  const [organizePlan, setOrganizePlan] = useState<OrganizePlan | null>(null);
  const [organizeStatus, setOrganizeStatus] = useState<string | null>(null);
  const [organizeProgress, setOrganizeProgress] = useState<OperationProgress | null>(null);
  const [organizing, setOrganizing] = useState(false);
  const [organizeLog, setOrganizeLog] = useState<OrganizerLog | null>(null);
  const [organizeMode, setOrganizeMode] = useState("copy");
  const [organizeRoot, setOrganizeRoot] = useState<string | null>(null);
  const [organizeTemplate, setOrganizeTemplate] = useState(
    "{Author}/{Title} ({Year}) [{ISBN13}].{ext}"
  );
  const organizerSettingsLoaded = useRef(false);

  useEffect(() => {
    if (!isDesktop) return;
    let unlistenProgress: (() => void) | undefined;
    let unlistenComplete: (() => void) | undefined;

    listen<OperationProgress>("organize-progress", (event) => {
      setOrganizeProgress(event.payload);
      setOrganizing(true);
    }).then((stop) => {
      unlistenProgress = stop;
    });

    listen<OperationStats>("organize-complete", async (event) => {
      setOrganizeProgress(null);
      setOrganizing(false);
      setOrganizeStatus(
        `Organizer complete: ${event.payload.processed} applied, ${event.payload.errors} errors.`
      );
      try {
        const log = await invoke<OrganizerLog | null>("get_latest_organizer_log");
        setOrganizeLog(log);
      } catch {
        // ignore
      }
      if (organizeRoot) {
        try {
          const plan = await invoke<OrganizePlan>("plan_organize", {
            mode: organizeMode,
            libraryRoot: organizeRoot,
            template: organizeTemplate,
          });
          setOrganizePlan(plan);
          const actionable = plan.entries.filter((entry) => entry.action !== "skip").length;
          setOrganizeStatus(
            actionable > 0
              ? `Prepared ${actionable} actions.`
              : "No changes needed based on current settings."
          );
        } catch {
          // ignore
        }
      }
    }).then((stop) => {
      unlistenComplete = stop;
    });

    return () => {
      if (unlistenProgress) unlistenProgress();
      if (unlistenComplete) unlistenComplete();
    };
  }, [isDesktop, organizeMode, organizeRoot, organizeTemplate]);

  useEffect(() => {
    if (!isDesktop) return;
    invoke<OrganizerSettings>("get_organizer_settings")
      .then((settings) => {
        setOrganizeMode(settings.mode);
        setOrganizeTemplate(settings.template);
        setOrganizeRoot(settings.libraryRoot || null);
      })
      .catch(() => {
        // ignore
      })
      .finally(() => {
        organizerSettingsLoaded.current = true;
      });
  }, [isDesktop]);

  useEffect(() => {
    if (!isDesktop || !organizerSettingsLoaded.current) return;
    const timeout = window.setTimeout(() => {
      void invoke("set_organizer_settings", {
        settings: {
          libraryRoot: organizeRoot,
          mode: organizeMode,
          template: organizeTemplate,
        },
      });
    }, 400);
    return () => window.clearTimeout(timeout);
  }, [isDesktop, organizeRoot, organizeMode, organizeTemplate]);

  useEffect(() => {
    if (!isDesktop) return;
    invoke<OrganizerLog | null>("get_latest_organizer_log")
      .then((log) => setOrganizeLog(log))
      .catch(() => {
        // ignore
      });
  }, [isDesktop]);

  const handlePlanOrganize = useCallback(async () => {
    if (!isTauri()) {
      setOrganizeStatus("Organizer requires the Tauri desktop runtime.");
      return null;
    }
    try {
      let selection = organizeRoot;
      if (!selection) {
        const { open } = await import("@tauri-apps/plugin-dialog");
        const picked = await open({ directory: true, multiple: false });
        if (typeof picked !== "string") return null;
        selection = picked;
        setOrganizeRoot(picked);
      }
      const plan = await invoke<OrganizePlan>("plan_organize", {
        mode: organizeMode,
        libraryRoot: selection,
        template: organizeTemplate,
      });
      setOrganizePlan(plan);
      const actionable = plan.entries.filter((entry) => entry.action !== "skip").length;
      setOrganizeStatus(
        actionable > 0
          ? `Prepared ${actionable} actions.`
          : "No changes needed based on current settings."
      );
      return plan;
    } catch {
      setOrganizeStatus("Could not prepare organize plan.");
      return null;
    }
  }, [organizeMode, organizeRoot, organizeTemplate]);

  const handleApplyOrganize = useCallback(async () => {
    if (!organizePlan || !isTauri()) return;
    try {
      const created = await invoke<number>("generate_pending_changes_from_organize", {
        plan: organizePlan,
      });
      setOrganizeStatus(
        created > 0
          ? `Queued ${created} organize changes for review.`
          : "No organize changes to queue."
      );
    } catch (err) {
      console.error("Organize error:", err);
      setOrganizeStatus(`Error: ${err}`);
    }
  }, [organizePlan]);

  return {
    organizePlan,
    organizeStatus,
    organizeProgress,
    organizing,
    organizeLog,
    organizeMode,
    setOrganizeMode,
    organizeRoot,
    setOrganizeRoot,
    organizeTemplate,
    setOrganizeTemplate,
    handlePlanOrganize,
    handleApplyOrganize,
  };
}
