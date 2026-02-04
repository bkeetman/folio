export type View =
  | "library"
  | "library-books"
  | "library-authors"
  | "library-series"
  | "inbox"
  | "duplicates"
  | "fix"
  | "changes"
  | "tags"
  | "ereader"
  | "organize"
  | "missing-files"
  | "settings"
  | "edit";
export type LibraryFilter = "all" | "epub" | "pdf" | "needs-metadata" | "tagged";

export type LibrarySort =
  | "default"
  | "title-asc"
  | "title-desc"
  | "author-asc"
  | "year-desc"
  | "year-asc"
  | "recent";

export type FixFilter = {
  missingAuthor: boolean;
  missingTitle: boolean;
  missingCover: boolean;
  missingIsbn: boolean;
  missingYear: boolean;
  missingDescription: boolean;
  missingLanguage: boolean;
  missingSeries: boolean;
  includeIssues: boolean;
};

export type ItemMetadata = {
  title: string | null;
  authors: string[];
  publishedYear: number | null;
  language: string | null;
  isbn: string | null;
  series: string | null;
  seriesIndex: number | null;
  description: string | null;
};

export type Tag = { id: string; name: string; color?: string | null };

export type Author = {
  name: string;
  bookCount: number;
};

export type LibraryItem = {
  id: string;
  title: string | null;
  published_year: number | null;
  created_at: number;
  authors: string[];
  file_count: number;
  formats: string[];
  cover_path?: string | null;
  tags?: Tag[];
  language?: string | null;
  series?: string | null;
  series_index?: number | null;
  isbn?: string | null;
};

export type MissingFileItem = {
  fileId: string;
  itemId: string;
  title: string;
  authors: string[];
  path: string;
  extension: string;
};

export type BookDisplay = {
  id: string;
  title: string;
  author: string;
  authors: string[];
  format: string;
  year: number | string;
  status: string;
  cover: string | null;
  tags?: Tag[];
  language?: string | null;
  series?: string | null;
  seriesIndex?: number | null;
  createdAt: number;
};

export type OrganizerSettings = {
  libraryRoot: string | null;
  mode: string;
  template: string;
};

export type OrganizerLogEntry = {
  action: string;
  from: string;
  to: string;
  timestamp: number;
  error?: string | null;
};

export type OrganizerLog = {
  id: string;
  createdAt: number;
  processed: number;
  errors: number;
  entries: OrganizerLogEntry[];
};

export type ScanStats = {
  added: number;
  updated: number;
  moved: number;
  unchanged: number;
  missing: number;
};

export type ScanProgress = {
  processed: number;
  total: number;
  current: string;
};

export type SyncProgress = {
  processed: number;
  total: number;
  current: string;
  action: string;
};

export type InboxItem = {
  id: string;
  title: string;
  reason: string;
};

export type DuplicateGroup = {
  id: string;
  kind: "hash" | "title" | "fuzzy";
  title: string;
  files: string[];
  file_ids: string[];
  file_paths: string[];
  file_titles: string[];
  file_sizes: number[];
};

export type PendingChange = {
  id: string;
  file_id: string;
  change_type: string;
  from_path?: string | null;
  to_path?: string | null;
  changes_json?: string | null;
  status: string;
  created_at: number;
  applied_at?: number | null;
  error?: string | null;
};

export type LibraryHealth = {
  total: number;
  missing_isbn: number;
  duplicates: number;
  complete: number;
  missing_cover: number;
};

export type EnrichmentCandidate = {
  id: string;
  title: string | null;
  authors: string[];
  published_year: number | null;
  identifiers: string[];
  cover_url?: string | null;
  source: string;
  confidence: number;
};

export type OrganizePlan = {
  mode: string;
  library_root: string;
  template: string;
  entries: Array<{
    file_id: string;
    source_path: string;
    target_path: string;
    action: string;
  }>;
};

export type EReaderDevice = {
  id: string;
  name: string;
  mountPath: string;
  deviceType: "kobo" | "kindle" | "generic";
  booksSubfolder: string;
  lastConnectedAt: number | null;
  isConnected: boolean;
};

export type EReaderBook = {
  path: string;
  filename: string;
  title: string | null;
  authors: string[];
  fileHash: string;
  matchedItemId: string | null;
  matchConfidence: "exact" | "isbn" | "title" | "fuzzy" | null;
};

export type SyncQueueItem = {
  id: string;
  deviceId: string;
  action: "add" | "remove" | "import";
  itemId: string | null;
  ereaderPath: string | null;
  status: "pending" | "completed" | "error";
  createdAt: number;
};

export type SyncResult = {
  added: number;
  removed: number;
  imported: number;
  errors: string[];
};

// Legacy types - kept for backward compatibility during migration
// These will be removed once all code uses OperationProgress/OperationStats

export type EnrichProgress = {
  itemId: string;
  status: "searching" | "applying" | "done" | "skipped" | "error";
  message: string | null;
  current: number;
  total: number;
};

export type EnrichStats = {
  total: number;
  enriched: number;
  skipped: number;
  errors: number;
};

export type ChangeProgress = {
  changeId: string;
  status: "applying" | "done" | "error";
  message: string | null;
  current: number;
  total: number;
};

// Unified types for all background operations
// All backend events should conform to these shapes

export type OperationProgress = {
  itemId: string;
  status: "pending" | "processing" | "done" | "skipped" | "error";
  message: string | null;
  current: number;
  total: number;
};

export type OperationStats = {
  total: number;
  processed: number;
  skipped: number;
  errors: number;
};

export type ActivityLogItem = {
  id: string;
  type: "scan" | "enrich" | "sync" | "organize" | "error";
  message: string;
  timestamp: number;
};

export type FileItem = {
  id: string;
  path: string;
  filename: string;
  format: string;
};
