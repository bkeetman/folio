import {
  AlertTriangle,
  BookOpen,
  Copy,
  FileClock,
  FolderInput,
  FolderOpen,
  HardDrive,
  ImageIcon,
  Library,
  Sparkles,
  Tag,
  User,
  Wrench
} from "lucide-react";
import type { Dispatch, SetStateAction } from "react";
import { useTranslation } from "react-i18next";
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
  pendingChangesCount: number;
  duplicateCount: number;
  missingFilesCount: number;
  fixActionCount: number;
  ereaderPendingCount: number;
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
  pendingChangesCount,
  duplicateCount,
  missingFilesCount,
  fixActionCount,
  ereaderPendingCount,
  handleClearLibrary,
  appVersion,
  ereaderConnected,
}: SidebarProps) {
  const { t } = useTranslation();
  return (
    <aside className="flex h-screen flex-col overflow-hidden border-r border-app-border bg-app-surface shadow-xl">
      <div className="flex-none flex items-center gap-3 border-b border-app-border px-4 py-5 bg-app-surface/50 backdrop-blur-md">
        <img src="/folio-icon.png" alt="Folio" className="h-10 w-10 drop-shadow-sm" />
        <div className="flex flex-col justify-center">
          <span className="text-lg font-bold tracking-tight text-app-ink leading-none">Folio</span>
          <div className="flex items-center gap-1.5 mt-1">
            <span className="text-[10px] font-medium text-app-ink-muted uppercase tracking-wider">
              {t("sidebar.calmLibrary")}
            </span>
            {appVersion && (
              <span className="rounded-full bg-app-border-soft px-1.5 py-0.5 text-[9px] font-bold text-app-ink-muted/80 ring-1 ring-white/5">
                v{appVersion}
              </span>
            )}
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-3 py-2 scrollbar-hide">
        <nav className="flex flex-col gap-0.5 mb-6">
          <div className="text-[11px] font-semibold text-app-ink-muted/70 px-2 py-2 mb-1">
            {t("sidebar.library").toUpperCase()}
          </div>
          <SidebarItem
            active={view === "library" || view === "library-books"}
            onClick={() => setView("library-books")}
          >
            <BookOpen size={16} />
            {t("sidebar.books")}
          </SidebarItem>
          <SidebarItem
            active={view === "library-authors"}
            onClick={() => setView("library-authors")}
          >
            <User size={16} />
            {t("sidebar.authors")}
          </SidebarItem>
          <SidebarItem
            active={view === "library-series"}
            onClick={() => setView("library-series")}
          >
            <Library size={16} />
            {t("sidebar.series")}
          </SidebarItem>
          <SidebarItem active={view === "tags"} onClick={() => setView("tags")}>
            <Tag size={16} />
            {t("sidebar.tags")}
          </SidebarItem>
          <SidebarItem active={view === "ereader"} onClick={() => setView("ereader")}>
            <HardDrive size={16} />
            <span className="flex flex-1 items-center justify-between gap-2">
              <span className="flex items-center gap-1.5">
                eReader
                <span
                  className={`w-1.5 h-1.5 rounded-full ${ereaderConnected ? "bg-emerald-500" : "bg-stone-300"}`}
                  title={ereaderConnected ? t("sidebar.deviceConnected") : t("sidebar.noDeviceConnected")}
                />
              </span>
              {ereaderPendingCount > 0 ? (
                <span className="min-w-[20px] rounded-full bg-app-accent/10 px-2 py-0.5 text-[10px] font-semibold text-app-accent">
                  {ereaderPendingCount}
                </span>
              ) : null}
            </span>
          </SidebarItem>
        </nav>

        <nav className="flex flex-col gap-0.5 mb-6">
          <div className="text-[11px] font-semibold text-app-ink-muted/70 px-2 py-2 mb-1">
            {t("sidebar.maintenance").toUpperCase()}
          </div>
          <SidebarItem active={scanning} onClick={handleScan}>
            <FolderOpen size={16} />
            {t("sidebar.addBooks")}
          </SidebarItem>
          <SidebarItem active={view === "duplicates"} onClick={() => setView("duplicates")}>
            <Copy size={16} />
            <span className="flex flex-1 items-center justify-between gap-2">
              <span>{t("sidebar.duplicates")}</span>
              {duplicateCount > 0 ? (
                <span className="min-w-[20px] rounded-full bg-app-accent/15 px-2 py-0.5 text-[10px] font-bold text-app-accent-strong ring-1 ring-app-accent/20">
                  {duplicateCount}
                </span>
              ) : null}
            </span>
          </SidebarItem>
          <SidebarItem active={view === "missing-files"} onClick={() => setView("missing-files")}>
            <HardDrive size={16} />
            <span className="flex flex-1 items-center justify-between gap-2">
              <span>{t("sidebar.missingFiles")}</span>
              {missingFilesCount > 0 ? (
                <span className="min-w-[20px] rounded-full bg-app-accent/10 px-2 py-0.5 text-[10px] font-semibold text-app-accent">
                  {missingFilesCount}
                </span>
              ) : null}
            </span>
          </SidebarItem>
          <SidebarItem active={view === "fix"} onClick={() => setView("fix")}>
            <Sparkles size={16} />
            <span className="flex flex-1 items-center justify-between gap-2">
              <span>{t("sidebar.fixMetadata")}</span>
              {fixActionCount > 0 ? (
                <span className="min-w-[20px] rounded-full bg-app-accent/10 px-2 py-0.5 text-[10px] font-semibold text-app-accent">
                  {fixActionCount}
                </span>
              ) : null}
            </span>
          </SidebarItem>
          <SidebarItem active={view === "changes"} onClick={() => setView("changes")}>
            <FileClock size={16} />
            <span className="flex flex-1 items-center justify-between gap-2">
              <span>{t("sidebar.changes")}</span>
              {pendingChangesCount > 0 ? (
                <span className="min-w-[20px] rounded-full bg-app-accent/10 px-2 py-0.5 text-[10px] font-semibold text-app-accent">
                  {pendingChangesCount}
                </span>
              ) : null}
            </span>
          </SidebarItem>
          <SidebarItem active={view === "organize"} onClick={() => setView("organize")}>
            <FolderInput size={16} />
            {t("sidebar.organizer")}
          </SidebarItem>
          <SidebarItem active={view === "settings"} onClick={() => setView("settings")}>
            <Wrench size={16} />
            {t("sidebar.settings")}
          </SidebarItem>
          <SidebarItem
            onClick={handleClearLibrary}
            className="text-red-600 hover:text-red-700"
          >
            <AlertTriangle size={16} />
            <span className="flex flex-col">
              <span>{t("sidebar.clearLibraryData")}</span>
              <span className="text-[10px] font-normal text-red-500/80">
                {t("sidebar.deletesAllItems")}
              </span>
            </span>
          </SidebarItem>
        </nav>

        <Panel title={t("sidebar.libraryHealth")}>
          <div className="pt-2">
            <div className="mb-2 flex items-baseline justify-between">
              <span className="text-[11px] font-medium text-app-ink-muted">
                {t("sidebar.healthScore")}
              </span>
              <span className="text-lg font-bold text-app-ink">
                {libraryHealth
                  ? `${Math.round(
                    (libraryHealth.complete / Math.max(1, libraryHealth.total)) * 100
                  )}%`
                  : "—"}
              </span>
            </div>

            {/* Progress Bar */}
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-[var(--app-border-muted)] mb-4 ring-1 ring-white/5">
              <div
                className="h-full bg-gradient-to-r from-app-accent to-app-accent-strong transition-all duration-700 ease-out shadow-[0_0_8px_rgba(234,88,12,0.3)]"
                style={{
                  width: libraryHealth
                    ? `${(libraryHealth.complete / Math.max(1, libraryHealth.total)) * 100}%`
                    : "0%",
                }}
              />
            </div>

            <div className="mb-3 flex items-center justify-between rounded-md border border-[var(--app-border-soft)] bg-app-bg/40 px-2.5 py-1.5">
              <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-app-ink-muted">
                {t("sidebar.totalBooks")}
              </span>
              <span className="text-sm font-bold text-app-ink">
                {libraryHealth ? libraryHealth.total : "—"}
              </span>
            </div>

            <div className="grid grid-cols-3 gap-1">
              <div className="flex flex-col items-center justify-center rounded-lg py-2 hover:bg-app-surface-hover transition-colors">
                <span className="text-app-ink-muted mb-1">
                  <Wrench size={12} strokeWidth={2.5} />
                </span>
                <span className="text-sm font-bold text-app-ink leading-none">
                  {libraryHealth ? libraryHealth.missing_isbn : "—"}
                </span>
                <span className="mt-1 text-[7px] font-bold text-app-ink-muted/80 uppercase tracking-tight text-center px-1">
                  {t("sidebar.noIsbn")}
                </span>
              </div>
              <div className="flex flex-col items-center justify-center rounded-lg py-2 hover:bg-app-surface-hover transition-colors border-x border-[var(--app-border-muted)]">
                <span className="text-app-ink-muted mb-1">
                  <ImageIcon size={12} strokeWidth={2.5} />
                </span>
                <span className="text-sm font-bold text-app-ink leading-none">
                  {libraryHealth ? libraryHealth.missing_cover : "—"}
                </span>
                <span className="mt-1 text-[7px] font-bold text-app-ink-muted/80 uppercase tracking-tight text-center px-1">
                  {t("sidebar.noCover")}
                </span>
              </div>
              <div className="flex flex-col items-center justify-center rounded-lg py-2 hover:bg-app-surface-hover transition-colors">
                <span className="text-app-ink-muted mb-1">
                  <Copy size={12} strokeWidth={2.5} />
                </span>
                <span className="text-sm font-bold text-app-ink leading-none">
                  {libraryHealth ? libraryHealth.duplicates : "—"}
                </span>
                <span className="mt-1 text-[7px] font-bold text-app-ink-muted/80 uppercase tracking-tight text-center px-1">
                  {t("sidebar.dupes")}
                </span>
              </div>
            </div>
          </div>
        </Panel>

      </div>
    </aside >
  );
}
