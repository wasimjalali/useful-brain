export function toolDeadlineSignal(timeoutMs: number, signal?: AbortSignal): AbortSignal {
  const timeout = AbortSignal.timeout(Math.max(0, timeoutMs));
  if (!signal) {
    return timeout;
  }
  return AbortSignal.any([signal, timeout]);
}

export async function awaitWithDeadline<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) {
    // The race is already lost, but the inner promise still settles: consume
    // its outcome so a late rejection is never unhandled.
    void promise.catch(() => undefined);
    throw abortError();
  }
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => {
      cleanup();
      reject(abortError());
    };
    const cleanup = () => {
      signal.removeEventListener("abort", onAbort);
    };
    signal.addEventListener("abort", onAbort);
    promise.then(
      (value) => {
        cleanup();
        resolve(value);
      },
      (error) => {
        cleanup();
        reject(error);
      },
    );
  });
}

function abortError(): Error {
  return new DOMException("The operation was aborted.", "AbortError");
}
