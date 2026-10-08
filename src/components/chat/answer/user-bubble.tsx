import type { ReactNode } from "react";

export function UserBubble({ children }: { children: ReactNode }) {
  return (
    <div className="flex justify-end">
      <div className="max-w-[640px] whitespace-pre-wrap rounded-[14px] bg-sunken px-4 py-2.5 text-[15px] leading-6 text-ink">
        {children}
      </div>
    </div>
  );
}
