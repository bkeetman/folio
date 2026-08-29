// Three variants of the Library discovery workspace, switchable via ?variant=,
// mounted inside the existing Library route shell.
import {
  ArrowLeft,
  BookOpen,
  Check,
  CheckSquare,
  ChevronDown,
  Columns3,
  Filter,
  Grid2X2,
  List,
  Search,
  SlidersHorizontal,
  Square,
} from "lucide-react";
import { useMemo, useState } from "react";
import type { BookDisplay } from "../../types/library";
import { PrototypeSwitcher, type PrototypeVariant } from "./PrototypeSwitcher";

type SortKey = "recent" | "title" | "author";
type ViewMode = "grid" | "list";

type PrototypeState = {
  query: string;
  formats: Set<string>;
  statuses: Set<string>;
  genres: Set<string>;
  sort: SortKey;
  view: ViewMode;
  selectionMode: boolean;
  selected: Set<string>;
  focusedId: string | null;
  screen: "library" | "book";
  scrollAnchor: string;
};

const fallbackBooks: BookDisplay[] = [
  ["p1", "The Left Hand of Darkness", "Ursula K. Le Guin", "EPUB", 1969, "Complete", "Science fiction", "English"],
  ["p2", "The Dispossessed", "Ursula K. Le Guin", "EPUB", 1974, "Complete", "Science fiction", "English"],
  ["p3", "Kindred", "Octavia E. Butler", "EPUB", 1979, "Complete", "Science fiction", "English"],
  ["p4", "Invisible Cities", "Italo Calvino", "PDF", 1972, "Needs metadata", "Literature", "English"],
  ["p5", "Braiding Sweetgrass", "Robin Wall Kimmerer", "EPUB", 2013, "Complete", "Nature", "English"],
  ["p6", "The Dawn of Everything", "David Graeber · David Wengrow", "EPUB", 2021, "Complete", "History", "English"],
  ["p7", "Ficciones", "Jorge Luis Borges", "MOBI", 1944, "Needs metadata", "Literature", "Spanish"],
  ["p8", "The Fifth Season", "N. K. Jemisin", "EPUB", 2015, "Complete", "Science fiction", "English"],
  ["p9", "Entangled Life", "Merlin Sheldrake", "PDF", 2020, "Complete", "Nature", "English"],
  ["p10", "Ways of Seeing", "John Berger", "EPUB", 1972, "Needs metadata", "Art", "English"],
  ["p11", "Piranesi", "Susanna Clarke", "EPUB", 2020, "Complete", "Fantasy", "English"],
  ["p12", "The Memory Police", "Yoko Ogawa", "EPUB", 1994, "Complete", "Literature", "English"],
].map(([id, title, author, format, year, status, genre, language], index) => ({
  id: String(id),
  title: String(title),
  author: String(author),
  authors: String(author).split(" · "),
  format: String(format),
  year: Number(year),
  status: String(status),
  cover: null,
  tags: index % 3 === 0 ? [{ id: "owned", name: "Owned", color: "orange" }] : [],
  language: String(language),
  series: index === 1 ? "Hainish Cycle" : null,
  genres: [String(genre)],
  createdAt: Date.now() - index * 86_400_000,
}));

const initialState: PrototypeState = {
  query: "",
  formats: new Set(),
  statuses: new Set(),
  genres: new Set(),
  sort: "recent",
  view: "grid",
  selectionMode: false,
  selected: new Set(),
  focusedId: null,
  screen: "library",
  scrollAnchor: "Top of results",
};

function readVariant(): PrototypeVariant {
  const value = new URLSearchParams(window.location.search).get("variant");
  return value === "B" || value === "C" ? value : "A";
}

function toggleSet(source: Set<string>, value: string) {
  const next = new Set(source);
  if (next.has(value)) next.delete(value);
  else next.add(value);
  return next;
}

function coverTone(book: BookDisplay) {
  const tones = [
    "from-[#2f4858] to-[#182a35]",
    "from-[#9c5c3c] to-[#5e2f22]",
    "from-[#507255] to-[#2d4932]",
    "from-[#756282] to-[#43344f]",
    "from-[#b07a3b] to-[#73451f]",
  ];
  return tones[book.title.length % tones.length];
}

