import { Button, Input } from "./ui";

type EnrichmentCandidate = {
  id: string;
  title: string | null;
  authors: string[];
  published_year: number | null;
  identifiers: string[];
  cover_url?: string | null;
  source: string;
  confidence: number;
};

type MatchModalProps = {
  open: boolean;
  itemTitle: string;
  itemAuthor: string;
  query: string;
  loading: boolean;
  candidates: EnrichmentCandidate[];
  onQueryChange: (value: string) => void;
  onSearch: () => void;
  onApply: (candidate: EnrichmentCandidate) => void;
  onClose: () => void;
};

export function MatchModal({
  open,
  itemTitle,
  itemAuthor,
  query,
  loading,
  candidates,
  onQueryChange,
  onSearch,
  onApply,
  onClose,
}: MatchModalProps) {
  if (!open) return null;

  const getCoverUrl = (candidate: EnrichmentCandidate) => {
    if (candidate.cover_url) return candidate.cover_url;
    const isbn = candidate.identifiers
      .map((value) => value.replace(/[^0-9Xx]/g, "").toUpperCase())
      .find((value) => value.length === 13 || value.length === 10);
    if (!isbn) return null;
    return `https://covers.openlibrary.org/b/isbn/${isbn}-M.jpg`;
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4"
      onClick={onClose}
      role="presentation"
    >
      <div
        className="w-full max-w-3xl rounded-lg border border-[var(--app-border)] bg-[var(--app-panel)] p-4 shadow-panel"
        role="dialog"
        aria-modal="true"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-base font-semibold">Match metadata</div>
            <div className="text-xs text-[var(--app-ink-muted)]">
              {itemTitle} · {itemAuthor}
            </div>
          </div>
          <Button variant="ghost" size="sm" onClick={onClose}>
            Close
          </Button>
        </div>

        <div className="mt-3 flex gap-2">
          <Input
            value={query}
            onChange={(event) => onQueryChange(event.target.value)}
            placeholder="Search by title, author, or ISBN"
            onKeyDown={(event) => {
              if (event.key === "Enter") onSearch();
            }}
          />
          <Button variant="primary" size="sm" onClick={onSearch} disabled={loading}>
            {loading ? "Searching…" : "Search"}
          </Button>
        </div>

        <div className="mt-4">
          {candidates.length ? (
            <div className="grid gap-3 sm:grid-cols-2">
              {candidates.map((candidate) => {
                const coverUrl = getCoverUrl(candidate);
                return (
                  <div
                    key={candidate.id}
                    className="flex gap-3 rounded-md border border-[var(--app-border)] bg-white/80 p-3"
                  >
                    <div className="h-20 w-14 overflow-hidden rounded-md border border-[var(--app-border)] bg-[#fffaf4]">
                      {coverUrl ? (
                        <img
                          className="h-full w-full object-cover"
                          src={coverUrl}
                          alt=""
                          onError={(event) => {
                            event.currentTarget.style.display = "none";
                          }}
                        />
                      ) : (
                        <div className="grid h-full w-full place-items-center text-[10px] text-[var(--app-ink-muted)]">
                          No cover
                        </div>
                      )}
                    </div>
                    <div className="flex flex-1 flex-col gap-1">
                      <div className="flex items-center justify-between text-[10px] uppercase tracking-[0.12em] text-[var(--app-ink-muted)]">
                        <span className="rounded-full bg-[rgba(201,122,58,0.12)] px-2 py-0.5">
                          {candidate.source}
                        </span>
                        <span>{Math.round(candidate.confidence * 100)}%</span>
                      </div>
                      <div className="text-[13px] font-semibold">
                        {candidate.title ?? "Untitled"}
                      </div>
                      <div className="text-xs text-[var(--app-ink-muted)]">
                        {candidate.authors.join(", ")}
                      </div>
                      <div className="text-xs text-[var(--app-ink-muted)]">
                        {candidate.published_year ?? "Unknown"}
                      </div>
                      <Button
                        variant="ghost"
                        onClick={() => onApply(candidate)}
                        disabled={loading}
                      >
                        Use This
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="rounded-md border border-[var(--app-border)] bg-white/70 p-3 text-xs text-[var(--app-ink-muted)]">
              {loading
                ? "Searching sources…"
                : "No matches yet. Try a custom search or ISBN."}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
