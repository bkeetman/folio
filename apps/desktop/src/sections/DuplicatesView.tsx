import type { DuplicateGroup } from "../types/library";
import { useMemo, useState } from "react";
import { Button } from "../components/ui";

type DuplicatesViewProps = {
  groups: DuplicateGroup[];
  duplicateKeepSelection: Record<string, string>;
  setDuplicateKeepSelection: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  handleResolveDuplicate: (groupId: string, keepFileId: string) => void;
  handleAutoSelectAll: () => void;
  handleResolveAll: (applyNow: boolean) => void;
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
  groups,
  duplicateKeepSelection,
  setDuplicateKeepSelection,
  handleResolveDuplicate,
  handleAutoSelectAll,
  handleResolveAll,
  applyNow,
  setApplyNow,
}: DuplicatesViewProps) {
  const [hideTitleMismatches, setHideTitleMismatches] = useState(true);
  const selectedCount = groups.filter((group) => duplicateKeepSelection[group.id]).length;
  const filteredGroups = useMemo(() => {
    if (!hideTitleMismatches) return groups;
    return groups.filter((group) => {
      const titles = group.file_titles.length ? group.file_titles : [group.title];
      const normalized = titles.map((title) => title.trim().toLowerCase());
      return new Set(normalized).size <= 1;
    });
  }, [groups, hideTitleMismatches]);

  const formatBytes = (value: number) => {
    if (!value) return "—";
    if (value < 1024) return `${value} B`;
    const kb = value / 1024;
    if (kb < 1024) return `${kb.toFixed(1)} KB`;
    const mb = kb / 1024;
    return `${mb.toFixed(1)} MB`;
  };

  const hashSuffix = (hash: string) => (hash.length > 8 ? hash.slice(-8) : hash);
  return (
    <section className="flex flex-col gap-4">
      <div className="text-xs text-[var(--app-ink-muted)]">
        Duplicates are detected by file content (hash), not by title.
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="outline" onClick={handleAutoSelectAll}>
          Auto-select best
        </Button>
        <Button variant="primary" onClick={() => handleResolveAll(applyNow)}>
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
        <label className="flex items-center gap-2 text-xs text-[var(--app-ink-muted)]">
          <input
            type="checkbox"
            checked={hideTitleMismatches}
            onChange={(event) => setHideTitleMismatches(event.target.checked)}
          />
          Hide title mismatches
        </label>
        <span className="text-xs text-[var(--app-ink-muted)]">
          Selected {selectedCount}/{filteredGroups.length}
        </span>
      </div>
      <div className="flex flex-col gap-3">
        {filteredGroups.map((group) => {
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
                          {formatBytes(fileSize)} · {hashSuffix(group.id)}
                        </span>
                      </label>
                    </li>
                  );
                })}
              </ul>
            </div>
            <Button
              variant="ghost"
              onClick={() =>
                handleResolveDuplicate(group.id, duplicateKeepSelection[group.id])
              }
              disabled={!duplicateKeepSelection[group.id]}
            >
              Resolve
            </Button>
            </div>
          );
        })}
      </div>
    </section>
  );
}