export function LibraryDiscoveryPrototype({ books }: { books: BookDisplay[] }) {
  const [variant, setVariant] = useState<PrototypeVariant>(readVariant);
  const [state, setState] = useState<PrototypeState>(initialState);
  const sourceBooks = books.length >= 8 ? books : fallbackBooks;

  const filtered = useMemo(() => {
    const query = state.query.trim().toLocaleLowerCase();
    const result = sourceBooks.filter((book) => {
      const searchable = [
        book.title,
        book.author,
        book.series ?? "",
        book.language ?? "",
        String(book.year),
        book.format,
        ...(book.genres ?? []),
        ...(book.tags ?? []).map((tag) => tag.name),
      ].join(" ").toLocaleLowerCase();
      if (query && !searchable.includes(query)) return false;
      if (state.formats.size && !state.formats.has(book.format.toUpperCase())) return false;
      if (state.statuses.size && !state.statuses.has(book.status)) return false;
      if (state.genres.size && !(book.genres ?? []).some((genre) => state.genres.has(genre))) return false;
      return true;
    });
    return [...result].sort((left, right) => {
      if (state.sort === "title") return left.title.localeCompare(right.title);
      if (state.sort === "author") return left.author.localeCompare(right.author);
      return right.createdAt - left.createdAt;
    });
  }, [sourceBooks, state.formats, state.genres, state.query, state.sort, state.statuses]);

  const focused = sourceBooks.find((book) => book.id === state.focusedId) ?? filtered[0] ?? sourceBooks[0];
  const update = (patch: Partial<PrototypeState>) => setState((current) => ({ ...current, ...patch }));
  const openBook = (book: BookDisplay) => update({ focusedId: book.id, screen: "book", scrollAnchor: book.title });
  const clearFilters = () => update({ formats: new Set(), statuses: new Set(), genres: new Set() });
  const activeFilters = state.formats.size + state.statuses.size + state.genres.size;

  if (state.screen === "book") {
    return (
      <div className="relative min-h-[calc(100vh-96px)] rounded-2xl border border-app-border bg-app-surface p-7 shadow-sm">
        <button
          type="button"
          onClick={() => update({ screen: "library" })}
          className="mb-8 inline-flex items-center gap-2 rounded-lg border border-app-border px-3 py-2 text-xs font-semibold hover:bg-app-surface-hover"
        >
          <ArrowLeft size={14} /> Back to Library
        </button>
        <div className="mx-auto grid max-w-3xl grid-cols-[180px_1fr] gap-9">
          <div className={`aspect-[2/3] rounded-xl bg-gradient-to-br ${coverTone(focused)} p-5 text-white shadow-xl`}>
            <div className="text-lg font-semibold leading-tight">{focused.title}</div>
            <div className="mt-3 text-xs text-white/70">{focused.author}</div>
          </div>
          <div className="pt-3">
            <div className="text-[10px] font-bold uppercase tracking-[0.22em] text-app-accent">Book inspection</div>
            <h1 className="mt-2 text-3xl font-semibold tracking-tight">{focused.title}</h1>
            <p className="mt-2 text-base text-app-ink-muted">{focused.author}</p>
            <div className="mt-8 grid grid-cols-2 gap-3 text-xs">
              <Fact label="Format" value={focused.format} />
              <Fact label="Published" value={String(focused.year)} />
              <Fact label="Language" value={focused.language ?? "Unknown"} />
              <Fact label="Status" value={focused.status} />
            </div>
            <button className="mt-8 rounded-lg bg-app-accent px-4 py-2.5 text-xs font-semibold text-white">Edit book</button>
          </div>
        </div>
        <PreservedState state={state} resultCount={filtered.length} />
        <PrototypeSwitcher current={variant} onChange={setVariant} />
      </div>
    );
  }

  return (
    <div className="relative min-h-[calc(100vh-96px)]">
      {variant === "A" ? (
        <VariantA
          books={filtered}
          state={state}
          activeFilters={activeFilters}
          update={update}
          clearFilters={clearFilters}
          openBook={openBook}
        />
      ) : null}
      {variant === "B" ? (
        <VariantB books={filtered} state={state} update={update} clearFilters={clearFilters} openBook={openBook} />
      ) : null}
      {variant === "C" ? <VariantC books={filtered} focused={focused} state={state} update={update} openBook={openBook} /> : null}
      <PreservedState state={state} resultCount={filtered.length} />
      <PrototypeSwitcher current={variant} onChange={setVariant} />
    </div>
  );
}

