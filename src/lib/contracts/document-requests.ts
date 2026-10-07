export const DOCUMENT_REQUEST_MIN_CHARS = 3;
export const DOCUMENT_REQUEST_MAX_CHARS = 300;

/** POST /document-requests: a free-text ask from the Library no-match state. */
export type DocumentRequestBody = { question: string };
export type DocumentRequestResponse = { requested: true };
