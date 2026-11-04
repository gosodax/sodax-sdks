import type { Result } from '@sodax/types';
import { isAuthFailure } from '../errors/guards.js';
import { sleep } from '../shared/utils/shared-utils.js';
import type { RequestOverrideConfig } from './api-utils.js';
import type { SubmitTxAttempt } from './submitTxAttempt.js';

/**
 * Minimal structural view of a `getSubmitTxStatus` response `data` envelope, shared by the swaps and
 * bridge backend APIs. Both `SubmitTxStatusDataV2` (swaps) and `BridgeSubmitTxStatusDataV2` (bridge)
 * are assignable to this: bridge types `status` as a tolerant `string`, swaps as a literal union that
 * widens to `string`. `TResult` is the feature-specific `result` payload (present when executed).
 */
export interface BackendSubmitTxStatusEnvelope<TResult> {
  status: string;
  failureReason?: string;
  abandonedAt?: string;
  result?: TResult;
}

export type BackendSubmitTxPollResult<TValue> = { ok: true; value: TValue } | { ok: false; cause: Error };

/**
 * Shared poll loop for the backend submit-tx flow (`SwapService.submitTx` / `BridgeService.submitTx`).
 *
 * Polls `getStatus` until the backend reaches a terminal state, then returns the feature-specific
 * success value built by `onExecuted`, or a `cause` Error — the caller wraps that cause into its own
 * feature error and falls back to the client-side relay. Never throws.
 *
 * The failure cause distinguishes four situations, because the caller logs it and nothing else: a
 * terminal `failed`/abandoned status (with the backend's reason), a submission that left no budget to
 * poll with, status requests that never succeeded (carrying the last one as `cause`), and a plain
 * timeout where polling worked but the backend never finished.
 *
 * The loop is bounded by `attempt`, the backend attempt's OWN budget. The client-side fallback holds a
 * separate, fresh `timeout`, so nothing here needs to hold anything back for it: whatever this loop
 * spends cannot shorten the relay wait that follows. It still stops as early as it usefully can, since
 * every millisecond spent here is a millisecond the caller waits before the fallback starts — no request
 * or sleep is issued once the attempt cannot outlast it.
 *
 * Every request is clamped by {@link SubmitTxAttempt.requestTimeout}. That clamp bounds a request by the
 * attempt — it does not guarantee a retry: the poll retries only while `requestTimeoutMs` is the smaller
 * of the two bounds, and once the attempt's remainder drops below it a single stalled request can spend
 * what is left.
 *
 * @param attempt - Budget for this backend attempt, from `createSubmitTxAttempt(timeout)`.
 * @param terminalStatus - The feature's terminal-success status literal (`'solved'` for swaps,
 *   `'executed'` for bridge); `onExecuted` runs only once the status reaches it.
 * @param getStatus - Fetches one status snapshot (e.g. `backendApi.<feature>.getSubmitTxStatus`).
 *   Receives the clamped per-call override.
 * @param onExecuted - Builds the success value from a terminal-status result; returns `undefined` when
 *   the result is not yet complete so polling continues.
 * @param intervalMs - Poll interval in ms (default 1000).
 * @param requestTimeoutMs - The service's own effective request timeout (e.g.
 *   `backendApi.bridge.getTimeout()` — configurable, defaulting to `DEFAULT_BACKEND_API_TIMEOUT`).
 *   Required: it is the ceiling every per-request override is clamped against, so a stalled request can
 *   never outlive the service's own bound.
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
  // Last transport-level failure, cleared whenever a request succeeds. Mirrors `lastPollingError` in
  // `waitUntilIntentExecuted`: without the record, a status endpoint that keeps timing out is
  // indistinguishable from a backend that simply never finished, and the caller logs the wrong story.
  let lastStatusError: unknown;

  // The bound is recomputed in the loop HEADER, so one reading of the clock drives both the decision to
  // poll and the request's own timeout, and no later edit — an added `continue`, say — can skip the
  // update and poll on a stale reading. Testing `remaining()` and deriving the bound separately would
  // let the attempt expire in between, sending a request with a 0 ms abort already armed.
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
      // A rejected key cannot become success by waiting, so stop instead of burning the attempt the
      // caller's client-side fallback is waiting on. Timeouts and other transport failures still retry.
      if (isAuthFailure(statusResult.error)) {
        return {
          ok: false,
          cause: new Error('backend submit-tx status rejected the API key', { cause: statusResult.error }),
        };
      }
    }
    // transient !ok / pending / relaying / relayed / posting_execution → wait, then poll again. Give up
    // instead once an interval would swallow the rest of the attempt: that sleep can only be followed by
    // a null bound, so it is dead wait standing between the caller and the client-side fallback.
    if (attempt.remaining() <= intervalMs) break;
    await sleep(intervalMs);
  }

  // Three distinct ways to arrive here, and the caller only ever sees this cause — so say which.
  if (polls === 0) {
    // The POST landed and the backend is processing; the attempt just had nothing left to watch with.
    // Actionable differently from a timeout: raise `timeout`, or lower `api.timeout` so the POST cannot
    // consume the whole attempt.
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
