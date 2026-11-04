/**
 * Unit tests for the shared backend submit-tx attempt.
 *
 * This is the half of `SwapService.submitTx` / `BridgeService.submitTx` that is identical between the
 * two features, so the budget rules are asserted here once against a fake API rather than twice through
 * a whole service. The service suites keep only what is feature-specific: the request body, the terminal
 * status, the success mapping, and the error taxonomy each maps the outcome into.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Result } from '@sodax/types';
import { SodaxError } from '../errors/SodaxError.js';
import { runBackendSubmitTx, type BackendSubmitTxApi } from './runBackendSubmitTx.js';
import { createSubmitTxAttempt } from './submitTxAttempt.js';
import type { BackendSubmitTxStatusEnvelope } from './pollBackendSubmitTx.js';
import type { RequestOverrideConfig } from './api-utils.js';

const SERVICE_TIMEOUT_MS = 30_000;

type TestResult = { dstIntentTxHash?: string };
type TestBody = { txHash: string };
type TestQuery = { txHash: string };

/** Records every call and override so the assertions can read what the flow actually sent. */
type SubmitResponse = Result<{ success: boolean; data: { message: string } }>;
const ACCEPTED: SubmitResponse = { ok: true, value: { success: true, data: { message: 'accepted' } } };

function fakeApi(
  overrides: {
    getTimeout?: number;
    submitTx?: SubmitResponse;
    /**
     * Make the POST burn its entire per-request bound before settling — the shape `makeRequest` produces
     * when a request hangs until its own AbortController fires.
     */
    submitConsumesItsBound?: boolean;
    /** Same, for every status request: models a status endpoint that answers only when aborted. */
    statusConsumesItsBound?: boolean;
    /** When set, every status request fails with this error instead of returning an envelope. */
    statusError?: unknown;
    statuses?: BackendSubmitTxStatusEnvelope<TestResult>[];
  } = {},
): BackendSubmitTxApi<TestBody, TestQuery, TestResult> & {
  submitCalls: { body: TestBody; config?: RequestOverrideConfig }[];
  statusCalls: { query: TestQuery; config?: RequestOverrideConfig }[];
} {
  const submitCalls: { body: TestBody; config?: RequestOverrideConfig }[] = [];
  const statusCalls: { query: TestQuery; config?: RequestOverrideConfig }[] = [];
  const statuses = overrides.statuses ?? [{ status: 'executed', result: { dstIntentTxHash: '0xDST' } }];

  return {
    submitCalls,
    statusCalls,
    getTimeout: () => overrides.getTimeout ?? SERVICE_TIMEOUT_MS,
    submitTx: async (body, config) => {
      submitCalls.push({ body, config });
      if (overrides.submitConsumesItsBound) {
        await new Promise(resolve => setTimeout(resolve, config?.timeout ?? 0));
      }
      return overrides.submitTx ?? ACCEPTED;
    },
    getSubmitTxStatus: async (query, config) => {
      statusCalls.push({ query, config });
      if (overrides.statusConsumesItsBound) {
        await new Promise(resolve => setTimeout(resolve, config?.timeout ?? 0));
      }
      if (overrides.statusError !== undefined) return { ok: false, error: overrides.statusError };
      return { ok: true, value: { data: statuses[Math.min(statusCalls.length - 1, statuses.length - 1)] as never } };
    },
  };
}

