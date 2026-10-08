import { LibraryClient } from "@/components/library/library-client";
import { PageHeader } from "@/components/ui/page-header";
import { brainJson } from "@/lib/cf/brain-client";
import type { LibraryResponse } from "@/lib/contracts/library";
import { toPublicAppError } from "@/lib/rag/app-errors";

export const dynamic = "force-dynamic";

export default async function LibraryPage() {
  let documents: LibraryResponse["documents"] | null = null;
  let error: string | null = null;
  try {
    documents = (await brainJson<LibraryResponse>("/library")).documents;
  } catch (cause) {
    error = toPublicAppError(cause).message;
  }
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
      <PageHeader
        subtitle={documents ? `${documents.length} documents you can read` : undefined}
        title="Library"
      />
      {documents ? (
        <LibraryClient documents={documents} />
      ) : (
        <p className="px-12 py-8 text-[13px] text-ink-muted" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
