export type ExtractedIdentifier = {
  type: "ISBN10" | "ISBN13" | "ASIN" | "DOI" | "OTHER";
  value: string;
  confidence: number;
  source: "embedded" | "heuristic";
};

export type ExtractedMetadata = {
  title?: string;
  authors?: string[];
  language?: string;
  publishedYear?: number;
  description?: string;
  identifiers?: ExtractedIdentifier[];
  cover?: {
    mimeType?: string;
    data: Buffer;
  };
};
