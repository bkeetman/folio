import type { EnrichmentCandidate } from "../types/library";
import { Button } from "../components/ui";

type FixViewProps = {
  currentFixItem: { id: string; title: string; reason: string } | null;
  fixLoading: boolean;
  candidateList: EnrichmentCandidate[];
  getCandidateCoverUrl: (candidate: EnrichmentCandidate) => string | null;
  handleFetchCandidates: () => void;
  handleApplyCandidate: (candidate: EnrichmentCandidate) => void;
  isDesktop: boolean;
};

export function FixView({
  currentFixItem,
  fixLoading,
  candidateList,
  getCandidateCoverUrl,
  handleFetchCandidates,
  handleApplyCandidate,
  isDesktop,
}: FixViewProps) {
  return (
    <section className="flex flex-col gap-4">
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)]">
        <div className="rounded-md border border-[var(--app-border)] bg-white/70 p-3">
          <div className="text-[10px] uppercase tracking-[0.14em] text-[var(--app-ink-muted)]">
            Current Metadata
          </div>
          {currentFixItem ? (
            <>
              <div className="flex items-center justify-between gap-2 text-xs text-[var(--app-ink-muted)]">
                <span className="text-[10px] uppercase tracking-[0.12em]">Title</span>
                <strong className="text-[var(--app-ink)]">{currentFixItem.title}</strong>
              </div>
              <div className="flex items-center justify-between gap-2 text-xs text-[var(--app-ink-muted)]">
                <span className="text-[10px] uppercase tracking-[0.12em]">Issue</span>
                <strong className="text-[var(--app-ink)]">{currentFixItem.reason}</strong>
              </div>
              <Button variant="primary" onClick={handleFetchCandidates}>
                {fixLoading ? (
                  <span className="flex items-center gap-2">
                    <span className="h-3 w-3 animate-spin rounded-full border-2 border-white/60 border-t-white" />
                    Searching...
                  </span>
                ) : (
                  "Search Sources"
                )}
              </Button>
            </>
          ) : (
            <div className="text-xs text-[var(--app-ink-muted)]">No items need fixes.</div>
          )}
        </div>

        <div className="rounded-md border border-[var(--app-border)] bg-white/70 p-3">
          <div className="text-[10px] uppercase tracking-[0.14em] text-[var(--app-ink-muted)]">
            Top Matches
          </div>
          {candidateList.length ? (
            <div className="mt-3 grid grid-cols-[repeat(auto-fit,minmax(220px,1fr))] gap-3">
              {candidateList.map((candidate) => {
                const coverUrl = getCandidateCoverUrl(candidate);
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
                        onClick={() => handleApplyCandidate(candidate)}
                        disabled={!currentFixItem || fixLoading || !isDesktop}
                      >
                        Use This
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="mt-2 text-xs text-[var(--app-ink-muted)]">
              {fixLoading ? "Searching..." : "No candidates found."}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
