import {
    Check,
    ChevronDown,
    Globe,
    Layers,
    Tag as TagIcon,
    Users,
    X
} from "lucide-react";
import type { KeyboardEvent as ReactKeyboardEvent } from "react";
import { useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useAuthorSuggestions } from "../../hooks/useAuthorSuggestions";
import { PREDEFINED_BOOK_CATEGORIES } from "../../lib/categories";
import { LANGUAGE_OPTIONS } from "../../lib/languageFlags";
import { cn } from "../../lib/utils";
import type {
    AuthorSuggestion,
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
    onRemoveSelectedBooks: (itemIds: string[]) => Promise<boolean>;
    tags: Tag[];
    isDesktop: boolean;
    onClose: () => void;
};

function parseAuthorsInput(value: string): string[] {
    return value
        .split(",")
        .map((entry) => entry.trim())
        .filter(Boolean);
}

export function BatchOperationsBar({
    filteredBooks,
    selectedBatchItemIds,
    onSetBatchSelection,
    onClearBatchSelection,
    onApplyBatchMetadata,
    onRemoveSelectedBooks,
    tags,
    isDesktop,
    onClose,
}: BatchOperationsBarProps) {
    const { t } = useTranslation();
    const selectedBatchCount = selectedBatchItemIds.size;
    const filteredBookIds = useMemo(() => filteredBooks.map((book) => book.id), [filteredBooks]);

    // Batch State
    const [batchApplying, setBatchApplying] = useState(false);
    const [batchRemoving, setBatchRemoving] = useState(false);
    const [batchCategories, setBatchCategories] = useState<string[]>([]);
    const [batchTagIds, setBatchTagIds] = useState<string[]>([]);

    // Advanced State (for Popovers/Expandable)
    const [showAdvanced, setShowAdvanced] = useState(false);
    const [batchAuthorInput, setBatchAuthorInput] = useState("");
    const [batchAuthorMode, setBatchAuthorMode] = useState<BatchAuthorMode>("append");
    const [authorsFocused, setAuthorsFocused] = useState(false);
    const [batchLanguage, setBatchLanguage] = useState("");
    const [batchClearLanguage, setBatchClearLanguage] = useState(false);
    const [batchSeries, setBatchSeries] = useState("");
    const [batchClearSeries, setBatchClearSeries] = useState(false);
    const [batchSeriesIndexInput, setBatchSeriesIndexInput] = useState("");
    const [batchClearSeriesIndex, setBatchClearSeriesIndex] = useState(false);
    const [batchYearInput, setBatchYearInput] = useState("");
    const [batchClearPublishedYear, setBatchClearPublishedYear] = useState(false);
    const [batchTagMode, setBatchTagMode] = useState<BatchTagMode>("append");
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
    const parsedBatchAuthors = useMemo(() => parseAuthorsInput(batchAuthorInput), [batchAuthorInput]);

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

    const parsedBatchSeriesIndex = useMemo(() => {
        const trimmed = batchSeriesIndexInput.trim();
        if (!trimmed) return { value: null as number | null, invalid: false };
        const parsed = Number.parseFloat(trimmed);
        if (!Number.isFinite(parsed) || parsed <= 0 || parsed > 9999) {
            return { value: null, invalid: true };
        }
        return { value: parsed, invalid: false };
    }, [batchSeriesIndexInput]);

    const authorLookupQuery = useMemo(() => {
        const parts = batchAuthorInput.split(",");
        return parts.at(-1)?.trim() ?? "";
    }, [batchAuthorInput]);

    const {
        suggestions: authorSuggestions,
        loading: authorSuggestionsLoading,
        activeIndex: activeAuthorSuggestionIndex,
        setActiveIndex: setActiveAuthorSuggestionIndex,
        listRef: authorSuggestionsListRef,
        showSuggestions: showAuthorSuggestions,
        clearSuggestions: clearAuthorSuggestions,
        handleKeyDown: handleAuthorSuggestionsKeyDown,
    } = useAuthorSuggestions({
        isDesktop,
        enabled: showAdvanced && authorsFocused,
        query: authorLookupQuery,
    });

    const handleAuthorInputChange = useCallback((value: string) => {
        setBatchAuthorInput(value);
        setActiveAuthorSuggestionIndex(-1);
    }, [setActiveAuthorSuggestionIndex]);

    const handleApplyAuthorSuggestion = useCallback((suggestion: AuthorSuggestion) => {
        const parts = batchAuthorInput.split(",");
        if (parts.length === 0) {
            parts.push(suggestion.name);
        } else {
            parts[parts.length - 1] = suggestion.name;
        }
        const parsed = parseAuthorsInput(parts.join(","));
        setBatchAuthorInput(parsed.length ? `${parsed.join(", ")}, ` : "");
        clearAuthorSuggestions();
    }, [batchAuthorInput, clearAuthorSuggestions]);

    const handleAuthorInputKeyDown = useCallback((event: ReactKeyboardEvent<HTMLInputElement>) => {
        handleAuthorSuggestionsKeyDown(event, handleApplyAuthorSuggestion);
    }, [handleApplyAuthorSuggestion, handleAuthorSuggestionsKeyDown]);

    const draftFieldCount = useMemo(() => {
        let count = 0;
        if (batchCategories.length > 0) count += 1;
        if (parsedBatchAuthors.length > 0) count += 1;
        if (batchClearLanguage || batchLanguage.trim().length > 0) count += 1;
        if (batchClearSeries || batchSeries.trim().length > 0) count += 1;
        if (batchClearSeriesIndex || parsedBatchSeriesIndex.value !== null) count += 1;
        if (batchClearPublishedYear || parsedBatchYear.value !== null) count += 1;
        if (batchClearTags || batchTagIds.length > 0) count += 1;
        return count;
    }, [
        batchCategories.length,
        parsedBatchAuthors.length,
        batchClearLanguage,
        batchLanguage,
        batchClearSeries,
        batchSeries,
        batchClearSeriesIndex,
        parsedBatchSeriesIndex.value,
        batchClearPublishedYear,
        parsedBatchYear.value,
        batchClearTags,
        batchTagIds.length,
    ]);

    const hasBatchDraft = draftFieldCount > 0;
    const hasFilteredBooks = filteredBookIds.length > 0;
    const allFilteredSelected = useMemo(() => {
        if (!hasFilteredBooks || selectedBatchCount !== filteredBookIds.length) return false;
        return filteredBookIds.every((id) => selectedBatchItemIds.has(id));
    }, [filteredBookIds, hasFilteredBooks, selectedBatchCount, selectedBatchItemIds]);

    const resetBatchDraft = useCallback(() => {
        setBatchCategories([]);
        setBatchTagIds([]);
        setBatchAuthorInput("");
        clearAuthorSuggestions();
        setAuthorsFocused(false);
        setBatchLanguage("");
        setBatchSeries("");
        setBatchSeriesIndexInput("");
        setBatchYearInput("");
        setBatchTagMode("append");
        setShowAdvanced(false);
    }, [clearAuthorSuggestions]);

    const handleApplyBatch = async () => {
        if (batchApplying || batchRemoving || selectedBatchCount === 0) return;
        if (!batchClearPublishedYear && parsedBatchYear.invalid) return;
        if (!batchClearSeriesIndex && parsedBatchSeriesIndex.invalid) return;

        const payload: BatchMetadataUpdatePayload = {
            itemIds: Array.from(selectedBatchItemIds),
        };

        if (batchCategories.length > 0) payload.genres = batchCategories;
        if (parsedBatchAuthors.length > 0) {
            payload.authors = parsedBatchAuthors;
            payload.authorMode = batchAuthorMode;
        }
        if (batchClearLanguage) payload.clearLanguage = true;
        else if (batchLanguage.trim()) payload.language = batchLanguage.trim();

        if (batchClearSeries) payload.clearSeries = true;
        else if (batchSeries.trim()) payload.series = batchSeries.trim();

        if (batchClearSeriesIndex) payload.clearSeriesIndex = true;
        else if (parsedBatchSeriesIndex.value !== null) {
            payload.seriesIndex = parsedBatchSeriesIndex.value;
        }

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
            resetBatchDraft();
            onClose(); // Optional: close panel on success
        } finally {
            setBatchApplying(false);
        }
    };

    const handleRemoveSelected = async () => {
        if (batchApplying || batchRemoving || selectedBatchCount === 0) return;
        setBatchRemoving(true);
        try {
            const removed = await onRemoveSelectedBooks(Array.from(selectedBatchItemIds));
            if (removed) {
                onClose();
            }
        } finally {
            setBatchRemoving(false);
        }
    };

    return (
        <div
            className={cn(
                "flex flex-col rounded-lg border border-app-border bg-app-surface/90 shadow-lg backdrop-blur-md transition-all duration-200",
                showAuthorSuggestions ? "overflow-visible" : "overflow-hidden",
            )}
        >

            {/* Primary Bar */}
            <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3 p-3 border-b border-transparent">

                {/* Selection Status */}
                <div className="flex items-center gap-2 min-w-[220px]">
                    <div className="flex h-6 w-6 items-center justify-center rounded-full bg-app-accent/10 text-app-accent-strong">
                        <Check size={14} strokeWidth={3} />
                    </div>
                    <div className="flex flex-col gap-1">
                        <span className="text-[11px] font-bold text-app-ink leading-tight">
                            {t("library.batchSelectedCount", { count: selectedBatchCount })}
                        </span>
                        <div className="flex items-center gap-1.5">
                            <button
                                onClick={() => onClearBatchSelection()}
                                disabled={selectedBatchCount === 0 || batchApplying || batchRemoving}
                                className="h-6 rounded-md px-2 text-[10px] text-app-ink-muted transition-colors hover:bg-app-surface-hover hover:text-app-ink disabled:cursor-not-allowed disabled:opacity-50"
                            >
                                {t("library.batchClearSelection")}
                            </button>
                            <button
                                onClick={() => onSetBatchSelection(filteredBookIds)}
                                disabled={!hasFilteredBooks || allFilteredSelected || batchApplying || batchRemoving}
                                className="h-6 rounded-md border border-app-border-soft bg-app-bg px-2 text-[10px] font-medium text-app-ink transition-colors hover:bg-app-surface-hover disabled:cursor-not-allowed disabled:opacity-50"
                            >
                                {t("library.batchSelectFiltered", { count: filteredBookIds.length })}
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

                    <div className="group relative inline-flex items-center">
                        <select
                            value={batchTagMode}
                            onChange={(e) => setBatchTagMode(e.target.value as BatchTagMode)}
                            className="h-8 rounded-md border border-app-border-soft bg-app-bg px-2 pr-8 text-[11px] text-app-ink focus:border-app-accent focus:ring-1 focus:ring-app-accent outline-none appearance-none cursor-pointer hover:bg-app-surface-hover transition-colors min-w-[92px]"
                        >
                            <option value="append">{t("library.batchTagModeAppend")}</option>
                            <option value="replace">{t("library.batchTagModeReplace")}</option>
                            <option value="remove">{t("library.batchTagModeRemove")}</option>
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
                <div className="ml-auto flex w-full flex-col gap-1 sm:w-auto sm:items-end">
                    {hasBatchDraft && (
                        <span className="text-[11px] text-app-ink-muted sm:text-[10px]">
                            {t("library.batchPreview", {
                                count: selectedBatchCount,
                                changes: draftFieldCount,
                            })}
                        </span>
                    )}
                    <div className="flex w-full items-center justify-end gap-2 sm:w-auto">
                        <Button
                            variant="danger"
                            size="sm"
                            disabled={selectedBatchCount === 0 || batchApplying || batchRemoving}
                            onClick={() => void handleRemoveSelected()}
                        >
                            {batchRemoving ? "Removing..." : t("changes.removeSelected")}
                        </Button>
                        <Button
                            variant="ghost"
                            size="sm"
                            disabled={batchApplying || batchRemoving}
                            onClick={() => {
                                resetBatchDraft();
                                onClose();
                            }}
                        >
                            {t("library.cancel")}
                        </Button>
                        <Button
                            variant="primary"
                            size="sm"
                            disabled={
                                !hasBatchDraft ||
                                selectedBatchCount === 0 ||
                                batchApplying ||
                                batchRemoving
                            }
                            onClick={() => void handleApplyBatch()}
                        >
                            {batchApplying ? t("library.saving") : t("library.apply")}
                        </Button>
                    </div>
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
                            <div className="relative flex-1">
                                <input
                                    value={batchAuthorInput}
                                    onFocus={() => setAuthorsFocused(true)}
                                    onBlur={() => {
                                        window.setTimeout(() => {
                                            setAuthorsFocused(false);
                                        }, 120);
                                    }}
                                    onChange={(e) => handleAuthorInputChange(e.target.value)}
                                    onKeyDown={handleAuthorInputKeyDown}
                                    className="h-8 w-full rounded-md border border-app-border-soft bg-app-surface px-2.5 text-[11px] placeholder:text-app-ink-muted/50 focus:border-app-accent focus:ring-1 focus:ring-app-accent outline-none"
                                    placeholder="Author One, Author Two"
                                />
                                {showAuthorSuggestions && (
                                    <div
                                        ref={authorSuggestionsListRef}
                                        className="absolute z-20 mt-1 max-h-52 w-full overflow-y-auto rounded-md border border-[var(--app-border-soft)] bg-app-surface shadow-lg"
                                    >
                                        {authorSuggestionsLoading ? (
                                            <div className="px-3 py-2 text-xs text-app-ink-muted">{t("common.loading")}</div>
                                        ) : (
                                            authorSuggestions.map((suggestion, suggestionIndex) => (
                                                <button
                                                    key={suggestion.id}
                                                    type="button"
                                                    data-suggestion-index={suggestionIndex}
                                                    className={`flex w-full items-center justify-between border-l-2 px-3 py-2 text-left text-xs text-app-ink transition-colors ${
                                                        suggestionIndex === activeAuthorSuggestionIndex
                                                            ? "border-[var(--app-accent)] bg-[rgba(249,115,22,0.12)]"
                                                            : "border-transparent hover:bg-app-surface-hover"
                                                    }`}
                                                    aria-selected={suggestionIndex === activeAuthorSuggestionIndex}
                                                    onMouseDown={(event) => {
                                                        event.preventDefault();
                                                        handleApplyAuthorSuggestion(suggestion);
                                                    }}
                                                    onMouseEnter={() => setActiveAuthorSuggestionIndex(suggestionIndex)}
                                                >
                                                    <span className="truncate">{suggestion.name}</span>
                                                    <span className="ml-3 shrink-0 text-[10px] text-app-ink-muted">
                                                        {suggestion.bookCount}
                                                    </span>
                                                </button>
                                            ))
                                        )}
                                    </div>
                                )}
                            </div>
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

                        <div className="flex gap-2">
                            <div className="flex-1 relative">
                                <input
                                    type="text"
                                    value={batchSeries}
                                    onChange={(e) => setBatchSeries(e.target.value)}
                                    className={cn(
                                        "w-full h-8 rounded-md border border-app-border-soft bg-app-surface px-2.5 text-[11px] placeholder:text-app-ink-muted/50 focus:border-app-accent focus:ring-1 focus:ring-app-accent outline-none",
                                        batchClearSeries && "opacity-50 pointer-events-none"
                                    )}
                                    placeholder="Series name"
                                />
                                <div className="absolute right-1 top-1/2 -translate-y-1/2">
                                    <label className="flex items-center gap-1 cursor-pointer" title="Clear series">
                                        <input
                                            type="checkbox"
                                            checked={batchClearSeries}
                                            onChange={e => setBatchClearSeries(e.target.checked)}
                                            className="w-3 h-3 rounded-sm border-app-border-muted accent-app-accent"
                                        />
                                    </label>
                                </div>
                            </div>

                            <div className="flex-1 relative">
                                <input
                                    type="number"
                                    step="0.1"
                                    min="0.1"
                                    value={batchSeriesIndexInput}
                                    onChange={(e) => setBatchSeriesIndexInput(e.target.value)}
                                    className={cn(
                                        "w-full h-8 rounded-md border border-app-border-soft bg-app-surface px-2.5 text-[11px] placeholder:text-app-ink-muted/50 focus:border-app-accent focus:ring-1 focus:ring-app-accent outline-none",
                                        batchClearSeriesIndex && "opacity-50 pointer-events-none",
                                        !batchClearSeriesIndex && parsedBatchSeriesIndex.invalid && "border-red-500/70"
                                    )}
                                    placeholder="Series # (e.g. 1)"
                                />
                                <div className="absolute right-1 top-1/2 -translate-y-1/2">
                                    <label className="flex items-center gap-1 cursor-pointer" title="Clear series number">
                                        <input
                                            type="checkbox"
                                            checked={batchClearSeriesIndex}
                                            onChange={e => setBatchClearSeriesIndex(e.target.checked)}
                                            className="w-3 h-3 rounded-sm border-app-border-muted accent-app-accent"
                                        />
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
