import { readFile } from "fs/promises";
import path from "path";
import type { ExtractedMetadata } from "./types";
import { extractIsbnCandidates, normalizeIsbn } from "./isbn";

type EpubMetadata = {
  title?: string;
  creator?: string | string[];
  language?: string;
  date?: string;
  identifier?: string | string[];
  description?: string;
  cover?: string;
};

export async function extractEpubMetadata(
  filePath: string
): Promise<ExtractedMetadata> {
  const { EPub } = await loadEpub();
  const epub = new EPub(filePath);

  await new Promise<void>((resolve, reject) => {
    epub.on("end", () => resolve());
    epub.on("error", (error: Error) => reject(error));
    epub.parse();
  });

  const meta = epub.metadata as EpubMetadata;
  const authors = normalizeCreators(meta.creator);
  const identifiers = normalizeIdentifiers(meta.identifier);

  let coverData: ExtractedMetadata["cover"] | undefined;
  const coverId = meta.cover;
  if (coverId) {
    const coverPath = epub.manifest?.[coverId]?.href;
    if (coverPath) {
      const coverBuffer = await readFile(
        path.join(path.dirname(epub.rootFile), coverPath)
      );
      coverData = {
        data: coverBuffer,
        mimeType: epub.manifest?.[coverId]?.mediaType,
      };
    }
  }

  return {
    title: meta.title?.trim(),
    authors,
    language: meta.language?.trim(),
    publishedYear: parseYear(meta.date),
    description: meta.description?.trim(),
    identifiers,
    cover: coverData,
  };
}

function normalizeCreators(creators?: string | string[]): string[] | undefined {
  if (!creators) return undefined;
  const list = Array.isArray(creators) ? creators : [creators];
  const normalized = list
    .map((value) => value?.trim())
    .filter((value): value is string => Boolean(value));
  return normalized.length ? normalized : undefined;
}

function normalizeIdentifiers(values?: string | string[]) {
  if (!values) return undefined;
  const list = Array.isArray(values) ? values : [values];
  const identifiers: ExtractedMetadata["identifiers"] = [];

  for (const value of list) {
    const normalized = normalizeIsbn(value);
    if (normalized) {
      identifiers.push({
        type: normalized.length === 10 ? "ISBN10" : "ISBN13",
        value: normalized,
        confidence: 0.8,
        source: "embedded",
      });
      continue;
    }
    identifiers.push({
      type: "OTHER",
      value,
      confidence: 0.4,
      source: "embedded",
    });
  }

  const isbnCandidates = extractIsbnCandidates(list.join(" "));
  for (const candidate of isbnCandidates) {
    if (identifiers.some((id) => id.value === candidate)) continue;
    identifiers.push({
      type: candidate.length === 10 ? "ISBN10" : "ISBN13",
      value: candidate,
      confidence: 0.6,
      source: "heuristic",
    });
  }

  return identifiers.length ? identifiers : undefined;
}

function parseYear(dateValue?: string): number | undefined {
  if (!dateValue) return undefined;
  const match = dateValue.match(/\b(\d{4})\b/);
  if (!match) return undefined;
  return Number(match[1]);
}

async function loadEpub(): Promise<{ EPub: new (path: string) => any }> {
  const module = await import("epub2");
  return { EPub: (module as any).EPub ?? (module as any).default ?? module };
}
