// Three variants of the existing book editor, switchable via ?prototype=book-edit&variant=, on the current app shell.
import {
  AlertTriangle,
  ArrowLeft,
  BookOpen,
  Check,
  ChevronLeft,
  ChevronRight,
  Circle,
  FileCheck2,
  ListChecks,
  RotateCcw,
  Save,
  Search,
  Sparkles,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Button, Input } from "../../components/ui";
import type { LibraryItem } from "../../types/library";
import { PrototypeSwitcher, type PrototypeVariant } from "./PrototypeSwitcher";

type CoverChoice = "library" | "embedded" | "proposal" | "removed";
type SyncState = "idle" | "queued" | "succeeded" | "problem";

type Draft = {
  title: string;
  authors: string;
  publishedYear: string;
  language: string;
  isbn: string;
  series: string;
  seriesIndex: string;
  genres: string;
  description: string;
  cover: CoverChoice;
};

type DraftKey = keyof Draft;

type PrototypeViewProps = {
  baseline: Draft;
  draft: Draft;
  dirtyFields: DraftKey[];
  syncState: SyncState;
  notice: string;
  setField: (field: DraftKey, value: string) => void;
  applyProposal: (fields?: DraftKey[]) => void;
  setCover: (cover: CoverChoice) => void;
  onCancel: () => void;
  onSave: () => void;
  onSimulateProblem: () => void;
};

const sampleDescription =
  "On the planet Gethen, an envoy must bridge politics, loyalty, and a culture unlike his own.";

function variantFromUrl(): PrototypeVariant {
  const value = new URLSearchParams(window.location.search).get("variant");
  return value === "B" || value === "C" ? value : "A";
}

function initialDraft(item?: LibraryItem): Draft {
  return {
    title: item?.title?.trim() || "The Left Hand of Darkness",
    authors: item?.authors?.join(", ") || "Ursula K. Le Guin",
    publishedYear: item?.published_year ? String(item.published_year) : "1969",
    language: item?.language || "English",
    isbn: item?.isbn || "9780441478125",
    series: item?.series || "Hainish Cycle",
    seriesIndex: item?.series_index ? String(item.series_index) : "4",
    genres: item?.genres?.join(", ") || "Science fiction, Classics",
    description: sampleDescription,
    cover: "library",
  };
}

function proposalFor(draft: Draft): Partial<Draft> {
  return {
    title: draft.title.replace(/\s+/g, " ").trim(),
    authors: draft.authors.includes("Le Guin") ? "Ursula K. Le Guin" : draft.authors,
    publishedYear: draft.publishedYear || "1969",
    language: draft.language || "English",
    genres: draft.genres || "Science fiction, Classics",
    description: draft.description || sampleDescription,
    cover: "proposal",
  };
}

function fieldLabel(field: DraftKey): string {
  const labels: Record<DraftKey, string> = {
    title: "Title",
    authors: "Authors",
    publishedYear: "Published",
    language: "Language",
    isbn: "ISBN",
    series: "Series",
    seriesIndex: "No.",
    genres: "Categories",
    description: "Description",
    cover: "Cover",
  };
  return labels[field];
}

function CoverProof({ draft, compact = false }: { draft: Draft; compact?: boolean }) {
  const removed = draft.cover === "removed";
  const palette =
    draft.cover === "embedded"
      ? "from-[#243447] via-[#315f68] to-[#ddb892]"
      : draft.cover === "proposal"
        ? "from-[#221d36] via-[#6d3f5f] to-[#d7905b]"
        : "from-[#283d3b] via-[#4d6a60] to-[#d2b48c]";
  return (
    <div
      className={`relative overflow-hidden rounded-sm border border-black/10 bg-gradient-to-br ${palette} text-white shadow-[0_16px_30px_rgba(24,18,14,0.18)] ${compact ? "aspect-[3/4] w-28" : "aspect-[3/4] w-full"}`}
    >
      {removed ? (
        <div className="flex h-full flex-col items-center justify-center gap-2 bg-white/90 px-5 text-center text-[#706860]">
          <BookOpen size={30} strokeWidth={1.25} />
          <span className="text-[10px] font-semibold uppercase tracking-[0.22em]">No cover in draft</span>
        </div>
      ) : (
        <>
          <div className="absolute inset-x-0 top-0 h-1 bg-white/70" />
          <div className="flex h-full flex-col justify-between p-5">
            <div className="text-[9px] font-semibold uppercase tracking-[0.25em] text-white/75">A Folio edition</div>
            <div>
              <div className={`${compact ? "text-lg" : "text-2xl"} font-serif leading-[0.98]`}>{draft.title}</div>
              <div className="mt-3 h-px w-10 bg-white/60" />
              <div className="mt-3 text-[10px] uppercase tracking-[0.18em] text-white/80">{draft.authors}</div>
            </div>
          </div>
        </>
      )}
      <div className="absolute bottom-2 right-2 rounded bg-black/25 px-1.5 py-0.5 text-[8px] uppercase tracking-widest backdrop-blur">
        {draft.cover}
      </div>
    </div>
  );
}

