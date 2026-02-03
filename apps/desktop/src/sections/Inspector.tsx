import { invoke } from "@tauri-apps/api/core";
import { BookOpen, FileText, FolderOpen, Globe, HardDrive, PencilLine, Sparkles } from "lucide-react";
import type { Dispatch, SetStateAction } from "react";
import { useEffect, useState } from "react";
import { Button, Separator } from "../components/ui";
import { getLanguageFlag, getLanguageName } from "../lib/languageFlags";
import { getTagColorClass } from "../lib/tagColors";
import type { FileItem, Tag, View } from "../types/library";

type EReaderSyncStatus = {
  isOnDevice: boolean;
  isInQueue: boolean;
  matchConfidence: "exact" | "isbn" | "title" | "fuzzy" | null;
};

type InspectorProps = {
  selectedItem: {
    id: string;
    title: string;
    author: string;
    authors?: string[];
    year: number | string;
    format: string;
    status: string;
    cover: string | null;
    series?: string | null;
    seriesIndex?: number | null;
    language?: string | null;
  } | null;
  // Available languages for this book (other editions in different languages)
  availableLanguages?: string[];
  selectedTags: Tag[];
  availableTags: Tag[];
  handleAddTag: (tagId: string) => void;
  handleRemoveTag: (tagId: string) => void;
  handleOpenMatchModal: () => void;
  isDesktop: boolean;
  clearCoverOverride: (itemId: string) => void;
  fetchCoverOverride: (itemId: string) => void;
  // Navigation
  setView: Dispatch<SetStateAction<View>>;
  setSelectedAuthorNames: Dispatch<SetStateAction<string[]>>;
  setSelectedSeries: Dispatch<SetStateAction<string[]>>;
  onNavigateToEdit: () => void;
  // eReader sync
  ereaderConnected: boolean;
  ereaderSyncStatus: EReaderSyncStatus | null;
  onQueueEreaderAdd: (itemId: string) => void;
};

