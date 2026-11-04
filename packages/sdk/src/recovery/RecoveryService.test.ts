// packages/sdk/src/recovery/RecoveryService.test.ts
import { decodeAbiParameters, decodeFunctionData, parseAbiParameters, type Address, type Hex } from 'viem';
import { ChainKeys, type IconEoaAddress } from '@sodax/types';
import { describe, expect, it, vi } from 'vitest';
import type { ConfigService } from '../shared/config/ConfigService.js';
import type { HubProvider } from '../shared/types/types.js';
import type { SpokeService } from '../shared/services/spoke/SpokeService.js';
import { assetManagerAbi } from '../shared/abis/index.js';
import { encodeAddress } from '../shared/utils/shared-utils.js';
import { invariant } from '../shared/utils/tiny-invariant.js';
import { noopAnalytics } from '../shared/analytics.js';
import { RecoveryService } from './RecoveryService.js';

describe('RecoveryService.withdrawHubAsset', () => {
  it('encodes non-EVM spoke addresses before building the asset manager transfer payload', async () => {
    const originalSpokeToken = '0x0000000000000000000000000000000000001000' as Address;
    const hubAsset = '0x0000000000000000000000000000000000002000' as Address;
    const assetManager = '0x0000000000000000000000000000000000003000' as Address;
    const hubWallet = '0x0000000000000000000000000000000000004000' as Address;
    const srcAddress = 'hx742d35cc6634c0532925a3b8d4c9db96c4b4d8b6' satisfies IconEoaAddress;
    const amount = 123n;

    const config = {
      getSpokeTokenFromOriginalAssetAddress: vi.fn(() => ({ hubAsset })),
      analytics: noopAnalytics,
    } as unknown as ConfigService;
    const hubProvider = {
      config,
      chainConfig: {
        chain: { key: ChainKeys.SONIC_MAINNET },
        addresses: { assetManager },
      },
      getUserHubWalletAddress: vi.fn(async () => hubWallet),
    } as unknown as HubProvider;
    const spoke = {
      sendMessage: vi.fn(async () => ({ ok: true, value: '0xsent' as Hex })),
    } as unknown as SpokeService;
    const recovery = new RecoveryService({ config, hubProvider, spoke });

    const result = await recovery.withdrawHubAsset({
      raw: true,
      params: {
        srcChainKey: ChainKeys.ICON_MAINNET,
        srcAddress,
        token: originalSpokeToken,
        amount,
      },
    });

    expect(result.ok).toBe(true);
    expect(spoke.sendMessage).toHaveBeenCalledOnce();

    const sendMessageParams = vi.mocked(spoke.sendMessage).mock.calls[0]?.[0] as { payload: Hex };
    const [calls] = decodeAbiParameters(parseAbiParameters('(address,uint256,bytes)[]'), sendMessageParams.payload);
    const transferCall = calls[0];
    invariant(transferCall, 'expected one encoded transfer call');

    const decodedTransfer = decodeFunctionData({
      abi: assetManagerAbi,
      data: transferCall[2],
    });

    expect(decodedTransfer.functionName).toBe('transfer');
    expect(decodedTransfer.args[0]).toBe(hubAsset);
    expect(decodedTransfer.args[1]).toBe(encodeAddress(ChainKeys.ICON_MAINNET, srcAddress));
    expect(decodedTransfer.args[1]).not.toBe(srcAddress);
    expect(decodedTransfer.args[2]).toBe(amount);
  });
});
