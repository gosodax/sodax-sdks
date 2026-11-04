/**
 * Settles with `promise`, or rejects with `onTimeout()` once `ms` pass, or with `onAbort()` once `signal`
 * aborts — whichever comes first. The timer and the abort listener are released either way.
 */
export function withDeadline<T>(
  promise: Promise<T>,
  ms: number,
  onTimeout: () => Error,
  signal?: AbortSignal,
  onAbort: () => Error = () => (signal?.reason instanceof Error ? signal.reason : new Error('Aborted')),
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const finish = (settle: () => void) => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      settle();
    };
    const abort = () => finish(() => reject(onAbort()));
    const timer = setTimeout(() => finish(() => reject(onTimeout())), ms);
    if (signal?.aborted) return abort();
    signal?.addEventListener('abort', abort);
    promise.then(
      value => finish(() => resolve(value)),
      (error: unknown) => finish(() => reject(error)),
    );
  });
}