type VariantProps = {
  books: BookDisplay[];
  state: PrototypeState;
  update: (patch: Partial<PrototypeState>) => void;
  openBook: (book: BookDisplay) => void;
};

function VariantA({ books, state, activeFilters, update, clearFilters, openBook }: VariantProps & { activeFilters: number; clearFilters: () => void }) {
  const [filtersOpen, setFiltersOpen] = useState(false);
  return (
    <div className="rounded-2xl border border-app-border bg-app-surface px-6 pb-24 pt-6 shadow-sm">
      <div className="flex items-end justify-between gap-5">
        <div>
          <div className="text-[10px] font-bold uppercase tracking-[0.22em] text-app-ink-muted">Your Library</div>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">Books</h1>
        </div>
        <button
          type="button"
          onClick={() => update({ selectionMode: !state.selectionMode })}
          className={`rounded-lg border px-3 py-2 text-xs font-semibold ${state.selectionMode ? "border-app-accent bg-app-accent/10 text-app-accent-strong" : "border-app-border"}`}
        >
          {state.selectionMode ? "Done selecting" : "Select books"}
        </button>
      </div>
      <div className="mt-5 flex gap-2">
        <SearchBox value={state.query} onChange={(query) => update({ query })} roomy />
        <button
          type="button"
          onClick={() => setFiltersOpen((open) => !open)}
          className="inline-flex h-11 items-center gap-2 rounded-xl border border-app-border px-4 text-xs font-semibold hover:bg-app-surface-hover"
        >
          <SlidersHorizontal size={15} /> Filters {activeFilters ? <Count value={activeFilters} /> : null}
        </button>
        <SortSelect state={state} update={update} />
        <ViewToggle state={state} update={update} />
      </div>
      {filtersOpen ? (
        <div className="mt-3 flex flex-wrap items-center gap-2 rounded-xl border border-app-border bg-app-bg-secondary p-3">
          <FilterPill label="EPUB" active={state.formats.has("EPUB")} onClick={() => update({ formats: toggleSet(state.formats, "EPUB") })} />
          <FilterPill label="PDF" active={state.formats.has("PDF")} onClick={() => update({ formats: toggleSet(state.formats, "PDF") })} />
          <FilterPill label="Needs metadata" active={state.statuses.has("Needs metadata")} onClick={() => update({ statuses: toggleSet(state.statuses, "Needs metadata") })} />
          <FilterPill label="Science fiction" active={state.genres.has("Science fiction")} onClick={() => update({ genres: toggleSet(state.genres, "Science fiction") })} />
          {activeFilters ? <button onClick={clearFilters} className="ml-auto text-xs text-app-ink-muted underline">Clear all</button> : null}
        </div>
      ) : null}
      <ResultHeader count={books.length} selected={state.selected.size} />
      <BookCollection books={books} state={state} update={update} openBook={openBook} />
    </div>
  );
}

