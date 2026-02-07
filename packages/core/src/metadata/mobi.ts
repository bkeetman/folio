import path from "path";
import type { ExtractedMetadata } from "./types";
import { extractIsbnCandidates } from "./isbn";

function normalizeTitleFromFilename(filePath: string): string | undefined {
  const raw = path.basename(filePath, path.extname(filePath)).trim();
  if (!raw) return undefined;
  const cleaned = raw
    .replace(/[_]+/g, " ")
    .replace(/[.]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned || undefined;
}

export async function extractMobiMetadata(
  filePath: string
): Promise<ExtractedMetadata> {
  const title = normalizeTitleFromFilename(filePath);
  const identifiers: ExtractedMetadata["identifiers"] | undefined = title
    ? extractIsbnCandidates(title).map((isbn) => ({
        type: isbn.length === 10 ? "ISBN10" : "ISBN13",
        value: isbn,
        confidence: 0.35,
        source: "heuristic",
      }))
    : undefined;

  return {
    title,
    identifiers: identifiers && identifiers.length ? identifiers : undefined,
  };
}
