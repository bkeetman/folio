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
    if (viewMode === "list") {
        return (
            <div className="overflow-hidden rounded-lg border border-[var(--app-border)] bg-[#fffdf9]">
                <div className="grid grid-cols-[56px_2fr_1.5fr_0.6fr_0.8fr] gap-3 bg-[#f9f4ee] px-4 py-2 text-[10px] uppercase tracking-[0.12em] text-[var(--app-ink-muted)]">
                    <div></div>
                    <div>Titel</div>
                    <div>Auteur</div>
                    <div>Jaar</div>
                    <div>Formaat</div>
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
        <div className="grid grid-cols-[repeat(auto-fit,minmax(170px,1fr))] gap-3 rounded-lg bg-[linear-gradient(180deg,rgba(255,255,255,0.45),rgba(255,255,255,0.45)),repeating-linear-gradient(to_bottom,rgba(44,38,33,0.05)_0px,rgba(44,38,33,0.05)_2px,transparent_2px,transparent_190px)] p-3">
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
