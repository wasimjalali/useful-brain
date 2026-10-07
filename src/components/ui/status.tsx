import type { ReactNode } from "react";

const DOT_COLOR = {
  success: "var(--success)",
  warning: "var(--warning)",
  danger: "var(--danger)",
  ink: "var(--ink)",
  muted: "var(--ink-muted)",
  faint: "var(--ink-faint)",
} as const;

export type StatusTone = keyof typeof DOT_COLOR;

export function StatusDot({ tone, label }: { tone: StatusTone; label?: string }) {
  return (
    <span
      aria-hidden={label ? undefined : true}
      aria-label={label}
      className="inline-block shrink-0 rounded-full"
      role={label ? "img" : undefined}
      style={{ width: 7, height: 7, background: DOT_COLOR[tone] }}
    />
  );
}

export function StatusPill({
  tone,
  children,
}: {
  tone: "active" | "draft" | "failed";
  children: ReactNode;
}) {
  return (
    <span className="ub-pill" data-tone={tone}>
      {children}
    </span>
  );
}
