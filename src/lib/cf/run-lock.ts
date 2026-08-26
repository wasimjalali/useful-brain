import { parseBoundedId } from "./bounded-id";

export type RunLockResult = { ok: true; runId: string } | { ok: false; status: 409 };

export function acquireRunLock(
  currentRunId: string | undefined,
  requestedRunId: string,
): RunLockResult {
  const runId = parseBoundedId(requestedRunId, "run id");
  if (currentRunId && currentRunId !== runId) {
    return { ok: false, status: 409 };
  }
  return { ok: true, runId };
}

export function releaseRunLock(
  currentRunId: string | undefined,
  requestedRunId: string,
): { ok: true } | { ok: false; status: 409 } {
  const runId = parseBoundedId(requestedRunId, "run id");
  if (!currentRunId || currentRunId !== runId) {
    return { ok: false, status: 409 };
  }
  return { ok: true };
}
