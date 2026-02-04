import { Button, Input } from "../components/ui";

type SettingsViewProps = {
  libraryRoot: string | null;
  onChooseRoot: () => Promise<void>;
};

export function SettingsView({ libraryRoot, onChooseRoot }: SettingsViewProps) {
  return (
    <section className="flex-1 px-6 py-6">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-app-ink">Settings</h1>
        <p className="text-sm text-app-ink-muted">Defaults used across the app.</p>
      </div>

      <div className="rounded-xl border border-app-border bg-white p-5 shadow-sm">
        <div className="flex flex-col gap-2">
          <label className="text-xs font-semibold uppercase tracking-wider text-app-ink-muted">Project Root</label>
          <div className="flex items-center gap-2">
            <Input value={libraryRoot ?? ""} readOnly placeholder="Choose a folder..." />
            <Button variant="outline" onClick={onChooseRoot}>
              Choose
            </Button>
          </div>
          <p className="text-xs text-app-ink-muted mt-1">
            Default base folder used by organizer and missing-file scans.
          </p>
        </div>
      </div>
    </section>
  );
}
