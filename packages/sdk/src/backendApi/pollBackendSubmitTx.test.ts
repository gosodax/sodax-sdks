/**
 * Unit tests for the shared backend submit-tx poll loop.
 *
 * Focus: the per-request timeout override. `makeRequest` resolves
 * `overrideConfig.timeout ?? config.timeout ?? DEFAULT_BACKEND_API_TIMEOUT`, so an override REPLACES the
 * service value rather than lowering it — handing it the raw remaining attempt budget raises the bound
 * whenever that budget exceeds the service default, and one stalled request then consumes the entire
 * attempt instead of retrying. The override must therefore clamp in both directions.
 *
 * The loop is bounded by the backend attempt alone; the client-side fallback holds its own fresh
 * `timeout`, so nothing here is held back for it.
 *
 * Each test resolves `getStatus` with the terminal status on the first call, so the loop returns before
 * its first sleep; fake timers only pin `Date.now()` so the expected budgets are exact.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Result } from '@sodax/types';
import { pollBackendSubmitTx, type BackendSubmitTxStatusEnvelope } from './pollBackendSubmitTx.js';
import { createSubmitTxAttempt } from './submitTxAttempt.js';
import type { RequestOverrideConfig } from './api-utils.js';

const SERVICE_TIMEOUT_MS = 30_000;

type Envelope = BackendSubmitTxStatusEnvelope<{ dstIntentTxHash: string }>;

/** `getStatus` double that records each per-call override and reports terminal success immediately. */
function executedOnFirstCall(): {
  getStatus: (override?: RequestOverrideConfig) => Promise<Result<{ data: Envelope }>>;
  overrides: (RequestOverrideConfig | undefined)[];
} {
  const overrides: (RequestOverrideConfig | undefined)[] = [];
  return {
    overrides,
    getStatus: async override => {
      overrides.push(override);
      return { ok: true, value: { data: { status: 'executed', result: { dstIntentTxHash: '0xDST' } } } };
    },
  };
}

/** `timeoutMs` is the caller's per-attempt budget; the attempt opens at the current (faked) clock. */
const poll = (
  timeoutMs: number,
  getStatus: ReturnType<typeof executedOnFirstCall>['getStatus'],
  requestTimeoutMs = SERVICE_TIMEOUT_MS,
) =>
  pollBackendSubmitTx({
    attempt: createSubmitTxAttempt(timeoutMs),
    terminalStatus: 'executed',
    getStatus,
    onExecuted: result => result?.dstIntentTxHash,
    requestTimeoutMs,
  });

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(0);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('pollBackendSubmitTx — per-request timeout override', () => {
  it('clamps to the service timeout or the remaining attempt budget, whichever is smaller', async () => {
    const large = executedOnFirstCall();
    // Default budget: the whole 120_000 belongs to this attempt, well above the 30s service default.
    const result = await poll(120_000, large.getStatus);
    expect(result).toEqual({ ok: true, value: '0xDST' });
    expect(large.overrides).toEqual([{ timeout: SERVICE_TIMEOUT_MS }]);

    const small = executedOnFirstCall();
    await poll(15_000, small.getStatus);
    expect(small.overrides).toEqual([{ timeout: 15_000 }]);
  });
});

describe('pollBackendSubmitTx — terminal states', () => {
  it('keeps polling through a transient !ok request and an executed status whose result is not yet populated', async () => {
    const results: Result<{ data: Envelope }>[] = [
      { ok: false, error: new Error('502') },
      { ok: true, value: { data: { status: 'executed' } } },
      { ok: true, value: { data: { status: 'executed', result: { dstIntentTxHash: '0xDST' } } } },
    ];
    const getStatus = async (): Promise<Result<{ data: Envelope }>> =>
      results.shift() ?? { ok: false, error: new Error('exhausted') };

    const promise = poll(120_000, getStatus);
    await vi.advanceTimersByTimeAsync(3_000);

    expect(await promise).toEqual({ ok: true, value: '0xDST' });
  });

  it('exits on a terminal failed status, or on abandonedAt even while non-terminal, surfacing the failure reason', async () => {
    const failed = async (): Promise<Result<{ data: Envelope }>> => ({
      ok: true,
      value: { data: { status: 'failed', failureReason: 'hub execution reverted' } },
    });
    const failedResult = await poll(120_000, failed);
    expect(failedResult.ok).toBe(false);
    if (!failedResult.ok) expect(failedResult.cause.message).toBe('backend submit-tx failed: hub execution reverted');

    const abandoned = async (): Promise<Result<{ data: Envelope }>> => ({
      ok: true,
      value: { data: { status: 'relaying', abandonedAt: '2026-08-04T00:00:00Z', failureReason: 'budget exhausted' } },
    });
    const abandonedResult = await poll(120_000, abandoned);
    expect(abandonedResult.ok).toBe(false);
    if (!abandonedResult.ok) expect(abandonedResult.cause.message).toContain('budget exhausted');
  });
});

