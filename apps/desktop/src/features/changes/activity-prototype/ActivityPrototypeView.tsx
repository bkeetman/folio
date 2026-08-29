// Three variants of Activity, Problems, and History on the existing Changes route,
// switchable via ?prototype=activity&variant=.
import {
  AlertTriangle,
  ArrowRight,
  BookOpen,
  Check,
  CheckCircle2,
  CircleDashed,
  Clock3,
  FileCheck2,
  HardDrive,
  History,
  MapPin,
  RefreshCw,
  ShieldAlert,
  Smartphone,
  Sparkles,
  Wrench,
} from "lucide-react";
import { useMemo, useState } from "react";

import { Button } from "../../../components/ui";
import { cn } from "../../../lib/utils";
import { PrototypeSwitcher, type PrototypeVariant } from "./PrototypeSwitcher";

type PrototypeStatus =
  | "running"
  | "waiting"
  | "problem"
  | "failed"
  | "succeeded"
  | "decision";

type PrototypeItem = {
  id: string;
  status: PrototypeStatus;
  title: string;
  book: string;
  detail: string;
  file: string;
  origin: string;
  time: string;
  progress?: number;
  device?: string;
  recovery?: string;
};

const initialItems: PrototypeItem[] = [
  {
    id: "cover-running",
    status: "running",
    title: "Updating cover and EPUB metadata",
    book: "The Left Hand of Darkness",
    detail: "1 of 2 local EPUB files is up to date",
    file: "Left Hand of Darkness.epub",
    origin: "Save · Book editor",
    time: "Started 10:42",
    progress: 58,
  },
  {
    id: "device-waiting",
    status: "waiting",
    title: "Waiting for Kobo Libra 2",
    book: "The Shallows",
    detail: "The exact device can safely continue this copy",
    file: "The Shallows.epub",
    origin: "E-reader · Send to device",
    time: "Queued 10:39",
    device: "Kobo Libra 2 · 5A2C-11D0",
  },
  {
    id: "external-problem",
    status: "problem",
    title: "File changed outside Folio",
    book: "Braiding Sweetgrass",
    detail: "Folio stopped before overwriting the external edit",
    file: "Braiding Sweetgrass.epub",
    origin: "Save · Batch edit",
    time: "Needs attention · 10:31",
    recovery: "Compare actual and desired metadata, then choose which state to keep.",
  },
  {
    id: "retry-failed",
    status: "failed",
    title: "Could not publish updated EPUB",
    book: "Silent Spring",
    detail: "The staged file is valid; the original is unchanged",
    file: "Silent Spring.epub",
    origin: "Save · Book editor",
    time: "Failed 10:18",
    recovery: "Permissions are available again. This operation is safe to Retry.",
  },
  {
    id: "organizer-decision",
    status: "decision",
    title: "Organizer plan needs confirmation",
    book: "3 books",
    detail: "2 copies · 1 cross-volume move · no overwrites",
    file: "/Books/Le Guin/ · /Archive/Carson/",
    origin: "Organizer · Preview",
    time: "Prepared 10:12",
  },
  {
    id: "history-success",
    status: "succeeded",
    title: "Library and files are up to date",
    book: "The Book of Tea",
    detail: "Metadata written to 1 EPUB file",
    file: "The Book of Tea.epub",
    origin: "Save · Book editor",
    time: "Completed 09:56",
  },
  {
    id: "history-device",
    status: "succeeded",
    title: "Copied to Kobo Libra 2",
    book: "A Wizard of Earthsea",
    detail: "Device copy verified",
    file: "A Wizard of Earthsea.epub",
    origin: "E-reader · Kobo Libra 2",
    time: "Completed yesterday",
  },
];

function variantFromUrl(): PrototypeVariant {
  const value = new URLSearchParams(window.location.search).get("variant");
  return value === "B" || value === "C" ? value : "A";
}

