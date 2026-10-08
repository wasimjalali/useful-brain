"use client";

import { useRouter } from "next/navigation";

import { InlineAlert } from "@/components/ui/inline-alert";

export function SourcesLoadError() {
  const router = useRouter();
  return (
    <div className="px-12 pt-9">
      <InlineAlert action={{ label: "Retry", onClick: () => router.refresh() }}>
        Couldn&apos;t load sources. The corpus database didn&apos;t respond.
      </InlineAlert>
    </div>
  );
}
