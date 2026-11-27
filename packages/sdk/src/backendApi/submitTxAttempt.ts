import { resolveTimeoutMs } from '../shared/utils/resolveTimeoutMs.js';

/** Budget for ONE backend submit-tx attempt; not shared with the relay fallback, which gets its own fresh `timeout`. */
export interface SubmitTxAttempt {
  remaining(): number;
  /**
   * `min(remaining, service timeout)`, or `null` when no request should go out. An override replaces rather than
   * caps `config.timeout`, hence the clamp; compute once, then check.
   */
  requestTimeout(serviceTimeoutMs: number): number | null;
}

/** `null` bound has two causes needing different fixes: caller `timeout` exhausted, or non-positive `api.timeout`. */
export function noRequestBudgetCause(serviceTimeoutMs: number): Error {
  return serviceTimeoutMs > 0
    ? new Error('backend submit-tx skipped: the caller timeout left no budget for the attempt')
    : new Error(`backend submit-tx skipped: api timeout must be a positive number, got ${serviceTimeoutMs}`);
}

/** `callerTimeoutMs` has already been through `resolveTimeoutMs`; the deadline stays private. */
export function createSubmitTxAttempt(callerTimeoutMs: number): SubmitTxAttempt {
  const deadline = Date.now() + resolveTimeoutMs(callerTimeoutMs, 0);
  const remaining = (): number => Math.max(0, deadline - Date.now());

  return {
    remaining,
    requestTimeout: (serviceTimeoutMs: number): number | null => {
      const timeout = Math.min(remaining(), serviceTimeoutMs);
      return timeout > 0 ? timeout : null;
    },
  };
}