function statusPresentation(status: PrototypeStatus) {
  if (status === "problem") {
    return { label: "Reconcile", icon: ShieldAlert, tone: "border-amber-300 bg-amber-50 text-amber-800" };
  }
  if (status === "failed") {
    return { label: "Retry available", icon: AlertTriangle, tone: "border-red-200 bg-red-50 text-red-700" };
  }
  if (status === "running") {
    return { label: "In progress", icon: RefreshCw, tone: "border-sky-200 bg-sky-50 text-sky-700" };
  }
  if (status === "waiting") {
    return { label: "Waiting", icon: Clock3, tone: "border-violet-200 bg-violet-50 text-violet-700" };
  }
  if (status === "decision") {
    return { label: "Confirmation", icon: Sparkles, tone: "border-orange-200 bg-orange-50 text-orange-800" };
  }
  return { label: "Succeeded", icon: CheckCircle2, tone: "border-emerald-200 bg-emerald-50 text-emerald-700" };
}

function actionLabel(status: PrototypeStatus): string {
  if (status === "problem") return "Reconcile";
  if (status === "failed") return "Retry";
  if (status === "waiting") return "Device connected";
  if (status === "running") return "Complete demo";
  if (status === "decision") return "Open preview";
  return "View details";
}

function StatusPill({ status }: { status: PrototypeStatus }) {
  const presentation = statusPresentation(status);
  const Icon = presentation.icon;
  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded-full border px-2 py-1 text-[10px] font-semibold", presentation.tone)}>
      <Icon size={11} className={status === "running" ? "animate-spin" : ""} />
      {presentation.label}
    </span>
  );
}

type VariantProps = {
  items: PrototypeItem[];
  selectedId: string;
  notice: string;
  onSelect: (id: string) => void;
  onAction: (item: PrototypeItem) => void;
};

