import { ChevronLeft, ChevronRight } from "lucide-react";
import { useEffect } from "react";

export type PrototypeVariant = "A" | "B" | "C";

const variants: Array<{ key: PrototypeVariant; name: string }> = [
  { key: "A", name: "Compact hybrid" },
  { key: "B", name: "Compare workbench" },
  { key: "C", name: "Guided flow" },
];

type PrototypeSwitcherProps = {
  current: PrototypeVariant;
  onChange: (variant: PrototypeVariant) => void;
};

export function PrototypeSwitcher({ current, onChange }: PrototypeSwitcherProps) {
  const currentIndex = variants.findIndex((variant) => variant.key === current);

  const select = (offset: number) => {
    const nextIndex = (currentIndex + offset + variants.length) % variants.length;
    const next = variants[nextIndex];
    const params = new URLSearchParams(window.location.search);
    params.set("prototype", "book-edit");
    params.set("variant", next.key);
    window.history.replaceState({}, "", `${window.location.pathname}?${params.toString()}`);
    onChange(next.key);
  };

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target;
      if (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement ||
        (target instanceof HTMLElement && target.isContentEditable)
      ) {
        return;
      }
      if (event.key === "ArrowLeft") select(-1);
      if (event.key === "ArrowRight") select(1);
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  });

  if (import.meta.env.PROD) return null;

  const label = variants[currentIndex] ?? variants[0];
  return (
    <div className="fixed bottom-14 left-1/2 z-[100] flex -translate-x-1/2 items-center gap-1 rounded-full border border-black/20 bg-[#1a1614] p-1.5 text-white shadow-[0_14px_40px_rgba(18,13,10,0.32)]">
      <button
        type="button"
        aria-label="Previous prototype variant"
        onClick={() => select(-1)}
        className="flex h-8 w-8 items-center justify-center rounded-full transition hover:bg-white/15 focus:outline-none focus-visible:ring-2 focus-visible:ring-orange-400"
      >
        <ChevronLeft size={16} />
      </button>
      <div className="min-w-[190px] px-3 text-center text-xs font-semibold tracking-wide">
        {label.key} · {label.name}
      </div>
      <button
        type="button"
        aria-label="Next prototype variant"
        onClick={() => select(1)}
        className="flex h-8 w-8 items-center justify-center rounded-full transition hover:bg-white/15 focus:outline-none focus-visible:ring-2 focus-visible:ring-orange-400"
      >
        <ChevronRight size={16} />
      </button>
    </div>
  );
}
