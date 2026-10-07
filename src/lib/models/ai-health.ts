import type { HealthDetailCode } from "../contracts/admin-metrics";
import type { OperationsDatabase } from "../store/conversations";
import { recordServiceHealth } from "../store/service-health";

export const WORKERS_AI_SERVICE = "workers_ai";

function failureCode(error: unknown): HealthDetailCode {
  const message = error instanceof Error ? error.message : "";
  if (/timeout|timed out|abort/i.test(message)) {
    return "timeout";
  }
  if (/429|rate.?limit|too many requests/i.test(message)) {
    return "rate_limited";
  }
  return "last_call_failed";
}

/** Last success write per service in this isolate, for the optional success throttle. */
const lastSuccessWriteAt = new Map<string, number>();

/** Test hook: forget the throttle so one test cannot silence the next. */
export function resetAiHealthThrottle(): void {
  lastSuccessWriteAt.clear();
}

export type RecordedAiRunOptions = {
  /**
   * When set, a success is written at most once per interval in this isolate.
   * Failures are always written.
   */
  successMinIntervalMs?: number;
};

/**
 * Wrap one `AI.run` call. Records the outcome as a Workers AI health event and
 * returns or rethrows exactly what the call did. A failed health write never
 * changes the call's result.
 */
export async function recordedAiRun<T>(
  db: OperationsDatabase,
  call: () => Promise<T>,
  now: () => number = Date.now,
  options: RecordedAiRunOptions = {},
): Promise<T> {
  let outcome: { status: "ok" | "error"; code: HealthDetailCode };
  try {
    const value = await call();
    outcome = { status: "ok", code: "last_call_ok" };
    const interval = options.successMinIntervalMs;
    const at = now();
    const last = lastSuccessWriteAt.get(WORKERS_AI_SERVICE);
    if (interval === undefined || last === undefined || at - last >= interval) {
      lastSuccessWriteAt.set(WORKERS_AI_SERVICE, at);
      await record(db, outcome, now);
    }
    return value;
  } catch (error) {
    outcome = { status: "error", code: failureCode(error) };
    await record(db, outcome, now);
    throw error;
  }
}

async function record(
  db: OperationsDatabase,
  outcome: { status: "ok" | "error"; code: HealthDetailCode },
  now: () => number,
): Promise<void> {
  try {
    await recordServiceHealth(db, { service: WORKERS_AI_SERVICE, ...outcome, at: now() });
  } catch {
    console.error("service_health_write_failed");
  }
}
