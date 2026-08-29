// Three batch-edit variants, switchable via ?variant=, mounted inside the
// accepted Library workspace. All mutations are simulated in memory.
import {
  AlertTriangle,
  ArrowLeft,
  Check,
  CheckCircle2,
  CircleDashed,
  Eye,
  FileWarning,
  Layers3,
  Loader2,
  Minus,
  Plus,
  RotateCcw,
  Save,
  X,
} from "lucide-react";
import { useEffect, useState } from "react";
import { PrototypeSwitcher, type BatchPrototypeVariant } from "./PrototypeSwitcher";

type Screen = "edit" | "review" | "saving" | "results";
type ScalarAction = "keep" | "replace" | "clear";
type SetAction = "keep" | "append" | "remove" | "replace" | "clear";

type Draft = {
  language: { action: ScalarAction; value: string };
  tags: { action: SetAction; value: string };
  category: { action: SetAction; value: string };
  series: { action: ScalarAction; value: string };
};

const books = [
  { id: "1", title: "The Left Hand of Darkness", author: "Ursula K. Le Guin", format: "EPUB", language: "English", tags: "Owned, Sci-fi", category: "Science fiction", series: "Hainish Cycle" },
  { id: "2", title: "The Dispossessed", author: "Ursula K. Le Guin", format: "EPUB", language: "English", tags: "Sci-fi", category: "Science fiction", series: "Hainish Cycle" },
  { id: "3", title: "Kindred", author: "Octavia E. Butler", format: "EPUB", language: "English", tags: "Owned", category: "Science fiction", series: "—" },
  { id: "4", title: "Invisible Cities", author: "Italo Calvino", format: "PDF", language: "Italian", tags: "To read", category: "Literature", series: "—" },
  { id: "5", title: "Ficciones", author: "Jorge Luis Borges", format: "MOBI", language: "Spanish", tags: "Owned", category: "Literature", series: "—" },
  { id: "6", title: "The Fifth Season", author: "N. K. Jemisin", format: "EPUB", language: "English", tags: "To read", category: "Fantasy", series: "Broken Earth" },
  { id: "7", title: "Entangled Life", author: "Merlin Sheldrake", format: "PDF", language: "English", tags: "Owned", category: "Nature", series: "—" },
  { id: "8", title: "Piranesi", author: "Susanna Clarke", format: "EPUB", language: "English", tags: "—", category: "Fantasy", series: "—" },
];

const initialDraft: Draft = {
  language: { action: "keep", value: "English" },
  tags: { action: "append", value: "Reviewed" },
  category: { action: "keep", value: "Science fiction" },
  series: { action: "clear", value: "" },
};

function readVariant(): BatchPrototypeVariant {
  const value = new URLSearchParams(window.location.search).get("variant");
  return value === "B" || value === "C" ? value : "A";
}

