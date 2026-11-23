import { ATOMIC_BATCH_UNCONFIRMED, isIndeterminateOutcomeError, isSodaxError } from '@sodax/sdk';
import type { UseMutationOptions } from '@tanstack/react-query';

/** A mutation may have moved funds. Only retry errors without an existing operation to resume. */
export function retryBeforeSubmission<TError>(retry: UseMutationOptions<unknown, TError>['retry']) {
  return (failureCount: number, error: TError): boolean => {
    if (isIndeterminateOutcomeError(error)) return false;
    if (isSodaxError(error)) {
      const { srcTxHash, hubTxHash, dstTxHash, trackingId, recovery, batchId, reason } = error.context ?? {};
      if (
        srcTxHash ||
        hubTxHash ||
        dstTxHash ||
        trackingId ||
        recovery ||
        batchId ||
        reason === ATOMIC_BATCH_UNCONFIRMED
      ) {
        return false;
      }
    }
    if (typeof retry === 'function') return retry(failureCount, error);
    if (typeof retry === 'number') return failureCount < retry;
    return retry === true;
  };
}