const run = (api: ReturnType<typeof fakeApi>, timeoutMs = 120_000) =>
  runBackendSubmitTx({
    attempt: createSubmitTxAttempt(timeoutMs),
    api,
    body: { txHash: '0xspokeTx' },
    statusQuery: { txHash: '0xspokeTx' },
    terminalStatus: 'executed',
    onExecuted: (result: TestResult | undefined) => result?.dstIntentTxHash,
  });

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(0);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('runBackendSubmitTx — happy path', () => {
  it('submits, polls to the terminal status, and returns the mapped value', async () => {
    const api = fakeApi();

    const result = await run(api);

    expect(result).toEqual({ ok: true, value: '0xDST' });
    expect(api.submitCalls).toHaveLength(1);
    expect(api.statusCalls).toHaveLength(1);
  });

  it('passes the body and the status query through verbatim', async () => {
    const api = fakeApi();

    await run(api);

    // The feature owns these shapes — swaps sends `relayData.payload`, bridge the full envelope — so
    // the shared flow must not reinterpret either.
    expect(api.submitCalls[0]?.body).toEqual({ txHash: '0xspokeTx' });
    expect(api.statusCalls[0]?.query).toEqual({ txHash: '0xspokeTx' });
  });

  it('keeps polling past a terminal status whose result is not yet complete', async () => {
    const api = fakeApi({
      statuses: [{ status: 'executed' }, { status: 'executed', result: { dstIntentTxHash: '0xDST' } }],
    });

    const promise = run(api);
    await vi.advanceTimersByTimeAsync(2_000);

    expect(await promise).toEqual({ ok: true, value: '0xDST' });
    expect(api.statusCalls.length).toBeGreaterThan(1);
  });
});

describe('runBackendSubmitTx — per-action override config', () => {
  it('applies the override to the POST and every status request without touching the timeout bounds', async () => {
    const api = fakeApi({
      statuses: [{ status: 'executed' }, { status: 'executed', result: { dstIntentTxHash: '0xDST' } }],
    });

    const promise = runBackendSubmitTx({
      attempt: createSubmitTxAttempt(120_000),
      api,
      body: { txHash: '0xspokeTx' },
      statusQuery: { txHash: '0xspokeTx' },
      terminalStatus: 'executed',
      onExecuted: (result: TestResult | undefined) => result?.dstIntentTxHash,
      overrideConfig: { apiKey: 'per-action-key' },
    });
    await vi.advanceTimersByTimeAsync(2_000);
    expect(await promise).toEqual({ ok: true, value: '0xDST' });

    // The POST keeps its attempt-computed bound; the override only adds the key.
    expect(api.submitCalls[0]?.config).toEqual({ apiKey: 'per-action-key', timeout: SERVICE_TIMEOUT_MS });
    for (const call of api.statusCalls) {
      expect(call.config?.apiKey).toBe('per-action-key');
      expect(call.config?.timeout).toBeDefined(); // the poll's own per-request bound survives the merge
    }
  });
});

describe('runBackendSubmitTx — request bounds', () => {
  it('clamps the POST down to the service timeout when the attempt has more budget', async () => {
    const api = fakeApi();

    await run(api, 120_000);

    // An override REPLACES `config.timeout`, so the raw remainder would RAISE the bound to 120s.
    expect(api.submitCalls[0]?.config).toEqual({ timeout: SERVICE_TIMEOUT_MS });
  });

  it('clamps the POST down to the remaining budget when that is the smaller bound', async () => {
    const api = fakeApi();

    await run(api, 10_000);

    expect(api.submitCalls[0]?.config).toEqual({ timeout: 10_000 });
  });

  it('bounds status requests by the same ceiling as the POST', async () => {
    const api = fakeApi({ statuses: [{ status: 'pending' }] });

    // The attempt must exceed the service ceiling for the ceiling to be the binding side of the `min`
    // — on a budget smaller than it, `remaining()` always wins and the assertion below proves nothing.
    const promise = run(api, 120_000);
    await vi.advanceTimersByTimeAsync(120_000);
    await promise;

    expect(api.statusCalls.length).toBeGreaterThan(1);
    expect(api.statusCalls.every(c => (c.config?.timeout ?? 0) > 0)).toBe(true);
    expect(api.statusCalls.every(c => (c.config?.timeout ?? 0) <= SERVICE_TIMEOUT_MS)).toBe(true);
    // The first request is the one that would exceed the ceiling if the clamp were dropped: a fresh
    // 120s attempt against a 30s service timeout.
    expect(api.statusCalls[0]?.config).toEqual({ timeout: SERVICE_TIMEOUT_MS });
  });

  it('retries after a status request that consumed its whole bound', async () => {
    // A blackholed status endpoint: each request answers only when its own abort fires. The clamp
    // exists so one such request costs its ceiling and no more, leaving the attempt room to try again.
    const api = fakeApi({ statusConsumesItsBound: true, statusError: new Error('REQUEST_TIMEOUT') });

    const promise = run(api, 120_000);
    await vi.advanceTimersByTimeAsync(120_000);
    const result = await promise;

    // 120s attempt, 30s ceiling: ~3-4 stalls, not one 120s stall that eats the attempt whole.
    expect(api.statusCalls.length).toBeGreaterThan(2);
    expect(api.statusCalls.every(c => (c.config?.timeout ?? 0) <= SERVICE_TIMEOUT_MS)).toBe(true);
    expect(result.ok).toBe(false);
  });
});

