import type { HealthDetailCode } from "../contracts/admin-metrics";
import type { OperationsDatabase } from "../store/conversations";
import { recordServiceHealth } from "../store/service-health";

export const WORKERS_AI_SERVICE = "workers_ai";

function failureCode(error: unknown, signal?: AbortSignal): HealthDetailCode {
  if (signal?.aborted && signal.reason instanceof Error && signal.reason.name === "TimeoutError") {
    return "timeout";
  }
  const message = error instanceof Error ? error.message : "";
  if ((error instanceof Error && error.name === "TimeoutError") || /timeout|timed out/i.test(message)) {
    return "timeout";
  }
  if (/429|rate.?limit|too many requests/i.test(message)) {
    return "rate_limited";
  }
  return "last_call_failed";
}

/**
 * Last health write per service in this isolate, for the optional success
 * throttle. Only a success that follows a success is throttled: the first
 * success after a failure is always written so recovery shows at once.
 */
const lastWrite = new Map<string, { at: number; status: "ok" | "error" }>();

/** Test hook: forget the throttle so one test cannot silence the next. */
export function resetAiHealthThrottle(): void {
  lastWrite.clear();
}

export type RecordedAiRunOptions = {
  /**
   * When set, a success is written at most once per interval in this isolate.
   * Failures are always written, and so is the first success after one.
   */
  successMinIntervalMs?: number;
  /**
   * Signal the caller can abort (user Stop, turn wall-time budget). A call
   * that fails because that signal fired says nothing about Workers AI, so it
   * is rethrown without a health event. A TimeoutError reason still counts.
   */
  signal?: AbortSignal;
};

/** True when the caller, not the service, ended the call. */
function isCallerAbort(error: unknown, signal: AbortSignal | undefined): boolean {
  if (signal?.aborted) {
    const reason: unknown = signal.reason;
    return !(reason instanceof Error && reason.name === "TimeoutError");
  }
  return error instanceof Error && error.name === "AbortError";
}

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
    const last = lastWrite.get(WORKERS_AI_SERVICE);
    if (
      interval === undefined ||
      last === undefined ||
      last.status === "error" ||
      at - last.at >= interval
    ) {
      lastWrite.set(WORKERS_AI_SERVICE, { at, status: "ok" });
      await record(db, outcome, now);
    }
    return value;
  } catch (error) {
    if (isCallerAbort(error, options.signal)) {
      throw error;
    }
    outcome = { status: "error", code: failureCode(error, options.signal) };
    lastWrite.set(WORKERS_AI_SERVICE, { at: now(), status: "error" });
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
