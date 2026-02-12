import { Suspense, lazy } from "react";
import { AuthorsView } from "../AuthorsView";
import { CategoriesView } from "../CategoriesView";
import { InboxView } from "../InboxView";
import { SeriesView } from "../SeriesView";
import { TagsView } from "../TagsView";
import type { AppRoutesProps } from "./types";

const LibraryView = lazy(() =>
  import("../LibraryView").then((module) => ({ default: module.LibraryView }))
);
const ChangesView = lazy(() =>
  import("../ChangesView").then((module) => ({ default: module.ChangesView }))
);
const DuplicatesView = lazy(() =>
  import("../DuplicatesView").then((module) => ({ default: module.DuplicatesView }))
);
const FixView = lazy(() =>
  import("../FixView").then((module) => ({ default: module.FixView }))
);
const OrganizerView = lazy(() =>
  import("../OrganizerView").then((module) => ({ default: module.OrganizerView }))
);
const ImportView = lazy(() =>
  import("../ImportView").then((module) => ({ default: module.ImportView }))
);
const SettingsView = lazy(() =>
  import("../SettingsView").then((module) => ({ default: module.SettingsView }))
);
const MissingFilesView = lazy(() =>
  import("../MissingFilesView").then((module) => ({ default: module.MissingFilesView }))
);
const BookEditView = lazy(() =>
  import("../BookEditView").then((module) => ({ default: module.BookEditView }))
);
const EReaderView = lazy(() =>
  import("../EReaderView").then((module) => ({ default: module.EReaderView }))
);

