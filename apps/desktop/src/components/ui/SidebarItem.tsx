import type { ButtonHTMLAttributes } from "react";
import { cn } from "../../lib/utils";

type SidebarItemProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  active?: boolean;
};

export function SidebarItem({ active, className, ...props }: SidebarItemProps) {
  return (
    <button
      className={cn(
        "flex w-full items-center gap-2 rounded-md border border-transparent px-2.5 py-2 text-left text-[13px] font-medium text-[var(--app-ink)] transition",
        "hover:bg-[var(--app-surface)] hover:border-[var(--app-border)]",
        active && "bg-[var(--app-surface)] border-[var(--app-border)] shadow-soft",
        className
      )}
      {...props}
    />
  );
}
