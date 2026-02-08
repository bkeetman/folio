import { Button, Input } from "../components/ui";
import type { ThemeMode } from "../hooks/useTheme";
import { useTranslation } from "react-i18next";
import { APP_LANGUAGE_OPTIONS, i18n } from "../i18n";
import type { MetadataSourceSetting } from "../types/library";

type SettingsViewProps = {
  libraryRoot: string | null;
  onChooseRoot: () => Promise<void>;
  onNormalizeDescriptions: () => Promise<void>;
  normalizingDescriptions: boolean;
  onBatchFixTitles: () => Promise<void>;
  batchFixingTitles: boolean;
  metadataSources: MetadataSourceSetting[];
  onSetMetadataSourceEnabled: (id: string, enabled: boolean) => Promise<void>;
  metadataSourcesSaving: boolean;
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
  metadataSources,
  onSetMetadataSourceEnabled,
  metadataSourcesSaving,
  themeMode,
  setThemeMode,
}: SettingsViewProps) {
  const { t } = useTranslation();
  const selectedLanguage = (i18n.resolvedLanguage ?? i18n.language ?? "en").toLowerCase().split("-")[0];
  const currentLanguage =
    APP_LANGUAGE_OPTIONS.some((option) => option.code === selectedLanguage) ? selectedLanguage : "en";
  const isICloudPath =
    !!libraryRoot &&
    (libraryRoot.includes("com~apple~CloudDocs") ||
      libraryRoot.includes("Mobile Documents"));

  const sourceStrengthLabel = (sourceId: string) => {
    switch (sourceId) {
      case "open-library":
        return t("settings.metadataSourceOpenLibraryStrength");
      case "google-books":
        return t("settings.metadataSourceGoogleStrength");
      case "apple-books":
        return t("settings.metadataSourceAppleStrength");
      case "isfdb":
        return t("settings.metadataSourceIsfdbStrength");
      case "internet-archive":
        return t("settings.metadataSourceArchiveStrength");
      case "openbd":
        return t("settings.metadataSourceOpenbdStrength");
      default:
        return t("settings.metadataSourceGenericStrength");
    }
  };

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
                value={currentLanguage}
                onChange={(event) => {
                  void i18n.changeLanguage(event.target.value);
                }}
                className="h-10 w-full rounded-md border border-app-border bg-white px-3 text-sm text-app-ink"
              >
                {APP_LANGUAGE_OPTIONS.map((option) => (
                  <option key={option.code} value={option.code}>
                    {option.label}
                  </option>
                ))}
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
        <div className="mb-3">
          <div className="text-xs font-semibold uppercase tracking-wider text-app-ink-muted">
            {t("settings.metadataSources")}
          </div>
          <p className="mt-1 text-xs text-app-ink-muted">{t("settings.metadataSourcesHint")}</p>
        </div>
        <div className="space-y-3">
          {metadataSources.map((source) => (
            <label
              key={source.id}
              className="flex items-start justify-between gap-3 rounded-lg border border-app-border px-3 py-2"
            >
              <div className="min-w-0">
                <div className="text-sm font-medium text-app-ink">{source.label}</div>
                <div className="text-xs text-app-ink-muted">{sourceStrengthLabel(source.id)}</div>
                {source.endpoint ? (
                  <div className="truncate text-xs text-app-ink-muted">{source.endpoint}</div>
                ) : null}
              </div>
              <input
                type="checkbox"
                className="mt-1 h-4 w-4 accent-[var(--app-accent)]"
                checked={source.enabled}
                onChange={(event) => {
                  void onSetMetadataSourceEnabled(source.id, event.target.checked);
                }}
                disabled={metadataSourcesSaving}
              />
            </label>
          ))}
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