function VariantB({ books, state, update, clearFilters, openBook }: VariantProps & { clearFilters: () => void }) {
  return (
    <div className="grid min-h-[calc(100vh-96px)] grid-cols-[210px_minmax(0,1fr)] overflow-hidden rounded-2xl border border-app-border bg-app-surface shadow-sm">
      <aside className="border-r border-app-border bg-app-bg-secondary p-5 pb-24">
        <div className="flex items-center gap-2 text-sm font-semibold"><Filter size={15} /> Refine</div>
        <Facet title="Format" options={["EPUB", "PDF", "MOBI"]} selected={state.formats} onToggle={(value) => update({ formats: toggleSet(state.formats, value) })} />
        <Facet title="Status" options={["Complete", "Needs metadata"]} selected={state.statuses} onToggle={(value) => update({ statuses: toggleSet(state.statuses, value) })} />
        <Facet title="Category" options={["Science fiction", "Literature", "Nature", "History"]} selected={state.genres} onToggle={(value) => update({ genres: toggleSet(state.genres, value) })} />
        <button onClick={clearFilters} className="mt-7 text-xs font-semibold text-app-ink-muted hover:text-app-ink">Reset all filters</button>
      </aside>
      <section className="min-w-0 px-6 pb-24 pt-6">
        <div className="flex items-center gap-3">
          <SearchBox value={state.query} onChange={(query) => update({ query })} roomy />
          <SortSelect state={state} update={update} />
          <ViewToggle state={state} update={update} />
        </div>
        <div className="mt-5 flex items-center justify-between">
          <ResultHeader count={books.length} selected={state.selected.size} compact />
          <button
            onClick={() => update({ selectionMode: !state.selectionMode })}
            className={`text-xs font-semibold ${state.selectionMode ? "text-app-accent" : "text-app-ink-muted"}`}
          >
            {state.selectionMode ? "Finish selection" : "Select multiple"}
          </button>
        </div>
        <BookCollection books={books} state={state} update={update} openBook={openBook} />
      </section>
    </div>
  );
}

function VariantC({ books, focused, state, update, openBook }: VariantProps & { focused: BookDisplay }) {
  return (
    <div className="overflow-hidden rounded-2xl border border-app-border bg-app-surface pb-20 shadow-sm">
      <div className="flex items-center gap-3 border-b border-app-border px-4 py-3">
        <SearchBox value={state.query} onChange={(query) => update({ query })} />
        <FilterPill label="EPUB" active={state.formats.has("EPUB")} onClick={() => update({ formats: toggleSet(state.formats, "EPUB") })} />
        <FilterPill label="Needs metadata" active={state.statuses.has("Needs metadata")} onClick={() => update({ statuses: toggleSet(state.statuses, "Needs metadata") })} />
        <div className="ml-auto text-[11px] text-app-ink-muted">{books.length} results · {state.selected.size} selected</div>
      </div>
      <div className="grid min-h-[600px] grid-cols-[minmax(420px,1.25fr)_minmax(280px,.75fr)]">
        <div className="border-r border-app-border">
          <div className="grid grid-cols-[36px_1.5fr_1fr_70px_62px] border-b border-app-border bg-app-bg-secondary px-3 py-2 text-[10px] font-bold uppercase tracking-[0.14em] text-app-ink-muted">
            <span /><span>Title</span><span>Author</span><span>Year</span><span>Type</span>
          </div>
          {books.map((book) => {
            const selected = state.selected.has(book.id);
            const active = focused.id === book.id;
            return (
              <div
                key={book.id}
                onClick={() => update({ focusedId: book.id })}
                className={`grid cursor-pointer grid-cols-[36px_1.5fr_1fr_70px_62px] items-center border-b border-app-border px-3 py-2.5 text-xs ${active ? "bg-app-accent/8" : "hover:bg-app-surface-hover"}`}
              >
                <button onClick={(event) => { event.stopPropagation(); update({ selected: toggleSet(state.selected, book.id) }); }} className={selected ? "text-app-accent" : "text-app-ink-muted"}>
                  {selected ? <CheckSquare size={15} /> : <Square size={15} />}
                </button>
                <span className="truncate font-semibold">{book.title}</span>
                <span className="truncate text-app-ink-muted">{book.author}</span>
                <span className="text-app-ink-muted">{book.year}</span>
                <span className="text-[10px] font-bold text-app-ink-muted">{book.format}</span>
              </div>
            );
          })}
        </div>
        <aside className="p-6">
          <div className={`mx-auto aspect-[2/3] w-28 rounded-lg bg-gradient-to-br ${coverTone(focused)} p-3 text-white shadow-lg`}>
            <div className="text-sm font-semibold leading-tight">{focused.title}</div>
          </div>
          <h2 className="mt-5 text-center text-lg font-semibold">{focused.title}</h2>
          <p className="mt-1 text-center text-xs text-app-ink-muted">{focused.author}</p>
          <div className="mt-6 space-y-2 text-xs">
            <Fact label="Format" value={focused.format} />
            <Fact label="Published" value={String(focused.year)} />
            <Fact label="Status" value={focused.status} />
          </div>
          <button onClick={() => openBook(focused)} className="mt-6 w-full rounded-lg bg-app-accent px-4 py-2.5 text-xs font-semibold text-white">Open book</button>
        </aside>
      </div>
    </div>
  );
}

