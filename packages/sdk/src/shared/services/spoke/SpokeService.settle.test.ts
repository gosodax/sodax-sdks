/**
 * Tests for `SpokeService.settle` — the single settlement seam feature services call after a
 * `create*Intent`.
 *
 * What matters here is that the per-chain-family mechanics stay behind one signature: an intent-relay
 * chain verifies then relays, Bitcoin borrow/withdraw relays on demand under a derived poll id, and
 * Tron polls the MPC relay's deposit/withdrawal record without touching the intent relay at all. A
 * regression in this dispatch is invisible in the feature services, which is the point of the seam.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { MpcRelayChainMap, type Hex, type MpcRelayChainKey, type SpokeChainKey } from '@sodax/types';
import { Sodax } from '../../entities/Sodax.js';
import * as IntentRelayApiService from '../intentRelay/IntentRelayApiService.js';

const sodax = new Sodax();
const spoke = sodax.spoke;

const ARBITRUM = '0xa4b1.arbitrum' satisfies SpokeChainKey;
const BITCOIN = 'bitcoin' satisfies SpokeChainKey;
const TRON = 'tron' satisfies SpokeChainKey;

/** Chains that must keep riding the intent relay, whatever the MPC list grows to. */
const INTENT_ONLY: SpokeChainKey[] = [ARBITRUM, BITCOIN];

const SRC_TX = '0xaaaa000000000000000000000000000000000000000000000000000000000001';
const DST_TX = '0xbbbb000000000000000000000000000000000000000000000000000000000002';
const RELAY_DATA = {
  address: '0x1111111111111111111111111111111111111111' as Hex,
  payload: '0xdeadbeef' as Hex,
};

/** Only the fields `settle` reads; the relay returns a much larger packet. */
const packet = (dstTxHash: string) =>
  ({ ok: true as const, value: { dst_tx_hash: dstTxHash } }) as unknown as Awaited<
    ReturnType<typeof IntentRelayApiService.relayTxAndWaitPacket>
  >;

