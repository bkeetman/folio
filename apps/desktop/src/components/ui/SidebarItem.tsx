import type { ButtonHTMLAttributes } from "react";

type SidebarItemProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  active?: boolean;
};

export function SidebarItem({ active, className, ...props }: SidebarItemProps) {
  const classes = ["sidebar-item", active ? "active" : null, className]
    .filter(Boolean)
    .join(" ");
  return <button className={classes} {...props} />;
}