export function BatchEditPrototype() {
  const [variant, setVariant] = useState<BatchPrototypeVariant>(readVariant);
  const [screen, setScreen] = useState<Screen>("edit");
  const [draft, setDraft] = useState<Draft>(initialDraft);
  const [showSelectedOnly, setShowSelectedOnly] = useState(false);
  const [progress, setProgress] = useState(0);
  const [retryFailedOnly, setRetryFailedOnly] = useState(false);
  const selectedBooks = retryFailedOnly ? books.filter((book) => book.id === "4") : books;
  const selectedCount = selectedBooks.length;
  const visibleCount = retryFailedOnly ? 0 : 3;
  const activeChanges = Object.values(draft).filter((field) => field.action !== "keep").length;

  useEffect(() => {
    if (screen !== "saving") return;
    const timer = window.setInterval(() => setProgress((current) => Math.min(selectedCount, current + 1)), 180);
    return () => window.clearInterval(timer);
  }, [screen, selectedCount]);

  useEffect(() => {
    if (screen === "saving" && progress === selectedCount) {
      const timer = window.setTimeout(() => setScreen("results"), 350);
      return () => window.clearTimeout(timer);
    }
  }, [progress, screen, selectedCount]);

  const updateField = <K extends keyof Draft>(field: K, value: Draft[K]) => setDraft((current) => ({ ...current, [field]: value }));
  const reset = () => { setDraft(initialDraft); setScreen("edit"); setProgress(0); setRetryFailedOnly(false); };

  const content = screen === "edit" ? (
    variant === "A" ? <GuidedEditor draft={draft} updateField={updateField} retryFailedOnly={retryFailedOnly} /> :
    variant === "B" ? <ChangeMatrix draft={draft} updateField={updateField} /> :
    <OutcomeWorkbench draft={draft} updateField={updateField} showSelectedOnly={showSelectedOnly} setShowSelectedOnly={setShowSelectedOnly} />
  ) : screen === "review" ? (
    <Review draft={draft} selectedCount={selectedCount} retryFailedOnly={retryFailedOnly} onBack={() => setScreen("edit")} onSave={() => { setProgress(0); setScreen("saving"); }} />
  ) : screen === "saving" ? (
    <Saving progress={progress} selectedBooks={selectedBooks} />
  ) : (
    <Results retryFailedOnly={retryFailedOnly} onEditFailed={() => { setRetryFailedOnly(true); setScreen("edit"); setDraft({ ...initialDraft, language: { action: "replace", value: "English" }, tags: { action: "keep", value: "Reviewed" }, series: { action: "keep", value: "" } }); }} onDone={reset} />
  );

  return (
    <div className="relative min-h-[calc(100vh-96px)] overflow-hidden rounded-2xl border border-app-border bg-app-surface pb-24 shadow-sm">
      <header className="flex items-center gap-4 border-b border-app-border px-6 py-4">
        <button className="rounded-lg border border-app-border p-2 text-app-ink-muted hover:bg-app-surface-hover" aria-label="Back to Library"><ArrowLeft size={15} /></button>
        <div><div className="text-[10px] font-bold uppercase tracking-[0.18em] text-app-ink-muted">Batch edit</div><h1 className="text-lg font-semibold">{selectedCount} selected {selectedCount === 1 ? "book" : "books"}</h1></div>
        <div className="ml-2 rounded-full bg-app-accent/10 px-3 py-1 text-[11px] font-semibold text-app-accent">{visibleCount} visible in current results</div>
        <button className="ml-auto text-xs font-semibold text-app-ink-muted">Show selection</button>
      </header>
      <StepBar screen={screen} />
      {content}
      {screen === "edit" ? (
        <footer className="absolute bottom-0 left-0 right-0 flex items-center border-t border-app-border bg-app-surface/95 px-6 py-3 backdrop-blur">
          <button onClick={() => setDraft(initialDraft)} className="inline-flex items-center gap-2 text-xs font-semibold text-app-ink-muted"><RotateCcw size={13} /> Reset fields</button>
          <div className="ml-auto flex items-center gap-3"><span className="text-xs text-app-ink-muted">{activeChanges} field {activeChanges === 1 ? "operation" : "operations"} · {selectedCount} {selectedCount === 1 ? "book" : "books"}</span><button disabled={!activeChanges} onClick={() => setScreen("review")} className="inline-flex items-center gap-2 rounded-lg bg-app-accent px-4 py-2.5 text-xs font-semibold text-white disabled:opacity-40"><Eye size={14} /> Review changes</button></div>
        </footer>
      ) : null}
      <StateStrip variant={variant} screen={screen} draft={draft} progress={progress} selectedCount={selectedCount} visibleCount={visibleCount} />
      <PrototypeSwitcher current={variant} onChange={setVariant} />
    </div>
  );
}

type EditorProps = { draft: Draft; updateField: <K extends keyof Draft>(field: K, value: Draft[K]) => void };