function stubRelay(result = packet(DST_TX)) {
  return vi.spyOn(IntentRelayApiService, 'relayTxAndWaitPacket').mockResolvedValue(result);
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('SpokeService.settle — intent-relay chains', () => {
  it('verifies the source tx, relays it, and returns both hashes', async () => {
    const verify = vi.spyOn(spoke, 'verifyTxHash').mockResolvedValue({ ok: true, value: true });
    const relay = stubRelay();

    const result = await spoke.settle({
      chainKey: ARBITRUM,
      tx: SRC_TX,
      direction: 'inbound',
      relayData: RELAY_DATA,
      timeout: 1_000,
    });

    expect(verify).toHaveBeenCalledWith({ txHash: SRC_TX, chainKey: ARBITRUM });
    expect(relay).toHaveBeenCalledWith(
      expect.objectContaining({ srcTxHash: SRC_TX, data: RELAY_DATA, chainKey: ARBITRUM, timeout: 1_000 }),
    );
    expect(result).toEqual({ ok: true, value: { srcChainTxHash: SRC_TX, dstChainTxHash: DST_TX } });
  });

  it('reports a source tx that never landed as a verification failure, without relaying', async () => {
    const cause = new Error('TRANSACTION_VERIFICATION_FAILED');
    vi.spyOn(spoke, 'verifyTxHash').mockResolvedValue({ ok: false, error: cause });
    const relay = stubRelay();

    const result = await spoke.settle({
      chainKey: ARBITRUM,
      tx: SRC_TX,
      direction: 'inbound',
      relayData: RELAY_DATA,
    });

    expect(relay).not.toHaveBeenCalled();
    expect(result).toEqual({ ok: false, error: { phase: 'verification', cause } });
  });

  it('reports a relay that never delivered as a relay failure', async () => {
    vi.spyOn(spoke, 'verifyTxHash').mockResolvedValue({ ok: true, value: true });
    const cause = new Error('RELAY_TIMEOUT');
    stubRelay({ ok: false, error: cause });

    const result = await spoke.settle({
      chainKey: ARBITRUM,
      tx: SRC_TX,
      direction: 'inbound',
      relayData: RELAY_DATA,
    });

    expect(result).toEqual({ ok: false, error: { phase: 'relay', cause } });
  });

  it('surfaces a thrown relay error as a relay failure rather than rejecting', async () => {
    vi.spyOn(spoke, 'verifyTxHash').mockResolvedValue({ ok: true, value: true });
    const cause = new Error('boom');
    vi.spyOn(IntentRelayApiService, 'relayTxAndWaitPacket').mockRejectedValue(cause);

    const result = await spoke.settle({
      chainKey: ARBITRUM,
      tx: SRC_TX,
      direction: 'inbound',
      relayData: RELAY_DATA,
    });

    expect(result).toEqual({ ok: false, error: { phase: 'relay', cause } });
  });
});

describe('SpokeService.settle — Bitcoin on-demand outbound', () => {
  // Bitcoin borrow/withdraw have no broadcast tx: the "tx" is the signed payload the relay submits.
  const signedPayload = JSON.stringify({ payload_hex: '0xabcdef', signature: 'sig', public_key: 'pk' });

  it('submits the signed payload on demand and reports the derived poll id as the source hash', async () => {
    vi.spyOn(spoke, 'verifyTxHash').mockResolvedValue({ ok: true, value: true });
    const relay = stubRelay();
    const identity = spoke.bitcoin.getOnDemandRelayIdentity(signedPayload);

    const result = await spoke.settle({
      chainKey: BITCOIN,
      tx: signedPayload,
      direction: 'outbound',
      relayData: RELAY_DATA,
    });

    expect(relay).toHaveBeenCalledWith(
      expect.objectContaining({ srcTxHash: 'withdraw', pollTxHash: identity.pollTxHash, data: identity.data }),
    );
    expect(result).toEqual({
      ok: true,
      value: { srcChainTxHash: identity.pollTxHash, dstChainTxHash: DST_TX },
    });
  });

  it('keeps the real spoke tx hash for an inbound Bitcoin deposit', async () => {
    vi.spyOn(spoke, 'verifyTxHash').mockResolvedValue({ ok: true, value: true });
    const relay = stubRelay();

    const result = await spoke.settle({
      chainKey: BITCOIN,
      tx: SRC_TX,
      direction: 'inbound',
      relayData: RELAY_DATA,
    });

    expect(relay).toHaveBeenCalledWith(expect.objectContaining({ srcTxHash: SRC_TX, pollTxHash: undefined }));
    expect(result).toEqual({ ok: true, value: { srcChainTxHash: SRC_TX, dstChainTxHash: DST_TX } });
  });
});

describe('SpokeService.settle — Tron MPC relay', () => {
  const HUB_MINT = '0xcccc000000000000000000000000000000000000000000000000000000000003';
  const RELEASE = '0xdddd000000000000000000000000000000000000000000000000000000000004';
  const TRACKING_ID = '0xeeee000000000000000000000000000000000000000000000000000000000005' as Hex;

  const depositRecord = (txs: Record<string, { chain: string; hash: string; ts: number }>) =>
    // A minimal record: settle reads only `txs`, so the rest of DepositRecord is left out.
    ({ ok: true as const, value: { depositId: 'id', status: 'minted', createdAt: 0, txs } }) as unknown as Awaited<
      ReturnType<typeof spoke.tron.waitForDeposit>
    >;

  const withdrawalRecord = (txs: Record<string, { chain: string; hash: string; ts: number }>) =>
    // A minimal record: settle reads only `txs`, so the rest of WithdrawalRecord is left out.
    ({ ok: true as const, value: { trackingId: TRACKING_ID, status: 'released', txs } }) as unknown as Awaited<
      ReturnType<typeof spoke.tron.waitForWithdrawal>
    >;

  it('polls the deposit record for an inbound deposit and never touches the intent relay', async () => {
    const relay = stubRelay();
    const verify = vi.spyOn(spoke, 'verifyTxHash');
    const waitForDeposit = vi
      .spyOn(spoke.tron, 'waitForDeposit')
      .mockResolvedValue(depositRecord({ hubMint: { chain: 'sonic', hash: HUB_MINT, ts: 0 } }));

    const result = await spoke.settle({
      chainKey: TRON,
      tx: SRC_TX,
      direction: 'inbound',
      relayData: RELAY_DATA,
      timeout: 90_000,
    });

    // The caller's budget governs the wait, not the chain's default polling window.
    expect(waitForDeposit).toHaveBeenCalledWith(SRC_TX, 90_000);
    expect(relay).not.toHaveBeenCalled();
    // The deposit was broadcast and notified by the spoke service; there is nothing left to verify.
    expect(verify).not.toHaveBeenCalled();
    expect(result).toEqual({ ok: true, value: { srcChainTxHash: SRC_TX, dstChainTxHash: HUB_MINT } });
  });

  it('polls the withdrawal record for an outbound borrow/withdraw, keyed by the tracking id', async () => {
    const relay = stubRelay();
    const waitForWithdrawal = vi
      .spyOn(spoke.tron, 'waitForWithdrawal')
      .mockResolvedValue(withdrawalRecord({ release: { chain: 'tron', hash: RELEASE, ts: 0 } }));

    const result = await spoke.settle({
      chainKey: TRON,
      tx: TRACKING_ID,
      direction: 'outbound',
      relayData: RELAY_DATA,
      timeout: 90_000,
    });

    expect(waitForWithdrawal).toHaveBeenCalledWith(TRACKING_ID, 90_000);
    expect(relay).not.toHaveBeenCalled();
    expect(result).toEqual({ ok: true, value: { srcChainTxHash: TRACKING_ID, dstChainTxHash: RELEASE } });
  });

  it('falls back to the source id when the settled record carries no far-leg hash', async () => {
    vi.spyOn(spoke.tron, 'waitForDeposit').mockResolvedValue(depositRecord({}));

    const result = await spoke.settle({
      chainKey: TRON,
      tx: SRC_TX,
      direction: 'inbound',
      relayData: RELAY_DATA,
    });

    expect(result).toEqual({ ok: true, value: { srcChainTxHash: SRC_TX, dstChainTxHash: SRC_TX } });
  });

  it('routes every chain listed as MPC-relay away from the intent relay', async () => {
    // The dispatch is driven by MpcRelayChainMap membership, not by naming Tron — so a chain added
    // to that map (XRP, Aptos) settles through its relay service with no feature-code change.
    const relay = stubRelay();
    vi.spyOn(spoke.tron, 'waitForDeposit').mockResolvedValue(depositRecord({}));

    for (const chainKey of Object.keys(MpcRelayChainMap) as MpcRelayChainKey[]) {
      const result = await spoke.settle({ chainKey, tx: SRC_TX, direction: 'inbound', relayData: RELAY_DATA });
      expect(result.ok).toBe(true);
    }

    expect(relay).not.toHaveBeenCalled();
    expect(INTENT_ONLY.every(key => !(key in MpcRelayChainMap))).toBe(true);
  });

  it('maps an MPC relay failure onto the relay phase', async () => {
    const cause = new Error('mpc-relay: deposit failed');
    vi.spyOn(spoke.tron, 'waitForDeposit').mockResolvedValue({ ok: false, error: cause });

    const result = await spoke.settle({
      chainKey: TRON,
      tx: SRC_TX,
      direction: 'inbound',
      relayData: RELAY_DATA,
    });

    expect(result).toEqual({ ok: false, error: { phase: 'relay', cause } });
  });
});
