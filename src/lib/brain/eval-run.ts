import { evaluateCase } from "../eval/run-eval";
import { MANUAL_EVAL_SET, type EvalCaseResult, type EvalRunResult } from "../eval/manual-eval-set";
import type { DirectoryRecord } from "../auth/principal";
import { finishEvalRun, startEvalRun } from "../store/eval-runs";
import type { OperationsDatabase } from "../store/conversations";
import { executeTurn, type ExecuteTurnInput } from "./execute-turn";

export async function runManualEvaluations(input: {
  operations: OperationsDatabase;
  principal: DirectoryRecord;
  turn: Omit<ExecuteTurnInput, "question" | "requestId" | "persistConversation" | "principal" | "operations">;
}): Promise<EvalRunResult> {
  const startedAt = Date.now();
  const runId = await startEvalRun(input.operations, {
    ownerPrincipalId: input.principal.id,
    total: MANUAL_EVAL_SET.length,
    now: startedAt,
  });
  const results: EvalCaseResult[] = [];
  try {
    for (const evalCase of MANUAL_EVAL_SET) {
      const caseStartedAt = Date.now();
      let result: EvalCaseResult;
      try {
        const answer = await executeTurn({
          ...input.turn,
          operations: input.operations,
          principal: input.principal,
          question: evalCase.question,
          requestId: `eval-${runId}-${evalCase.id}`,
          persistConversation: false,
        });
        const outcome = evaluateCase(evalCase.assertion, answer);
        result = {
          id: evalCase.id,
          question: evalCase.question,
          category: evalCase.category,
          expectation: evalCase.expectation,
          status: outcome.status,
          answerType: outcome.answerType,
          citedSources: outcome.citedSources,
          detail: outcome.detail,
        };
      } catch (error) {
        result = {
          id: evalCase.id,
          question: evalCase.question,
          category: evalCase.category,
          expectation: evalCase.expectation,
          status: "fail",
          answerType: "error",
          citedSources: [],
          detail: error instanceof Error ? error.message : "The evaluation case could not be completed.",
        };
      }
      void caseStartedAt;
      results.push(result);
    }
    const passed = results.filter((item) => item.status === "pass").length;
    const finishedAt = Date.now();
    await finishEvalRun(input.operations, {
      runId,
      ownerPrincipalId: input.principal.id,
      status: "completed",
      passed,
      results,
      now: finishedAt,
    });
    return {
      ranAt: new Date(finishedAt).toISOString(),
      total: results.length,
      passed,
      results,
    };
  } catch (error) {
    const passed = results.filter((item) => item.status === "pass").length;
    await finishEvalRun(input.operations, {
      runId,
      ownerPrincipalId: input.principal.id,
      status: "interrupted",
      passed,
      results,
      now: Date.now(),
    }).catch(() => undefined);
    throw error;
  }
}
