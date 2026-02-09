import { Check, FileText } from "lucide-react";
import { memo } from "react";
import { getLanguageFlag } from "../lib/languageFlags";
import { getTagColorClass } from "../lib/tagColors";
import { cn } from "../lib/utils"; // Assuming you have a utils file, if not I will handle inline
import type { BookDisplay } from "../types/library";
import { ProcessingOverlay } from "./ProgressBar";

type BookCardProps = {
    book: BookDisplay;
    selected: boolean;
    selectedForBatch: boolean;
    onSelect: (id: string) => void;
    onToggleBatchSelect: (id: string) => void;
    fetchCoverOverride: (id: string) => void;
    clearCoverOverride: (id: string) => void;
    viewMode?: "grid" | "list";
    isEnriching?: boolean;
};

function BookCardComponent({
    book,
    selected,
    selectedForBatch,
    onSelect,
    onToggleBatchSelect,
    fetchCoverOverride,
    clearCoverOverride,
    viewMode = "grid",
    isEnriching = false,
}: BookCardProps) {
    const languageFlag = getLanguageFlag(book.language);

    if (viewMode === "list") {
        return (
            <div
                className={cn(
                    "group grid cursor-pointer grid-cols-[56px_2fr_1.5fr_0.6fr_0.8fr] gap-4 border-b border-app-border px-4 py-3 transition-colors last:border-0",
                    selected
                        ? "bg-app-accent/10"
                        : selectedForBatch
                            ? "bg-app-accent/5 hover:bg-app-accent/10"
                        : "hover:bg-app-surface-hover bg-transparent"
                )}
                onClick={(event) => {
                    if (event.metaKey || event.ctrlKey) {
                        onToggleBatchSelect(book.id);
                        return;
                    }
                    onSelect(book.id);
                }}
                role="button"
                tabIndex={0}
                onKeyDown={(event) => {
                    if (event.key === "Enter") onSelect(book.id);
                    if (event.key === " ") {
                        event.preventDefault();
                        onToggleBatchSelect(book.id);
                    }
                }}
            >
                {/* Thumbnail */}
                <div className="relative grid h-14 w-10 shrink-0 place-items-center overflow-hidden rounded border border-app-border bg-app-bg shadow-sm">
                    <button
                        type="button"
                        aria-label={selectedForBatch ? "Remove from selection" : "Add to selection"}
                        className={cn(
                            "absolute left-1 top-1 z-10 grid h-4 w-4 place-items-center rounded border text-[var(--app-ink)] transition",
                            selectedForBatch
                                ? "border-[var(--app-accent)] bg-[var(--app-accent)] text-white"
                                : "border-[var(--app-border-soft)] bg-black/45 text-transparent hover:border-[var(--app-accent)]"
                        )}
                        onClick={(event) => {
                            event.preventDefault();
                            event.stopPropagation();
                            onToggleBatchSelect(book.id);
                        }}
                    >
                        <Check
                            size={10}
                            className={cn(
                                selectedForBatch
                                    ? "opacity-100"
                                    : "opacity-0 group-hover:opacity-60"
                            )}
                        />
                    </button>
                    {book.cover ? (
                        <img
                            className="h-full w-full object-cover"
                            src={book.cover}
                            alt=""
                            onError={() => {
                                clearCoverOverride(book.id);
                                fetchCoverOverride(book.id);
                            }}
                        />
                    ) : (
                        <FileText size={16} className="text-app-ink-muted/40" />
                    )}
                    <ProcessingOverlay isProcessing={isEnriching} size={14} variant="purple" />
                </div>

                {/* Title & Tags */}
                <div className="flex flex-col justify-center gap-0.5 min-w-0">
                    <div className="truncate text-sm font-medium text-app-ink">
                        {book.title}
                    </div>
                    {book.series && (
                        <div className="truncate text-[10px] text-app-ink-muted leading-tight">
                            {book.series}{book.seriesIndex ? ` #${book.seriesIndex}` : ""}
                        </div>
                    )}
                    {(book.genres ?? []).length > 0 && (
                        <div className="flex flex-wrap gap-1 mt-0.5">
                            {(book.genres ?? []).slice(0, 2).map((genre) => (
                                <span
                                    key={`${book.id}-${genre}`}
                                    className="inline-flex items-center rounded-full border border-[var(--app-border-soft)] bg-app-bg/40 px-1.5 py-0.5 text-[9px] text-app-ink-muted"
                                >
                                    {genre}
                                </span>
                            ))}
                        </div>
                    )}
                    {(book.tags ?? []).length > 0 && (
                        <div className="flex flex-wrap gap-1 mt-0.5">
                            {(book.tags ?? []).slice(0, 3).map((tag) => (
                                <span
                                    key={tag.id}
                                    className={`inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-medium leading-none ${getTagColorClass(tag.color)}`}
                                >
                                    {tag.name}
                                </span>
                            ))}
                        </div>
                    )}
                </div>

                {/* Author */}
                <div className="flex items-center text-sm text-app-ink-muted truncate">
                    {book.author}
                </div>

                {/* Year */}
                <div className="flex items-center text-sm tabular-nums text-app-ink-muted">
                    {book.year}
                </div>

                {/* Format / Meta */}
                <div className="flex items-center gap-2">
                    <span className="rounded border border-[var(--app-border-soft)] bg-app-bg/50 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider text-app-ink-muted/80">
                        {book.format}
                    </span>
                    {languageFlag && (
                        <span className="text-xs opacity-70" title={book.language ?? "Language"}>
                            {languageFlag}
                        </span>
                    )}
                </div>
            </div>
        );
    }

    // Grid View
    return (
        <article
            className={cn(
                "group flex cursor-pointer flex-col overflow-hidden rounded-lg border transition-all duration-200",
                selected
                    ? "border-[color:color-mix(in_srgb,var(--app-accent),transparent_60%)] ring-2 ring-[color:color-mix(in_srgb,var(--app-accent),transparent_90%)] bg-[color:color-mix(in_srgb,var(--app-accent),transparent_95%)]"
                    : selectedForBatch
                        ? "border-[color:color-mix(in_srgb,var(--app-accent),transparent_75%)] bg-[color:color-mix(in_srgb,var(--app-accent),transparent_97%)]"
                    : "border-transparent bg-transparent shadow-none hover:bg-app-surface/10"
            )}
            onClick={(event) => {
                if (event.metaKey || event.ctrlKey) {
                    onToggleBatchSelect(book.id);
                    return;
                }
                onSelect(book.id);
            }}
            role="button"
            tabIndex={0}
            onKeyDown={(event) => {
                if (event.key === "Enter") onSelect(book.id);
                if (event.key === " ") {
                    event.preventDefault();
                    onToggleBatchSelect(book.id);
                }
            }}
        >
            {/* Cover Area */}
            <div className="relative aspect-[2/3] w-full overflow-hidden bg-app-bg/10">
                <button
                    type="button"
                    aria-label={selectedForBatch ? "Remove from selection" : "Add to selection"}
                    className={cn(
                        "absolute left-2 top-2 z-20 grid h-5 w-5 place-items-center rounded border text-[var(--app-ink)] transition",
                        selectedForBatch
                            ? "border-[var(--app-accent)] bg-[var(--app-accent)] text-white"
                            : "border-[var(--app-border-soft)] bg-black/45 text-transparent hover:border-[var(--app-accent)] group-hover:text-app-ink-muted"
                    )}
                    onClick={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        onToggleBatchSelect(book.id);
                    }}
                >
                    <Check size={12} className={selectedForBatch ? "opacity-100" : "opacity-0 group-hover:opacity-70"} />
                </button>
                {book.cover ? (
                    <img
                        className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
                        src={book.cover}
                        alt={book.title}
                        onError={() => {
                            clearCoverOverride(book.id);
                            fetchCoverOverride(book.id);
                        }}
                    />
                ) : (
                    <div className="flex h-full flex-col items-center justify-center p-4 text-center">
                        <div className="mb-3 grid h-12 w-12 place-items-center rounded-full bg-app-bg text-app-ink-muted ring-1 ring-white/5 shadow-sm">
                            <span className="text-lg font-bold">{book.title.slice(0, 1).toUpperCase()}</span>
                        </div>
                        <div className="line-clamp-3 text-sm font-medium leading-snug text-app-ink/80">
                            {book.title}
                        </div>
                    </div>
                )}

                {/* Series Badge (Subtle, top right) */}
                {book.series && (
                    <div className="absolute top-2 right-2 max-w-[80%] truncate rounded bg-black/60 border border-white/10 px-1.5 py-0.5 text-[10px] font-medium text-white backdrop-blur-md">
                        {book.series} {book.seriesIndex && `#${book.seriesIndex}`}
                    </div>
                )}

                <ProcessingOverlay isProcessing={isEnriching} size={24} variant="purple" />
            </div>

            {/* Content Area */}
            <div className="flex flex-1 flex-col p-3">
                {/* Meta Row (Format, Lang) - NOW BELOW COVER */}
                <div className="mb-2 flex items-center justify-between gap-2">
                    <div className="flex items-center gap-1.5">
                        <span className="inline-flex h-5 items-center rounded border border-[var(--app-border-muted)] bg-app-bg/20 px-1.5 text-[10px] font-bold uppercase tracking-wider text-app-ink-muted/50">
                            {book.format}
                        </span>
                        {languageFlag && <span className="text-xs opacity-80 grayscale transition-all group-hover:grayscale-0">{languageFlag}</span>}
                    </div>
                    {book.year && (
                        <span className="text-[11px] font-medium text-app-ink-muted/60">{book.year}</span>
                    )}
                </div>

                {/* Title */}
                <h3 className="mb-0.5 line-clamp-2 text-[13px] font-semibold leading-snug text-app-ink group-hover:text-app-accent-strong transition-colors">
                    {book.title}
                </h3>

                {/* Author */}
                <div className="mb-2 line-clamp-1 text-[12px] text-app-ink-muted">
                    {book.author}
                </div>

                {(book.genres ?? []).length > 0 ? (
                    <div className="flex flex-wrap gap-1 pb-1">
                        {(book.genres ?? []).slice(0, 2).map((genre) => (
                            <span
                                key={`${book.id}-grid-${genre}`}
                                className="inline-flex items-center rounded-full border border-[var(--app-border-soft)] bg-app-bg/40 px-1.5 py-0.5 text-[9px] text-app-ink-muted"
                            >
                                {genre}
                            </span>
                        ))}
                    </div>
                ) : null}

                {/* Tags (Bottom) */}
                {(book.tags ?? []).length > 0 && (
                    <div className="mt-auto flex flex-wrap gap-1 pt-2">
                        {(book.tags ?? []).slice(0, 3).map((tag) => (
                            <span
                                key={tag.id}
                                className={`h-1.5 w-1.5 rounded-full ${getTagColorClass(tag.color).replace('text-', 'bg-').split(' ')[0]}`} // Use dot indicators for cleaner look or tiny pills
                                title={tag.name}
                            />
                        ))}
                        {(book.tags ?? []).length > 0 && (
                            <span className="text-[10px] text-app-ink-muted/50">+{book.tags!.length}</span>
                        )}
                    </div>
                )}
            </div>
        </article>
    );
}

export const BookCard = memo(BookCardComponent);
