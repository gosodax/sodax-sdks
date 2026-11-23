import { isIndeterminateOutcomeError, isSodaxError } from '@sodax/sdk';
import type { UseMutationOptions } from '@tanstack/react-query';

/** A mutation may have moved funds. Only retry errors without an existing operation to resume. */
export function retryBeforeSubmission(retry: UseMutationOptions<unknown, Error>['retry']) {
  return (failureCount: number, error: Error): boolean => {
    if (isIndeterminateOutcomeError(error)) return false;
    if (isSodaxError(error)) {
      const { srcTxHash, hubTxHash, dstTxHash, trackingId, recovery } = error.context ?? {};
      if (srcTxHash || hubTxHash || dstTxHash || trackingId || recovery) return false;
    }
    if (typeof retry === 'function') return retry(failureCount, error);
    if (typeof retry === 'number') return failureCount < retry;
    return retry === true;
  };
}
