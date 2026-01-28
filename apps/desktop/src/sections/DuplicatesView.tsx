import type { DuplicateGroup } from "../types/library";
import { Button } from "../components/ui";

type DuplicatesViewProps = {
  groups: DuplicateGroup[];
  duplicateKeepSelection: Record<string, string>;
  setDuplicateKeepSelection: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  handleResolveDuplicate: (groupId: string, keepFileId?: string) => void;
};

export function DuplicatesView({
  groups,
  duplicateKeepSelection,
  setDuplicateKeepSelection,
  handleResolveDuplicate,
}: DuplicatesViewProps) {
  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-col gap-3">
        {groups.map((group) => (
          <div
            key={group.id}
            className="flex items-start justify-between gap-4 rounded-md border border-[var(--app-border)] bg-white/70 p-3"
          >
            <div>
              <div className="text-[13px] font-semibold">{group.title}</div>
              <div className="text-xs text-[var(--app-ink-muted)]">
                {group.files.length} matching files
              </div>
              <ul>
                {group.files.map((file, index) => {
                  const fileId = group.file_ids[index] ?? file;
                  const filePath = group.file_paths[index] ?? file;
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
                        <span className="truncate text-[10px] text-[var(--app-ink-muted)]">
                          {filePath}
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
        ))}
      </div>
    </section>
  );
}
