import type { DirectoryRecord } from "../auth/principal";
import type { TurnResponseExtras } from "../contracts/turn";
import type { GroundedAnswerResponse } from "../rag/grounded-answer";
import { executeTurn, type ExecuteTurnInput } from "./execute-turn";
import {
  adminTitleMatch,
  beginViewAsAudit,
  citedDocumentIds,
  echoAssumedPerson,
  finishViewAsAudit,
  loadAssumedPerson,
} from "./view-as";

export type ViewAsTurnInput = Pick<
  ExecuteTurnInput,
  "operations" | "corpus" | "vectorize" | "ai" | "lockFor" | "question" | "requestId" | "scopeDocumentId" | "runtime"
> & {
  /** The admin who asked. Retrieval runs as the assumed person; tool policy stays with the admin. */
  admin: DirectoryRecord;
  assumePrincipalId: string;
};

/**
 * One ephemeral turn as another person. Nothing is stored in conversations,
 * messages or metrics. An audit row is claimed before the run and completed
 * after it, even when the run fails. The response (and any restricted-title
 * diagnostic in it) is released only once the audit row records it: if the
 * completion cannot be written, the turn fails with a safe error instead.
 */
export async function runViewAsTurn(
  input: ViewAsTurnInput,
): Promise<GroundedAnswerResponse & TurnResponseExtras> {
  const person = await loadAssumedPerson(input.operations, input.assumePrincipalId);
  await beginViewAsAudit(input.operations, {
    requestId: input.requestId,
    adminPrincipalId: input.admin.id,
    assumedPrincipalId: person.record.id,
    question: input.question,
    scopeDocumentId: input.scopeDocumentId,
    now: Date.now(),
  });
  let answerType = "error";
  let cited: string[] = [];
  let diagnosticShown = false;
  let result: (GroundedAnswerResponse & TurnResponseExtras) | undefined;
  let failure: unknown;
  let failed = false;
  try {
    const assumedPerson = await echoAssumedPerson(person, input.corpus);
    const answer = await executeTurn({
      operations: input.operations,
      corpus: input.corpus,
      vectorize: input.vectorize,
      ai: input.ai,
      lockFor: input.lockFor,
      runtime: input.runtime,
      scopeDocumentId: input.scopeDocumentId,
      principal: input.admin,
      assumedPrincipal: {
        userId: person.record.id,
        roles: person.record.roles,
        departments: person.record.departments,
      },
      question: input.question,
      requestId: input.requestId,
      persistConversation: false,
    });
    answerType = answer.structuredAnswer.answerType;
    cited = citedDocumentIds(answer);
    // The grant echo of the loopback shape never leaves a view-as turn.
    const publicAnswer: GroundedAnswerResponse & TurnResponseExtras = { ...answer };
    delete publicAnswer.assumedPrincipal;
    let adminDiagnostic: TurnResponseExtras["adminDiagnostic"];
    if (answerType === "insufficient_evidence" && input.corpus) {
      try {
        const matches = await adminTitleMatch(input.corpus, input.question);
        if (matches.length > 0) {
          adminDiagnostic = matches;
          diagnosticShown = true;
        }
      } catch {
        console.error("admin_diagnostic_failed");
      }
    }
    result = { ...publicAnswer, assumedPerson, ...(adminDiagnostic ? { adminDiagnostic } : {}) };
  } catch (error) {
    failed = true;
    failure = error;
  }
  const completion = {
    requestId: input.requestId,
    answerType,
    citedDocumentIds: cited,
    diagnosticShown,
  };
  let audited = false;
  // One retry: completion is a single idempotent UPDATE of an owned row.
  for (let attempt = 0; attempt < 2 && !audited; attempt += 1) {
    try {
      await finishViewAsAudit(input.operations, completion);
      audited = true;
    } catch {
      console.error("view_as_audit_finish_failed");
    }
  }
  if (failed) {
    // The original failure outranks a failed audit completion.
    throw failure;
  }
  if (!audited || !result) {
    throw new Error("view_as_audit_incomplete");
  }
  return result;
}
