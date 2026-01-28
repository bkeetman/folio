import type { InboxItem } from "../types/library";
import { Button } from "../components/ui";

type InboxViewProps = {
  items: InboxItem[];
};

export function InboxView({ items }: InboxViewProps) {
  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        {items.map((item) => (
          <div
            key={item.id}
            className="flex items-center justify-between rounded-md border border-[var(--app-border)] bg-white/70 px-3 py-2"
          >
            <div>
              <div className="text-[13px] font-semibold">{item.title}</div>
              <div className="text-xs text-[var(--app-ink-muted)]">{item.reason}</div>
            </div>
            <div className="flex gap-2">
              <Button variant="ghost">Fix</Button>
              <Button variant="ghost">Ignore</Button>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
