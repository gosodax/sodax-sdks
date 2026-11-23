/**
 * Tests for the MPC relay's settlement waits.
 *
 * The status ladders are the relay's, not ours: a deposit runs
 * `pending → submitted → attested → minted → swept` and a withdrawal
 * `submitted → burned → attested → released | failed`. What matters here is which rungs the waits
 * treat as terminal — reading one rung too narrowly turns a settled transfer into a timeout.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { ChainKeys, type HttpUrl } from '@sodax/types';
import { IndeterminateOutcomeError, isIndeterminateOutcomeError } from '../../../errors/IndeterminateOutcomeError.js';
import { mapRelayFailure } from '../../../errors/relay-error-mapping.js';
import {
  submitWithdraw,
  getWithdrawal,
  type SubmitWithdrawRequest,
  waitForDeposit,
  waitForHubRelease,
  waitForWithdrawal,
} from './MpcRelayApiService.js';

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

describe('submitWithdraw', () => {
  const request = {
    message: { to: '0x1234', data: '0x', nonce: '7', chainId: '728126428', sender: '0xabcd' },
    signature: '0x1234',
    scheme: 1,
  } satisfies SubmitWithdrawRequest;

  it.each([
    [200, '{'],
    [200, '{}'],
    [200, 'null'],
    [200, '{"accepted":true,"trackingId":42}'],
    [503, '{"accepted":false}'],
  ])('keeps the tracking ID for a %s response with body %s', async (status, body) => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(body, { status })),
    );
    const result = await submitWithdraw(API, request);
    if (result.ok) throw new Error('expected uncertain submission');
    expect(result.error).toBeInstanceOf(IndeterminateOutcomeError);
    expect(result.error).toMatchObject({ trackingId: expect.stringMatching(/^0x[0-9a-f]{64}$/) });
  });

  it('keeps tracking the original withdrawal when the same signed request is rejected on replay', async () => {
    const send = vi.fn<typeof fetch>();
    send.mockRejectedValueOnce(new TypeError('lost reply'));
    send.mockResolvedValueOnce(new Response(null, { status: 400 }));
    vi.stubGlobal('fetch', send);

    const initial = await submitWithdraw(API, request);
    if (initial.ok || !isIndeterminateOutcomeError(initial.error) || !initial.error.trackingId) {
      throw new Error('expected the original tracking ID');
    }
    const trackingId = initial.error.trackingId;
    expect((await submitWithdraw(API, request)).ok).toBe(false);
    expect(send.mock.calls[0]?.[1]?.body).toBe(send.mock.calls[1]?.[1]?.body);
    send.mockResolvedValueOnce(Response.json({ trackingId, status: 'submitted' }));

    expect(await getWithdrawal(API, trackingId)).toMatchObject({
      ok: true,
      value: { trackingId, status: 'submitted' },
    });
    expect(send.mock.calls[2]?.[0]).toBe(`${API}/withdrawal/${trackingId}`);
  });

  it.each([
    [400, 'invalid signature'],
    [200, '{"accepted":false,"error":"invalid signature"}'],
  ])('treats a %s response with body %s as a definite rejection', async (status, body) => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(body, { status })),
    );
    const result = await submitWithdraw(API, request);
    if (result.ok) throw new Error('expected rejection');
    expect(result.error).not.toBeInstanceOf(IndeterminateOutcomeError);
    expect(result.error).toMatchObject({ message: expect.stringContaining('invalid signature') });
  });
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
    // timeout is the only signal a caller gets — in the intent relay's vocabulary, as RELAY_TIMEOUT.
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error).toMatchObject({
      message: 'RELAY_TIMEOUT',
      cause: { message: `mpc-relay: timed out waiting for deposit ${DEPOSIT_ID}` },
    });
    expect(mapRelayFailure(res.error, { feature: 'bridge' }).code).toBe('RELAY_TIMEOUT');
  });

  it('keeps polling a mint whose hub tx is not recorded yet', async () => {
    // The hub mint hash is what settle hands on as the hub tx, so a record without it is not settled.
    stubStatuses([
      { depositId: DEPOSIT_ID, status: 'minted', txs: {} },
      { depositId: DEPOSIT_ID, status: 'minted', txs: { hubMint: { hash: '0xmint' } } },
    ]);

    const res = await waitForDeposit(API, DEPOSIT_ID, { timeout: 1_000, pollIntervalMs: 1 });

    expect(res.ok && res.value.txs.hubMint?.hash).toBe('0xmint');
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

  it('keeps polling a release whose tx is not recorded yet', async () => {
    stubStatuses([
      { trackingId: TRACKING_ID, status: 'released', txs: {} },
      { trackingId: TRACKING_ID, status: 'released', txs: { release: { hash: '0xrelease' } } },
    ]);

    const res = await waitForWithdrawal(API, TRACKING_ID, { timeout: 1_000, pollIntervalMs: 1 });

    expect(res.ok && res.value.txs?.release?.hash).toBe('0xrelease');
  });

  it('ends in RELAY_TIMEOUT when nothing is released in time', async () => {
    stubStatuses([{ trackingId: TRACKING_ID, status: 'attested', txs: {} }]);

    const res = await waitForWithdrawal(API, TRACKING_ID, { timeout: 30, pollIntervalMs: 1 });

    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(mapRelayFailure(res.error, { feature: 'moneyMarket' }).code).toBe('RELAY_TIMEOUT');
  });
});

describe('waitForWithdrawal — until burned', () => {
  // A withdraw-auth paying out off this chain releases nothing here, so it never reaches `released`.
  it('settles once the hub tx is recorded, without waiting for a release', async () => {
    stubStatuses([
      { trackingId: TRACKING_ID, status: 'submitted', txs: {} },
      { trackingId: TRACKING_ID, status: 'burned', txs: { burn: { hash: '0xhub' } } },
    ]);

    const res = await waitForWithdrawal(API, TRACKING_ID, { timeout: 1_000, pollIntervalMs: 1, until: 'burned' });

    expect(res.ok && res.value.txs?.burn?.hash).toBe('0xhub');
  });

  it('still fails on a terminal `failed`', async () => {
    stubStatuses([{ trackingId: TRACKING_ID, status: 'failed', error: 'rejected', txs: {} }]);

    const res = await waitForWithdrawal(API, TRACKING_ID, { timeout: 1_000, pollIntervalMs: 1, until: 'burned' });

    expect(res.ok).toBe(false);
  });
});

describe('waitForHubRelease', () => {
  const RELEASE = { dstChainKey: ChainKeys.TRON_MAINNET, hubChainId: '146', hubTxHash: '0xABCDEF', logIndex: 3 };

  it('reads the release by its withdrawal id, with the hash lowercased as the relay keys it', async () => {
    stubStatuses([
      { depositId: 'id', status: 'pending', txs: {} },
      { depositId: 'id', status: 'pending', txs: { release: { hash: 'TronPayout' } } },
    ]);

    const res = await waitForHubRelease(API, RELEASE, { timeout: 1_000, pollIntervalMs: 1 });

    expect(vi.mocked(fetch).mock.calls[0]?.[0]).toBe(`${API}/deposit/146-0xabcdef-3`);
    // `status` follows the deposit ladder and never names a release; the recorded payout is the signal.
    expect(res.ok && res.value.txs?.release?.hash).toBe('TronPayout');
  });

  it('ends in RELAY_TIMEOUT when the release is never recorded', async () => {
    stubStatuses([{ depositId: 'id', status: 'submitted', txs: {} }]);

    const res = await waitForHubRelease(API, RELEASE, { timeout: 30, pollIntervalMs: 1 });

    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(mapRelayFailure(res.error, { feature: 'moneyMarket' }).code).toBe('RELAY_TIMEOUT');
  });
});

describe('MPC wait timeout normalization', () => {
  it.each(['deposit', 'release', 'withdrawal'] as const)('uses the default budget for a NaN %s timeout', async kind => {
    vi.useFakeTimers();
    try {
      stubStatuses([{ depositId: DEPOSIT_ID, trackingId: TRACKING_ID, status: 'submitted', txs: {} }]);
      const options = { timeout: Number.NaN, pollIntervalMs: Number.NaN };
      const result =
        kind === 'deposit'
          ? waitForDeposit(API, DEPOSIT_ID, options)
          : kind === 'withdrawal'
            ? waitForWithdrawal(API, TRACKING_ID, options)
            : waitForHubRelease(
                API,
                { dstChainKey: ChainKeys.TRON_MAINNET, hubChainId: '146', hubTxHash: '0xfill', logIndex: 0 },
                options,
              );
      let settled = false;
      void result.then(() => {
        settled = true;
      });
      await vi.advanceTimersByTimeAsync(299_999);
      expect(settled).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      expect(settled).toBe(true);
      const res = await result;
      expect(res.ok).toBe(false);
      if (res.ok) return;
      expect(res.error).toMatchObject({ message: 'RELAY_TIMEOUT' });
    } finally {
      vi.useRealTimers();
    }
  });
});
