import type { ReactNode } from "react";

/** Title block for admin and library pages. */
export function PageHeader({
  actions,
  subtitle,
  title,
}: {
  actions?: ReactNode;
  subtitle?: ReactNode;
  title: string;
}) {
  return (
    <header className="ub-page-header">
      <div className="ub-page-header-text">
        <h1>{title}</h1>
        {subtitle ? <p>{subtitle}</p> : null}
      </div>
      {actions ? <div className="ub-page-header-actions">{actions}</div> : null}
    </header>
  );
}
