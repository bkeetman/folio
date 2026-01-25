import { readFile } from "fs/promises";
import type { ExtractedMetadata } from "./types";
import { extractIsbnCandidates, normalizeIsbn } from "./isbn";

type PdfInfo = {
  Title?: string;
  Author?: string;
  Subject?: string;
  Keywords?: string;
};

export async function extractPdfMetadata(
  filePath: string,
  maxPages = 10
): Promise<ExtractedMetadata> {
  const buffer = await readFile(filePath);
  const pdfParse = await loadPdfParse();
  const data = await pdfParse(buffer);

  const info = (data.info ?? {}) as PdfInfo;
  const title = info.Title?.trim();
  const author = info.Author?.trim();
  const description = info.Subject?.trim();

  const identifiers = extractIdentifiers(info, data.text ?? "", maxPages);

  return {
    title: title || undefined,
    authors: author ? [author] : undefined,
    description: description || undefined,
    identifiers,
  };
}

function extractIdentifiers(info: PdfInfo, text: string, maxPages: number) {
  const candidates = new Set<string>();
  if (info.Keywords) {
    for (const isbn of extractIsbnCandidates(info.Keywords)) {
      candidates.add(isbn);
    }
  }
  for (const isbn of extractIsbnCandidates(text.slice(0, maxPages * 5000))) {
    candidates.add(isbn);
  }

  const identifiers: ExtractedMetadata["identifiers"] = [];
  for (const isbn of candidates) {
    const normalized = normalizeIsbn(isbn);
    if (!normalized) continue;
    identifiers.push({
      type: normalized.length === 10 ? "ISBN10" : "ISBN13",
      value: normalized,
      confidence: 0.6,
      source: "heuristic",
    });
  }

  return identifiers.length ? identifiers : undefined;
}

async function loadPdfParse(): Promise<
  (data: Buffer, options?: { max?: number }) => Promise<any>
> {
  const module = await import("pdf-parse");
  return (module as any).default ?? module;
}
