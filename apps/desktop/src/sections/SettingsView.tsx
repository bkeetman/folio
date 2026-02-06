import { Button, Input } from "../components/ui";
import type { ThemeMode } from "../hooks/useTheme";
import { useTranslation } from "react-i18next";
import { i18n } from "../i18n";

type SettingsViewProps = {
  libraryRoot: string | null;
  onChooseRoot: () => Promise<void>;
  onNormalizeDescriptions: () => Promise<void>;
  normalizingDescriptions: boolean;
  onBatchFixTitles: () => Promise<void>;
  batchFixingTitles: boolean;
  themeMode: ThemeMode;
  setThemeMode: (mode: ThemeMode) => void;
};

export function SettingsView({
  libraryRoot,
  onChooseRoot,
  onNormalizeDescriptions,
  normalizingDescriptions,
  onBatchFixTitles,
  batchFixingTitles,
  themeMode,
  setThemeMode,
}: SettingsViewProps) {
  const { t } = useTranslation();
  const isICloudPath =
    !!libraryRoot &&
    (libraryRoot.includes("com~apple~CloudDocs") ||
      libraryRoot.includes("Mobile Documents"));

  return (
    <section className="flex-1 px-6 py-6">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-app-ink">{t("settings.title")}</h1>
        <p className="text-sm text-app-ink-muted">{t("settings.subtitle")}</p>
      </div>

      <div className="mb-4 rounded-xl border border-app-border bg-white p-5 shadow-sm">
        <div className="grid gap-4 md:grid-cols-2">
          <div className="flex flex-col gap-2">
            <label className="text-xs font-semibold uppercase tracking-wider text-app-ink-muted">
              {t("settings.language")}
            </label>
            <div className="max-w-xs">
              <select
                value={i18n.resolvedLanguage?.startsWith("nl") ? "nl" : "en"}
                onChange={(event) => {
                  void i18n.changeLanguage(event.target.value);
                }}
                className="h-10 w-full rounded-md border border-app-border bg-white px-3 text-sm text-app-ink"
              >
                <option value="en">English</option>
                <option value="nl">Nederlands</option>
              </select>
            </div>
            <p className="text-xs text-app-ink-muted mt-1">{t("settings.languageHint")}</p>
          </div>
          <div className="flex flex-col gap-2">
            <label className="text-xs font-semibold uppercase tracking-wider text-app-ink-muted">
              {t("settings.theme")}
            </label>
            <div className="max-w-xs">
              <select
                value={themeMode}
                onChange={(event) => {
                  setThemeMode(event.target.value as ThemeMode);
                }}
                className="h-10 w-full rounded-md border border-app-border bg-white px-3 text-sm text-app-ink"
              >
                <option value="system">{t("settings.themeSystem")}</option>
                <option value="light">{t("settings.themeLight")}</option>
                <option value="dark">{t("settings.themeDark")}</option>
              </select>
            </div>
            <p className="text-xs text-app-ink-muted mt-1">{t("settings.themeHint")}</p>
          </div>
        </div>
      </div>

      <div className="rounded-xl border border-app-border bg-white p-5 shadow-sm">
        <div className="flex flex-col gap-2">
          <label className="text-xs font-semibold uppercase tracking-wider text-app-ink-muted">{t("settings.projectRoot")}</label>
          <div className="flex items-center gap-2">
            <Input value={libraryRoot ?? ""} readOnly placeholder={t("settings.chooseFolder")} />
            <Button variant="outline" onClick={onChooseRoot}>
              {t("settings.choose")}
            </Button>
          </div>
          <p className="text-xs text-app-ink-muted mt-1">
            {t("settings.rootHint")}
          </p>
          {isICloudPath && (
            <div className="mt-2 rounded-lg bg-[rgba(201,122,58,0.12)] px-3 py-2 text-xs text-[var(--app-accent-strong)]">
              <span className="font-semibold">{t("settings.icloudDetected")}</span>{" "}
              {t("settings.icloudWarning")}
            </div>
          )}
        </div>
      </div>

      <div className="mt-4 rounded-xl border border-app-border bg-white p-5 shadow-sm">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-xs font-semibold uppercase tracking-wider text-app-ink-muted">
              {t("settings.metadataCleanup")}
            </div>
            <p className="mt-1 text-xs text-app-ink-muted">
              {t("settings.metadataCleanupHint")}
            </p>
          </div>
          <Button
            variant="outline"
            onClick={() => void onNormalizeDescriptions()}
            disabled={normalizingDescriptions}
          >
            {normalizingDescriptions ? t("settings.cleaning") : t("settings.cleanDescriptions")}
          </Button>
        </div>
      </div>

      <div className="mt-4 rounded-xl border border-app-border bg-white p-5 shadow-sm">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-xs font-semibold uppercase tracking-wider text-app-ink-muted">
              {t("settings.titleBatchFix")}
            </div>
            <p className="mt-1 text-xs text-app-ink-muted">
              {t("settings.titleBatchFixHint")}
            </p>
          </div>
          <Button
            variant="outline"
            onClick={() => void onBatchFixTitles()}
            disabled={batchFixingTitles}
          >
            {batchFixingTitles ? t("settings.fixing") : t("settings.fixTitlesInBatch")}
          </Button>
        </div>
      </div>
    </section>
  );
}
