/** Wire contracts for Sources, uploads and the draft pipeline (admin only). */

import type { DocumentReaders } from "./library";

export type UploadReaders =
  | { kind: "everyone" }
  | { kind: "departments"; names: string[] }
  | { kind: "roles"; names: string[] };

export type UploadRequest = {
  readers: UploadReaders;
  idempotencyKey: string;
  files: { name: string; size: number }[];
};

export type UploadCreated = {
  batchId: string;
  files: { id: string; name: string }[];
};

export const UPLOAD_STAGES = ["parsing", "chunking", "embedding", "ready", "failed"] as const;
export type UploadStage = (typeof UPLOAD_STAGES)[number];

/** Closed set. The human message for each code lives in src/lib/ingest/error-codes.ts. */
export const UPLOAD_ERROR_CODES = [
  "UNSUPPORTED_FORMAT",
  "FILE_TOO_LARGE",
  "EMPTY_FILE",
  "NO_TEXT",
  "TEXT_TOO_LARGE",
  "ARCHIVE_TOO_LARGE",
  "CORRUPT_FILE",
  "TIMED_OUT",
  "INDEX_UNAVAILABLE",
  "DRAFT_CLOSED",
  "NOT_RECEIVED",
  "INTERNAL",
] as const;
export type UploadErrorCode = (typeof UPLOAD_ERROR_CODES)[number];

export type UploadStatus = {
  batchId: string;
  files: {
    id: string;
    name: string;
    stage: UploadStage;
    errorMessage?: string;
  }[];
};

export type UploadFileAccepted = { ok: true; stage: "parsing" };

export type DraftState =
  | "building"
  | "checking"
  | "checks_passed"
  | "checks_failed"
  | "checks_paused"
  | "failed";

export type SourcesActive = {
  id: string;
  promotedAt: number;
  documents: number;
  chunks: number;
  retrieval: "hybrid" | "keyword";
};

export type SourcesDraft = {
  id: string;
  kind: "upload" | "reindex";
  state: DraftState;
  embeddedChunks: number;
  totalChunks: number;
  documents: number;
  failedFiles: number;
  checks?: { reconciled: boolean; aclLeaks: number; liveRecall: number | null; errorCode: string | null };
};

export type SourcesDocument = {
  id: string;
  title: string;
  fileName: string;
  department: string | null;
  readers: DocumentReaders;
  chunks: number;
  updatedAt: number;
  status: "active" | "draft" | "failed";
  errorMessage?: string;
};

export type SourcesResponse = {
  active: SourcesActive | null;
  draft: SourcesDraft | null;
  documents: SourcesDocument[];
};

export type DraftActionResponse = { ok: true; generationId: string };
export type ReindexResponse = { ok: true; generationId: string };
