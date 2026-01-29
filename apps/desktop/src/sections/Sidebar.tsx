import { useEffect, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import type {
  LibraryHealth,
  OrganizePlan,
  ScanProgress,
  View,
} from "../types/library";
import { Button, Input, Panel, SidebarItem } from "../components/ui";
import {
  BookOpen,
  Copy,
  FileClock,
  HardDrive,
  Inbox,
  Library,
  Tag,
  User,
  Wrench,
} from "lucide-react";

type SidebarProps = {
  view: View;
  setView: Dispatch<SetStateAction<View>>;
  scanStatus: string | null;
  scanning: boolean;
  scanStartedAt: number | null;
  scanProgress: ScanProgress | null;
  scanEtaLabel: string | null;
  organizeMode: string;
  setOrganizeMode: Dispatch<SetStateAction<string>>;
  organizeTemplate: string;
  setOrganizeTemplate: Dispatch<SetStateAction<string>>;
  organizePlan: OrganizePlan | null;
  handleApplyOrganize: () => void;
  handleQueueOrganize: () => void;
  organizeStatus: string | null;
  libraryHealth: LibraryHealth | null;
  handleClearLibrary: () => void;
  appVersion: string | null;
};

export function Sidebar({
  view,
  setView,
  scanStatus,
  scanning,
  scanStartedAt,
  scanProgress,
  scanEtaLabel,
  organizeMode,
  setOrganizeMode,
  organizeTemplate,
  setOrganizeTemplate,
  organizePlan,
  handleApplyOrganize,
  handleQueueOrganize,
  organizeStatus,
  libraryHealth,
  handleClearLibrary,
  appVersion,
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
    <aside className="flex h-screen flex-col gap-3 overflow-hidden border-r border-[var(--app-border)] bg-[var(--app-surface)] px-4 py-4">
      <div className="flex items-start gap-3 rounded-lg border border-[var(--app-border)] bg-white/70 px-3 py-2 shadow-soft">
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-white">
          <img src="/src-tauri/icons/icon.png" alt="Folio" className="h-7 w-7" />
        </div>
        <div className="pt-0.5 leading-tight">
          <div className="flex items-center gap-2">
            <div className="text-sm font-semibold tracking-wide">Folio</div>
            {appVersion ? (
              <span className="rounded-full border border-[var(--app-border)] bg-white/70 px-2 py-0.5 text-[10px] text-[var(--app-ink-muted)]">
                v{appVersion}
              </span>
            ) : null}
          </div>
          <div className="text-[11px] uppercase tracking-[0.2em] text-[var(--app-ink-muted)]">
            Calm Library
          </div>
        </div>
      </div>

      <nav className="flex flex-col gap-1">
        <div className="text-[10px] uppercase tracking-[0.15em] text-[var(--app-ink-muted)] px-2 pt-2">
          Library
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
          eReader
        </SidebarItem>
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
      </nav>

      <Panel title="Activity">
        {scanStatus ? (
          <div className="rounded-md bg-[rgba(207,217,210,0.35)] px-2 py-1 text-xs text-[var(--app-ink-muted)]">
            {scanStatus}
            {scanning && scanStartedAt && elapsedSeconds !== null ? (
              <div className="mt-1 text-[10px] tracking-[0.3px]">
                {elapsedSeconds}s elapsed
              </div>
            ) : null}
            {scanProgress ? (
              <div className="mt-2 flex flex-col gap-1.5">
                <div className="text-[10px] uppercase tracking-[0.2em] text-[var(--app-ink-muted)]">
                  {scanProgress.processed} / {scanProgress.total || "?"}
                </div>
                <div className="h-1.5 overflow-hidden rounded-full bg-[rgba(208,138,70,0.2)]">
                  <div
                    className="h-full rounded-full bg-[linear-gradient(90deg,var(--app-accent),var(--app-accent-strong))] transition-[width] duration-200"
                    style={{
                      width:
                        scanProgress.total > 0
                          ? `${Math.min(
                              100,
                              Math.round(
                                (scanProgress.processed / scanProgress.total) * 100
                              )
                            )}%`
                          : "6%",
                    }}
                  />
                </div>
                <div className="truncate text-[10px] text-[var(--app-ink-muted)]">
                  {scanProgress.current}
                </div>
                {scanEtaLabel ? (
                  <div className="text-[10px] text-[var(--app-ink-muted)]">
                    ETA {scanEtaLabel}
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>
        ) : (
          <div className="rounded-md bg-[rgba(227,221,214,0.35)] px-2 py-1 text-xs text-[var(--app-ink-muted)]">
            No recent activity.
          </div>
        )}
      </Panel>

      <Panel title="Organizer">
        <div className="flex items-center justify-between text-xs text-[var(--app-ink-muted)]">
          <span>Mode</span>
          <select
            className="h-7 rounded-md border border-[var(--app-border)] bg-white/80 px-2 text-xs"
            value={organizeMode}
            onChange={(event) => setOrganizeMode(event.target.value)}
          >
            <option value="reference">Reference</option>
            <option value="copy">Copy</option>
            <option value="move">Move</option>
          </select>
        </div>
        <Input
          className="text-xs"
          value={organizeTemplate}
          onChange={(event) => setOrganizeTemplate(event.target.value)}
        />
        {organizePlan ? (
          <div className="flex flex-col gap-2 text-xs text-[var(--app-ink-muted)]">
            <div>{organizePlan.entries.length} planned</div>
            {organizePlan.entries.slice(0, 3).map((entry) => (
              <div key={entry.file_id} className="truncate">
                {entry.target_path}
              </div>
            ))}
            <div className="flex flex-wrap gap-2">
              <Button variant="primary" onClick={handleApplyOrganize}>
                Apply Plan
              </Button>
              <Button variant="ghost" onClick={handleQueueOrganize}>
                Queue Changes
              </Button>
            </div>
          </div>
        ) : null}
        {organizeStatus ? (
          <div className="rounded-md bg-[rgba(207,217,210,0.35)] px-2 py-1 text-xs text-[var(--app-ink-muted)]">
            {organizeStatus}
          </div>
        ) : null}
      </Panel>

      <Panel title="Library Health">
        <div className="grid gap-2">
          <div className="flex items-baseline justify-between">
            <span className="text-[11px] uppercase tracking-[0.18em] text-[var(--app-ink-muted)]">
              Complete
            </span>
            <strong className="text-base">
              {libraryHealth
                ? `${Math.round(
                    (libraryHealth.complete / Math.max(1, libraryHealth.total)) * 100
                  )}%`
                : "—"}
            </strong>
          </div>
          <div className="flex items-center justify-between text-[13px]">
            <span className="text-[var(--app-ink-muted)]">Missing ISBN</span>
            <strong className="tabular-nums">
              {libraryHealth ? libraryHealth.missing_isbn : "—"}
            </strong>
          </div>
          <div className="flex items-center justify-between text-[13px]">
            <span className="text-[var(--app-ink-muted)]">Missing Cover</span>
            <strong className="tabular-nums">
              {libraryHealth ? libraryHealth.missing_cover : "—"}
            </strong>
          </div>
          <div className="flex items-center justify-between text-[13px]">
            <span className="text-[var(--app-ink-muted)]">Duplicates</span>
            <strong className="tabular-nums">
              {libraryHealth ? libraryHealth.duplicates : "—"}
            </strong>
          </div>
        </div>
      </Panel>

      <Panel title="Danger Zone" className="border-[rgba(178,74,44,0.25)] bg-[rgba(255,247,242,0.85)]">
        <Button variant="danger" onClick={handleClearLibrary}>
          Clear Library
        </Button>
        <div className="text-[11px] text-[#7a5a4e]">
          Removes all Folio data. Your files remain untouched.
        </div>
      </Panel>
    </aside>
  );
}
