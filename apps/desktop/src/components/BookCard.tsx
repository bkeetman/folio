import { FileText } from "lucide-react";
import { getLanguageFlag } from "../lib/languageFlags";
import { getTagColorClass } from "../lib/tagColors";
import { cn } from "../lib/utils"; // Assuming you have a utils file, if not I will handle inline
import type { BookDisplay } from "../types/library";
import { ProcessingOverlay } from "./ProgressBar";

type BookCardProps = {
    book: BookDisplay;
    selected: boolean;
    onSelect: () => void;
    coverRefreshToken: number;
    fetchCoverOverride: (id: string) => void;
    clearCoverOverride: (id: string) => void;
    viewMode?: "grid" | "list";
    isEnriching?: boolean;
};

export function BookCard({
    book,
    selected,
    onSelect,
    coverRefreshToken,
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
                    "grid cursor-pointer grid-cols-[56px_2fr_1.5fr_0.6fr_0.8fr] gap-4 border-b border-app-border px-4 py-3 transition-colors last:border-0",
                    selected
                        ? "bg-app-accent/5"
                        : "hover:bg-app-border/30 bg-app-panel"
                )}
                onClick={onSelect}
                role="button"
                tabIndex={0}
                onKeyDown={(event) => {
                    if (event.key === "Enter") onSelect();
                }}
            >
                {/* Thumbnail */}
                <div className="relative grid h-14 w-10 shrink-0 place-items-center overflow-hidden rounded border border-app-border bg-app-bg shadow-sm">
                    {book.cover ? (
                        <img
                            key={`${book.id}-${coverRefreshToken}-${book.cover ?? "none"}`}
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
                <div className="flex flex-col justify-center gap-1 min-w-0">
                    <div className="flex items-center gap-2">
                        <span className="truncate text-sm font-medium text-app-ink">{book.title}</span>
                        {book.series && (
                            <span className="shrink-0 text-xs text-app-ink-muted">
                                ({book.series}{book.seriesIndex ? ` #${book.seriesIndex}` : ""})
                            </span>
                        )}
                    </div>
                    {(book.tags ?? []).length > 0 && (
                        <div className="flex flex-wrap gap-1.5">
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
                    <span className="rounded border border-app-border bg-app-bg px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider text-app-ink-muted">
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
                    ? "border-app-accent ring-1 ring-app-accent/20 bg-app-surface shadow-md"
                    : "border-app-border bg-app-surface shadow-sm hover:border-app-accent/50 hover:shadow-md"
            )}
            onClick={onSelect}
            role="button"
            tabIndex={0}
            onKeyDown={(event) => {
                if (event.key === "Enter") onSelect();
            }}
        >
            {/* Cover Area */}
            <div className="relative aspect-[2/3] w-full overflow-hidden bg-app-bg border-b border-app-border/50">
                {book.cover ? (
                    <img
                        key={`${book.id}-${coverRefreshToken}-${book.cover ?? "none"}`}
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
                        <div className="mb-3 grid h-12 w-12 place-items-center rounded-full bg-app-border/30 text-app-ink-muted">
                            <span className="text-lg font-bold">{book.title.slice(0, 1).toUpperCase()}</span>
                        </div>
                        <div className="line-clamp-3 text-sm font-medium leading-snug text-app-ink/80">
                            {book.title}
                        </div>
                    </div>
                )}

                {/* Series Badge (Subtle, top right) */}
                {book.series && (
                    <div className="absolute top-2 right-2 max-w-[80%] truncate rounded bg-black/60 px-1.5 py-0.5 text-[10px] font-medium text-white backdrop-blur-sm">
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
                        <span className="inline-flex h-5 items-center rounded border border-app-border bg-app-bg px-1.5 text-[10px] font-bold uppercase tracking-wider text-app-ink-muted/80">
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
