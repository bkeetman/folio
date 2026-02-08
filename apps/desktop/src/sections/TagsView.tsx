import type { Dispatch, SetStateAction } from "react";
import { useState } from "react";
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
  handleUpdateTag: (tagId: string, name: string, color: string) => void;
};

export function TagsView({
  tags,
  newTagName,
  setNewTagName,
  newTagColor,
  setNewTagColor,
  handleCreateTag,
  handleUpdateTag,
}: TagsViewProps) {
  const [edits, setEdits] = useState<Record<string, { name: string; color: string }>>({});

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
        <div className="mt-3 grid gap-2">
          {tags.length ? (
            tags.map((tag) => (
              <div
                key={tag.id}
                className="rounded-lg border border-[var(--app-border)] bg-app-surface/60 p-2"
              >
                {(() => {
                  const currentName = edits[tag.id]?.name ?? tag.name;
                  const currentColor = edits[tag.id]?.color ?? (tag.color ?? "amber");
                  return (
                <div className="flex flex-wrap items-center gap-2">
                  <span
                    className={`rounded-full border px-2 py-0.5 text-[11px] ${getTagColorClass(tag.color)}`}
                  >
                    {tag.name}
                  </span>
                  <Input
                    value={currentName}
                    onChange={(event) =>
                      setEdits((current) => ({
                        ...current,
                        [tag.id]: {
                          name: event.target.value,
                          color: currentColor,
                        },
                      }))
                    }
                    className="h-8 min-w-[160px] flex-1 text-xs"
                  />
                  <div className="flex flex-wrap items-center gap-1 rounded-md border border-[var(--app-border)] bg-white px-2 py-1">
                    {TAG_COLORS.map((color) => (
                      <button
                        key={`${tag.id}-${color.value}`}
                        type="button"
                        className={`h-4 w-4 rounded-full border ${getTagSwatchClass(color.value)} ${currentColor === color.value ? "ring-2 ring-[var(--app-accent)]" : ""}`}
                        onClick={() =>
                          setEdits((current) => ({
                            ...current,
                            [tag.id]: {
                              name: currentName,
                              color: color.value,
                            },
                          }))
                        }
                      />
                    ))}
                  </div>
                  <Button
                    variant="toolbar"
                    size="sm"
                    onClick={() =>
                      handleUpdateTag(
                        tag.id,
                        currentName,
                        currentColor,
                      )
                    }
                    disabled={
                      !currentName.trim() ||
                      (currentName.trim() === tag.name.trim() &&
                        currentColor === (tag.color ?? "amber"))
                    }
                  >
                    Save
                  </Button>
                </div>
                  );
                })()}
              </div>
            ))
          ) : (
            <span className="text-xs text-[var(--app-ink-muted)]">No tags yet.</span>
          )}
        </div>
      </section>
    </div>
  );
}
