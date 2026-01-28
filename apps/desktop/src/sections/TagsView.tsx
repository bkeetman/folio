import type { Dispatch, SetStateAction } from "react";
import type { Tag } from "../types/library";
import { Button, Input } from "../components/ui";
import { TAG_COLORS, getTagColorClass, getTagSwatchClass } from "../lib/tagColors";

type TagsViewProps = {
  tags: Tag[];
  newTagName: string;
  setNewTagName: Dispatch<SetStateAction<string>>;
  newTagColor: string;
  setNewTagColor: Dispatch<SetStateAction<string>>;
  handleCreateTag: () => void;
};

export function TagsView({
  tags,
  newTagName,
  setNewTagName,
  newTagColor,
  setNewTagColor,
  handleCreateTag,
}: TagsViewProps) {
  return (
    <div className="grid gap-4">
      <section className="rounded-lg border border-[var(--app-border)] bg-white/80 p-4 shadow-soft">
        <div className="text-[10px] uppercase tracking-[0.2em] text-[var(--app-ink-muted)]">
          Create tag
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <Input
            value={newTagName}
            onChange={(event) => setNewTagName(event.target.value)}
            placeholder="New tag name"
            className="h-9 min-w-[180px] flex-1 text-xs"
          />
          <div className="flex flex-wrap items-center gap-1 rounded-md border border-[var(--app-border)] bg-white px-2 py-1">
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
        <div className="mt-2 text-[11px] text-[var(--app-ink-muted)]">
          Tags help organize and filter your library across views.
        </div>
      </section>

      <section className="rounded-lg border border-[var(--app-border)] bg-white/80 p-4 shadow-soft">
        <div className="text-[10px] uppercase tracking-[0.2em] text-[var(--app-ink-muted)]">
          All tags
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          {tags.length ? (
            tags.map((tag) => (
              <span
                key={tag.id}
                className={`rounded-full border px-2 py-0.5 text-[11px] ${getTagColorClass(tag.color)}`}
              >
                {tag.name}
              </span>
            ))
          ) : (
            <span className="text-xs text-[var(--app-ink-muted)]">No tags yet.</span>
          )}
        </div>
      </section>
    </div>
  );
}
