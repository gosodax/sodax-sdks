/**
 * Tests for SonicSpokeService — the hub-chain (Sonic) spoke service.
 *
 * Mirrors the pattern from SwapService.test.ts (PR #1174):
 *   1. A single `new Sodax()` instance backs every test. Instance methods are exercised on
 *      `sodax.spoke.sonic`; the publicClient lives there and is spied per-test.
 *   2. Static collaborators (`Erc20Service`, `EvmSolverService`, `randomUint256`) are mocked at
 *      their source paths via `vi.mock` + `vi.hoisted`, since SwapService-style barrel re-exports
 *      otherwise produce a different module instance than the test-side import.
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
import { encodeAbiParameters, encodeFunctionData, erc20Abi } from 'viem';
import { wrappedSonicAbi, sonicWalletFactoryAbi } from '../../abis/index.js';

// --- hoisted mocks --------------------------------------------------------
//
// Why hoisted: `vi.mock` is hoisted to the top of the file by Vitest; if the mock factory
// references a top-level binding directly, that binding doesn't exist yet at hoist time.
// `vi.hoisted(...)` lifts the binding alongside the mock so the factory can close over it.

const mocks = vi.hoisted(() => ({
  // Erc20Service — wrapped by `isAllowanceValid` (try/catch) and by the deposit() ERC20 branch
  // which calls `encodeTransferFrom` to prepend a transfer call to the wallet-router payload.
  erc20IsAllowanceValid: vi.fn(),
  erc20EncodeTransferFrom: vi.fn(),
  // HookService — `createSwapIntent` calls `resolveDelivery(params)` to apply any delivery hook.
  resolveDelivery: vi.fn(),
  // IntentDataService — `createSwapIntent` calls `composeIntentData(feeEnvelope, deliveryData)` to fold
  // the fee + delivery into the intent `data`.
  composeIntentData: vi.fn(),
  // EvmSolverService — `createSwapIntent` calls `createIntentFeeData(fee, inputAmount)` (fee envelope +
  // amount) and `encodeCreateIntent(intent, intentsContract)` for the on-hub calldata.
  createIntentFeeData: vi.fn(),
  encodeCreateIntent: vi.fn(),
  // `randomUint256` mints the intentId. Mocking it makes the resulting intent deterministic so
  // we can assert exact equality on the returned intent tuple.
  randomUint256: vi.fn(),
}));

vi.mock('../erc-20/Erc20Service.js', async () => {
  const actual = await vi.importActual<object>('../erc-20/Erc20Service.js');
  return {
    ...actual,
    Erc20Service: {
      isAllowanceValid: mocks.erc20IsAllowanceValid,
      encodeTransferFrom: mocks.erc20EncodeTransferFrom,
    },
  };
});

vi.mock('../../../swap/EvmSolverService.js', async () => {
  const actual = await vi.importActual<object>('../../../swap/EvmSolverService.js');
  return {
    ...actual,
    EvmSolverService: {
      createIntentFeeData: mocks.createIntentFeeData,
      encodeCreateIntent: mocks.encodeCreateIntent,
    },
  };
});

vi.mock('../../../swap/HookService.js', async () => {
  const actual = await vi.importActual<object>('../../../swap/HookService.js');
  return {
    ...actual,
    HookService: {
      resolveDelivery: mocks.resolveDelivery,
    },
  };
});

vi.mock('../../../swap/IntentDataService.js', async () => {
  const actual = await vi.importActual<object>('../../../swap/IntentDataService.js');
  return {
    ...actual,
    IntentDataService: {
      composeIntentData: mocks.composeIntentData,
    },
  };
});

vi.mock('../../utils/shared-utils.js', async () => {
  // `encodeAddress` is used too — keep the real implementation, only swap `randomUint256`.
  const actual = await vi.importActual<object>('../../utils/shared-utils.js');
  return {
    ...actual,
    randomUint256: mocks.randomUint256,
  };
});

import { Sodax } from '../../entities/Sodax.js';
import { SonicSpokeService } from './SonicSpokeService.js';
import { encodeAddress } from '../../utils/shared-utils.js';
import type { CreateIntentParams } from '../../types/intent-types.js';
import type { DepositParams, SendMessageParams } from '../../types/spoke-types.js';
import { TRON_TEST_ADDRESS } from './tron-test-fixtures.js';

// --- fixtures -------------------------------------------------------------

const sodax = new Sodax();
const sonicSpoke = sodax.spoke.sonic;

// Helper: encode an empty calls tuple as the `data` field. SonicSpokeService.deposit and
// .sendMessage both `decodeAbiParameters([{ type: 'tuple[]', components: [...] }], data)` to
// unpack pre-built calls — passing `[]` lets the test cover the "no extra calls" path while
// still satisfying the decoder.
const emptyCallsData: Hex = encodeAbiParameters(
  [
    {
      name: 'calls',
      type: 'tuple[]',
      components: [
        { name: 'address', type: 'address' },
        { name: 'value', type: 'uint256' },
        { name: 'data', type: 'bytes' },
      ],
    },
  ],
  [[]],
);

const SONIC = ChainKeys.SONIC_MAINNET;
const sonicConfig = spokeChainConfig[SONIC];
const SONIC_NATIVE = sonicConfig.nativeToken as Address;
const SONIC_WRAPPED = sonicConfig.addresses.wrappedSonic as Address;
const SONIC_WALLET_ROUTER = sonicConfig.addresses.walletRouter as Address;

const SRC_ADDR: Address = '0x1111111111111111111111111111111111111111';
const HUB_WALLET: Address = '0x2222222222222222222222222222222222222222';
const ERC20_TOKEN: Address = '0x3333333333333333333333333333333333333333';
const TX_HASH = '0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef' as const;

const mockEvmProvider = {
  chainType: 'EVM',
  sendTransaction: vi.fn(),
  getWalletAddress: vi.fn(),
  waitForTransactionReceipt: vi.fn(),
} as unknown as IEvmWalletProvider;

const fakeTransferFromCall = {
  address: ERC20_TOKEN,
  value: 0n,
  data: '0xtransferfrom' as Hex,
};

beforeEach(() => {
  vi.clearAllMocks();
  // Sensible defaults — individual tests override per-call.
  mocks.erc20EncodeTransferFrom.mockReturnValue(fakeTransferFromCall);
  // Default: no hook — pass dstAddress through and forward the low-level deliveryData (if any).
  mocks.resolveDelivery.mockImplementation((p: CreateIntentParams) => ({
    dstAddress: p.dstAddress,
    deliveryData: p.deliveryData,
  }));
  mocks.createIntentFeeData.mockReturnValue(['0xfeeenvelope', 0n]);
  mocks.composeIntentData.mockReturnValue('0xfeedata');
  mocks.encodeCreateIntent.mockReturnValue({
    address: '0x6382D6ccD780758C5e8A6123c33ee8F4472F96ef' as Address,
    value: 0n,
    data: '0xintentcalldata' as Hex,
  });
  mocks.randomUint256.mockReturnValue(42n);
  (mockEvmProvider.sendTransaction as ReturnType<typeof vi.fn>).mockReset();
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

  it('returns ok:true with the value Erc20Service resolves', async () => {
    mocks.erc20IsAllowanceValid.mockResolvedValueOnce({ ok: true, value: true });
    const result = await sonicSpoke.isAllowanceValid(params);
    expect(result).toEqual({ ok: true, value: true });
    expect(mocks.erc20IsAllowanceValid).toHaveBeenCalledWith({
      ...params,
      publicClient: sonicSpoke.publicClient,
      nativeToken: SONIC_NATIVE,
    });
  });

  it('forwards a sub-Result failure as-is (Erc20Service returned ok:false)', async () => {
    const subError = new Error('allowance check failed');
    mocks.erc20IsAllowanceValid.mockResolvedValueOnce({ ok: false, error: subError });
    const result = await sonicSpoke.isAllowanceValid(params);
    expect(result).toEqual({ ok: false, error: subError });
  });

  it('catches thrown errors and wraps them in ok:false', async () => {
    const thrown = new Error('rpc unavailable');
    mocks.erc20IsAllowanceValid.mockRejectedValueOnce(thrown);
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

    const result = await sonicSpoke.waitForTransactionReceipt({ chainKey: SONIC, txHash: TX_HASH });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.status).toBe('success');
    if (result.value.status !== 'success') return;
    expect(result.value.receipt.transactionIndex).toBe('5');
    expect(result.value.receipt.blockNumber).toBe('1000000');
    expect(result.value.receipt.cumulativeGasUsed).toBe('21000');
    expect(result.value.receipt.gasUsed).toBe('21000');
    expect(result.value.receipt.effectiveGasPrice).toBe('7');
    expect(result.value.receipt.contractAddress).toBe('0xabcabcabcabcabcabcabcabcabcabcabcabcabca');
    expect(result.value.receipt.logs[0]).toMatchObject({
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

    const result = await sonicSpoke.waitForTransactionReceipt({ chainKey: SONIC, txHash: TX_HASH });

    if (!result.ok || result.value.status !== 'success') throw new Error('expected ok+success');
    expect(result.value.receipt.contractAddress).toBeNull();
    expect(result.value.receipt.effectiveGasPrice).toBeUndefined();
  });

  it('returns status: failure when receipt.status === "reverted"', async () => {
    vi.spyOn(sonicSpoke.publicClient, 'waitForTransactionReceipt').mockResolvedValueOnce({
      ...baseReceipt,
      status: 'reverted',
    } as never);

    const result = await sonicSpoke.waitForTransactionReceipt({ chainKey: SONIC, txHash: TX_HASH });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.status).toBe('failure');
    if (result.value.status !== 'failure') return;
    expect(result.value.error).toBeInstanceOf(Error);
    expect((result.value.error as Error).message).toBe('Transaction reverted');
  });

  it('returns status: timeout when the thrown error message contains "timed out"', async () => {
    const timeoutErr = new Error('Transaction not received: timed out after 30s');
    vi.spyOn(sonicSpoke.publicClient, 'waitForTransactionReceipt').mockRejectedValueOnce(timeoutErr);

    const result = await sonicSpoke.waitForTransactionReceipt({ chainKey: SONIC, txHash: TX_HASH });

    if (!result.ok) throw new Error('expected ok');
    expect(result.value.status).toBe('timeout');
    if (result.value.status !== 'timeout') return;
    expect(result.value.error).toBe(timeoutErr);
  });

  it('returns status: failure for other throws, wrapping non-Errors into new Error(String(thrown))', async () => {
    const otherErr = new Error('connection refused');
    vi.spyOn(sonicSpoke.publicClient, 'waitForTransactionReceipt')
      .mockRejectedValueOnce(otherErr)
      .mockRejectedValueOnce('boom');

    const fromError = await sonicSpoke.waitForTransactionReceipt({ chainKey: SONIC, txHash: TX_HASH });
    const fromString = await sonicSpoke.waitForTransactionReceipt({ chainKey: SONIC, txHash: TX_HASH });

    if (!fromError.ok || fromError.value.status !== 'failure') throw new Error('expected ok+failure');
    expect(fromError.value.error).toBe(otherErr);
    if (!fromString.ok || fromString.value.status !== 'failure') throw new Error('expected ok+failure');
    expect(fromString.value.error).toBeInstanceOf(Error);
    expect((fromString.value.error as Error).message).toBe('boom');
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
// estimateGas — straight delegation
// =========================================================================

describe('SonicSpokeService.estimateGas', () => {
  it('delegates to publicClient.estimateGas with the unpacked tx fields', async () => {
    const spy = vi.spyOn(sonicSpoke.publicClient, 'estimateGas').mockResolvedValueOnce(50_000n);

    const result = await sonicSpoke.estimateGas({
      chainKey: SONIC,
      tx: { from: SRC_ADDR, to: HUB_WALLET, value: 1n, data: '0xcafe' as Hex },
    });

    expect(result).toBe(50_000n);
    expect(spy).toHaveBeenCalledWith({
      account: SRC_ADDR,
      to: HUB_WALLET,
      value: 1n,
      data: '0xcafe',
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

  it('reports a failed multicall entry as a logged 0n, never as a silent zero balance', async () => {
    const warnSpy = spyOnBalanceWarning();
    vi.spyOn(sonicSpoke.publicClient, 'getBalance').mockResolvedValueOnce(100n);
    // viem fans a rejected aggregate3 chunk out as one failure entry per call in that chunk.
    const rpcError = new Error('HTTP 429');
    vi.spyOn(sonicSpoke.publicClient, 'multicall').mockResolvedValueOnce([
      { status: 'success', result: 700n },
      { status: 'failure', error: rpcError, result: undefined },
    ] as never);

    const result = await sonicSpoke.getWalletBalances({
      srcChainKey: SONIC,
      srcAddress: SRC_ADDR,
      tokens: [NATIVE_S, USDC, USDT],
    });

    // One bad entry must not discard the reads that did resolve.
    expect(result[NATIVE_S.address]).toBe(100n);
    expect(result[USDC.address]).toBe(700n);
    // The 0n is indistinguishable from an empty wallet in the map, so the log line is the contract.
    expect(result[USDT.address]).toBe(0n);
    expectLoggedFailure(warnSpy, USDT.address, 'HTTP 429');
    expect(warnSpy).toHaveBeenCalledTimes(1);
  });

  it('keeps a confirmed on-chain zero as a successful read, with nothing logged', async () => {
    const warnSpy = spyOnBalanceWarning();
    vi.spyOn(sonicSpoke.publicClient, 'getBalance').mockResolvedValueOnce(0n);
    vi.spyOn(sonicSpoke.publicClient, 'multicall').mockResolvedValueOnce([{ status: 'success', result: 0n }] as never);

    const result = await sonicSpoke.getWalletBalances({
      srcChainKey: SONIC,
      srcAddress: SRC_ADDR,
      tokens: [NATIVE_S, USDC],
    });

    expect(result).toEqual({
      [NATIVE_S.address]: 0n,
      [USDC.address]: 0n,
    });
    // A real empty wallet must stay quiet, otherwise the warning stops meaning "failure".
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('synthesises a logged failure when multicall returns fewer entries than tokens', async () => {
    const warnSpy = spyOnBalanceWarning();
    vi.spyOn(sonicSpoke.publicClient, 'multicall').mockResolvedValueOnce([
      { status: 'success', result: 700n },
    ] as never);

    const result = await sonicSpoke.getWalletBalances({
      srcChainKey: SONIC,
      srcAddress: SRC_ADDR,
      tokens: [USDC, USDT],
    });

    expect(result[USDC.address]).toBe(700n);
    expect(result[USDT.address]).toBe(0n);
    expectLoggedFailure(warnSpy, USDT.address, `missing multicall result for ${USDT.address}`);
  });

  it('surfaces a rejected native read as a logged 0n while erc20 entries survive', async () => {
    const warnSpy = spyOnBalanceWarning();
    const rpcError = new Error('eth_getBalance failed');
    vi.spyOn(sonicSpoke.publicClient, 'getBalance').mockRejectedValueOnce(rpcError);
    vi.spyOn(sonicSpoke.publicClient, 'multicall').mockResolvedValueOnce([
      { status: 'success', result: 700n },
    ] as never);

    const result = await sonicSpoke.getWalletBalances({
      srcChainKey: SONIC,
      srcAddress: SRC_ADDR,
      tokens: [NATIVE_S, USDC],
    });

    expect(result[NATIVE_S.address]).toBe(0n);
    expect(result[USDC.address]).toBe(700n);
    expectLoggedFailure(warnSpy, NATIVE_S.address, 'eth_getBalance failed');
  });

  it('rejects when no requested token could be read at all', async () => {
    spyOnBalanceWarning();
    vi.spyOn(sonicSpoke.publicClient, 'getBalance').mockRejectedValueOnce(new Error('eth_getBalance failed'));
    vi.spyOn(sonicSpoke.publicClient, 'multicall').mockResolvedValueOnce([
      { status: 'failure', error: new Error('HTTP 429'), result: undefined },
    ] as never);

    // An all-zero map from a dead RPC would render as "this wallet holds nothing" — the one failure
    // the flat map cannot express, so the whole call must fail instead.
    await expect(
      sonicSpoke.getWalletBalances({ srcChainKey: SONIC, srcAddress: SRC_ADDR, tokens: [NATIVE_S, USDC] }),
    ).rejects.toThrow(`every balance read failed on ${SONIC}`);
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
      expect(mocks.erc20EncodeTransferFrom).not.toHaveBeenCalled();
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
      expect(mocks.erc20EncodeTransferFrom).toHaveBeenCalledWith(ERC20_TOKEN, SRC_ADDR, HUB_WALLET, 1_000n);
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

    it('extra calls decoded from `data` are appended after the prepended transferFrom', async () => {
      const extraCall = {
        address: '0xcccccccccccccccccccccccccccccccccccccccc' as Address,
        value: 0n,
        data: '0xcafe' as Hex,
      };
      const dataWithExtra = encodeAbiParameters(
        [
          {
            name: 'calls',
            type: 'tuple[]',
            components: [
              { name: 'address', type: 'address' },
              { name: 'value', type: 'uint256' },
              { name: 'data', type: 'bytes' },
            ],
          },
        ],
        [[{ address: extraCall.address, value: extraCall.value, data: extraCall.data }]],
      );

      const result = await sonicSpoke.deposit(depositParams<true>({ raw: true, data: dataWithExtra }));

      // Reconstruct the expected route() calldata: [transferFromCall, extraCall].
      expect(result).toMatchObject({
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
              { addr: extraCall.address, value: extraCall.value, data: extraCall.data },
            ],
          ],
        }),
      });
    });
  });

  describe('raw discriminant', () => {
    it('raw=false delegates to walletProvider.sendTransaction and returns its hash', async () => {
      (mockEvmProvider.sendTransaction as ReturnType<typeof vi.fn>).mockResolvedValueOnce(TX_HASH);

      const result = await sonicSpoke.deposit(depositParams<false>({ raw: false }));

      expect(result).toBe(TX_HASH);
      expect(mockEvmProvider.sendTransaction).toHaveBeenCalledTimes(1);
      // The rawTx passed to sendTransaction must be fully formed — assert the shape so a mutation
      // that drops `value` or `to` would be caught.
      const sent = (mockEvmProvider.sendTransaction as ReturnType<typeof vi.fn>).mock.calls[0]?.[0];
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
      mocks.randomUint256.mockReturnValueOnce(7777n);

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

    it.each([
      [false, 'minOutputAmount'],
      [true, 'allowPartialFill'],
    ] as const)('refuses invalid Tron payout parameters before building (%s)', async (allowPartialFill, field) => {
      vi.spyOn(sodax.config, 'getSpokeTokenFromOriginalAssetAddress').mockReturnValueOnce(tronSupportedTokens.USDT);
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
      ).rejects.toMatchObject({ code: 'VALIDATION_FAILED', context: { field } });
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
      mocks.createIntentFeeData.mockReturnValueOnce(['0xfeeenvelope' as Hex, 12_345n]);
      mocks.composeIntentData.mockReturnValueOnce('0xpartnerfee' as Hex);
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

      expect(mocks.createIntentFeeData).toHaveBeenCalledWith(fee, 1_000_000n);
      expect(mocks.composeIntentData).toHaveBeenCalledWith('0xfeeenvelope', undefined);
      expect(feeAmount).toBe(12_345n);
      expect(intent.inputAmount).toBe(1_000_000n - 12_345n);
      expect(intent.data).toBe('0xpartnerfee');
      expect(data).toBe('0xintentcalldata');
      expect(rawTx).toBeDefined();
    });

    it('raw=false delegates to walletProvider.sendTransaction and returns the hash', async () => {
      (mockEvmProvider.sendTransaction as ReturnType<typeof vi.fn>).mockResolvedValueOnce(TX_HASH);

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
    const payload = encodeAbiParameters(
      [
        {
          name: 'calls',
          type: 'tuple[]',
          components: [
            { name: 'address', type: 'address' },
            { name: 'value', type: 'uint256' },
            { name: 'data', type: 'bytes' },
          ],
        },
      ],
      [[{ address: inner.address, value: inner.value, data: inner.data }]],
    );

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
    (mockEvmProvider.sendTransaction as ReturnType<typeof vi.fn>).mockResolvedValueOnce(TX_HASH);

    const result = await sonicSpoke.sendMessage(sendMessageParams<false>({ raw: false }));

    expect(result).toBe(TX_HASH);
    expect(mockEvmProvider.sendTransaction).toHaveBeenCalledTimes(1);
    const sent = (mockEvmProvider.sendTransaction as ReturnType<typeof vi.fn>).mock.calls[0]?.[0];
    expect(sent).toMatchObject({ from: SRC_ADDR, to: SONIC_WALLET_ROUTER, value: 0n });
  });
});
