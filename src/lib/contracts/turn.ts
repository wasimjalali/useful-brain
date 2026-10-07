/**
 * POST /turns response additions shared by the Brain Worker and the Next.js app.
 * Every field is optional: a plain grounded turn carries none of them.
 */
import type { ApprovalView } from "./approvals";
import type { DocumentReaders } from "./library";

/** The proposed action of this assistant message, owner-only. */
export type TurnApproval = ApprovalView;

/** View-as echo. Never roles, grant lists or the person's email. */
export type AssumedPersonEcho = {
  id: string;
  displayName: string;
  department: string | null;
  readableDocuments: number;
};

/**
 * Admin-only, view-as only, after a refusal. Title and readers label only: no
 * chunk id, score, text or offset. Never in model context, never logged.
 */
export type AdminDiagnosticMatch = { title: string; readers: DocumentReaders };

export type TurnResponseExtras = {
  approval?: TurnApproval;
  assumedPerson?: AssumedPersonEcho;
  adminDiagnostic?: AdminDiagnosticMatch[];
};

/** POST /turns body additions. */
export type TurnRequestAdditions = {
  /** A readable document id; retrieval is restricted to it. 404 when unreadable. */
  scopeDocumentId?: string;
  /** A principals.id. Admin only. Session or loopback identity mode. */
  assumePrincipalId?: string;
};
