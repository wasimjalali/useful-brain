import type { CSSProperties, HTMLAttributes, ReactNode } from "react";

/** `columns` is a CSS grid-template-columns value shared by the header and every row. */
export function Table({
  columns,
  label,
  children,
}: {
  columns: string;
  label: string;
  children: ReactNode;
}) {
  return (
    <div
      aria-label={label}
      role="table"
      style={{ "--ub-cols": columns } as CSSProperties}
    >
      {children}
    </div>
  );
}

export function TableHeaderRow({ children }: { children: ReactNode }) {
  return (
    <div className="ub-th" role="row">
      {children}
    </div>
  );
}

export function TableHead({ children }: { children: ReactNode }) {
  return <div role="columnheader">{children}</div>;
}

export function TableRow({
  children,
  tall = false,
  ...rest
}: {
  children: ReactNode;
  tall?: boolean;
} & HTMLAttributes<HTMLDivElement>) {
  return (
    <div className="ub-tr" data-tall={tall ? "true" : undefined} role="row" {...rest}>
      {children}
    </div>
  );
}

export function TableCell({ children }: { children: ReactNode }) {
  return (
    <div className="min-w-0 truncate text-[13px] leading-5" role="cell">
      {children}
    </div>
  );
}

/** Hidden until the row is hovered or anything inside it has focus. */
export function TableRowActions({ children }: { children: ReactNode }) {
  return (
    <div className="ub-tr-actions" role="cell">
      {children}
    </div>
  );
}