export function Inspector({
  selectedItem,
  availableLanguages = [],
  selectedTags,
  availableTags,
  handleAddTag,
  handleRemoveTag,
  handleOpenMatchModal,
  isDesktop,
  clearCoverOverride,
  fetchCoverOverride,
  setView,
  setSelectedAuthorNames,
  setSelectedSeries,
  ereaderConnected,
  ereaderSyncStatus,
  onQueueEreaderAdd,
  onNavigateToEdit,
}: InspectorProps) {
  const [files, setFiles] = useState<FileItem[]>([]);


  useEffect(() => {
    if (selectedItem) {
      invoke<FileItem[]>("get_item_files", { itemId: selectedItem.id })
        .then(setFiles)
        .catch(console.error);
    } else {
      setFiles([]);
    }
  }, [selectedItem]);



  const handleReveal = (path: string) => {
    invoke("reveal_file", { path }).catch(console.error);
  };

  const handleAuthorClick = (authorName: string) => {
    setSelectedAuthorNames([authorName]);
    setSelectedSeries([]);
    setView("library-books");
  };

  const handleSeriesClick = (seriesName: string) => {
    setSelectedSeries([seriesName]);
    setSelectedAuthorNames([]);
    setView("library-books");
  };
  return (
    <aside className="flex h-screen flex-col gap-3 overflow-hidden border-l border-[var(--app-border)] bg-[var(--app-surface)] px-3 py-4">
      <div className="flex items-center justify-between">
        <div className="text-[10px] font-semibold uppercase tracking-[0.2em] text-[var(--app-ink-muted)]">
          Details
        </div>
        <div className="rounded-full border border-[var(--app-border)] bg-white/70 px-2 py-0.5 text-[10px] text-[var(--app-ink-muted)]">
          Inspector
        </div>
      </div>
      <Separator />
      {selectedItem ? (
        <div className="flex h-full flex-col overflow-y-auto pb-4 [&::-webkit-scrollbar]:hidden">
          <div className="rounded-md border border-[var(--app-border)] bg-white/80 p-3">
            <div className="flex gap-3">
              <div className="h-28 w-20 flex-none overflow-hidden rounded-md border border-[var(--app-border)] bg-[#fffaf4]">
                {selectedItem.cover ? (
                  <img
                    className="h-full w-full object-cover"
                    src={selectedItem.cover}
                    alt=""
                    onError={() => {
                      clearCoverOverride(selectedItem.id);
                      void fetchCoverOverride(selectedItem.id);
                    }}
                  />
                ) : (
                  <div className="flex h-full w-full items-center justify-center text-[10px] uppercase tracking-[0.12em] text-[var(--app-ink-muted)]">
                    {selectedItem.format}
                  </div>
                )}
              </div>

              <div className="flex flex-1 flex-col gap-1">
                <div className="text-[13px] font-semibold leading-tight">{selectedItem.title}</div>
                {selectedItem.authors && selectedItem.authors.length > 0 ? (
                  <div className="flex flex-wrap gap-1">
                    {selectedItem.authors.map((author, i) => (
                      <span key={author}>
                        <button
                          className="text-xs text-[var(--app-accent-strong)] hover:underline"
                          onClick={() => handleAuthorClick(author)}
                        >
                          {author}
                        </button>
                        {i < selectedItem.authors!.length - 1 && (
                          <span className="text-xs text-[var(--app-ink-muted)]">, </span>
                        )}
                      </span>
                    ))}
                  </div>
                ) : (
                  <div className="text-xs text-[var(--app-ink-muted)]">{selectedItem.author}</div>
                )}
                <div className="text-xs text-[var(--app-ink-muted)]">{selectedItem.year}</div>
                {selectedItem.series && (
                  <button
                    className="flex items-center gap-1 text-left text-xs text-[var(--app-accent-strong)] hover:underline"
                    onClick={() => handleSeriesClick(selectedItem.series!)}
                  >
                    <BookOpen size={12} />
                    {selectedItem.series}
                    {selectedItem.seriesIndex && (
                      <span className="ml-1 rounded bg-[rgba(208,138,70,0.15)] px-1.5 py-0.5 text-[10px] font-medium">
                        #{selectedItem.seriesIndex}
                      </span>
                    )}
                  </button>
                )}
                {selectedItem.language && (
                  <div className="flex items-center gap-1.5 text-xs text-[var(--app-ink-muted)]">
                    <span>{getLanguageFlag(selectedItem.language)}</span>
                    <span>{getLanguageName(selectedItem.language)}</span>
                  </div>
                )}
                <div className="text-xs text-[var(--app-ink-muted)]">{selectedItem.format}</div>
              </div>
            </div>


            {files.length > 0 && (
              <div className="mt-3">
                <div className="text-[10px] uppercase tracking-[0.12em] text-[var(--app-ink-muted)] mb-1">
                  Files
                </div>
                <div className="flex flex-col gap-1">
                  {files.map((file) => (
                    <div key={file.id} className="group flex items-center justify-between rounded border border-transparent bg-app-bg/50 px-2 py-1.5 hover:border-app-border hover:bg-white">
                      <div className="flex items-center gap-2 overflow-hidden">
                        <FileText size={12} className="text-app-ink-muted flex-none" />
                        <div className="flex flex-col overflow-hidden">
                          <span className="truncate text-[11px] font-medium leading-none" title={file.filename}>
                            {file.filename}
                          </span>
                          <span className="truncate text-[9px] text-app-ink-muted leading-tight" title={file.path}>
                            {file.path}
                          </span>
                        </div>
                      </div>
                      <button
                        onClick={() => handleReveal(file.path)}
                        className="hidden opacity-0 group-hover:block group-hover:opacity-100 p-1 hover:bg-app-bg rounded transition-all"
                        title="Reveal in Finder"
                      >
                        <FolderOpen size={12} className="text-app-ink-muted" />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="mt-3">
              <div className="text-[10px] uppercase tracking-[0.12em] text-[var(--app-ink-muted)]">
                Tags
              </div>
              <div className="mt-2 flex flex-wrap gap-2">
                {selectedTags.length ? (
                  selectedTags.map((tag) => (
                    <button
                      key={tag.id}
                      className={`flex items - center gap - 1 rounded - full border px - 2 py - 0.5 text - [11px] ${getTagColorClass(tag.color)} `}
                      onClick={() => handleRemoveTag(tag.id)}
                    >
                      {tag.name}
                      <span className="text-[10px]">×</span>
                    </button>
                  ))
                ) : (
                  <span className="text-xs text-[var(--app-ink-muted)]">No tags yet.</span>
                )}
              </div>

              <div className="mt-3">
                <div className="text-[10px] uppercase tracking-[0.12em] text-[var(--app-ink-muted)]">
                  Add tag
                </div>
                <div className="mt-2 flex flex-wrap gap-2">
                  {availableTags.length ? (
                    availableTags.map((tag) => (
                      <button
                        key={tag.id}
                        className={`rounded - full border px - 2 py - 0.5 text - [11px] hover: bg - white ${getTagColorClass(tag.color)} `}
                        onClick={() => handleAddTag(tag.id)}
                      >
                        {tag.name}
                      </button>
                    ))
                  ) : (
                    <span className="text-xs text-[var(--app-ink-muted)]">No tags available.</span>
                  )}
                </div>
              </div>
            </div>

            {/* Available languages (other editions) */}
            {availableLanguages.length > 1 && (
              <div className="mt-3">
                <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-[0.12em] text-[var(--app-ink-muted)]">
                  <Globe size={12} />
                  Beschikbare talen
                </div>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {availableLanguages.map((lang) => {
                    const flag = getLanguageFlag(lang);
                    const name = getLanguageName(lang);
                    const isCurrent = lang === selectedItem.language;
                    return (
                      <span
                        key={lang}
                        className={`inline - flex items - center gap - 1 rounded - full border px - 2 py - 0.5 text - [11px] ${isCurrent
                          ? "border-[rgba(208,138,70,0.6)] bg-[rgba(208,138,70,0.12)]"
                          : "border-[var(--app-border)] bg-white/80"
                          } `}
                        title={name}
                      >
                        {flag && <span>{flag}</span>}
                        <span>{name}</span>
                      </span>
                    );
                  })}
                </div>
              </div>
            )}

            <div className="mt-3 grid grid-cols-2 gap-2">
              <Button
                variant="toolbar"
                size="sm"
                className="w-full justify-center"
                onClick={() => files[0] && handleReveal(files[0].path)}
                disabled={files.length === 0}
              >
                <FolderOpen size={14} />
                Reveal
              </Button>
              <Button
                variant="toolbar"
                size="sm"
                className="w-full justify-center"
                onClick={onNavigateToEdit}
              >
                <PencilLine size={14} />
                Edit
              </Button>
              <Button
                variant="toolbar"
                size="sm"
                className="col-span-2 w-full justify-center"
                onClick={handleOpenMatchModal}
                disabled={!isDesktop}
              >
                <Sparkles size={14} />
                Match metadata
              </Button>
            </div>

            {/* eReader Sync Section */}
            {ereaderConnected && (
              <div className="mt-3 pt-3 border-t border-[var(--app-border)]">
                <div className="text-[10px] uppercase tracking-[0.12em] text-[var(--app-ink-muted)] mb-2">
                  eReader
                </div>
                {ereaderSyncStatus?.isOnDevice ? (
                  <div className="flex items-center gap-2">
                    <span className="inline-flex items-center gap-1.5 px-2 py-1 rounded text-xs font-medium bg-emerald-100 text-emerald-700">
                      <HardDrive size={12} />
                      Synced
                    </span>
                    {ereaderSyncStatus.matchConfidence === "fuzzy" && (
                      <span className="text-[10px] text-[var(--app-ink-muted)]">(fuzzy match)</span>
                    )}
                  </div>
                ) : ereaderSyncStatus?.isInQueue ? (
                  <span className="inline-flex items-center gap-1.5 px-2 py-1 rounded text-xs font-medium bg-purple-100 text-purple-700">
                    <HardDrive size={12} />
                    In queue
                  </span>
                ) : (
                  <Button
                    variant="toolbar"
                    size="sm"
                    className="w-full justify-center"
                    onClick={() => onQueueEreaderAdd(selectedItem.id)}
                  >
                    <HardDrive size={14} />
                    Send to eReader
                  </Button>
                )}
              </div>
            )}
          </div>
        </div>
      ) : (
        <div className="text-xs text-[var(--app-ink-muted)]">
          Select a book to see details.
        </div>
      )}
    </aside>
  );
}
