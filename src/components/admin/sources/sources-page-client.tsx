"use client";

import {
  createUploadAction,
  discardDraftAction,
  loadSourcesAction,
  promoteDraftAction,
  reindexAction,
  uploadStatusAction,
} from "@/app/admin-sources-actions";
import type { SourcesResponse } from "@/lib/contracts/sources";

import { SourcesWorkspace } from "./sources-workspace";
import { putFileToRoute } from "./upload-flow";

/** Binds the server actions and the browser upload so the server page stays a plain component. */
export function SourcesPageClient({
  initial,
  peopleTotal,
  initialUploadOpen,
}: {
  initial: SourcesResponse;
  peopleTotal: number;
  initialUploadOpen: boolean;
}) {
  return (
    <SourcesWorkspace
      actions={{
        loadSources: loadSourcesAction,
        reindex: reindexAction,
        promoteDraft: promoteDraftAction,
        discardDraft: discardDraftAction,
        createUpload: createUploadAction,
        uploadStatus: uploadStatusAction,
        putFile: putFileToRoute,
      }}
      initial={initial}
      initialUploadOpen={initialUploadOpen}
      peopleTotal={peopleTotal}
    />
  );
}