function GuidedEditor({ draft, updateField, retryFailedOnly = false }: EditorProps & { retryFailedOnly?: boolean }) {
  return (
    <main className="mx-auto max-w-4xl px-7 py-6">
      <div className="mb-5"><h2 className="text-xl font-semibold">What should change?</h2><p className="mt-1 text-xs text-app-ink-muted">Untouched fields stay exactly as they are. Mixed values are never silently replaced.</p></div>
      <div className="grid grid-cols-2 gap-4">
        <FieldCard title="Language" current={retryFailedOnly ? "Current · Italian" : "Mixed · English (6), Italian (1), Spanish (1)"} hint="One value per book"><ScalarEditor value={draft.language} onChange={(value) => updateField("language", value)} options={["English", "Dutch", "French"]} /></FieldCard>
        <FieldCard title="Tags" current={retryFailedOnly ? "Current · To read" : "Mixed · 5 combinations"} hint="Multiple values per book"><SetEditor value={draft.tags} onChange={(value) => updateField("tags", value)} options={["Reviewed", "Owned", "To read"]} /></FieldCard>
        <FieldCard title="Category" current={retryFailedOnly ? "Current · Literature" : "Mixed · Science fiction, Literature, Fantasy, Nature"} hint="Multiple values allowed"><SetEditor value={draft.category} onChange={(value) => updateField("category", value)} options={["Science fiction", "Literature", "Fantasy"]} /></FieldCard>
        <FieldCard title="Series" current={retryFailedOnly ? "Current · empty" : "Mixed · 3 series and 4 empty"} hint="Clearing never changes series position"><ScalarEditor value={draft.series} onChange={(value) => updateField("series", value)} options={["Hainish Cycle", "Broken Earth"]} /></FieldCard>
      </div>
      <IndividualOnly />
    </main>
  );
}

function ChangeMatrix({ draft, updateField }: EditorProps) {
  return (
    <main className="px-6 py-5">
      <div className="mb-4 flex items-end justify-between"><div><h2 className="text-xl font-semibold">Change matrix</h2><p className="mt-1 text-xs text-app-ink-muted">Scan every field, operation, and expected effect in one table.</p></div><div className="text-xs text-app-ink-muted">Mixed values shown, never guessed</div></div>
      <div className="overflow-hidden rounded-xl border border-app-border">
        <div className="grid grid-cols-[150px_1.5fr_150px_1.2fr_120px] bg-app-bg-secondary px-4 py-2 text-[10px] font-bold uppercase tracking-[0.14em] text-app-ink-muted"><span>Field</span><span>Current selection</span><span>Operation</span><span>Value</span><span>Effect</span></div>
        <MatrixRow title="Language" current="6 English · 1 Italian · 1 Spanish"><ScalarEditor value={draft.language} onChange={(value) => updateField("language", value)} options={["English", "Dutch"]} compact /></MatrixRow>
        <MatrixRow title="Tags" current="5 different combinations"><SetEditor value={draft.tags} onChange={(value) => updateField("tags", value)} options={["Reviewed", "Owned"]} compact /></MatrixRow>
        <MatrixRow title="Category" current="4 different categories"><SetEditor value={draft.category} onChange={(value) => updateField("category", value)} options={["Science fiction", "Literature"]} compact /></MatrixRow>
        <MatrixRow title="Series" current="3 series · 4 empty"><ScalarEditor value={draft.series} onChange={(value) => updateField("series", value)} options={["Hainish Cycle", "Broken Earth"]} compact /></MatrixRow>
        <div className="grid grid-cols-[150px_1.5fr_150px_1.2fr_120px] items-center border-t border-app-border px-4 py-3 text-xs opacity-55"><span className="font-semibold">Title / ISBN</span><span>Different for every book</span><span>Individual only</span><span>—</span><span>0 changes</span></div>
      </div>
    </main>
  );
}