describe('pollBackendSubmitTx — budget boundaries', () => {
  it('polls the whole attempt but never past it', async () => {
    const calledAt: number[] = [];
    const getStatus = async (): Promise<Result<{ data: Envelope }>> => {
      calledAt.push(Date.now());
      return { ok: true, value: { data: { status: 'pending' } } };
    };

    const promise = poll(120_000, getStatus);
    await vi.advanceTimersByTimeAsync(120_000);
    const result = await promise;

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.cause.message).toContain('timed out before reaching executed');
    // No reserve is held back — the fallback has its own budget — but nothing runs past the attempt.
    expect(Math.max(...calledAt)).toBeLessThan(120_000);
    expect(Math.max(...calledAt)).toBeGreaterThan(100_000);
  });

  it('never issues a request with no budget, and stops instead of sleeping out the rest of the attempt', async () => {
    const calledAt: number[] = [];
    const overrides: (RequestOverrideConfig | undefined)[] = [];
    const getStatus = async (override?: RequestOverrideConfig): Promise<Result<{ data: Envelope }>> => {
      calledAt.push(Date.now());
      overrides.push(override);
      return { ok: true, value: { data: { status: 'pending' } } };
    };

    // 2_500ms budget on the default 1_000ms interval: requests at 0, 1_000 and 2_000, each still bounded
    // by what the attempt has left. After the third, 500ms remains — less than one interval, so sleeping
    // it out could only be followed by a null bound. The loop must give up at 2_000 rather than spend
    // that 500ms as dead wait standing between the caller and the client-side fallback.
    let resolvedAt = -1;
    const promise = poll(2_500, getStatus).then(r => {
      resolvedAt = Date.now();
      return r;
    });
    await vi.advanceTimersByTimeAsync(2_500);
    const result = await promise;

    expect(result.ok).toBe(false);
    expect(calledAt).toEqual([0, 1_000, 2_000]);
    // Every request got a positive budget: a zero override would arm `makeRequest`'s abort at 0ms,
    // sending a request only to kill it.
    expect(overrides.every(o => (o?.timeout ?? 0) > 0)).toBe(true);
    // The loop hands control back at 2_000, not 2_500. No request is skipped — only the sleep that
    // could not have been followed by one.
    expect(resolvedAt).toBe(2_000);
  });

  it('issues no request when the attempt has no budget, including when it expires between the poll decision and the request bound', async () => {
    let calls = 0;
    const getStatus = async (): Promise<Result<{ data: Envelope }>> => {
      calls += 1;
      return { ok: true, value: { data: { status: 'executed', result: { dstIntentTxHash: '0xDST' } } } };
    };

    expect((await poll(0, getStatus)).ok).toBe(false);

    // The deadline passing between two readings of the clock: `remaining()` still reports budget, but
    // the bound computed a moment later is already gone. The loop must decide from the SAME value it
    // would send — testing `remaining()` first and deriving the timeout afterwards sends the request
    // with `setTimeout(abort, 0)` armed, so it dies on arrival.
    const expiredMidCheck = {
      remaining: () => 5_000,
      requestTimeout: () => null,
    };
    const result = await pollBackendSubmitTx({
      attempt: expiredMidCheck,
      terminalStatus: 'executed',
      getStatus,
      onExecuted: (r: { dstIntentTxHash: string } | undefined) => r?.dstIntentTxHash,
      requestTimeoutMs: SERVICE_TIMEOUT_MS,
    });

    expect(calls).toBe(0);
    expect(result.ok).toBe(false);
  });

  it('stops polling as soon as the request bound runs out, even with sleep budget left', async () => {
    const overrides: (RequestOverrideConfig | undefined)[] = [];
    const getStatus = async (override?: RequestOverrideConfig): Promise<Result<{ data: Envelope }>> => {
      overrides.push(override);
      return { ok: true, value: { data: { status: 'pending' } } };
    };
    // Budget for exactly one request, then nothing: `remaining()` still returns a positive number the
    // sleep clamp would accept, so only the recomputed bound can end the loop.
    let calls = 0;
    const oneShot = {
      remaining: () => 5_000,
      requestTimeout: () => (calls++ === 0 ? 5_000 : null),
    };

    const promise = pollBackendSubmitTx({
      attempt: oneShot,
      terminalStatus: 'executed',
      getStatus,
      onExecuted: (r: { dstIntentTxHash: string } | undefined) => r?.dstIntentTxHash,
      requestTimeoutMs: SERVICE_TIMEOUT_MS,
    });
    await vi.advanceTimersByTimeAsync(5_000);

    expect((await promise).ok).toBe(false);
    expect(overrides).toEqual([{ timeout: 5_000 }]);
  });
});
