// packages/sdk/src/recovery/RecoveryService.test.ts
import { decodeAbiParameters, decodeFunctionData, parseAbiParameters, type Address, type Hex } from 'viem';
import { ChainKeys, type AnalyticsEvent, type IconEoaAddress } from '@sodax/types';
import { describe, expect, it, vi } from 'vitest';
import type { ConfigService } from '../shared/config/ConfigService.js';
import type { HubProvider } from '../shared/types/types.js';
import type { SpokeService } from '../shared/services/spoke/SpokeService.js';
import { assetManagerAbi } from '../shared/abis/index.js';
import { encodeAddress } from '../shared/utils/shared-utils.js';
import { invariant } from '../shared/utils/tiny-invariant.js';
import { noopAnalytics, resolveAnalytics } from '../shared/analytics.js';
import { RecoveryService } from './RecoveryService.js';
import { isSodaxError } from '../errors/SodaxError.js';

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

describe('RecoveryService.withdrawHubAsset — payout to an MPC-relay chain', () => {
  it('refuses a release at the minimum before building the message', async () => {
    const config = {
      getSpokeTokenFromOriginalAssetAddress: vi.fn(() => ({
        chainKey: ChainKeys.TRON_MAINNET,
        symbol: 'TRX',
        decimals: 6,
        hubAsset: '0x0000000000000000000000000000000000002000',
      })),
      analytics: noopAnalytics,
    } as unknown as ConfigService; // only the two members withdrawHubAsset reads
    const hubProvider = { config, getUserHubWalletAddress: vi.fn() } as unknown as HubProvider; // never reached
    const spoke = { sendMessage: vi.fn() } as unknown as SpokeService; // never reached
    const recovery = new RecoveryService({ config, hubProvider, spoke });

    const result = await recovery.withdrawHubAsset({
      raw: true,
      params: {
        srcChainKey: ChainKeys.TRON_MAINNET,
        srcAddress: 'TGLeueT1EauJN1AupKBPmkSE76Brm1v4ow',
        token: '0x0000000000000000000000000000000000000000',
        amount: 10_000_000n,
      },
    });

    invariant(!result.ok && isSodaxError(result.error), 'expected a refusal');
    expect(result.error.code).toBe('VALIDATION_FAILED');
    expect(result.error.context?.reason).toBe('mpc-payout-below-minimum');
    expect(hubProvider.getUserHubWalletAddress).not.toHaveBeenCalled();
    expect(spoke.sendMessage).not.toHaveBeenCalled();
  });
});

describe('RecoveryService.withdrawHubAsset — analytics', () => {
  const withdraw = async (srcChainKey: typeof ChainKeys.TRON_MAINNET | typeof ChainKeys.ICON_MAINNET) => {
    const events: AnalyticsEvent[] = [];
    const config = {
      getSpokeTokenFromOriginalAssetAddress: vi.fn(() => ({
        chainKey: srcChainKey,
        symbol: 'USDT',
        decimals: 6,
        hubAsset: '0x0000000000000000000000000000000000002000',
      })),
      analytics: resolveAnalytics({ tracker: event => void events.push(event), level: 'detailed' }),
    } as unknown as ConfigService; // only the members withdrawHubAsset reads
    const hubProvider = {
      config,
      chainConfig: {
        chain: { key: ChainKeys.SONIC_MAINNET },
        addresses: { assetManager: '0x0000000000000000000000000000000000003000' },
      },
      getUserHubWalletAddress: vi.fn(async () => '0x0000000000000000000000000000000000004000'),
    } as unknown as HubProvider; // only the members withdrawHubAsset reads
    const spoke = { sendMessage: vi.fn(async () => ({ ok: true, value: 'returned-id' })) } as unknown as SpokeService; // stubbed send
    const recovery = new RecoveryService({ config, hubProvider, spoke });
    const srcAddress =
      srcChainKey === ChainKeys.TRON_MAINNET
        ? 'TGLeueT1EauJN1AupKBPmkSE76Brm1v4ow'
        : 'hx742d35cc6634c0532925a3b8d4c9db96c4b4d8b6';

    await recovery.withdrawHubAsset({
      raw: false,
      walletProvider: {} as never,
      params: { srcChainKey, srcAddress, token: '0x0000000000000000000000000000000000001000', amount: 10_000_000n },
    });
    return events.find(event => event.phase === 'success')?.data;
  };

  it('reports a Tron withdraw by its relay trackingId, never as a tx hash', async () => {
    expect(await withdraw(ChainKeys.TRON_MAINNET)).toEqual({ trackingId: 'returned-id' });
  });

  it('keeps reporting a tx hash on every other chain', async () => {
    expect(await withdraw(ChainKeys.ICON_MAINNET)).toEqual({ txHash: 'returned-id' });
  });
});
