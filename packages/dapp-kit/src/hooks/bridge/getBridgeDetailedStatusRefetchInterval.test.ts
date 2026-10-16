import {
  DETAILED_STATUS_NOT_DELIVERED,
  SodaxError,
  type BridgeDetailedStatusError,
  type DetailedBridgeStatus,
  type PacketData,
  type Result,
} from '@sodax/sdk';
import { describe, expect, it } from 'vitest';
import {
  advanceNotFoundStreak,
  INITIAL_NOT_FOUND_STREAK,
  MAX_NOT_FOUND_POLLS,
  STATUS_POLL_MS,
} from '../shared/notFoundStreak.js';
import {
  getBridgeDetailedStatusRefetchInterval,
  isBridgeNotDelivered,
} from './getBridgeDetailedStatusRefetchInterval.js';

/**
 * Guards the polling-stop invariant for `useBridgeDetailedStatus.refetchInterval`: stop on a
 * terminal or abandoned backend record, on any relay packet (always terminal), on a rejected API
 * key, and on an exhausted not-delivered budget — but keep polling through an outage. Tested as a
 * pure function because dapp-kit's vitest runs in the `node` environment.
 */
const KEY_A = 'arb:0xaaa';
const KEY_B = 'arb:0xbbb';

type Read = Result<DetailedBridgeStatus, BridgeDetailedStatusError> | undefined;

const backend = (status: string, abandonedAt?: string): Read => ({
  ok: true,
  value: {
    source: 'backend',
    data: { txHash: '0xaaa', srcChainKey: '0xa4b1.arbitrum', status, processingAttempts: 1, abandonedAt },
  },
});

const packet: PacketData = {
  src_chain_id: 23,
  src_tx_hash: '0xaaa',
  src_address: '0xsrc',
  status: 'executed',
  dst_chain_id: 146,
  conn_sn: 1,
  dst_address: '0xdst',
  dst_tx_hash: '0xdst',
  signatures: [],
  payload: '0x',
};

const relayed: Read = { ok: true, value: { source: 'relay', data: packet } };

const lookupFailed = (context: Record<string, unknown>): Read => ({
  ok: false,
  error: new SodaxError('LOOKUP_FAILED', 'no source could answer', {
    feature: 'bridge',
    context: { phase: 'lookup', method: 'getDetailedStatus', ...context },
  }),
});

const notDelivered = lookupFailed({ reason: DETAILED_STATUS_NOT_DELIVERED });
const outage = lookupFailed({});
const rejectedKey = lookupFailed({ status: 401 });

describe('isBridgeNotDelivered', () => {
  it('counts only the ambiguous relay miss', () => {
    expect(isBridgeNotDelivered(notDelivered)).toBe(true);
    expect(isBridgeNotDelivered(outage)).toBe(false);
    expect(isBridgeNotDelivered(rejectedKey)).toBe(false);
    expect(isBridgeNotDelivered(relayed)).toBe(false);
    expect(isBridgeNotDelivered(backend('relaying'))).toBe(false);
    expect(isBridgeNotDelivered(undefined)).toBe(false);
  });
});

describe('getBridgeDetailedStatusRefetchInterval', () => {
  it('keeps polling an in-flight backend record', () => {
    for (const status of ['pending', 'relaying', 'relayed']) {
      expect(getBridgeDetailedStatusRefetchInterval(backend(status), 0)).toBe(STATUS_POLL_MS);
    }
    expect(getBridgeDetailedStatusRefetchInterval(undefined, 0)).toBe(STATUS_POLL_MS);
  });

  it('stops on the two terminal backend statuses and on an abandoned record', () => {
    expect(getBridgeDetailedStatusRefetchInterval(backend('executed'), 0)).toBe(false);
    expect(getBridgeDetailedStatusRefetchInterval(backend('failed'), 0)).toBe(false);
    expect(getBridgeDetailedStatusRefetchInterval(backend('relayed', '2026-09-18T00:00:00.000Z'), 0)).toBe(false);
  });

  it('stops on a relay packet without waiting for a budget — that arm is terminal on arrival', () => {
    expect(getBridgeDetailedStatusRefetchInterval(relayed, 0)).toBe(false);
  });

  it('stops on a rejected API key, at the first read', () => {
    expect(getBridgeDetailedStatusRefetchInterval(rejectedKey, 0)).toBe(false);
  });

  it('stops a not-delivered read only once the budget is spent', () => {
    expect(getBridgeDetailedStatusRefetchInterval(notDelivered, MAX_NOT_FOUND_POLLS - 1)).toBe(STATUS_POLL_MS);
    expect(getBridgeDetailedStatusRefetchInterval(notDelivered, MAX_NOT_FOUND_POLLS)).toBe(false);
  });

  it('keeps polling an outage forever — that is how the read recovers', () => {
    expect(getBridgeDetailedStatusRefetchInterval(outage, MAX_NOT_FOUND_POLLS)).toBe(STATUS_POLL_MS);
  });
});

describe('the not-delivered budget, driven as the hook drives it', () => {
  /** One query update per read, the way `refetchInterval` advances it. */
  const advance = (reads: Read[], key = KEY_A, from = 1) =>
    reads.reduce(
      (acc, read, i) => advanceNotFoundStreak(acc, key, isBridgeNotDelivered(read), from + i),
      INITIAL_NOT_FOUND_STREAK,
    );

  it('a backend-pending stretch never exhausts the budget', () => {
    // The reset is what makes this safe: pending reads are not misses, so they zero the counter.
    const pending = advance(Array.from({ length: MAX_NOT_FOUND_POLLS + 5 }, () => backend('pending')));
    expect(pending.consecutiveNotFound).toBe(0);
    expect(getBridgeDetailedStatusRefetchInterval(backend('pending'), pending.consecutiveNotFound)).toBe(
      STATUS_POLL_MS,
    );
  });

  it('an outage in the middle resets a run of misses', () => {
    const state = advance([notDelivered, notDelivered, outage, notDelivered]);
    expect(state.consecutiveNotFound).toBe(1);
  });

  it('stops only after MAX_NOT_FOUND_POLLS consecutive misses', () => {
    const state = advance(Array.from({ length: MAX_NOT_FOUND_POLLS }, () => notDelivered));
    expect(state.consecutiveNotFound).toBe(MAX_NOT_FOUND_POLLS);
    expect(getBridgeDetailedStatusRefetchInterval(notDelivered, state.consecutiveNotFound)).toBe(false);
  });

  it('starts a fresh budget for a new source tx', () => {
    const spent = advance(Array.from({ length: MAX_NOT_FOUND_POLLS }, () => notDelivered));
    const next = advanceNotFoundStreak(spent, KEY_B, true, 1);
    expect(next.consecutiveNotFound).toBe(1);
    expect(next.pollKey).toBe(KEY_B);
  });
});
