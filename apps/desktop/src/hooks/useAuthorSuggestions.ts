import { invoke } from "@tauri-apps/api/core";
import type { KeyboardEvent as ReactKeyboardEvent } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AuthorSuggestion } from "../types/library";

type UseAuthorSuggestionsArgs = {
  isDesktop: boolean;
  enabled: boolean;
  query: string;
  limit?: number;
  debounceMs?: number;
};

type UseAuthorSuggestionsResult = {
  suggestions: AuthorSuggestion[];
  loading: boolean;
  activeIndex: number;
  setActiveIndex: React.Dispatch<React.SetStateAction<number>>;
  listRef: React.RefObject<HTMLDivElement | null>;
  showSuggestions: boolean;
  clearSuggestions: () => void;
  handleKeyDown: (
    event: ReactKeyboardEvent<HTMLInputElement>,
    onSelect: (suggestion: AuthorSuggestion) => void
  ) => void;
};

export function useAuthorSuggestions({
  isDesktop,
  enabled,
  query,
  limit = 8,
  debounceMs = 180,
}: UseAuthorSuggestionsArgs): UseAuthorSuggestionsResult {
  const [suggestions, setSuggestions] = useState<AuthorSuggestion[]>([]);
  const [loading, setLoading] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [resultQuery, setResultQuery] = useState("");
  const listRef = useRef<HTMLDivElement | null>(null);

  const hasCurrentResults = resultQuery === query && suggestions.length > 0;
  const showSuggestions = useMemo(
    () => enabled && query.length >= 2 && (loading || hasCurrentResults),
    [enabled, hasCurrentResults, loading, query.length]
  );

  const clearSuggestions = useCallback(() => {
    setSuggestions([]);
    setActiveIndex(-1);
    setResultQuery("");
  }, []);

  useEffect(() => {
    if (!isDesktop || !enabled || query.length < 2) {
      return;
    }
    let cancelled = false;
    const timer = window.setTimeout(() => {
      setLoading(true);
      void invoke<AuthorSuggestion[]>("search_authors", {
        query,
        limit,
      })
        .then((nextSuggestions) => {
          if (cancelled) return;
          setSuggestions(nextSuggestions);
          setResultQuery(query);
          setActiveIndex((current) => {
            if (nextSuggestions.length === 0) return -1;
            if (current >= 0 && current < nextSuggestions.length) return current;
            return 0;
          });
        })
        .catch((error) => {
          if (cancelled) return;
          console.error("Failed to lookup author suggestions", error);
          setSuggestions([]);
          setActiveIndex(-1);
          setResultQuery(query);
        })
        .finally(() => {
          if (!cancelled) {
            setLoading(false);
          }
        });
    }, debounceMs);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [debounceMs, enabled, isDesktop, limit, query]);

  useEffect(() => {
    if (!showSuggestions || activeIndex < 0) return;
    const list = listRef.current;
    if (!list) return;
    const activeEl = list.querySelector<HTMLButtonElement>(
      `[data-suggestion-index='${activeIndex}']`
    );
    activeEl?.scrollIntoView({ block: "nearest" });
  }, [activeIndex, showSuggestions]);

  const handleKeyDown = useCallback(
    (
      event: ReactKeyboardEvent<HTMLInputElement>,
      onSelect: (suggestion: AuthorSuggestion) => void
    ) => {
      if (!showSuggestions || suggestions.length === 0) return;
      const lastIndex = suggestions.length - 1;
      if (event.key === "ArrowDown") {
        event.preventDefault();
        setActiveIndex((current) => {
          if (current < 0) return 0;
          return current >= lastIndex ? 0 : current + 1;
        });
        return;
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        setActiveIndex((current) => {
          if (current < 0) return lastIndex;
          if (current === 0) return lastIndex;
          return current - 1;
        });
        return;
      }
      if (event.key === "Enter") {
        const pickedIndex = activeIndex >= 0 ? activeIndex : 0;
        const picked = suggestions[pickedIndex];
        if (!picked) return;
        event.preventDefault();
        onSelect(picked);
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        clearSuggestions();
      }
    },
    [activeIndex, clearSuggestions, showSuggestions, suggestions]
  );

  return {
    suggestions,
    loading,
    activeIndex,
    setActiveIndex,
    listRef,
    showSuggestions,
    clearSuggestions,
    handleKeyDown,
  };
}
