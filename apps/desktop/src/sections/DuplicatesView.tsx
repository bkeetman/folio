import type { DuplicateGroup } from "../types/library";
import { useMemo, useState } from "react";
import { Button } from "../components/ui";

type DuplicatesViewProps = {
  hashGroups: DuplicateGroup[];
  titleGroups: DuplicateGroup[];
  fuzzyGroups: DuplicateGroup[];
  duplicateKeepSelection: Record<string, string>;
  setDuplicateKeepSelection: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  handleResolveDuplicate: (group: DuplicateGroup, keepFileId: string) => void;
  handleAutoSelectAll: (groups: DuplicateGroup[]) => void;
  handleResolveAll: (groups: DuplicateGroup[], applyNow: boolean) => void;
  applyNow: boolean;
  setApplyNow: React.Dispatch<React.SetStateAction<boolean>>;
};

function splitPath(value: string) {
  return value.replace(/\\/g, "/").split("/").filter(Boolean);
}

function commonPrefix(parts: string[][]) {
  if (parts.length === 0) return [] as string[];
  let prefix = parts[0];
  for (let i = 1; i < parts.length; i += 1) {
    const next = parts[i];
    let j = 0;
    while (j < prefix.length && j < next.length && prefix[j] === next[j]) {
      j += 1;
    }
    prefix = prefix.slice(0, j);
    if (prefix.length === 0) break;
  }
  return prefix;
}

function trimPrefix(path: string, prefix: string[]) {
  const parts = splitPath(path);
  const trimmed = parts.slice(prefix.length);
  return `…/${trimmed.join("/")}`;
}

