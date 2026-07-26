import { useCallback, useEffect, useRef, useState } from "react";
import { invoke, isTauri, listen, open } from "../platform/native";
import type { OperationCoordinator } from "../operations/useOperationCoordinator";
import type {
  OperationProgress,
  OperationStats,
  OrganizerLog,
  OrganizerSettings,
  OrganizePlan,
} from "../types/library";

type UseOrganizerArgs = {
  isDesktop: boolean;
  operations: OperationCoordinator;
};

export function useOrganizer({
  isDesktop,
  operations,
}: UseOrganizerArgs) {
  const [organizePlan, setOrganizePlan] = useState<OrganizePlan | null>(null);
  const [organizeStatus, setOrganizeStatus] = useState<string | null>(null);
  const [organizeLog, setOrganizeLog] = useState<OrganizerLog | null>(null);
  const [organizeMode, setOrganizeMode] = useState("copy");
  const [organizeRoot, setOrganizeRoot] = useState<string | null>(null);
  const [organizeTemplate, setOrganizeTemplate] = useState(
    "{Author}/{Title} ({Year}) [{ISBN13}].{ext}"
  );
  const organizerSettingsLoaded = useRef(false);
  const { begin, complete, fail, getActiveToken, update } = operations;
  const organizing = operations.isRunning("organize");
  const organizeProgress = organizing &&
    (operations.state.status === "running" || operations.state.status === "cancelling")
    ? operations.state.progress
    : null;

  useEffect(() => {
    if (!isDesktop) return;
    let unlistenProgress: (() => void) | undefined;
    let unlistenComplete: (() => void) | undefined;

    listen<OperationProgress>("organize-progress", (event) => {
      const token = getActiveToken("organize");
      if (token !== null) update(token, event.payload);
    }).then((stop) => {
      unlistenProgress = stop;
    });

    listen<OperationStats>("organize-complete", async (event) => {
      const message = `Organizer complete: ${event.payload.processed} applied, ${event.payload.errors} errors.`;
      const token = getActiveToken("organize");
      if (token !== null) complete(token, message);
      setOrganizeStatus(message);
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
  }, [complete, getActiveToken, isDesktop, organizeMode, organizeRoot, organizeTemplate, update]);

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
    let operationToken: number | null = null;
    try {
      let selection = organizeRoot;
      if (!selection) {
        const picked = await open({ directory: true, multiple: false });
        if (typeof picked !== "string") return null;
        selection = picked;
        setOrganizeRoot(picked);
      }
      operationToken = begin("organize", { label: "Preparing organize plan", canCancel: false });
      if (operationToken === null) return null;
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
      complete(operationToken, "Organize plan prepared.");
      return plan;
    } catch (error) {
      const message = `Could not prepare organize plan: ${error instanceof Error ? error.message : String(error)}`;
      if (operationToken !== null) fail(operationToken, message);
      setOrganizeStatus(message);
      return null;
    }
  }, [begin, complete, fail, organizeMode, organizeRoot, organizeTemplate]);

  const handleApplyOrganize = useCallback(async () => {
    if (!organizePlan || !isTauri()) return;
    const token = begin("organize", { label: "Queueing organize changes", canCancel: false });
    if (token === null) return;
    try {
      const created = await invoke<number>("generate_pending_changes_from_organize", {
        plan: organizePlan,
      });
      setOrganizeStatus(
        created > 0
          ? `Queued ${created} organize changes for review.`
          : "No organize changes to queue."
      );
      complete(token, "Organize changes queued.");
    } catch (err) {
      console.error("Organize error:", err);
      const message = `Error: ${err}`;
      fail(token, message);
      setOrganizeStatus(message);
    }
  }, [begin, complete, fail, organizePlan]);

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
