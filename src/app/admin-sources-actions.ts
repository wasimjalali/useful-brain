"use server";

import { brainJson } from "@/lib/cf/brain-client";
import type {
  DraftActionResponse,
  ReindexResponse,
  SourcesResponse,
  UploadCreated,
  UploadRequest,
  UploadStatus,
} from "@/lib/contracts/sources";
import { AppError, actionFailure, actionSuccess, type ActionResult } from "@/lib/rag/app-errors";

const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

function pathId(value: string): string {
  if (!ID_PATTERN.test(value)) {
    throw new AppError("VALIDATION_FAILED", "The request is invalid.", false);
  }
  return encodeURIComponent(value);
}

async function run<T>(fallback: string, work: () => Promise<T>): Promise<ActionResult<T>> {
  try {
    return actionSuccess(await work());
  } catch (error) {
    return actionFailure(error, { code: "INTERNAL_ERROR", message: fallback, retryable: true });
  }
}

export async function loadSourcesAction(): Promise<ActionResult<SourcesResponse>> {
  return run("Couldn't load sources.", () => brainJson<SourcesResponse>("/admin/sources"));
}

export async function reindexAction(): Promise<ActionResult<ReindexResponse>> {
  return run("Couldn't start the re-index.", () =>
    brainJson<ReindexResponse>("/admin/reindex", { method: "POST" }),
  );
}

export async function promoteDraftAction(generationId: string): Promise<ActionResult<DraftActionResponse>> {
  return run("Couldn't promote the draft.", () =>
    brainJson<DraftActionResponse>(`/admin/drafts/${pathId(generationId)}/promote`, { method: "POST" }),
  );
}

export async function discardDraftAction(generationId: string): Promise<ActionResult<DraftActionResponse>> {
  return run("Couldn't discard the draft.", () =>
    brainJson<DraftActionResponse>(`/admin/drafts/${pathId(generationId)}/discard`, { method: "POST" }),
  );
}

export async function createUploadAction(request: UploadRequest): Promise<ActionResult<UploadCreated>> {
  return run("Couldn't start the upload.", () =>
    brainJson<UploadCreated>("/admin/uploads", {
      method: "POST",
      json: {
        readers: request.readers,
        idempotencyKey: request.idempotencyKey,
        files: request.files.map((file) => ({ name: file.name, size: file.size })),
      },
    }),
  );
}

export async function uploadStatusAction(batchId: string): Promise<ActionResult<UploadStatus>> {
  return run("Couldn't read the upload status.", () =>
    brainJson<UploadStatus>(`/admin/uploads/${pathId(batchId)}`),
  );
}