function OutcomeWorkbench({ draft, updateField, showSelectedOnly, setShowSelectedOnly }: EditorProps & { showSelectedOnly: boolean; setShowSelectedOnly: (value: boolean) => void }) {
  const operations = [draft.tags.action !== "keep" ? `${draft.tags.action} tag “${draft.tags.value}”` : null, draft.series.action !== "keep" ? `${draft.series.action} series` : null].filter(Boolean);
  return (
    <main className="grid min-h-[560px] grid-cols-[210px_1fr_1.15fr]">
      <aside className="border-r border-app-border bg-app-bg-secondary p-4"><div className="mb-3 text-xs font-semibold">Selected books</div><label className="mb-3 flex items-center gap-2 text-[11px] text-app-ink-muted"><input type="checkbox" checked={showSelectedOnly} onChange={(event) => setShowSelectedOnly(event.target.checked)} /> Show selected only</label>{books.slice(0, 6).map((book) => <div key={book.id} className="mb-1.5 truncate text-[11px]">{book.title}</div>)}<div className="mt-2 text-[10px] text-app-ink-muted">+ 2 more</div></aside>
      <section className="border-r border-app-border p-5"><h2 className="text-lg font-semibold">Change recipe</h2><p className="mt-1 text-xs text-app-ink-muted">Stack explicit field operations in order.</p><div className="mt-5 space-y-3"><RecipeStep number={1} label="Tags" value={draft.tags} onChange={(value) => updateField("tags", value)} /><RecipeStep number={2} label="Series" value={draft.series} onChange={(value) => updateField("series", value)} /></div><button className="mt-4 inline-flex items-center gap-2 rounded-lg border border-dashed border-app-border px-3 py-2 text-xs text-app-ink-muted"><Plus size={13} /> Add field operation</button></section>
      <section className="p-5"><div className="flex items-center justify-between"><h2 className="text-lg font-semibold">Expected outcome</h2><span className="text-[11px] text-app-ink-muted">Live preview</span></div><div className="mt-4 space-y-2">{books.map((book, index) => <div key={book.id} className="rounded-lg border border-app-border p-3"><div className="flex items-center"><span className="truncate text-xs font-semibold">{book.title}</span><span className="ml-auto text-[10px] text-app-ink-muted">{book.format}</span></div><div className="mt-1 text-[10px] text-app-ink-muted">{index === 7 ? "No effective change" : operations.join(" · ")}</div>{book.format === "PDF" ? <div className="mt-2 flex items-center gap-1 text-[10px] text-amber-600"><FileWarning size={11} /> Library changes save; embedded file update unavailable</div> : null}</div>)}</div></section>
    </main>
  );
}

function Review({ draft, selectedCount, retryFailedOnly, onBack, onSave }: { draft: Draft; selectedCount: number; retryFailedOnly: boolean; onBack: () => void; onSave: () => void }) {
  const changes = [draft.language.action !== "keep" ? `Language: ${describe(draft.language)}` : null, draft.tags.action !== "keep" ? `Tags: ${describe(draft.tags)}` : null, draft.category.action !== "keep" ? `Category: ${describe(draft.category)}` : null, draft.series.action !== "keep" ? `Series: ${describe(draft.series)}` : null].filter(Boolean);
  return <main className="mx-auto max-w-4xl px-7 py-6"><button onClick={onBack} className="mb-5 inline-flex items-center gap-2 text-xs font-semibold text-app-ink-muted"><ArrowLeft size={13} /> Back to editing</button><h2 className="text-xl font-semibold">Review {selectedCount} independent book {selectedCount === 1 ? "save" : "saves"}</h2><p className="mt-1 text-xs text-app-ink-muted">{retryFailedOnly ? "The successful books are excluded; only the corrected conflict will be saved." : "Only effective changes are saved. One book can fail without rolling back the others."}</p><div className="mt-5 grid grid-cols-[1fr_280px] gap-5"><div className="rounded-xl border border-app-border"><div className="border-b border-app-border px-4 py-3 text-xs font-semibold">Field operations</div>{changes.map((change) => <div key={change} className="flex items-center gap-2 border-b border-app-border px-4 py-3 text-xs last:border-0"><Check size={13} className="text-emerald-500" />{change}</div>)}</div><aside className="rounded-xl border border-app-border bg-app-bg-secondary p-4 text-xs"><div className="font-semibold">Preflight</div><div className="mt-3 flex justify-between"><span className="text-app-ink-muted">Selected</span><span>{selectedCount} {selectedCount === 1 ? "book" : "books"}</span></div><div className="mt-2 flex justify-between"><span className="text-app-ink-muted">Effective changes</span><span>{retryFailedOnly ? "1 book" : "7 books"}</span></div>{retryFailedOnly ? null : <><div className="mt-2 flex justify-between"><span className="text-app-ink-muted">Unchanged</span><span>1 book</span></div><div className="mt-2 flex justify-between"><span className="text-app-ink-muted">Library-only files</span><span>2 PDFs</span></div><div className="mt-4 rounded-lg border border-amber-500/25 bg-amber-500/10 p-3 text-[11px] text-amber-600">PDF metadata stays correct in the Library; no unsupported embedded write is scheduled.</div></>}</aside></div><div className="mt-6 flex justify-end"><button onClick={onSave} className="inline-flex items-center gap-2 rounded-lg bg-app-accent px-5 py-2.5 text-xs font-semibold text-white"><Save size={14} /> Save {selectedCount} {selectedCount === 1 ? "book" : "books"}</button></div></main>;
}

