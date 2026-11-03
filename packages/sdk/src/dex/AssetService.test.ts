/**
 * AssetService relay-data destination (DEX-M-1).
 *
 * executeWithdraw must report the hub wallet as the relay destination address, not the
 * spoke recipient. The address is the hub-chain destination of the off-chain payload the
 * relayer submits for split-tx chains (Solana/Bitcoin); it must match the `dstAddress` the
 * spoke sendMessage commits to (fromHubWallet), exactly as executeDeposit already does.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ChainKeys, type Address, type Hex } from '@sodax/types';
import { pad, toEventSelector, toHex, type TransactionReceipt } from 'viem';
import { Sodax } from '../shared/entities/Sodax.js';
import { isSodaxError } from '../errors/SodaxError.js';
import * as IntentRelayApiService from '../shared/services/intentRelay/IntentRelayApiService.js';

const sodax = new Sodax();
const asset = sodax.dex.assetService;

const SRC_ADDRESS: Address = '0x1111111111111111111111111111111111111111';
const HUB_WALLET: Address = '0x2222222222222222222222222222222222222222';
const ASSET: Address = '0x3333333333333333333333333333333333333333';
const POOL_TOKEN: Address = '0x4444444444444444444444444444444444444444';

beforeEach(() => {
  vi.spyOn(sodax.hubProvider, 'getUserHubWalletAddress').mockResolvedValue(HUB_WALLET);
  // Skip the hub read/config work; only the relay-data wiring is under test here.
  vi.spyOn(asset, 'getTokenUnwrapAction').mockResolvedValue([]);
  vi.spyOn(sodax.spoke, 'sendMessage').mockResolvedValue({ ok: true, value: '0xspokeTx' });
});

afterEach(() => vi.restoreAllMocks());

describe('AssetService.executeWithdraw', () => {
  it('reports the hub wallet as relayData.address, not the spoke recipient', async () => {
    const result = await asset.executeWithdraw({
      params: {
        srcChainKey: ChainKeys.BSC_MAINNET,
        srcAddress: SRC_ADDRESS,
        asset: ASSET,
        poolToken: POOL_TOKEN,
        amount: 1000n,
      },
      raw: true,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.relayData).toEqual({ address: HUB_WALLET, payload: expect.any(String) });
      // Guards the exact bug: it must NOT be the spoke recipient (params.srcAddress).
      expect(result.value.relayData.address).not.toBe(SRC_ADDRESS);
    }

    // relayData.address must match the hub destination the spoke message commits to.
    const sendArg = (sodax.spoke.sendMessage as ReturnType<typeof vi.fn>).mock.calls[0]?.[0];
    expect(sendArg.dstAddress).toBe(HUB_WALLET);
  });

  it('hands a Tron recipient to the AssetManager transfer as the 32-byte word the release reads', async () => {
    const result = await asset.executeWithdraw({
      params: {
        srcChainKey: ChainKeys.TRON_MAINNET,
        srcAddress: 'TGLeueT1EauJN1AupKBPmkSE76Brm1v4ow',
        asset: 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t',
        poolToken: POOL_TOKEN,
        amount: 1000n,
      },
      raw: true,
    });

    expect(result.ok).toBe(true);
    expect(asset.getTokenUnwrapAction).toHaveBeenCalledWith(
      ChainKeys.TRON_MAINNET,
      'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t',
      1000n,
      HUB_WALLET,
      `0x${'00'.repeat(12)}45df1d9f0d472080e5272946e4444f885473245d`,
    );
  });
});

describe('AssetService.executeWithdraw — payout to an MPC-relay chain', () => {
  // 18-dp vault units in; the release pays out USDT's 6 decimals.
  const withdraw = async (amount: bigint) => {
    vi.mocked(asset.getTokenUnwrapAction).mockRestore();
    // The zero stata token skips the ERC-4626 redeem, so the vault amount is the requested one.
    vi.spyOn(sodax.hubProvider.publicClient, 'readContract').mockResolvedValue(
      '0x0000000000000000000000000000000000000000' as never,
    );
    return asset.executeWithdraw({
      params: {
        srcChainKey: ChainKeys.TRON_MAINNET,
        srcAddress: 'TGLeueT1EauJN1AupKBPmkSE76Brm1v4ow',
        asset: 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t',
        poolToken: POOL_TOKEN,
        amount,
      },
      raw: true,
    });
  };

  it('refuses a release at the minimum before building the message', async () => {
    const result = await withdraw(3n * 10n ** 18n);

    if (result.ok || !isSodaxError(result.error)) throw new Error('expected a refusal');
    expect(result.error.code).toBe('VALIDATION_FAILED');
    expect(result.error.context?.reason).toBe('mpc-payout-below-minimum');
    expect(sodax.spoke.sendMessage).not.toHaveBeenCalled();
  });

  it('sends a release above it', async () => {
    expect((await withdraw(3n * 10n ** 18n + 10n ** 12n)).ok).toBe(true);
    expect(sodax.spoke.sendMessage).toHaveBeenCalledOnce();
  });
});

// An MPC-relay source has no intent-relay packet: its deposit and withdraw settle on the relay.
describe('AssetService deposit/withdraw from an MPC-relay source', () => {
  const TRON_TX = 'ab'.repeat(32);
  const RELAY_DATA = { address: HUB_WALLET, payload: '0x01' as Hex };
  const SETTLED = { srcChainTxHash: TRON_TX, dstChainTxHash: '0xhub' };
  const params = {
    srcChainKey: ChainKeys.TRON_MAINNET,
    srcAddress: 'TGLeueT1EauJN1AupKBPmkSE76Brm1v4ow',
    asset: 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t',
    poolToken: POOL_TOKEN,
    amount: 1000n,
  } as const;

  it.each([
    ['deposit', 'executeDeposit', 'inbound'],
    ['withdraw', 'executeWithdraw', 'outbound'],
  ] as const)('%s settles through spoke.settle (%s, %s), not the intent relay', async (method, execute, direction) => {
    vi.spyOn(asset, execute).mockResolvedValue({ ok: true, value: { tx: TRON_TX, relayData: RELAY_DATA } });
    const settle = vi.spyOn(sodax.spoke, 'settle').mockResolvedValue({ ok: true, value: SETTLED });
    const relay = vi.spyOn(IntentRelayApiService, 'relayTxAndWaitPacket');

    const result = await asset[method]({ params, raw: false, walletProvider: {} as never, timeout: 90_000 });

    expect(settle).toHaveBeenCalledWith({
      chainKey: ChainKeys.TRON_MAINNET,
      tx: TRON_TX,
      direction,
      relayData: RELAY_DATA,
      timeout: 90_000,
      // A withdraw names where it pays out; with no `dst` that is back to the source.
      ...(method === 'withdraw' ? { dstChainKey: ChainKeys.TRON_MAINNET } : {}),
    });
    expect(relay).not.toHaveBeenCalled();
    expect(result).toEqual({ ok: true, value: SETTLED });
  });

  it('returns the relay cause when settlement fails', async () => {
    const cause = new Error('RELAY_TIMEOUT');
    vi.spyOn(asset, 'executeDeposit').mockResolvedValue({ ok: true, value: { tx: TRON_TX, relayData: RELAY_DATA } });
    vi.spyOn(sodax.spoke, 'settle').mockResolvedValue({ ok: false, error: { phase: 'relay', cause } });

    const result = await asset.deposit({ params, raw: false, walletProvider: {} as never });

    expect(result).toEqual({ ok: false, error: cause });
  });
});

// Below `settle`: only the relay seams are stubbed, so the result shape is what a caller really gets.
describe('AssetService.withdraw — settled through the MPC relay seams', () => {
  const TRON_ADDRESS = 'TGLeueT1EauJN1AupKBPmkSE76Brm1v4ow';
  const RELAY_DATA = { address: HUB_WALLET, payload: '0x01' as Hex };

  it('returns the relay trackingId, never a source tx, for a withdraw from Tron', async () => {
    const trackingId = `0x${'e'.repeat(64)}` as const;
    vi.spyOn(asset, 'executeWithdraw').mockResolvedValue({
      ok: true,
      value: { tx: trackingId, relayData: RELAY_DATA },
    });
    vi.spyOn(sodax.spoke.tron, 'waitForWithdrawal').mockResolvedValue({
      ok: true,
      value: { trackingId, status: 'released', txs: { release: { chain: 'tron', hash: 'tronRelease', ts: 0 } } },
    });

    const result = await asset.withdraw({
      params: {
        srcChainKey: ChainKeys.TRON_MAINNET,
        srcAddress: TRON_ADDRESS,
        asset: ASSET,
        poolToken: POOL_TOKEN,
        amount: 1000n,
      },
      raw: false,
      walletProvider: {} as never,
    });

    expect(result).toEqual({ ok: true, value: { trackingId, dstChainTxHash: 'tronRelease' } });
  });

  it('releases a hub withdraw to Tron through a submitted release, keeping the hub tx as the source', async () => {
    const hubTx = `0x${'9'.repeat(64)}` as const;
    vi.spyOn(asset, 'executeWithdraw').mockResolvedValue({ ok: true, value: { tx: hubTx, relayData: RELAY_DATA } });
    const bridgeRequest = {
      address: sodax.hubProvider.chainConfig.addresses.assetManager,
      logIndex: 1,
      topics: [toEventSelector('BridgeRequest(uint256,bytes,bytes)'), pad(toHex(728126428n), { size: 32 })],
    };
    vi.spyOn(sodax.hubProvider.publicClient, 'waitForTransactionReceipt')
      // Only `status` and `logs` are read; a full receipt carries block data the test has no use for.
      .mockResolvedValue({ status: 'success', logs: [bridgeRequest] } as unknown as TransactionReceipt);
    const submit = vi.spyOn(sodax.spoke.tron, 'submitHubRelease').mockResolvedValue({ ok: true, value: undefined });
    vi.spyOn(sodax.spoke.tron, 'waitForHubRelease').mockResolvedValue({
      ok: true,
      value: {
        depositId: 'id',
        status: 'submitted',
        createdAt: null,
        txs: { release: { chain: 'tron', hash: 'tronPayout', ts: 0 } },
      },
    });

    const result = await asset.withdraw({
      params: {
        srcChainKey: ChainKeys.SONIC_MAINNET,
        srcAddress: SRC_ADDRESS,
        asset: ASSET,
        poolToken: POOL_TOKEN,
        amount: 1000n,
        dst: { dstChainKey: ChainKeys.TRON_MAINNET, dstAddress: TRON_ADDRESS },
      },
      raw: false,
      walletProvider: {} as never,
    });

    expect(submit).toHaveBeenCalledWith(expect.objectContaining({ hubTxHash: hubTx, logIndex: 1 }));
    expect(result).toEqual({ ok: true, value: { srcChainTxHash: hubTx, dstChainTxHash: 'tronPayout' } });
  });
});
