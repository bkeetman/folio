import { Grip, List } from "lucide-react";
import type { Dispatch, SetStateAction } from "react";
import { useTranslation } from "react-i18next";
import { getTagColorClass } from "../../lib/tagColors";
import { cn } from "../../lib/utils";
import type { LibraryFilter, LibrarySort, Tag } from "../../types/library";

type LibraryToolbarProps = {
    libraryFilter: LibraryFilter;
    setLibraryFilter: Dispatch<SetStateAction<LibraryFilter>>;
    librarySort: LibrarySort;
    setLibrarySort: Dispatch<SetStateAction<LibrarySort>>;
    tags: Tag[];
    selectedTagIds: string[];
    setSelectedTagIds: Dispatch<SetStateAction<string[]>>;
    batchPanelOpen: boolean;
    setBatchPanelOpen: Dispatch<SetStateAction<boolean>>;
    selectedBatchCount: number;
    grid: boolean;
    setGrid: Dispatch<SetStateAction<boolean>>;
};

export function LibraryToolbar({
    libraryFilter,
    setLibraryFilter,
    librarySort,
    setLibrarySort,
    tags,
    selectedTagIds,
    setSelectedTagIds,
    batchPanelOpen,
    setBatchPanelOpen,
    selectedBatchCount,
    grid,
    setGrid,
}: LibraryToolbarProps) {
    const { t } = useTranslation();

    return (
        <div className="sticky top-0 z-10 flex flex-col gap-2 bg-app-bg/95 py-2 backdrop-blur-sm transition-all border-b border-transparent">
            <div className="flex items-center gap-2 px-1">

                {/* Layout Toggle */}
                <div className="flex h-8 items-center rounded-lg border border-[var(--app-border-muted)] bg-app-surface p-1">
                    <button
                        onClick={() => setGrid(true)}
                        className={cn(
                            "rounded p-1 transition-colors",
                            grid
                                ? "bg-app-ink/5 text-app-ink"
                                : "text-app-ink-muted hover:text-app-ink hover:bg-app-surface-hover"
                        )}
                        title={t("library.gridView")}
                    >
                        <Grip size={14} />
                    </button>
                    <button
                        onClick={() => setGrid(false)}
                        className={cn(
                            "rounded p-1 transition-colors",
                            !grid
                                ? "bg-app-ink/5 text-app-ink"
                                : "text-app-ink-muted hover:text-app-ink hover:bg-app-surface-hover"
                        )}
                        title={t("library.listView")}
                    >
                        <List size={14} />
                    </button>
                </div>

                <div className="mx-1 h-4 w-px bg-app-border/10" />

                {/* Format Filter Group */}
                <div className="flex h-8 items-center rounded-lg border border-[var(--app-border-muted)] bg-app-surface p-1">
                    <select
                        value={["all", "epub", "pdf", "mobi"].includes(libraryFilter) ? libraryFilter : "all"}
                        onChange={(e) => setLibraryFilter(e.target.value as LibraryFilter)}
                        className="h-full bg-transparent text-[11px] font-medium text-app-ink focus:outline-none cursor-pointer px-1"
                    >
                        <option value="all">{t("library.allFormats")}</option>
                        <option value="epub">{t("library.epub")}</option>
                        <option value="pdf">{t("library.pdf")}</option>
                        <option value="mobi">{t("library.mobi")}</option>
                    </select>
                </div>

                {/* Status Filter Group */}
                <div className="flex h-8 items-center rounded-lg border border-[var(--app-border-muted)] bg-app-surface p-1">
                    <select
                        value={["needs-metadata", "tagged", "categorized"].includes(libraryFilter) ? libraryFilter : "all"} // This logic is imperfect combined with above, but works for the discrete modes
                        onChange={(e) => {
                            if (e.target.value === "status-all") {
                                if (["needs-metadata", "tagged", "categorized"].includes(libraryFilter)) {
                                    setLibraryFilter("all");
                                }
                            } else {
                                setLibraryFilter(e.target.value as LibraryFilter)
                            }
                        }}
                        className={cn(
                            "h-full bg-transparent text-[11px] font-medium focus:outline-none cursor-pointer px-1",
                            ["needs-metadata", "tagged", "categorized"].includes(libraryFilter) ? "text-app-accent-strong" : "text-app-ink"
                        )}
                    >
                        <option value="status-all">{t("library.allStatus")}</option>
                        <option value="needs-metadata">{t("library.missingMetadata")}</option>
                        <option value="tagged">{t("library.tagged")}</option>
                        <option value="categorized">{t("library.categorized")}</option>
                    </select>
                </div>

                <div className="mx-1 h-4 w-px bg-app-border/10" />

                {/* Sort */}
                <div className="flex h-8 items-center gap-2 rounded-lg border border-[var(--app-border-muted)] bg-app-surface px-2">
                    <span className="text-[10px] font-semibold uppercase tracking-[0.2em] text-app-ink-muted hidden sm:inline-block">
                        {t("library.sort")}
                    </span>
                    <select
                        value={librarySort}
                        onChange={(event) => setLibrarySort(event.target.value as LibrarySort)}
                        className="h-7 bg-transparent text-[11px] text-app-ink focus:outline-none cursor-pointer min-w-[80px]"
                    >
                        <option value="default">{t("library.sortDefault")}</option>
                        <option value="title-asc">{t("library.sortTitleAsc")}</option>
                        <option value="title-desc">{t("library.sortTitleDesc")}</option>
                        <option value="author-asc">{t("library.sortAuthorAsc")}</option>
                        <option value="year-desc">{t("library.sortYearDesc")}</option>
                        <option value="year-asc">{t("library.sortYearAsc")}</option>
                        <option value="recent">{t("library.sortRecent")}</option>
                    </select>
                </div>

                {/* Batch Edit Toggle */}
                <button
                    type="button"
                    onClick={() => setBatchPanelOpen((current) => !current)}
                    className={cn(
                        "ml-auto inline-flex h-8 items-center gap-1.5 rounded-lg border px-3 text-[11px] font-medium transition-colors",
                        batchPanelOpen
                            ? "border-[var(--app-accent)] bg-app-accent/10 text-app-accent-strong"
                            : "border-[var(--app-border-soft)] bg-app-surface text-app-ink-muted hover:text-app-ink hover:border-[var(--app-border)]"
                    )}
                >
                    {t("library.batchEdit")}
                    {selectedBatchCount > 0 && (
                        <span className="flex h-4 min-w-[16px] items-center justify-center rounded-full bg-app-accent text-[9px] font-bold text-white px-1">
                            {selectedBatchCount}
                        </span>
                    )}
                </button>
            </div>

            {tags.length > 0 && (
                <div className="flex items-center gap-1.5 ml-1 overflow-x-auto no-scrollbar py-1 px-1">
                    <span className="text-[10px] uppercase font-bold tracking-wider text-app-ink-muted/50 select-none flex-none">
                        {t("sidebar.tags")}
                    </span>
                    <button
                        className={cn(
                            "flex h-6 items-center rounded-full border px-2.5 text-[10px] font-medium transition-colors flex-none",
                            selectedTagIds.length === 0
                                ? "border-app-ink/20 bg-app-ink/10 text-app-ink"
                                : "border-transparent text-app-ink-muted hover:bg-app-surface-hover"
                        )}
                        onClick={() => setSelectedTagIds([])}
                    >
                        {t("library.all")}
                    </button>
                    {tags.map((tag) => {
                        const active = selectedTagIds.includes(tag.id);
                        return (
                            <button
                                key={tag.id}
                                className={cn(
                                    "flex h-6 items-center rounded-full border text-[10px] font-medium px-2.5 transition-all flex-none",
                                    active
                                        ? getTagColorClass(tag.color)
                                        : "border-transparent bg-app-surface text-app-ink-muted hover:bg-app-surface-hover hover:text-app-ink"
                                )}
                                onClick={() => {
                                    setSelectedTagIds((prev) =>
                                        prev.includes(tag.id)
                                            ? prev.filter((id) => id !== tag.id)
                                            : [...prev, tag.id]
                                    );
                                }}
                            >
                                {tag.name}
                            </button>
                        );
                    })}
                </div>
            )}
        </div>
    );
}
