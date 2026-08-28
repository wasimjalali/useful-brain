"use server";

import { brainJson } from "@/lib/cf/brain-client";
import type { EvalRunResult } from "@/lib/eval/manual-eval-set";
import {
  actionSuccess,
  toPublicAppError,
  type ActionResult,
} from "@/lib/rag/app-errors";

export async function runEvalsAction(): Promise<ActionResult<EvalRunResult>> {
  try {
    return actionSuccess(await brainJson<EvalRunResult>("/evaluations/run", { method: "POST", json: {} }));
  } catch (error) {
    return {
      ok: false,
      error: toPublicAppError(error, {
        code: "INTERNAL_ERROR",
        message: "The evaluation run could not be started.",
        retryable: true,
      }),
    };
  }
}
