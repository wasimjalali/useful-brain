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
 * messages or metrics. An audit row is written before the run and completed after
 * it, even when the run fails.
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
    now: Date.now(),
  });
  let answerType = "error";
  let cited: string[] = [];
  let diagnosticShown = false;
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
    return { ...publicAnswer, assumedPerson, ...(adminDiagnostic ? { adminDiagnostic } : {}) };
  } finally {
    await finishViewAsAudit(input.operations, {
      requestId: input.requestId,
      answerType,
      citedDocumentIds: cited,
      diagnosticShown,
    }).catch(() => {
      console.error("view_as_audit_finish_failed");
    });
  }
}
