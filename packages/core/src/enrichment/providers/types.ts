export type MetadataSourceName =
  | "applebooks"
  | "openlibrary"
  | "googlebooks"
  | "bolcom";

export type MetadataSearchInput = {
  isbn?: string;
  title?: string;
  author?: string;
  country?: string;
  limit?: number;
};

export type ProviderRequestContext = {
  queryType: "isbn" | "title_author";
  title?: string;
  author?: string;
  isbn?: string;
};

export type BookMetadata = {
  title?: string;
  subtitle?: string;
  authors?: string[];
  publishedYear?: number;
  description?: string;
  language?: string;
  identifiers?: string[];
  coverUrl?: string;
  sourceId?: string;
  sourceUrl?: string;
  source: MetadataSourceName;
  confidence: number;
  raw: unknown;
};

export type MetadataProvider = {
  readonly name: MetadataSourceName;
  search: (input: MetadataSearchInput) => Promise<BookMetadata[]>;
  fetchByIsbn: (isbn: string, input?: Omit<MetadataSearchInput, "isbn">) => Promise<BookMetadata[]>;
  getCoverUrl: (raw: unknown) => string | undefined;
  normalizeResult: (raw: unknown, context: ProviderRequestContext) => BookMetadata | null;
};
