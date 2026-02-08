import { Search } from "lucide-react";
import type { Dispatch, SetStateAction } from "react";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import type { Category, View } from "../types/library";

type CategoriesViewProps = {
  categories: Category[];
  setSelectedGenres: Dispatch<SetStateAction<string[]>>;
  setView: Dispatch<SetStateAction<View>>;
};

export function CategoriesView({
  categories,
  setSelectedGenres,
  setView,
}: CategoriesViewProps) {
  const { t } = useTranslation();
  const [searchQuery, setSearchQuery] = useState("");

  const filteredCategories = useMemo(() => {
    if (!searchQuery.trim()) return categories;
    const query = searchQuery.toLowerCase();
    return categories.filter((category) => category.name.toLowerCase().includes(query));
  }, [categories, searchQuery]);

  const handleCategoryClick = (categoryName: string) => {
    setSelectedGenres([categoryName]);
    setView("library-books");
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="relative">
        <Search
          size={16}
          className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--app-ink-muted)]"
        />
        <input
          type="text"
          placeholder={t("categories.searchPlaceholder")}
          value={searchQuery}
          onChange={(event) => setSearchQuery(event.target.value)}
          className="w-full rounded-lg border border-[var(--app-border)] bg-white/80 py-2 pl-10 pr-4 text-sm placeholder:text-[var(--app-ink-muted)] focus:border-[rgba(208,138,70,0.6)] focus:outline-none"
        />
        {searchQuery ? (
          <button
            className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--app-ink-muted)] hover:text-[var(--app-ink)]"
            onClick={() => setSearchQuery("")}
          >
            ×
          </button>
        ) : null}
      </div>

      <div className="text-sm text-[var(--app-ink-muted)]">
        {filteredCategories.length === categories.length
          ? t("categories.countAll", { count: categories.length })
          : t("categories.countFiltered", {
              filtered: filteredCategories.length,
              total: categories.length,
            })}
      </div>

      {filteredCategories.length === 0 ? (
        <div className="rounded-lg border border-[var(--app-border)] bg-white/70 p-4">
          <div className="text-[13px] font-semibold">{t("categories.noneTitle")}</div>
          <div className="text-xs text-[var(--app-ink-muted)]">{t("categories.noneHint")}</div>
        </div>
      ) : (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-2">
          {filteredCategories.map((category) => (
            <button
              key={category.name}
              className="flex items-center justify-between rounded-lg border border-[var(--app-border)] bg-white/80 px-3 py-2 text-left text-sm transition hover:border-[rgba(208,138,70,0.4)] hover:bg-white"
              onClick={() => handleCategoryClick(category.name)}
            >
              <span className="font-medium truncate">{category.name}</span>
              <span className="ml-2 shrink-0 text-xs text-[var(--app-ink-muted)]">
                {category.bookCount}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
