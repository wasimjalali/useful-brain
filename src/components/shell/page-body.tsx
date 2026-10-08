import type { ReactNode } from "react";

/** Scrolling body for pages that live inside the stage. */
export function PageBody({ children }: { children: ReactNode }) {
  return (
    <div className="uv-scroll min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-8 sm:py-10">{children}</div>
    </div>
  );
}
