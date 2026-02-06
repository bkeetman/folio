import { Badge } from "../components/ui";

type StatusBarProps = {
  scanStatus: string | null;
  updateStatus: string | null;
  isDesktop: boolean;
  appVersion: string | null;
};

export function StatusBar({ scanStatus, updateStatus, isDesktop, appVersion }: StatusBarProps) {
  return (
    <footer className="mt-auto flex shrink-0 items-center justify-between rounded-md border border-[var(--app-border)] bg-white/70 px-3 py-2 text-[11px] text-[var(--app-ink-muted)]">
      <div className="flex items-center gap-2">
        <Badge variant="accent">Desktop</Badge>
        <span>{scanStatus ?? updateStatus ?? "Idle"}</span>
      </div>
      <div className="flex items-center gap-2">
        <span>
          Folio {isDesktop ? "Desktop" : "Web"}
          {appVersion ? ` · v${appVersion}` : ""}
        </span>
      </div>
    </footer>
  );
}
