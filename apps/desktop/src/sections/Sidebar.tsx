import {
  AlertCircle,
  BookOpen,
  Copy,
  FileClock,
  FolderInput,
  HardDrive,
  Inbox,
  Library,
  RefreshCw,
  Search,
  Tag,
  User,
  Wand,
  Wrench
} from "lucide-react";
import type { Dispatch, SetStateAction } from "react";
import { useEffect, useState } from "react";
import { Button, Panel, SidebarItem } from "../components/ui";
import type {
  ActivityLogItem,
  LibraryHealth,
  ScanProgress,
  View
} from "../types/library";

type SidebarProps = {
  view: View;
  setView: Dispatch<SetStateAction<View>>;
  scanStatus: string | null;
  scanning: boolean;
  scanStartedAt: number | null;
  scanProgress: ScanProgress | null;
  libraryHealth: LibraryHealth | null;
  handleClearLibrary: () => void;
  appVersion: string | null;
  ereaderConnected: boolean;
  activityLog?: ActivityLogItem[];
};

export function Sidebar({
  view,
  setView,
  scanStatus,
  scanning,
  scanStartedAt,
  scanProgress,
  libraryHealth,
  handleClearLibrary,
  appVersion,
  ereaderConnected,
  activityLog = [],
}: SidebarProps) {
  const [elapsedSeconds, setElapsedSeconds] = useState<number | null>(null);

  useEffect(() => {
    if (!scanning || !scanStartedAt) {
      return;
    }

    const updateElapsed = () => {
      setElapsedSeconds(Math.floor((Date.now() - scanStartedAt) / 1000));
    };

    const timeoutId = window.setTimeout(updateElapsed, 0);
    const intervalId = window.setInterval(updateElapsed, 1000);
    return () => {
      window.clearTimeout(timeoutId);
      window.clearInterval(intervalId);
    };
  }, [scanning, scanStartedAt]);

  return (
    <aside className="flex h-screen flex-col overflow-hidden border-r border-app-border bg-app-surface">
      <div className="flex-none flex items-center gap-3 border-b border-app-border px-4 py-5 bg-app-surface">
        <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-white shadow-sm border border-app-border/50">
          <img src="/src-tauri/icons/icon.png" alt="Folio" className="h-8 w-8" />
        </div>
        <div className="flex flex-col justify-center">
          <span className="text-lg font-bold tracking-tight text-app-ink leading-none">Folio</span>
          <div className="flex items-center gap-1.5 mt-1">
            <span className="text-[10px] font-medium text-app-ink-muted uppercase tracking-wider">
              Calm Library
            </span>
            {appVersion && (
              <span className="rounded-full bg-app-border/50 px-1.5 py-0.5 text-[9px] font-medium text-app-ink-muted">
                v{appVersion}
              </span>
            )}
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-3 py-2 scrollbar-hide">
        <nav className="flex flex-col gap-0.5 mb-6">
          <div className="text-[11px] font-semibold text-app-ink-muted/70 px-2 py-2 mb-1">
            LIBRARY
          </div>
          <SidebarItem
            active={view === "library" || view === "library-books"}
            onClick={() => setView("library-books")}
          >
            <BookOpen size={16} />
            Boeken
          </SidebarItem>
          <SidebarItem
            active={view === "library-authors"}
            onClick={() => setView("library-authors")}
          >
            <User size={16} />
            Auteurs
          </SidebarItem>
          <SidebarItem
            active={view === "library-series"}
            onClick={() => setView("library-series")}
          >
            <Library size={16} />
            Series
          </SidebarItem>
          <SidebarItem active={view === "tags"} onClick={() => setView("tags")}>
            <Tag size={16} />
            Tags
          </SidebarItem>
          <SidebarItem active={view === "ereader"} onClick={() => setView("ereader")}>
            <HardDrive size={16} />
            <span className="flex items-center gap-1.5">
              eReader
              <span
                className={`w-1.5 h-1.5 rounded-full ${ereaderConnected ? "bg-emerald-500" : "bg-stone-300"}`}
                title={ereaderConnected ? "Device connected" : "No device connected"}
              />
            </span>
          </SidebarItem>
        </nav>

        <nav className="flex flex-col gap-0.5 mb-6">
          <div className="text-[11px] font-semibold text-app-ink-muted/70 px-2 py-2 mb-1">
            MAINTENANCE
          </div>
          <SidebarItem active={view === "inbox"} onClick={() => setView("inbox")}>
            <Inbox size={16} />
            Inbox
          </SidebarItem>
          <SidebarItem active={view === "duplicates"} onClick={() => setView("duplicates")}>
            <Copy size={16} />
            Duplicates
          </SidebarItem>
          <SidebarItem active={view === "fix"} onClick={() => setView("fix")}>
            <Wrench size={16} />
            Fix Metadata
          </SidebarItem>
          <SidebarItem active={view === "changes"} onClick={() => setView("changes")}>
            <FileClock size={16} />
            Changes
          </SidebarItem>
          <SidebarItem active={view === "organize"} onClick={() => setView("organize")}>
            <FolderInput size={16} />
            Organizer
          </SidebarItem>
        </nav>

        <Panel title="Activity" className="mb-4">
          {scanStatus ? (
            <div className="rounded-md border border-app-border/60 bg-white p-3 shadow-sm mb-2">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-medium text-app-ink">{scanStatus}</span>
                {elapsedSeconds !== null && (
                  <span className="text-[10px] tabular-nums text-app-ink-muted">{elapsedSeconds}s</span>
                )}
              </div>

              {scanProgress && (
                <div className="space-y-2">
                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-app-border/30">
                    <div
                      className="h-full rounded-full bg-app-accent transition-[width] duration-300 ease-out"
                      style={{
                        width:
                          scanProgress.total > 0
                            ? `${Math.min(100, Math.round((scanProgress.processed / scanProgress.total) * 100))}%`
                            : "10%",
                      }}
                    />
                  </div>
                  <div className="flex items-center justify-between text-[10px] text-app-ink-muted">
                    <span>{scanProgress.current ? `Processing: ${scanProgress.current}` : "Preparing..."}</span>
                    <span className="font-mono">{scanProgress.processed}/{scanProgress.total || "?"}</span>
                  </div>
                </div>
              )}
            </div>
          ) : null}

          {activityLog.length > 0 ? (
            <div className="flex flex-col gap-1">
              {activityLog.slice(0, 5).map((item) => (
                <div key={item.id} className="flex gap-2 rounded-md px-2 py-1.5 hover:bg-white/50 text-[11px] text-app-ink-muted transition-colors">
                  <div className="mt-0.5 flex-none text-app-ink-muted/60">
                    {item.type === 'scan' && <Search size={12} />}
                    {item.type === 'enrich' && <Wand size={12} />}
                    {item.type === 'sync' && <RefreshCw size={12} />}
                    {item.type === 'organize' && <Copy size={12} />}
                    {item.type === 'error' && <AlertCircle size={12} className="text-red-500" />}
                  </div>
                  <div className="flex flex-col gap-0.5 min-w-0">
                    <span className="truncate font-medium text-app-ink">{item.message}</span>
                    <span className="text-[9px] opacity-70">
                      {new Date(item.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          ) : !scanStatus && (
            <div className="rounded-md border border-dashed border-app-border bg-app-bg/50 px-3 py-4 text-center text-xs text-app-ink-muted">
              No recent activity
            </div>
          )}
        </Panel>



        <Panel title="Library Health" className="mb-6">
          <div className="rounded-lg border border-app-border bg-white p-3 shadow-sm">
            <div className="mb-3 flex items-baseline justify-between border-b border-app-border/40 pb-2">
              <span className="text-[11px] uppercase tracking-wider font-semibold text-app-ink-muted">Health Score</span>
              <span className="text-xl font-bold text-app-ink">
                {libraryHealth
                  ? `${Math.round(
                    (libraryHealth.complete / Math.max(1, libraryHealth.total)) * 100
                  )}%`
                  : "—"}
              </span>
            </div>

            <div className="grid grid-cols-3 gap-2 text-center">
              <div className="flex flex-col gap-0.5">
                <span className="text-lg font-semibold text-app-ink leading-tight">
                  {libraryHealth ? libraryHealth.missing_isbn : "—"}
                </span>
                <span className="text-[9px] font-medium text-app-ink-muted uppercase">No ISBN</span>
              </div>
              <div className="flex flex-col gap-0.5 border-l border-app-border/50">
                <span className="text-lg font-semibold text-app-ink leading-tight">
                  {libraryHealth ? libraryHealth.missing_cover : "—"}
                </span>
                <span className="text-[9px] font-medium text-app-ink-muted uppercase">No Cover</span>
              </div>
              <div className="flex flex-col gap-0.5 border-l border-app-border/50">
                <span className="text-lg font-semibold text-app-ink leading-tight">
                  {libraryHealth ? libraryHealth.duplicates : "—"}
                </span>
                <span className="text-[9px] font-medium text-app-ink-muted uppercase">Dupes</span>
              </div>
            </div>
          </div>
        </Panel>

        <Panel title="Danger Zone" className="border-red-100 bg-red-50/50 mb-6">
          <Button variant="danger" size="sm" onClick={handleClearLibrary} className="w-full justify-center shadow-sm">
            Clear Library Data
          </Button>
        </Panel>
      </div>
    </aside >
  );
}
