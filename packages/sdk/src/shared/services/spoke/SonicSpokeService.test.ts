/**
 * Tests for SonicSpokeService — the hub-chain (Sonic) spoke service.
 *
 * Mirrors the pattern from SwapService.test.ts (PR #1174):
 *   1. A single `new Sodax()` instance backs every test. Instance methods are exercised on
 *      `sodax.spoke.sonic`; the publicClient lives there and is spied per-test.
 *   2. Static collaborators (`Erc20Service`, `EvmSolverService`, `IntentDataService`, `randomUint256`)
 *      are spied per-test on their classes / module namespace.
 *   3. Every method has a top-level `describe` covering each branch the implementation forks on:
 *      `isSonicChainKey(...)` guards, native-vs-ERC20 token paths, raw-vs-exec discriminant,
 *      `try/catch` error handling, and `?? null` / `?.toString()` fallbacks. These are exactly the
 *      "deviates from common flow" branches where v1→v2 regressions hide.
 *
 * NOTE: a suspected v1 regression in `getDeposit` is flagged inline — see that describe block.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ChainKeys,
  spokeChainConfig,
  tronSupportedTokens,
  type Address,
  type Hex,
  type IEvmWalletProvider,
  type PartnerFee,
  type SolverConfig,
  type SonicChainKey,
  type SpokeChainKey,
} from '@sodax/types';
import { encodeFunctionData, erc20Abi } from 'viem';
import { wrappedSonicAbi, sonicWalletFactoryAbi } from '../../abis/index.js';
import { Sodax } from '../../entities/Sodax.js';
import { SonicSpokeService } from './SonicSpokeService.js';
import * as sharedUtils from '../../utils/shared-utils.js';
import { encodeAddress } from '../../utils/shared-utils.js';
import { encodeContractCalls } from '../../utils/evm-utils.js';
import { Erc20Service } from '../erc-20/Erc20Service.js';
import { EvmSolverService } from '../../../swap/EvmSolverService.js';
import { IntentDataService } from '../../../swap/IntentDataService.js';
import { expectOk } from '../../../test-utils/result.js';
import { mockEvmWalletProvider } from '../../../test-utils/walletProviders.js';
import type { CreateIntentParams } from '../../types/intent-types.js';
import type { DepositParams, SendMessageParams } from '../../types/spoke-types.js';
import { TRON_TEST_ADDRESS } from './tron-test-fixtures.js';

// --- fixtures -------------------------------------------------------------

const sodax = new Sodax();
const sonicSpoke = sodax.spoke.sonic;

// SonicSpokeService.deposit and .sendMessage both decode `data` as a calls tuple; an empty one
// covers the "no extra calls" path while still satisfying the decoder.
const emptyCallsData: Hex = encodeContractCalls([]);

const SONIC = ChainKeys.SONIC_MAINNET;
const sonicConfig = spokeChainConfig[SONIC];
const SONIC_NATIVE = sonicConfig.nativeToken as Address;
const SONIC_WRAPPED = sonicConfig.addresses.wrappedSonic as Address;
const SONIC_WALLET_ROUTER = sonicConfig.addresses.walletRouter as Address;

const SRC_ADDR: Address = '0x1111111111111111111111111111111111111111';
const HUB_WALLET: Address = '0x2222222222222222222222222222222222222222';
const ERC20_TOKEN: Address = '0x3333333333333333333333333333333333333333';
const TX_HASH = '0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef' as const;

let mockEvmProvider: IEvmWalletProvider;

const fakeTransferFromCall = {
  address: ERC20_TOKEN,
  value: 0n,
  data: '0xtransferfrom' as Hex,
};

beforeEach(() => {
  vi.clearAllMocks();
  mockEvmProvider = mockEvmWalletProvider();
  // Sensible defaults — individual tests override per-call. The deposit() ERC20 branch prepends
  // `encodeTransferFrom`; createSwapIntent folds `createIntentFeeData` into `composeIntentData`,
  // encodes via `encodeCreateIntent`, and mints the intentId with `randomUint256` (deterministic here).
  vi.spyOn(Erc20Service, 'encodeTransferFrom').mockReturnValue(fakeTransferFromCall);
  vi.spyOn(EvmSolverService, 'createIntentFeeData').mockReturnValue(['0xfeeenvelope' as Hex, 0n]);
  vi.spyOn(IntentDataService, 'composeIntentData').mockReturnValue('0xfeedata' as Hex);
  vi.spyOn(EvmSolverService, 'encodeCreateIntent').mockReturnValue({
    address: '0x6382D6ccD780758C5e8A6123c33ee8F4472F96ef' as Address,
    value: 0n,
    data: '0xintentcalldata' as Hex,
  });
  vi.spyOn(sharedUtils, 'randomUint256').mockReturnValue(42n);
});

afterEach(() => {
  vi.restoreAllMocks();
});

// =========================================================================
// isAllowanceValid — try/catch wrapper around Erc20Service
// =========================================================================

describe('SonicSpokeService.isAllowanceValid', () => {
  const params = {
    chainKey: SONIC,
    token: ERC20_TOKEN,
    owner: SRC_ADDR,
    spender: '0x9999999999999999999999999999999999999999' as Address,
    amount: 1_000n,
  };

  it('catches thrown errors and wraps them in ok:false', async () => {
    const thrown = new Error('rpc unavailable');
    vi.spyOn(Erc20Service, 'isAllowanceValid').mockRejectedValueOnce(thrown);
    const result = await sonicSpoke.isAllowanceValid(params);
    expect(result).toEqual({ ok: false, error: thrown });
  });
});

// =========================================================================
// waitForTransactionReceipt — 5 distinct branches
// =========================================================================

describe('SonicSpokeService.waitForTransactionReceipt', () => {
  // Minimal viem TransactionReceipt shape — we cast through `as never` because viem's type has
  // ~20 fields we don't care about. The test only exercises the field-mapping branches.
  const baseReceipt = {
    status: 'success' as const,
    transactionIndex: 5,
    blockNumber: 1_000_000n,
    cumulativeGasUsed: 21_000n,
    gasUsed: 21_000n,
    contractAddress: null,
    effectiveGasPrice: 7n,
    logs: [],
  };

  it('maps a successful receipt to status: success with stringified bigints on the receipt and each log', async () => {
    vi.spyOn(sonicSpoke.publicClient, 'waitForTransactionReceipt').mockResolvedValueOnce({
      ...baseReceipt,
      contractAddress: '0xabcabcabcabcabcabcabcabcabcabcabcabcabca' as Address,
      logs: [
        {
          address: '0xlog' as Address,
          blockNumber: 999n,
          logIndex: 2,
          transactionIndex: 5,
          topics: [],
          data: '0x' as Hex,
        },
      ],
    } as never);

    const value = expectOk(await sonicSpoke.waitForTransactionReceipt({ chainKey: SONIC, txHash: TX_HASH }));

    expect(value.status).toBe('success');
    if (value.status !== 'success') return;
    expect(value.receipt.transactionIndex).toBe('5');
    expect(value.receipt.blockNumber).toBe('1000000');
    expect(value.receipt.cumulativeGasUsed).toBe('21000');
    expect(value.receipt.gasUsed).toBe('21000');
    expect(value.receipt.effectiveGasPrice).toBe('7');
    expect(value.receipt.contractAddress).toBe('0xabcabcabcabcabcabcabcabcabcabcabcabcabca');
    expect(value.receipt.logs[0]).toMatchObject({
      blockNumber: '999',
      logIndex: '2',
      transactionIndex: '5',
    });
  });

  it('keeps a null contractAddress null and an undefined effectiveGasPrice undefined (fallback branches)', async () => {
    vi.spyOn(sonicSpoke.publicClient, 'waitForTransactionReceipt').mockResolvedValueOnce({
      ...baseReceipt,
      contractAddress: null,
      effectiveGasPrice: undefined,
    } as never);

    const value = expectOk(await sonicSpoke.waitForTransactionReceipt({ chainKey: SONIC, txHash: TX_HASH }));

    if (value.status !== 'success') throw new Error('expected success');
    expect(value.receipt.contractAddress).toBeNull();
    expect(value.receipt.effectiveGasPrice).toBeUndefined();
  });

  it('maps a reverted receipt and a non-timeout throw to failure (wrapping non-Errors), and a "timed out" throw to timeout', async () => {
    const timeoutErr = new Error('Transaction not received: timed out after 30s');
    const otherErr = new Error('connection refused');
    vi.spyOn(sonicSpoke.publicClient, 'waitForTransactionReceipt')
      .mockResolvedValueOnce({ ...baseReceipt, status: 'reverted' } as never)
      .mockRejectedValueOnce(timeoutErr)
      .mockRejectedValueOnce(otherErr)
      .mockRejectedValueOnce('boom');
    const wait = async () => expectOk(await sonicSpoke.waitForTransactionReceipt({ chainKey: SONIC, txHash: TX_HASH }));

    const reverted = await wait();
    const timedOut = await wait();
    const fromError = await wait();
    const fromString = await wait();

    if (reverted.status !== 'failure') throw new Error('reverted: expected failure');
    expect(reverted.error).toBeInstanceOf(Error);
    expect(reverted.error.message).toBe('Transaction reverted');
    if (timedOut.status !== 'timeout') throw new Error('timed out: expected timeout');
    expect(timedOut.error).toBe(timeoutErr);
    if (fromError.status !== 'failure' || fromString.status !== 'failure') throw new Error('throws: expected failure');
    expect(fromError.error).toBe(otherErr);
    expect(fromString.error).toBeInstanceOf(Error);
    expect(fromString.error.message).toBe('boom');
  });

  it('forwards custom pollingIntervalMs / maxTimeoutMs to viem, falling back to the chain polling config', async () => {
    const spy = vi.spyOn(sonicSpoke.publicClient, 'waitForTransactionReceipt').mockResolvedValue(baseReceipt as never);

    await sonicSpoke.waitForTransactionReceipt({
      chainKey: SONIC,
      txHash: TX_HASH,
      pollingIntervalMs: 123,
      maxTimeoutMs: 4_567,
    });
    await sonicSpoke.waitForTransactionReceipt({ chainKey: SONIC, txHash: TX_HASH });

    expect(spy).toHaveBeenNthCalledWith(1, { hash: TX_HASH, pollingInterval: 123, timeout: 4_567 });
    expect(spy).toHaveBeenNthCalledWith(2, {
      hash: TX_HASH,
      pollingInterval: sonicConfig.pollingConfig.pollingIntervalMs,
      timeout: sonicConfig.pollingConfig.maxTimeoutMs,
    });
  });
});

// =========================================================================
// getUserRouter — readContract delegation
// =========================================================================

describe('SonicSpokeService.getUserRouter', () => {
  it('reads the deployed user-router address from the wallet factory', async () => {
    const expected = '0xrouterrouterrouterrouterrouterrouterrouter' as Address;
    const spy = vi.spyOn(sonicSpoke.publicClient, 'readContract').mockResolvedValueOnce(expected);

    const result = await sonicSpoke.getUserRouter({ chainId: SONIC, address: SRC_ADDR });

    expect(result).toBe(expected);
    expect(spy).toHaveBeenCalledWith({
      address: SONIC_WALLET_ROUTER,
      abi: sonicWalletFactoryAbi,
      functionName: 'getDeployedAddress',
      args: [SRC_ADDR],
    });
  });
});

// =========================================================================
// getDeposit — ⚠️ FLAGGED v1 REGRESSION SUSPECT
// =========================================================================
//
// Current implementation:
//
//     args: [params.token]   // queries the token contract's self-balance
//
// Compare EvmSpokeService.getDeposit which uses
//
//     args: [spokeChainConfig[srcChainKey].addresses.assetManager]
//
// Self-balance is meaningless for a user "deposit" query — this almost certainly should be
// `params.srcAddress` (or the user's hub wallet abstraction address). Pinning the current
// behavior here so the test suite stays green while flagging the suspected bug; once your
// senior dev confirms the intended target, flip the assertion.

describe('SonicSpokeService.getDeposit', () => {
  it('reads ERC20.balanceOf — currently passes params.token as the holder (suspected v1 regression)', async () => {
    const spy = vi.spyOn(sonicSpoke.publicClient, 'readContract').mockResolvedValueOnce(777n);

    const result = await sonicSpoke.getDeposit({ srcChainKey: SONIC, srcAddress: SRC_ADDR, token: ERC20_TOKEN });

    expect(result).toBe(777n);
    // Documents the buggy current behavior. Once fixed, swap `args` to expect [SRC_ADDR] (or
    // whatever the corrected holder is) — the test will then drive the fix.
    expect(spy).toHaveBeenCalledWith(
      expect.objectContaining({
        address: ERC20_TOKEN,
        functionName: 'balanceOf',
        args: [ERC20_TOKEN],
      }),
    );
  });
});

// =========================================================================
// getWalletBalance / getWalletBalances — the USER's own hub-chain holdings
// =========================================================================
//
// Sibling of getDeposit above, and the contrast is the whole point: these read `srcAddress`
// (the wallet owner), never a protocol-held address. Sonic's viem chain declares a multicall3
// deployment, so every non-native read goes through the batched branch.
//
// `getWalletBalances` returns a flat `Record<string, bigint>`: an unreadable token collapses to
// `0n`, so each of those tests also asserts the SDK logger fired — that warning is the only thing
// separating a failure from an empty wallet, and a silent zero is the regression to catch.

describe('SonicSpokeService.getWalletBalance / getWalletBalances', () => {
  const NATIVE_S = sonicConfig.supportedTokens.S;
  const USDC = sonicConfig.supportedTokens.USDC;
  const USDT = sonicConfig.supportedTokens.USDT;

  const spyOnBalanceWarning = () => vi.spyOn(sodax.config.logger, 'warn').mockImplementation(() => {});

  const expectLoggedFailure = (
    warnSpy: ReturnType<typeof spyOnBalanceWarning>,
    tokenAddress: string,
    message: string,
  ) =>
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('balance read failed'),
      expect.objectContaining({ chainKey: SONIC, token: tokenAddress, error: message }),
    );

  it('reads native S via getBalance and an erc20 via balanceOf, both on the USER address', async () => {
    const nativeSpy = vi.spyOn(sonicSpoke.publicClient, 'getBalance').mockResolvedValueOnce(1_234n);
    const spy = vi.spyOn(sonicSpoke.publicClient, 'readContract').mockResolvedValueOnce(5_000n);

    expect(await sonicSpoke.getWalletBalance({ srcChainKey: SONIC, srcAddress: SRC_ADDR, token: NATIVE_S })).toBe(
      1_234n,
    );
    expect(nativeSpy).toHaveBeenCalledWith({ address: SRC_ADDR });

    const result = await sonicSpoke.getWalletBalance({ srcChainKey: SONIC, srcAddress: SRC_ADDR, token: USDC });

    expect(result).toBe(5_000n);
    // The holder is srcAddress, not the token contract getDeposit passes — the only difference
    // between the two reads, and the one that decides whose money the UI shows.
    expect(spy).toHaveBeenCalledWith({
      address: USDC.address,
      abi: erc20Abi,
      functionName: 'balanceOf',
      args: [SRC_ADDR],
    });
  });

  it('batches non-native tokens through multicall3 and merges the native entry', async () => {
    const nativeSpy = vi.spyOn(sonicSpoke.publicClient, 'getBalance').mockResolvedValueOnce(100n);
    const multicallSpy = vi.spyOn(sonicSpoke.publicClient, 'multicall').mockResolvedValueOnce([
      { status: 'success', result: 700n },
      { status: 'success', result: 900n },
    ] as never);

    const result = await sonicSpoke.getWalletBalances({
      srcChainKey: SONIC,
      srcAddress: SRC_ADDR,
      tokens: [NATIVE_S, USDC, USDT],
    });

    expect(result).toEqual({
      [NATIVE_S.address]: 100n,
      [USDC.address]: 700n,
      [USDT.address]: 900n,
    });
    expect(nativeSpy).toHaveBeenCalledWith({ address: SRC_ADDR });
    // Native S must never reach multicall3 — there is no balanceOf to call on address zero.
    expect(multicallSpy).toHaveBeenCalledWith({
      contracts: [
        { abi: erc20Abi, address: USDC.address, functionName: 'balanceOf', args: [SRC_ADDR] },
        { abi: erc20Abi, address: USDT.address, functionName: 'balanceOf', args: [SRC_ADDR] },
      ],
    });
  });

  it('reports a failed or missing multicall entry as a logged 0n, never as a silent zero balance', async () => {
    const warnSpy = spyOnBalanceWarning();
    vi.spyOn(sonicSpoke.publicClient, 'getBalance').mockResolvedValueOnce(100n);
    // viem fans a rejected aggregate3 chunk out as one failure entry per call in that chunk.
    const rpcError = new Error('HTTP 429');
    vi.spyOn(sonicSpoke.publicClient, 'multicall')
      .mockResolvedValueOnce([
        { status: 'success', result: 700n },
        { status: 'failure', error: rpcError, result: undefined },
      ] as never)
      .mockResolvedValueOnce([{ status: 'success', result: 700n }] as never);

    const failed = await sonicSpoke.getWalletBalances({
      srcChainKey: SONIC,
      srcAddress: SRC_ADDR,
      tokens: [NATIVE_S, USDC, USDT],
    });

    // One bad entry must not discard the reads that did resolve.
    expect(failed[NATIVE_S.address]).toBe(100n);
    expect(failed[USDC.address]).toBe(700n);
    // The 0n is indistinguishable from an empty wallet in the map, so the log line is the contract.
    expect(failed[USDT.address]).toBe(0n);
    expectLoggedFailure(warnSpy, USDT.address, 'HTTP 429');
    expect(warnSpy).toHaveBeenCalledTimes(1);

    // Fewer entries than tokens: the missing tail gets a synthesised failure.
    const short = await sonicSpoke.getWalletBalances({
      srcChainKey: SONIC,
      srcAddress: SRC_ADDR,
      tokens: [USDC, USDT],
    });

    expect(short[USDC.address]).toBe(700n);
    expect(short[USDT.address]).toBe(0n);
    expectLoggedFailure(warnSpy, USDT.address, `missing multicall result for ${USDT.address}`);
  });

  it('skips multicall entirely when every requested token is native', async () => {
    vi.spyOn(sonicSpoke.publicClient, 'getBalance').mockResolvedValueOnce(42n);
    const multicallSpy = vi.spyOn(sonicSpoke.publicClient, 'multicall');

    const result = await sonicSpoke.getWalletBalances({
      srcChainKey: SONIC,
      srcAddress: SRC_ADDR,
      tokens: [NATIVE_S],
    });

    expect(result).toEqual({ [NATIVE_S.address]: 42n });
    expect(multicallSpy).not.toHaveBeenCalled();
  });
});

// =========================================================================
// deposit (static) — the wrap-vs-transferFrom branch + raw discriminant
// =========================================================================

describe('SonicSpokeService.deposit (static)', () => {
  // Build deposit params parameterized by token + raw — most tests vary just these two.
  const depositParams = <Raw extends boolean>(
    overrides: Partial<DepositParams<SonicChainKey, Raw>>,
  ): DepositParams<SonicChainKey, Raw> =>
    ({
      srcAddress: SRC_ADDR,
      srcChainKey: SONIC,
      to: HUB_WALLET,
      token: ERC20_TOKEN,
      amount: 1_000n,
      data: emptyCallsData,
      raw: false,
      walletProvider: mockEvmProvider,
      ...overrides,
    }) as DepositParams<SonicChainKey, Raw>;

  describe('rejects on invalid inputs', () => {
    it('throws when srcChainKey is not a Sonic chain key (invariant)', async () => {
      await expect(
        sonicSpoke.deposit(
          depositParams<true>({
            srcChainKey: ChainKeys.BSC_MAINNET as unknown as SonicChainKey,
            raw: true,
          }),
        ),
      ).rejects.toThrow('[SonicSpokeService] invalid spoke provider');
    });
  });

  describe('native token branch', () => {
    it('prepends a wrap-native call and forwards `value: amount` when raw=true, matching case-insensitively', async () => {
      const upperNative = SONIC_NATIVE.toUpperCase() as Address;
      const result = await sonicSpoke.deposit(depositParams<true>({ token: SONIC_NATIVE, raw: true }));
      await sonicSpoke.deposit(depositParams<true>({ token: upperNative, raw: true }));

      // Erc20Service.encodeTransferFrom must NOT be touched on the native path.
      expect(Erc20Service.encodeTransferFrom).not.toHaveBeenCalled();
      expect(result).toEqual({
        from: SRC_ADDR,
        to: SONIC_WALLET_ROUTER,
        value: 1_000n,
        data: encodeFunctionData({
          abi: sonicWalletFactoryAbi,
          functionName: 'route',
          args: [
            [
              {
                addr: SONIC_WRAPPED,
                value: 1_000n,
                data: encodeFunctionData({ abi: wrappedSonicAbi, functionName: 'deposit' }),
              },
            ],
          ],
        }),
      });
    });
  });

  describe('ERC20 token branch', () => {
    it('prepends a transferFrom call and forwards `value: 0n` when raw=true, never sending', async () => {
      const result = await sonicSpoke.deposit(depositParams<true>({ raw: true }));

      expect(mockEvmProvider.sendTransaction).not.toHaveBeenCalled();
      expect(Erc20Service.encodeTransferFrom).toHaveBeenCalledWith(ERC20_TOKEN, SRC_ADDR, HUB_WALLET, 1_000n);
      expect(result).toEqual({
        from: SRC_ADDR,
        to: SONIC_WALLET_ROUTER,
        value: 0n,
        data: encodeFunctionData({
          abi: sonicWalletFactoryAbi,
          functionName: 'route',
          args: [
            [
              {
                addr: fakeTransferFromCall.address,
                value: fakeTransferFromCall.value,
                data: fakeTransferFromCall.data,
              },
            ],
          ],
        }),
      });
    });
  });

  describe('raw discriminant', () => {
    it('raw=false delegates to walletProvider.sendTransaction and returns its hash', async () => {
      vi.mocked(mockEvmProvider.sendTransaction).mockResolvedValueOnce(TX_HASH);

      const result = await sonicSpoke.deposit(depositParams<false>({ raw: false }));

      expect(result).toBe(TX_HASH);
      expect(mockEvmProvider.sendTransaction).toHaveBeenCalledTimes(1);
      // The rawTx passed to sendTransaction must be fully formed — assert the shape so a mutation
      // that drops `value` or `to` would be caught.
      const sent = vi.mocked(mockEvmProvider.sendTransaction).mock.calls[0]?.[0];
      expect(sent).toMatchObject({ from: SRC_ADDR, to: SONIC_WALLET_ROUTER, value: 0n });
    });
  });
});

// =========================================================================
// createSwapIntent (static) — Sonic-vs-non-Sonic dst, native-vs-ERC20 input,
// raw discriminant, fee deduction, invariants
// =========================================================================

describe('SonicSpokeService.createSwapIntent (static)', () => {
  const intentsContract = '0x6382D6ccD780758C5e8A6123c33ee8F4472F96ef' as Address;
  const solverConfig: SolverConfig = {
    intentsContract,
    solverApiEndpoint: 'https://api.example/solver',
    protocolIntentsContract: '0xaFf2EDb3057ed6f9C1dA6c930b8ddDf2beE573A5' as Address,
  };

  const baseHubProvider = {
    config: sodax.config,
    chainConfig: sodax.config.getHubChainConfig(),
  };

  const baseCreateIntentParams = <K extends SpokeChainKey>(
    srcChainKey: K,
    overrides?: Partial<CreateIntentParams<K>>,
  ) =>
    ({
      inputToken: ERC20_TOKEN,
      outputToken: '0x4444444444444444444444444444444444444444' as Address,
      inputAmount: 1_000_000n,
      minOutputAmount: 900_000n,
      deadline: 0n,
      allowPartialFill: false,
      srcChainKey,
      dstChainKey: SONIC,
      srcAddress: SRC_ADDR,
      dstAddress: '0x5555555555555555555555555555555555555555' as Address,
      solver: '0x0000000000000000000000000000000000000000' as Address,
      data: '0x' as Hex,
      ...overrides,
    }) as CreateIntentParams<K>;

  describe('happy paths', () => {
    it('Sonic→Sonic raw=true: outputToken passed through unchanged, intentId from randomUint256, nothing sent', async () => {
      const lookupSpy = vi.spyOn(sodax.config, 'getSpokeTokenFromOriginalAssetAddress');
      vi.mocked(sharedUtils.randomUint256).mockReturnValueOnce(7777n);

      const [rawTx, intent, feeAmount, data] = await SonicSpokeService.createSwapIntent({
        createIntentParams: baseCreateIntentParams(SONIC),
        creatorHubWalletAddress: HUB_WALLET,
        solverConfig,
        fee: undefined,
        hubProvider: baseHubProvider,
        raw: true,
      });

      expect(lookupSpy).not.toHaveBeenCalled();
      expect(mockEvmProvider.sendTransaction).not.toHaveBeenCalled();
      expect(intent.intentId).toBe(7777n);
      expect(intent.creator).toBe(HUB_WALLET);
      expect(intent.inputToken).toBe(ERC20_TOKEN);
      expect(intent.outputToken).toBe('0x4444444444444444444444444444444444444444');
      expect(feeAmount).toBe(0n);
      expect(data).toBe('0xintentcalldata');
      expect(rawTx).toMatchObject({ from: SRC_ADDR, to: intentsContract, data: '0xintentcalldata' });
    });

    it('non-Sonic dst: outputToken is resolved via getSpokeTokenFromOriginalAssetAddress.hubAsset', async () => {
      const hubAsset = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' as Address;
      vi.spyOn(sodax.config, 'getSpokeTokenFromOriginalAssetAddress').mockReturnValueOnce({
        symbol: 'X',
        decimals: 18,
        address: '0xb' as Address,
        hubAsset,
      } as unknown as ReturnType<typeof sodax.config.getSpokeTokenFromOriginalAssetAddress>);

      const params = baseCreateIntentParams(SONIC, {
        dstChainKey: ChainKeys.ARBITRUM_MAINNET,
      });

      const [, intent] = await SonicSpokeService.createSwapIntent({
        createIntentParams: params,
        creatorHubWalletAddress: HUB_WALLET,
        solverConfig,
        fee: undefined,
        hubProvider: baseHubProvider,
        raw: true,
      });

      expect(intent.outputToken).toBe(hubAsset);
    });

    it('MPC-relay (Tron) dst: dstAddress is the 32-byte recipient word (12 zero bytes ‖ 20-byte hash)', async () => {
      vi.spyOn(sodax.config, 'getSpokeTokenFromOriginalAssetAddress').mockReturnValueOnce(tronSupportedTokens.USDT);

      const [, intent] = await SonicSpokeService.createSwapIntent({
        createIntentParams: baseCreateIntentParams(SONIC, {
          dstChainKey: ChainKeys.TRON_MAINNET,
          dstAddress: TRON_TEST_ADDRESS,
          outputToken: tronSupportedTokens.USDT.address,
          minOutputAmount: 3_000_001n,
        }),
        creatorHubWalletAddress: HUB_WALLET,
        solverConfig,
        fee: undefined,
        hubProvider: baseHubProvider,
        raw: true,
      });

      const identity = encodeAddress(ChainKeys.TRON_MAINNET, TRON_TEST_ADDRESS);
      expect(intent.dstAddress).toBe(`0x${'00'.repeat(12)}${identity.slice(2)}`);
    });

    it('returns `inputAmount - feeAmount` as the intent inputAmount when a partner fee is configured', async () => {
      vi.mocked(EvmSolverService.createIntentFeeData).mockReturnValueOnce(['0xfeeenvelope' as Hex, 12_345n]);
      vi.mocked(IntentDataService.composeIntentData).mockReturnValueOnce('0xpartnerfee' as Hex);
      const fee: PartnerFee = {
        address: '0x9999999999999999999999999999999999999999' as Address,
        amount: 12_345n,
      };

      const [rawTx, intent, feeAmount, data] = await SonicSpokeService.createSwapIntent({
        createIntentParams: baseCreateIntentParams(SONIC),
        creatorHubWalletAddress: HUB_WALLET,
        solverConfig,
        fee,
        hubProvider: baseHubProvider,
        raw: true,
      });

      expect(EvmSolverService.createIntentFeeData).toHaveBeenCalledWith(fee, 1_000_000n);
      expect(IntentDataService.composeIntentData).toHaveBeenCalledWith('0xfeeenvelope', undefined);
      expect(feeAmount).toBe(12_345n);
      expect(intent.inputAmount).toBe(1_000_000n - 12_345n);
      expect(intent.data).toBe('0xpartnerfee');
      expect(data).toBe('0xintentcalldata');
      expect(rawTx).toBeDefined();
    });

    it('raw=false delegates to walletProvider.sendTransaction and returns the hash', async () => {
      vi.mocked(mockEvmProvider.sendTransaction).mockResolvedValueOnce(TX_HASH);

      const [tx, , feeAmount, data] = await SonicSpokeService.createSwapIntent({
        createIntentParams: baseCreateIntentParams(SONIC),
        creatorHubWalletAddress: HUB_WALLET,
        solverConfig,
        fee: undefined,
        hubProvider: baseHubProvider,
        raw: false,
        walletProvider: mockEvmProvider,
      });

      expect(tx).toBe(TX_HASH);
      expect(feeAmount).toBe(0n);
      expect(data).toBe('0xintentcalldata');
      expect(mockEvmProvider.sendTransaction).toHaveBeenCalledTimes(1);
    });
  });

  describe('native input token — value sets to inputAmount', () => {
    it('rawTx.value is inputAmount for the hub nativeToken (case-insensitively) and 0n for any other input', async () => {
      // Override the config to expose a native token we control.
      const native = '0x0000000000000000000000000000000000000000' as Address;
      const hubChainConfig = { ...sodax.config.getHubChainConfig(), nativeToken: native };
      const cases = [
        [native, 1_000_000n],
        [native.toUpperCase() as Address, 1_000_000n],
        [ERC20_TOKEN, 0n],
      ] as const;

      for (const [inputToken, value] of cases) {
        const [rawTx] = await SonicSpokeService.createSwapIntent({
          createIntentParams: baseCreateIntentParams(SONIC, { inputToken }),
          creatorHubWalletAddress: HUB_WALLET,
          solverConfig,
          fee: undefined,
          hubProvider: { config: sodax.config, chainConfig: hubChainConfig },
          raw: true,
        });

        expect(rawTx).toMatchObject({ value });
      }
    });
  });

  describe('rejects on invalid inputs (invariants)', () => {
    it('throws when the outputToken lookup for a non-Sonic dst, or the inputToken, yields no hub asset', async () => {
      vi.spyOn(sodax.config, 'getSpokeTokenFromOriginalAssetAddress').mockReturnValueOnce(undefined);
      await expect(
        SonicSpokeService.createSwapIntent({
          createIntentParams: baseCreateIntentParams(SONIC, { dstChainKey: ChainKeys.ARBITRUM_MAINNET }),
          creatorHubWalletAddress: HUB_WALLET,
          solverConfig,
          fee: undefined,
          hubProvider: baseHubProvider,
          raw: true,
        }),
      ).rejects.toThrow(/intent\.outputToken/);

      await expect(
        SonicSpokeService.createSwapIntent({
          createIntentParams: baseCreateIntentParams(SONIC, { inputToken: '' }),
          creatorHubWalletAddress: HUB_WALLET,
          solverConfig,
          fee: undefined,
          hubProvider: baseHubProvider,
          raw: true,
        }),
      ).rejects.toThrow(/intent\.inputToken/);
    });

    it('refuses invalid Tron payout parameters before building', async () => {
      const rows = [
        { allowPartialFill: false, field: 'minOutputAmount' },
        { allowPartialFill: true, field: 'allowPartialFill' },
      ] as const;
      vi.spyOn(sodax.config, 'getSpokeTokenFromOriginalAssetAddress').mockReturnValue(tronSupportedTokens.USDT);

      for (const { allowPartialFill, field } of rows) {
        await expect(
          SonicSpokeService.createSwapIntent({
            createIntentParams: baseCreateIntentParams(SONIC, {
              dstChainKey: ChainKeys.TRON_MAINNET,
              dstAddress: TRON_TEST_ADDRESS,
              outputToken: tronSupportedTokens.USDT.address,
              minOutputAmount: 3_000_000n,
              allowPartialFill,
            }),
            creatorHubWalletAddress: HUB_WALLET,
            solverConfig,
            fee: undefined,
            hubProvider: baseHubProvider,
            raw: true,
          }),
          field,
        ).rejects.toMatchObject({ code: 'VALIDATION_FAILED', context: { field } });
      }
    });
  });
});

// =========================================================================
// sendMessage — invariant + raw discriminant
// =========================================================================

describe('SonicSpokeService.sendMessage', () => {
  const sendMessageParams = <Raw extends boolean>(
    overrides: Partial<SendMessageParams<SonicChainKey, Raw>>,
  ): SendMessageParams<SonicChainKey, Raw> =>
    ({
      srcAddress: SRC_ADDR,
      srcChainKey: SONIC,
      dstChainKey: SONIC,
      dstAddress: HUB_WALLET,
      payload: emptyCallsData,
      raw: false,
      walletProvider: mockEvmProvider,
      ...overrides,
    }) as SendMessageParams<SonicChainKey, Raw>;

  it('throws when srcChainKey is not a Sonic chain key (invariant)', async () => {
    await expect(
      sonicSpoke.sendMessage(
        sendMessageParams<true>({
          srcChainKey: ChainKeys.BSC_MAINNET as unknown as SonicChainKey,
          raw: true,
        }),
      ),
    ).rejects.toThrow('[SonicSpokeService.callWallet] invalid chain id');
  });

  it('raw=true returns a fully-formed unsigned tx routing the calls decoded from the payload, without sending', async () => {
    const inner = {
      address: '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee' as Address,
      value: 0n,
      data: '0xface' as Hex,
    };
    const payload = encodeContractCalls([inner]);

    const result = await sonicSpoke.sendMessage(sendMessageParams<true>({ raw: true, payload }));

    expect(mockEvmProvider.sendTransaction).not.toHaveBeenCalled();
    expect(result).toEqual({
      from: SRC_ADDR,
      to: SONIC_WALLET_ROUTER,
      value: 0n,
      data: encodeFunctionData({
        abi: sonicWalletFactoryAbi,
        functionName: 'route',
        args: [[{ addr: inner.address, value: inner.value, data: inner.data }]],
      }),
    });
  });

  it('raw=false delegates to walletProvider.sendTransaction and returns the hash', async () => {
    vi.mocked(mockEvmProvider.sendTransaction).mockResolvedValueOnce(TX_HASH);

    const result = await sonicSpoke.sendMessage(sendMessageParams<false>({ raw: false }));

    expect(result).toBe(TX_HASH);
    expect(mockEvmProvider.sendTransaction).toHaveBeenCalledTimes(1);
    const sent = vi.mocked(mockEvmProvider.sendTransaction).mock.calls[0]?.[0];
    expect(sent).toMatchObject({ from: SRC_ADDR, to: SONIC_WALLET_ROUTER, value: 0n });
  });
});
