import type { Dispatch, SetStateAction } from "react";
import type { ActivityLogItem, ScanProgress, View } from "../types/library";
import { Badge, Button, Input } from "../components/ui";
import { Download, LayoutGrid, List, Search } from "lucide-react";

type TopToolbarProps = {
  view: View;
  setView: Dispatch<SetStateAction<View>>;
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
  activityLog: ActivityLogItem[];
};

export function TopToolbar({
  view,
  setView,
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
  activityLog,
}: TopToolbarProps) {
  const latestActivity = activityLog[0];
  const activityMessage = scanStatus ?? latestActivity?.message ?? "No recent activity";
  const activityTime = latestActivity
    ? new Date(latestActivity.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    : null;
  const progressPercent =
    scanProgress && scanProgress.total > 0
      ? Math.min(100, Math.round((scanProgress.processed / scanProgress.total) * 100))
      : null;
  return (
    <>
      <header className="flex items-center justify-between gap-6 border-b border-[var(--app-border)] pb-3">
        <div className="space-y-1">
          <div className="text-lg font-semibold">
            {view === "library" && "Your Library"}
            {view === "tags" && "Tags"}
            {view === "inbox" && "Inbox"}
            {view === "duplicates" && "Duplicates"}
            {view === "fix" && "Fix Metadata"}
            {view === "changes" && "File Changes"}
          </div>
          <p className="text-[11px] text-[var(--app-ink-muted)]">
            {view === "library" && "Browse and shape your calm stack."}
            {view === "tags" && "Create and maintain tags for your library."}
            {view === "inbox" && "New or incomplete entries waiting on you."}
            {view === "duplicates" && "Resolve duplicates detected by hash."}
            {view === "fix" && "Choose the best metadata match."}
            {view === "changes" && "Review and apply planned file updates."}
          </p>
        </div>

        <div className="flex flex-wrap items-center justify-end gap-3">
          <div className="flex items-center gap-3 rounded-full border border-[var(--app-border)] bg-white/70 px-3 py-1.5 shadow-soft max-w-[320px]">
            <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-app-ink-muted">
              Activity
            </div>
            <div className="flex items-center gap-2 min-w-0">
              <span className="truncate text-xs text-app-ink">{activityMessage}</span>
              {activityTime ? (
                <span className="text-[10px] tabular-nums text-app-ink-muted">{activityTime}</span>
              ) : null}
            </div>
            {scanProgress ? (
              <div className="flex items-center gap-2">
                <div className="h-1 w-20 overflow-hidden rounded-full bg-app-border/40">
                  <div
                    className="h-full rounded-full bg-app-accent transition-[width] duration-300 ease-out"
                    style={{ width: progressPercent ? `${progressPercent}%` : "10%" }}
                  />
                </div>
                <span className="text-[9px] tabular-nums text-app-ink-muted">
                  {scanProgress.processed}/{scanProgress.total || "?"}
                </span>
              </div>
            ) : null}
          </div>

          <div className="flex items-center gap-1 rounded-md border border-[var(--app-border)] bg-[var(--app-panel)] p-1 shadow-soft">
            {updateAvailable ? (
              <Button variant="toolbar" size="sm" className="hover:bg-white" onClick={() => checkForUpdates(false)}>
                <Download size={14} />
                Update App{updateVersion ? ` v${updateVersion}` : ""}
              </Button>
            ) : null}
          </div>

          <div className="relative w-48">
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--app-ink-muted)]" />
            <Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search title or author" className="pl-8" />
          </div>

          <div className="flex items-center gap-1 rounded-md border border-[var(--app-border)] bg-[var(--app-panel)] p-1">
            <Button
              variant="toolbar"
              size="sm"
              data-active={grid}
              className={
                grid
                  ? "bg-white shadow-soft"
                  : "hover:bg-white/80 hover:border-[var(--app-border)]"
              }
              onClick={() => setGrid(true)}
            >
              <LayoutGrid size={14} />
              Grid
            </Button>
            <Button
              variant="toolbar"
              size="sm"
              data-active={!grid}
              className={
                !grid
                  ? "bg-white shadow-soft"
                  : "hover:bg-white/80 hover:border-[var(--app-border)]"
              }
              onClick={() => setGrid(false)}
            >
              <List size={14} />
              List
            </Button>
          </div>

          {view === "library" && !libraryReady ? <Badge variant="muted">Loading</Badge> : null}
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
