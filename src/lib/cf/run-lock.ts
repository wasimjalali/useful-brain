export function acquireRunLock(
  currentRunId: string | undefined,
  requestedRunId: string,
): { ok: true; runId: string } | { ok: false; status: 409 } {
  if (!requestedRunId) {
    return { ok: false, status: 409 };
  }
  if (currentRunId && currentRunId !== requestedRunId) {
    return { ok: false, status: 409 };
  }
  return { ok: true, runId: requestedRunId };
}

export function releaseRunLock(
  currentRunId: string | undefined,
  requestedRunId: string,
): { ok: true } | { ok: false; status: 409 } {
  if (!currentRunId || currentRunId !== requestedRunId) {
    return { ok: false, status: 409 };
  }
  return { ok: true };
}
