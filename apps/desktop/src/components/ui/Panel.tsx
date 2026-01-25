import type { ReactNode } from "react";

type PanelProps = {
  title?: string;
  children: ReactNode;
  className?: string;
};

export function Panel({ title, children, className }: PanelProps) {
  const classes = ["ui-panel", className].filter(Boolean).join(" ");
  return (
    <section className={classes}>
      {title ? <div className="ui-panel__title">{title}</div> : null}
      {children}
    </section>
  );
}
