import type { InputHTMLAttributes } from "react";
import { forwardRef } from "react";
import { cn } from "../../lib/utils";

type InputProps = InputHTMLAttributes<HTMLInputElement>;

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ className, type = "text", ...props }, ref) => (
    <input
      ref={ref}
      type={type}
      className={cn(
        "h-9 w-full rounded-md border border-[var(--app-border)] bg-[var(--app-surface)] px-3 text-sm text-[var(--app-ink)] placeholder:text-[var(--app-ink-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--app-accent)]",
        className
      )}
      {...props}
    />
  )
);

Input.displayName = "Input";
