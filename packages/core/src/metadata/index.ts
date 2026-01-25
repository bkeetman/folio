import path from "path";
import type { ExtractedMetadata } from "./types";
import { extractEpubMetadata } from "./epub";
import { extractPdfMetadata } from "./pdf";

export async function extractMetadataForFile(
  filePath: string
): Promise<ExtractedMetadata> {
  const extension = path.extname(filePath).toLowerCase();
  if (extension === ".epub") return extractEpubMetadata(filePath);
  if (extension === ".pdf") return extractPdfMetadata(filePath);
  return {};
}

export * from "./types";
