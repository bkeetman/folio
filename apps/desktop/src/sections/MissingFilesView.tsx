import { useState } from "react";
import { FolderOpen, Trash2 } from "lucide-react";
import { Button } from "../components/ui";
import type { MissingFileItem } from "../types/library";

type MissingFilesViewProps = {
  items: MissingFileItem[];
  onRelink: (fileId: string) => Promise<void>;
  onRemove: (fileId: string) => Promise<void>;
  onRemoveAll: () => Promise<void>;
  onRescan: () => Promise<void>;
  libraryRoot: string | null;
};

export function MissingFilesView({ items, onRelink, onRemove, onRemoveAll, onRescan, libraryRoot }: MissingFilesViewProps) {
  const [workingId, setWorkingId] = useState<string | null>(null);
  const [removingAll, setRemovingAll] = useState(false);
  return (
    <section className="flex-1 px-6 py-6">
      <div className="mb-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold text-app-ink">Missing Files</h1>
            <p className="text-sm text-app-ink-muted">
              These items are in your library but the file path no longer exists.
            </p>
            {libraryRoot ? (
              <p className="text-xs text-app-ink-muted mt-1">
                Library root: {libraryRoot}
              </p>
            ) : null}
          </div>
          <Button variant="outline" onClick={onRescan}>
            Rescan folder
          </Button>
          <Button
            variant="ghost"
            className="text-red-600 hover:text-red-700"
            disabled={items.length === 0 || removingAll || workingId !== null}
            onClick={async () => {
              setRemovingAll(true);
              await onRemoveAll();
              setRemovingAll(false);
            }}
          >
            <Trash2 size={14} />
            Remove all
          </Button>
        </div>
      </div>

      {items.length === 0 ? (
        <div className="rounded-xl border border-dashed border-app-border bg-app-bg/40 p-8 text-center text-sm text-app-ink-muted">
          No missing files found.
        </div>
      ) : (
        <div className="rounded-xl border border-app-border bg-white overflow-hidden shadow-sm">
          <table className="w-full text-left text-sm table-fixed">
            <thead className="bg-app-bg border-b border-app-border text-xs font-semibold uppercase text-app-ink-muted tracking-wider">
              <tr>
                <th className="px-4 py-3 w-[45%]">Item</th>
                <th className="px-4 py-3 w-[35%]">Missing Path</th>
                <th className="px-4 py-3 w-[20%]">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-app-border/40">
              {items.map((item) => (
                <tr key={item.fileId} className="hover:bg-app-bg/30">
                  <td className="px-4 py-3">
                    <div className="font-medium text-app-ink truncate">
                      {item.title}
                    </div>
                    <div className="text-xs text-app-ink-muted/70 truncate">
                      {item.authors.join(", ") || "Unknown author"}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="text-xs text-app-ink break-words" title={item.path}>
                      {item.path}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={async () => {
                          setWorkingId(item.fileId);
                          await onRelink(item.fileId);
                          setWorkingId(null);
                        }}
                        disabled={workingId === item.fileId}
                      >
                        <FolderOpen size={14} />
                        Relink
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={async () => {
                          setWorkingId(item.fileId);
                          await onRemove(item.fileId);
                          setWorkingId(null);
                        }}
                        disabled={workingId === item.fileId}
                        className="text-red-600 hover:text-red-700"
                      >
                        <Trash2 size={14} />
                        Remove
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
