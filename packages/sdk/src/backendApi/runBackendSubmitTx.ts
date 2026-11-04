import type { Result } from '@sodax/types';
import type { RequestOverrideConfig } from './api-utils.js';
import { type BackendSubmitTxStatusEnvelope, pollBackendSubmitTx } from './pollBackendSubmitTx.js';
import { noRequestBudgetCause, type SubmitTxAttempt } from './submitTxAttempt.js';

/**
 * The slice of a backend API service this flow needs. Structural on purpose: `SwapsApiService` and
 * `BridgeApiService` both satisfy it without either knowing about this module.
 */
export interface BackendSubmitTxApi<TBody, TQuery, TResult> {
  /** The service's own per-request timeout — the ceiling every request here is clamped against. */
  getTimeout(): number;
  /**
   * Both features answer with `{ success, data: { status: 'inserted' | 'duplicate', message } }`, and
   * `success` is application-level: a 200 can still report the submission was not accepted. Typed here
   * rather than as `unknown` so that check cannot be dropped.
   */
  submitTx(
    body: TBody,
    config?: RequestOverrideConfig,
  ): Promise<Result<{ success: boolean; data: { message: string } }>>;
  getSubmitTxStatus(
    query: TQuery,
    config?: RequestOverrideConfig,
  ): Promise<Result<{ data: BackendSubmitTxStatusEnvelope<TResult> }>>;
}

/**
 * Outcome of one backend attempt. `cause` is `unknown` rather than `Error` because it carries whatever
 * the API service returned as its failure, which `Result` types loosely.
 */
export type BackendSubmitTxResult<TValue> = { ok: true; value: TValue } | { ok: false; cause: unknown };

/**
 * Run ONE backend submit-tx attempt: `POST /<feature>/submit-tx`, then poll `getSubmitTxStatus` until
 * the feature's terminal status, and map the terminal result to the feature's success value.
 *
 * Feature-agnostic by design — it knows nothing about swaps, bridge, or their error taxonomies, so the
 * budget rules live in exactly one place instead of once per feature. Callers translate the outcome
 * into their own `Result`: `ok` is the value they promised, and any `{ ok: false }` means "this attempt
 * did not complete, fall back to the client-side relay". The distinction between a rejected POST, a
 * terminal `failed`, and a spent attempt is preserved in `cause` for the log, not in the shape.
 *
 * Does NOT catch. An unexpected throw belongs to the caller's own error wrapper, which knows the
 * feature tag and context to attach.
 *
 * @param attempt - Budget for this attempt alone. Both the POST and every status request draw on it;
 *   the client-side fallback holds a separate, fresh `timeout`.
 */
export async function runBackendSubmitTx<TBody, TQuery, TResult, TValue>({
  attempt,
  api,
  body,
  statusQuery,
  terminalStatus,
  onExecuted,
  overrideConfig,
}: {
  attempt: SubmitTxAttempt;
  api: BackendSubmitTxApi<TBody, TQuery, TResult>;
  body: TBody;
  statusQuery: TQuery;
  /** The feature's terminal-success status (`'solved'` for swaps, `'executed'` for bridge). */
  terminalStatus: string;
  onExecuted: (result: TResult | undefined) => TValue | undefined;
  /**
   * Per-action request override (an `apiKey` from swap/bridge `extras`) applied to the POST and every
   * status request. Deliberately excludes `timeout`/`baseURL` — the attempt budget owns the deadline.
   */
  overrideConfig?: Pick<RequestOverrideConfig, 'apiKey'>;
}): Promise<BackendSubmitTxResult<TValue>> {
  // Bound the POST and every status request by this attempt, never above the service's own timeout. The
  // API persists and returns immediately, so a slow POST means a degraded endpoint; it can cost this
  // attempt its poll, but never the fallback's budget. A `null` bound means no request should go out at
  // all — fall through rather than arm an abort at 0 ms. Computed once, so the value guarded here is the
  // value sent.
  const serviceTimeoutMs = api.getTimeout();
  const requestTimeout = attempt.requestTimeout(serviceTimeoutMs);
  if (requestTimeout === null) return { ok: false, cause: noRequestBudgetCause(serviceTimeoutMs) };

  const submitted = await api.submitTx(body, { ...overrideConfig, timeout: requestTimeout });
  if (!submitted.ok) return { ok: false, cause: submitted.error };
  // `ok` is only transport-level. A 200 carrying `success: false` means the backend did NOT queue the
  // submission, so there is nothing to poll for — fall back now instead of burning the whole attempt
  // watching a row that will never exist. Same rule the relay applies to its own submit response.
  if (!submitted.value.success) {
    return { ok: false, cause: new Error(`backend submit-tx not accepted: ${submitted.value.data.message}`) };
  }

  const polled = await pollBackendSubmitTx({
    attempt,
    terminalStatus,
    // The poll's own override (its per-request timeout) wins over the per-action fields.
    getStatus: override => api.getSubmitTxStatus(statusQuery, { ...overrideConfig, ...override }),
    onExecuted,
    // While this ceiling is the smaller bound the poll retries within the attempt; once the attempt's
    // remainder falls below it, one stalled request can spend the rest.
    requestTimeoutMs: serviceTimeoutMs,
  });
  return polled.ok ? { ok: true, value: polled.value } : { ok: false, cause: polled.cause };
}
