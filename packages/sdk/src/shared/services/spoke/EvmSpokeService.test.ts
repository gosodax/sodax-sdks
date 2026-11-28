/**
 * Tests for EvmSpokeService — handles all EVM spoke chains (Ethereum, Arbitrum, Base, BSC,
 * Optimism, Polygon, Avalanche, HyperEVM, Lightlink, Redbelly, Kaia, Hedera, Robinhood). Sonic is
 * the hub and is covered by SonicSpokeService.test.ts.
 *
 *   1. **Cache mechanism** (constructPublicClient, getPublicClient) — single chain (ARB).
 *   2. **Method behaviour** — every branch of every method, on ARB: the code paths do not depend
 *      on the chain, so a regression surfaces identically on every chain.
 *   3. **Hedera native msg.value scaling** — the one chain-specific branch in the class.
 *   4. **Per-chain config routing** — sweeps every EVM spoke for the per-chain regressions that
 *      remain: hardcoded addresses, wrong-chain config lookups, cache keyed wrong, viem-chain holes.
 *
 * Mocking: only `Erc20Service.isAllowanceValid` is mocked at its source path (wrapped by
 * `isAllowanceValid`). viem's `createPublicClient` runs against the real impl — transport
 * construction is lazy, so no network calls fire until a method is invoked (always spied per-test).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ChainKeys,
  getIntentRelayChainId,
  spokeChainConfig,
  type Address,
  type EvmSpokeOnlyChainKey,
  type Hex,
  type IEvmWalletProvider,
  type XToken,
} from '@sodax/types';
import { encodeFunctionData } from 'viem';
import { connectionAbi, erc20Abi, spokeAssetManagerAbi } from '../../abis/index.js';

// --- hoisted mocks --------------------------------------------------------

const mocks = vi.hoisted(() => ({
  erc20IsAllowanceValid: vi.fn(),
}));

vi.mock('../erc-20/Erc20Service.js', async () => {
  const actual = await vi.importActual<object>('../erc-20/Erc20Service.js');
  return {
    ...actual,
    Erc20Service: {
      isAllowanceValid: mocks.erc20IsAllowanceValid,
    },
  };
});

import { Sodax } from '../../entities/Sodax.js';
import { getEvmViemChain } from '../../utils/constant-utils.js';
import { EvmSpokeService } from './EvmSpokeService.js';
import type { DepositParams } from '../../types/spoke-types.js';

// --- fixtures -------------------------------------------------------------

const sodax = new Sodax();
const evmSpoke = sodax.spoke.evm;

// ARB is the canonical sample chain for chain-independent tests.
const ARB = ChainKeys.ARBITRUM_MAINNET;
const SONIC = ChainKeys.SONIC_MAINNET; // sendMessage destination (hub chain)
const HEDERA = ChainKeys.HEDERA_MAINNET; // the only chain that scales native msg.value

const arbConfig = spokeChainConfig[ARB];
const ARB_ASSET_MANAGER = arbConfig.addresses.assetManager as Address;
const ARB_CONNECTION = arbConfig.addresses.connection as Address;
const ARB_NATIVE = arbConfig.nativeToken as Address;
const ARB_RPC = arbConfig.rpcUrl;
// A real ERC-20 deployed on Arbitrum (sourced from chain config).
const ARB_TOKEN: Address = arbConfig.bnUSD as Address;

const hederaConfig = spokeChainConfig[HEDERA];
const HEDERA_ASSET_MANAGER = hederaConfig.addresses.assetManager as Address;
const HEDERA_NATIVE = hederaConfig.nativeToken as Address;

// Per-user / per-flow inputs — these represent test users and call destinations, not
// infrastructure, so they have no config source.
const SRC_ADDR: Address = '0x1111111111111111111111111111111111111111';
const HUB_WALLET: Address = '0x2222222222222222222222222222222222222222';
const DST_ADDR: Address = '0x3333333333333333333333333333333333333333';

const TX_HASH = '0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef' as const;

const transferCalldata = (token: Address, amount: bigint, data: Hex = '0x'): Hex =>
  encodeFunctionData({ abi: spokeAssetManagerAbi, functionName: 'transfer', args: [token, HUB_WALLET, amount, data] });
const sendMessageCalldata = (): Hex =>
  encodeFunctionData({
    abi: connectionAbi,
    functionName: 'sendMessage',
    args: [getIntentRelayChainId(SONIC), DST_ADDR, '0xpayload' as Hex],
  });

const mockEvmProvider = {
  chainType: 'EVM',
  sendTransaction: vi.fn(),
  getWalletAddress: vi.fn(),
  waitForTransactionReceipt: vi.fn(),
} as unknown as IEvmWalletProvider;

// Every EVM spoke chain. Sonic is intentionally NOT here — it's the hub chain and is covered
// by SonicSpokeService.test.ts. The `satisfies readonly EvmSpokeOnlyChainKey[]` constraint
// enforces the exclusion at compile time: adding SONIC_MAINNET (or any non-EVM-spoke key) fails
// typecheck.
const TEST_CHAINS = [
  ChainKeys.ETHEREUM_MAINNET,
  ChainKeys.ARBITRUM_MAINNET,
  ChainKeys.BASE_MAINNET,
  ChainKeys.OPTIMISM_MAINNET,
  ChainKeys.BSC_MAINNET,
  ChainKeys.POLYGON_MAINNET,
  ChainKeys.AVALANCHE_MAINNET,
  ChainKeys.HYPEREVM_MAINNET,
  ChainKeys.LIGHTLINK_MAINNET,
  ChainKeys.REDBELLY_MAINNET,
  ChainKeys.KAIA_MAINNET,
  ChainKeys.HEDERA_MAINNET,
  ChainKeys.ROBINHOOD_MAINNET,
] as const satisfies readonly EvmSpokeOnlyChainKey[];

// Warm the publicClients cache for ARB so test spies have a stable client reference; the cached
// PublicClient persists for the file lifetime while afterEach restores the spies.
const arbClient = evmSpoke.getPublicClient(ARB);

beforeEach(() => {
  vi.clearAllMocks();
  (mockEvmProvider.sendTransaction as ReturnType<typeof vi.fn>).mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

// =========================================================================
// 1. Cache mechanism (chain-independent)
// =========================================================================

describe('EvmSpokeService.constructPublicClient', () => {
  it('falls back to the viem chain default RPC when rpcUrl is omitted', () => {
    // The branch under test: `transport: http(rpcUrl ?? chain.rpcUrls.default.http[0])`.
    // Smoke-only — viem's default-RPC fallback can't be observed from outside.
    const fresh = new EvmSpokeService(sodax.config);
    expect(() => fresh.constructPublicClient({ chainId: ARB })).not.toThrow();
  });
});

describe('EvmSpokeService.getPublicClient', () => {
  it('lazily constructs once from the per-chain config rpcUrl, then returns the cached client', () => {
    const fresh = new EvmSpokeService(sodax.config);
    const constructSpy = vi.spyOn(fresh, 'constructPublicClient');

    const first = fresh.getPublicClient(ARB);
    const second = fresh.getPublicClient(ARB);

    expect(second).toBe(first);
    // Cache-hit branch must short-circuit before constructing again, and the URL must come from
    // `config.getChainConfig(chainId).rpcUrl`.
    expect(constructSpy).toHaveBeenCalledTimes(1);
    expect(constructSpy).toHaveBeenCalledWith({ chainId: ARB, rpcUrl: ARB_RPC });
  });
});

// =========================================================================
// 2. Method behaviour (run on ARB — the code paths do not depend on the chain; per-chain config
//    routing is pinned in section 4, Hedera's native scaling in its own suite)
// =========================================================================

describe('EvmSpokeService.estimateGas', () => {
  it('delegates to the cached publicClient.estimateGas, renaming from→account, bigint verbatim', async () => {
    const huge = 999_999_999_999_999_999n;
    const spy = vi.spyOn(arbClient, 'estimateGas').mockResolvedValueOnce(huge);

    const result = await evmSpoke.estimateGas({
      chainKey: ARB,
      tx: { from: SRC_ADDR, to: HUB_WALLET, value: 1n, data: '0xcafe' as Hex },
    });

    expect(result).toBe(huge);
    // viem expects `account` (not `from`); passing `from` directly would silently produce wrong estimates.
    expect(spy).toHaveBeenCalledWith({ account: SRC_ADDR, to: HUB_WALLET, value: 1n, data: '0xcafe' });
  });
});

describe('EvmSpokeService.isAllowanceValid', () => {
  const params = {
    chainKey: ARB,
    token: ARB_TOKEN,
    owner: SRC_ADDR,
    spender: ARB_ASSET_MANAGER,
    amount: 1_000n,
  };

  it('catches thrown errors and wraps them in ok:false (raw error, no Error coercion)', async () => {
    // ⚠️ NOTE: the catch returns `error: e` with the raw thrown value. Contrast with
    // waitForTransactionReceipt which wraps non-Errors via `new Error(String(error))`. This is
    // an inconsistency in EvmSpokeService — pinned here so a unifying refactor surfaces here.
    const thrown = new Error('rpc unavailable');
    mocks.erc20IsAllowanceValid.mockRejectedValueOnce(thrown);
    const result = await evmSpoke.isAllowanceValid(params);
    expect(result).toEqual({ ok: false, error: thrown });
  });
});

describe('EvmSpokeService.getDeposit', () => {
  it("reads balanceOf with the chain's assetManager as holder", async () => {
    const spy = vi.spyOn(arbClient, 'readContract').mockResolvedValueOnce(7_500n);

    const result = await evmSpoke.getDeposit({ srcChainKey: ARB, srcAddress: SRC_ADDR, token: ARB_TOKEN });

    expect(result).toBe(7_500n);
    // Holder is the per-chain spoke asset manager (NOT the token, NOT srcAddress). Contrasts
    // with SonicSpokeService.getDeposit which has a suspected v1 regression passing the token.
    expect(spy).toHaveBeenCalledWith({
      address: ARB_TOKEN,
      abi: erc20Abi,
      functionName: 'balanceOf',
      args: [ARB_ASSET_MANAGER],
    });
  });
});

describe('EvmSpokeService.deposit', () => {
  const depositParams = <Raw extends boolean>(
    overrides: Partial<DepositParams<typeof ARB, Raw>>,
  ): DepositParams<typeof ARB, Raw> =>
    ({
      srcAddress: SRC_ADDR,
      srcChainKey: ARB,
      to: HUB_WALLET,
      token: ARB_TOKEN,
      amount: 1_000n,
      data: '0x' as Hex,
      raw: false,
      walletProvider: mockEvmProvider,
      ...overrides,
    }) as DepositParams<typeof ARB, Raw>;

  it("ERC20 raw=true → rawTx targets the chain's assetManager with value=0n and never sends", async () => {
    const result = await evmSpoke.deposit(depositParams<true>({ raw: true }));

    expect(result).toEqual({
      from: SRC_ADDR,
      to: ARB_ASSET_MANAGER,
      value: 0n,
      data: transferCalldata(ARB_TOKEN, 1_000n),
    });
    expect(mockEvmProvider.sendTransaction).not.toHaveBeenCalled();
  });
});

// =========================================================================
// 3. Hedera native msg.value scaling (scaleNativeMsgValue)
// =========================================================================
//
// HBAR is accounted in 8 decimals but Hedera's EVM layer expects native msg.value in 18 decimals.
// EvmSpokeService.deposit therefore multiplies a *native* HBAR deposit's msg.value by 10^10, while
// leaving the asset-manager `transfer` calldata amount in 8 decimals. The three-way contract is
// pinned here with literal values (independent of the SUT's own constant):
//   - HBAR native deposit       → msg.value = amount * 10^10   (scaled), calldata amount unscaled
//   - non-native Hedera deposit → msg.value = 0n               (ERC-20 path, no scaling)
//   - non-Hedera native deposit → msg.value = amount           (existing behaviour, unscaled)
describe('EvmSpokeService.deposit — native msg.value (Hedera scaling)', () => {
  it('scales a native HBAR deposit msg.value by 10^10 while leaving the transfer amount in 8 decimals', async () => {
    const result = await evmSpoke.deposit<true>({
      srcAddress: SRC_ADDR,
      srcChainKey: HEDERA,
      to: HUB_WALLET,
      token: HEDERA_NATIVE,
      amount: 1_000n,
      data: '0x' as Hex,
      raw: true,
    });

    expect(result).toEqual({
      from: SRC_ADDR,
      to: HEDERA_ASSET_MANAGER,
      // 1_000n * 10^10. Literal so a change to HEDERA_NATIVE_VALUE_SCALE in the SUT can't silently agree with itself.
      value: 10_000_000_000_000n,
      // Calldata amount stays unscaled (8-decimal HBAR) — only msg.value is scaled.
      data: transferCalldata(HEDERA_NATIVE, 1_000n),
    });
  });

  it('passes a non-Hedera native deposit msg.value through unscaled, matching the native token case-insensitively', async () => {
    // Implementation: `token.toLowerCase() === chainConfig.nativeToken.toLowerCase()`. Dropping the
    // guard would send value=0 with a native calldata to the asset manager (a contract revert).
    const uppered = ARB_NATIVE.toUpperCase().replace('0X', '0x') as Address;
    for (const token of [ARB_NATIVE, uppered]) {
      const result = await evmSpoke.deposit<true>({
        srcAddress: SRC_ADDR,
        srcChainKey: ARB,
        to: HUB_WALLET,
        token,
        amount: 1_000n,
        data: '0x' as Hex,
        raw: true,
      });
      expect(result).toEqual({
        from: SRC_ADDR,
        to: ARB_ASSET_MANAGER,
        value: 1_000n,
        data: transferCalldata(token, 1_000n),
      });
    }
  });
});

describe('EvmSpokeService.sendMessage', () => {
  const baseParams = {
    srcAddress: SRC_ADDR,
    srcChainKey: ARB,
    dstChainKey: SONIC,
    dstAddress: DST_ADDR,
    payload: '0xpayload' as Hex,
  } as const;

  it('raw=false → walletProvider.sendTransaction receives the chain-bound connection rawTx', async () => {
    (mockEvmProvider.sendTransaction as ReturnType<typeof vi.fn>).mockResolvedValueOnce(TX_HASH);

    const result = await evmSpoke.sendMessage({ ...baseParams, raw: false, walletProvider: mockEvmProvider });

    expect(result).toBe(TX_HASH);
    expect(mockEvmProvider.sendTransaction).toHaveBeenCalledWith(
      { from: SRC_ADDR, to: ARB_CONNECTION, value: 0n, data: sendMessageCalldata() },
      { expectedChainId: getEvmViemChain(ARB).id },
    );
  });
});

describe('EvmSpokeService.waitForTransactionReceipt — branches & mapping', () => {
  // Minimal viem TransactionReceipt-ish shape. Cast through `as never` because viem's full
  // receipt type has ~20 fields none of which matter for the mapping branches under test.
  const baseReceipt = {
    status: 'success' as const,
    transactionIndex: 5,
    blockNumber: 1_000_000n,
    cumulativeGasUsed: 21_000n,
    gasUsed: 21_000n,
    contractAddress: null as Address | null,
    effectiveGasPrice: 7n,
    logs: [],
  };

  it('maps a successful receipt to status:success with stringified bigints on the receipt and each log', async () => {
    vi.spyOn(arbClient, 'waitForTransactionReceipt').mockResolvedValueOnce({
      ...baseReceipt,
      contractAddress: '0xabcabcabcabcabcabcabcabcabcabcabcabcabca' as Address,
      logs: [
        {
          address: '0xlogaddrlogaddrlogaddrlogaddrlogaddr00' as Address,
          blockNumber: 999n,
          logIndex: 2,
          transactionIndex: 5,
          topics: [],
          data: '0x' as Hex,
        },
      ],
    } as never);

    const result = await evmSpoke.waitForTransactionReceipt({ chainKey: ARB, txHash: TX_HASH });

    if (!result.ok) throw new Error('expected ok');
    if (result.value.status !== 'success') throw new Error('expected success');
    // Every bigint field is `.toString()`-coerced — receipts cross the JSON boundary in some
    // callers, so bigints would throw. Pin the coercion for each field.
    expect(result.value.receipt.transactionIndex).toBe('5');
    expect(result.value.receipt.blockNumber).toBe('1000000');
    expect(result.value.receipt.cumulativeGasUsed).toBe('21000');
    expect(result.value.receipt.gasUsed).toBe('21000');
    expect(result.value.receipt.effectiveGasPrice).toBe('7');
    expect(result.value.receipt.contractAddress).toBe('0xabcabcabcabcabcabcabcabcabcabcabcabcabca');
    expect(result.value.receipt.logs[0]).toMatchObject({ blockNumber: '999', logIndex: '2', transactionIndex: '5' });
  });

  it('keeps a null contractAddress null and an undefined effectiveGasPrice undefined (fallback branches)', async () => {
    vi.spyOn(arbClient, 'waitForTransactionReceipt').mockResolvedValueOnce({
      ...baseReceipt,
      contractAddress: null,
      effectiveGasPrice: undefined,
    } as never);

    const result = await evmSpoke.waitForTransactionReceipt({ chainKey: ARB, txHash: TX_HASH });

    if (!result.ok || result.value.status !== 'success') throw new Error('expected ok+success');
    expect(result.value.receipt.contractAddress).toBeNull();
    expect(result.value.receipt.effectiveGasPrice).toBeUndefined();
  });

  it('returns status:failure when receipt.status === "reverted"', async () => {
    vi.spyOn(arbClient, 'waitForTransactionReceipt').mockResolvedValueOnce({
      ...baseReceipt,
      status: 'reverted',
    } as never);

    const result = await evmSpoke.waitForTransactionReceipt({ chainKey: ARB, txHash: TX_HASH });

    if (!result.ok) throw new Error('expected ok');
    expect(result.value.status).toBe('failure');
    if (result.value.status !== 'failure') return;
    expect(result.value.error).toBeInstanceOf(Error);
    expect((result.value.error as Error).message).toBe('Transaction reverted');
  });

  it('returns status:timeout when the thrown error message contains "timed out"', async () => {
    const timeoutErr = new Error('Transaction not received: timed out after 30s');
    vi.spyOn(arbClient, 'waitForTransactionReceipt').mockRejectedValueOnce(timeoutErr);

    const result = await evmSpoke.waitForTransactionReceipt({ chainKey: ARB, txHash: TX_HASH });

    if (!result.ok) throw new Error('expected ok');
    expect(result.value.status).toBe('timeout');
    if (result.value.status !== 'timeout') return;
    expect(result.value.error).toBe(timeoutErr);
  });

  it('returns status:failure for other throws, wrapping non-Errors into new Error(String(thrown))', async () => {
    const otherErr = new Error('connection refused');
    vi.spyOn(arbClient, 'waitForTransactionReceipt').mockRejectedValueOnce(otherErr).mockRejectedValueOnce('boom');

    const fromError = await evmSpoke.waitForTransactionReceipt({ chainKey: ARB, txHash: TX_HASH });
    const fromString = await evmSpoke.waitForTransactionReceipt({ chainKey: ARB, txHash: TX_HASH });

    if (!fromError.ok || fromError.value.status !== 'failure') throw new Error('expected ok+failure');
    expect(fromError.value.error).toBe(otherErr);
    if (!fromString.ok || fromString.value.status !== 'failure') throw new Error('expected ok+failure');
    expect(fromString.value.error).toBeInstanceOf(Error);
    expect((fromString.value.error as Error).message).toBe('boom');
  });
});

// =========================================================================
// 4. Per-chain config routing — every EVM spoke, one pass each
// =========================================================================
// Sections 2-3 run the chain-independent paths once; these sweep every spoke for per-chain config
// slips: a hardcoded address, a snapshotted chainKey, a mis-keyed cache or a `getEvmViemChain()` hole.

describe('EvmSpokeService — per-chain config routing', () => {
  it('getPublicClient returns a distinct cached instance for every chain (all-pairs)', () => {
    // All-pairs comparison catches a map keyed wrong even if only some entries collide.
    const clients = TEST_CHAINS.map(k => evmSpoke.getPublicClient(k));
    for (let i = 0; i < clients.length; i++) {
      for (let j = i + 1; j < clients.length; j++) {
        expect(clients[i]).not.toBe(clients[j]);
      }
    }
  });

  it("deposit and sendMessage on every chain target that chain's assetManager / connection and chain id", async () => {
    const configSpy = vi.spyOn(sodax.config, 'getChainConfig');
    const send = mockEvmProvider.sendTransaction as ReturnType<typeof vi.fn>;
    send.mockResolvedValue(TX_HASH);

    for (const chainKey of TEST_CHAINS) {
      const { addresses, bnUSD } = spokeChainConfig[chainKey];
      const token = bnUSD as Address;
      send.mockClear();

      await evmSpoke.deposit({
        srcAddress: SRC_ADDR,
        srcChainKey: chainKey,
        to: HUB_WALLET,
        token,
        amount: 1_000n,
        data: '0x' as Hex,
        raw: false,
        walletProvider: mockEvmProvider,
      });
      expect(send).toHaveBeenCalledWith(
        { from: SRC_ADDR, to: addresses.assetManager, value: 0n, data: transferCalldata(token, 1_000n) },
        { expectedChainId: getEvmViemChain(chainKey).id },
      );
      expect(configSpy).toHaveBeenCalledWith(chainKey);

      const message = await evmSpoke.sendMessage({
        srcAddress: SRC_ADDR,
        srcChainKey: chainKey,
        dstChainKey: SONIC,
        dstAddress: DST_ADDR,
        payload: '0xpayload' as Hex,
        raw: true,
      });
      expect(message).toEqual({
        from: SRC_ADDR,
        to: addresses.connection,
        value: 0n,
        data: sendMessageCalldata(),
      });
    }
  });
});

// getWalletBalance / getWalletBalances read the USER's wallet holdings (native + erc20), in
// contrast to getDeposit which reads the asset-manager holding. The native-vs-token branch and
// the multicall batching are chain-independent, so they run on ARB (plus a Hedera native-scale
// case), matching this file's chain-independent-branch convention.
describe('EvmSpokeService.getWalletBalance / getWalletBalances', () => {
  const xtoken = (address: Address, chainKey: EvmSpokeOnlyChainKey, symbol = 'TKN'): XToken => ({
    symbol,
    name: symbol,
    decimals: 18,
    address,
    chainKey,
    hubAsset: address,
    vault: address,
  });

  it('reads the native coin via getBalance and an erc20 via balanceOf, both with the USER as holder', async () => {
    const nativeSpy = vi.spyOn(arbClient, 'getBalance').mockResolvedValueOnce(1_234n);
    const spy = vi.spyOn(arbClient, 'readContract').mockResolvedValueOnce(5_000n);

    expect(
      await evmSpoke.getWalletBalance({ srcChainKey: ARB, srcAddress: SRC_ADDR, token: xtoken(ARB_NATIVE, ARB) }),
    ).toBe(1_234n);
    expect(nativeSpy).toHaveBeenCalledWith({ address: SRC_ADDR });

    const result = await evmSpoke.getWalletBalance({
      srcChainKey: ARB,
      srcAddress: SRC_ADDR,
      token: xtoken(ARB_TOKEN, ARB),
    });

    expect(result).toBe(5_000n);
    // Holder is srcAddress (the user), NOT the asset manager — the key difference from getDeposit.
    expect(spy).toHaveBeenCalledWith({
      address: ARB_TOKEN,
      abi: erc20Abi,
      functionName: 'balanceOf',
      args: [SRC_ADDR],
    });
  });

  it('scales the native balance down by 10^10 on Hedera', async () => {
    const hederaClient = evmSpoke.getPublicClient(HEDERA);
    vi.spyOn(hederaClient, 'getBalance').mockResolvedValueOnce(50_000_000_000n); // 5 HBAR in 18-dec weibar

    const result = await evmSpoke.getWalletBalance({
      srcChainKey: HEDERA,
      srcAddress: SRC_ADDR,
      token: xtoken(HEDERA_NATIVE, HEDERA),
    });

    expect(result).toBe(5n); // 50_000_000_000 / 10^10
  });

  it('batches non-native tokens through multicall3 and merges native balances', async () => {
    const nativeSpy = vi.spyOn(arbClient, 'getBalance').mockResolvedValueOnce(100n);
    const multicallSpy = vi
      .spyOn(arbClient, 'multicall')
      .mockResolvedValueOnce([{ status: 'success', result: 700n }] as never);

    const result = await evmSpoke.getWalletBalances({
      srcChainKey: ARB,
      srcAddress: SRC_ADDR,
      tokens: [xtoken(ARB_NATIVE, ARB, 'ETH'), xtoken(ARB_TOKEN, ARB, 'bnUSD')],
    });

    expect(result).toEqual({
      [ARB_NATIVE]: 100n,
      [ARB_TOKEN]: 700n,
    });
    expect(nativeSpy).toHaveBeenCalledWith({ address: SRC_ADDR });
    expect(multicallSpy).toHaveBeenCalledWith({
      contracts: [{ abi: erc20Abi, address: ARB_TOKEN, functionName: 'balanceOf', args: [SRC_ADDR] }],
    });
  });

  it('reports a failed multicall entry as 0n and logs it, keeping the tokens that did resolve', async () => {
    const warnSpy = vi.spyOn(sodax.config.logger, 'warn').mockImplementation(() => {});
    vi.spyOn(arbClient, 'getBalance').mockResolvedValueOnce(100n);
    // viem fans a rejected aggregate3 chunk out as one failure entry per call in that chunk.
    const rpcError = new Error('HTTP 429');
    vi.spyOn(arbClient, 'multicall').mockResolvedValueOnce([
      { status: 'failure', error: rpcError, result: undefined },
    ] as never);

    const result = await evmSpoke.getWalletBalances({
      srcChainKey: ARB,
      srcAddress: SRC_ADDR,
      tokens: [xtoken(ARB_NATIVE, ARB, 'ETH'), xtoken(ARB_TOKEN, ARB, 'bnUSD')],
    });

    expect(result[ARB_NATIVE]).toBe(100n);
    expect(result[ARB_TOKEN]).toBe(0n);
    // The zero is indistinguishable from an empty wallet, so the log line is the only signal a
    // read failed — assert it fired for that token, or a silent zero could regress unnoticed.
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('balance read failed'),
      expect.objectContaining({ chainKey: ARB, token: ARB_TOKEN, error: rpcError.message }),
    );
  });

  it('rejects when no token in the batch could be read (a dead RPC must not look like an empty wallet)', async () => {
    vi.spyOn(sodax.config.logger, 'warn').mockImplementation(() => {});
    vi.spyOn(arbClient, 'getBalance').mockRejectedValueOnce(new Error('HTTP 429'));
    vi.spyOn(arbClient, 'multicall').mockResolvedValueOnce([
      { status: 'failure', error: new Error('HTTP 429'), result: undefined },
    ] as never);

    await expect(
      evmSpoke.getWalletBalances({
        srcChainKey: ARB,
        srcAddress: SRC_ADDR,
        tokens: [xtoken(ARB_NATIVE, ARB, 'ETH'), xtoken(ARB_TOKEN, ARB, 'bnUSD')],
      }),
    ).rejects.toThrow(`every balance read failed on ${ARB}`);
  });
});
