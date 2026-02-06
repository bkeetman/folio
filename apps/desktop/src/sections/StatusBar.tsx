import { Badge } from "../components/ui";
import { useTranslation } from "react-i18next";

type StatusBarProps = {
  scanStatus: string | null;
  updateStatus: string | null;
  isDesktop: boolean;
  appVersion: string | null;
};

export function StatusBar({ scanStatus, updateStatus, isDesktop, appVersion }: StatusBarProps) {
  const { t } = useTranslation();
  return (
    <footer className="mt-auto flex shrink-0 items-center justify-between rounded-md border border-[var(--app-border)] bg-white/70 px-3 py-2 text-[11px] text-[var(--app-ink-muted)]">
      <div className="flex items-center gap-2">
        <Badge variant="accent">{t("statusBar.desktop")}</Badge>
        <span>{scanStatus ?? updateStatus ?? t("statusBar.idle")}</span>
      </div>
      <div className="flex items-center gap-2">
        <span>
          Folio {isDesktop ? t("statusBar.desktop") : t("statusBar.web")}
          {appVersion ? ` · v${appVersion}` : ""}
        </span>
      </div>
    </footer>
  );
}
