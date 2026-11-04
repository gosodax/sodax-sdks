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
import { pad, toEventSelector, toHex, type TransactionReceipt } from 'viem';
import { Sodax } from '../../entities/Sodax.js';
import * as IntentRelayApiService from '../intentRelay/IntentRelayApiService.js';
import type { HubRelease } from '../mpcRelay/MpcRelayApiService.js';

const sodax = new Sodax();
const spoke = sodax.spoke;

const ARBITRUM = '0xa4b1.arbitrum' satisfies SpokeChainKey;
const BITCOIN = 'bitcoin' satisfies SpokeChainKey;
const TRON = 'tron' satisfies SpokeChainKey;
const XRP = 'xrp' satisfies SpokeChainKey;

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

    expect(waitForWithdrawal).toHaveBeenCalledWith(TRACKING_ID, 90_000, 'released');
    expect(relay).not.toHaveBeenCalled();
    // A withdraw-auth has no Tron tx: the tracking id must not pose as one.
    expect(result).toEqual({ ok: true, value: { trackingId: TRACKING_ID, dstChainTxHash: RELEASE } });
  });

  // Callers hand `dstChainTxHash` on as the hub (or release) tx, so the source id must never stand in for it.
  it('reports a deposit record without its hub mint tx as a relay failure', async () => {
    vi.spyOn(spoke.tron, 'waitForDeposit').mockResolvedValue(depositRecord({}));

    const result = await spoke.settle({ chainKey: TRON, tx: SRC_TX, direction: 'inbound', relayData: RELAY_DATA });

    expect(result).toEqual({
      ok: false,
      error: { phase: 'relay', cause: new Error(`mpc-relay: deposit ${SRC_TX} settled without a hub mint tx`) },
    });
  });

  it('reports a withdrawal record without its release tx as a relay failure', async () => {
    vi.spyOn(spoke.tron, 'waitForWithdrawal').mockResolvedValue(withdrawalRecord({}));

    const result = await spoke.settle({
      chainKey: TRON,
      tx: TRACKING_ID,
      direction: 'outbound',
      relayData: RELAY_DATA,
    });

    expect(result).toEqual({
      ok: false,
      error: {
        phase: 'relay',
        cause: new Error(`mpc-relay: withdrawal ${TRACKING_ID} settled without a release tx`),
      },
    });
  });

  it('routes every chain listed as MPC-relay away from the intent relay', async () => {
    // The dispatch is driven by MpcRelayChainMap membership, not by naming Tron — so a chain added
    // to that map settles through its relay service with no feature-code change. Adding a chain to
    // the map without a service here fails this test rather than silently hitting the live relay.
    const services: Record<MpcRelayChainKey, { waitForDeposit: (tx: string, timeout?: number) => unknown }> = {
      tron: spoke.tron,
      xrp: spoke.xrp,
      monad: spoke.monad,
      ton: spoke.ton,
      zcash: spoke.zcash,
    };
    const relay = stubRelay();
    for (const service of Object.values(services)) {
      vi.spyOn(service, 'waitForDeposit').mockResolvedValue(
        depositRecord({ hubMint: { chain: 'sonic', hash: HUB_MINT, ts: 0 } }),
      );
    }

    for (const chainKey of Object.keys(MpcRelayChainMap) as MpcRelayChainKey[]) {
      expect(services[chainKey], `no MPC relay service wired for ${chainKey}`).toBeDefined();
      const result = await spoke.settle({ chainKey, tx: SRC_TX, direction: 'inbound', relayData: RELAY_DATA });
      expect(result.ok, `${chainKey} did not settle through its MPC relay service`).toBe(true);
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

describe('SpokeService.settle — XRP MPC relay', () => {
  // XRPL rides the same MPC relay as Tron and differs only in the withdraw-auth scheme, which
  // `settle` never sees. What is worth pinning here is the DISPATCH: `getMpcRelayService` is a
  // switch on chain type, so a chain can sit in `MpcRelayChainMap` and still have no service —
  // which throws at settlement time, after the deposit has already landed on ledger.
  const HUB_MINT = '0xcccc000000000000000000000000000000000000000000000000000000000013';
  const RELEASE = '0xdddd000000000000000000000000000000000000000000000000000000000014';
  const TRACKING_ID = '0xeeee000000000000000000000000000000000000000000000000000000000015' as Hex;

  const depositRecord = (txs: Record<string, { chain: string; hash: string; ts: number }>) =>
    // A minimal record: settle reads only `txs`, so the rest of DepositRecord is left out.
    ({ ok: true as const, value: { depositId: 'id', status: 'minted', createdAt: 0, txs } }) as unknown as Awaited<
      ReturnType<typeof spoke.xrp.waitForDeposit>
    >;

  const withdrawalRecord = (txs: Record<string, { chain: string; hash: string; ts: number }>) =>
    // A minimal record: settle reads only `txs`, so the rest of WithdrawalRecord is left out.
    ({ ok: true as const, value: { trackingId: TRACKING_ID, status: 'released', txs } }) as unknown as Awaited<
      ReturnType<typeof spoke.xrp.waitForWithdrawal>
    >;

  it('polls the XRPL deposit record for an inbound deposit and never touches the intent relay', async () => {
    const relay = stubRelay();
    const verify = vi.spyOn(spoke, 'verifyTxHash');
    const waitForDeposit = vi
      .spyOn(spoke.xrp, 'waitForDeposit')
      .mockResolvedValue(depositRecord({ hubMint: { chain: 'sonic', hash: HUB_MINT, ts: 0 } }));

    const result = await spoke.settle({
      chainKey: XRP,
      tx: SRC_TX,
      direction: 'inbound',
      relayData: RELAY_DATA,
      timeout: 90_000,
    });

    expect(waitForDeposit).toHaveBeenCalledWith(SRC_TX, 90_000);
    expect(relay).not.toHaveBeenCalled();
    // The Payment was submitted and notified by the spoke service; there is nothing left to verify.
    expect(verify).not.toHaveBeenCalled();
    expect(result).toEqual({ ok: true, value: { srcChainTxHash: SRC_TX, dstChainTxHash: HUB_MINT } });
  });

  it('polls the withdrawal record for an outbound borrow/withdraw, keyed by the tracking id', async () => {
    const relay = stubRelay();
    const waitForWithdrawal = vi
      .spyOn(spoke.xrp, 'waitForWithdrawal')
      .mockResolvedValue(withdrawalRecord({ release: { chain: 'xrp', hash: RELEASE, ts: 0 } }));

    const result = await spoke.settle({
      chainKey: XRP,
      tx: TRACKING_ID,
      direction: 'outbound',
      relayData: RELAY_DATA,
      timeout: 90_000,
    });

    expect(waitForWithdrawal).toHaveBeenCalledWith(TRACKING_ID, 90_000, 'released');
    expect(relay).not.toHaveBeenCalled();
    expect(result).toEqual({ ok: true, value: { trackingId: TRACKING_ID, dstChainTxHash: RELEASE } });
  });

  it('maps an MPC relay failure onto the relay phase rather than throwing', async () => {
    const cause = new Error('mpc-relay: deposit failed');
    vi.spyOn(spoke.xrp, 'waitForDeposit').mockResolvedValue({ ok: false, error: cause });

    const result = await spoke.settle({ chainKey: XRP, tx: SRC_TX, direction: 'inbound', relayData: RELAY_DATA });

    expect(result).toEqual({ ok: false, error: { phase: 'relay', cause } });
  });
});

/**
 * Each leg is driven by the relay of the spoke on it: Tron legs by the MPC relay, every other spoke's by
 * the intent relay. Neither relay watches the hub, so a hub tx that no relay delivered itself — the
 * user's own, or one the MPC relay produced — has its outbound leg driven from here.
 */
describe('SpokeService.settle — destination legs', () => {
  const HUB_TX = '0x9999000000000000000000000000000000000000000000000000000000000009' as Hex;
  const PAYOUT = '0x7777000000000000000000000000000000000000000000000000000000000007';
  const TRACKING_ID = '0xeeee000000000000000000000000000000000000000000000000000000000005' as Hex;
  const SONIC = sodax.hubProvider.chainConfig.chain.key;
  const ASSET_MANAGER = sodax.hubProvider.chainConfig.addresses.assetManager;
  const BRIDGE_REQUEST = toEventSelector('BridgeRequest(uint256,bytes,bytes)');
  const chainTopic = (chainId: bigint) => pad(toHex(chainId), { size: 32 });
  const TRON_TOPIC = chainTopic(MpcRelayChainMap[TRON].chainId);

  const bridgeRequest = (logIndex: number, dstTopic: Hex = TRON_TOPIC, address: string = ASSET_MANAGER) => ({
    address,
    logIndex,
    topics: [BRIDGE_REQUEST, dstTopic],
  });

  function stubHubReceipt(logs: ReturnType<typeof bridgeRequest>[], status = 'success') {
    return (
      vi
        .spyOn(sodax.hubProvider.publicClient, 'waitForTransactionReceipt')
        // Only `status` and `logs` are read; a full receipt carries block data the test has no use for.
        .mockResolvedValue({ status, logs } as unknown as TransactionReceipt)
    );
  }

  function stubRelease() {
    vi.spyOn(spoke.tron, 'submitHubRelease').mockResolvedValue({ ok: true, value: undefined });
    return vi.spyOn(spoke.tron, 'waitForHubRelease').mockResolvedValue({
      ok: true,
      value: {
        depositId: 'id',
        status: 'pending',
        createdAt: 0,
        txs: { release: { chain: 'tron', hash: PAYOUT, ts: 0 } },
      },
    });
  }

  it('releases a hub tx to Tron through the MPC relay, keyed by its BridgeRequest log', async () => {
    const relay = stubRelay();
    stubHubReceipt([bridgeRequest(1, chainTopic(42161n)), bridgeRequest(4)]);
    const release = stubRelease();

    const result = await spoke.settle({
      chainKey: SONIC,
      tx: HUB_TX,
      direction: 'outbound',
      relayData: RELAY_DATA,
      timeout: 1_000,
      dstChainKey: TRON,
    });

    const ref = { dstChainKey: TRON, hubChainId: '146', hubTxHash: HUB_TX, logIndex: 4 };
    expect(spoke.tron.submitHubRelease).toHaveBeenCalledWith(ref);
    expect(release).toHaveBeenCalledWith(ref, 1_000);
    expect(relay).not.toHaveBeenCalled();
    expect(result).toEqual({ ok: true, value: { srcChainTxHash: HUB_TX, dstChainTxHash: PAYOUT } });
  });

  it('releases the intent relay hub delivery to Tron, keeping the spoke tx as the source', async () => {
    vi.spyOn(spoke, 'verifyTxHash').mockResolvedValue({ ok: true, value: true });
    stubRelay(packet(HUB_TX));
    const receipt = stubHubReceipt([bridgeRequest(0)]);
    const release = stubRelease();

    const result = await spoke.settle({
      chainKey: ARBITRUM,
      tx: SRC_TX,
      direction: 'outbound',
      relayData: RELAY_DATA,
      dstChainKey: TRON,
    });

    expect(receipt).toHaveBeenCalledWith({ hash: HUB_TX });
    expect(release).toHaveBeenCalledWith(expect.objectContaining({ hubTxHash: HUB_TX, logIndex: 0 }), undefined);
    expect(result).toEqual({ ok: true, value: { srcChainTxHash: SRC_TX, dstChainTxHash: PAYOUT } });
  });

  it('submits the hub tx of a Tron withdraw-auth to the intent relay when it pays out elsewhere', async () => {
    const waitForWithdrawal = vi.spyOn(spoke.tron, 'waitForWithdrawal').mockResolvedValue({
      ok: true,
      value: { trackingId: TRACKING_ID, status: 'burned', txs: { burn: { chain: 'sonic', hash: HUB_TX, ts: 0 } } },
    });
    const relay = stubRelay(packet(PAYOUT));

    const result = await spoke.settle({
      chainKey: TRON,
      tx: TRACKING_ID,
      direction: 'outbound',
      relayData: RELAY_DATA,
      dstChainKey: ARBITRUM,
    });

    // Nothing is released on Tron, so the wait ends at the hub tx instead of timing out on `released`.
    expect(waitForWithdrawal).toHaveBeenCalledWith(TRACKING_ID, undefined, 'burned');
    expect(relay).toHaveBeenCalledWith(expect.objectContaining({ srcTxHash: HUB_TX, chainKey: SONIC }));
    expect(result).toEqual({ ok: true, value: { trackingId: TRACKING_ID, dstChainTxHash: PAYOUT } });
  });

  it('ends a Tron withdraw-auth to the hub at its hub tx, relaying nothing', async () => {
    vi.spyOn(spoke.tron, 'waitForWithdrawal').mockResolvedValue({
      ok: true,
      value: { trackingId: TRACKING_ID, status: 'burned', txs: { burn: { chain: 'sonic', hash: HUB_TX, ts: 0 } } },
    });
    const relay = stubRelay();

    const result = await spoke.settle({
      chainKey: TRON,
      tx: TRACKING_ID,
      direction: 'outbound',
      relayData: RELAY_DATA,
      dstChainKey: SONIC,
    });

    expect(spoke.tron.waitForWithdrawal).toHaveBeenCalledWith(TRACKING_ID, undefined, 'burned');
    expect(relay).not.toHaveBeenCalled();
    expect(result).toEqual({ ok: true, value: { trackingId: TRACKING_ID, dstChainTxHash: HUB_TX } });
  });

  it('submits the hub mint of a Tron deposit to the intent relay when it pays out elsewhere', async () => {
    vi.spyOn(spoke.tron, 'waitForDeposit').mockResolvedValue({
      ok: true,
      value: {
        depositId: 'id',
        status: 'minted',
        createdAt: 0,
        txs: { hubMint: { chain: 'sonic', hash: HUB_TX, ts: 0 } },
      },
    });
    const relay = stubRelay(packet(PAYOUT));

    const result = await spoke.settle({
      chainKey: TRON,
      tx: SRC_TX,
      direction: 'inbound',
      relayData: RELAY_DATA,
      dstChainKey: ARBITRUM,
    });

    expect(relay).toHaveBeenCalledWith(expect.objectContaining({ srcTxHash: HUB_TX, chainKey: SONIC }));
    expect(result).toEqual({ ok: true, value: { srcChainTxHash: SRC_TX, dstChainTxHash: PAYOUT } });
  });

  it('leaves an intent-relay spoke to intent-relay spoke action to the intent relay alone', async () => {
    vi.spyOn(spoke, 'verifyTxHash').mockResolvedValue({ ok: true, value: true });
    const relay = stubRelay(packet(HUB_TX));
    const receipt = stubHubReceipt([]);

    const result = await spoke.settle({
      chainKey: ARBITRUM,
      tx: SRC_TX,
      direction: 'outbound',
      relayData: RELAY_DATA,
      dstChainKey: '0x2105.base',
    });

    // The intent relay carries its own hub delivery on to the next hop.
    expect(relay).toHaveBeenCalledTimes(1);
    expect(receipt).not.toHaveBeenCalled();
    expect(result).toEqual({ ok: true, value: { srcChainTxHash: SRC_TX, dstChainTxHash: HUB_TX } });
  });

  it.each([
    ['no BridgeRequest to Tron', [bridgeRequest(2, chainTopic(42161n))]],
    [
      'a BridgeRequest from another contract',
      [bridgeRequest(2, TRON_TOPIC, '0x1111111111111111111111111111111111111111')],
    ],
    ['two BridgeRequests to Tron', [bridgeRequest(1), bridgeRequest(2)]],
  ])('refuses to track a hub tx with %s, notifying nothing', async (_label, logs) => {
    stubHubReceipt(logs);
    const release = stubRelease();

    const result = await spoke.settle({
      chainKey: SONIC,
      tx: HUB_TX,
      direction: 'outbound',
      relayData: RELAY_DATA,
      dstChainKey: TRON,
    });

    expect(release).not.toHaveBeenCalled();
    expect(result.ok).toBe(false);
    expect(!result.ok && result.error.phase).toBe('relay');
  });

  describe('submitHubRelease and waitForHubRelease', () => {
    it('submits a release once the hub tx confirms, and returns the release without waiting for the payout', async () => {
      stubHubReceipt([bridgeRequest(4)]);
      const wait = stubRelease();

      const submitted = await spoke.submitHubRelease({ hubTxHash: HUB_TX, dstChainKey: TRON });

      const ref = { dstChainKey: TRON, hubChainId: '146', hubTxHash: HUB_TX, logIndex: 4 };
      expect(submitted).toEqual({ ok: true, value: ref });
      expect(spoke.tron.submitHubRelease).toHaveBeenCalledWith(ref);
      expect(wait).not.toHaveBeenCalled();
    });

    it('refuses a reverted hub tx, notifying nothing', async () => {
      stubHubReceipt([bridgeRequest(4)], 'reverted');
      stubRelease();

      const submitted = await spoke.submitHubRelease({ hubTxHash: HUB_TX, dstChainKey: TRON });

      expect(!submitted.ok && submitted.error.phase).toBe('verification');
      expect(spoke.tron.submitHubRelease).not.toHaveBeenCalled();
    });

    it('waits on a submitted release by the same reference, to its payout', async () => {
      const wait = stubRelease();
      const ref = { dstChainKey: TRON, hubChainId: '146', hubTxHash: HUB_TX, logIndex: 4 } satisfies HubRelease;

      const settled = await spoke.waitForHubRelease({ release: ref, timeout: 1_000 });

      expect(wait).toHaveBeenCalledWith(ref, 1_000);
      expect(settled).toEqual({ ok: true, value: { srcChainTxHash: HUB_TX, dstChainTxHash: PAYOUT } });
    });
  });

  describe('getHubRelease', () => {
    const readReceipt = (logs: ReturnType<typeof bridgeRequest>[]) =>
      vi
        .spyOn(sodax.hubProvider.publicClient, 'getTransactionReceipt')
        // Only `logs` is read; a full receipt carries block data the test has no use for.
        .mockResolvedValue({ status: 'success', logs } as unknown as TransactionReceipt);

    it('reads the record by the BridgeRequest log, and notifies nothing', async () => {
      readReceipt([bridgeRequest(1, chainTopic(42161n)), bridgeRequest(4)]);
      const record = {
        ok: true as const,
        value: { depositId: 'id', status: 'pending' as const, createdAt: null, txs: {} },
      };
      const read = vi.spyOn(spoke.tron, 'getHubReleaseRecord').mockResolvedValue(record);
      const wait = stubRelease();

      expect(await spoke.getHubRelease(HUB_TX)).toEqual(record);
      expect(read).toHaveBeenCalledWith({ dstChainKey: TRON, hubChainId: '146', hubTxHash: HUB_TX, logIndex: 4 });
      expect(wait).not.toHaveBeenCalled();
    });

    it.each([
      ['a release to another chain', [bridgeRequest(1, chainTopic(42161n))]],
      [
        'a BridgeRequest from another contract',
        [bridgeRequest(2, TRON_TOPIC, '0x1111111111111111111111111111111111111111')],
      ],
      ['no logs', []],
    ])('is undefined for a hub tx with %s, leaving it to the intent relay', async (_label, logs) => {
      readReceipt(logs);
      const read = vi.spyOn(spoke.tron, 'getHubReleaseRecord');

      expect(await spoke.getHubRelease(HUB_TX)).toBeUndefined();
      expect(read).not.toHaveBeenCalled();
    });

    it('fails rather than guessing between two releases to the same chain', async () => {
      readReceipt([bridgeRequest(1), bridgeRequest(2)]);

      expect((await spoke.getHubRelease(HUB_TX))?.ok).toBe(false);
    });

    it('reports an unreadable receipt as a failure rather than rejecting', async () => {
      vi.spyOn(sodax.hubProvider.publicClient, 'getTransactionReceipt').mockRejectedValue(new Error('not found'));

      expect((await spoke.getHubRelease(HUB_TX))?.ok).toBe(false);
    });
  });

  it('reports a reverted hub tx as a verification failure', async () => {
    stubHubReceipt([bridgeRequest(0)], 'reverted');
    const release = stubRelease();

    const result = await spoke.settle({
      chainKey: SONIC,
      tx: HUB_TX,
      direction: 'outbound',
      relayData: RELAY_DATA,
      dstChainKey: TRON,
    });

    expect(release).not.toHaveBeenCalled();
    expect(!result.ok && result.error.phase).toBe('verification');
  });
});

// The non-blocking primitives a backend drives on its own schedule, persisting only the reference.
describe('SpokeService — MPC relay submit and read', () => {
  it('submits a broadcast deposit through its chain service, without waiting for the mint', async () => {
    const submit = vi.spyOn(spoke.tron, 'submitDeposit').mockResolvedValue({ ok: true, value: undefined });
    const wait = vi.spyOn(spoke.tron, 'waitForDeposit');

    expect(await spoke.submitMpcDeposit({ chainKey: TRON, txHash: SRC_TX })).toEqual({ ok: true, value: undefined });
    expect(submit).toHaveBeenCalledWith(SRC_TX);
    expect(wait).not.toHaveBeenCalled();
  });

  it('reads a withdraw-auth once, by its tracking id', async () => {
    const record = { ok: true as const, value: { trackingId: '0xtrack' as const, status: 'submitted' as const } };
    const read = vi.spyOn(spoke.tron, 'getWithdrawalRecord').mockResolvedValue(record);

    expect(await spoke.getMpcRelayWithdrawal({ chainKey: TRON, trackingId: '0xtrack' })).toEqual(record);
    expect(read).toHaveBeenCalledWith('0xtrack');
  });
});
