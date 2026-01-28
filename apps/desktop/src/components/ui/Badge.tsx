import type { HTMLAttributes } from "react";
import { cva } from "class-variance-authority";
import { cn } from "../../lib/utils";

type BadgeVariant = "default" | "muted" | "accent";

type BadgeProps = HTMLAttributes<HTMLSpanElement> & {
  variant?: BadgeVariant;
};

const badgeVariants = cva(
  "inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.08em]",
  {
    variants: {
      variant: {
        default: "bg-[var(--app-panel)] text-[var(--app-ink)] border border-[var(--app-border)]",
        muted: "bg-[rgba(227,221,214,0.6)] text-[var(--app-ink-muted)]",
        accent: "bg-[rgba(201,122,58,0.12)] text-[var(--app-accent-strong)]",
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