function Saving({ progress, selectedBooks }: { progress: number; selectedBooks: typeof books }) {
  return <main className="mx-auto flex max-w-xl flex-col items-center px-8 py-20 text-center"><Loader2 size={34} className="animate-spin text-app-accent" /><h2 className="mt-5 text-xl font-semibold">Saving books independently</h2><p className="mt-2 text-xs text-app-ink-muted">{progress} of {selectedBooks.length} complete · You can leave this screen without cancelling Save.</p><div className="mt-6 h-2 w-full overflow-hidden rounded-full bg-app-bg-tertiary"><div className="h-full bg-app-accent transition-all" style={{ width: `${(progress / selectedBooks.length) * 100}%` }} /></div><div className="mt-5 grid w-full grid-cols-4 gap-2">{selectedBooks.map((book, index) => <div key={book.id} className={`rounded-lg border p-2 text-[10px] ${index < progress ? "border-emerald-500/30 bg-emerald-500/10" : "border-app-border"}`}>{index < progress ? <CheckCircle2 size={12} className="mx-auto mb-1 text-emerald-500" /> : <CircleDashed size={12} className="mx-auto mb-1 text-app-ink-muted" />}<span className="line-clamp-1">{book.title}</span></div>)}</div></main>;
}

function Results({ retryFailedOnly, onEditFailed, onDone }: { retryFailedOnly: boolean; onEditFailed: () => void; onDone: () => void }) {
  if (retryFailedOnly) return <main className="mx-auto max-w-2xl px-7 py-16 text-center"><CheckCircle2 size={36} className="mx-auto text-emerald-500" /><div className="mt-5 text-[10px] font-bold uppercase tracking-[0.18em] text-emerald-500">Batch Save complete</div><h2 className="mt-1 text-2xl font-semibold">1 corrected book saved</h2><p className="mt-2 text-xs text-app-ink-muted">Invisible Cities is now Library truth. Previously successful books were left untouched.</p><button onClick={onDone} className="mt-6 rounded-lg bg-app-accent px-4 py-2.5 text-xs font-semibold text-white">Back to Library</button></main>;
  return <main className="mx-auto max-w-4xl px-7 py-7"><div className="flex items-start"><div><div className="text-[10px] font-bold uppercase tracking-[0.18em] text-emerald-500">Batch Save complete</div><h2 className="mt-1 text-2xl font-semibold">6 saved · 1 unchanged · 1 needs review</h2><p className="mt-2 text-xs text-app-ink-muted">Successful books are already Library truth. The failed book remains selected for correction.</p></div><button onClick={onDone} className="ml-auto rounded-lg bg-app-accent px-4 py-2.5 text-xs font-semibold text-white">Back to Library</button></div><div className="mt-6 grid grid-cols-[1fr_320px] gap-5"><div className="rounded-xl border border-app-border"><ResultRow icon={<CheckCircle2 size={15} />} tone="success" title="6 books saved" detail="Library updated; safe EPUB file work started automatically." /><ResultRow icon={<Minus size={15} />} tone="muted" title="Piranesi unchanged" detail="The requested values already matched." /><ResultRow icon={<AlertTriangle size={15} />} tone="warning" title="Invisible Cities needs review" detail="Language changed elsewhere after this batch draft was opened." /></div><aside className="rounded-xl border border-app-border bg-app-bg-secondary p-4"><div className="text-xs font-semibold">Next action</div><p className="mt-2 text-[11px] text-app-ink-muted">Review the one conflict against its latest Library values. Successful books will not be saved again.</p><button onClick={onEditFailed} className="mt-4 w-full rounded-lg border border-app-border bg-app-surface px-3 py-2 text-xs font-semibold">Edit 1 failed book</button></aside></div></main>;
}

