import type { ButtonHTMLAttributes } from "react";
import { cva } from "class-variance-authority";
import { cn } from "../../lib/utils";

type ButtonVariant = "primary" | "ghost" | "toolbar" | "danger" | "outline";
type ButtonSize = "sm" | "md" | "lg" | "icon";

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
};

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 rounded-md border border-transparent text-sm font-semibold transition focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--app-accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--app-bg)] disabled:opacity-50 disabled:pointer-events-none",
  {
    variants: {
      variant: {
        primary:
          "bg-[var(--app-accent)] text-white shadow-[0_12px_20px_rgba(201,122,58,0.28)] hover:bg-[var(--app-accent-strong)]",
        ghost:
          "bg-[var(--app-panel)] text-[var(--app-ink)] border-[var(--app-border)] hover:bg-white/80",
        toolbar:
          "bg-[var(--app-panel)] text-[var(--app-ink)] border-[var(--app-border)] hover:bg-white/80",
        outline:
          "bg-transparent text-[var(--app-ink)] border-[var(--app-border)] hover:bg-white/50",
        danger:
          "bg-[rgba(255,248,244,0.9)] text-[#8b3a22] border-[rgba(178,74,44,0.4)] hover:bg-[rgba(255,240,232,1)]",
      },
      size: {
        sm: "h-8 px-3 text-xs",
        md: "h-9 px-4 text-sm",
        lg: "h-10 px-4 text-sm",
        icon: "h-8 w-8",
      },
    },
    defaultVariants: {
      variant: "ghost",
      size: "md",
    },
  }
);

export function Button({ variant, size, className, ...props }: ButtonProps) {
  return <button className={cn(buttonVariants({ variant, size }), className)} {...props} />;
}
