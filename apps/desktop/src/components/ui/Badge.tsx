import { cva } from "class-variance-authority";
import type { HTMLAttributes } from "react";
import { cn } from "../../lib/utils";

type BadgeVariant = "default" | "muted" | "accent" | "success" | "warning" | "info" | "danger";

type BadgeProps = HTMLAttributes<HTMLSpanElement> & {
  variant?: BadgeVariant;
};

const badgeVariants = cva(
  "inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.08em]",
  {
    variants: {
      variant: {
        default: "bg-[var(--app-panel)] text-[var(--app-ink)] border border-[var(--app-border)]",
        muted: "bg-[rgba(227,221,214,0.6)] text-[var(--app-ink-muted)] dark:bg-white/10 dark:text-[var(--app-ink-muted)]",
        accent: "bg-[rgba(201,122,58,0.12)] text-[var(--app-accent-strong)] dark:bg-[rgba(201,122,58,0.2)]",
        success: "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-500",
        warning: "bg-amber-100 text-amber-700 dark:bg-amber-500/10 dark:text-amber-500",
        info: "bg-blue-100 text-blue-700 dark:bg-blue-500/10 dark:text-blue-500",
        danger: "bg-red-100 text-red-700 dark:bg-red-500/10 dark:text-red-500",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
);

export function Badge({ className, variant, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}