function ScalarEditor({ value, onChange, options, compact = false }: { value: { action: ScalarAction; value: string }; onChange: (value: { action: ScalarAction; value: string }) => void; options: string[]; compact?: boolean }) {
  return <div className={`flex ${compact ? "contents" : "mt-3 gap-2"}`}><select aria-label="Field operation" value={value.action} onChange={(event) => onChange({ ...value, action: event.target.value as ScalarAction })} className="h-9 rounded-lg border border-app-border bg-app-surface px-2 text-xs"><option value="keep">Keep as-is</option><option value="replace">Replace</option><option value="clear">Clear</option></select><select aria-label="Field value" disabled={value.action !== "replace"} value={value.value} onChange={(event) => onChange({ ...value, value: event.target.value })} className="h-9 min-w-0 rounded-lg border border-app-border bg-app-surface px-2 text-xs disabled:opacity-35">{options.map((option) => <option key={option}>{option}</option>)}</select>{compact ? <span className="text-[10px] text-app-ink-muted">{value.action === "keep" ? "0 books" : "up to 8"}</span> : null}</div>;
}

function SetEditor({ value, onChange, options, compact = false }: { value: { action: SetAction; value: string }; onChange: (value: { action: SetAction; value: string }) => void; options: string[]; compact?: boolean }) {
  return <div className={`flex ${compact ? "contents" : "mt-3 gap-2"}`}><select aria-label="Field operation" value={value.action} onChange={(event) => onChange({ ...value, action: event.target.value as SetAction })} className="h-9 rounded-lg border border-app-border bg-app-surface px-2 text-xs"><option value="keep">Keep as-is</option><option value="append">Append</option><option value="remove">Remove</option><option value="replace">Replace all</option><option value="clear">Clear all</option></select><select aria-label="Field value" disabled={value.action === "keep" || value.action === "clear"} value={value.value} onChange={(event) => onChange({ ...value, value: event.target.value })} className="h-9 min-w-0 rounded-lg border border-app-border bg-app-surface px-2 text-xs disabled:opacity-35">{options.map((option) => <option key={option}>{option}</option>)}</select>{compact ? <span className="text-[10px] text-app-ink-muted">{value.action === "keep" ? "0 books" : "up to 8"}</span> : null}</div>;
}

