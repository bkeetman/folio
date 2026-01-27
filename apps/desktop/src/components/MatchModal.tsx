import { Button } from "./ui";

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
    <div className="modal-backdrop" onClick={onClose} role="presentation">
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="modal-header">
          <div>
            <div className="modal-title">Match metadata</div>
            <div className="modal-subtitle">
              {itemTitle} · {itemAuthor}
            </div>
          </div>
          <Button variant="ghost" size="sm" onClick={onClose}>
            Close
          </Button>
        </div>

        <div className="modal-search">
          <input
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

        <div className="modal-body">
          {candidates.length ? (
            <div className="modal-candidates">
              {candidates.map((candidate) => {
                const coverUrl = getCoverUrl(candidate);
                return (
                  <div key={candidate.id} className="candidate-card">
                    <div className="candidate-cover">
                      {coverUrl ? (
                        <img
                          className="candidate-cover-image"
                          src={coverUrl}
                          alt=""
                          onError={(event) => {
                            event.currentTarget.style.display = "none";
                          }}
                        />
                      ) : (
                        <div className="candidate-cover-fallback">No cover</div>
                      )}
                    </div>
                    <div className="candidate-info">
                      <div className="candidate-head">
                        <span className="candidate-source">{candidate.source}</span>
                        <span className="candidate-score">
                          {Math.round(candidate.confidence * 100)}%
                        </span>
                      </div>
                      <div className="card-title">{candidate.title ?? "Untitled"}</div>
                      <div className="card-meta">{candidate.authors.join(", ")}</div>
                      <div className="card-meta">
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
            <div className="modal-empty">
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