function VariantA({ items, notice, onAction }: VariantProps) {
  const problems = items.filter((item) => item.status === "problem" || item.status === "failed");
  const active = items.filter((item) => item.status === "running" || item.status === "waiting");
  const decisions = items.filter((item) => item.status === "decision");
  const recent = items.filter((item) => item.status === "succeeded");

  return (
    <div className="mx-auto w-full max-w-[1180px] pb-20">
      <header className="mb-5 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--app-ink-muted)]">Library operations</p>
          <h1 className="mt-1 font-serif text-3xl text-[var(--app-ink)]">Activity</h1>
          <p className="mt-1 text-sm text-[var(--app-ink-muted)]">Quiet when things work. Clear when you need to act.</p>
        </div>
        <div className="flex gap-2">
          <div className="rounded-md border border-[var(--app-border)] bg-app-surface px-3 py-2 text-center">
            <div className="text-lg font-semibold text-amber-700">{problems.length}</div>
            <div className="text-[9px] uppercase tracking-wider text-[var(--app-ink-muted)]">Problems</div>
          </div>
          <div className="rounded-md border border-[var(--app-border)] bg-app-surface px-3 py-2 text-center">
            <div className="text-lg font-semibold text-sky-700">{active.length}</div>
            <div className="text-[9px] uppercase tracking-wider text-[var(--app-ink-muted)]">Active</div>
          </div>
        </div>
      </header>

      {notice ? <div className="mb-4 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800">{notice}</div> : null}

      <section className="mb-6">
        <div className="mb-2 flex items-center justify-between">
          <h2 className="flex items-center gap-2 text-sm font-semibold"><ShieldAlert size={15} className="text-amber-700" />Needs attention</h2>
          <span className="text-[11px] text-[var(--app-ink-muted)]">Only unresolved problems stay here</span>
        </div>
        <div className="grid gap-2 lg:grid-cols-2">
          {problems.map((item) => (
            <article key={item.id} className="rounded-lg border border-amber-200 bg-app-surface p-4 shadow-sm">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="font-semibold text-[var(--app-ink)]">{item.book}</div>
                  <div className="mt-0.5 text-xs text-[var(--app-ink-muted)]">{item.title}</div>
                </div>
                <StatusPill status={item.status} />
              </div>
              <p className="mt-3 rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-900">{item.recovery}</p>
              <div className="mt-3 flex items-center justify-between gap-3">
                <span className="truncate text-[10px] text-[var(--app-ink-muted)]">{item.file}</span>
                <Button variant="primary" size="sm" onClick={() => onAction(item)}>{actionLabel(item.status)}</Button>
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className="mb-6 grid gap-4 lg:grid-cols-[1.4fr_0.8fr]">
        <div>
          <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold"><RefreshCw size={15} className="text-sky-700" />In progress</h2>
          <div className="overflow-hidden rounded-lg border border-[var(--app-border)] bg-app-surface">
            {active.map((item, index) => (
              <div key={item.id} className={cn("flex items-center gap-3 p-3", index > 0 && "border-t border-[var(--app-border)]")}>
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[var(--app-bg-secondary)]">
                  {item.status === "waiting" ? <Smartphone size={16} /> : <FileCheck2 size={16} />}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2"><span className="truncate text-xs font-semibold">{item.book}</span><StatusPill status={item.status} /></div>
                  <div className="mt-1 text-[11px] text-[var(--app-ink-muted)]">{item.detail}</div>
                  {typeof item.progress === "number" ? (
                    <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-[var(--app-bg-tertiary)]"><div className="h-full rounded-full bg-sky-500" style={{ width: `${item.progress}%` }} /></div>
                  ) : null}
                </div>
                <Button variant="ghost" size="sm" onClick={() => onAction(item)}>{actionLabel(item.status)}</Button>
              </div>
            ))}
          </div>
        </div>
        <div>
          <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold"><Sparkles size={15} className="text-orange-700" />Your decision</h2>
          {decisions.map((item) => (
            <button key={item.id} type="button" onClick={() => onAction(item)} className="w-full rounded-lg border border-orange-200 bg-orange-50 p-4 text-left transition hover:border-orange-400">
              <div className="flex items-center justify-between gap-3"><span className="text-xs font-semibold text-orange-950">{item.title}</span><ArrowRight size={14} /></div>
              <div className="mt-2 text-[11px] text-orange-800">{item.detail}</div>
              <div className="mt-3 text-[10px] text-orange-700">Owned by Organizer · not queued work</div>
            </button>
          ))}
        </div>
      </section>

      <section>
        <div className="mb-2 flex items-center justify-between"><h2 className="flex items-center gap-2 text-sm font-semibold"><History size={15} />Recent history</h2><button type="button" className="text-xs font-medium text-[var(--app-accent)]">View all history</button></div>
        <div className="rounded-lg border border-[var(--app-border)] bg-app-surface">
          {recent.map((item, index) => (
            <div key={item.id} className={cn("flex items-center gap-3 px-3 py-2.5", index > 0 && "border-t border-[var(--app-border)]")}>
              <CheckCircle2 size={15} className="shrink-0 text-emerald-600" />
              <div className="min-w-0 flex-1"><span className="text-xs font-medium">{item.book}</span><span className="ml-2 text-[11px] text-[var(--app-ink-muted)]">{item.detail}</span></div>
              <span className="text-[10px] text-[var(--app-ink-muted)]">{item.time}</span>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

function VariantB({ items, notice, onAction }: VariantProps) {
  return (
    <div className="mx-auto w-full max-w-[980px] pb-20">
      <header className="mb-5 border-b border-[var(--app-border)] pb-4">
        <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--app-ink-muted)]">A history you can read</p>
        <div className="mt-1 flex flex-wrap items-end justify-between gap-3">
          <div><h1 className="font-serif text-3xl">Library timeline</h1><p className="mt-1 text-sm text-[var(--app-ink-muted)]">Saves, file work, decisions, and recovery in one chronology.</p></div>
          <div className="flex rounded-full border border-[var(--app-border)] bg-app-surface p-1 text-[11px]"><button className="rounded-full bg-[var(--app-ink)] px-3 py-1.5 text-white">All</button><button className="px-3 py-1.5">Needs attention</button><button className="px-3 py-1.5">Files</button><button className="px-3 py-1.5">Devices</button></div>
        </div>
      </header>
      {notice ? <div className="mb-4 rounded-md bg-emerald-50 px-3 py-2 text-xs text-emerald-800">{notice}</div> : null}

      <div className="relative pl-8 before:absolute before:bottom-0 before:left-[11px] before:top-2 before:w-px before:bg-[var(--app-border)]">
        <div className="mb-3 text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--app-ink-muted)]">Today</div>
        {items.filter((item) => item.status !== "succeeded" || item.id === "history-success").map((item) => {
          const presentation = statusPresentation(item.status);
          const Icon = presentation.icon;
          return (
            <article key={item.id} className="relative mb-3 rounded-lg border border-[var(--app-border)] bg-app-surface p-4">
              <div className={cn("absolute -left-[29px] top-4 flex h-6 w-6 items-center justify-center rounded-full border bg-app-surface", presentation.tone)}><Icon size={12} className={item.status === "running" ? "animate-spin" : ""} /></div>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0"><div className="text-[10px] uppercase tracking-[0.12em] text-[var(--app-ink-muted)]">{item.origin} · {item.time}</div><h2 className="mt-1 font-serif text-xl">{item.book}</h2><div className="mt-0.5 text-xs font-medium">{item.title}</div></div>
                <StatusPill status={item.status} />
              </div>
              <div className="mt-3 grid gap-2 rounded-md bg-[var(--app-bg-secondary)] p-3 sm:grid-cols-[1fr_auto]">
                <div><div className="text-xs">{item.detail}</div><div className="mt-1 flex items-center gap-1.5 text-[10px] text-[var(--app-ink-muted)]"><HardDrive size={11} />{item.file}</div>{item.device ? <div className="mt-1 flex items-center gap-1.5 text-[10px] text-[var(--app-ink-muted)]"><Smartphone size={11} />{item.device}</div> : null}</div>
                {item.status !== "succeeded" ? <Button variant={item.status === "problem" || item.status === "failed" ? "primary" : "outline"} size="sm" onClick={() => onAction(item)}>{actionLabel(item.status)}</Button> : <Check size={16} className="text-emerald-600" />}
              </div>
            </article>
          );
        })}
        <div className="mb-3 mt-6 text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--app-ink-muted)]">Yesterday</div>
        {items.filter((item) => item.id === "history-device").map((item) => (
          <article key={item.id} className="relative mb-3 flex items-center gap-3 rounded-lg border border-[var(--app-border)] bg-app-surface px-4 py-3">
            <div className="absolute -left-[29px] top-3 flex h-6 w-6 items-center justify-center rounded-full border border-emerald-200 bg-emerald-50 text-emerald-700"><Check size={12} /></div>
            <BookOpen size={17} className="text-[var(--app-ink-muted)]" /><div className="min-w-0 flex-1"><div className="text-xs font-semibold">{item.book}</div><div className="text-[11px] text-[var(--app-ink-muted)]">{item.title} · {item.origin}</div></div><span className="text-[10px] text-[var(--app-ink-muted)]">{item.time}</span>
          </article>
        ))}
      </div>
    </div>
  );
}

function VariantC({ items, selectedId, notice, onSelect, onAction }: VariantProps) {
  const selected = items.find((item) => item.id === selectedId) ?? items[0];
  const attention = items.filter((item) => item.status === "problem" || item.status === "failed");
  const active = items.filter((item) => item.status === "running" || item.status === "waiting" || item.status === "decision");
  const historyItems = items.filter((item) => item.status === "succeeded");

  return (
    <div className="mx-auto w-full max-w-[1260px] pb-20">
      <header className="mb-3 flex flex-wrap items-center justify-between gap-4">
        <div><p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--app-ink-muted)]">Operations</p><h1 className="font-serif text-3xl">Problems & activity</h1></div>
        <div className="flex items-center gap-2 text-[11px]"><span className="rounded-full bg-amber-100 px-2.5 py-1 font-semibold text-amber-800">{attention.length} problems</span><span className="rounded-full bg-sky-100 px-2.5 py-1 font-semibold text-sky-800">{active.length} active</span></div>
      </header>
      {notice ? <div className="mb-3 rounded-md bg-emerald-50 px-3 py-2 text-xs text-emerald-800">{notice}</div> : null}
      <div className="grid min-h-[620px] overflow-hidden rounded-lg border border-[var(--app-border)] bg-app-surface lg:grid-cols-[320px_minmax(0,1fr)]">
        <aside className="min-w-0 border-b border-[var(--app-border)] bg-[var(--app-bg-secondary)] lg:border-b-0 lg:border-r">
          <div className="flex gap-1 border-b border-[var(--app-border)] p-2 text-[11px]"><button className="rounded-md bg-app-surface px-3 py-1.5 font-semibold shadow-sm">Problems {attention.length}</button><button className="px-3 py-1.5">Active {active.length}</button><button className="px-3 py-1.5">History</button></div>
          <div className="p-2">
            {[...attention, ...active, ...historyItems].map((item) => (
              <button key={item.id} type="button" onClick={() => onSelect(item.id)} className={cn("mb-1 w-full rounded-md border p-3 text-left transition", selected.id === item.id ? "border-[var(--app-accent)] bg-app-surface shadow-sm" : "border-transparent hover:bg-app-surface/70")}>
                <div className="flex items-center justify-between gap-2"><span className="truncate text-xs font-semibold">{item.book}</span><StatusPill status={item.status} /></div>
                <div className="mt-1 truncate text-[11px] text-[var(--app-ink-muted)]">{item.title}</div>
                <div className="mt-2 text-[9px] uppercase tracking-[0.1em] text-[var(--app-ink-muted)]">{item.origin}</div>
              </button>
            ))}
          </div>
        </aside>
        <main className="min-w-0 p-5 lg:p-7">
          <div className="flex flex-wrap items-start justify-between gap-4 border-b border-[var(--app-border)] pb-5">
            <div><StatusPill status={selected.status} /><h2 className="mt-3 font-serif text-3xl">{selected.book}</h2><p className="mt-1 text-sm text-[var(--app-ink-muted)]">{selected.title}</p></div>
            <Button variant="primary" onClick={() => onAction(selected)}>{actionLabel(selected.status)}<ArrowRight size={14} /></Button>
          </div>
          <div className="grid gap-6 py-6 xl:grid-cols-[minmax(0,1fr)_220px]">
            <div className="min-w-0">
              <h3 className="text-xs font-semibold uppercase tracking-[0.13em] text-[var(--app-ink-muted)]">What happened</h3>
              <p className="mt-2 text-sm leading-6">{selected.detail}</p>
              {selected.recovery ? <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-4"><div className="flex items-center gap-2 text-xs font-semibold text-amber-900"><Wrench size={14} />Recommended recovery</div><p className="mt-2 text-xs leading-5 text-amber-900">{selected.recovery}</p></div> : null}
              <h3 className="mt-7 text-xs font-semibold uppercase tracking-[0.13em] text-[var(--app-ink-muted)]">Lifecycle</h3>
              <div className="mt-3 flex items-center gap-2 text-[11px]">
                {[
                  ["Intent recorded", true],
                  ["Preflight", true],
                  [selected.status === "waiting" ? "Waiting" : "Execution", selected.status !== "decision"],
                  ["Verified", selected.status === "succeeded"],
                ].map(([label, complete], index) => (
                  <div key={String(label)} className="contents"><div className={cn("flex min-w-0 flex-1 items-center gap-1.5 rounded-md border px-2 py-2", complete ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-[var(--app-border)] text-[var(--app-ink-muted)]")}>{complete ? <Check size={11} /> : <CircleDashed size={11} />}<span className="min-w-0 truncate">{label}</span></div>{index < 3 ? <ArrowRight size={12} className="shrink-0 text-[var(--app-ink-muted)]" /> : null}</div>
                ))}
              </div>
            </div>
            <dl className="space-y-4 rounded-lg bg-[var(--app-bg-secondary)] p-4 text-xs">
              <div><dt className="text-[9px] uppercase tracking-[0.12em] text-[var(--app-ink-muted)]">Origin</dt><dd className="mt-1 font-medium">{selected.origin}</dd></div>
              <div><dt className="text-[9px] uppercase tracking-[0.12em] text-[var(--app-ink-muted)]">File</dt><dd className="mt-1 break-all font-medium">{selected.file}</dd></div>
              {selected.device ? <div><dt className="text-[9px] uppercase tracking-[0.12em] text-[var(--app-ink-muted)]">Device</dt><dd className="mt-1 font-medium">{selected.device}</dd></div> : null}
              <div><dt className="text-[9px] uppercase tracking-[0.12em] text-[var(--app-ink-muted)]">Last update</dt><dd className="mt-1 font-medium">{selected.time}</dd></div>
              <div className="border-t border-[var(--app-border)] pt-4"><button type="button" className="flex items-center gap-2 font-medium text-[var(--app-accent)]"><MapPin size={13} />Open originating flow</button></div>
            </dl>
          </div>
        </main>
      </div>
    </div>
  );
}

export function ActivityPrototypeView() {
  const [variant, setVariant] = useState<PrototypeVariant>(variantFromUrl);
  const [items, setItems] = useState<PrototypeItem[]>(initialItems);
  const [selectedId, setSelectedId] = useState(initialItems[2].id);
  const [notice, setNotice] = useState("");

  const counts = useMemo(() => ({
    running: items.filter((item) => item.status === "running").length,
    waiting: items.filter((item) => item.status === "waiting").length,
    problems: items.filter((item) => item.status === "problem" || item.status === "failed").length,
    succeeded: items.filter((item) => item.status === "succeeded").length,
  }), [items]);

  const handleAction = (item: PrototypeItem) => {
    if (item.status === "decision") {
      setNotice("Organizer owns this confirmation. No File operation exists until Apply.");
      return;
    }
    if (item.status === "succeeded") {
      setNotice(`Opened immutable history for ${item.book}.`);
      return;
    }
    const nextStatus: PrototypeStatus = item.status === "running" ? "succeeded" : "running";
    setItems((current) => current.map((candidate) => candidate.id === item.id
      ? { ...candidate, status: nextStatus, progress: nextStatus === "running" ? 24 : 100, time: nextStatus === "running" ? "Started just now" : "Completed just now" }
      : candidate));
    setNotice(nextStatus === "running"
      ? `${actionLabel(item.status)} started for ${item.book}. Preconditions will be checked again.`
      : `${item.book} is now up to date.`);
  };

  const props: VariantProps = {
    items,
    selectedId,
    notice,
    onSelect: setSelectedId,
    onAction: handleAction,
  };

  return (
    <>
      {variant === "A" ? <VariantA {...props} /> : null}
      {variant === "B" ? <VariantB {...props} /> : null}
      {variant === "C" ? <VariantC {...props} /> : null}
      <div className="fixed bottom-2 left-1/2 z-[90] -translate-x-1/2 rounded-full border border-[var(--app-border)] bg-app-surface/95 px-3 py-1 text-[9px] uppercase tracking-[0.12em] text-[var(--app-ink-muted)] shadow-sm backdrop-blur">
        Prototype state · {counts.running} running · {counts.waiting} waiting · {counts.problems} problems · {counts.succeeded} succeeded
      </div>
      <PrototypeSwitcher current={variant} onChange={setVariant} />
    </>
  );
}
