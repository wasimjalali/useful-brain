import type { UploadErrorCode } from "../contracts/sources";
import { UPLOAD_ERROR_CODES } from "../contracts/sources";

/** Plain-language messages for the closed upload error codes. */
export const UPLOAD_ERROR_MESSAGES: Record<UploadErrorCode, string> = {
  UNSUPPORTED_FORMAT: "This file type isn't supported. Use PDF, DOCX, Markdown or plain text.",
  FILE_TOO_LARGE: "This file is over the 25 MB limit.",
  EMPTY_FILE: "This file is empty.",
  NO_TEXT: "No readable text found. Scanned pages without a text layer can't be read.",
  TEXT_TOO_LARGE: "The text in this file is too long to index as one document.",
  ARCHIVE_TOO_LARGE: "This document expands to far more than its size on disk, so it was rejected.",
  CORRUPT_FILE: "This file is damaged or isn't what its extension says.",
  TIMED_OUT: "Reading this file took too long.",
  INDEX_UNAVAILABLE: "The search index couldn't be reached. Try again in a few minutes.",
  DRAFT_CLOSED: "The draft was discarded before this file finished.",
  INTERNAL: "Something went wrong while processing this file.",
};

/** Thrown for a file problem that retrying cannot fix. Carries a closed code. */
export class UploadFailure extends Error {
  constructor(readonly code: UploadErrorCode) {
    super(code);
    this.name = "UploadFailure";
  }
}

export function isUploadErrorCode(value: unknown): value is UploadErrorCode {
  return typeof value === "string" && (UPLOAD_ERROR_CODES as readonly string[]).includes(value);
}

export function uploadErrorMessage(code: string | null): string | undefined {
  if (code === null) {
    return undefined;
  }
  return UPLOAD_ERROR_MESSAGES[isUploadErrorCode(code) ? code : "INTERNAL"];
}
