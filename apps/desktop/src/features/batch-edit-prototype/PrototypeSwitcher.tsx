import { ChevronLeft, ChevronRight } from "lucide-react";
import { useEffect } from "react";

export type BatchPrototypeVariant = "A" | "B" | "C";

const variants: Array<{ key: BatchPrototypeVariant; name: string }> = [
  { key: "A", name: "Guided field editor" },
  { key: "B", name: "Change matrix" },
  { key: "C", name: "Outcome workbench" },
];

export function PrototypeSwitcher({ current, onChange }: { current: BatchPrototypeVariant; onChange: (variant: BatchPrototypeVariant) => void }) {
  const currentIndex = Math.max(0, variants.findIndex((variant) => variant.key === current));
  const select = (offset: number) => {
    const next = variants[(currentIndex + offset + variants.length) % variants.length];
    const params = new URLSearchParams(window.location.search);
    params.set("prototype", "batch-edit");
    params.set("variant", next.key);
    window.history.replaceState({}, "", `${window.location.pathname}?${params.toString()}`);
    onChange(next.key);
  };

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target;
      if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement || (target instanceof HTMLElement && target.isContentEditable)) return;
      if (event.key === "ArrowLeft") select(-1);
      if (event.key === "ArrowRight") select(1);
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  });

  if (import.meta.env.PROD) return null;
  const active = variants[currentIndex];
  return (
    <div className="fixed bottom-14 left-1/2 z-[100] flex -translate-x-1/2 items-center gap-1 rounded-full border border-black/20 bg-[#1a1614] p-1.5 text-white shadow-[0_14px_40px_rgba(18,13,10,0.32)]">
      <button type="button" aria-label="Previous prototype variant" onClick={() => select(-1)} className="flex h-8 w-8 items-center justify-center rounded-full hover:bg-white/15"><ChevronLeft size={16} /></button>
      <div className="min-w-[205px] px-3 text-center text-xs font-semibold tracking-wide">{active.key} · {active.name}</div>
      <button type="button" aria-label="Next prototype variant" onClick={() => select(1)} className="flex h-8 w-8 items-center justify-center rounded-full hover:bg-white/15"><ChevronRight size={16} /></button>
    </div>
  );
}
