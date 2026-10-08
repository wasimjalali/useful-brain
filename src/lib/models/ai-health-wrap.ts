import type { WorkersAiRunner } from "../embeddings/workers-ai-embed";
import type { OperationsDatabase } from "../store/conversations";
import { recordedAiRun } from "./ai-health";

/** At most one success write per minute; every failure is written. */
export const AI_HEALTH_SUCCESS_INTERVAL_MS = 60_000;

/**
 * Wrap a Workers AI binding so every chat, embedding and rerank call records
 * its outcome. The wrapped runner returns or throws exactly what the binding does.
 */
export function withAiHealth(operations: OperationsDatabase, ai: WorkersAiRunner): WorkersAiRunner {
  return {
    run: (model, input, options) =>
      recordedAiRun(operations, () => ai.run(model, input, options), Date.now, {
        successMinIntervalMs: AI_HEALTH_SUCCESS_INTERVAL_MS,
        signal: options?.signal,
      }),
  };
}
