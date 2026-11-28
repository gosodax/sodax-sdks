/**
 * Unit tests for the backend submit-tx attempt budget.
 *
 * It owns one formula — `min(remaining, serviceTimeout)`, floored at 0 — used by both the initial POST
 * and every status request. Clamping DOWN keeps a request inside the attempt; clamping UP to the service
 * timeout matters because `makeRequest` resolves `overrideConfig.timeout ?? config.timeout`, so an
 * override replaces the service value rather than lowering it.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSubmitTxAttempt } from './submitTxAttempt.js';
import { resolveTimeoutMs } from '../shared/utils/resolveTimeoutMs.js';

const SERVICE_TIMEOUT_MS = 30_000;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(0);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('createSubmitTxAttempt', () => {
  it('gives the attempt the caller timeout in full, counting down and flooring at zero once spent', async () => {
    const attempt = createSubmitTxAttempt(30_000);

    // The client-side fallback has its own fresh budget, so nothing is withheld here.
    expect(attempt.remaining()).toBe(30_000);
    await vi.advanceTimersByTimeAsync(20_000);
    expect(attempt.remaining()).toBe(10_000);
    await vi.advanceTimersByTimeAsync(15_000);
    expect(attempt.remaining()).toBe(0);
  });

  it('treats a non-positive or non-finite caller timeout as no budget at all', () => {
    // Belt-and-braces: the services resolve before constructing, but a NaN deadline here would make
    // `remaining()` NaN and `requestTimeout()` null forever, and an Infinite one would never expire.
    for (const value of [0, -5_000, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(createSubmitTxAttempt(value).remaining()).toBe(0);
    }
  });
});

describe('SubmitTxAttempt.requestTimeout', () => {
  it('clamps down to the service timeout or the remaining budget, whichever is smaller', async () => {
    // A raw remainder here would REPLACE the service default with 120s, letting one stalled request
    // consume the whole attempt instead of retrying.
    expect(createSubmitTxAttempt(120_000).requestTimeout(SERVICE_TIMEOUT_MS)).toBe(SERVICE_TIMEOUT_MS);

    const attempt = createSubmitTxAttempt(30_000);
    await vi.advanceTimersByTimeAsync(25_000);
    expect(attempt.requestTimeout(SERVICE_TIMEOUT_MS)).toBe(5_000);
  });

  it('returns null rather than a zero timeout once the attempt is spent (on the exact boundary) or the service timeout is non-positive', async () => {
    const attempt = createSubmitTxAttempt(10_000);

    await vi.advanceTimersByTimeAsync(10_000);

    // A 0 here would reach `makeRequest` as `setTimeout(abort, 0)` — a request sent only to be killed.
    // `null` is unusable as a `RequestOverrideConfig.timeout`, so the compiler forces the caller to
    // check the single computed value instead of re-deriving it after a separate guard.
    expect(attempt.remaining()).toBe(0);
    expect(attempt.requestTimeout(SERVICE_TIMEOUT_MS)).toBeNull();

    expect(createSubmitTxAttempt(120_000).requestTimeout(0)).toBeNull();
    expect(createSubmitTxAttempt(120_000).requestTimeout(-1)).toBeNull();
  });
});

describe('resolveTimeoutMs', () => {
  const FALLBACK = 120_000;

  it('passes a finite caller timeout through, including zero, and floors a negative one at zero', () => {
    expect(resolveTimeoutMs(30_000, FALLBACK)).toBe(30_000);
    expect(resolveTimeoutMs(0, FALLBACK)).toBe(0);
    expect(resolveTimeoutMs(-5_000, FALLBACK)).toBe(0);
  });

  it('defaults when the caller timeout is omitted or non-finite', () => {
    // `?? fallback` does NOT catch NaN / ±Infinity — only null/undefined. Left unresolved, NaN survives
    // every Math.max/Math.min and lands in `while (elapsed < NaN)`, which is false immediately: an instant
    // RELAY_TIMEOUT on a tx already broadcast. Infinity is the mirror case, a poll loop with no exit.
    for (const value of [undefined, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      expect(resolveTimeoutMs(value, FALLBACK)).toBe(FALLBACK);
    }
  });
});