function SearchBox({ value, onChange, roomy = false }: { value: string; onChange: (value: string) => void; roomy?: boolean }) {
  return (
    <label className={`relative block min-w-0 flex-1 ${roomy ? "max-w-xl" : ""}`}>
      <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-app-ink-muted" />
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder="Search title, author, ISBN, series, tag…"
        className={`${roomy ? "h-11 rounded-xl" : "h-9 rounded-lg"} w-full border border-app-border bg-app-bg pl-9 pr-3 text-xs outline-none focus:border-app-accent focus:ring-2 focus:ring-app-accent/10`}
      />
    </label>
  );
}

function SortSelect({ state, update }: { state: PrototypeState; update: (patch: Partial<PrototypeState>) => void }) {
  return (
    <label className="relative flex h-11 items-center rounded-xl border border-app-border px-3 text-xs font-semibold">
      <select value={state.sort} onChange={(event) => update({ sort: event.target.value as SortKey })} className="appearance-none bg-transparent pr-5 outline-none">
        <option value="recent">Recently added</option><option value="title">Title A–Z</option><option value="author">Author A–Z</option>
      </select>
      <ChevronDown size={12} className="pointer-events-none absolute right-2.5" />
    </label>
  );
}

function ViewToggle({ state, update }: { state: PrototypeState; update: (patch: Partial<PrototypeState>) => void }) {
  return (
    <div className="flex h-11 items-center rounded-xl border border-app-border p-1">
      <button onClick={() => update({ view: "grid" })} className={`rounded-lg p-2 ${state.view === "grid" ? "bg-app-bg-tertiary" : "text-app-ink-muted"}`}><Grid2X2 size={14} /></button>
      <button onClick={() => update({ view: "list" })} className={`rounded-lg p-2 ${state.view === "list" ? "bg-app-bg-tertiary" : "text-app-ink-muted"}`}><List size={14} /></button>
    </div>
  );
}

function BookCollection({ books, state, update, openBook }: VariantProps) {
  if (!books.length) return <div className="mt-10 rounded-xl border border-dashed border-app-border p-12 text-center text-sm text-app-ink-muted">No books match. Your selection is preserved; adjust or clear a filter.</div>;
  if (state.view === "list") {
    return <div className="mt-3 divide-y divide-app-border rounded-xl border border-app-border">{books.map((book) => <BookRow key={book.id} book={book} state={state} update={update} openBook={openBook} />)}</div>;
  }
  return <div className="mt-3 grid grid-cols-2 gap-4 lg:grid-cols-3 xl:grid-cols-4">{books.map((book) => <BookCard key={book.id} book={book} state={state} update={update} openBook={openBook} />)}</div>;
}

function BookCard({ book, state, update, openBook }: { book: BookDisplay; state: PrototypeState; update: (patch: Partial<PrototypeState>) => void; openBook: (book: BookDisplay) => void }) {
  const selected = state.selected.has(book.id);
  return (
    <article onClick={() => state.selectionMode ? update({ selected: toggleSet(state.selected, book.id) }) : openBook(book)} className={`group relative cursor-pointer rounded-xl border p-3 transition ${selected ? "border-app-accent bg-app-accent/5 ring-2 ring-app-accent/10" : "border-app-border hover:-translate-y-0.5 hover:shadow-md"}`}>
      {state.selectionMode ? <div className={`absolute right-5 top-5 z-10 flex h-6 w-6 items-center justify-center rounded-md border ${selected ? "border-app-accent bg-app-accent text-white" : "border-white/70 bg-black/20 text-white"}`}>{selected ? <Check size={14} /> : null}</div> : null}
      <div className={`aspect-[4/3] rounded-lg bg-gradient-to-br ${coverTone(book)} p-4 text-white`}><div className="max-w-[85%] text-sm font-semibold leading-tight">{book.title}</div><div className="mt-2 text-[10px] text-white/65">{book.author}</div></div>
      <h3 className="mt-3 truncate text-sm font-semibold">{book.title}</h3>
      <p className="mt-0.5 truncate text-xs text-app-ink-muted">{book.author}</p>
      <div className="mt-3 flex items-center justify-between text-[10px] font-semibold text-app-ink-muted"><span>{book.format}</span><span>{book.year}</span></div>
    </article>
  );
}

