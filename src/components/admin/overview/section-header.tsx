import type { ReactNode } from "react";

export function SectionHeader({
  title,
  children,
  right,
}: {
  title: string;
  children?: ReactNode;
  right?: ReactNode;
}) {
  return (
    <div className="flex items-baseline gap-2.5 border-b border-border pb-2.5">
      <h2 className="m-0 text-xs font-medium text-ink-faint-text">{title}</h2>
      {children}
      {right ? <span className="ml-auto text-xs">{right}</span> : null}
    </div>
  );
}
