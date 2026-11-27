/**
 * Tests for EvmAssetManagerService — the hub-chain asset-manager service.
 *
 * Mirrors the pattern from EvmVaultTokenService.test.ts (which itself mirrors PR #1241):
 *   1. Each public method has a top-level `describe` covering every branch the implementation
 *      forks on (asset-config found vs not found, transfer encoding, decimals translation, …).
 *   2. Calldata is asserted via real `encodeFunctionData` from viem — a mutation that swaps the
 *      function name or arg order would change the encoded bytes and fail the assertion.
 *   3. Collaborators reduce to a stubbed `publicClient` (`readContract`), a stubbed `ConfigService`
 *      (`getSpokeTokenFromOriginalAssetAddress`), and a stubbed `EvmHubProvider` shape (just the
 *      `chainConfig.addresses.assetManager` and `config` it accesses). No `vi.mock` is needed —
 *      the static helpers `Erc20Service` / `EvmVaultTokenService` / `encodeContractCalls` run for
 *      real so the encoded bytes are end-to-end verified.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  type Address,
  type Hex,
  type HttpTransport,
  type PublicClient,
  decodeAbiParameters,
  encodeFunctionData,
  parseAbiParameters,
} from 'viem';
import { ChainKeys } from '@sodax/types';
import type { SpokeChainKey, XToken } from '@sodax/types';
import { assetManagerAbi, erc20Abi, vaultTokenAbi } from '../../abis/index.js';
import type { ConfigService } from '../../config/ConfigService.js';
import type { EvmHubProvider } from '../../entities/EvmHubProvider.js';
import { EvmAssetManagerService } from './EvmAssetManagerService.js';
import { EvmVaultTokenService } from './EvmVaultTokenService.js';

// --- fixtures -------------------------------------------------------------

const ASSET_MANAGER: Address = '0x1111111111111111111111111111111111111111';
const TOKEN_ORIGINAL: Address = '0x2222222222222222222222222222222222222222';
const HUB_ASSET: Address = '0x3333333333333333333333333333333333333333';
const VAULT: Address = '0x4444444444444444444444444444444444444444';
const RECIPIENT_HEX: Hex = '0x5555555555555555555555555555555555555555';
const SPOKE_ADDRESS_BYTES: Hex = '0x6666666666666666666666666666666666666666';
const SPOKE_CHAIN_KEY: SpokeChainKey = ChainKeys.AVALANCHE_MAINNET;

const xToken18: XToken = {
  symbol: 'TKN',
  name: 'Token',
  decimals: 18,
  address: TOKEN_ORIGINAL,
  chainKey: SPOKE_CHAIN_KEY,
  hubAsset: HUB_ASSET,
  vault: VAULT,
};

const xToken6: XToken = {
  ...xToken18,
  decimals: 6,
};

const xToken24: XToken = {
  ...xToken18,
  decimals: 24,
};

const mockPublicClient = {
  readContract: vi.fn(),
} as unknown as PublicClient<HttpTransport>;

const mockConfigService = {
  getSpokeTokenFromOriginalAssetAddress: vi.fn(),
} as unknown as ConfigService;

const buildHubProvider = (xToken: XToken | undefined): EvmHubProvider =>
  ({
    chainConfig: { addresses: { assetManager: ASSET_MANAGER } },
    config: {
      getSpokeTokenFromOriginalAssetAddress: vi.fn().mockReturnValue(xToken),
    },
  }) as unknown as EvmHubProvider;

beforeEach(() => {
  vi.clearAllMocks();
});

// =========================================================================
// getAssetInfo (static) — readContract delegation + tuple→object mapping
// =========================================================================

describe('EvmAssetManagerService.getAssetInfo', () => {
  it('reads assetInfo(asset) and maps the [chainId, spokeAddress] tuple to AssetInfo', async () => {
    const chainId = 6n;
    const spy = vi.mocked(mockPublicClient.readContract).mockResolvedValueOnce([chainId, SPOKE_ADDRESS_BYTES] as never);

    const result = await EvmAssetManagerService.getAssetInfo(TOKEN_ORIGINAL, ASSET_MANAGER, mockPublicClient);

    expect(result).toEqual({ chainId, spokeAddress: SPOKE_ADDRESS_BYTES });
    expect(spy).toHaveBeenCalledWith({
      address: ASSET_MANAGER,
      abi: assetManagerAbi,
      functionName: 'assetInfo',
      args: [TOKEN_ORIGINAL],
    });
  });

  it('propagates errors thrown by readContract', async () => {
    const rpcError = new Error('rpc unavailable');
    vi.mocked(mockPublicClient.readContract).mockRejectedValueOnce(rpcError);

    await expect(EvmAssetManagerService.getAssetInfo(TOKEN_ORIGINAL, ASSET_MANAGER, mockPublicClient)).rejects.toBe(
      rpcError,
    );
  });
});

// =========================================================================
// encodeTransfer (static, pure) — assetManager.transfer(token, to, amount, '0x')
// =========================================================================

describe('EvmAssetManagerService.encodeTransfer', () => {
  it('returns { address: assetManager, value: 0n, data: encoded transfer(token, to, amount, "0x") }', () => {
    const result = EvmAssetManagerService.encodeTransfer(HUB_ASSET, RECIPIENT_HEX, 1_000n, ASSET_MANAGER);

    expect(result).toEqual({
      address: ASSET_MANAGER,
      value: 0n,
      data: encodeFunctionData({
        abi: assetManagerAbi,
        functionName: 'transfer',
        args: [HUB_ASSET, RECIPIENT_HEX, 1_000n, '0x'],
      }),
    });
  });
});

// =========================================================================
// depositToData (static) — config lookup → approve+deposit+transfer pipeline
// =========================================================================

describe('EvmAssetManagerService.depositToData', () => {
  it('throws when getSpokeTokenFromOriginalAssetAddress returns undefined (asset not found)', () => {
    vi.mocked(mockConfigService.getSpokeTokenFromOriginalAssetAddress).mockReturnValueOnce(undefined);

    expect(() =>
      EvmAssetManagerService.depositToData(
        { token: TOKEN_ORIGINAL, to: RECIPIENT_HEX, amount: 1_000n },
        SPOKE_CHAIN_KEY,
        mockConfigService,
      ),
    ).toThrow(`[depositToData] Hub asset not found for token: ${TOKEN_ORIGINAL}`);
  });

  it('looks up the spoke token and emits exactly three encoded sub-calls in order: approve(hubAsset, vault, amount), deposit(hubAsset, amount), transfer(vault, to, translatedAmount)', () => {
    const spy = vi.mocked(mockConfigService.getSpokeTokenFromOriginalAssetAddress).mockReturnValueOnce(xToken18);

    const encoded = EvmAssetManagerService.depositToData(
      { token: TOKEN_ORIGINAL, to: RECIPIENT_HEX, amount: 1_000n },
      SPOKE_CHAIN_KEY,
      mockConfigService,
    );

    expect(spy).toHaveBeenCalledWith(SPOKE_CHAIN_KEY, TOKEN_ORIGINAL);

    const [calls] = decodeAbiParameters(parseAbiParameters('(address,uint256,bytes)[]'), encoded);
    expect(calls).toHaveLength(3);

    // 1) approve(vault, amount) on hubAsset
    expect(calls[0]).toEqual([
      HUB_ASSET,
      0n,
      encodeFunctionData({ abi: erc20Abi, functionName: 'approve', args: [VAULT, 1_000n] }),
    ]);

    // 2) vault.deposit(hubAsset, amount)
    expect(calls[1]).toEqual([
      VAULT,
      0n,
      encodeFunctionData({ abi: vaultTokenAbi, functionName: 'deposit', args: [HUB_ASSET, 1_000n] }),
    ]);

    // 3) transfer(to, translatedAmount) on the vault token (decimals=18 → no scaling)
    const translated = EvmVaultTokenService.translateIncomingDecimals(18, 1_000n);
    expect(translated).toBe(1_000n);
    expect(calls[2]).toEqual([
      VAULT,
      0n,
      encodeFunctionData({ abi: erc20Abi, functionName: 'transfer', args: [RECIPIENT_HEX, translated] }),
    ]);
  });

  it('translates the transfer amount by spoke decimals: up for decimals < 18, down for decimals > 18', () => {
    const cases = [
      // 6 decimals → multiply by 10^(18-6) = 10^12
      [xToken6, 1n, 10n ** 12n],
      // 24 decimals → divide by 10^(24-18) = 10^6
      [xToken24, 10n ** 12n, 10n ** 6n],
    ] as const;

    for (const [xToken, amount, translated] of cases) {
      vi.mocked(mockConfigService.getSpokeTokenFromOriginalAssetAddress).mockReturnValueOnce(xToken);

      const encoded = EvmAssetManagerService.depositToData(
        { token: TOKEN_ORIGINAL, to: RECIPIENT_HEX, amount },
        SPOKE_CHAIN_KEY,
        mockConfigService,
      );

      const [calls] = decodeAbiParameters(parseAbiParameters('(address,uint256,bytes)[]'), encoded);
      expect(calls[2]?.[2]).toEqual(
        encodeFunctionData({ abi: erc20Abi, functionName: 'transfer', args: [RECIPIENT_HEX, translated] }),
      );
    }
  });
});

// =========================================================================
// withdrawAssetData (static) — config lookup → single assetManager.transfer call
// =========================================================================

describe('EvmAssetManagerService.withdrawAssetData', () => {
  it('throws when hubProvider.config.getSpokeTokenFromOriginalAssetAddress returns undefined', () => {
    const hubProvider = buildHubProvider(undefined);

    expect(() =>
      EvmAssetManagerService.withdrawAssetData(
        { token: TOKEN_ORIGINAL, to: RECIPIENT_HEX, amount: 500n },
        hubProvider,
        SPOKE_CHAIN_KEY,
      ),
    ).toThrow(`[withdrawAssetData] Hub asset not found for token: ${TOKEN_ORIGINAL}`);
  });

  it('emits a single assetManager.transfer(hubAsset, to, amount, "0x") call, amount untranslated (unlike depositToData)', () => {
    const hubProvider = buildHubProvider(xToken6); // decimals=6 — would matter for deposits, not withdrawals

    const encoded = EvmAssetManagerService.withdrawAssetData(
      { token: TOKEN_ORIGINAL, to: RECIPIENT_HEX, amount: 500n },
      hubProvider,
      SPOKE_CHAIN_KEY,
    );

    expect(hubProvider.config.getSpokeTokenFromOriginalAssetAddress).toHaveBeenCalledWith(
      SPOKE_CHAIN_KEY,
      TOKEN_ORIGINAL,
    );
    const [calls] = decodeAbiParameters(parseAbiParameters('(address,uint256,bytes)[]'), encoded);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toEqual([
      ASSET_MANAGER,
      0n,
      encodeFunctionData({
        abi: assetManagerAbi,
        functionName: 'transfer',
        args: [HUB_ASSET, RECIPIENT_HEX, 500n, '0x'],
      }),
    ]);
  });
});

// =========================================================================
// getAssetAddress (instance) — readContract delegation for assets(chainId, spokeAddress)
// =========================================================================
//
// `EvmAssetManagerService` declares a private constructor, so we materialize an instance via
// `Object.create(prototype)` to access the (currently unused) instance method without violating
// the TS access modifier. The method itself does not reference `this`, so an empty prototype-
// linked object is sufficient.

describe('EvmAssetManagerService#getAssetAddress', () => {
  const service = Object.create(EvmAssetManagerService.prototype) as EvmAssetManagerService;

  it('reads assets(chainId, spokeAddress) on the asset manager and returns the resolved address', async () => {
    const expectedAddress: Address = '0x7777777777777777777777777777777777777777';
    const spy = vi.mocked(mockPublicClient.readContract).mockResolvedValueOnce(expectedAddress as never);

    const result = await service.getAssetAddress(6n, SPOKE_ADDRESS_BYTES, ASSET_MANAGER, mockPublicClient);

    expect(result).toBe(expectedAddress);
    expect(spy).toHaveBeenCalledWith({
      address: ASSET_MANAGER,
      abi: assetManagerAbi,
      functionName: 'assets',
      args: [6n, SPOKE_ADDRESS_BYTES],
    });
  });
});
