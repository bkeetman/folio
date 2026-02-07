import type { BookMetadata } from "./types";

export type ProviderWeightMap = Record<string, number>;

const DEFAULT_PROVIDER_WEIGHTS: ProviderWeightMap = {
  applebooks: 1.0,
  googlebooks: 0.92,
  openlibrary: 0.85,
  bolcom: 0.8,
};

export type ScoredMetadata = BookMetadata & {
  weightedConfidence: number;
};

export function scoreWithProviderWeight(
  candidates: BookMetadata[],
  weights: ProviderWeightMap = DEFAULT_PROVIDER_WEIGHTS
): ScoredMetadata[] {
  return candidates
    .map((candidate) => {
      const weight = weights[candidate.source] ?? 0.75;
      return {
        ...candidate,
        weightedConfidence: clamp(candidate.confidence * weight, 0, 1),
      };
    })
    .sort((a, b) => b.weightedConfidence - a.weightedConfidence);
}

export function mergeProviderResults(
  candidates: BookMetadata[],
  weights: ProviderWeightMap = DEFAULT_PROVIDER_WEIGHTS
): BookMetadata | null {
  const scored = scoreWithProviderWeight(candidates, weights);
  if (!scored.length) return null;

  const winner = scored[0];
  const alternatives = scored.slice(1);

  const authors = winner.authors?.length
    ? winner.authors
    : alternatives.find((entry) => entry.authors?.length)?.authors;
  const identifiers = dedupeStrings(
    scored.flatMap((entry) => entry.identifiers ?? [])
  );
  const coverUrl = pickCover(scored);
  const description = pickLongestText(scored.map((entry) => entry.description));
  const sourceUrl = winner.sourceUrl ?? alternatives.find((entry) => entry.sourceUrl)?.sourceUrl;

  return {
    ...winner,
    authors,
    identifiers: identifiers.length ? identifiers : undefined,
    coverUrl,
    description,
    sourceUrl,
  };
}

function pickCover(candidates: ScoredMetadata[]): string | undefined {
  const withCover = candidates.filter((candidate) => Boolean(candidate.coverUrl));
  if (!withCover.length) return undefined;

  return withCover.sort((a, b) => {
    const aSize = inferCoverSize(a.coverUrl);
    const bSize = inferCoverSize(b.coverUrl);
    if (aSize !== bSize) return bSize - aSize;
    return b.weightedConfidence - a.weightedConfidence;
  })[0]?.coverUrl;
}

function inferCoverSize(value: string | undefined): number {
  if (!value) return 0;
  const match = value.match(/\/(\d+)x(\d+)bb\.(jpg|png)/i);
  if (!match) return 0;
  return Number(match[1]) * Number(match[2]);
}

function pickLongestText(values: Array<string | undefined>): string | undefined {
  return values
    .filter((value): value is string => Boolean(value))
    .sort((a, b) => b.length - a.length)[0];
}

function dedupeStrings(values: string[]): string[] {
  const unique = new Set(
    values
      .map((value) => value.trim())
      .filter(Boolean)
  );
  return [...unique];
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
