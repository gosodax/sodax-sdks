import type { Result } from '@sodax/types';
import { isAuthFailure } from '../errors/guards.js';
import { sleep } from '../shared/utils/shared-utils.js';
import type { RequestOverrideConfig } from './api-utils.js';
import type { SubmitTxAttempt } from './submitTxAttempt.js';

/** Structural view of swaps/bridge/leverage-yield `getSubmitTxStatus` `data`; `result` is present when executed. */
export interface BackendSubmitTxStatusEnvelope<TResult> {
  status: string;
  failureReason?: string;
  abandonedAt?: string;
  result?: TResult;
}

export type BackendSubmitTxPollResult<TValue> = { ok: true; value: TValue } | { ok: false; cause: Error };

/**
 * Polls within `attempt`'s own budget (the client-side fallback has a fresh `timeout`) and never throws.
 * `requestTimeoutMs` is the service ceiling each per-request override is clamped against.
 */
export async function pollBackendSubmitTx<TResult, TValue>({
  attempt,
  terminalStatus,
  getStatus,
  onExecuted,
  intervalMs = 1_000,
  requestTimeoutMs,
}: {
  attempt: SubmitTxAttempt;
  terminalStatus: string;
  getStatus: (override?: RequestOverrideConfig) => Promise<Result<{ data: BackendSubmitTxStatusEnvelope<TResult> }>>;
  onExecuted: (result: TResult | undefined) => TValue | undefined;
  intervalMs?: number;
  requestTimeoutMs: number;
}): Promise<BackendSubmitTxPollResult<TValue>> {
  let polls = 0;
  // Distinguishes a status endpoint that keeps failing from a backend that never finished.
  let lastStatusError: unknown;

  // Bound recomputed in the loop header so one clock reading drives both the poll decision and its timeout.
  for (
    let requestTimeout = attempt.requestTimeout(requestTimeoutMs);
    requestTimeout !== null;
    requestTimeout = attempt.requestTimeout(requestTimeoutMs)
  ) {
    polls += 1;
    const statusResult = await getStatus({ timeout: requestTimeout });
    if (statusResult.ok) {
      lastStatusError = undefined;
      const { status, result, failureReason, abandonedAt } = statusResult.value.data;
      if (status === terminalStatus) {
        const value = onExecuted(result);
        if (value !== undefined) return { ok: true, value };
      }
      if (status === 'failed' || abandonedAt) {
        const reason = failureReason ? `: ${failureReason}` : '';
        return { ok: false, cause: new Error(`backend submit-tx ${status}${reason}`) };
      }
    } else {
      lastStatusError = statusResult.error;
      // A rejected key can't succeed by waiting; other transport failures still retry.
      if (isAuthFailure(statusResult.error)) {
        return {
          ok: false,
          cause: new Error('backend submit-tx status rejected the API key', { cause: statusResult.error }),
        };
      }
    }
    // Give up once a sleep would swallow the rest of the attempt: only a null bound could follow it.
    if (attempt.remaining() <= intervalMs) break;
    await sleep(intervalMs);
  }

  if (polls === 0) {
    // Fix: raise `timeout`, or lower `api.timeout` so the POST cannot consume the whole attempt.
    return { ok: false, cause: new Error('backend submit-tx submitted, but no budget was left to poll for status') };
  }
  if (lastStatusError !== undefined) {
    return {
      ok: false,
      cause: new Error(`backend submit-tx status polling failed before reaching ${terminalStatus}`, {
        cause: lastStatusError,
      }),
    };
  }
  return { ok: false, cause: new Error(`backend submit-tx polling timed out before reaching ${terminalStatus}`) };
}
