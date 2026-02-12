import { invoke, isTauri } from "@tauri-apps/api/core";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { LibraryItem } from "../types/library";

type CoverOverrideMap = Record<string, string | null>;

type UseCoverOverridesArgs = {
  isDesktop: boolean;
  libraryItems: LibraryItem[];
};

export function useCoverOverrides({ isDesktop, libraryItems }: UseCoverOverridesArgs) {
  const [coverOverrides, setCoverOverrides] = useState<CoverOverrideMap>({});
  const coverOverrideRef = useRef<CoverOverrideMap>({});
  const coverFetchQueueRef = useRef<string[]>([]);
  const queuedCoverFetchesRef = useRef<Set<string>>(new Set());
  const inFlightCoverFetchesRef = useRef<Set<string>>(new Set());
  const activeCoverFetchesRef = useRef(0);

  const libraryItemsById = useMemo(
    () => new Map(libraryItems.map((item) => [item.id, item])),
    [libraryItems]
  );

  const fetchCoverOverride = useCallback(async (itemId: string, force = false) => {
    if (!isTauri()) return;
    if (!force && typeof coverOverrideRef.current[itemId] === "string") return;
    try {
      const result = await invoke<{ mime: string; bytes: number[] } | null>(
        "get_cover_blob",
        { itemId }
      );
      if (!result) return;
      const blob = new Blob([new Uint8Array(result.bytes)], { type: result.mime });
      const url = URL.createObjectURL(blob);
      setCoverOverrides((prev) => {
        const next = { ...prev, [itemId]: url };
        const previous = prev[itemId];
        if (previous) URL.revokeObjectURL(previous);
        coverOverrideRef.current = next;
        return next;
      });
    } catch {
      return;
    }
  }, []);

  const clearCoverOverride = useCallback((itemId: string) => {
    setCoverOverrides((prev) => {
      const next = { ...prev, [itemId]: null };
      const previous = prev[itemId];
      if (previous) URL.revokeObjectURL(previous);
      coverOverrideRef.current = next;
      return next;
    });
  }, []);

  const refreshCoverForItem = useCallback(
    async (itemId: string) => {
      clearCoverOverride(itemId);
      await fetchCoverOverride(itemId, true);
    },
    [clearCoverOverride, fetchCoverOverride]
  );

  const drainVisibleCoverQueue = useCallback(
    function drainVisibleCoverQueue() {
      if (!isTauri()) return;
      const maxConcurrent = 4;
      while (
        activeCoverFetchesRef.current < maxConcurrent &&
        coverFetchQueueRef.current.length > 0
      ) {
        const itemId = coverFetchQueueRef.current.shift();
        if (!itemId) break;
        queuedCoverFetchesRef.current.delete(itemId);
        if (typeof coverOverrideRef.current[itemId] === "string") {
          continue;
        }
        const item = libraryItemsById.get(itemId);
        if (!item?.cover_path) {
          continue;
        }
        if (inFlightCoverFetchesRef.current.has(itemId)) {
          continue;
        }
        inFlightCoverFetchesRef.current.add(itemId);
        activeCoverFetchesRef.current += 1;
        void fetchCoverOverride(itemId).finally(() => {
          inFlightCoverFetchesRef.current.delete(itemId);
          activeCoverFetchesRef.current = Math.max(0, activeCoverFetchesRef.current - 1);
          drainVisibleCoverQueue();
        });
      }
    },
    [fetchCoverOverride, libraryItemsById]
  );

  const handleVisibleItemIdsChange = useCallback(
    (visibleItemIds: string[]) => {
      if (!isTauri()) return;
      visibleItemIds.forEach((itemId) => {
        if (typeof coverOverrideRef.current[itemId] === "string") {
          return;
        }
        if (
          queuedCoverFetchesRef.current.has(itemId) ||
          inFlightCoverFetchesRef.current.has(itemId)
        ) {
          return;
        }
        const item = libraryItemsById.get(itemId);
        if (!item?.cover_path) {
          return;
        }
        queuedCoverFetchesRef.current.add(itemId);
        coverFetchQueueRef.current.push(itemId);
      });
      drainVisibleCoverQueue();
    },
    [drainVisibleCoverQueue, libraryItemsById]
  );

  useEffect(() => {
    return () => {
      Object.values(coverOverrideRef.current).forEach((url) => {
        if (url) URL.revokeObjectURL(url);
      });
    };
  }, []);

  useEffect(() => {
    if (!isDesktop) return;
    const activeIds = new Set(libraryItems.map((item) => item.id));
    setCoverOverrides((prev) => {
      let changed = false;
      const next = { ...prev };
      Object.keys(next).forEach((id) => {
        if (!activeIds.has(id)) {
          const previous = next[id];
          if (previous) URL.revokeObjectURL(previous);
          delete next[id];
          changed = true;
        }
      });
      coverOverrideRef.current = next;
      return changed ? next : prev;
    });

    coverFetchQueueRef.current = coverFetchQueueRef.current.filter((id) => activeIds.has(id));
    queuedCoverFetchesRef.current = new Set(
      Array.from(queuedCoverFetchesRef.current).filter((id) => activeIds.has(id))
    );
    inFlightCoverFetchesRef.current = new Set(
      Array.from(inFlightCoverFetchesRef.current).filter((id) => activeIds.has(id))
    );
  }, [libraryItems, isDesktop]);

  return {
    coverOverrides,
    fetchCoverOverride,
    clearCoverOverride,
    refreshCoverForItem,
    handleVisibleItemIdsChange,
  };
}
