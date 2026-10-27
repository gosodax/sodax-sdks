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
import { Sodax } from '../shared/entities/Sodax.js';
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
