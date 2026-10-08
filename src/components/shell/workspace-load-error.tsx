"use client";

import { InlineAlert } from "@/components/ui/inline-alert";

export function WorkspaceLoadError({ message }: { message: string }) {
  return (
    <div className="grid min-h-0 flex-1 place-items-center px-5">
      <div className="w-full max-w-md">
        <InlineAlert action={{ label: "Reload", onClick: () => window.location.reload() }}>
          {message}
        </InlineAlert>
      </div>
    </div>
  );
}