describe('runBackendSubmitTx — a POST that consumes its bound', () => {
  it('leaves the poll only what the POST did not spend', async () => {
    // 40s attempt against a 30s ceiling: the POST is clamped to 30s and hangs for all of it, so the
    // first status request must see the 10s remainder — NOT another 30s. This is the one property the
    // clamp-value assertions cannot reach: the POST and the poll draw on the SAME attempt, so a
    // regression that hands the POST its own budget, or re-opens the attempt after it, still passes
    // every other test here.
    const api = fakeApi({ submitConsumesItsBound: true });

    const promise = run(api, 40_000);
    await vi.advanceTimersByTimeAsync(40_000);

    expect((await promise).ok).toBe(true);
    expect(api.submitCalls[0]?.config).toEqual({ timeout: 30_000 });
    expect(api.statusCalls[0]?.config).toEqual({ timeout: 10_000 });
  });

  it('polls not at all when the POST succeeded only as the attempt ran out', async () => {
    // The POST is clamped to the whole 20s attempt and takes all of it. Submission landed — the backend
    // is now processing — but there is nothing left to watch it with, so the caller falls back rather
    // than issuing a status request with an abort already armed.
    const api = fakeApi({ submitConsumesItsBound: true });

    const promise = run(api, 20_000);
    await vi.advanceTimersByTimeAsync(20_000);
    const result = await promise;

    expect(api.submitCalls[0]?.config).toEqual({ timeout: 20_000 });
    expect(api.statusCalls).toHaveLength(0);
    expect(result.ok).toBe(false);
    // Not "polling timed out" — no poll ever happened. The cause has to name what actually occurred,
    // since the caller logs it and falls back without surfacing it in the Result.
    if (!result.ok) expect(String((result.cause as Error).message)).toContain('no budget was left to poll');
  });

  it('surfaces the rejection of a POST that hung until its bound fired', async () => {
    // What a blackholed endpoint actually looks like: not an instant rejection, but one that arrives
    // only when the request's own timeout aborts it.
    const aborted = new Error('REQUEST_TIMEOUT');
    const api = fakeApi({ submitConsumesItsBound: true, submitTx: { ok: false, error: aborted } });

    const promise = run(api, 20_000);
    await vi.advanceTimersByTimeAsync(20_000);

    expect(await promise).toEqual({ ok: false, cause: aborted });
    expect(api.statusCalls).toHaveLength(0);
  });
});

