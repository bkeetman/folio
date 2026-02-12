import type { Dispatch, RefObject, SetStateAction } from "react";
import type { FilteredBook } from "../../hooks/useLibrarySelectors";
import type { ThemeMode } from "../../hooks/useTheme";
import type {
  BatchMetadataUpdatePayload,
  Category,
  DuplicateGroup,
  EnrichmentCandidate,
  EReaderBook,
  EReaderDevice,
  FixFilter,
  ImportRequest,
  InboxItem,
  ItemMetadata,
  LibraryFilter,
  LibraryItem,
  LibrarySort,
  MetadataSourceSetting,
  MissingFileItem,
  OperationProgress,
  OrganizePlan,
  OrganizerLog,
  PendingChange,
  ScanProgress,
  SyncProgress,
  SyncQueueItem,
  Tag,
  View,
} from "../../types/library";

export type AppRoutesLibraryProps = {
  libraryReady: boolean;
  libraryItemsLength: number;
  sortedBooks: FilteredBook[];
  allBooks: FilteredBook[];
  selectedItemId: string | null;
  selectedBatchItemIds: Set<string>;
  setSelectedItemId: Dispatch<SetStateAction<string | null>>;
  onToggleBatchSelect: (id: string) => void;
  onSetBatchSelection: (ids: string[]) => void;
  onClearBatchSelection: () => void;
  onApplyBatchMetadata: (payload: BatchMetadataUpdatePayload) => Promise<void>;
  onRemoveSelectedBooks: (itemIds: string[]) => Promise<boolean>;
  libraryFilter: LibraryFilter;
  setLibraryFilter: Dispatch<SetStateAction<LibraryFilter>>;
  librarySort: LibrarySort;
  setLibrarySort: Dispatch<SetStateAction<LibrarySort>>;
  tags: Tag[];
  selectedTagIds: string[];
  setSelectedTagIds: Dispatch<SetStateAction<string[]>>;
  grid: boolean;
  setGrid: Dispatch<SetStateAction<boolean>>;
  fetchCoverOverride: (itemId: string, force?: boolean) => Promise<void>;
  clearCoverOverride: (itemId: string) => void;
  onVisibleItemIdsChange: (ids: string[]) => void;
  scrollContainerRef: RefObject<HTMLElement | null>;
  selectedAuthorNames: string[];
  setSelectedAuthorNames: Dispatch<SetStateAction<string[]>>;
  selectedSeries: string[];
  setSelectedSeries: Dispatch<SetStateAction<string[]>>;
  selectedGenres: string[];
  setSelectedGenres: Dispatch<SetStateAction<string[]>>;
  enrichingItems: Set<string>;
  uniqueAuthors: Array<{ name: string; bookCount: number }>;
  uniqueSeries: Array<{ name: string; bookCount: number }>;
  uniqueCategories: Category[];
  libraryItems: LibraryItem[];
};

export type AppRoutesEnrichProps = {
  onEnrichAll: (itemIds?: string[]) => void | Promise<void>;
  onCancelEnrich: () => void | Promise<void>;
  enriching: boolean;
  enrichProgress: OperationProgress | null;
};

export type AppRoutesInboxProps = {
  inbox: InboxItem[];
  sampleInboxItems: InboxItem[];
};

export type AppRoutesDuplicatesProps = {
  duplicates: DuplicateGroup[];
  sampleDuplicateGroups: DuplicateGroup[];
  titleDuplicates: DuplicateGroup[];
  fuzzyDuplicates: DuplicateGroup[];
  duplicateKeepSelection: Record<string, string>;
  setDuplicateKeepSelection: Dispatch<SetStateAction<Record<string, string>>>;
  handleResolveDuplicate: (group: DuplicateGroup, keepFileId: string) => void | Promise<void>;
  handleAutoSelectAll: (groups: DuplicateGroup[]) => void;
  handleResolveAll: (groups: DuplicateGroup[]) => void | Promise<void>;
};

export type AppRoutesFixProps = {
  allFixItems: LibraryItem[];
  fixIssues: InboxItem[];
  selectedFixItemId: string | null;
  setSelectedFixItemId: Dispatch<SetStateAction<string | null>>;
  fixFilter: FixFilter;
  setFixFilter: Dispatch<SetStateAction<FixFilter>>;
  fixSearchQuery: string;
  setFixSearchQuery: Dispatch<SetStateAction<string>>;
  fixLoading: boolean;
  fixCandidates: EnrichmentCandidate[];
  fixCoverUrl: string | null;
  onFetchFixCover: (itemId: string, force?: boolean) => Promise<void>;
  onSearchFixWithQuery: (query: string) => Promise<void>;
  onApplyFixCandidate: (candidate: EnrichmentCandidate) => void | Promise<void>;
  onSaveFixMetadata: (id: string, data: ItemMetadata) => Promise<void>;
  fixApplyingCandidateId: string | null;
  getCandidateCoverUrl: (candidate: EnrichmentCandidate) => string | null;
  onItemUpdate: () => void | Promise<void>;
  onQueueRemoveItem: (itemId: string) => void | Promise<void>;
};

