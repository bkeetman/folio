import type { Dispatch, RefObject, SetStateAction } from "react";
import { AuthorsView } from "./AuthorsView";
import { BookEditView } from "./BookEditView";
import { CategoriesView } from "./CategoriesView";
import { ChangesView } from "./ChangesView";
import { DuplicatesView } from "./DuplicatesView";
import { EReaderView } from "./EReaderView";
import { FixView } from "./FixView";
import { ImportView } from "./ImportView";
import { InboxView } from "./InboxView";
import { LibraryView } from "./LibraryView";
import { MissingFilesView } from "./MissingFilesView";
import { OrganizerView } from "./OrganizerView";
import { SettingsView } from "./SettingsView";
import { SeriesView } from "./SeriesView";
import { TagsView } from "./TagsView";
import type { FilteredBook } from "../hooks/useLibrarySelectors";
import type { ThemeMode } from "../hooks/useTheme";
import type {
  DuplicateGroup,
  EnrichmentCandidate,
  FixFilter,
  InboxItem,
  ItemMetadata,
  LibraryFilter,
  LibraryItem,
  LibrarySort,
  Category,
  MetadataSourceSetting,
  MissingFileItem,
  OperationProgress,
  ImportRequest,
  OrganizerLog,
  OrganizePlan,
  PendingChange,
  SyncProgress,
  SyncQueueItem,
  Tag,
  View,
  EReaderDevice,
  EReaderBook,
} from "../types/library";

type AppRoutesProps = {
  view: View;
  setView: Dispatch<SetStateAction<View>>;
  isDesktop: boolean;
  libraryReady: boolean;
  libraryItemsLength: number;
  sortedBooks: FilteredBook[];
  allBooks: FilteredBook[];
  selectedItemId: string | null;
  setSelectedItemId: Dispatch<SetStateAction<string | null>>;
  libraryFilter: LibraryFilter;
  setLibraryFilter: Dispatch<SetStateAction<LibraryFilter>>;
  librarySort: LibrarySort;
  setLibrarySort: Dispatch<SetStateAction<LibrarySort>>;
  tags: Tag[];
  selectedTagIds: string[];
  setSelectedTagIds: Dispatch<SetStateAction<string[]>>;
  grid: boolean;
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
  onEnrichAll: (itemIds?: string[]) => void | Promise<void>;
  onCancelEnrich: () => void | Promise<void>;
  enriching: boolean;
  enrichingItems: Set<string>;
  enrichProgress: OperationProgress | null;
  uniqueAuthors: Array<{ name: string; bookCount: number }>;
  uniqueSeries: Array<{ name: string; bookCount: number }>;
  uniqueCategories: Category[];
  inbox: InboxItem[];
  sampleInboxItems: InboxItem[];
  duplicates: DuplicateGroup[];
  sampleDuplicateGroups: DuplicateGroup[];
  titleDuplicates: DuplicateGroup[];
  fuzzyDuplicates: DuplicateGroup[];
  duplicateKeepSelection: Record<string, string>;
  setDuplicateKeepSelection: Dispatch<SetStateAction<Record<string, string>>>;
  handleResolveDuplicate: (group: DuplicateGroup, keepFileId: string) => void | Promise<void>;
  handleAutoSelectAll: (groups: DuplicateGroup[]) => void;
  handleResolveAll: (groups: DuplicateGroup[], applyNow: boolean) => void | Promise<void>;
  duplicateApplyNow: boolean;
  setDuplicateApplyNow: Dispatch<SetStateAction<boolean>>;
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
  pendingChangesStatus: "pending" | "applied" | "error";
  setPendingChangesStatus: Dispatch<SetStateAction<"pending" | "applied" | "error">>;
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
  organizeMode: string;
  setOrganizeMode: Dispatch<SetStateAction<string>>;
  organizeRoot: string | null;
  organizeTemplate: string;
  setOrganizeTemplate: Dispatch<SetStateAction<string>>;
  organizePlan: OrganizePlan | null;
  handlePlanOrganize: () => void | Promise<OrganizePlan | null>;
  handleApplyOrganize: () => void | Promise<void>;
  handleQueueOrganize: () => void | Promise<void>;
  organizeStatus: string | null;
  organizeProgress: OperationProgress | null;
  organizing: boolean;
  organizeLog: OrganizerLog | null;
  onImportCancel: () => void;
  onImportStart: (request: ImportRequest) => Promise<void>;
  onChooseRoot: () => Promise<void>;
  onNormalizeDescriptions: () => Promise<void>;
  normalizingDescriptions: boolean;
  onBatchFixTitles: () => Promise<void>;
  batchFixingTitles: boolean;
  metadataSources: MetadataSourceSetting[];
  onSetMetadataSourceEnabled: (id: string, enabled: boolean) => Promise<void>;
  metadataSourcesSaving: boolean;
  missingFiles: MissingFileItem[];
  onRelinkMissing: (fileId: string) => void | Promise<void>;
  onRemoveMissing: (fileId: string) => void | Promise<void>;
  onRemoveAllMissing: () => void | Promise<void>;
  onRescanMissing: () => void | Promise<void>;
  libraryItems: LibraryItem[];
  previousView: View;
  onEditItemUpdate: () => void | Promise<void>;
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
  newTagName: string;
  setNewTagName: Dispatch<SetStateAction<string>>;
  newTagColor: string;
  setNewTagColor: Dispatch<SetStateAction<string>>;
  handleCreateTag: () => void | Promise<void>;
  handleUpdateTag: (tagId: string, name: string, color: string) => void | Promise<void>;
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
  onRemoveFromQueue: (queueId: string) => void | Promise<void>;
  onExecuteSync: () => void;
  onRefreshDevices: () => void | Promise<void>;
  ereaderScanning: boolean;
  ereaderSyncing: boolean;
  ereaderSyncProgress: SyncProgress | null;
  themeMode: ThemeMode;
  setThemeMode: Dispatch<SetStateAction<ThemeMode>>;
};