describe('runBackendSubmitTx — non-success outcomes', () => {
  it('reports the submit error as the cause when the POST is rejected', async () => {
    const rejected = new Error('backend down');
    const api = fakeApi({ submitTx: { ok: false, error: rejected } });

    const result = await run(api);

    expect(result).toEqual({ ok: false, cause: rejected });
    // A rejected POST must not be followed by polling for something that was never accepted.
    expect(api.statusCalls).toHaveLength(0);
  });

  it('falls back without polling when the POST returns success:false', async () => {
    // `ok` is transport-level only: a 200 can still say the submission was not queued. Polling for a
    // row that will never exist would burn the whole attempt before the fallback got a turn.
    const api = fakeApi({
      submitTx: { ok: true, value: { success: false, data: { message: 'unsupported source chain' } } },
    });

    const result = await run(api);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(String((result.cause as Error).message)).toContain('unsupported source chain');
    expect(api.statusCalls).toHaveLength(0);
  });

  it('carries the last status error as the cause when polling never succeeded', async () => {
    // A statusless transport failure is retryable: the poll spends the attempt and hands back the last
    // error as the cause, which is all the caller logs. The terminal 401/403 case is the next test.
    const unreachable = new Error('ECONNRESET');
    const api = fakeApi({ statusError: unreachable });

    const promise = run(api, 5_000);
    await vi.advanceTimersByTimeAsync(5_000);
    const result = await promise;

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(String((result.cause as Error).message)).toContain('status polling failed');
      expect((result.cause as Error).cause).toBe(unreachable);
    }
    expect(api.statusCalls.length).toBeGreaterThan(1); // retried, unlike the terminal-auth case
  });

  it('stops immediately when the status endpoint rejects the API key', async () => {
    // 401/403 is terminal (issue #389): re-requesting cannot succeed, so the poll hands back at once
    // and the caller proceeds to its client-side fallback instead of burning the whole attempt.
    const rejected = new SodaxError('EXTERNAL_API_ERROR', 'getSubmitTxStatus responded with 401', {
      feature: 'backend',
      context: { api: 'swaps', endpoint: '/swaps/submit-tx/status', status: 401 },
    });
    const api = fakeApi({ statusError: rejected });

    const promise = run(api, 120_000);
    await vi.advanceTimersByTimeAsync(120_000);
    const result = await promise;

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(String((result.cause as Error).message)).toContain('rejected the API key');
      expect((result.cause as Error).cause).toBe(rejected);
    }
    // One read, then out — no waiting out the 120s attempt.
    expect(api.statusCalls).toHaveLength(1);
  });

  it('reports the terminal failure reason as the cause', async () => {
    const api = fakeApi({ statuses: [{ status: 'failed', failureReason: 'hub execution reverted' }] });

    const result = await run(api);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(String((result.cause as Error).message)).toContain('hub execution reverted');
  });

  it('reports a poll timeout as the cause when the attempt runs out', async () => {
    const api = fakeApi({ statuses: [{ status: 'pending' }] });

    const promise = run(api, 5_000);
    await vi.advanceTimersByTimeAsync(5_000);
    const result = await promise;

    expect(result.ok).toBe(false);
    if (!result.ok) expect(String((result.cause as Error).message)).toContain('timed out before reaching executed');
  });

  it('sends nothing at all when the caller left no budget', async () => {
    const api = fakeApi();

    const result = await run(api, 0);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(String((result.cause as Error).message)).toContain('caller timeout');
    expect(api.submitCalls).toHaveLength(0);
    expect(api.statusCalls).toHaveLength(0);
  });

  it('sends nothing and names api.timeout when the service ceiling is non-positive', async () => {
    const api = fakeApi({ getTimeout: 0 });

    const result = await run(api, 120_000);

    // A full attempt budget but an unusable ceiling: the diagnostic must point at the config, not at
    // the caller's `timeout`.
    expect(result.ok).toBe(false);
    if (!result.ok) expect(String((result.cause as Error).message)).toContain('api timeout');
    expect(api.submitCalls).toHaveLength(0);
  });

  it('does not catch — an unexpected throw belongs to the caller that owns the feature context', async () => {
    const api = fakeApi();
    api.submitTx = async () => {
      throw new Error('boom');
    };

    await expect(run(api)).rejects.toThrow('boom');
  });
});
