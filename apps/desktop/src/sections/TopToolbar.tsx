import type { Dispatch, SetStateAction } from "react";
import type { View } from "../types/library";
import { Badge, Button, Input } from "../components/ui";
import {
  Download,
  FolderOpen,
  LayoutGrid,
  List,
  Search,
  Sparkles,
} from "lucide-react";

type TopToolbarProps = {
  view: View;
  scanning: boolean;
  handleScan: () => void;
  handlePlanOrganize: () => void;
  setView: Dispatch<SetStateAction<View>>;
  checkForUpdates: (silent: boolean) => void;
  query: string;
  setQuery: Dispatch<SetStateAction<string>>;
  grid: boolean;
  setGrid: Dispatch<SetStateAction<boolean>>;
  libraryReady: boolean;
  updateStatus: string | null;
};

export function TopToolbar({
  view,
  scanning,
  handleScan,
  handlePlanOrganize,
  setView,
  checkForUpdates,
  query,
  setQuery,
  grid,
  setGrid,
  libraryReady,
  updateStatus,
}: TopToolbarProps) {
  return (
    <>
      <header className="flex items-center justify-between gap-6 border-b border-[var(--app-border)] pb-3">
        <div className="space-y-1">
          <div className="text-lg font-semibold">
            {view === "library" && "Your Library"}
            {view === "inbox" && "Inbox"}
            {view === "duplicates" && "Duplicates"}
            {view === "fix" && "Fix Metadata"}
            {view === "changes" && "File Changes"}
          </div>
          <p className="text-[11px] text-[var(--app-ink-muted)]">
            {view === "library" && "Browse and shape your calm stack."}
            {view === "inbox" && "New or incomplete entries waiting on you."}
            {view === "duplicates" && "Resolve duplicates detected by hash."}
            {view === "fix" && "Choose the best metadata match."}
            {view === "changes" && "Review and apply planned file updates."}
          </p>
        </div>

        <div className="flex flex-wrap items-center justify-end gap-3">
          <div className="flex items-center gap-1 rounded-md border border-[var(--app-border)] bg-[var(--app-panel)] p-1 shadow-soft">
            <Button variant="toolbar" size="sm" className="hover:bg-white" onClick={handleScan} disabled={scanning}>
              <FolderOpen size={14} />
              {scanning ? "Scanning" : "Scan"}
            </Button>
            <Button variant="toolbar" size="sm" className="hover:bg-white" onClick={handlePlanOrganize}>
              <LayoutGrid size={14} />
              Organize
            </Button>
            <Button variant="toolbar" size="sm" className="hover:bg-white" onClick={() => setView("fix")}>
              <Sparkles size={14} />
              Enrich
            </Button>
            <Button variant="toolbar" size="sm" className="hover:bg-white" onClick={() => checkForUpdates(false)}>
              <Download size={14} />
              Update
            </Button>
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
