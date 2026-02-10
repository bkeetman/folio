import {
    Check,
    ChevronDown,
    Globe,
    Layers,
    Tag as TagIcon,
    Users,
    X
} from "lucide-react";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { PREDEFINED_BOOK_CATEGORIES } from "../../lib/categories";
import { LANGUAGE_OPTIONS } from "../../lib/languageFlags";
import { cn } from "../../lib/utils";
import type {
    BatchAuthorMode,
    BatchMetadataUpdatePayload,
    BatchTagMode,
    BookDisplay,
    Tag,
} from "../../types/library";
import { Button } from "../ui/Button";

type BatchOperationsBarProps = {
    filteredBooks: BookDisplay[];
    selectedBatchItemIds: Set<string>;
    onSetBatchSelection: (ids: string[]) => void;
    onClearBatchSelection: () => void;
    onApplyBatchMetadata: (payload: BatchMetadataUpdatePayload) => Promise<void>;
    tags: Tag[];
    onClose: () => void;
};

export function BatchOperationsBar({
    filteredBooks,
    selectedBatchItemIds,
    onSetBatchSelection,
    onClearBatchSelection,
    onApplyBatchMetadata,
    tags,
    onClose,
}: BatchOperationsBarProps) {
    const { t } = useTranslation();
    const selectedBatchCount = selectedBatchItemIds.size;
    const filteredBookIds = useMemo(() => filteredBooks.map((book) => book.id), [filteredBooks]);

    // Batch State
    const [batchApplying, setBatchApplying] = useState(false);
    const [batchCategories, setBatchCategories] = useState<string[]>([]);
    const [batchTagIds, setBatchTagIds] = useState<string[]>([]);

    // Advanced State (for Popovers/Expandable)
    const [showAdvanced, setShowAdvanced] = useState(false);
    const [batchAuthorInput, setBatchAuthorInput] = useState("");
    const [batchAuthorMode, setBatchAuthorMode] = useState<BatchAuthorMode>("append");
    const [batchLanguage, setBatchLanguage] = useState("");
    const [batchClearLanguage, setBatchClearLanguage] = useState(false);
    const [batchYearInput, setBatchYearInput] = useState("");
    const [batchClearPublishedYear, setBatchClearPublishedYear] = useState(false);
    const [batchTagMode] = useState<BatchTagMode>("append");
    const [batchClearTags] = useState(false);

    // Computed
    const availableBatchCategories = useMemo(
        () => PREDEFINED_BOOK_CATEGORIES.filter((c) => !batchCategories.includes(c)),
        [batchCategories]
    );

    const availableBatchTags = useMemo(
        () => tags.filter((t) => !batchTagIds.includes(t.id)),
        [batchTagIds, tags]
    );

    const parsedBatchYear = useMemo(() => {
        const trimmed = batchYearInput.trim();
        if (!trimmed) return { value: null as number | null, invalid: false };
        const parsed = parseInt(trimmed, 10);
        const maxYear = new Date().getFullYear() + 1;
        if (!Number.isFinite(parsed) || parsed < 1400 || parsed > maxYear) {
            return { value: null, invalid: true };
        }
        return { value: parsed, invalid: false };
    }, [batchYearInput]);

    const hasBatchDraft =
        batchCategories.length > 0 ||
        batchAuthorInput.trim().length > 0 ||
        batchClearLanguage ||
        batchLanguage.trim().length > 0 ||
        batchClearPublishedYear ||
        parsedBatchYear.value !== null ||
        batchClearTags ||
        batchTagIds.length > 0;

    const handleApplyBatch = async () => {
        if (batchApplying || selectedBatchCount === 0) return;
        if (!batchClearPublishedYear && parsedBatchYear.invalid) return;

        const parsedAuthors = batchAuthorInput
            .split(",")
            .map((v) => v.trim())
            .filter((v) => v.length > 0);

        const payload: BatchMetadataUpdatePayload = {
            itemIds: Array.from(selectedBatchItemIds),
        };

        if (batchCategories.length > 0) payload.genres = batchCategories;
        if (parsedAuthors.length > 0) {
            payload.authors = parsedAuthors;
            payload.authorMode = batchAuthorMode;
        }
        if (batchClearLanguage) payload.clearLanguage = true;
        else if (batchLanguage.trim()) payload.language = batchLanguage.trim();

        if (batchClearPublishedYear) payload.clearPublishedYear = true;
        else if (parsedBatchYear.value !== null) payload.publishedYear = parsedBatchYear.value;

        if (batchClearTags) payload.clearTags = true;
        else if (batchTagIds.length > 0) {
            payload.tagIds = batchTagIds;
            payload.tagMode = batchTagMode;
        }

        // Defensive check
        if (Object.keys(payload).length === 1) return;

        setBatchApplying(true);
        try {
            await onApplyBatchMetadata(payload);
            // Reset after success
            setBatchCategories([]);
            setBatchTagIds([]);
            setBatchAuthorInput("");
            setBatchLanguage("");
            setBatchYearInput("");
            setShowAdvanced(false);
            onClose(); // Optional: close panel on success
        } finally {
            setBatchApplying(false);
        }
    };

    return (
        <div className="flex flex-col rounded-lg border border-app-border bg-app-surface/90 shadow-lg backdrop-blur-md overflow-hidden transition-all duration-200">

            {/* Primary Bar */}
            <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3 p-3 border-b border-transparent">

                {/* Selection Status */}
                <div className="flex items-center gap-2 min-w-[140px]">
                    <div className="flex h-6 w-6 items-center justify-center rounded-full bg-app-accent/10 text-app-accent-strong">
                        <Check size={14} strokeWidth={3} />
                    </div>
                    <div className="flex flex-col">
                        <span className="text-[11px] font-bold text-app-ink leading-tight">
                            {selectedBatchCount} {t("library.selected")}
                        </span>
                        <div className="flex gap-2">
                            <button
                                onClick={() => onClearBatchSelection()}
                                className="text-[10px] text-app-ink-muted hover:text-app-ink hover:underline"
                            >
                                {t("library.clear")}
                            </button>
                            <button
                                onClick={() => onSetBatchSelection(filteredBookIds)}
                                className="text-[10px] text-app-ink-muted hover:text-app-ink hover:underline"
                            >
                                {t("library.selectAll")}
                            </button>
                        </div>
                    </div>
                </div>

                <div className="h-6 w-px bg-app-border/10 hidden sm:block mx-1" />

                {/* Quick Actions */}
                <div className="flex flex-wrap items-center gap-2 flex-1">

                    {/* Add Category */}
                    <div className="group relative inline-flex items-center">
                        <Layers size={14} className="absolute left-2 text-app-ink-muted" />
                        <select
                            className="h-8 rounded-md border border-app-border-soft bg-app-bg pl-7 pr-8 text-[11px] text-app-ink focus:border-app-accent focus:ring-1 focus:ring-app-accent outline-none appearance-none cursor-pointer hover:bg-app-surface-hover transition-colors min-w-[140px]"
                            onChange={(e) => {
                                if (e.target.value) {
                                    setBatchCategories(prev => [...prev, e.target.value]);
                                    e.target.value = "";
                                }
                            }}
                        >
                            <option value="">{t("library.batchAddCategory")}</option>
                            {availableBatchCategories.map(c => <option key={c} value={c}>{c}</option>)}
                        </select>
                        <ChevronDown size={12} className="absolute right-2 text-app-ink-muted pointer-events-none" />
                    </div>

                    {/* Add Tag */}
                    <div className="group relative inline-flex items-center">
                        <TagIcon size={14} className="absolute left-2 text-app-ink-muted" />
                        <select
                            className="h-8 rounded-md border border-app-border-soft bg-app-bg pl-7 pr-8 text-[11px] text-app-ink focus:border-app-accent focus:ring-1 focus:ring-app-accent outline-none appearance-none cursor-pointer hover:bg-app-surface-hover transition-colors min-w-[120px]"
                            onChange={(e) => {
                                if (e.target.value) {
                                    setBatchTagIds(prev => [...prev, e.target.value]);
                                    e.target.value = "";
                                }
                            }}
                        >
                            <option value="">{t("library.batchAddTag")}</option>
                            {availableBatchTags.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                        </select>
                        <ChevronDown size={12} className="absolute right-2 text-app-ink-muted pointer-events-none" />
                    </div>

                    <button
                        onClick={() => setShowAdvanced(!showAdvanced)}
                        className={cn(
                            "h-8 px-3 rounded-md text-[11px] font-medium border transition-colors flex items-center gap-1.5",
                            showAdvanced
                                ? "bg-app-accent/10 border-app-accent text-app-accent"
                                : "bg-transparent border-transparent text-app-ink-muted hover:bg-app-surface-hover hover:text-app-ink"
                        )}
                    >
                        {t("library.moreOptions")}
                        <ChevronDown size={12} className={cn("transition-transform", showAdvanced && "rotate-180")} />
                    </button>
                </div>

                {/* Action Buttons */}
                <div className="flex items-center gap-2 ml-auto">
                    {hasBatchDraft && (
                        <span className="text-[10px] text-app-ink-muted hidden sm:inline-block mr-1">
                            {t("library.unsavedChanges")}
                        </span>
                    )}
                    <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                            setBatchCategories([]);
                            setBatchTagIds([]);
                            setBatchAuthorInput("");
                            setShowAdvanced(false);
                            onClose();
                        }}
                    >
                        {t("library.cancel")}
                    </Button>
                    <Button
                        variant="primary"
                        size="sm"
                        disabled={!hasBatchDraft || selectedBatchCount === 0 || batchApplying}
                        onClick={() => void handleApplyBatch()}
                    >
                        {batchApplying ? t("library.saving") : t("library.apply")}
                    </Button>
                </div>
            </div>

            {/* Draft/Staged Changes Indicator */}
            {(batchCategories.length > 0 || batchTagIds.length > 0) && (
                <div className="flex flex-wrap gap-2 px-3 pb-3 pt-0 border-b border-transparent bg-app-bg/30">
                    {batchCategories.map(c => (
                        <span key={c} className="inline-flex items-center gap-1 rounded bg-[var(--app-surface)] pl-2 pr-1 py-0.5 text-[10px] font-medium text-app-ink border border-app-border-soft shadow-sm mt-2">
                            {c}
                            <button onClick={() => setBatchCategories(p => p.filter(x => x !== c))} className="p-0.5 hover:text-red-500"><X size={10} /></button>
                        </span>
                    ))}
                    {batchTagIds.map(tid => {
                        const tag = tags.find(t => t.id === tid);
                        if (!tag) return null;
                        return (
                            <span key={tid} className="inline-flex items-center gap-1 rounded bg-[var(--app-surface)] pl-2 pr-1 py-0.5 text-[10px] font-medium text-app-ink border border-app-border-soft shadow-sm mt-2">
                                <span className={cn("w-1.5 h-1.5 rounded-full", tag.color ? `bg-${tag.color}-500` : "bg-gray-400")} />
                                {tag.name}
                                <button onClick={() => setBatchTagIds(p => p.filter(x => x !== tid))} className="p-0.5 hover:text-red-500"><X size={10} /></button>
                            </span>
                        )
                    })}
                </div>
            )}

            {/* Advanced Panel */}
            {showAdvanced && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 p-4 bg-app-bg/50">

                    {/* Author Quick Edit */}
                    <div className="space-y-1.5">
                        <label className="flex items-center gap-1.5 text-[11px] font-semibold text-app-ink-muted uppercase tracking-wider">
                            <Users size={12} /> {t("library.batchAuthors")}
                        </label>
                        <div className="flex gap-2">
                            <input
                                value={batchAuthorInput}
                                onChange={(e) => setBatchAuthorInput(e.target.value)}
                                className="flex-1 h-8 rounded-md border border-app-border-soft bg-app-surface px-2.5 text-[11px] placeholder:text-app-ink-muted/50 focus:border-app-accent focus:ring-1 focus:ring-app-accent outline-none"
                                placeholder="Author One, Author Two"
                            />
                            <select
                                value={batchAuthorMode}
                                onChange={(e) => setBatchAuthorMode(e.target.value as BatchAuthorMode)}
                                className="h-8 rounded-md border border-app-border-soft bg-app-surface px-2 text-[10px] text-app-ink-muted focus:text-app-ink"
                            >
                                <option value="append">{t("library.append")}</option>
                                <option value="replace">{t("library.replace")}</option>
                            </select>
                        </div>
                    </div>

                    {/* Metadata (Year & Language)  */}
                    <div className="space-y-1.5">
                        <label className="flex items-center gap-1.5 text-[11px] font-semibold text-app-ink-muted uppercase tracking-wider">
                            <Globe size={12} /> {t("library.metadata")}
                        </label>
                        <div className="flex gap-2">
                            <div className="flex-1 relative">
                                <input
                                    type="number"
                                    value={batchYearInput}
                                    onChange={(e) => setBatchYearInput(e.target.value)}
                                    className={cn(
                                        "w-full h-8 rounded-md border border-app-border-soft bg-app-surface px-2.5 text-[11px] placeholder:text-app-ink-muted/50 focus:border-app-accent focus:ring-1 focus:ring-app-accent outline-none",
                                        batchClearPublishedYear && "opacity-50 pointer-events-none"
                                    )}
                                    placeholder="Year (e.g. 2024)"
                                />
                                <div className="absolute right-1 top-1/2 -translate-y-1/2">
                                    <label className="flex items-center gap-1 cursor-pointer" title={t("library.clearYear")}>
                                        <input type="checkbox" checked={batchClearPublishedYear} onChange={e => setBatchClearPublishedYear(e.target.checked)} className="w-3 h-3 rounded-sm border-app-border-muted accent-app-accent" />
                                    </label>
                                </div>
                            </div>

                            <div className="flex-1 relative">
                                <select
                                    value={batchLanguage}
                                    onChange={(e) => setBatchLanguage(e.target.value)}
                                    className={cn(
                                        "w-full h-8 rounded-md border border-app-border-soft bg-app-surface px-2 text-[11px] text-app-ink focus:border-app-accent focus:ring-1 focus:ring-app-accent outline-none",
                                        batchClearLanguage && "opacity-50 pointer-events-none"
                                    )}
                                >
                                    <option value="">{t("library.noLanguageChange")}</option>
                                    {LANGUAGE_OPTIONS.map(l => (
                                        <option key={l.code} value={l.code}>{l.name}</option>
                                    ))}
                                </select>
                                <div className="absolute right-6 top-1/2 -translate-y-1/2">
                                    <label className="flex items-center gap-1 cursor-pointer" title={t("library.clearLanguage")}>
                                        <input type="checkbox" checked={batchClearLanguage} onChange={e => setBatchClearLanguage(e.target.checked)} className="w-3 h-3 rounded-sm border-app-border-muted accent-app-accent" />
                                    </label>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
