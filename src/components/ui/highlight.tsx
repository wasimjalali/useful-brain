import type { ReactNode } from "react";

/** Hovered or pinned citations pass `active` to darken from --hl to --hl-strong. */
export function Highlight({ active = false, children }: { active?: boolean; children: ReactNode }) {
  return (
    <mark className="ub-mark" data-active={active ? "true" : undefined}>
      {children}
    </mark>
  );
}