export type AppRoutesChangesProps = {
  pendingChangesStatus: "pending" | "applied" | "error";
  setPendingChangesStatus: Dispatch<SetStateAction<"pending" | "applied" | "error">>;
  changesSourceFilter: "all" | "library" | "ereader";
  setChangesSourceFilter: Dispatch<SetStateAction<"all" | "library" | "ereader">>;
  changesDeviceFilter: string | null;
  clearChangesDeviceFilter: () => void;
  pendingChangesApplying: boolean;
  pendingChangesLoading: boolean;
  pendingChanges: PendingChange[];
  selectedChangeIds: Set<string>;
  toggleChangeSelection: (id: string) => void;
  handleApplyAllChanges: () => void | Promise<void>;
  handleApplySelectedChanges: () => void | Promise<void>;
  handleApplyChange: (changeId: string) => void | Promise<void>;
  handleRemoveChange: (changeId: string) => void | Promise<void>;
  handleRemoveAllChanges: () => void | Promise<void>;
  handleRemoveSelectedChanges: () => void | Promise<void>;
  confirmDeleteOpen: boolean;
  confirmDeleteIds: string[];
  setConfirmDeleteOpen: Dispatch<SetStateAction<boolean>>;
  setConfirmDeleteIds: Dispatch<SetStateAction<string[]>>;
  handleConfirmDelete: () => void | Promise<void>;
  applyingChangeIds: Set<string>;
  changeProgress: OperationProgress | null;
};

export type AppRoutesOrganizerProps = {
  organizeMode: string;
  setOrganizeMode: Dispatch<SetStateAction<string>>;
  organizeRoot: string | null;
  organizeTemplate: string;
  setOrganizeTemplate: Dispatch<SetStateAction<string>>;
  organizePlan: OrganizePlan | null;
  handlePlanOrganize: () => void | Promise<OrganizePlan | null>;
  handleApplyOrganize: () => void | Promise<void>;
  organizeStatus: string | null;
  organizeProgress: OperationProgress | null;
  organizing: boolean;
  organizeLog: OrganizerLog | null;
  onImportCancel: () => void;
  onImportStart: (request: ImportRequest) => Promise<void>;
};

export type AppRoutesSettingsProps = {
  onChooseRoot: () => Promise<void>;
  onNormalizeDescriptions: () => Promise<void>;
  normalizingDescriptions: boolean;
  onBatchFixTitles: () => Promise<void>;
  batchFixingTitles: boolean;
  metadataSources: MetadataSourceSetting[];
  onSetMetadataSourceEnabled: (id: string, enabled: boolean) => Promise<void>;
  metadataSourcesSaving: boolean;
  themeMode: ThemeMode;
  setThemeMode: Dispatch<SetStateAction<ThemeMode>>;
};

export type AppRoutesMissingFilesProps = {
  missingFiles: MissingFileItem[];
  onRelinkMissing: (fileId: string) => void | Promise<void>;
  onRemoveMissing: (fileId: string) => void | Promise<void>;
  onRemoveAllMissing: () => void | Promise<void>;
  onRescanMissing: () => void | Promise<void>;
};

export type AppRoutesEditProps = {
  previousView: View;
  onItemUpdate: () => void | Promise<void>;
  editCoverUrl: string | null;
  detailsVersion: number;
  matchQuery: string;
  onMatchQueryChange: (value: string) => void;
  matchLoading: boolean;
  matchCandidates: EnrichmentCandidate[];
  onMatchSearch: (query: string) => void | Promise<void>;
  onMatchApply: (candidate: EnrichmentCandidate) => void | Promise<void>;
  matchApplyingId: string | null;
  onQueueRemoveItem: (itemId: string) => void | Promise<void>;
  getCandidateCoverUrl: (candidate: EnrichmentCandidate) => string | null;
};

export type AppRoutesTagsProps = {
  tags: Tag[];
  newTagName: string;
  setNewTagName: Dispatch<SetStateAction<string>>;
  newTagColor: string;
  setNewTagColor: Dispatch<SetStateAction<string>>;
  handleCreateTag: () => void | Promise<void>;
  handleUpdateTag: (tagId: string, name: string, color: string) => void | Promise<void>;
};

export type AppRoutesEreaderProps = {
  ereaderDevices: EReaderDevice[];
  selectedEreaderDeviceId: string | null;
  setSelectedEreaderDeviceId: Dispatch<SetStateAction<string | null>>;
  ereaderBooks: EReaderBook[];
  ereaderSyncQueue: SyncQueueItem[];
  onAddEreaderDevice: (name: string, mountPath: string) => void | Promise<void>;
  onRemoveEreaderDevice: (deviceId: string) => void | Promise<void>;
  onScanEreaderDevice: (deviceId: string) => void | Promise<void>;
  onQueueEreaderAdd: (itemId: string) => void | Promise<void>;
  onQueueEreaderRemove: (ereaderPath: string) => void | Promise<void>;
  onQueueEreaderImport: (ereaderPath: string) => void | Promise<void>;
  onQueueEreaderUpdate: (itemId: string, ereaderPath: string) => void | Promise<void>;
  onExecuteSync: () => void;
  onOpenChangesFromEreader: () => void;
  onRefreshDevices: () => void | Promise<void>;
  ereaderScanning: boolean;
  ereaderScanProgress: ScanProgress | null;
  ereaderSyncing: boolean;
  ereaderSyncProgress: SyncProgress | null;
};

export type AppRoutesProps = {
  view: View;
  setView: Dispatch<SetStateAction<View>>;
  isDesktop: boolean;
  library: AppRoutesLibraryProps;
  enrich: AppRoutesEnrichProps;
  inbox: AppRoutesInboxProps;
  duplicates: AppRoutesDuplicatesProps;
  fix: AppRoutesFixProps;
  changes: AppRoutesChangesProps;
  organizer: AppRoutesOrganizerProps;
  settings: AppRoutesSettingsProps;
  missingFiles: AppRoutesMissingFilesProps;
  edit: AppRoutesEditProps;
  tags: AppRoutesTagsProps;
  ereader: AppRoutesEreaderProps;
};
