import { SodaxError, type BridgeSubmitTxStatusDataV2 } from '@sodax/sdk';
import { describe, expect, it } from 'vitest';
import {
  BRIDGE_SUBMIT_TX_STATUS_POLL_MS,
  getBridgeSubmitTxStatusRefetchInterval,
} from './getBridgeSubmitTxStatusRefetchInterval.js';

/**
 * Guards the polling-stop invariant for `useBridgeApiSubmitTxStatus.refetchInterval`: keep polling
 * a live record, stop on a terminal or abandoned one, and stop on a rejected API key. Tested as a
 * pure function because dapp-kit's vitest runs in the `node` environment.
 */
const record = (data: Partial<BridgeSubmitTxStatusDataV2>): BridgeSubmitTxStatusDataV2 => ({
  txHash: '0xabc',
  srcChainKey: '0xa4b1.arbitrum',
  status: 'pending',
  processingAttempts: 1,
  ...data,
});

/** A backend failure as `BridgeApiService` surfaces it: the HTTP status lifted onto `context`. */
const apiError = (status?: number): SodaxError =>
  new SodaxError('EXTERNAL_API_ERROR', `responded with ${status}`, {
    feature: 'backend',
    context: { api: 'bridge', endpoint: '/bridge/submit-tx/status', status },
  });

describe('getBridgeSubmitTxStatusRefetchInterval', () => {
  it('polls at the 1s cadence the docs and skills advertise', () => {
    expect(BRIDGE_SUBMIT_TX_STATUS_POLL_MS).toBe(1000);
  });

  it('keeps polling every in-flight status', () => {
    for (const status of ['pending', 'relaying', 'relayed']) {
      expect(getBridgeSubmitTxStatusRefetchInterval(undefined, record({ status }))).toBe(
        BRIDGE_SUBMIT_TX_STATUS_POLL_MS,
      );
    }
  });

  it('keeps polling before the first response has landed', () => {
    expect(getBridgeSubmitTxStatusRefetchInterval(undefined, undefined)).toBe(BRIDGE_SUBMIT_TX_STATUS_POLL_MS);
  });

  it('stops on the two terminal statuses', () => {
    expect(getBridgeSubmitTxStatusRefetchInterval(undefined, record({ status: 'executed' }))).toBe(false);
    expect(getBridgeSubmitTxStatusRefetchInterval(undefined, record({ status: 'failed' }))).toBe(false);
  });

  it('stops on an abandoned record even while its status is still non-terminal', () => {
    // The backend gave up mid-flight; the record never self-heals, so polling it is dead weight.
    expect(
      getBridgeSubmitTxStatusRefetchInterval(
        undefined,
        record({ status: 'relayed', abandonedAt: '2026-09-17T00:00:00.000Z' }),
      ),
    ).toBe(false);
  });

  it('stops on a terminal API-key rejection — the defect `retry` alone cannot fix', () => {
    for (const status of [401, 403]) {
      expect(getBridgeSubmitTxStatusRefetchInterval(apiError(status), undefined)).toBe(false);
    }
  });

  it("keeps polling the apiguard's transient 503 and other non-auth failures", () => {
    // 503 is verification being down, not a rejected key — the SDK excludes it deliberately.
    for (const status of [408, 429, 500, 502, 503, 504]) {
      expect(getBridgeSubmitTxStatusRefetchInterval(apiError(status), undefined)).toBe(BRIDGE_SUBMIT_TX_STATUS_POLL_MS);
    }
    expect(getBridgeSubmitTxStatusRefetchInterval(new Error('ECONNRESET'), undefined)).toBe(
      BRIDGE_SUBMIT_TX_STATUS_POLL_MS,
    );
  });

  it('stops on an auth failure even when a live record is still cached', () => {
    // Order matters: the key was rejected on a later poll, so the stale in-flight record must not
    // keep the interval alive.
    expect(getBridgeSubmitTxStatusRefetchInterval(apiError(401), record({ status: 'relaying' }))).toBe(false);
  });
});
