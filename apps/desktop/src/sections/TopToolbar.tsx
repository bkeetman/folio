import { Download, LayoutGrid, List, Search } from "lucide-react";
import type { Dispatch, SetStateAction } from "react";
import { useTranslation } from "react-i18next";
import { Badge, Button, Input } from "../components/ui";
import type { ActivityLogItem, OperationProgress, ScanProgress, View } from "../types/library";

type TopToolbarProps = {
  view: View;
  checkForUpdates: (silent: boolean) => void;
  query: string;
  setQuery: Dispatch<SetStateAction<string>>;
  grid: boolean;
  setGrid: Dispatch<SetStateAction<boolean>>;
  libraryReady: boolean;
  updateStatus: string | null;
  updateAvailable: boolean;
  updateVersion: string | null;
  scanStatus: string | null;
  scanProgress: ScanProgress | null;
  importProgress: OperationProgress | null;
  activityLog: ActivityLogItem[];
};

export function TopToolbar({
  view,
  checkForUpdates,
  query,
  setQuery,
  grid,
  setGrid,
  libraryReady,
  updateStatus,
  updateAvailable,
  updateVersion,
  scanStatus,
  scanProgress,
  importProgress,
  activityLog,
}: TopToolbarProps) {
  const { t } = useTranslation();
  const latestActivity = activityLog[0];
  const activityMessage = scanStatus ?? latestActivity?.message ?? t("topbar.noRecentActivity");
  const activityTime = latestActivity
    ? new Date(latestActivity.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    : null;
  const progressCurrent = scanProgress?.processed ?? importProgress?.current ?? null;
  const progressTotal = scanProgress?.total ?? importProgress?.total ?? null;
  const progressPercent =
    progressCurrent !== null && progressTotal !== null && progressTotal > 0
      ? Math.min(100, Math.round((progressCurrent / progressTotal) * 100))
      : null;
  const viewCopy = (() => {
    if (view === "library") return { title: t("topbar.views.library.title"), subtitle: t("topbar.views.library.subtitle") };
    if (view === "tags") return { title: t("topbar.views.tags.title"), subtitle: t("topbar.views.tags.subtitle") };
    if (view === "inbox") return { title: t("topbar.views.inbox.title"), subtitle: t("topbar.views.inbox.subtitle") };
    if (view === "duplicates")
      return { title: t("topbar.views.duplicates.title"), subtitle: t("topbar.views.duplicates.subtitle") };
    if (view === "fix") return { title: t("topbar.views.fix.title"), subtitle: t("topbar.views.fix.subtitle") };
    if (view === "changes")
      return { title: t("topbar.views.changes.title"), subtitle: t("topbar.views.changes.subtitle") };
    if (view === "import")
      return { title: t("topbar.views.import.title"), subtitle: t("topbar.views.import.subtitle") };
    return { title: "", subtitle: "" };
  })();
  return (
    <>
      <header className="flex items-center justify-between gap-6 border-b border-[var(--app-border)] pb-3">
        <div className="space-y-1">
          <div className="text-lg font-semibold">{viewCopy.title}</div>
          <p className="text-[11px] text-[var(--app-ink-muted)]">{viewCopy.subtitle}</p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-3 rounded-full border border-[var(--app-border-soft)] bg-app-surface/50 px-4 py-1.5 shadow-sm flex-1 min-w-[320px]">
            <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-app-ink-muted">
              {t("topbar.activity")}
            </div>
            <div className="flex flex-1 items-center gap-3 min-w-0">
              <span className="truncate text-xs text-app-ink">{activityMessage}</span>
              {activityTime ? (
                <span className="text-[10px] tabular-nums text-app-ink-muted">{activityTime}</span>
              ) : null}
            </div>
            {(scanProgress || importProgress) ? (
              <div className="flex items-center gap-2">
                <div className="h-1 w-32 overflow-hidden rounded-full bg-app-border/40">
                  <div
                    className="h-full rounded-full bg-app-accent transition-[width] duration-300 ease-out"
                    style={{ width: progressPercent ? `${progressPercent}%` : "10%" }}
                  />
                </div>
                <span className="text-[9px] tabular-nums text-app-ink-muted">
                  {progressCurrent}/{progressTotal || "?"}
                </span>
              </div>
            ) : null}
          </div>

          <div className="flex items-center gap-1 rounded-md border border-transparent bg-[var(--app-panel)] p-1">
            {updateAvailable ? (
              <Button variant="toolbar" size="sm" className="hover:bg-white" onClick={() => checkForUpdates(false)}>
                <Download size={14} />
                {t("topbar.updateApp")}{updateVersion ? ` v${updateVersion}` : ""}
              </Button>
            ) : null}
          </div>

          <div className="flex items-center gap-2">
            <div className="relative w-48">
              <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--app-ink-muted)]" />
              <Input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={t("topbar.searchPlaceholder")}
                className="pl-8"
              />
            </div>
            <div className="flex items-center rounded-md border border-transparent bg-[var(--app-panel)] p-1">
              <Button
                variant="toolbar"
                size="sm"
                data-active={grid}
                className={
                  grid
                    ? "bg-app-accent/15 text-app-accent border-[var(--app-accent)] border-opacity-20"
                    : "border-transparent bg-transparent hover:bg-app-surface-hover/50"
                }
                onClick={() => setGrid(true)}
              >
                <LayoutGrid size={14} />
              </Button>
              <Button
                variant="toolbar"
                size="sm"
                data-active={!grid}
                className={
                  !grid
                    ? "bg-app-accent/15 text-app-accent border-[var(--app-accent)] border-opacity-20"
                    : "border-transparent bg-transparent hover:bg-app-surface-hover/50"
                }
                onClick={() => setGrid(false)}
              >
                <List size={14} />
              </Button>
            </div>
          </div>

          {view === "library" && !libraryReady ? <Badge variant="muted">{t("topbar.loading")}</Badge> : null}
        </div>
      </header>
      {updateStatus ? (
        <div className="rounded-md bg-[rgba(207,217,210,0.35)] px-2 py-1 text-xs text-[var(--app-ink-muted)]">
          {updateStatus}
        </div>
      ) : null}
    </>
  );
}