function FieldCard({ title, current, hint, children }: { title: string; current: string; hint: string; children: React.ReactNode }) { return <section className="rounded-xl border border-app-border p-4"><div className="flex items-center"><h3 className="text-sm font-semibold">{title}</h3><span className="ml-auto text-[10px] text-app-ink-muted">{hint}</span></div><p className="mt-2 text-[11px] text-app-ink-muted">{current}</p>{children}</section>; }
function MatrixRow({ title, current, children }: { title: string; current: string; children: React.ReactNode }) { return <div className="grid grid-cols-[150px_1.5fr_150px_1.2fr_120px] items-center border-t border-app-border px-4 py-3 text-xs"><span className="font-semibold">{title}</span><span className="text-app-ink-muted">{current}</span>{children}</div>; }
function IndividualOnly() { return <div className="mt-4 flex items-center gap-3 rounded-xl border border-dashed border-app-border p-4 text-xs"><FileWarning size={16} className="text-app-ink-muted" /><div><div className="font-semibold">Title, ISBN, cover, and series position are individual-only</div><div className="mt-0.5 text-[11px] text-app-ink-muted">They need book-specific values and cannot be safely shared across this selection.</div></div></div>; }
function RecipeStep({ number, label, value, onChange }: { number: number; label: string; value: Draft["tags"] | Draft["series"]; onChange: (value: never) => void }) { const setValue = value as Draft["tags"]; return <div className="rounded-xl border border-app-border p-3"><div className="mb-3 flex items-center gap-2"><span className="flex h-5 w-5 items-center justify-center rounded-full bg-app-accent/10 text-[10px] font-bold text-app-accent">{number}</span><span className="text-xs font-semibold">{label}</span><X size={13} className="ml-auto text-app-ink-muted" /></div>{label === "Tags" ? <SetEditor value={setValue} onChange={(next) => onChange(next as never)} options={["Reviewed", "Owned"]} /> : <ScalarEditor value={value as Draft["series"]} onChange={(next) => onChange(next as never)} options={["Hainish Cycle", "Broken Earth"]} />}</div>; }
function StepBar({ screen }: { screen: Screen }) { const active = screen === "edit" ? 0 : screen === "review" ? 1 : 2; return <div className="flex items-center justify-center gap-2 border-b border-app-border bg-app-bg-secondary py-2.5 text-[10px] font-bold uppercase tracking-[0.14em] text-app-ink-muted">{["Edit fields", "Review", "Save & results"].map((label, index) => <div key={label} className={`flex items-center gap-2 ${index <= active ? "text-app-ink" : ""}`}><span className={`flex h-5 w-5 items-center justify-center rounded-full ${index <= active ? "bg-app-accent text-white" : "bg-app-bg-tertiary"}`}>{index + 1}</span>{label}{index < 2 ? <span className="mx-2 text-app-border">—</span> : null}</div>)}</div>; }
function ResultRow({ icon, tone, title, detail }: { icon: React.ReactNode; tone: "success" | "warning" | "muted"; title: string; detail: string }) { const color = tone === "success" ? "text-emerald-500" : tone === "warning" ? "text-amber-500" : "text-app-ink-muted"; return <div className="flex gap-3 border-b border-app-border p-4 last:border-0"><span className={color}>{icon}</span><div><div className="text-xs font-semibold">{title}</div><div className="mt-1 text-[11px] text-app-ink-muted">{detail}</div></div></div>; }
function describe(field: { action: string; value: string }) { return field.action === "clear" ? "Clear" : `${field.action} “${field.value}”`; }
function StateStrip({ variant, screen, draft, progress, selectedCount, visibleCount }: { variant: BatchPrototypeVariant; screen: Screen; draft: Draft; progress: number; selectedCount: number; visibleCount: number }) { const operations = Object.entries(draft).filter(([, value]) => value.action !== "keep").map(([field, value]) => `${field}:${value.action}`); return <div className="fixed bottom-4 left-[230px] right-5 z-40 flex items-center gap-3 rounded-xl border border-app-border bg-app-surface/95 px-4 py-2 text-[10px] text-app-ink-muted shadow-lg backdrop-blur"><Layers3 size={13} className="text-app-accent" /><span className="font-bold uppercase tracking-[0.14em] text-app-ink">Batch state</span><span>Variant {variant}</span><span>·</span><span>Screen {screen}</span><span>·</span><span>{selectedCount} selected / {visibleCount} visible</span><span>·</span><span>{operations.join(", ") || "no operations"}</span>{screen === "saving" ? <><span>·</span><span>{progress}/{selectedCount}</span></> : null}</div>; }
