/**
 * Tests for the MPC relay's settlement waits.
 *
 * The status ladders are the relay's, not ours: a deposit runs
 * `pending → submitted → attested → minted → swept` and a withdrawal
 * `submitted → burned → attested → released | failed`. What matters here is which rungs the waits
 * treat as terminal — reading one rung too narrowly turns a settled transfer into a timeout.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import type { HttpUrl } from '@sodax/types';
import { waitForDeposit, waitForWithdrawal } from './MpcRelayApiService.js';

const API = 'https://relay.example' as HttpUrl;
const DEPOSIT_ID = '728126428-abc-0';
const TRACKING_ID = '0xtracking';

/** Answers each poll with the next status in the list, repeating the last one. */
function stubStatuses(bodies: Record<string, unknown>[]) {
  let i = 0;
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => {
      const body = bodies[Math.min(i++, bodies.length - 1)];
      // Only `ok` and `text()` are read, so a partial stands in for the full fetch Response.
      return { ok: true, text: async () => JSON.stringify(body) } as unknown as Response;
    }),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('waitForDeposit', () => {
  it('settles on `minted`', async () => {
    stubStatuses([{ depositId: DEPOSIT_ID, status: 'minted', txs: { hubMint: { hash: '0xmint' } } }]);

    const res = await waitForDeposit(API, DEPOSIT_ID, { timeout: 1_000, pollIntervalMs: 1 });

    expect(res.ok && res.value.status).toBe('minted');
  });

  it('settles on `swept`, which is one rung PAST minted', async () => {
    // A sweep that beats the first poll must not read as "still in flight" — the mint already landed.
    stubStatuses([{ depositId: DEPOSIT_ID, status: 'swept', txs: { hubMint: { hash: '0xmint' } } }]);

    const res = await waitForDeposit(API, DEPOSIT_ID, { timeout: 1_000, pollIntervalMs: 1 });

    expect(res.ok).toBe(true);
  });

  it('keeps polling through the intermediate rungs and times out if none is terminal', async () => {
    stubStatuses([{ depositId: DEPOSIT_ID, status: 'pending', txs: {} }]);

    const res = await waitForDeposit(API, DEPOSIT_ID, { timeout: 30, pollIntervalMs: 1 });

    // The relay has no `failed` status for deposits: a dropped deposit stays `pending`, so a
    // timeout is the only signal a caller gets.
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(String(res.error)).toMatch(/timed out/);
  });
});

describe('waitForWithdrawal', () => {
  it('settles on `released` after passing through `burned`', async () => {
    stubStatuses([
      { trackingId: TRACKING_ID, status: 'burned', txs: {} },
      { trackingId: TRACKING_ID, status: 'released', txs: { release: { hash: '0xrelease' } } },
    ]);

    const res = await waitForWithdrawal(API, TRACKING_ID, { timeout: 1_000, pollIntervalMs: 1 });

    expect(res.ok && res.value.status).toBe('released');
  });

  it('surfaces the relay reason on a terminal `failed`', async () => {
    stubStatuses([{ trackingId: TRACKING_ID, status: 'failed', error: 'bad signature', txs: {} }]);

    const res = await waitForWithdrawal(API, TRACKING_ID, { timeout: 1_000, pollIntervalMs: 1 });

    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(String(res.error)).toContain('bad signature');
  });
});