function BookRow({ book, state, update, openBook }: { book: BookDisplay; state: PrototypeState; update: (patch: Partial<PrototypeState>) => void; openBook: (book: BookDisplay) => void }) {
  const selected = state.selected.has(book.id);
  return <div onClick={() => state.selectionMode ? update({ selected: toggleSet(state.selected, book.id) }) : openBook(book)} className={`grid cursor-pointer grid-cols-[36px_1.6fr_1fr_80px_80px] items-center px-4 py-3 text-xs hover:bg-app-surface-hover ${selected ? "bg-app-accent/5" : ""}`}>
    <span>{state.selectionMode ? (selected ? <CheckSquare size={15} className="text-app-accent" /> : <Square size={15} className="text-app-ink-muted" />) : <BookOpen size={15} className="text-app-ink-muted" />}</span><span className="font-semibold">{book.title}</span><span className="truncate text-app-ink-muted">{book.author}</span><span>{book.year}</span><span className="text-[10px] font-bold text-app-ink-muted">{book.format}</span>
  </div>;
}

function ResultHeader({ count, selected, compact = false }: { count: number; selected: number; compact?: boolean }) {
  return <div className={`${compact ? "" : "mt-5"} flex items-center gap-2 text-xs text-app-ink-muted`}><span>{count} books</span>{selected ? <><span>·</span><span className="font-semibold text-app-accent">{selected} selected</span></> : null}</div>;
}

function FilterPill({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return <button onClick={onClick} className={`rounded-full border px-3 py-1.5 text-[11px] font-semibold ${active ? "border-app-accent bg-app-accent/10 text-app-accent-strong" : "border-app-border bg-app-surface"}`}>{label}</button>;
}

function Facet({ title, options, selected, onToggle }: { title: string; options: string[]; selected: Set<string>; onToggle: (value: string) => void }) {
  return <div className="mt-7"><div className="mb-2 text-[10px] font-bold uppercase tracking-[0.18em] text-app-ink-muted">{title}</div><div className="space-y-1.5">{options.map((option) => <label key={option} className="flex cursor-pointer items-center gap-2 text-xs"><button onClick={() => onToggle(option)} className={selected.has(option) ? "text-app-accent" : "text-app-ink-muted"}>{selected.has(option) ? <CheckSquare size={14} /> : <Square size={14} />}</button>{option}</label>)}</div></div>;
}

function Fact({ label, value }: { label: string; value: string }) {
  return <div className="flex items-center justify-between rounded-lg bg-app-bg-secondary px-3 py-2"><span className="text-app-ink-muted">{label}</span><span className="font-semibold">{value}</span></div>;
}

function Count({ value }: { value: number }) {
  return <span className="flex h-4 min-w-4 items-center justify-center rounded-full bg-app-accent px-1 text-[9px] text-white">{value}</span>;
}

function PreservedState({ state, resultCount }: { state: PrototypeState; resultCount: number }) {
  const filters = [...state.formats, ...state.statuses, ...state.genres];
  return (
    <div className="fixed bottom-4 left-[230px] right-5 z-40 flex min-w-0 items-center gap-3 rounded-xl border border-app-border bg-app-surface/95 px-4 py-2 text-[10px] text-app-ink-muted shadow-lg backdrop-blur">
      <Columns3 size={13} className="shrink-0 text-app-accent" />
      <span className="shrink-0 font-bold uppercase tracking-[0.14em] text-app-ink">Preserved workspace</span>
      <span className="truncate">Query: {state.query || "—"}</span><span>·</span>
      <span className="truncate">Filters: {filters.join(", ") || "—"}</span><span>·</span>
      <span>Sort: {state.sort}</span><span>·</span><span>View: {state.view}</span><span>·</span>
      <span>{state.selected.size} selected</span><span>·</span><span>{resultCount} shown</span><span>·</span>
      <span className="truncate">Anchor: {state.scrollAnchor}</span>
    </div>
  );
}