export function AppRoutes(props: AppRoutesProps) {
  const {
    view,
    setView,
    isDesktop,
    libraryReady,
    libraryItemsLength,
    sortedBooks,
    allBooks,
    selectedItemId,
    setSelectedItemId,
    libraryFilter,
    setLibraryFilter,
    librarySort,
    setLibrarySort,
    tags,
    selectedTagIds,
    setSelectedTagIds,
    grid,
    fetchCoverOverride,
    clearCoverOverride,
    onVisibleItemIdsChange,
    scrollContainerRef,
    selectedAuthorNames,
    setSelectedAuthorNames,
    selectedSeries,
    setSelectedSeries,
    selectedGenres,
    setSelectedGenres,
    onEnrichAll,
    onCancelEnrich,
    enriching,
    enrichingItems,
    enrichProgress,
    uniqueAuthors,
    uniqueSeries,
    uniqueCategories,
    inbox,
    sampleInboxItems,
    duplicates,
    sampleDuplicateGroups,
    titleDuplicates,
    fuzzyDuplicates,
    duplicateKeepSelection,
    setDuplicateKeepSelection,
    handleResolveDuplicate,
    handleAutoSelectAll,
    handleResolveAll,
    duplicateApplyNow,
    setDuplicateApplyNow,
    allFixItems,
    fixIssues,
    selectedFixItemId,
    setSelectedFixItemId,
    fixFilter,
    setFixFilter,
    fixSearchQuery,
    setFixSearchQuery,
    fixLoading,
    fixCandidates,
    fixCoverUrl,
    onFetchFixCover,
    onSearchFixWithQuery,
    onApplyFixCandidate,
    onSaveFixMetadata,
    fixApplyingCandidateId,
    getCandidateCoverUrl,
    pendingChangesStatus,
    setPendingChangesStatus,
    pendingChangesApplying,
    pendingChangesLoading,
    pendingChanges,
    selectedChangeIds,
    toggleChangeSelection,
    handleApplyAllChanges,
    handleApplySelectedChanges,
    handleApplyChange,
    handleRemoveChange,
    handleRemoveAllChanges,
    handleRemoveSelectedChanges,
    confirmDeleteOpen,
    confirmDeleteIds,
    setConfirmDeleteOpen,
    setConfirmDeleteIds,
    handleConfirmDelete,
    applyingChangeIds,
    changeProgress,
    organizeMode,
    setOrganizeMode,
    organizeRoot,
    organizeTemplate,
    setOrganizeTemplate,
    organizePlan,
    handlePlanOrganize,
    handleApplyOrganize,
    handleQueueOrganize,
    organizeStatus,
    organizeProgress,
    organizing,
    organizeLog,
    onImportCancel,
    onImportStart,
    onChooseRoot,
    onNormalizeDescriptions,
    normalizingDescriptions,
    onBatchFixTitles,
    batchFixingTitles,
    metadataSources,
    onSetMetadataSourceEnabled,
    metadataSourcesSaving,
    missingFiles,
    onRelinkMissing,
    onRemoveMissing,
    onRemoveAllMissing,
    onRescanMissing,
    libraryItems,
    previousView,
    onEditItemUpdate,
    editCoverUrl,
    detailsVersion,
    matchQuery,
    onMatchQueryChange,
    matchLoading,
    matchCandidates,
    onMatchSearch,
    onMatchApply,
    matchApplyingId,
    onQueueRemoveItem,
    newTagName,
    setNewTagName,
    newTagColor,
    setNewTagColor,
    handleCreateTag,
    handleUpdateTag,
    ereaderDevices,
    selectedEreaderDeviceId,
    setSelectedEreaderDeviceId,
    ereaderBooks,
    ereaderSyncQueue,
    onAddEreaderDevice,
    onRemoveEreaderDevice,
    onScanEreaderDevice,
    onQueueEreaderAdd,
    onQueueEreaderRemove,
    onQueueEreaderImport,
    onRemoveFromQueue,
    onExecuteSync,
    onRefreshDevices,
    ereaderScanning,
    ereaderSyncing,
    ereaderSyncProgress,
    themeMode,
    setThemeMode,
  } = props;

  return (
    <section className="flex flex-col gap-4">
      {(view === "library" || view === "library-books") && !libraryReady ? (
        <div className="flex flex-col items-center justify-center gap-4 py-16">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-[var(--app-accent)] border-t-transparent" />
          <div className="text-sm text-[var(--app-ink-muted)]">Loading library...</div>
        </div>
      ) : null}

      {(view === "library" || view === "library-books") && libraryReady ? (
        <LibraryView
          isDesktop={isDesktop}
          libraryItemsLength={libraryItemsLength}
          filteredBooks={sortedBooks}
          selectedItemId={selectedItemId}
          setSelectedItemId={setSelectedItemId}
          libraryFilter={libraryFilter}
          setLibraryFilter={setLibraryFilter}
          librarySort={librarySort}
          setLibrarySort={setLibrarySort}
          tags={tags}
          selectedTagIds={selectedTagIds}
          setSelectedTagIds={setSelectedTagIds}
          grid={grid}
          fetchCoverOverride={(itemId) => void fetchCoverOverride(itemId)}
          clearCoverOverride={clearCoverOverride}
          onVisibleItemIdsChange={onVisibleItemIdsChange}
          scrollContainerRef={scrollContainerRef}
          selectedAuthorNames={selectedAuthorNames}
          setSelectedAuthorNames={setSelectedAuthorNames}
          selectedSeries={selectedSeries}
          setSelectedSeries={setSelectedSeries}
          selectedGenres={selectedGenres}
          setSelectedGenres={setSelectedGenres}
          enrichingItems={enrichingItems}
        />
      ) : null}

      {view === "library-authors" ? (
        <AuthorsView
          authors={uniqueAuthors}
          setSelectedAuthorNames={setSelectedAuthorNames}
          setSelectedGenres={setSelectedGenres}
          setView={setView}
        />
      ) : null}

      {view === "library-series" ? (
        <SeriesView
          series={uniqueSeries}
          books={allBooks}
          setSelectedSeries={setSelectedSeries}
          setSelectedGenres={setSelectedGenres}
          setView={setView}
          onSelectBook={(bookId) => {
            setSelectedItemId(bookId);
            setView("library-books");
          }}
        />
      ) : null}

      {view === "library-categories" ? (
        <CategoriesView
          categories={uniqueCategories}
          setSelectedGenres={setSelectedGenres}
          setView={setView}
        />
      ) : null}

      {view === "inbox" ? (
        <InboxView items={isDesktop ? inbox : sampleInboxItems} />
      ) : null}

      {view === "duplicates" ? (
        <DuplicatesView
          hashGroups={isDesktop ? duplicates : sampleDuplicateGroups}
          titleGroups={isDesktop ? titleDuplicates : []}
          fuzzyGroups={isDesktop ? fuzzyDuplicates : []}
          duplicateKeepSelection={duplicateKeepSelection}
          setDuplicateKeepSelection={setDuplicateKeepSelection}
          handleResolveDuplicate={(group, keepFileId) =>
            void handleResolveDuplicate(group, keepFileId)
          }
          handleAutoSelectAll={handleAutoSelectAll}
          handleResolveAll={(groups, applyNow) => void handleResolveAll(groups, applyNow)}
          applyNow={duplicateApplyNow}
          setApplyNow={setDuplicateApplyNow}
        />
      ) : null}

      {view === "fix" ? (
        <FixView
          items={allFixItems}
          inboxItems={isDesktop ? fixIssues : []}
          selectedItemId={selectedFixItemId}
          setSelectedItemId={setSelectedFixItemId}
          fixFilter={fixFilter}
          setFixFilter={setFixFilter}
          searchQuery={fixSearchQuery}
          setSearchQuery={setFixSearchQuery}
          searchLoading={fixLoading}
          searchCandidates={fixCandidates}
          coverUrl={fixCoverUrl}
          onFetchCover={onFetchFixCover}
          onSearchWithQuery={onSearchFixWithQuery}
          onApplyCandidate={(candidate) => void onApplyFixCandidate(candidate)}
          onSaveMetadata={onSaveFixMetadata}
          applyingCandidateId={fixApplyingCandidateId}
          getCandidateCoverUrl={getCandidateCoverUrl}
          onClearCover={clearCoverOverride}
          onItemUpdate={async () => {
            await onEditItemUpdate();
          }}
          isDesktop={isDesktop}
          onQueueRemoveItem={async (itemId) => {
            await onQueueRemoveItem(itemId);
          }}
          onEnrichAll={() => void onEnrichAll(allFixItems.map((item) => item.id))}
          onCancelEnrich={() => void onCancelEnrich()}
          enriching={enriching}
          enrichProgress={enrichProgress}
        />
      ) : null}

      {view === "changes" ? (
        <ChangesView
          pendingChangesStatus={pendingChangesStatus}
          setPendingChangesStatus={setPendingChangesStatus}
          pendingChangesApplying={pendingChangesApplying}
          pendingChangesLoading={pendingChangesLoading}
          pendingChanges={pendingChanges}
          selectedChangeIds={selectedChangeIds}
          toggleChangeSelection={toggleChangeSelection}
          handleApplyAllChanges={() => void handleApplyAllChanges()}
          handleApplySelectedChanges={() => void handleApplySelectedChanges()}
          handleApplyChange={(id) => void handleApplyChange(id)}
          handleRemoveChange={(id) => void handleRemoveChange(id)}
          handleRemoveAllChanges={() => void handleRemoveAllChanges()}
          handleRemoveSelectedChanges={() => void handleRemoveSelectedChanges()}
          confirmDeleteOpen={confirmDeleteOpen}
          confirmDeleteIds={confirmDeleteIds}
          setConfirmDeleteOpen={setConfirmDeleteOpen}
          setConfirmDeleteIds={setConfirmDeleteIds}
          handleConfirmDelete={() => void handleConfirmDelete()}
          applyingChangeIds={applyingChangeIds}
          changeProgress={changeProgress}
        />
      ) : null}

      {view === "organize" ? (
        <OrganizerView
          organizeMode={organizeMode}
          setOrganizeMode={setOrganizeMode}
          organizeRoot={organizeRoot}
          organizeTemplate={organizeTemplate}
          setOrganizeTemplate={setOrganizeTemplate}
          organizePlan={organizePlan}
          handlePlanOrganize={() => void handlePlanOrganize()}
          handleApplyOrganize={() => void handleApplyOrganize()}
          handleQueueOrganize={() => void handleQueueOrganize()}
          organizeStatus={organizeStatus}
          organizeProgress={organizeProgress}
          organizing={organizing}
          organizeLog={organizeLog}
        />
      ) : null}

      {view === "import" ? (
        <ImportView
          onCancel={onImportCancel}
          onImportStart={onImportStart}
          libraryRoot={organizeRoot}
          template={organizeTemplate}
        />
      ) : null}

      {view === "settings" ? (
        <SettingsView
          libraryRoot={organizeRoot}
          onChooseRoot={onChooseRoot}
          onNormalizeDescriptions={onNormalizeDescriptions}
          normalizingDescriptions={normalizingDescriptions}
          onBatchFixTitles={onBatchFixTitles}
          batchFixingTitles={batchFixingTitles}
          metadataSources={metadataSources}
          onSetMetadataSourceEnabled={onSetMetadataSourceEnabled}
          metadataSourcesSaving={metadataSourcesSaving}
          themeMode={themeMode}
          setThemeMode={setThemeMode}
        />
      ) : null}

      {view === "missing-files" ? (
        <MissingFilesView
          items={missingFiles}
          libraryRoot={organizeRoot}
          onRelink={async (fileId) => {
            await onRelinkMissing(fileId);
          }}
          onRemove={async (fileId) => {
            await onRemoveMissing(fileId);
          }}
          onRemoveAll={async () => {
            await onRemoveAllMissing();
          }}
          onRescan={async () => {
            await onRescanMissing();
          }}
        />
      ) : null}

      {view === "edit" ? (
        <BookEditView
          selectedItemId={selectedItemId}
          libraryItems={libraryItems}
          setView={setView}
          previousView={previousView}
          isDesktop={isDesktop}
          onItemUpdate={async () => {
            await onEditItemUpdate();
          }}
          coverUrl={editCoverUrl}
          onFetchCover={fetchCoverOverride}
          onClearCover={clearCoverOverride}
          detailsVersion={detailsVersion}
          matchQuery={matchQuery}
          onMatchQueryChange={onMatchQueryChange}
          matchLoading={matchLoading}
          matchCandidates={matchCandidates}
          onMatchSearch={(query) => void onMatchSearch(query)}
          onMatchApply={(candidate) => void onMatchApply(candidate)}
          matchApplyingId={matchApplyingId}
          onQueueRemoveItem={async (itemId) => {
            await onQueueRemoveItem(itemId);
          }}
          getCandidateCoverUrl={getCandidateCoverUrl}
        />
      ) : null}

      {view === "tags" ? (
        <TagsView
          tags={tags}
          newTagName={newTagName}
          setNewTagName={setNewTagName}
          newTagColor={newTagColor}
          setNewTagColor={setNewTagColor}
          handleCreateTag={() => void handleCreateTag()}
          handleUpdateTag={(tagId, name, color) => void handleUpdateTag(tagId, name, color)}
        />
      ) : null}

      {view === "ereader" ? (
        <EReaderView
          devices={ereaderDevices}
          selectedDeviceId={selectedEreaderDeviceId}
          setSelectedDeviceId={setSelectedEreaderDeviceId}
          ereaderBooks={ereaderBooks}
          syncQueue={ereaderSyncQueue}
          libraryItems={libraryItems}
          onAddDevice={async (name, mountPath) => {
            await onAddEreaderDevice(name, mountPath);
          }}
          onRemoveDevice={async (deviceId) => {
            await onRemoveEreaderDevice(deviceId);
          }}
          onScanDevice={async (deviceId) => {
            await onScanEreaderDevice(deviceId);
          }}
          onQueueAdd={async (itemId) => {
            await onQueueEreaderAdd(itemId);
          }}
          onQueueRemove={async (ereaderPath) => {
            await onQueueEreaderRemove(ereaderPath);
          }}
          onQueueImport={async (ereaderPath) => {
            await onQueueEreaderImport(ereaderPath);
          }}
          onRemoveFromQueue={async (queueId) => {
            await onRemoveFromQueue(queueId);
          }}
          onExecuteSync={onExecuteSync}
          onRefreshDevices={async () => {
            await onRefreshDevices();
          }}
          scanning={ereaderScanning}
          syncing={ereaderSyncing}
          syncProgress={ereaderSyncProgress}
        />
      ) : null}
    </section>
  );
}
