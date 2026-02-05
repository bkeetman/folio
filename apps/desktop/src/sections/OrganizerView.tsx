
import { ArrowRight, FolderInput, Loader2 } from "lucide-react";
import type { Dispatch, SetStateAction } from "react";
import { Button, Input } from "../components/ui";
import type { OperationProgress, OrganizePlan, OrganizerLog } from "../types/library";

type OrganizerViewProps = {
    organizeMode: string;
    setOrganizeMode: Dispatch<SetStateAction<string>>;
    organizeRoot: string | null;
    organizeTemplate: string;
    setOrganizeTemplate: Dispatch<SetStateAction<string>>;
    organizePlan: OrganizePlan | null;
    handlePlanOrganize: () => void;
    handleApplyOrganize: () => void;
    handleQueueOrganize: () => void;
    organizeStatus: string | null;
    organizeProgress: OperationProgress | null;
    organizing: boolean;
    organizeLog: OrganizerLog | null;
};

export function OrganizerView({
    organizeMode,
    setOrganizeMode,
    organizeRoot,
    organizeTemplate,
    setOrganizeTemplate,
    organizePlan,
    handlePlanOrganize,
    handleApplyOrganize,
    handleQueueOrganize,
    organizeStatus,
    organizeProgress,
    organizing,
    organizeLog,
}: OrganizerViewProps) {
    const actionableEntries = organizePlan
        ? organizePlan.entries.filter((entry) => entry.action !== "skip")
        : [];
    const progressPercent = organizeProgress && organizeProgress.total > 0
        ? Math.min(100, Math.round((organizeProgress.current / organizeProgress.total) * 100))
        : 0;
    return (
        <div className="flex flex-col gap-6 p-6">
            <div className="flex flex-col gap-2">
                <h1 className="text-2xl font-bold text-app-ink">Organizer</h1>
                <p className="text-sm text-app-ink-muted max-w-2xl">
                    Automatically rename and move files based on their metadata. Use the template below to define your folder structure.
                </p>
            </div>

            <div className="flex flex-col gap-4 rounded-xl border border-app-border bg-white p-6 shadow-sm">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div className="flex flex-col gap-2">
                        <label className="text-xs font-semibold uppercase tracking-wider text-app-ink-muted">Operation Mode</label>
                        <div className="flex gap-2">
                            {(["reference", "copy", "move"] as const).map((mode) => (
                                <button
                                    key={mode}
                                    onClick={() => setOrganizeMode(mode)}
                                    className={`px-4 py-2 rounded-lg text-sm font-medium border transition-all ${organizeMode === mode
                                            ? "bg-app-accent text-white border-app-accent shadow-sm"
                                            : "bg-white text-app-ink border-app-border hover:border-app-accent/50"
                                        }`}
                                >
                                    {mode.charAt(0).toUpperCase() + mode.slice(1)}
                                </button>
                            ))}
                        </div>
                        <p className="text-xs text-app-ink-muted mt-1">
                            {organizeMode === "reference" && "Updates database paths only. files are not verified on disk"}
                            {organizeMode === "copy" && "Copies files to the new location. Originals remain untouched."}
                            {organizeMode === "move" && "Moves files to the new location. Originals are deleted."}
                        </p>
                    </div>

                    <div className="flex flex-col gap-2">
                        <label className="text-xs font-semibold uppercase tracking-wider text-app-ink-muted">Library Root</label>
                        <Input value={organizeRoot ?? ""} readOnly placeholder="Set in Settings" />
                        <p className="text-xs text-app-ink-muted mt-1">
                            Set the default root in Maintenance → Settings.
                        </p>
                    </div>

                    <div className="flex flex-col gap-2">
                        <label className="text-xs font-semibold uppercase tracking-wider text-app-ink-muted">Path Template</label>
                        <Input
                            className="font-mono text-sm"
                            value={organizeTemplate}
                            onChange={(e) => setOrganizeTemplate(e.target.value)}
                            placeholder="{Author}/{Title} ({Year}).{ext}"
                        />
                        <p className="text-xs text-app-ink-muted mt-1">
                            Available: <code className="bg-app-bg px-1 rounded">{`{Author}`}</code> <code className="bg-app-bg px-1 rounded">{`{Title}`}</code> <code className="bg-app-bg px-1 rounded">{`{Year}`}</code> <code className="bg-app-bg px-1 rounded">{`{ISBN}`}</code>
                        </p>
                    </div>
                </div>

                <div className="flex flex-wrap items-center gap-3 mt-2 border-t border-app-border pt-4">
                    {organizeStatus && (
                        <span className="flex items-center text-sm text-app-ink-muted">
                            {organizeStatus}
                        </span>
                    )}
                    {organizeProgress && (
                        <div className="flex items-center gap-2 text-xs text-app-ink-muted">
                            <div className="h-1.5 w-24 overflow-hidden rounded-full bg-app-border/40">
                                <div
                                    className="h-full rounded-full bg-app-accent transition-[width] duration-300 ease-out"
                                    style={{ width: `${progressPercent}%` }}
                                />
                            </div>
                            <span className="tabular-nums">
                                {organizeProgress.current}/{organizeProgress.total}
                            </span>
                        </div>
                    )}
                    <Button variant="outline" onClick={handlePlanOrganize} disabled={organizing}>
                        {organizing ? (
                            <span className="flex items-center gap-2">
                                <Loader2 size={14} className="animate-spin" />
                                Working...
                            </span>
                        ) : (
                            "Generate Preview"
                        )}
                    </Button>
                    <Button
                        variant="outline"
                        onClick={handleQueueOrganize}
                        disabled={actionableEntries.length === 0 || organizing}
                    >
                        Queue Changes
                    </Button>
                    <Button
                        variant="primary"
                        onClick={handleApplyOrganize}
                        disabled={actionableEntries.length === 0 || organizing}
                        className="min-w-[140px]"
                    >
                        {organizing ? (
                            <span className="flex items-center gap-2">
                                <Loader2 size={14} className="animate-spin" />
                                Applying...
                            </span>
                        ) : (
                            "Apply Changes"
                        )}
                    </Button>
                </div>
            </div>

            {organizeLog ? (
                <div className="rounded-xl border border-app-border bg-white p-4 shadow-sm">
                    <div className="flex items-center justify-between">
                        <div>
                            <div className="text-xs font-semibold uppercase tracking-wider text-app-ink-muted">
                                Last Run
                            </div>
                            <div className="text-sm text-app-ink">
                                {organizeLog.processed} applied, {organizeLog.errors} errors
                            </div>
                        </div>
                        <div className="text-[10px] text-app-ink-muted">
                            {new Date(organizeLog.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                        </div>
                    </div>
                    {organizeLog.errors > 0 ? (
                        <div className="mt-3 space-y-2">
                            {organizeLog.entries.filter((entry) => entry.error).slice(0, 5).map((entry, index) => (
                                <div key={`${entry.from}-${index}`} className="rounded-md border border-app-border/60 bg-app-bg/40 px-3 py-2 text-xs text-app-ink">
                                    <div className="font-medium">{entry.error}</div>
                                    <div className="text-[10px] text-app-ink-muted truncate">{entry.from}</div>
                                </div>
                            ))}
                        </div>
                    ) : (
                        <div className="mt-2 text-xs text-app-ink-muted">No errors reported.</div>
                    )}
                </div>
            ) : null}

            {organizePlan && actionableEntries.length > 0 ? (
                <div className="flex flex-col gap-4">
                    <div className="flex items-center justify-between">
                        <h2 className="text-lg font-semibold text-app-ink">Preview ({actionableEntries.length} items)</h2>
                    </div>

                    <div className="rounded-xl border border-app-border bg-white overflow-hidden shadow-sm">
                        <table className="w-full text-left text-sm table-fixed">
                            <thead className="bg-app-bg border-b border-app-border text-xs font-semibold uppercase text-app-ink-muted tracking-wider">
                                <tr>
                                    <th className="px-4 py-3 w-[45%]">Source</th>
                                    <th className="px-4 py-3 w-[10%] text-center"></th>
                                    <th className="px-4 py-3 w-[45%]">Target</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-app-border/40">
                                {actionableEntries.map((entry, i) => {
                                    const sourceParts = entry.source_path.split(/[/\\]/);
                                    const targetParts = entry.target_path.split(/[/\\]/);
                                    // Show last 2 parts (folder/file) for better context
                                    const sourceDisplay = sourceParts.slice(-2).join("/");
                                    const targetDisplay = targetParts.slice(-2).join("/");
                                    return (
                                        <tr key={i} className="hover:bg-app-bg/30">
                                            <td className="px-4 py-3" title={entry.source_path}>
                                                <div className="font-medium text-app-ink truncate">{sourceDisplay}</div>
                                                <div className="text-xs text-app-ink-muted/60 truncate">{entry.source_path}</div>
                                            </td>
                                            <td className="px-4 py-3 text-center text-app-ink-muted">
                                                <ArrowRight size={14} className="mx-auto" />
                                            </td>
                                            <td className="px-4 py-3" title={entry.target_path}>
                                                <div className="font-medium text-app-ink truncate">{targetDisplay}</div>
                                                <div className="text-xs text-app-ink-muted/60 truncate">{entry.target_path}</div>
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                </div>
            ) : organizePlan ? (
                <div className="flex flex-col items-center justify-center py-12 rounded-xl border border-dashed border-app-border bg-app-bg/30 text-app-ink-muted">
                    <FolderInput size={48} className="mb-4 opacity-20" />
                    <p>No changes needed based on current settings.</p>
                </div>
            ) : null}
        </div>
    );
}