function SyncBadge({ syncState }: { syncState: SyncState }) {
  const content = {
    idle: { label: "Draft only · Library unchanged", tone: "bg-[#f1ede8] text-[#706860]", icon: Circle },
    queued: { label: "Saved · updating 2 EPUB files", tone: "bg-sky-50 text-sky-700", icon: RotateCcw },
    succeeded: { label: "Saved · files up to date", tone: "bg-emerald-50 text-emerald-700", icon: FileCheck2 },
    problem: { label: "Saved · 1 file needs attention", tone: "bg-amber-50 text-amber-800", icon: AlertTriangle },
  }[syncState];
  const Icon = content.icon;
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold ${content.tone}`}>
      <Icon size={12} className={syncState === "queued" ? "animate-spin" : ""} />
      {content.label}
    </span>
  );
}

function DraftState({ dirtyFields, syncState }: { dirtyFields: DraftKey[]; syncState: SyncState }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 border-y border-dashed border-black/10 bg-white/45 px-3 py-2 text-[10px] uppercase tracking-[0.14em] text-[#706860]">
      <span>Prototype state</span>
      <span>{dirtyFields.length ? `${dirtyFields.length} draft changes` : "Draft matches Library"}</span>
      <span>File operation: {syncState}</span>
    </div>
  );
}

function TextField({
  label,
  value,
  onChange,
  className = "",
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  className?: string;
}) {
  return (
    <label className={`block ${className}`}>
      <span className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.11em] text-[#706860]">{label}</span>
      <Input value={value} onChange={(event) => onChange(event.target.value)} className="bg-white/80" />
    </label>
  );
}

function VariantA(props: PrototypeViewProps) {
  const { draft, baseline, dirtyFields, syncState, notice, setField, applyProposal, setCover, onCancel, onSave, onSimulateProblem } = props;
  const [phase, setPhase] = useState<"edit" | "review">("edit");
  const saved = syncState !== "idle";
  const fields: Array<{ key: Exclude<DraftKey, "cover" | "description">; label: string }> = [
    { key: "title", label: "Title" },
    { key: "authors", label: "Authors" },
    { key: "publishedYear", label: "Published" },
    { key: "language", label: "Language" },
    { key: "isbn", label: "ISBN" },
    { key: "series", label: "Series" },
    { key: "seriesIndex", label: "No." },
    { key: "genres", label: "Categories" },
  ];
  const visibleFields = phase === "review"
    ? fields.filter(({ key }) => dirtyFields.includes(key))
    : fields;

  const handleCancel = () => {
    onCancel();
    setPhase("edit");
  };

  return (
    <div className="mx-auto w-full max-w-[1380px] pb-12">
      <header className="mb-3 flex flex-wrap items-center justify-between gap-4">
        <div className="flex min-w-0 items-center gap-3">
          <button type="button" aria-label="Back to preserved Library context" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-black/10 bg-white/70 hover:bg-white">
            <ArrowLeft size={16} />
          </button>
          <div className="min-w-0">
            <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[#8c8177]">Library · Science fiction · 24 results</div>
            <h1 className="truncate font-serif text-2xl leading-tight text-[#1a1614]">{draft.title}</h1>
          </div>
        </div>
        <SyncBadge syncState={syncState} />
      </header>

      <nav aria-label="Edit progress" className="mb-3 grid overflow-hidden rounded-lg border border-black/10 bg-white sm:grid-cols-3">
        {[
          { label: "Edit", detail: "Compare and adjust", active: phase === "edit" && !saved, complete: phase === "review" || saved },
          { label: "Review", detail: `${dirtyFields.length} change${dirtyFields.length === 1 ? "" : "s"}`, active: phase === "review" && !saved, complete: saved },
          { label: "Saved", detail: saved ? "Library updated" : "Files follow afterward", active: saved, complete: false },
        ].map((step, index) => (
          <button
            key={step.label}
            type="button"
            disabled={index === 2 || (index === 1 && !dirtyFields.length)}
            onClick={() => index === 0 ? setPhase("edit") : setPhase("review")}
            className={`flex items-center gap-3 border-black/10 px-4 py-2.5 text-left sm:border-r sm:last:border-r-0 ${step.active ? "bg-[#27211e] text-white" : "bg-white text-[#706860]"} disabled:cursor-default`}
          >
            <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-[10px] font-bold ${step.complete ? "border-emerald-500 bg-emerald-500 text-white" : step.active ? "border-white/35" : "border-black/15"}`}>{step.complete ? <Check size={12} /> : index + 1}</span>
            <span><span className="block text-xs font-semibold">{step.label}</span><span className={`block text-[10px] ${step.active ? "text-white/65" : "text-[#8c8177]"}`}>{step.detail}</span></span>
          </button>
        ))}
      </nav>

      <DraftState dirtyFields={dirtyFields} syncState={syncState} />
      {notice ? <div className={`mt-2 rounded-md border px-3 py-2 text-xs ${syncState === "problem" ? "border-amber-200 bg-amber-50 text-amber-900" : "border-emerald-700/10 bg-emerald-50 text-emerald-800"}`}>{notice}</div> : null}

      <div className="mt-3 grid gap-3 min-[1120px]:grid-cols-[minmax(0,1fr)_300px]">
        <main className="overflow-hidden rounded-xl border border-black/10 bg-white shadow-[0_16px_42px_rgba(35,27,20,0.055)]">
          <div className="flex items-center justify-between border-b border-black/10 bg-[#27211e] px-4 py-2.5 text-white">
            <div>
              <div className="text-[10px] font-semibold uppercase tracking-[0.15em] text-white/60">{phase === "edit" ? "Library and draft" : "Final check"}</div>
              <div className="mt-0.5 text-xs font-semibold">{phase === "edit" ? "Edit without losing the original" : "Only effective changes are shown"}</div>
            </div>
            {phase === "review" ? <button type="button" onClick={() => setPhase("edit")} className="text-[11px] font-semibold text-white/75 hover:text-white">Back to editing</button> : null}
          </div>

          <div className="grid grid-cols-[112px_1fr_28px_1fr] gap-3 border-b border-black/10 bg-[#f7f5f2] px-4 py-2 text-[9px] font-semibold uppercase tracking-[0.13em] text-[#706860]">
            <span>Field</span><span>In Library</span><span /><span>{phase === "edit" ? "Draft" : "After Save"}</span>
          </div>

          {visibleFields.map(({ key, label }) => (
            <DiffRow key={key} label={label} current={baseline[key]} draft={draft[key]} onChange={(value) => setField(key, value)} dense />
          ))}

          {phase === "review" && dirtyFields.includes("cover") ? (
            <div className="grid grid-cols-[112px_1fr_28px_1fr] items-center gap-3 bg-orange-50/60 px-4 py-3">
              <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[#706860]">Cover</div>
              <div className="flex items-center gap-2 text-xs text-[#706860]"><span className="h-9 w-7 rounded-sm bg-gradient-to-br from-[#283d3b] via-[#4d6a60] to-[#d2b48c]" />Library cover</div>
              <div className="flex h-5 w-5 items-center justify-center rounded-full bg-orange-500 text-white"><ChevronRight size={12} /></div>
              <div className="flex items-center gap-2 text-xs font-semibold"><span className={`h-9 w-7 rounded-sm ${draft.cover === "removed" ? "border border-dashed border-black/20 bg-white" : "bg-gradient-to-br from-[#221d36] via-[#6d3f5f] to-[#d7905b]"}`} />{draft.cover === "proposal" ? "Suggested cover" : draft.cover === "embedded" ? "Embedded cover" : "No cover"}</div>
            </div>
          ) : null}

          {phase === "edit" || dirtyFields.includes("description") ? (
            <div className={`grid grid-cols-[112px_1fr_28px_1fr] items-start gap-3 px-4 py-3 ${dirtyFields.includes("description") ? "bg-orange-50/60" : "bg-white"}`}>
              <div className="pt-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-[#706860]">Description</div>
              <p className="line-clamp-2 pt-2 text-xs leading-relaxed text-[#706860]">{baseline.description || "Empty"}</p>
              <div className={`mt-2 flex h-5 w-5 items-center justify-center rounded-full ${dirtyFields.includes("description") ? "bg-orange-500 text-white" : "bg-[#eee9e3] text-[#8c8177]"}`}>{dirtyFields.includes("description") ? <ChevronRight size={12} /> : <Check size={11} />}</div>
              <textarea value={draft.description} onChange={(event) => setField("description", event.target.value)} className="h-16 w-full resize-none rounded-md border border-black/10 bg-white px-3 py-2 text-xs leading-relaxed outline-none focus:ring-2 focus:ring-orange-500" />
            </div>
          ) : null}

          {phase === "review" && !dirtyFields.length ? (
            <div className="flex min-h-48 flex-col items-center justify-center px-6 text-center">
              <Check size={24} className="text-emerald-600" />
              <h2 className="mt-3 text-sm font-semibold">No unsaved changes</h2>
              <p className="mt-1 text-xs text-[#706860]">The draft matches the Library.</p>
            </div>
          ) : null}
        </main>

        <aside className="space-y-3">
          <section className="rounded-xl border border-violet-200 bg-violet-50 p-3.5">
            <div className="flex items-center justify-between"><div className="flex items-center gap-2 text-xs font-semibold text-violet-950"><Sparkles size={14} /> Best match</div><span className="rounded-full bg-violet-200 px-2 py-0.5 text-[9px] font-bold uppercase text-violet-900">High</span></div>
            <p className="mt-2 text-[11px] leading-relaxed text-violet-900/75">6 matching values from Open Library and Apple Books.</p>
            <Button variant="outline" size="sm" className="mt-3 w-full border-violet-300 bg-white" onClick={() => applyProposal()}>Use suggestions in draft</Button>
          </section>

          <section className="rounded-xl border border-black/10 bg-white p-3.5">
            <div className="flex items-start gap-3">
              <CoverProof draft={draft} compact />
              <div className="min-w-0 flex-1">
                <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[#706860]">Cover in draft</div>
                <div className="mt-2 space-y-1.5">
                  <button type="button" onClick={() => setCover("library")} className="block text-left text-[11px] font-semibold text-[#504943] hover:text-orange-700">Keep Library cover</button>
                  <button type="button" onClick={() => setCover("embedded")} className="block text-left text-[11px] font-semibold text-[#504943] hover:text-orange-700">Use embedded cover</button>
                  <button type="button" onClick={() => setCover("proposal")} className="block text-left text-[11px] font-semibold text-violet-800 hover:text-violet-950">Use suggested cover</button>
                  <button type="button" onClick={() => setCover("removed")} className="block text-left text-[11px] font-semibold text-red-600">Remove in draft</button>
                </div>
              </div>
            </div>
          </section>

          <section className="rounded-xl border border-black/10 bg-white p-3.5">
            <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-[#706860]"><ListChecks size={13} /> Save boundary</div>
            <p className="mt-2 text-[11px] leading-relaxed text-[#504943]">Save updates the Library once. Two EPUB updates run separately afterward.</p>
            {phase === "edit" && !saved ? (
              <Button variant="primary" size="sm" className="mt-3 w-full" onClick={() => setPhase("review")} disabled={!dirtyFields.length}>Review {dirtyFields.length || ""} change{dirtyFields.length === 1 ? "" : "s"} <ChevronRight size={13} /></Button>
            ) : (
              <div className="mt-3 grid grid-cols-2 gap-2">
                <Button variant="outline" size="sm" onClick={handleCancel} disabled={!dirtyFields.length}>Cancel</Button>
                <Button variant="primary" size="sm" onClick={onSave} disabled={!dirtyFields.length}>Save</Button>
              </div>
            )}
          </section>
          {syncState === "succeeded" ? <Button variant="ghost" size="sm" className="w-full text-amber-700" onClick={onSimulateProblem}>Simulate file problem</Button> : null}
        </aside>
      </div>
    </div>
  );
}

function DiffRow({
  label,
  current,
  draft,
  onChange,
  dense = false,
}: {
  label: string;
  current: string;
  draft: string;
  onChange: (value: string) => void;
  dense?: boolean;
}) {
  const changed = current !== draft;
  return (
    <div className={`grid items-center gap-3 border-b border-black/8 px-4 ${dense ? "grid-cols-[112px_1fr_28px_1fr] py-2" : "grid-cols-[130px_1fr_32px_1fr] py-3"} ${changed ? "bg-orange-50/60" : "bg-white"}`}>
      <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[#706860]">{label}</div>
      <div className="truncate text-xs text-[#706860]">{current || "Empty"}</div>
      <div className={`flex h-5 w-5 items-center justify-center rounded-full ${changed ? "bg-orange-500 text-white" : "bg-[#eee9e3] text-[#8c8177]"}`}>
        {changed ? <ChevronRight size={12} /> : <Check size={11} />}
      </div>
      <Input value={draft} onChange={(event) => onChange(event.target.value)} className={`${dense ? "h-7" : "h-8"} bg-white text-xs`} />
    </div>
  );
}

function VariantB(props: PrototypeViewProps) {
  const { baseline, draft, dirtyFields, syncState, notice, setField, applyProposal, setCover, onCancel, onSave, onSimulateProblem } = props;
  return (
    <div className="mx-auto w-full max-w-[1380px] pb-12">
      <header className="mb-4 flex flex-wrap items-end justify-between gap-4">
        <div>
          <button type="button" className="mb-2 flex items-center gap-2 text-xs text-[#706860] hover:text-[#1a1614]"><ArrowLeft size={14} /> Library · Science fiction · 24 results</button>
          <div className="flex items-baseline gap-3"><h1 className="text-2xl font-semibold">Review changes</h1><span className="font-serif text-xl text-[#706860]">{draft.title}</span></div>
        </div>
        <SyncBadge syncState={syncState} />
      </header>
      <DraftState dirtyFields={dirtyFields} syncState={syncState} />
      {notice ? <div className="mt-3 rounded-md border border-emerald-700/10 bg-emerald-50 px-3 py-2 text-xs text-emerald-800">{notice}</div> : null}

      <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1fr)_310px]">
        <main className="overflow-hidden rounded-xl border border-black/10 bg-white shadow-[0_18px_50px_rgba(35,27,20,0.06)]">
          <div className="grid grid-cols-[130px_1fr_32px_1fr] gap-3 border-b border-black/10 bg-[#27211e] px-4 py-2.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-white/70">
            <span>Field</span><span>In Library</span><span /><span>Draft after Save</span>
          </div>
          <DiffRow label="Title" current={baseline.title} draft={draft.title} onChange={(value) => setField("title", value)} />
          <DiffRow label="Authors" current={baseline.authors} draft={draft.authors} onChange={(value) => setField("authors", value)} />
          <DiffRow label="Published" current={baseline.publishedYear} draft={draft.publishedYear} onChange={(value) => setField("publishedYear", value)} />
          <DiffRow label="Language" current={baseline.language} draft={draft.language} onChange={(value) => setField("language", value)} />
          <DiffRow label="ISBN" current={baseline.isbn} draft={draft.isbn} onChange={(value) => setField("isbn", value)} />
          <DiffRow label="Series" current={baseline.series} draft={draft.series} onChange={(value) => setField("series", value)} />
          <DiffRow label="Categories" current={baseline.genres} draft={draft.genres} onChange={(value) => setField("genres", value)} />
          <div className="grid grid-cols-[130px_1fr_32px_1fr] gap-3 px-4 py-4">
            <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[#706860]">Cover</div>
            <CoverProof draft={baseline} compact />
            <div className="flex h-5 w-5 items-center justify-center self-center rounded-full bg-orange-500 text-white"><ChevronRight size={12} /></div>
            <div><CoverProof draft={draft} compact /><div className="mt-2 flex gap-1"><button type="button" onClick={() => setCover("embedded")} className="text-[10px] font-semibold text-orange-700">Embedded</button><span className="text-black/20">·</span><button type="button" onClick={() => setCover("proposal")} className="text-[10px] font-semibold text-orange-700">Suggested</button><span className="text-black/20">·</span><button type="button" onClick={() => setCover("removed")} className="text-[10px] font-semibold text-red-600">Remove</button></div></div>
          </div>
        </main>

        <aside className="space-y-4">
          <section className="rounded-xl border border-violet-200 bg-violet-50 p-4">
            <div className="flex items-center justify-between"><div className="flex items-center gap-2 text-xs font-semibold text-violet-950"><Search size={14} /> Best match</div><span className="rounded-full bg-violet-200 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide text-violet-900">High confidence</span></div>
            <h2 className="mt-4 font-serif text-xl leading-tight">{draft.title}</h2>
            <p className="mt-1 text-xs text-violet-900/65">Open Library · Apple Books</p>
            <div className="mt-4 space-y-2 text-[11px] text-violet-950"><div>✓ Author spelling</div><div>✓ Publication year</div><div>✓ Language and categories</div><div>✓ Alternate cover</div></div>
            <Button variant="outline" size="sm" className="mt-4 w-full border-violet-300 bg-white" onClick={() => applyProposal()}>Use 6 suggestions</Button>
          </section>
          <section className="rounded-xl border border-black/10 bg-white p-4">
            <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[#706860]">Commit boundary</div>
            <p className="mt-2 text-xs leading-relaxed text-[#504943]">Save writes the Library once. Two EPUB updates start automatically afterward.</p>
            <div className="mt-4 flex gap-2"><Button variant="outline" size="sm" className="flex-1" onClick={onCancel} disabled={!dirtyFields.length}>Discard draft</Button><Button variant="primary" size="sm" className="flex-1" onClick={onSave} disabled={!dirtyFields.length}>Save {dirtyFields.length || ""}</Button></div>
          </section>
          {syncState === "succeeded" ? <Button variant="ghost" size="sm" className="w-full text-amber-700" onClick={onSimulateProblem}>Simulate file problem</Button> : null}
        </aside>
      </div>
    </div>
  );
}

const guidedSteps = ["Essentials", "Cover", "Details", "Review"] as const;

function VariantC(props: PrototypeViewProps) {
  const { baseline, draft, dirtyFields, syncState, notice, setField, applyProposal, setCover, onCancel, onSave, onSimulateProblem } = props;
  const [step, setStep] = useState(0);
  return (
    <div className="mx-auto w-full max-w-[1120px] pb-16">
      <header className="mb-5 flex items-center justify-between border-b border-black/10 pb-4">
        <button type="button" className="flex items-center gap-2 text-xs text-[#706860]"><ArrowLeft size={14} /> Back to Library · context preserved</button>
        <SyncBadge syncState={syncState} />
      </header>
      <DraftState dirtyFields={dirtyFields} syncState={syncState} />
      {notice ? <div className="mt-3 rounded-md border border-emerald-700/10 bg-emerald-50 px-3 py-2 text-xs text-emerald-800">{notice}</div> : null}

      <div className="mt-5 grid gap-8 md:grid-cols-[180px_minmax(0,1fr)]">
        <aside>
          <div className="mb-4 text-[10px] font-semibold uppercase tracking-[0.18em] text-[#8c8177]">Edit one book</div>
          <nav className="space-y-1">
            {guidedSteps.map((label, index) => (
              <button key={label} type="button" onClick={() => setStep(index)} className={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-xs font-semibold transition ${index === step ? "bg-[#27211e] text-white" : "text-[#706860] hover:bg-white/70"}`}>
                <span className={`flex h-5 w-5 items-center justify-center rounded-full border text-[9px] ${index < step ? "border-emerald-500 bg-emerald-500 text-white" : index === step ? "border-white/40" : "border-black/15"}`}>{index < step ? <Check size={11} /> : index + 1}</span>{label}
              </button>
            ))}
          </nav>
          <div className="mt-5 rounded-lg border border-black/10 bg-white/60 p-3 text-[11px] leading-relaxed text-[#706860]">{dirtyFields.length ? `${dirtyFields.length} changes are held in this draft.` : "Nothing has changed yet."} Cancel is safe at every step.</div>
        </aside>

        <main className="min-h-[610px] rounded-2xl border border-black/10 bg-white p-7 shadow-[0_20px_60px_rgba(35,27,20,0.07)]">
          <div className="mb-7 flex items-start justify-between gap-4">
            <div><div className="text-[10px] font-semibold uppercase tracking-[0.2em] text-orange-700">Step {step + 1} of 4</div><h1 className="mt-1 font-serif text-3xl">{guidedSteps[step]}</h1></div>
            {step === 0 ? <div className="rounded-full bg-violet-50 px-3 py-1.5 text-[10px] font-semibold text-violet-800">3 suggestions ready</div> : null}
          </div>

          {step === 0 ? (
            <div className="space-y-5">
              <p className="max-w-xl text-sm leading-relaxed text-[#706860]">Start with the identity readers will recognize. Suggestions fill the draft; they do not save the book.</p>
              <TextField label="Title" value={draft.title} onChange={(value) => setField("title", value)} />
              <TextField label="Authors" value={draft.authors} onChange={(value) => setField("authors", value)} />
              <div className="grid grid-cols-2 gap-4"><TextField label="Published" value={draft.publishedYear} onChange={(value) => setField("publishedYear", value)} /><TextField label="Language" value={draft.language} onChange={(value) => setField("language", value)} /></div>
              <button type="button" onClick={() => applyProposal(["title", "authors", "publishedYear", "language"])} className="flex w-full items-center justify-between rounded-xl border border-violet-200 bg-violet-50 px-4 py-3 text-left"><span><span className="block text-xs font-semibold text-violet-950">Use matching identity values</span><span className="mt-0.5 block text-[11px] text-violet-800">Open Library and Apple Books agree</span></span><Sparkles size={17} className="text-violet-700" /></button>
            </div>
          ) : null}

          {step === 1 ? (
            <div className="grid gap-8 sm:grid-cols-[220px_1fr]">
              <CoverProof draft={draft} />
              <div className="space-y-3"><p className="text-sm leading-relaxed text-[#706860]">Pick the Library cover. Every option remains part of the draft until the final Save.</p><button type="button" onClick={() => setCover("library")} className="w-full rounded-lg border border-black/10 p-3 text-left text-xs hover:border-orange-400"><b>Keep Library cover</b><span className="mt-1 block text-[#706860]">Current local artwork</span></button><button type="button" onClick={() => setCover("embedded")} className="w-full rounded-lg border border-black/10 p-3 text-left text-xs hover:border-orange-400"><b>Use embedded cover</b><span className="mt-1 block text-[#706860]">Found inside the EPUB</span></button><button type="button" onClick={() => setCover("proposal")} className="w-full rounded-lg border border-violet-200 bg-violet-50 p-3 text-left text-xs"><b>Use suggested cover</b><span className="mt-1 block text-violet-800">Validated preview from Apple Books</span></button><button type="button" onClick={() => setCover("removed")} className="w-full rounded-lg border border-red-200 p-3 text-left text-xs text-red-700"><b>Remove cover from draft</b></button></div>
            </div>
          ) : null}

          {step === 2 ? (
            <div className="space-y-5"><div className="grid grid-cols-2 gap-4"><TextField label="ISBN" value={draft.isbn} onChange={(value) => setField("isbn", value)} /><TextField label="Categories" value={draft.genres} onChange={(value) => setField("genres", value)} /><TextField label="Series" value={draft.series} onChange={(value) => setField("series", value)} /><TextField label="No." value={draft.seriesIndex} onChange={(value) => setField("seriesIndex", value)} /></div><label className="block"><span className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.11em] text-[#706860]">Description</span><textarea value={draft.description} onChange={(event) => setField("description", event.target.value)} className="min-h-44 w-full rounded-md border border-black/10 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-orange-500" /></label></div>
          ) : null}

          {step === 3 ? (
            <div>
              <div className="grid gap-6 sm:grid-cols-[130px_1fr]"><CoverProof draft={draft} compact /><div><h2 className="font-serif text-2xl">{draft.title}</h2><p className="mt-1 text-sm text-[#706860]">{draft.authors} · {draft.publishedYear}</p><div className="mt-5 space-y-2">{dirtyFields.length ? dirtyFields.map((field) => <div key={field} className="grid grid-cols-[110px_1fr] gap-3 border-b border-black/8 pb-2 text-xs"><span className="font-semibold">{fieldLabel(field)}</span><span className="truncate text-[#706860]">{String(baseline[field]) || "Empty"} → {String(draft[field]) || "Empty"}</span></div>) : <p className="text-sm text-[#706860]">No effective changes. Save stays disabled.</p>}</div></div></div>
              <div className="mt-8 rounded-xl border border-sky-200 bg-sky-50 p-4"><div className="flex items-center gap-2 text-xs font-semibold text-sky-900"><FileCheck2 size={15} /> What happens after Save</div><p className="mt-2 text-[11px] leading-relaxed text-sky-800">The Library updates immediately. Two EPUB files update in the background. You can return to the same search and scroll position.</p></div>
              <div className="mt-5 flex justify-end gap-2"><Button variant="outline" onClick={onCancel} disabled={!dirtyFields.length}>Cancel draft</Button><Button variant="primary" onClick={onSave} disabled={!dirtyFields.length}><Save size={14} /> Save changes</Button></div>
              {syncState === "succeeded" ? <Button variant="ghost" size="sm" className="mt-3 w-full text-amber-700" onClick={onSimulateProblem}>Simulate file problem</Button> : null}
            </div>
          ) : null}

          <div className="mt-8 flex items-center justify-between border-t border-black/10 pt-4">
            <Button variant="ghost" size="sm" onClick={() => setStep((current) => Math.max(0, current - 1))} disabled={step === 0}><ChevronLeft size={14} /> Previous</Button>
            {step < guidedSteps.length - 1 ? <Button variant="primary" size="sm" onClick={() => setStep((current) => Math.min(guidedSteps.length - 1, current + 1))}>Continue <ChevronRight size={14} /></Button> : null}
          </div>
        </main>
      </div>
    </div>
  );
}

export function BookEditSavePrototype({ item }: { item?: LibraryItem }) {
  const initial = useMemo(() => initialDraft(item), [item]);
  const [variant, setVariant] = useState<PrototypeVariant>(variantFromUrl);
  const [baseline, setBaseline] = useState<Draft>(initial);
  const [draft, setDraft] = useState<Draft>(initial);
  const [syncState, setSyncState] = useState<SyncState>("idle");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    if (syncState !== "queued") return;
    const timeout = window.setTimeout(() => {
      setSyncState("succeeded");
      setNotice("Saved to Library. 2 EPUB files are up to date.");
    }, 1400);
    return () => window.clearTimeout(timeout);
  }, [syncState]);

  const dirtyFields = (Object.keys(draft) as DraftKey[]).filter((field) => draft[field] !== baseline[field]);

  const setField = (field: DraftKey, value: string) => {
    setDraft((current) => ({ ...current, [field]: value }));
    setNotice("");
    setSyncState("idle");
  };

  const setCover = (cover: CoverChoice) => {
    setDraft((current) => ({ ...current, cover }));
    setNotice("Cover changed in draft only. Save or Cancel decides the outcome.");
    setSyncState("idle");
  };

  const applyProposal = (fields?: DraftKey[]) => {
    const proposal = proposalFor(draft);
    const selected = fields ?? (Object.keys(proposal) as DraftKey[]);
    setDraft((current) => {
      const next = { ...current };
      selected.forEach((field) => {
        const value = proposal[field];
        if (value !== undefined) Object.assign(next, { [field]: value });
      });
      return next;
    });
    setNotice(`${selected.length} suggested fields copied into the draft. Library unchanged.`);
    setSyncState("idle");
  };

  const cancel = () => {
    setDraft(baseline);
    setNotice("Draft discarded. Library and files are unchanged; search context is preserved.");
    setSyncState("idle");
  };

  const save = () => {
    if (!dirtyFields.length) return;
    setBaseline(draft);
    setSyncState("queued");
    setNotice("Saved to Library. You can leave now; 2 EPUB files are updating in the background.");
  };

  const shared: PrototypeViewProps = {
    baseline,
    draft,
    dirtyFields,
    syncState,
    notice,
    setField,
    applyProposal,
    setCover,
    onCancel: cancel,
    onSave: save,
    onSimulateProblem: () => {
      setSyncState("problem");
      setNotice("The Library is saved. One EPUB could not be updated and now needs attention.");
    },
  };

  return (
    <div className="relative min-h-full rounded-2xl bg-[#f4f1ed] p-4 text-[#1a1614] sm:p-6">
      <div className="mb-4 flex items-center justify-between rounded-lg border border-dashed border-orange-300 bg-orange-50/70 px-3 py-2 text-[11px] text-orange-900">
        <span className="font-semibold uppercase tracking-[0.15em]">Throwaway prototype</span>
        <span>All interactions stay in memory · switch with ← and →</span>
      </div>
      {variant === "A" ? <VariantA {...shared} /> : null}
      {variant === "B" ? <VariantB {...shared} /> : null}
      {variant === "C" ? <VariantC {...shared} /> : null}
      <PrototypeSwitcher current={variant} onChange={setVariant} />
    </div>
  );
}
