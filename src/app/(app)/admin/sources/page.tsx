import { SourcesLoadError } from "@/components/admin/sources/sources-load-error";
import { SourcesPageClient } from "@/components/admin/sources/sources-page-client";
import { brainJson } from "@/lib/cf/brain-client";
import type { PeopleResponse } from "@/lib/contracts/people";
import type { SourcesResponse } from "@/lib/contracts/sources";

export const dynamic = "force-dynamic";

export default async function SourcesPage({
  searchParams,
}: {
  searchParams: Promise<{ upload?: string }>;
}) {
  const { upload } = await searchParams;
  let loaded: { sources: SourcesResponse; people: PeopleResponse } | null = null;
  try {
    const [sources, people] = await Promise.all([
      brainJson<SourcesResponse>("/admin/sources"),
      brainJson<PeopleResponse>("/admin/people"),
    ]);
    loaded = { sources, people };
  } catch {
    loaded = null;
  }
  return (
    <div className="uv-scroll min-h-0 flex-1 overflow-y-auto">
      {loaded ? (
        <SourcesPageClient
          initial={loaded.sources}
          initialUploadOpen={upload === "1"}
          peopleTotal={loaded.people.total}
        />
      ) : (
        <SourcesLoadError />
      )}
    </div>
  );
}
