import { getTagColorClass } from "../lib/tagColors";
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
    if (viewMode === "list") {
        return (
            <div
                className={
                    selected
                        ? "grid cursor-pointer grid-cols-[56px_2fr_1.5fr_0.6fr_0.8fr] gap-3 border-t border-[var(--app-border)] bg-[rgba(201,122,58,0.12)] px-4 py-2"
                        : "grid cursor-pointer grid-cols-[56px_2fr_1.5fr_0.6fr_0.8fr] gap-3 border-t border-[var(--app-border)] px-4 py-2 hover:bg-[rgba(201,122,58,0.06)]"
                }
                onClick={onSelect}
                role="button"
                tabIndex={0}
                onKeyDown={(event) => {
                    if (event.key === "Enter") onSelect();
                }}
            >
                <div className="relative grid h-16 w-12 place-items-center overflow-hidden rounded-md border border-[rgba(44,38,33,0.12)] bg-[#fffaf4]">
                    {book.cover ? (
                        <img
                            key={`${book.id}-${coverRefreshToken}-${book.cover ?? "none"}`}
                            className="h-full w-full object-contain"
                            src={book.cover}
                            alt=""
                            onError={() => {
                                clearCoverOverride(book.id);
                                fetchCoverOverride(book.id);
                            }}
                        />
                    ) : (
                        <div className="text-[10px] uppercase tracking-[0.12em] text-[var(--app-ink-muted)]">
                            {book.format}
                        </div>
                    )}
                    <ProcessingOverlay isProcessing={isEnriching} size={14} variant="purple" />
                </div>
                <div className="flex flex-col gap-1">
                    <div className="text-sm font-semibold">{book.title}</div>
                    {(book.tags ?? []).length ? (
                        <div className="flex flex-wrap gap-1">
                            {(book.tags ?? []).slice(0, 2).map((tag) => (
                                <span
                                    key={tag.id}
                                    className={`rounded-full border px-2 py-0.5 text-[10px] ${getTagColorClass(tag.color)}`}
                                >
                                    {tag.name}
                                </span>
                            ))}
                        </div>
                    ) : null}
                </div>
                <div className="text-xs text-[var(--app-ink-muted)]">
                    {book.author}
                </div>
                <div className="text-xs text-[var(--app-ink-muted)]">
                    {book.year}
                </div>
                <div className="text-xs text-[var(--app-ink-muted)]">
                    {book.format}
                </div>
            </div>
        );
    }

    return (
        <article
            className={
                selected
                    ? "flex cursor-pointer flex-col overflow-hidden rounded-md border border-[rgba(201,122,58,0.6)] bg-[#fffdf9] shadow-[0_16px_24px_rgba(201,122,58,0.18)] transition"
                    : "flex cursor-pointer flex-col overflow-hidden rounded-md border border-[rgba(44,38,33,0.08)] bg-[#fffdf9] shadow-[0_10px_18px_rgba(30,22,15,0.06)] transition hover:shadow-[0_18px_26px_rgba(24,18,12,0.1)]"
            }
            onClick={onSelect}
            role="button"
            tabIndex={0}
            onKeyDown={(event) => {
                if (event.key === "Enter") onSelect();
            }}
        >
            <div className="relative aspect-[3/4] overflow-hidden rounded-t-md border-b border-[rgba(44,38,33,0.06)] bg-[linear-gradient(135deg,#efe3d1,#f2e7d9)]">
                {book.cover ? (
                    <img
                        key={`${book.id}-${coverRefreshToken}-${book.cover ?? "none"}`}
                        className="absolute inset-0 h-full w-full object-cover bg-[#f7f1e7]"
                        src={book.cover}
                        alt=""
                        onError={() => {
                            clearCoverOverride(book.id);
                            fetchCoverOverride(book.id);
                        }}
                    />
                ) : null}
                {book.cover ? (
                    <div className="absolute left-2 top-2 rounded-md bg-[rgba(255,255,255,0.9)] px-2 py-0.5 text-[10px] uppercase tracking-[0.12em]">
                        {book.format}
                    </div>
                ) : (
                    <div className="relative z-10 flex flex-col gap-2 p-3">
                        <div className="rounded-md bg-[rgba(255,255,255,0.8)] px-2 py-0.5 text-[10px] uppercase tracking-[0.12em]">
                            {book.format}
                        </div>
                        <div className="text-[13px] font-semibold leading-snug">
                            {book.title}
                        </div>
                    </div>
                )}
                {/* Enriching spinner overlay */}
                <ProcessingOverlay isProcessing={isEnriching} size={24} variant="purple" />
            </div>
            <div className="flex flex-col gap-1 px-3 py-2">
                <div className="text-[13px] font-semibold">{book.title}</div>
                {(book.tags ?? []).length ? (
                    <div className="flex flex-wrap gap-1">
                        {(book.tags ?? []).slice(0, 3).map((tag) => (
                            <span
                                key={tag.id}
                                className={`rounded-full border px-2 py-0.5 text-[10px] ${getTagColorClass(tag.color)}`}
                            >
                                {tag.name}
                            </span>
                        ))}
                    </div>
                ) : null}
                <div className="grid gap-1">
                    <div className="flex items-center justify-between gap-2 text-xs text-[var(--app-ink-muted)]">
                        <span className="text-[10px] uppercase tracking-[0.12em]">
                            Auteur
                        </span>
                        <span className="text-[var(--app-ink)]">{book.author}</span>
                    </div>
                    <div className="flex items-center justify-between gap-2 text-xs text-[var(--app-ink-muted)]">
                        <span className="text-[10px] uppercase tracking-[0.12em]">
                            Jaar
                        </span>
                        <span className="text-[var(--app-ink)]">{book.year}</span>
                    </div>
                </div>
            </div>
        </article>
    );
}
