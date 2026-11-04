/**
 * AssetService relay-data destination (DEX-M-1).
 *
 * executeWithdraw must report the hub wallet as the relay destination address, not the
 * spoke recipient. The address is the hub-chain destination of the off-chain payload the
 * relayer submits for split-tx chains (Solana/Bitcoin); it must match the `dstAddress` the
 * spoke sendMessage commits to (fromHubWallet), exactly as executeDeposit already does.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ChainKeys, type Address } from '@sodax/types';
import { Sodax } from '../shared/entities/Sodax.js';

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
});
