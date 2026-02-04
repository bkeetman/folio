import {
  AlertTriangle,
  BookOpen,
  Copy,
  FileClock,
  FolderInput,
  FolderOpen,
  HardDrive,
  Library,
  Sparkles,
  Tag,
  User,
  Wrench
} from "lucide-react";
import type { Dispatch, SetStateAction } from "react";
import { Panel, SidebarItem } from "../components/ui";
import type {
  LibraryHealth,
  View
} from "../types/library";

type SidebarProps = {
  view: View;
  setView: Dispatch<SetStateAction<View>>;
  scanning: boolean;
  handleScan: () => void;
  libraryHealth: LibraryHealth | null;
  handleClearLibrary: () => void;
  appVersion: string | null;
  ereaderConnected: boolean;
};

export function Sidebar({
  view,
  setView,
  scanning,
  handleScan,
  libraryHealth,
  handleClearLibrary,
  appVersion,
  ereaderConnected,
}: SidebarProps) {
  return (
    <aside className="flex h-screen flex-col overflow-hidden border-r border-app-border bg-app-surface">
      <div className="flex-none flex items-center gap-3 border-b border-app-border px-4 py-5 bg-app-surface">
        <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-white shadow-sm border border-app-border/50">
          <img src="/folio-icon.png" alt="Folio" className="h-8 w-8" />
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
          <SidebarItem active={scanning} onClick={handleScan}>
            <FolderOpen size={16} />
            Add Books
          </SidebarItem>
          <SidebarItem active={view === "duplicates"} onClick={() => setView("duplicates")}>
            <Copy size={16} />
            Duplicates
          </SidebarItem>
          <SidebarItem active={view === "missing-files"} onClick={() => setView("missing-files")}>
            <HardDrive size={16} />
            Missing Files
          </SidebarItem>
          <SidebarItem active={view === "fix"} onClick={() => setView("fix")}>
            <Sparkles size={16} />
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
          <SidebarItem active={view === "settings"} onClick={() => setView("settings")}>
            <Wrench size={16} />
            Settings
          </SidebarItem>
          <SidebarItem
            onClick={handleClearLibrary}
            className="text-red-600 hover:text-red-700"
          >
            <AlertTriangle size={16} />
            <span className="flex flex-col">
              <span>Clear Library Data</span>
              <span className="text-[10px] font-normal text-red-500/80">
                Deletes all items
              </span>
            </span>
          </SidebarItem>
        </nav>

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

      </div>
    </aside >
  );
}
