import { invoke } from "@tauri-apps/api/core";
import { BookOpen, FileText, FolderOpen, Globe, HardDrive, PencilLine } from "lucide-react";
import type { Dispatch, SetStateAction } from "react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button, Separator } from "../components/ui";
import { getLanguageFlag, getLanguageName, isKnownLanguageCode } from "../lib/languageFlags";
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
  width: number;
};

export function Inspector({
  selectedItem,
  availableLanguages = [],
  selectedTags,
  availableTags,
  handleAddTag,
  handleRemoveTag,
  clearCoverOverride,
  fetchCoverOverride,
  setView,
  setSelectedAuthorNames,
  setSelectedSeries,
  ereaderConnected,
  ereaderSyncStatus,
  onQueueEreaderAdd,
  onNavigateToEdit,
  width,
}: InspectorProps) {
  const { t } = useTranslation();
  const compactLayout = width < 320;
  const hasKnownItemLanguage = isKnownLanguageCode(selectedItem?.language);
  const [fileState, setFileState] = useState<{ itemId: string | null; files: FileItem[] }>({
    itemId: null,
    files: [],
  });
  const selectedItemId = selectedItem?.id ?? null;

  useEffect(() => {
    if (!selectedItemId) return;
    let cancelled = false;
    invoke<FileItem[]>("get_item_files", { itemId: selectedItemId })
      .then((files) => {
        if (cancelled) return;
        setFileState({ itemId: selectedItemId, files });
      })
      .catch(console.error);
    return () => {
      cancelled = true;
    };
  }, [selectedItemId]);

  const files = selectedItem && fileState.itemId === selectedItem.id ? fileState.files : [];

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
    <aside className="flex h-screen flex-col gap-3 overflow-hidden border-l border-[var(--app-border-soft)] bg-[var(--app-surface)] px-3 py-4">
      <div className="flex items-center justify-between">
        <div className="text-[10px] font-semibold uppercase tracking-[0.2em] text-[var(--app-ink-muted)]">
          {t("inspector.details")}
        </div>
        <div className="rounded-full border border-app-border bg-app-surface/50 px-2 py-0.5 text-[10px] text-app-ink-muted">
          {t("inspector.inspector")}
        </div>
      </div>
      <Separator />
      {selectedItem ? (
        <div className="flex h-full flex-col overflow-y-auto pb-4 [&::-webkit-scrollbar]:hidden">
          <div className="rounded-md border border-[var(--app-border-muted)] bg-app-surface/40 p-3">
            <div className={compactLayout ? "flex flex-col gap-3" : "flex gap-3"}>
              <div
                className={
                  compactLayout
                    ? "mx-auto h-36 w-24 flex-none overflow-hidden rounded-md border border-[var(--app-border-muted)] bg-app-bg"
                    : "h-32 w-24 flex-none overflow-hidden rounded-md border border-[var(--app-border-muted)] bg-app-bg"
                }
              >
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

              <div className="flex min-w-0 flex-1 flex-col gap-2">
                <div className="break-words text-[15px] font-semibold leading-tight">{selectedItem.title}</div>
                {selectedItem.authors && selectedItem.authors.length > 0 ? (
                  <div className="space-y-1">
                    {selectedItem.authors.map((author, i) => (
                      <div key={`${author}-${i}`}>
                        <button
                          className="text-left text-sm text-[var(--app-accent-strong)] hover:underline"
                          onClick={() => handleAuthorClick(author)}
                        >
                          {author}
                        </button>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-xs text-[var(--app-ink-muted)]">{selectedItem.author}</div>
                )}
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="rounded-full border border-[var(--app-border-soft)] bg-app-bg/40 px-2 py-0.5 text-[11px] text-[var(--app-ink-muted)]">
                    {selectedItem.year}
                  </span>
                  <span className="rounded-full border border-[var(--app-border-soft)] bg-app-bg/40 px-2 py-0.5 text-[11px] text-[var(--app-ink-muted)]">
                    {selectedItem.format}
                  </span>
                </div>
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
                {selectedItem.language && hasKnownItemLanguage && (
                  <div className="flex items-center gap-1.5 text-xs text-[var(--app-ink-muted)]">
                    <span>{getLanguageFlag(selectedItem.language)}</span>
                    <span>{getLanguageName(selectedItem.language)}</span>
                  </div>
                )}
              </div>
            </div>


            {files.length > 0 && (
              <div className="mt-3">
                <div className="text-[10px] uppercase tracking-[0.12em] text-[var(--app-ink-muted)] mb-1">
                  {t("inspector.files")}
                </div>
                <div className="flex flex-col gap-1">
                  {files.map((file) => (
                    <div key={file.id} className="group flex items-center justify-between rounded border border-transparent bg-app-bg/30 px-2 py-1.5 hover:border-app-border hover:bg-app-surface">
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
                        title={t("inspector.revealInFinder")}
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
                {t("inspector.tags")}
              </div>
              <div className="mt-2 flex flex-wrap gap-2">
                {selectedTags.length ? (
                  selectedTags.map((tag) => (
                    <button
                      key={tag.id}
                      className={`flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] ${getTagColorClass(tag.color)}`}
                      onClick={() => handleRemoveTag(tag.id)}
                    >
                      {tag.name}
                      <span className="text-[10px]">×</span>
                    </button>
                  ))
                ) : (
                  <span className="text-xs text-[var(--app-ink-muted)]">{t("inspector.noTagsYet")}</span>
                )}
              </div>

              <div className="mt-3">
                <div className="text-[10px] uppercase tracking-[0.12em] text-[var(--app-ink-muted)]">
                  {t("inspector.addTag")}
                </div>
                <div className="mt-2 flex flex-wrap gap-2">
                  {availableTags.length ? (
                    availableTags.map((tag) => (
                      <button
                        key={tag.id}
                        className={`rounded-full border px-2 py-0.5 text-[11px] hover:bg-app-surface-hover ${getTagColorClass(tag.color)}`}
                        onClick={() => handleAddTag(tag.id)}
                      >
                        {tag.name}
                      </button>
                    ))
                  ) : (
                    <span className="text-xs text-[var(--app-ink-muted)]">{t("inspector.noTagsAvailable")}</span>
                  )}
                </div>
              </div>
            </div>

            {/* Available languages (other editions) */}
            {availableLanguages.length > 1 && (
              <div className="mt-3">
                <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-[0.12em] text-[var(--app-ink-muted)]">
                  <Globe size={12} />
                  {t("inspector.availableLanguages")}
                </div>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {availableLanguages.filter((lang) => isKnownLanguageCode(lang)).map((lang) => {
                    const flag = getLanguageFlag(lang);
                    const name = getLanguageName(lang);
                    const isCurrent = lang === selectedItem.language;
                    return (
                      <span
                        key={lang}
                        className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] ${isCurrent
                          ? "border-[var(--app-accent)] border-opacity-40 bg-app-accent/10"
                          : "border-[var(--app-border-soft)] bg-app-surface/50"
                          }`}
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
                {t("inspector.reveal")}
              </Button>
              <Button
                variant="toolbar"
                size="sm"
                className="w-full justify-center"
                onClick={onNavigateToEdit}
              >
                <PencilLine size={14} />
                {t("inspector.edit")}
              </Button>
            </div>

            {/* eReader Sync Section */}
            {ereaderConnected && (
              <div className="mt-3 pt-3 border-t border-[var(--app-border)]">
                <div className="text-[10px] uppercase tracking-[0.12em] text-[var(--app-ink-muted)] mb-2">
                  {t("inspector.ereader")}
                </div>
                {ereaderSyncStatus?.isOnDevice ? (
                  <div className="flex items-center gap-2">
                    <span className="inline-flex items-center gap-1.5 px-2 py-1 rounded text-xs font-medium bg-emerald-100 text-emerald-700">
                      <HardDrive size={12} />
                      {t("inspector.synced")}
                    </span>
                    {ereaderSyncStatus.matchConfidence === "fuzzy" && (
                      <span className="text-[10px] text-[var(--app-ink-muted)]">({t("inspector.fuzzyMatch")})</span>
                    )}
                  </div>
                ) : ereaderSyncStatus?.isInQueue ? (
                  <span className="inline-flex items-center gap-1.5 px-2 py-1 rounded text-xs font-medium bg-purple-100 text-purple-700">
                    <HardDrive size={12} />
                    {t("inspector.inQueue")}
                  </span>
                ) : (
                  <Button
                    variant="toolbar"
                    size="sm"
                    className="w-full justify-center"
                    onClick={() => onQueueEreaderAdd(selectedItem.id)}
                  >
                    <HardDrive size={14} />
                    {t("inspector.sendToEreader")}
                  </Button>
                )}
              </div>
            )}
          </div>
        </div>
      ) : (
        <div className="text-xs text-[var(--app-ink-muted)]">
          {t("inspector.selectBook")}
        </div>
      )}
    </aside>
  );
}
