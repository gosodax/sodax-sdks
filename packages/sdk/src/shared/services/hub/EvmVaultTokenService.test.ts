/**
 * Tests for EvmVaultTokenService — the hub-chain vault-token service.
 *
 * Mirrors the pattern from SonicSpokeService.test.ts (PR #1241):
 *   1. Each public method has a top-level `describe` covering every branch the implementation
 *      forks on (decimals <=18 vs >18, multicall fan-out, raw vs sent tx, etc.).
 *   2. Calldata is asserted via `encodeFunctionData` from real viem — a mutation that swaps
 *      the function name or arg order would change the encoded bytes and fail the assertion.
 *   3. Collaborators reduce to a stubbed `publicClient` (`readContract` / `multicall`) and a
 *      stubbed `IEvmWalletProvider` (`getWalletAddress` / `sendTransaction`). Unlike the spoke
 *      services there is no static-helper layer to mock, so no `vi.mock` / `vi.hoisted` is needed.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { type Address, type Hash, type HttpTransport, type PublicClient, encodeFunctionData } from 'viem';
import { ChainKeys } from '@sodax/types';
import { getEvmViemChain } from '../../utils/constant-utils.js';
import type { IEvmWalletProvider, TokenInfo } from '@sodax/types';
import { vaultTokenAbi } from '../../abis/index.js';
import { EvmVaultTokenService } from './EvmVaultTokenService.js';

// --- fixtures -------------------------------------------------------------

const VAULT: Address = '0x1111111111111111111111111111111111111111';
const TOKEN_A: Address = '0x2222222222222222222222222222222222222222';
const TOKEN_B: Address = '0x3333333333333333333333333333333333333333';
const SENDER: Address = '0x4444444444444444444444444444444444444444';
const TX_HASH: Hash = '0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef';

// `tokenInfo` returns a 5-tuple. Build matching fixtures.
const tokenInfoTupleA = [18, 100n, 200n, 1_000_000n, true] as const;
const tokenInfoTupleB = [6, 50n, 75n, 999n, false] as const;

const tokenInfoObjA: TokenInfo = {
  decimals: 18,
  depositFee: 100n,
  withdrawalFee: 200n,
  maxDeposit: 1_000_000n,
  isSupported: true,
};
const tokenInfoObjB: TokenInfo = {
  decimals: 6,
  depositFee: 50n,
  withdrawalFee: 75n,
  maxDeposit: 999n,
  isSupported: false,
};

const mockPublicClient = {
  readContract: vi.fn(),
  multicall: vi.fn(),
} as unknown as PublicClient<HttpTransport>;

const mockWalletProvider = {
  chainType: 'EVM',
  getWalletAddress: vi.fn(),
  sendTransaction: vi.fn(),
} as unknown as IEvmWalletProvider;

beforeEach(() => {
  vi.clearAllMocks();
});

// =========================================================================
// getTokenInfo (static) — readContract delegation + tuple→object mapping
// =========================================================================

describe('EvmVaultTokenService.getTokenInfo', () => {
  it('reads tokenInfo(token) and maps the 5-tuple into a TokenInfo object', async () => {
    const spy = vi.mocked(mockPublicClient.readContract).mockResolvedValueOnce(tokenInfoTupleA);

    const result = await EvmVaultTokenService.getTokenInfo(VAULT, TOKEN_A, mockPublicClient);

    expect(result).toEqual(tokenInfoObjA);
    expect(spy).toHaveBeenCalledWith({
      address: VAULT,
      abi: vaultTokenAbi,
      functionName: 'tokenInfo',
      args: [TOKEN_A],
    });
  });
});

// =========================================================================
// getTokenInfos (static) — multicall fan-out + per-token tuple mapping
// =========================================================================

describe('EvmVaultTokenService.getTokenInfos', () => {
  it('fans out one tokenInfo call per token via multicall (allowFailure: false)', async () => {
    const spy = vi
      .mocked(mockPublicClient.multicall)
      .mockResolvedValueOnce([tokenInfoTupleA, tokenInfoTupleB] as never);

    const result = await EvmVaultTokenService.getTokenInfos(VAULT, [TOKEN_A, TOKEN_B], mockPublicClient);

    expect(result).toEqual([tokenInfoObjA, tokenInfoObjB]);
    expect(spy).toHaveBeenCalledTimes(1);
    const call = spy.mock.calls[0]?.[0];
    expect(call?.allowFailure).toBe(false);
    expect(call?.contracts).toEqual([
      { address: VAULT, abi: vaultTokenAbi, functionName: 'tokenInfo', args: [TOKEN_A] },
      { address: VAULT, abi: vaultTokenAbi, functionName: 'tokenInfo', args: [TOKEN_B] },
    ]);
  });
});

// =========================================================================
// deposit (static) — sendTransaction + encoded calldata
// =========================================================================

describe('EvmVaultTokenService.deposit', () => {
  it('encodes deposit(token, amount), sets value: 0n, and forwards to walletProvider.sendTransaction', async () => {
    vi.mocked(mockWalletProvider.getWalletAddress).mockResolvedValueOnce(SENDER);
    vi.mocked(mockWalletProvider.sendTransaction).mockResolvedValueOnce(TX_HASH);

    const result = await EvmVaultTokenService.deposit(VAULT, TOKEN_A, 1_000n, mockWalletProvider);

    expect(result).toBe(TX_HASH);
    // Second argument pins the hub chain binding — vault sends must refuse a wallet on another network.
    expect(mockWalletProvider.sendTransaction).toHaveBeenCalledWith(
      {
        from: SENDER,
        to: VAULT,
        value: 0n,
        data: encodeFunctionData({
          abi: vaultTokenAbi,
          functionName: 'deposit',
          args: [TOKEN_A, 1_000n],
        }),
      },
      { expectedChainId: getEvmViemChain(ChainKeys.SONIC_MAINNET).id },
    );
  });
});

// =========================================================================
// withdraw (static) — sendTransaction + encoded calldata (mirrors deposit)
// =========================================================================

describe('EvmVaultTokenService.withdraw', () => {
  it('encodes withdraw(token, amount), sets value: 0n, and forwards to walletProvider.sendTransaction', async () => {
    vi.mocked(mockWalletProvider.getWalletAddress).mockResolvedValueOnce(SENDER);
    vi.mocked(mockWalletProvider.sendTransaction).mockResolvedValueOnce(TX_HASH);

    const result = await EvmVaultTokenService.withdraw(VAULT, TOKEN_A, 1_000n, mockWalletProvider);

    expect(result).toBe(TX_HASH);
    // Second argument pins the hub chain binding — vault sends must refuse a wallet on another network.
    expect(mockWalletProvider.sendTransaction).toHaveBeenCalledWith(
      {
        from: SENDER,
        to: VAULT,
        value: 0n,
        data: encodeFunctionData({
          abi: vaultTokenAbi,
          functionName: 'withdraw',
          args: [TOKEN_A, 1_000n],
        }),
      },
      { expectedChainId: getEvmViemChain(ChainKeys.SONIC_MAINNET).id },
    );
  });
});

// =========================================================================
// encodeWithdraw (static, pure) — calldata-only, no I/O
// =========================================================================

describe('EvmVaultTokenService.encodeWithdraw', () => {
  it('returns { address: vault, value: 0n, data: encoded withdraw(token, amount) }', () => {
    const result = EvmVaultTokenService.encodeWithdraw(VAULT, TOKEN_A, 5_000n);

    expect(result).toEqual({
      address: VAULT,
      value: 0n,
      data: encodeFunctionData({
        abi: vaultTokenAbi,
        functionName: 'withdraw',
        args: [TOKEN_A, 5_000n],
      }),
    });
  });
});

// =========================================================================
// translateIncomingDecimals (static, pure) — `decimals <= 18 ? mul : div`
// =========================================================================
//
// Branch table covering the `<=` boundary explicitly. The 18 case sits ON the boundary and
// would no-op either side of `<` vs `<=` (10^0 === 1), so it can't kill that mutation alone —
// pair it with the <18 and >18 cases below for full branch coverage.

describe('EvmVaultTokenService.translateIncomingDecimals', () => {
  const cases: ReadonlyArray<{ decimals: number; amount: bigint; expected: bigint; label: string }> = [
    { decimals: 6, amount: 1n, expected: 10n ** 12n, label: 'decimals < 18 → multiply by 10^(18-d)' },
    { decimals: 18, amount: 5n, expected: 5n, label: 'decimals === 18 (boundary, no-op)' },
    { decimals: 24, amount: 1_000_000n, expected: 1n, label: 'decimals > 18 → divide by 10^(d-18)' },
  ];

  it.each(cases)('$label (d=$decimals, amt=$amount → $expected)', ({ decimals, amount, expected }) => {
    expect(EvmVaultTokenService.translateIncomingDecimals(decimals, amount)).toBe(expected);
  });
});

// =========================================================================
// translateOutgoingDecimals (static, pure) — `decimals <= 18 ? div : mul`
// =========================================================================
//
// Inverse of translateIncomingDecimals: at decimals <= 18 we divide (small token → 18-dec), and
// at decimals > 18 we multiply. Same branch table shape, mirrored direction.

describe('EvmVaultTokenService.translateOutgoingDecimals', () => {
  const cases: ReadonlyArray<{ decimals: number; amount: bigint; expected: bigint; label: string }> = [
    { decimals: 6, amount: 10n ** 12n, expected: 1n, label: 'decimals < 18 → divide by 10^(18-d)' },
    { decimals: 18, amount: 5n, expected: 5n, label: 'decimals === 18 (boundary, no-op)' },
    { decimals: 24, amount: 1n, expected: 10n ** 6n, label: 'decimals > 18 → multiply by 10^(d-18)' },
  ];

  it.each(cases)('$label (d=$decimals, amt=$amount → $expected)', ({ decimals, amount, expected }) => {
    expect(EvmVaultTokenService.translateOutgoingDecimals(decimals, amount)).toBe(expected);
  });
});
