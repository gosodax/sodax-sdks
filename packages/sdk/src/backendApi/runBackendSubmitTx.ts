import type { Result } from '@sodax/types';
import type { RequestOverrideConfig } from './api-utils.js';
import { type BackendSubmitTxStatusEnvelope, pollBackendSubmitTx } from './pollBackendSubmitTx.js';
import { noRequestBudgetCause, type SubmitTxAttempt } from './submitTxAttempt.js';

export interface BackendSubmitTxApi<TBody, TQuery, TResult> {
  getTimeout(): number;
  /** `success` is application-level: a 200 can still report the submission was not accepted. */
  submitTx(
    body: TBody,
    config?: RequestOverrideConfig,
  ): Promise<Result<{ success: boolean; data: { message: string } }>>;
  getSubmitTxStatus(
    query: TQuery,
    config?: RequestOverrideConfig,
  ): Promise<Result<{ data: BackendSubmitTxStatusEnvelope<TResult> }>>;
}

export type BackendSubmitTxResult<TValue> = { ok: true; value: TValue } | { ok: false; cause: unknown };

/**
 * One backend attempt: POST then poll to `terminalStatus`. Any `{ ok: false }` means "fall back to the relay".
 * Does NOT catch: unexpected throws belong to the caller's feature-tagged error wrapper.
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
  terminalStatus: string;
  onExecuted: (result: TResult | undefined) => TValue | undefined;
  /** Deliberately excludes `timeout`/`baseURL`: the attempt budget owns the deadline. */
  overrideConfig?: Pick<RequestOverrideConfig, 'apiKey'>;
}): Promise<BackendSubmitTxResult<TValue>> {
  // Computed once so the guarded value is the value sent; `null` means send nothing rather than abort at 0 ms.
  const serviceTimeoutMs = api.getTimeout();
  const requestTimeout = attempt.requestTimeout(serviceTimeoutMs);
  if (requestTimeout === null) return { ok: false, cause: noRequestBudgetCause(serviceTimeoutMs) };

  const submitted = await api.submitTx(body, { ...overrideConfig, timeout: requestTimeout });
  if (!submitted.ok) return { ok: false, cause: submitted.error };
  // A 200 with `success: false` was not queued, so there's nothing to poll: fall back now.
  if (!submitted.value.success) {
    return { ok: false, cause: new Error(`backend submit-tx not accepted: ${submitted.value.data.message}`) };
  }

  const polled = await pollBackendSubmitTx({
    attempt,
    terminalStatus,
    getStatus: override => api.getSubmitTxStatus(statusQuery, { ...overrideConfig, ...override }),
    onExecuted,
    requestTimeoutMs: serviceTimeoutMs,
  });
  return polled.ok ? { ok: true, value: polled.value } : { ok: false, cause: polled.cause };
}