export function AppRouteViews({
  view,
  setView,
  isDesktop,
  library,
  enrich,
  inbox,
  duplicates,
  fix,
  changes,
  organizer,
  settings,
  missingFiles,
  edit,
  tags,
  ereader,
}: AppRoutesProps) {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-0 flex-1 items-center justify-center py-12 text-sm text-[var(--app-ink-muted)]">
          Loading view...
        </div>
      }
    >
      <>
        {(view === "library" || view === "library-books") && !library.libraryReady ? (
          <div className="flex flex-col items-center justify-center gap-4 py-16">
            <div className="h-8 w-8 animate-spin rounded-full border-2 border-[var(--app-accent)] border-t-transparent" />
            <div className="text-sm text-[var(--app-ink-muted)]">Loading library...</div>
          </div>
        ) : null}

        {(view === "library" || view === "library-books") && library.libraryReady ? (
          <LibraryView
            isDesktop={isDesktop}
            libraryItemsLength={library.libraryItemsLength}
            filteredBooks={library.sortedBooks}
            selectedItemId={library.selectedItemId}
            selectedBatchItemIds={library.selectedBatchItemIds}
            setSelectedItemId={library.setSelectedItemId}
            onToggleBatchSelect={library.onToggleBatchSelect}
            onSetBatchSelection={library.onSetBatchSelection}
            onClearBatchSelection={library.onClearBatchSelection}
            onApplyBatchMetadata={library.onApplyBatchMetadata}
            onRemoveSelectedBooks={library.onRemoveSelectedBooks}
            libraryFilter={library.libraryFilter}
            setLibraryFilter={library.setLibraryFilter}
            librarySort={library.librarySort}
            setLibrarySort={library.setLibrarySort}
            tags={library.tags}
            selectedTagIds={library.selectedTagIds}
            setSelectedTagIds={library.setSelectedTagIds}
            grid={library.grid}
            setGrid={library.setGrid}
            fetchCoverOverride={(itemId) => void library.fetchCoverOverride(itemId)}
            clearCoverOverride={library.clearCoverOverride}
            onVisibleItemIdsChange={library.onVisibleItemIdsChange}
            scrollContainerRef={library.scrollContainerRef}
            selectedAuthorNames={library.selectedAuthorNames}
            setSelectedAuthorNames={library.setSelectedAuthorNames}
            selectedSeries={library.selectedSeries}
            setSelectedSeries={library.setSelectedSeries}
            selectedGenres={library.selectedGenres}
            setSelectedGenres={library.setSelectedGenres}
            enrichingItems={library.enrichingItems}
          />
        ) : null}

      {view === "library-authors" ? (
        <AuthorsView
          authors={library.uniqueAuthors}
          selectedAuthorNames={library.selectedAuthorNames}
          setSelectedItemId={library.setSelectedItemId}
          setSelectedAuthorNames={library.setSelectedAuthorNames}
          setSelectedGenres={library.setSelectedGenres}
          setView={setView}
        />
      ) : null}

      {view === "library-series" ? (
        <SeriesView
          series={library.uniqueSeries}
          books={library.allBooks}
          setSelectedSeries={library.setSelectedSeries}
          setSelectedGenres={library.setSelectedGenres}
          setView={setView}
          onSelectBook={(bookId) => {
            library.setSelectedItemId(bookId);
            setView("library-books");
          }}
        />
      ) : null}

      {view === "library-categories" ? (
        <CategoriesView
          categories={library.uniqueCategories}
          setSelectedGenres={library.setSelectedGenres}
          setView={setView}
        />
      ) : null}

      {view === "inbox" ? (
        <InboxView items={isDesktop ? inbox.inbox : inbox.sampleInboxItems} />
      ) : null}

      {view === "duplicates" ? (
        <DuplicatesView
          hashGroups={isDesktop ? duplicates.duplicates : duplicates.sampleDuplicateGroups}
          titleGroups={isDesktop ? duplicates.titleDuplicates : []}
          fuzzyGroups={isDesktop ? duplicates.fuzzyDuplicates : []}
          duplicateKeepSelection={duplicates.duplicateKeepSelection}
          setDuplicateKeepSelection={duplicates.setDuplicateKeepSelection}
          handleResolveDuplicate={(group, keepFileId) =>
            void duplicates.handleResolveDuplicate(group, keepFileId)
          }
          handleAutoSelectAll={duplicates.handleAutoSelectAll}
          handleResolveAll={(groups) => void duplicates.handleResolveAll(groups)}
        />
      ) : null}

      {view === "fix" ? (
        <FixView
          items={fix.allFixItems}
          inboxItems={isDesktop ? fix.fixIssues : []}
          selectedItemId={fix.selectedFixItemId}
          setSelectedItemId={fix.setSelectedFixItemId}
          fixFilter={fix.fixFilter}
          setFixFilter={fix.setFixFilter}
          searchQuery={fix.fixSearchQuery}
          setSearchQuery={fix.setFixSearchQuery}
          searchLoading={fix.fixLoading}
          searchCandidates={fix.fixCandidates}
          coverUrl={fix.fixCoverUrl}
          onFetchCover={fix.onFetchFixCover}
          onSearchWithQuery={fix.onSearchFixWithQuery}
          onApplyCandidate={(candidate) => void fix.onApplyFixCandidate(candidate)}
          onSaveMetadata={fix.onSaveFixMetadata}
          applyingCandidateId={fix.fixApplyingCandidateId}
          getCandidateCoverUrl={fix.getCandidateCoverUrl}
          onClearCover={library.clearCoverOverride}
          onItemUpdate={async () => {
            await fix.onItemUpdate();
          }}
          isDesktop={isDesktop}
          onQueueRemoveItem={async (itemId) => {
            await fix.onQueueRemoveItem(itemId);
          }}
          onEnrichAll={() => void enrich.onEnrichAll(fix.allFixItems.map((item) => item.id))}
          onCancelEnrich={() => void enrich.onCancelEnrich()}
          enriching={enrich.enriching}
          enrichProgress={enrich.enrichProgress}
        />
      ) : null}

      {view === "changes" ? (
        <ChangesView
          pendingChangesStatus={changes.pendingChangesStatus}
          setPendingChangesStatus={changes.setPendingChangesStatus}
          changesSourceFilter={changes.changesSourceFilter}
          setChangesSourceFilter={changes.setChangesSourceFilter}
          changesDeviceFilter={changes.changesDeviceFilter}
          clearChangesDeviceFilter={changes.clearChangesDeviceFilter}
          pendingChangesApplying={changes.pendingChangesApplying}
          pendingChangesLoading={changes.pendingChangesLoading}
          pendingChanges={changes.pendingChanges}
          selectedChangeIds={changes.selectedChangeIds}
          toggleChangeSelection={changes.toggleChangeSelection}
          handleApplyAllChanges={() => void changes.handleApplyAllChanges()}
          handleApplySelectedChanges={() => void changes.handleApplySelectedChanges()}
          handleApplyChange={(id) => void changes.handleApplyChange(id)}
          handleRemoveChange={(id) => void changes.handleRemoveChange(id)}
          handleRemoveAllChanges={() => void changes.handleRemoveAllChanges()}
          handleRemoveSelectedChanges={() => void changes.handleRemoveSelectedChanges()}
          confirmDeleteOpen={changes.confirmDeleteOpen}
          confirmDeleteIds={changes.confirmDeleteIds}
          setConfirmDeleteOpen={changes.setConfirmDeleteOpen}
          setConfirmDeleteIds={changes.setConfirmDeleteIds}
          handleConfirmDelete={() => void changes.handleConfirmDelete()}
          applyingChangeIds={changes.applyingChangeIds}
          changeProgress={changes.changeProgress}
        />
      ) : null}

      {view === "organize" ? (
        <OrganizerView
          organizeMode={organizer.organizeMode}
          setOrganizeMode={organizer.setOrganizeMode}
          organizeRoot={organizer.organizeRoot}
          organizeTemplate={organizer.organizeTemplate}
          setOrganizeTemplate={organizer.setOrganizeTemplate}
          organizePlan={organizer.organizePlan}
          handlePlanOrganize={() => void organizer.handlePlanOrganize()}
          handleApplyOrganize={() => void organizer.handleApplyOrganize()}
          organizeStatus={organizer.organizeStatus}
          organizeProgress={organizer.organizeProgress}
          organizing={organizer.organizing}
          organizeLog={organizer.organizeLog}
        />
      ) : null}

      {view === "import" ? (
        <ImportView
          onCancel={organizer.onImportCancel}
          onImportStart={organizer.onImportStart}
          libraryRoot={organizer.organizeRoot}
          template={organizer.organizeTemplate}
        />
      ) : null}

      {view === "settings" ? (
        <SettingsView
          libraryRoot={organizer.organizeRoot}
          onChooseRoot={settings.onChooseRoot}
          onNormalizeDescriptions={settings.onNormalizeDescriptions}
          normalizingDescriptions={settings.normalizingDescriptions}
          onBatchFixTitles={settings.onBatchFixTitles}
          batchFixingTitles={settings.batchFixingTitles}
          metadataSources={settings.metadataSources}
          onSetMetadataSourceEnabled={settings.onSetMetadataSourceEnabled}
          metadataSourcesSaving={settings.metadataSourcesSaving}
          themeMode={settings.themeMode}
          setThemeMode={settings.setThemeMode}
        />
      ) : null}

      {view === "missing-files" ? (
        <MissingFilesView
          items={missingFiles.missingFiles}
          libraryRoot={organizer.organizeRoot}
          onRelink={async (fileId) => {
            await missingFiles.onRelinkMissing(fileId);
          }}
          onRemove={async (fileId) => {
            await missingFiles.onRemoveMissing(fileId);
          }}
          onRemoveAll={async () => {
            await missingFiles.onRemoveAllMissing();
          }}
          onRescan={async () => {
            await missingFiles.onRescanMissing();
          }}
        />
      ) : null}

      {view === "edit" ? (
        <BookEditView
          selectedItemId={library.selectedItemId}
          libraryItems={library.libraryItems}
          setView={setView}
          previousView={edit.previousView}
          isDesktop={isDesktop}
          onItemUpdate={async () => {
            await edit.onItemUpdate();
          }}
          coverUrl={edit.editCoverUrl}
          onFetchCover={library.fetchCoverOverride}
          onClearCover={library.clearCoverOverride}
          detailsVersion={edit.detailsVersion}
          matchQuery={edit.matchQuery}
          onMatchQueryChange={edit.onMatchQueryChange}
          matchLoading={edit.matchLoading}
          matchCandidates={edit.matchCandidates}
          onMatchSearch={(query) => void edit.onMatchSearch(query)}
          onMatchApply={(candidate) => void edit.onMatchApply(candidate)}
          matchApplyingId={edit.matchApplyingId}
          onQueueRemoveItem={async (itemId) => {
            await edit.onQueueRemoveItem(itemId);
          }}
          getCandidateCoverUrl={edit.getCandidateCoverUrl}
        />
      ) : null}

      {view === "tags" ? (
        <TagsView
          tags={tags.tags}
          newTagName={tags.newTagName}
          setNewTagName={tags.setNewTagName}
          newTagColor={tags.newTagColor}
          setNewTagColor={tags.setNewTagColor}
          handleCreateTag={() => void tags.handleCreateTag()}
          handleUpdateTag={(tagId, name, color) => void tags.handleUpdateTag(tagId, name, color)}
        />
      ) : null}

        {view === "ereader" ? (
          <EReaderView
            devices={ereader.ereaderDevices}
            selectedDeviceId={ereader.selectedEreaderDeviceId}
            setSelectedDeviceId={ereader.setSelectedEreaderDeviceId}
            ereaderBooks={ereader.ereaderBooks}
            syncQueue={ereader.ereaderSyncQueue}
            libraryItems={library.libraryItems}
            onAddDevice={async (name, mountPath) => {
              await ereader.onAddEreaderDevice(name, mountPath);
            }}
            onRemoveDevice={async (deviceId) => {
              await ereader.onRemoveEreaderDevice(deviceId);
            }}
            onScanDevice={async (deviceId) => {
              await ereader.onScanEreaderDevice(deviceId);
            }}
            onQueueAdd={async (itemId) => {
              await ereader.onQueueEreaderAdd(itemId);
            }}
            onQueueRemove={async (ereaderPath) => {
              await ereader.onQueueEreaderRemove(ereaderPath);
            }}
            onQueueImport={async (ereaderPath) => {
              await ereader.onQueueEreaderImport(ereaderPath);
            }}
            onQueueUpdate={async (itemId, ereaderPath) => {
              await ereader.onQueueEreaderUpdate(itemId, ereaderPath);
            }}
            onExecuteSync={ereader.onExecuteSync}
            onOpenChanges={ereader.onOpenChangesFromEreader}
            onRefreshDevices={async () => {
              await ereader.onRefreshDevices();
            }}
            scanning={ereader.ereaderScanning}
            scanProgress={ereader.ereaderScanProgress}
            syncing={ereader.ereaderSyncing}
            syncProgress={ereader.ereaderSyncProgress}
          />
        ) : null}
      </>
    </Suspense>
  );
}
