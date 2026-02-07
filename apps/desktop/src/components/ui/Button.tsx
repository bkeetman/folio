import { cva } from "class-variance-authority";
import type { ButtonHTMLAttributes } from "react";
import { cn } from "../../lib/utils";

type ButtonVariant = "primary" | "default" | "ghost" | "toolbar" | "danger" | "outline";
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
          "bg-app-accent text-white shadow-sm hover:bg-app-accent-strong",
        default:
          "bg-app-accent text-white shadow-sm hover:bg-app-accent-strong",
        ghost:
          "bg-transparent text-app-ink hover:bg-app-ink/5",
        toolbar:
          "bg-app-surface/40 text-app-ink border border-transparent hover:bg-app-surface-hover hover:border-[var(--app-border-muted)]",
        outline:
          "bg-transparent text-app-ink border border-app-border hover:bg-app-bg",
        danger:
          "bg-red-50 text-red-600 border border-red-200 hover:bg-red-100 dark:bg-red-500/10 dark:text-red-500 dark:border-red-500/20 dark:hover:bg-red-500/20",
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
