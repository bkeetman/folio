import type { Dispatch, SetStateAction } from "react";
import type { Tag } from "../types/library";
import { Button, Input, Separator } from "../components/ui";
import { TAG_COLORS, getTagColorClass, getTagSwatchClass } from "../lib/tagColors";
import { FolderOpen, PencilLine, Sparkles } from "lucide-react";

type InspectorProps = {
  selectedItem: {
    id: string;
    title: string;
    author: string;
    year: number | string;
    format: string;
    status: string;
    cover: string | null;
  } | null;
  selectedTags: Tag[];
  availableTags: Tag[];
  handleAddTag: (tagId: string) => void;
  handleRemoveTag: (tagId: string) => void;
  newTagName: string;
  setNewTagName: Dispatch<SetStateAction<string>>;
  newTagColor: string;
  setNewTagColor: Dispatch<SetStateAction<string>>;
  handleCreateTag: () => void;
  handleOpenMatchModal: () => void;
  isDesktop: boolean;
  clearCoverOverride: (itemId: string) => void;
  fetchCoverOverride: (itemId: string) => void;
};

export function Inspector({
  selectedItem,
  selectedTags,
  availableTags,
  handleAddTag,
  handleRemoveTag,
  newTagName,
  setNewTagName,
  newTagColor,
  setNewTagColor,
  handleCreateTag,
  handleOpenMatchModal,
  isDesktop,
  clearCoverOverride,
  fetchCoverOverride,
}: InspectorProps) {
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
        <div className="rounded-md border border-[var(--app-border)] bg-white/80 p-3">
          <div className="flex gap-3">
            <div className="h-28 w-20 overflow-hidden rounded-md border border-[var(--app-border)] bg-[#fffaf4]">
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
              <div className="text-[13px] font-semibold">{selectedItem.title}</div>
              <div className="text-xs text-[var(--app-ink-muted)]">{selectedItem.author}</div>
              <div className="text-xs text-[var(--app-ink-muted)]">{selectedItem.year}</div>
              <div className="text-xs text-[var(--app-ink-muted)]">{selectedItem.format}</div>
              <div className="text-xs text-[var(--app-ink-muted)]">{selectedItem.status}</div>
            </div>
          </div>

          <div className="mt-3">
            <div className="text-[10px] uppercase tracking-[0.12em] text-[var(--app-ink-muted)]">
              Tags
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
                      className={`rounded-full border px-2 py-0.5 text-[11px] hover:bg-white ${getTagColorClass(tag.color)}`}
                      onClick={() => handleAddTag(tag.id)}
                    >
                      {tag.name}
                    </button>
                  ))
                ) : (
                  <span className="text-xs text-[var(--app-ink-muted)]">No tags available.</span>
                )}
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <Input
                  value={newTagName}
                  onChange={(event) => setNewTagName(event.target.value)}
                  placeholder="New tag name"
                  className="h-8 min-w-0 flex-1 text-xs"
                />
                <div className="flex items-center gap-1 rounded-md border border-[var(--app-border)] bg-white px-2 py-1">
                  {TAG_COLORS.map((color) => (
                    <button
                      key={color.value}
                      type="button"
                      className={`h-5 w-5 rounded-full border ${getTagSwatchClass(color.value)} ${newTagColor === color.value ? "ring-2 ring-[var(--app-accent)]" : ""}`}
                      onClick={() => setNewTagColor(color.value)}
                    />
                  ))}
                </div>
                <Button
                  variant="toolbar"
                  size="sm"
                  onClick={handleCreateTag}
                  disabled={!newTagName.trim()}
                >
                  Create
                </Button>
              </div>
            </div>
          </div>

          <div className="mt-3 grid grid-cols-2 gap-2">
            <Button variant="toolbar" size="sm" className="w-full justify-center">
              <FolderOpen size={14} />
              Reveal
            </Button>
            <Button variant="toolbar" size="sm" className="w-full justify-center">
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
        </div>
      ) : (
        <div className="text-xs text-[var(--app-ink-muted)]">
          Select a book to see details.
        </div>
      )}
    </aside>
  );
}