export function DuplicatesView({
  hashGroups,
  titleGroups,
  fuzzyGroups,
  duplicateKeepSelection,
  setDuplicateKeepSelection,
  handleResolveDuplicate,
  handleAutoSelectAll,
  handleResolveAll,
  applyNow,
  setApplyNow,
}: DuplicatesViewProps) {
  const [mode, setMode] = useState<"hash" | "title" | "fuzzy">("hash");
  const [hideTitleMismatches, setHideTitleMismatches] = useState(true);
  const [ignoredGroupIds, setIgnoredGroupIds] = useState<Set<string>>(new Set());
  const baseGroups = mode === "hash" ? hashGroups : mode === "title" ? titleGroups : fuzzyGroups;
  const filteredGroups = useMemo(() => {
    if (mode !== "hash" || !hideTitleMismatches) return baseGroups;
    return baseGroups.filter((group) => {
      const titles = group.file_titles.length ? group.file_titles : [group.title];
      const normalized = titles.map((title) => title.trim().toLowerCase());
      return new Set(normalized).size <= 1;
    });
  }, [baseGroups, hideTitleMismatches, mode]);
  const visibleGroups = filteredGroups.filter((group) => !ignoredGroupIds.has(group.id));
  const selectedCount = visibleGroups.filter((group) => duplicateKeepSelection[group.id]).length;
  const ignoredInModeCount = filteredGroups.length - visibleGroups.length;

  const formatBytes = (value: number) => {
    if (!value) return "—";
    if (value < 1024) return `${value} B`;
    const kb = value / 1024;
    if (kb < 1024) return `${kb.toFixed(1)} KB`;
    const mb = kb / 1024;
    return `${mb.toFixed(1)} MB`;
  };

  const hashSuffix = (hash: string) => (hash.length > 8 ? hash.slice(-8) : hash);
  const helperText =
    mode === "hash"
      ? "Duplicates are detected by file content (hash), not by title."
      : mode === "title"
        ? "Title + Author groups are matched by normalized title, author and year."
        : "Fuzzy groups are matched by normalized title + author (year ignored).";
  return (
    <section className="flex flex-col gap-4">
      <div className="text-xs text-[var(--app-ink-muted)]">{helperText}</div>
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-1 rounded-md border border-[var(--app-border)] bg-[var(--app-panel)] p-1">
          <Button
            variant="toolbar"
            size="sm"
            data-active={mode === "hash"}
            className={mode === "hash" ? "bg-white shadow-soft" : "hover:bg-white/80"}
            onClick={() => setMode("hash")}
          >
            Hash
          </Button>
          <Button
            variant="toolbar"
            size="sm"
            data-active={mode === "title"}
            className={mode === "title" ? "bg-white shadow-soft" : "hover:bg-white/80"}
            onClick={() => setMode("title")}
          >
            Title + Author
          </Button>
          <Button
            variant="toolbar"
            size="sm"
            data-active={mode === "fuzzy"}
            className={mode === "fuzzy" ? "bg-white shadow-soft" : "hover:bg-white/80"}
            onClick={() => setMode("fuzzy")}
          >
            Fuzzy
          </Button>
        </div>
        <Button variant="outline" onClick={() => handleAutoSelectAll(visibleGroups)}>
          Auto-select best
        </Button>
        <Button variant="primary" onClick={() => handleResolveAll(visibleGroups, applyNow)}>
          Resolve all
        </Button>
        <label className="flex items-center gap-2 text-xs text-[var(--app-ink-muted)]">
          <input
            type="checkbox"
            checked={applyNow}
            onChange={(event) => setApplyNow(event.target.checked)}
          />
          Apply changes now
        </label>
        {mode === "hash" ? (
          <label className="flex items-center gap-2 text-xs text-[var(--app-ink-muted)]">
            <input
              type="checkbox"
              checked={hideTitleMismatches}
              onChange={(event) => setHideTitleMismatches(event.target.checked)}
            />
            Hide title mismatches
          </label>
        ) : null}
        <span className="text-xs text-[var(--app-ink-muted)]">
          Selected {selectedCount}/{visibleGroups.length}
        </span>
        {ignoredInModeCount > 0 ? (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setIgnoredGroupIds((prev) => {
              const next = new Set(prev);
              filteredGroups.forEach((group) => next.delete(group.id));
              return next;
            })}
          >
            Restore ignored ({ignoredInModeCount})
          </Button>
        ) : null}
      </div>
      <div className="flex flex-col gap-3">
        {visibleGroups.map((group) => {
          const filePathParts = group.file_paths.map((path) => splitPath(path));
          const prefix = commonPrefix(filePathParts);
          return (
            <div
              key={group.id}
              className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-4 rounded-md border border-[var(--app-border)] bg-white/70 p-3"
            >
            <div className="min-w-0">
              <div className="text-[13px] font-semibold">{group.title}</div>
              <div className="text-xs text-[var(--app-ink-muted)]">
                {group.files.length} matching files
              </div>
              <ul>
                {group.files.map((file, index) => {
                  const fileId = group.file_ids[index] ?? file;
                  const filePath = group.file_paths[index] ?? file;
                  const fileSize = group.file_sizes[index] ?? 0;
                  const isSelected = duplicateKeepSelection[group.id] === fileId;
                  return (
                    <li key={fileId} className="mt-2">
                      <label className="flex cursor-pointer items-start gap-2 text-xs">
                        <input
                          type="radio"
                          name={`duplicate-${group.id}`}
                          value={fileId}
                          checked={isSelected}
                          onChange={() =>
                            setDuplicateKeepSelection((prev) => ({
                              ...prev,
                              [group.id]: fileId,
                            }))
                          }
                        />
                        <span className="font-medium text-[var(--app-ink)]">{file}</span>
                        <span className="text-[10px] text-[var(--app-ink-muted)] break-all">
                          {trimPrefix(filePath, prefix)}
                        </span>
                        <span className="text-[10px] text-[var(--app-ink-muted)]">
                          {formatBytes(fileSize)}
                          {group.kind === "hash" ? ` · ${hashSuffix(group.id)}` : ""}
                        </span>
                      </label>
                    </li>
                  );
                })}
              </ul>
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                onClick={() =>
                  handleResolveDuplicate(group, duplicateKeepSelection[group.id])
                }
                disabled={!duplicateKeepSelection[group.id]}
              >
                Resolve
              </Button>
              <Button
                variant="outline"
                onClick={() => {
                  setIgnoredGroupIds((prev) => new Set([...prev, group.id]));
                  setDuplicateKeepSelection((prev) => {
                    const next = { ...prev };
                    delete next[group.id];
                    return next;
                  });
                }}
              >
                Not duplicate
              </Button>
            </div>
            </div>
          );
        })}
        {visibleGroups.length === 0 ? (
          <div className="rounded-md border border-dashed border-[var(--app-border)] bg-white/50 p-4 text-sm text-[var(--app-ink-muted)]">
            No duplicate groups to review in this mode.
          </div>
        ) : null}
      </div>
    </section>
  );
}
