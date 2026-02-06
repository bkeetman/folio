import type { ReactNode } from "react";
import { cn } from "../../lib/utils";

type PanelProps = {
  title?: string;
  children: ReactNode;
  className?: string;
};

export function Panel({ title, children, className }: PanelProps) {
  return (
    <section
      className={cn(
        "rounded-lg border border-app-border bg-app-panel surface-gradient px-3 py-3 shadow-panel ring-1 ring-white/5",
        className
      )}
    >
      {title ? (
        <div className="text-[10px] uppercase tracking-[0.14em] text-[var(--app-ink-muted)]">
          {title}
        </div>
      ) : null}
      {children}
    </section>
  );
}
