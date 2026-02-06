import { useTranslation } from "react-i18next";
import type { BookDisplay } from "../types/library";
import { BookCard } from "./BookCard";

type LibraryGridProps = {
    books: BookDisplay[];
    selectedItemId: string | null;
    onSelect: (id: string) => void;
    coverRefreshToken: number;
    fetchCoverOverride: (id: string) => void;
    clearCoverOverride: (id: string) => void;
    viewMode: "grid" | "list";
    enrichingItems?: Set<string>;
};

export function LibraryGrid({
    books,
    selectedItemId,
    onSelect,
    coverRefreshToken,
    fetchCoverOverride,
    clearCoverOverride,
    viewMode,
    enrichingItems,
}: LibraryGridProps) {
    const { t } = useTranslation();
    if (viewMode === "list") {
        return (
            <div className="overflow-hidden rounded-lg border border-app-border bg-app-panel surface-gradient shadow-sm">
                <div className="grid grid-cols-[56px_2fr_1.5fr_0.6fr_0.8fr] gap-3 bg-app-bg-secondary px-4 py-2 text-[10px] uppercase tracking-[0.12em] text-app-ink-muted">
                    <div></div>
                    <div>{t("library.columnTitle")}</div>
                    <div>{t("library.columnAuthor")}</div>
                    <div>{t("library.columnYear")}</div>
                    <div>{t("library.columnFormat")}</div>
                </div>
                {books.map((book) => (
                    <BookCard
                        key={book.id}
                        book={book}
                        selected={selectedItemId === book.id}
                        onSelect={() => onSelect(book.id)}
                        coverRefreshToken={coverRefreshToken}
                        fetchCoverOverride={fetchCoverOverride}
                        clearCoverOverride={clearCoverOverride}
                        viewMode="list"
                        isEnriching={enrichingItems?.has(book.id) ?? false}
                    />
                ))}
            </div>
        );
    }

    return (
        <div className="grid grid-cols-[repeat(auto-fit,minmax(170px,1fr))] gap-3 rounded-lg bg-app-bg/10 p-3 shadow-inner ring-1 ring-white/5">
            {books.map((book) => (
                <BookCard
                    key={book.id}
                    book={book}
                    selected={selectedItemId === book.id}
                    onSelect={() => onSelect(book.id)}
                    coverRefreshToken={coverRefreshToken}
                    fetchCoverOverride={fetchCoverOverride}
                    clearCoverOverride={clearCoverOverride}
                    viewMode="grid"
                    isEnriching={enrichingItems?.has(book.id) ?? false}
                />
            ))}
        </div>
    );
}
