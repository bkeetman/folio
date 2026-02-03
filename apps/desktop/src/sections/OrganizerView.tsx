
import { ArrowRight, FolderInput } from "lucide-react";
import type { Dispatch, SetStateAction } from "react";
import { Button, Input } from "../components/ui";
import type { OrganizePlan } from "../types/library";

type OrganizerViewProps = {
    organizeMode: string;
    setOrganizeMode: Dispatch<SetStateAction<string>>;
    organizeTemplate: string;
    setOrganizeTemplate: Dispatch<SetStateAction<string>>;
    organizePlan: OrganizePlan | null;
    handleApplyOrganize: () => void;
    handleQueueOrganize: () => void;
    organizeStatus: string | null;
};

export function OrganizerView({
    organizeMode,
    setOrganizeMode,
    organizeTemplate,
    setOrganizeTemplate,
    organizePlan,
    handleApplyOrganize,
    handleQueueOrganize,
    organizeStatus,
}: OrganizerViewProps) {
    return (
        <div className="flex flex-col gap-6 p-6 mx-auto max-w-5xl">
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

                <div className="flex justify-end gap-3 mt-2 border-t border-app-border pt-4">
                    {organizeStatus && (
                        <span className="flex items-center text-sm font-medium text-emerald-600 mr-auto">
                            {organizeStatus}
                        </span>
                    )}
                    <Button variant="outline" onClick={handleQueueOrganize}>
                        Generate Preview
                    </Button>
                    <Button variant="primary" onClick={handleApplyOrganize} disabled={!organizePlan?.entries.length}>
                        Apply Changes
                    </Button>
                </div>
            </div>

            {organizePlan && organizePlan.entries.length > 0 ? (
                <div className="flex flex-col gap-4">
                    <div className="flex items-center justify-between">
                        <h2 className="text-lg font-semibold text-app-ink">Preview ({organizePlan.entries.length} items)</h2>
                    </div>

                    <div className="rounded-xl border border-app-border bg-white overflow-hidden shadow-sm">
                        <div className="overflow-x-auto">
                            <table className="w-full text-left text-sm">
                                <thead className="bg-app-bg border-b border-app-border text-xs font-semibold uppercase text-app-ink-muted tracking-wider">
                                    <tr>
                                        <th className="px-4 py-3 w-1/2">Source</th>
                                        <th className="px-4 py-3 w-6"></th>
                                        <th className="px-4 py-3 w-1/2">Target</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-app-border/40">
                                    {organizePlan.entries.map((entry, i) => (
                                        <tr key={i} className="hover:bg-app-bg/30">
                                            <td className="px-4 py-3 text-app-ink-muted truncate max-w-xs" title={entry.source_path}>
                                                {entry.source_path.split(/[/\\]/).pop()}
                                                <div className="text-[10px] text-app-ink-muted/60 truncate">{entry.source_path}</div>
                                            </td>
                                            <td className="px-4 py-3 text-center text-app-ink-muted">
                                                <ArrowRight size={14} className="mx-auto" />
                                            </td>
                                            <td className="px-4 py-3 font-medium text-app-ink truncate max-w-xs" title={entry.target_path}>
                                                {entry.target_path.split(/[/\\]/).pop()}
                                                <div className="text-[10px] text-app-ink-muted/60 truncate">{entry.target_path}</div>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
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
