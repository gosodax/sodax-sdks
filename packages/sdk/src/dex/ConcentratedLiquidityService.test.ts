/**
 * Tests for the public API of `ClService` (concentrated-liquidity DEX service).
 *
 * Mirrors the SwapService.test.ts pattern (see issue #1175):
 *
 *   1. A single real `Sodax` instance backs every test (no per-test factories,
 *      no fabricated `hubProvider` / `SpokeService` / `ConfigService`).
 *   2. Internal calls inside `ClService` methods are mocked via `vi.mock` at the
 *      module source paths and `vi.spyOn` on instance methods.
 *   3. Each public method gets its own `describe` block with one `it` per
 *      execution flow (happy / rejection / error propagation / branch).
 *   4. Static helpers are covered with pure-math assertions — no mocks needed.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PositionMath, TickMath } from '@pancakeswap/v3-sdk';
import { Token } from '@pancakeswap/swap-sdk-core';
import { ChainKeys, type Address, type PoolKey, type SpokeChainKey } from '@sodax/types';
import { Sodax } from '../shared/entities/Sodax.js';
import type {
  ClSupplyAction,
  ClLiquidityIncreaseLiquidityAction,
  ClLiquidityDecreaseLiquidityAction,
  ClLiquidityClaimRewardsAction,
} from './ConcentratedLiquidityService.js';
import { ClService } from './ConcentratedLiquidityService.js';
import { isSodaxError, type SodaxError } from '../errors/SodaxError.js';

// `ClService` reaches `relayTxAndWaitPacket`, the pancakeswap calldata encoders, `Erc4626Service`,
// and viem's `parseEventLogs` directly from their source modules. Vitest's hoisted `vi.mock` lets
// the SUT see these test doubles without touching the real network or wallet stack.
const mocks = vi.hoisted(() => ({
  // Relay
  relayTxAndWaitPacket: vi.fn(),
  // PancakeSwap Infinity SDK calldata builders + helpers
  encodeMintCalldata: vi.fn().mockReturnValue('0xmint'),
  encodeIncreaseCalldata: vi.fn().mockReturnValue('0xincrease'),
  encodeDecreaseCalldata: vi.fn().mockReturnValue('0xdecrease'),
  decodePoolKey: vi.fn(),
  getPoolId: vi.fn().mockReturnValue('0xpoolid'),
  // viem
  parseEventLogs: vi.fn(),
  // Hub-provider instance methods
  getUserHubWalletAddress: vi.fn(),
  // Erc4626Service
  convertToAssets: vi.fn(),
}));

vi.mock('../shared/services/intentRelay/IntentRelayApiService.js', async () => {
  const actual = await vi.importActual<object>('../shared/services/intentRelay/IntentRelayApiService.js');
  return { ...actual, relayTxAndWaitPacket: mocks.relayTxAndWaitPacket };
});

vi.mock('@pancakeswap/infinity-sdk', async () => {
  const actual = await vi.importActual<object>('@pancakeswap/infinity-sdk');
  return {
    ...actual,
    encodeCLPositionManagerMintCalldata: mocks.encodeMintCalldata,
    encodeCLPositionManagerIncreaseLiquidityCalldata: mocks.encodeIncreaseCalldata,
    encodeCLPositionManagerDecreaseLiquidityCalldata: mocks.encodeDecreaseCalldata,
    decodePoolKey: mocks.decodePoolKey,
    getPoolId: mocks.getPoolId,
  };
});

vi.mock('../shared/services/Erc4626Service.js', () => ({
  Erc4626Service: {
    convertToAssets: mocks.convertToAssets,
  },
}));

// `parseEventLogs` is the only viem symbol we override; everything else (createPublicClient,
// erc20Abi, parseEventLogs's siblings) must keep its real implementation so `new Sodax()` still
// boots and the rest of the SDK works during the test run.
vi.mock('viem', async () => {
  const actual = await vi.importActual<object>('viem');
  return { ...actual, parseEventLogs: mocks.parseEventLogs };
});

// --- fixtures -----------------------------------------------------------------

const sodax = new Sodax();
const cl = sodax.dex.clService;

const sqrtPriceAtTick = (tick: number): bigint => BigInt(TickMath.getSqrtRatioAtTick(tick).toString());

const ZERO_ADDRESS: Address = '0x0000000000000000000000000000000000000000';
const SRC_ADDRESS: Address = '0x1111111111111111111111111111111111111111';
const HUB_WALLET: Address = '0x2222222222222222222222222222222222222222';
const POOL_MANAGER: Address = '0xA3256ab552A271A16AcDfdB521B32ef82d481F43';
const POSITION_MANAGER: Address = '0xcc08a04d9E5766c7A20FE6bb32cAa40EA0e7e9e1';
const HOOK: Address = '0x598448d8f8553b9c6f27E52a92E2cCf27cDEF229';

// A pool key whose currencies are NOT registered as StatATokens — keeps the enrichment
// path short-circuited (`isStatAToken === false`) so `getPoolData` doesn't call the
// ERC4626 vault code path. Tests that need the StatAToken branch use a fixture that
// overrides currency0/currency1 with addresses present in `dex.statATokenAddresses`.
const plainPoolKey: PoolKey = {
  currency0: '0x000000000000000000000000000000000000aaa1',
  currency1: '0x000000000000000000000000000000000000aaa2',
  hooks: HOOK,
  poolManager: POOL_MANAGER,
  fee: 8388608,
  parameters: {
    tickSpacing: 10,
    hooksRegistration: {
      beforeInitialize: true,
      afterInitialize: true,
      beforeAddLiquidity: true,
      afterAddLiquidity: true,
      beforeRemoveLiquidity: true,
      afterRemoveLiquidity: true,
      beforeSwap: true,
      afterSwap: true,
      beforeDonate: true,
      afterDonate: true,
      beforeSwapReturnsDelta: true,
      afterSwapReturnsDelta: true,
      afterMintReturnsDelta: true,
      afterBurnReturnsDelta: true,
    },
  },
};

const supplyParams = <K extends SpokeChainKey>(srcChainKey: K) => ({
  srcChainKey,
  srcAddress: SRC_ADDRESS,
  poolKey: plainPoolKey,
  tickLower: -1000n,
  tickUpper: 1000n,
  liquidity: 1000n,
  amount0Max: 100n,
  amount1Max: 200n,
  sqrtPriceX96: sqrtPriceAtTick(0),
});

const increaseParams = <K extends SpokeChainKey>(srcChainKey: K) => ({
  ...supplyParams(srcChainKey),
  tokenId: 7n,
});

const decreaseParams = <K extends SpokeChainKey>(srcChainKey: K) => ({
  srcChainKey,
  srcAddress: SRC_ADDRESS,
  poolKey: plainPoolKey,
  tokenId: 7n,
  liquidity: 500n,
  amount0Min: 1n,
  amount1Min: 2n,
});

const claimParams = <K extends SpokeChainKey>(srcChainKey: K) => ({
  srcChainKey,
  srcAddress: SRC_ADDRESS,
  poolKey: plainPoolKey,
  tokenId: 7n,
  tickLower: -1000n,
  tickUpper: 1000n,
});

// Wallet provider fakes — `ClService` only forwards them through `SpokeService.sendMessage`,
// which is itself stubbed, so the provider bodies never execute at runtime.
const mockEvmProvider = {
  chainType: 'EVM',
  sendTransaction: vi.fn(),
  getWalletAddress: vi.fn(),
  waitForTransactionReceipt: vi.fn(),
  // biome-ignore lint/suspicious/noExplicitAny: test fake — only used as a sentinel value.
} as any;

// Build a flexible publicClient stub keyed by viem `functionName`. Each test names only the
// reads it cares about; everything else throws so a missing handler is loud, not silent.
function createMockClient(handlers: Record<string, () => unknown>) {
  return {
    readContract: vi.fn(async ({ functionName }: { functionName: string }) => {
      const handler = handlers[functionName];
      if (!handler) throw new Error(`Unmocked publicClient.readContract: ${functionName}`);
      return handler();
    }),
    waitForTransactionReceipt: vi.fn(),
    // biome-ignore lint/suspicious/noExplicitAny: test fake — passed where viem PublicClient is expected.
  } as any;
}

beforeEach(() => {
  // Bind the hoisted `getUserHubWalletAddress` stub to the live `EvmHubProvider` instance method.
  vi.spyOn(sodax.hubProvider, 'getUserHubWalletAddress').mockImplementation(mocks.getUserHubWalletAddress);
  // Default: every relay attempt returns success unless a test overrides it.
  mocks.relayTxAndWaitPacket.mockResolvedValue({ ok: true, value: { dst_tx_hash: '0xhubTx' } });
  mocks.getUserHubWalletAddress.mockResolvedValue(HUB_WALLET);
  // Default-ish defaults for the ERC-4626 conversion (1:1) so unrelated tests don't blow up if
  // they happen to traverse the StatAToken enrichment branch.
  mocks.convertToAssets.mockResolvedValue({ ok: true, value: BigInt(10 ** 18) });
});

afterEach(() => {
  vi.restoreAllMocks();
  // `restoreAllMocks` strips the implementation off the hoisted `vi.fn()`s but keeps the spies;
  // re-applying defaults is deferred to each `beforeEach`.
  mocks.relayTxAndWaitPacket.mockReset();
  mocks.getUserHubWalletAddress.mockReset();
  mocks.encodeMintCalldata.mockReset().mockReturnValue('0xmint');
  mocks.encodeIncreaseCalldata.mockReset().mockReturnValue('0xincrease');
  mocks.encodeDecreaseCalldata.mockReset().mockReturnValue('0xdecrease');
  mocks.decodePoolKey.mockReset();
  mocks.getPoolId.mockReset().mockReturnValue('0xpoolid');
  mocks.parseEventLogs.mockReset();
  mocks.convertToAssets.mockReset();
});

// =========================================================================
// Simple delegations / pure helpers
// =========================================================================

// CL calls pay the hub wallet, and an MPC-relay message settles only on a release to its source chain.
describe('ClService refuses an MPC-relay source before signing', () => {
  const TRON = ChainKeys.TRON_MAINNET;

  it.each([
    ['executeSupplyLiquidity', () => cl.executeSupplyLiquidity({ params: supplyParams(TRON), raw: true })],
    ['executeIncreaseLiquidity', () => cl.executeIncreaseLiquidity({ params: increaseParams(TRON), raw: true })],
    ['executeDecreaseLiquidity', () => cl.executeDecreaseLiquidity({ params: decreaseParams(TRON), raw: true })],
    ['executeClaimRewards', () => cl.executeClaimRewards({ params: claimParams(TRON), raw: true })],
  ] as const)('%s', async (_, run) => {
    const send = vi.spyOn(sodax.spoke, 'sendMessage');

    const result = await run();

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatchObject({ code: 'VALIDATION_FAILED', feature: 'dex' });
    expect(send).not.toHaveBeenCalled();
    expect(mocks.getUserHubWalletAddress).not.toHaveBeenCalled();
  });
});

describe('ClService.getPools', () => {
  it('returns whatever ConfigService.getDexPools returns', () => {
    const fakePools = [plainPoolKey] as never;
    const spy = vi.spyOn(sodax.config, 'getDexPools').mockReturnValueOnce(fakePools);

    expect(cl.getPools()).toBe(fakePools);
    expect(spy).toHaveBeenCalledTimes(1);
  });
});

describe('ClService.permit2Approve', () => {
  it('returns a [permit2-approve, erc20-approve] pair targeting the given token + spender', () => {
    const token: Address = '0x000000000000000000000000000000000000aaa3';
    const spender: Address = POSITION_MANAGER;

    const calls = cl.permit2Approve(token, spender);

    expect(calls).toHaveLength(2);
    // First call addresses Permit2 (the singleton), second targets the underlying ERC-20.
    expect(calls[0]?.address).toBe(sodax.config.sodaxConfig.dex.concentratedLiquidityConfig.permit2);
    expect(calls[1]?.address).toBe(token);
    // Both encode an `approve`-style call with non-empty data.
    expect(calls[0]?.data).toMatch(/^0x/);
    expect(calls[1]?.data).toMatch(/^0x/);
  });
});

describe('ClService.getAssetsForPool', () => {
  it('returns token0/token1 XTokens looked up via the config', () => {
    const fakeXToken0 = { symbol: 'T0', address: '0xT0' } as never;
    const fakeXToken1 = { symbol: 'T1', address: '0xT1' } as never;
    vi.spyOn(sodax.config, 'getOriginalAssetAddressFromStakedATokenAddress')
      .mockReturnValueOnce('0xT0')
      .mockReturnValueOnce('0xT1');
    vi.spyOn(sodax.config, 'findTokenByOriginalAddress')
      .mockReturnValueOnce(fakeXToken0)
      .mockReturnValueOnce(fakeXToken1);

    const result = cl.getAssetsForPool(ChainKeys.BSC_MAINNET, plainPoolKey);

    expect(result).toEqual({ token0: fakeXToken0, token1: fakeXToken1 });
  });

  it('throws when token0 cannot be resolved', () => {
    vi.spyOn(sodax.config, 'getOriginalAssetAddressFromStakedATokenAddress')
      .mockReturnValueOnce('0xT0')
      .mockReturnValueOnce('0xT1');
    vi.spyOn(sodax.config, 'findTokenByOriginalAddress').mockReturnValueOnce(undefined);

    expect(() => cl.getAssetsForPool(ChainKeys.BSC_MAINNET, plainPoolKey)).toThrow(/Token0 .* not found/);
  });

  it('throws when token1 cannot be resolved', () => {
    vi.spyOn(sodax.config, 'getOriginalAssetAddressFromStakedATokenAddress')
      .mockReturnValueOnce('0xT0')
      .mockReturnValueOnce('0xT1');
    vi.spyOn(sodax.config, 'findTokenByOriginalAddress')
      .mockReturnValueOnce({ symbol: 'T0' } as never)
      .mockReturnValueOnce(undefined);

    expect(() => cl.getAssetsForPool(ChainKeys.BSC_MAINNET, plainPoolKey)).toThrow(/Token1 .* not found/);
  });
});

// =========================================================================
// execute* methods — encode + delegate to SpokeService.sendMessage
// =========================================================================

describe('ClService.executeSupplyLiquidity', () => {
  it('on an EVM spoke (raw=false), forwards walletProvider and returns the IntentTxResult', async () => {
    vi.spyOn(sodax.spoke, 'sendMessage').mockResolvedValueOnce({ ok: true, value: '0xspokeTx' });

    const result = await cl.executeSupplyLiquidity({
      params: supplyParams(ChainKeys.BSC_MAINNET),
      raw: false,
      walletProvider: mockEvmProvider,
    } satisfies ClSupplyAction<'0x38.bsc', false>);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.tx).toBe('0xspokeTx');
      expect(result.value.relayData).toEqual({ address: HUB_WALLET, payload: expect.any(String) });
    }
    const sendArg = (sodax.spoke.sendMessage as ReturnType<typeof vi.fn>).mock.calls[0]?.[0];
    expect(sendArg.raw).toBe(false);
    expect(sendArg.walletProvider).toBe(mockEvmProvider);
    expect(sendArg.srcChainKey).toBe(ChainKeys.BSC_MAINNET);
    expect(sendArg.dstAddress).toBe(HUB_WALLET);
    expect(mocks.encodeMintCalldata).toHaveBeenCalledTimes(1);
  });

  it('with raw=true, omits walletProvider and returns the raw spoke tx', async () => {
    const rawTx = { from: '0x1', to: '0x2', data: '0x', value: 0n };
    vi.spyOn(sodax.spoke, 'sendMessage').mockResolvedValueOnce({ ok: true, value: rawTx as never });

    const result = await cl.executeSupplyLiquidity({
      params: supplyParams(ChainKeys.BSC_MAINNET),
      raw: true,
    } satisfies ClSupplyAction<'0x38.bsc', true>);

    expect(result.ok).toBe(true);
    const sendArg = (sodax.spoke.sendMessage as ReturnType<typeof vi.fn>).mock.calls[0]?.[0];
    expect(sendArg.raw).toBe(true);
    expect(sendArg).not.toHaveProperty('walletProvider');
  });

  it('wraps a failure Result from SpokeService.sendMessage as SodaxError(INTENT_CREATION_FAILED, dex) with .cause', async () => {
    const sendError = new Error('SEND_REJECTED');
    vi.spyOn(sodax.spoke, 'sendMessage').mockResolvedValueOnce({ ok: false, error: sendError });

    const result = await cl.executeSupplyLiquidity({
      params: supplyParams(ChainKeys.BSC_MAINNET),
      raw: false,
      walletProvider: mockEvmProvider,
    } satisfies ClSupplyAction<'0x38.bsc', false>);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(isSodaxError(result.error)).toBe(true);
    expect((result.error as SodaxError).code).toBe('INTENT_CREATION_FAILED');
    expect((result.error as SodaxError).feature).toBe('dex');
    expect((result.error as SodaxError).cause).toBe(sendError);
  });

  it('returns ok:false when getUserHubWalletAddress rejects (top-of-method failure)', async () => {
    const hubError = new Error('HUB_LOOKUP_FAILED');
    mocks.getUserHubWalletAddress.mockRejectedValueOnce(hubError);

    const result = await cl.executeSupplyLiquidity({
      params: supplyParams(ChainKeys.BSC_MAINNET),
      raw: false,
      walletProvider: mockEvmProvider,
    } satisfies ClSupplyAction<'0x38.bsc', false>);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(isSodaxError(result.error)).toBe(true);
    expect((result.error as SodaxError).code).toBe('INTENT_CREATION_FAILED');
    expect((result.error as SodaxError).feature).toBe('dex');
    expect((result.error as SodaxError).cause).toBe(hubError);
  });
});

describe('ClService.executeIncreaseLiquidity', () => {
  it('on an EVM spoke (raw=false), encodes increase calldata and forwards to sendMessage', async () => {
    vi.spyOn(sodax.spoke, 'sendMessage').mockResolvedValueOnce({ ok: true, value: '0xspokeTx' });

    const result = await cl.executeIncreaseLiquidity({
      params: increaseParams(ChainKeys.BSC_MAINNET),
      raw: false,
      walletProvider: mockEvmProvider,
    } satisfies ClLiquidityIncreaseLiquidityAction<'0x38.bsc', false>);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.tx).toBe('0xspokeTx');
    expect(mocks.encodeIncreaseCalldata).toHaveBeenCalledTimes(1);
  });

  it('with raw=true, sets raw flag and omits walletProvider', async () => {
    vi.spyOn(sodax.spoke, 'sendMessage').mockResolvedValueOnce({ ok: true, value: '0xrawTx' as never });

    await cl.executeIncreaseLiquidity({
      params: increaseParams(ChainKeys.BSC_MAINNET),
      raw: true,
    } satisfies ClLiquidityIncreaseLiquidityAction<'0x38.bsc', true>);

    const sendArg = (sodax.spoke.sendMessage as ReturnType<typeof vi.fn>).mock.calls[0]?.[0];
    expect(sendArg.raw).toBe(true);
    expect(sendArg).not.toHaveProperty('walletProvider');
  });

  it('wraps sendMessage failure as SodaxError(INTENT_CREATION_FAILED, dex) with .cause', async () => {
    const sendError = new Error('SEND_REJECTED');
    vi.spyOn(sodax.spoke, 'sendMessage').mockResolvedValueOnce({ ok: false, error: sendError });

    const result = await cl.executeIncreaseLiquidity({
      params: increaseParams(ChainKeys.BSC_MAINNET),
      raw: false,
      walletProvider: mockEvmProvider,
    } satisfies ClLiquidityIncreaseLiquidityAction<'0x38.bsc', false>);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(isSodaxError(result.error)).toBe(true);
    expect((result.error as SodaxError).code).toBe('INTENT_CREATION_FAILED');
    expect((result.error as SodaxError).feature).toBe('dex');
    expect((result.error as SodaxError).cause).toBe(sendError);
  });

  it('returns ok:false when getUserHubWalletAddress rejects', async () => {
    const hubError = new Error('HUB_LOOKUP_FAILED');
    mocks.getUserHubWalletAddress.mockRejectedValueOnce(hubError);

    const result = await cl.executeIncreaseLiquidity({
      params: increaseParams(ChainKeys.BSC_MAINNET),
      raw: false,
      walletProvider: mockEvmProvider,
    } satisfies ClLiquidityIncreaseLiquidityAction<'0x38.bsc', false>);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(isSodaxError(result.error)).toBe(true);
    expect((result.error as SodaxError).code).toBe('INTENT_CREATION_FAILED');
    expect((result.error as SodaxError).feature).toBe('dex');
    expect((result.error as SodaxError).cause).toBe(hubError);
  });
});

describe('ClService.executeDecreaseLiquidity', () => {
  it('on an EVM spoke (raw=false), encodes decrease calldata and forwards to sendMessage', async () => {
    vi.spyOn(sodax.spoke, 'sendMessage').mockResolvedValueOnce({ ok: true, value: '0xspokeTx' });

    const result = await cl.executeDecreaseLiquidity({
      params: decreaseParams(ChainKeys.BSC_MAINNET),
      raw: false,
      walletProvider: mockEvmProvider,
    } satisfies ClLiquidityDecreaseLiquidityAction<'0x38.bsc', false>);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.tx).toBe('0xspokeTx');
    const decodeArgs = mocks.encodeDecreaseCalldata.mock.calls[0]?.[0];
    expect(decodeArgs.tokenId).toBe(7n);
    expect(decodeArgs.liquidity).toBe(500n);
    expect(decodeArgs.amount0Min).toBe(1n);
    expect(decodeArgs.amount1Min).toBe(2n);
  });

  it('with raw=true, sets raw flag and omits walletProvider', async () => {
    vi.spyOn(sodax.spoke, 'sendMessage').mockResolvedValueOnce({ ok: true, value: '0xrawTx' as never });

    await cl.executeDecreaseLiquidity({
      params: decreaseParams(ChainKeys.BSC_MAINNET),
      raw: true,
    } satisfies ClLiquidityDecreaseLiquidityAction<'0x38.bsc', true>);

    const sendArg = (sodax.spoke.sendMessage as ReturnType<typeof vi.fn>).mock.calls[0]?.[0];
    expect(sendArg.raw).toBe(true);
    expect(sendArg).not.toHaveProperty('walletProvider');
  });

  it('wraps sendMessage failure as SodaxError(INTENT_CREATION_FAILED, dex) with .cause', async () => {
    const sendError = new Error('SEND_REJECTED');
    vi.spyOn(sodax.spoke, 'sendMessage').mockResolvedValueOnce({ ok: false, error: sendError });

    const result = await cl.executeDecreaseLiquidity({
      params: decreaseParams(ChainKeys.BSC_MAINNET),
      raw: false,
      walletProvider: mockEvmProvider,
    } satisfies ClLiquidityDecreaseLiquidityAction<'0x38.bsc', false>);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(isSodaxError(result.error)).toBe(true);
    expect((result.error as SodaxError).code).toBe('INTENT_CREATION_FAILED');
    expect((result.error as SodaxError).feature).toBe('dex');
    expect((result.error as SodaxError).cause).toBe(sendError);
  });

  it('returns ok:false when getUserHubWalletAddress rejects', async () => {
    const hubError = new Error('HUB_LOOKUP_FAILED');
    mocks.getUserHubWalletAddress.mockRejectedValueOnce(hubError);

    const result = await cl.executeDecreaseLiquidity({
      params: decreaseParams(ChainKeys.BSC_MAINNET),
      raw: false,
      walletProvider: mockEvmProvider,
    } satisfies ClLiquidityDecreaseLiquidityAction<'0x38.bsc', false>);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(isSodaxError(result.error)).toBe(true);
    expect((result.error as SodaxError).code).toBe('INTENT_CREATION_FAILED');
    expect((result.error as SodaxError).feature).toBe('dex');
    expect((result.error as SodaxError).cause).toBe(hubError);
  });
});

describe('ClService.executeClaimRewards', () => {
  it('encodes a 0-liquidity decrease call (the harvest trick) and forwards to sendMessage', async () => {
    vi.spyOn(sodax.spoke, 'sendMessage').mockResolvedValueOnce({ ok: true, value: '0xspokeTx' });

    const result = await cl.executeClaimRewards({
      params: claimParams(ChainKeys.BSC_MAINNET),
      raw: false,
      walletProvider: mockEvmProvider,
    } satisfies ClLiquidityClaimRewardsAction<'0x38.bsc', false>);

    expect(result.ok).toBe(true);
    const decodeArgs = mocks.encodeDecreaseCalldata.mock.calls[0]?.[0];
    expect(decodeArgs.liquidity).toBe(0n);
    expect(decodeArgs.amount0Min).toBe(0n);
    expect(decodeArgs.amount1Min).toBe(0n);
  });

  it('with raw=true, omits walletProvider', async () => {
    vi.spyOn(sodax.spoke, 'sendMessage').mockResolvedValueOnce({ ok: true, value: '0xrawTx' as never });

    await cl.executeClaimRewards({
      params: claimParams(ChainKeys.BSC_MAINNET),
      raw: true,
    } satisfies ClLiquidityClaimRewardsAction<'0x38.bsc', true>);

    const sendArg = (sodax.spoke.sendMessage as ReturnType<typeof vi.fn>).mock.calls[0]?.[0];
    expect(sendArg.raw).toBe(true);
    expect(sendArg).not.toHaveProperty('walletProvider');
  });

  it('wraps sendMessage failure as SodaxError(INTENT_CREATION_FAILED, dex) with .cause', async () => {
    const sendError = new Error('SEND_REJECTED');
    vi.spyOn(sodax.spoke, 'sendMessage').mockResolvedValueOnce({ ok: false, error: sendError });

    const result = await cl.executeClaimRewards({
      params: claimParams(ChainKeys.BSC_MAINNET),
      raw: false,
      walletProvider: mockEvmProvider,
    } satisfies ClLiquidityClaimRewardsAction<'0x38.bsc', false>);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(isSodaxError(result.error)).toBe(true);
    expect((result.error as SodaxError).code).toBe('INTENT_CREATION_FAILED');
    expect((result.error as SodaxError).feature).toBe('dex');
    expect((result.error as SodaxError).cause).toBe(sendError);
  });

  it('returns ok:false when getUserHubWalletAddress rejects', async () => {
    const hubError = new Error('HUB_LOOKUP_FAILED');
    mocks.getUserHubWalletAddress.mockRejectedValueOnce(hubError);

    const result = await cl.executeClaimRewards({
      params: claimParams(ChainKeys.BSC_MAINNET),
      raw: false,
      walletProvider: mockEvmProvider,
    } satisfies ClLiquidityClaimRewardsAction<'0x38.bsc', false>);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(isSodaxError(result.error)).toBe(true);
    expect((result.error as SodaxError).code).toBe('INTENT_CREATION_FAILED');
    expect((result.error as SodaxError).feature).toBe('dex');
    expect((result.error as SodaxError).cause).toBe(hubError);
  });
});

// =========================================================================
// Lifecycle methods — execute*() + relay
// =========================================================================

describe('ClService.supplyLiquidity', () => {
  it('on a non-hub spoke, relays the spoke tx and returns both src and dst tx hashes', async () => {
    vi.spyOn(sodax.spoke, 'sendMessage').mockResolvedValueOnce({ ok: true, value: '0xspokeTx' });
    mocks.relayTxAndWaitPacket.mockResolvedValueOnce({ ok: true, value: { dst_tx_hash: '0xhubTx' } });

    const result = await cl.supplyLiquidity({
      params: supplyParams(ChainKeys.BSC_MAINNET),
      raw: false,
      walletProvider: mockEvmProvider,
    });

    expect(result).toEqual({ ok: true, value: { srcChainTxHash: '0xspokeTx', dstChainTxHash: '0xhubTx' } });
    expect(mocks.relayTxAndWaitPacket).toHaveBeenCalledTimes(1);
  });

  it('on the hub chain (Sonic), skips the relay and reuses the spoke tx hash for both', async () => {
    vi.spyOn(sodax.spoke, 'sendMessage').mockResolvedValueOnce({ ok: true, value: '0xsonicTx' });

    const result = await cl.supplyLiquidity({
      params: supplyParams(ChainKeys.SONIC_MAINNET),
      raw: false,
      walletProvider: mockEvmProvider,
    });

    expect(result).toEqual({ ok: true, value: { srcChainTxHash: '0xsonicTx', dstChainTxHash: '0xsonicTx' } });
    expect(mocks.relayTxAndWaitPacket).not.toHaveBeenCalled();
  });

  it('forwards the wrapped failure from executeSupplyLiquidity (SodaxError(INTENT_CREATION_FAILED, dex))', async () => {
    const sendError = new Error('SEND_REJECTED');
    vi.spyOn(sodax.spoke, 'sendMessage').mockResolvedValueOnce({ ok: false, error: sendError });

    const result = await cl.supplyLiquidity({
      params: supplyParams(ChainKeys.BSC_MAINNET),
      raw: false,
      walletProvider: mockEvmProvider,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(isSodaxError(result.error)).toBe(true);
    expect((result.error as SodaxError).code).toBe('INTENT_CREATION_FAILED');
    expect((result.error as SodaxError).feature).toBe('dex');
    expect((result.error as SodaxError).cause).toBe(sendError);
  });

  it('returns the failure Result from relayTxAndWaitPacket unchanged', async () => {
    vi.spyOn(sodax.spoke, 'sendMessage').mockResolvedValueOnce({ ok: true, value: '0xspokeTx' });
    const relayError = new Error('RELAY_TIMEOUT');
    mocks.relayTxAndWaitPacket.mockResolvedValueOnce({ ok: false, error: relayError });

    const result = await cl.supplyLiquidity({
      params: supplyParams(ChainKeys.BSC_MAINNET),
      raw: false,
      walletProvider: mockEvmProvider,
    });

    expect(result).toEqual({ ok: false, error: relayError });
  });

  it('wraps a thrown sendMessage failure as SodaxError(INTENT_CREATION_FAILED, dex) with .cause', async () => {
    const thrown = new Error('SEND_THREW');
    vi.spyOn(sodax.spoke, 'sendMessage').mockRejectedValueOnce(thrown);

    const result = await cl.supplyLiquidity({
      params: supplyParams(ChainKeys.BSC_MAINNET),
      raw: false,
      walletProvider: mockEvmProvider,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(isSodaxError(result.error)).toBe(true);
    expect((result.error as SodaxError).code).toBe('INTENT_CREATION_FAILED');
    expect((result.error as SodaxError).feature).toBe('dex');
    expect((result.error as SodaxError).cause).toBe(thrown);
  });
});

describe('ClService.increaseLiquidity', () => {
  it('on a non-hub spoke, relays and returns both src and dst tx hashes', async () => {
    vi.spyOn(sodax.spoke, 'sendMessage').mockResolvedValueOnce({ ok: true, value: '0xspokeTx' });
    mocks.relayTxAndWaitPacket.mockResolvedValueOnce({ ok: true, value: { dst_tx_hash: '0xhubTx' } });

    const result = await cl.increaseLiquidity({
      params: increaseParams(ChainKeys.BSC_MAINNET),
      raw: false,
      walletProvider: mockEvmProvider,
    });

    expect(result).toEqual({ ok: true, value: { srcChainTxHash: '0xspokeTx', dstChainTxHash: '0xhubTx' } });
  });

  it('on the hub chain, skips the relay', async () => {
    vi.spyOn(sodax.spoke, 'sendMessage').mockResolvedValueOnce({ ok: true, value: '0xsonicTx' });

    const result = await cl.increaseLiquidity({
      params: increaseParams(ChainKeys.SONIC_MAINNET),
      raw: false,
      walletProvider: mockEvmProvider,
    });

    expect(result).toEqual({ ok: true, value: { srcChainTxHash: '0xsonicTx', dstChainTxHash: '0xsonicTx' } });
    expect(mocks.relayTxAndWaitPacket).not.toHaveBeenCalled();
  });

  it('forwards the wrapped failure from executeIncreaseLiquidity (SodaxError(INTENT_CREATION_FAILED, dex))', async () => {
    const sendError = new Error('SEND_REJECTED');
    vi.spyOn(sodax.spoke, 'sendMessage').mockResolvedValueOnce({ ok: false, error: sendError });

    const result = await cl.increaseLiquidity({
      params: increaseParams(ChainKeys.BSC_MAINNET),
      raw: false,
      walletProvider: mockEvmProvider,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(isSodaxError(result.error)).toBe(true);
    expect((result.error as SodaxError).code).toBe('INTENT_CREATION_FAILED');
    expect((result.error as SodaxError).feature).toBe('dex');
    expect((result.error as SodaxError).cause).toBe(sendError);
  });

  it('forwards the failure from relayTxAndWaitPacket', async () => {
    vi.spyOn(sodax.spoke, 'sendMessage').mockResolvedValueOnce({ ok: true, value: '0xspokeTx' });
    const relayError = new Error('RELAY_TIMEOUT');
    mocks.relayTxAndWaitPacket.mockResolvedValueOnce({ ok: false, error: relayError });

    const result = await cl.increaseLiquidity({
      params: increaseParams(ChainKeys.BSC_MAINNET),
      raw: false,
      walletProvider: mockEvmProvider,
    });

    expect(result).toEqual({ ok: false, error: relayError });
  });
});

describe('ClService.decreaseLiquidity', () => {
  it('on a non-hub spoke, relays and returns both src and dst tx hashes', async () => {
    vi.spyOn(sodax.spoke, 'sendMessage').mockResolvedValueOnce({ ok: true, value: '0xspokeTx' });
    mocks.relayTxAndWaitPacket.mockResolvedValueOnce({ ok: true, value: { dst_tx_hash: '0xhubTx' } });

    const result = await cl.decreaseLiquidity({
      params: decreaseParams(ChainKeys.BSC_MAINNET),
      raw: false,
      walletProvider: mockEvmProvider,
    });

    expect(result).toEqual({ ok: true, value: { srcChainTxHash: '0xspokeTx', dstChainTxHash: '0xhubTx' } });
  });

  it('on the hub chain, skips the relay', async () => {
    vi.spyOn(sodax.spoke, 'sendMessage').mockResolvedValueOnce({ ok: true, value: '0xsonicTx' });

    const result = await cl.decreaseLiquidity({
      params: decreaseParams(ChainKeys.SONIC_MAINNET),
      raw: false,
      walletProvider: mockEvmProvider,
    });

    expect(result).toEqual({ ok: true, value: { srcChainTxHash: '0xsonicTx', dstChainTxHash: '0xsonicTx' } });
    expect(mocks.relayTxAndWaitPacket).not.toHaveBeenCalled();
  });

  it('forwards the wrapped failure from executeDecreaseLiquidity (SodaxError(INTENT_CREATION_FAILED, dex))', async () => {
    const sendError = new Error('SEND_REJECTED');
    vi.spyOn(sodax.spoke, 'sendMessage').mockResolvedValueOnce({ ok: false, error: sendError });

    const result = await cl.decreaseLiquidity({
      params: decreaseParams(ChainKeys.BSC_MAINNET),
      raw: false,
      walletProvider: mockEvmProvider,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(isSodaxError(result.error)).toBe(true);
    expect((result.error as SodaxError).code).toBe('INTENT_CREATION_FAILED');
    expect((result.error as SodaxError).feature).toBe('dex');
    expect((result.error as SodaxError).cause).toBe(sendError);
  });

  it('forwards the failure from relayTxAndWaitPacket', async () => {
    vi.spyOn(sodax.spoke, 'sendMessage').mockResolvedValueOnce({ ok: true, value: '0xspokeTx' });
    const relayError = new Error('RELAY_TIMEOUT');
    mocks.relayTxAndWaitPacket.mockResolvedValueOnce({ ok: false, error: relayError });

    const result = await cl.decreaseLiquidity({
      params: decreaseParams(ChainKeys.BSC_MAINNET),
      raw: false,
      walletProvider: mockEvmProvider,
    });

    expect(result).toEqual({ ok: false, error: relayError });
  });
});

describe('ClService.claimRewards', () => {
  it('on a non-hub spoke, relays and returns both src and dst tx hashes', async () => {
    vi.spyOn(sodax.spoke, 'sendMessage').mockResolvedValueOnce({ ok: true, value: '0xspokeTx' });
    mocks.relayTxAndWaitPacket.mockResolvedValueOnce({ ok: true, value: { dst_tx_hash: '0xhubTx' } });

    const result = await cl.claimRewards({
      params: claimParams(ChainKeys.BSC_MAINNET),
      raw: false,
      walletProvider: mockEvmProvider,
    });

    expect(result).toEqual({ ok: true, value: { srcChainTxHash: '0xspokeTx', dstChainTxHash: '0xhubTx' } });
  });

  it('on the hub chain, skips the relay', async () => {
    vi.spyOn(sodax.spoke, 'sendMessage').mockResolvedValueOnce({ ok: true, value: '0xsonicTx' });

    const result = await cl.claimRewards({
      params: claimParams(ChainKeys.SONIC_MAINNET),
      raw: false,
      walletProvider: mockEvmProvider,
    });

    expect(result).toEqual({ ok: true, value: { srcChainTxHash: '0xsonicTx', dstChainTxHash: '0xsonicTx' } });
    expect(mocks.relayTxAndWaitPacket).not.toHaveBeenCalled();
  });

  it('forwards the wrapped failure from executeClaimRewards (SodaxError(INTENT_CREATION_FAILED, dex))', async () => {
    const sendError = new Error('SEND_REJECTED');
    vi.spyOn(sodax.spoke, 'sendMessage').mockResolvedValueOnce({ ok: false, error: sendError });

    const result = await cl.claimRewards({
      params: claimParams(ChainKeys.BSC_MAINNET),
      raw: false,
      walletProvider: mockEvmProvider,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(isSodaxError(result.error)).toBe(true);
    expect((result.error as SodaxError).code).toBe('INTENT_CREATION_FAILED');
    expect((result.error as SodaxError).feature).toBe('dex');
    expect((result.error as SodaxError).cause).toBe(sendError);
  });

  it('forwards the failure from relayTxAndWaitPacket', async () => {
    vi.spyOn(sodax.spoke, 'sendMessage').mockResolvedValueOnce({ ok: true, value: '0xspokeTx' });
    const relayError = new Error('RELAY_TIMEOUT');
    mocks.relayTxAndWaitPacket.mockResolvedValueOnce({ ok: false, error: relayError });

    const result = await cl.claimRewards({
      params: claimParams(ChainKeys.BSC_MAINNET),
      raw: false,
      walletProvider: mockEvmProvider,
    });

    expect(result).toEqual({ ok: false, error: relayError });
  });
});

// =========================================================================
// On-chain reads
// =========================================================================

describe('ClService.getMintPositionEvent', () => {
  const hubTxHash = '0xhubTx' as const;

  it('returns the tokenId from the first MintPosition log', async () => {
    vi.spyOn(sodax.hubProvider.publicClient, 'waitForTransactionReceipt').mockResolvedValueOnce({
      logs: [],
      // biome-ignore lint/suspicious/noExplicitAny: viem TransactionReceipt has many fields we don't exercise.
    } as any);
    mocks.parseEventLogs.mockReturnValueOnce([{ args: { tokenId: 42n } }]);

    const result = await cl.getMintPositionEvent(hubTxHash);

    expect(result).toEqual({ ok: true, value: { tokenId: 42n } });
  });

  it('returns ok:false when no MintPosition log is present', async () => {
    vi.spyOn(sodax.hubProvider.publicClient, 'waitForTransactionReceipt').mockResolvedValueOnce({
      logs: [],
      // biome-ignore lint/suspicious/noExplicitAny: viem TransactionReceipt has many fields we don't exercise.
    } as any);
    mocks.parseEventLogs.mockReturnValueOnce([]);

    const result = await cl.getMintPositionEvent(hubTxHash);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(String(result.error)).toMatch(/No mint position event found/);
  });

  it('returns ok:false when the event log has no tokenId', async () => {
    vi.spyOn(sodax.hubProvider.publicClient, 'waitForTransactionReceipt').mockResolvedValueOnce({
      logs: [],
      // biome-ignore lint/suspicious/noExplicitAny: viem TransactionReceipt has many fields we don't exercise.
    } as any);
    mocks.parseEventLogs.mockReturnValueOnce([{ args: {} }]);

    const result = await cl.getMintPositionEvent(hubTxHash);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(String(result.error)).toMatch(/No tokenId found/);
  });

  it('wraps thrown errors as SodaxError(LOOKUP_FAILED, dex) with .cause', async () => {
    const rpcError = new Error('RPC_DOWN');
    vi.spyOn(sodax.hubProvider.publicClient, 'waitForTransactionReceipt').mockRejectedValueOnce(rpcError);

    const result = await cl.getMintPositionEvent(hubTxHash);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect((result.error as { code: string }).code).toBe('LOOKUP_FAILED');
      expect((result.error as Error).cause).toBe(rpcError);
    }
  });
});

describe('ClService.getPoolRewardConfig', () => {
  it('returns the reward currency / rate / timestamp tuple from the hook contract', async () => {
    const client = createMockClient({
      poolRewardConfigs: () => ['0xRewardToken', 1234n, 1_700_000_000n],
    });

    const result = await cl.getPoolRewardConfig(plainPoolKey, client);

    expect(result).toEqual({
      ok: true,
      value: {
        rewardCurrency: '0xRewardToken',
        rewardRatePerSecond: 1234n,
        lastActionTimestamp: 1_700_000_000n,
      },
    });
  });

  it('returns ok:false when the pool has no hook configured (zero address)', async () => {
    const client = createMockClient({});
    const result = await cl.getPoolRewardConfig({ ...plainPoolKey, hooks: ZERO_ADDRESS }, client);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(String(result.error)).toMatch(/Pool has no hook configured/);
  });

  it('wraps thrown errors as SodaxError(LOOKUP_FAILED, dex) with .cause', async () => {
    const client = createMockClient({
      poolRewardConfigs: () => {
        throw new Error('REVERT');
      },
    });

    const result = await cl.getPoolRewardConfig(plainPoolKey, client);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect((result.error as { code: string }).code).toBe('LOOKUP_FAILED');
      expect(((result.error as Error).cause as Error).message).toBe('REVERT');
    }
  });
});

describe('ClService.getPoolData', () => {
  // Helper: build a publicClient that returns realistic responses for every read
  // `getPoolData` performs against a pool with a hook + non-StatA token currencies.
  const makeHappyClient = (overrides: Record<string, () => unknown> = {}) =>
    createMockClient({
      getSlot0: () => [sqrtPriceAtTick(0), 0, 0, 0],
      getLiquidity: () => 1_000_000n,
      symbol: () => 'TKN',
      name: () => 'Token',
      decimals: () => 18,
      poolRewardConfigs: () => ['0xRewardToken', 7n, 1_700_000_000n],
      ...overrides,
    });

  it('returns hydrated PoolData with reward config when the hook is set and rate > 0', async () => {
    const client = makeHappyClient();

    const result = await cl.getPoolData(plainPoolKey, client);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.poolId).toBe('0xpoolid');
      expect(result.value.totalLiquidity).toBe(1_000_000n);
      expect(result.value.isActive).toBe(true);
      expect(result.value.rewardConfig).toEqual({
        rewardCurrency: '0xRewardToken',
        rewardRatePerSecond: 7n,
        lastActionTimestamp: 1_700_000_000n,
      });
      // Plain (non-StatA) currencies → enrichment short-circuits.
      expect(result.value.token0IsStatAToken).toBe(false);
      expect(result.value.token1IsStatAToken).toBe(false);
    }
  });

  it('omits rewardConfig when the pool has no hook (zero address)', async () => {
    const client = makeHappyClient();

    const result = await cl.getPoolData({ ...plainPoolKey, hooks: ZERO_ADDRESS }, client);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.rewardConfig).toBeUndefined();
  });

  it('omits rewardConfig when the hook reports a zero reward rate', async () => {
    const client = makeHappyClient({
      poolRewardConfigs: () => ['0xRewardToken', 0n, 0n],
    });

    const result = await cl.getPoolData(plainPoolKey, client);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.rewardConfig).toBeUndefined();
  });

  it('wraps thrown errors as SodaxError(LOOKUP_FAILED, dex) with .cause', async () => {
    const client = createMockClient({
      getSlot0: () => {
        throw new Error('REVERT');
      },
    });

    const result = await cl.getPoolData(plainPoolKey, client);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect((result.error as { code: string }).code).toBe('LOOKUP_FAILED');
      expect(((result.error as Error).cause as Error).message).toBe('REVERT');
    }
  });
});

describe('ClService.getPositionInfo', () => {
  // `getPositionInfo` calls `getPoolData` internally — both share the same `publicClient`.
  // The fixture below answers every read needed for both.
  const buildClient = (currentTick: number, tickLower: number, tickUpper: number) =>
    createMockClient({
      positions: () => [
        '0xencoded' as never,
        tickLower,
        tickUpper,
        1_000n,
        0n, // feeGrowthInside0LastX128
        0n, // feeGrowthInside1LastX128
        ZERO_ADDRESS, // subscriber
      ],
      getSlot0: () => [sqrtPriceAtTick(currentTick), currentTick, 0, 0],
      getLiquidity: () => 1_000n,
      symbol: () => 'TKN',
      name: () => 'Token',
      decimals: () => 18,
      poolRewardConfigs: () => ['0xRewardToken', 0n, 0n],
      getFeeGrowthGlobals: () => [0n, 0n],
      getPoolTickInfo: () => ({
        liquidityGross: 0n,
        liquidityNet: 0n,
        feeGrowthOutside0X128: 0n,
        feeGrowthOutside1X128: 0n,
      }),
    });

  beforeEach(() => {
    mocks.decodePoolKey.mockReturnValue(plainPoolKey);
  });

  it('returns position info when the current tick is inside the position range', async () => {
    const client = buildClient(0, -1000, 1000);

    const result = await cl.getPositionInfo(7n, client);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.tickLower).toBe(-1000);
      expect(result.value.tickUpper).toBe(1000);
      expect(result.value.liquidity).toBe(1_000n);
      // Plain currencies → no underlying conversion.
      expect(result.value.amount0Underlying).toBeUndefined();
      expect(result.value.amount1Underlying).toBeUndefined();
    }
  });

  it('returns position info when the current tick is below the position range', async () => {
    const client = buildClient(-2000, -1000, 1000);

    const result = await cl.getPositionInfo(7n, client);

    expect(result.ok).toBe(true);
  });

  it('returns position info when the current tick is above the position range', async () => {
    const client = buildClient(2000, -1000, 1000);

    const result = await cl.getPositionInfo(7n, client);

    expect(result.ok).toBe(true);
  });

  it('forwards the failure when getPoolData fails', async () => {
    const client = createMockClient({
      positions: () => ['0xencoded' as never, -1000, 1000, 1_000n, 0n, 0n, ZERO_ADDRESS],
      // getSlot0 reverts → getPoolData returns ok:false → getPositionInfo forwards as-is.
      getSlot0: () => {
        throw new Error('REVERT');
      },
    });

    const result = await cl.getPositionInfo(7n, client);

    expect(result.ok).toBe(false);
    if (!result.ok) expect((result.error as { code: string }).code).toBe('LOOKUP_FAILED');
  });

  it('wraps thrown errors as SodaxError(LOOKUP_FAILED, dex) with .cause', async () => {
    const client = createMockClient({
      positions: () => {
        throw new Error('REVERT');
      },
    });

    const result = await cl.getPositionInfo(7n, client);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect((result.error as { code: string }).code).toBe('LOOKUP_FAILED');
      expect(((result.error as Error).cause as Error).message).toBe('REVERT');
    }
  });
});

// =========================================================================
// Static helpers — pure math, no fixtures or mocks needed.
// =========================================================================

describe('ClService.calculateLiquidityFromAmounts', () => {
  const tickLower = -1000n;
  const tickUpper = 1000n;
  const currentTick = 0n;

  it('returns 0 when amount0 is 0 and amount1 is 0', () => {
    expect(ClService.calculateLiquidityFromAmounts(0n, 0n, tickLower, tickUpper, currentTick)).toBe(0n);
  });

  it('falls back to single-sided amount0 math when only amount0 is supplied', () => {
    // amount0 === 0 path inside the helper uses `maxLiquidityForAmount0Precise`.
    const liquidity = ClService.calculateLiquidityFromAmounts(0n, 1_000_000n, tickLower, tickUpper, currentTick);
    expect(liquidity).toBeGreaterThanOrEqual(0n);
  });

  it('falls back to single-sided amount1 math when only amount1 is supplied', () => {
    const liquidity = ClService.calculateLiquidityFromAmounts(1_000_000n, 0n, tickLower, tickUpper, currentTick);
    expect(liquidity).toBeGreaterThanOrEqual(0n);
  });

  it('returns positive liquidity when both amounts are non-zero', () => {
    const liquidity = ClService.calculateLiquidityFromAmounts(
      1_000_000n,
      1_000_000n,
      tickLower,
      tickUpper,
      currentTick,
    );
    expect(liquidity).toBeGreaterThan(0n);
  });
});

describe('ClService.calculateAmount1FromAmount0', () => {
  const tickLower = -1000n;
  const tickUpper = 1000n;
  const currentTick = 0n;
  const sqrtPriceX96 = sqrtPriceAtTick(0);

  it('returns 0 when amount0 is 0', () => {
    expect(ClService.calculateAmount1FromAmount0(0n, tickLower, tickUpper, currentTick, sqrtPriceX96)).toBe(0n);
  });

  it('returns a positive amount1 for a positive amount0 in an in-range pool', () => {
    const amount1 = ClService.calculateAmount1FromAmount0(1_000_000n, tickLower, tickUpper, currentTick, sqrtPriceX96);
    expect(amount1).toBeGreaterThan(0n);
  });
});

describe('ClService.calculateAmount0FromAmount1', () => {
  const tickLower = -1000n;
  const tickUpper = 1000n;
  const currentTick = 0n;
  const sqrtPriceX96 = sqrtPriceAtTick(0);

  it('returns 0 when amount1 is 0', () => {
    expect(ClService.calculateAmount0FromAmount1(0n, tickLower, tickUpper, currentTick, sqrtPriceX96)).toBe(0n);
  });

  it('returns a positive amount0 for a positive amount1 in an in-range pool', () => {
    const amount0 = ClService.calculateAmount0FromAmount1(1_000_000n, tickLower, tickUpper, currentTick, sqrtPriceX96);
    expect(amount0).toBeGreaterThan(0n);
  });
});

describe('ClService.priceToTick', () => {
  // Fake tokens for the Price object — addresses don't matter, only `decimals`.
  const token0 = new Token(146, '0x0000000000000000000000000000000000000001', 18, 'T0', 'Token0');
  const token1 = new Token(146, '0x0000000000000000000000000000000000000002', 18, 'T1', 'Token1');

  it('returns 0 for price = 1 with equal decimals (the natural tick at parity)', () => {
    expect(ClService.priceToTick(1, token0, token1, 1)).toBe(0n);
  });

  it('rounds the result to a multiple of tickSpacing', () => {
    const tick = ClService.priceToTick(1.5, token0, token1, 60);
    expect(Number(tick) % 60).toBe(0);
  });

  it('returns a negative tick for a price below 1 and a positive tick for a price above 1', () => {
    const lowPrice = ClService.priceToTick(0.5, token0, token1, 1);
    const highPrice = ClService.priceToTick(2, token0, token1, 1);
    expect(lowPrice).toBeLessThan(0n);
    expect(highPrice).toBeGreaterThan(0n);
  });
});

// =========================================================================
// Static: calculateMaxAmountsForSlippage — kept verbatim from the previous test
// pass since the math is well-covered. These tests don't need any mocks.
// =========================================================================

describe('ClService.calculateMaxAmountsForSlippage', () => {
  const tickLower = -1000n;
  const tickUpper = 1000n;
  const currentTick = 0n;
  const sqrtPriceX96 = sqrtPriceAtTick(0);
  const liquidity = 10n ** 18n;

  it('returns zero for both tokens when liquidity is zero', () => {
    const result = ClService.calculateMaxAmountsForSlippage(0n, tickLower, tickUpper, currentTick, sqrtPriceX96, 1);
    expect(result.amount0Max).toBe(0n);
    expect(result.amount1Max).toBe(0n);
  });

  it('returns exactly the current amounts when slippage is zero', () => {
    const current0 = PositionMath.getToken0Amount(0, -1000, 1000, sqrtPriceX96, liquidity);
    const current1 = PositionMath.getToken1Amount(0, -1000, 1000, sqrtPriceX96, liquidity);

    const result = ClService.calculateMaxAmountsForSlippage(
      liquidity,
      tickLower,
      tickUpper,
      currentTick,
      sqrtPriceX96,
      0,
    );

    expect(result.amount0Max).toBe(current0);
    expect(result.amount1Max).toBe(current1);
  });

  it('returns amounts at least as large as the current amounts for a positive slippage', () => {
    const current0 = PositionMath.getToken0Amount(0, -1000, 1000, sqrtPriceX96, liquidity);
    const current1 = PositionMath.getToken1Amount(0, -1000, 1000, sqrtPriceX96, liquidity);

    const result = ClService.calculateMaxAmountsForSlippage(
      liquidity,
      tickLower,
      tickUpper,
      currentTick,
      sqrtPriceX96,
      1,
    );

    expect(result.amount0Max).toBeGreaterThanOrEqual(current0);
    expect(result.amount1Max).toBeGreaterThanOrEqual(current1);
  });

  it('is monotonic in slippage: larger slippage never produces smaller max amounts', () => {
    const low = ClService.calculateMaxAmountsForSlippage(liquidity, tickLower, tickUpper, currentTick, sqrtPriceX96, 1);
    const high = ClService.calculateMaxAmountsForSlippage(
      liquidity,
      tickLower,
      tickUpper,
      currentTick,
      sqrtPriceX96,
      10,
    );

    expect(high.amount0Max).toBeGreaterThanOrEqual(low.amount0Max);
    expect(high.amount1Max).toBeGreaterThanOrEqual(low.amount1Max);
  });

  it('slippagePercent scale is percent: 10% produces strictly larger amounts than 1% for an in-range position', () => {
    const onePercent = ClService.calculateMaxAmountsForSlippage(
      liquidity,
      tickLower,
      tickUpper,
      currentTick,
      sqrtPriceX96,
      1,
    );
    const tenPercent = ClService.calculateMaxAmountsForSlippage(
      liquidity,
      tickLower,
      tickUpper,
      currentTick,
      sqrtPriceX96,
      10,
    );

    expect(tenPercent.amount0Max).toBeGreaterThan(onePercent.amount0Max);
    expect(tenPercent.amount1Max).toBeGreaterThan(onePercent.amount1Max);
  });

  it('handles the current tick at the lower range boundary (position entirely in token0)', () => {
    const boundaryTick = tickLower;
    const boundarySqrtPrice = sqrtPriceAtTick(Number(boundaryTick));
    const current1 = PositionMath.getToken1Amount(
      Number(boundaryTick),
      Number(tickLower),
      Number(tickUpper),
      boundarySqrtPrice,
      liquidity,
    );
    expect(current1).toBe(0n);

    const result = ClService.calculateMaxAmountsForSlippage(
      liquidity,
      tickLower,
      tickUpper,
      boundaryTick,
      boundarySqrtPrice,
      1,
    );

    expect(result.amount0Max).toBeGreaterThan(0n);
  });

  it('handles the current tick at the upper range boundary (position entirely in token1)', () => {
    const boundaryTick = tickUpper;
    const boundarySqrtPrice = sqrtPriceAtTick(Number(boundaryTick));
    const current0 = PositionMath.getToken0Amount(
      Number(boundaryTick),
      Number(tickLower),
      Number(tickUpper),
      boundarySqrtPrice,
      liquidity,
    );
    expect(current0).toBe(0n);

    const result = ClService.calculateMaxAmountsForSlippage(
      liquidity,
      tickLower,
      tickUpper,
      boundaryTick,
      boundarySqrtPrice,
      1,
    );

    expect(result.amount1Max).toBeGreaterThan(0n);
  });

  it('handles the current tick below the range', () => {
    const belowTick = -2000n;
    const belowSqrtPrice = sqrtPriceAtTick(Number(belowTick));

    const result = ClService.calculateMaxAmountsForSlippage(
      liquidity,
      tickLower,
      tickUpper,
      belowTick,
      belowSqrtPrice,
      1,
    );

    expect(result.amount0Max).toBeGreaterThan(0n);
    expect(result.amount1Max).toBe(0n);
  });

  it('handles the current tick above the range', () => {
    const aboveTick = 2000n;
    const aboveSqrtPrice = sqrtPriceAtTick(Number(aboveTick));

    const result = ClService.calculateMaxAmountsForSlippage(
      liquidity,
      tickLower,
      tickUpper,
      aboveTick,
      aboveSqrtPrice,
      1,
    );

    expect(result.amount0Max).toBe(0n);
    expect(result.amount1Max).toBeGreaterThan(0n);
  });

  it('handles a very narrow range around the current tick', () => {
    const narrowLower = -10n;
    const narrowUpper = 10n;

    const result = ClService.calculateMaxAmountsForSlippage(
      liquidity,
      narrowLower,
      narrowUpper,
      currentTick,
      sqrtPriceX96,
      1,
    );

    expect(result.amount0Max).toBeGreaterThan(0n);
    expect(result.amount1Max).toBeGreaterThan(0n);
  });

  it('handles a very wide range', () => {
    const wideLower = -100000n;
    const wideUpper = 100000n;

    const result = ClService.calculateMaxAmountsForSlippage(
      liquidity,
      wideLower,
      wideUpper,
      currentTick,
      sqrtPriceX96,
      0.5,
    );

    expect(result.amount0Max).toBeGreaterThan(0n);
    expect(result.amount1Max).toBeGreaterThan(0n);
  });

  it('handles realistic large liquidity values without overflow', () => {
    const largeLiquidity = 10n ** 24n;

    const result = ClService.calculateMaxAmountsForSlippage(
      largeLiquidity,
      tickLower,
      tickUpper,
      currentTick,
      sqrtPriceX96,
      0.5,
    );

    expect(result.amount0Max).toBeGreaterThan(0n);
    expect(result.amount1Max).toBeGreaterThan(0n);
  });

  it('handles sub-percent slippage (0.1%)', () => {
    const current0 = PositionMath.getToken0Amount(0, -1000, 1000, sqrtPriceX96, liquidity);
    const current1 = PositionMath.getToken1Amount(0, -1000, 1000, sqrtPriceX96, liquidity);

    const result = ClService.calculateMaxAmountsForSlippage(
      liquidity,
      tickLower,
      tickUpper,
      currentTick,
      sqrtPriceX96,
      0.1,
    );

    expect(result.amount0Max).toBeGreaterThanOrEqual(current0);
    expect(result.amount1Max).toBeGreaterThanOrEqual(current1);
  });

  it('matches direct PositionMath call within the worst-case bound', () => {
    const slippagePercent = 2;
    const SLIPPAGE_SCALE = 1_000_000_000n;
    const slippageScaled = BigInt(Math.round((slippagePercent * Number(SLIPPAGE_SCALE)) / 100));
    const sqrtPriceSquared = sqrtPriceX96 * sqrtPriceX96;

    const sqrtPriceX96Down = bigIntSqrt((sqrtPriceSquared * (SLIPPAGE_SCALE - slippageScaled)) / SLIPPAGE_SCALE);
    const sqrtPriceX96Up = bigIntSqrt((sqrtPriceSquared * (SLIPPAGE_SCALE + slippageScaled)) / SLIPPAGE_SCALE);
    const tickDown = TickMath.getTickAtSqrtRatio(sqrtPriceX96Down);
    const tickUp = TickMath.getTickAtSqrtRatio(sqrtPriceX96Up);

    const expectedAmount0AtDrop = PositionMath.getToken0Amount(
      tickDown,
      Number(tickLower),
      Number(tickUpper),
      sqrtPriceX96Down,
      liquidity,
    );
    const expectedAmount1AtRise = PositionMath.getToken1Amount(
      tickUp,
      Number(tickLower),
      Number(tickUpper),
      sqrtPriceX96Up,
      liquidity,
    );
    const current0 = PositionMath.getToken0Amount(0, -1000, 1000, sqrtPriceX96, liquidity);
    const current1 = PositionMath.getToken1Amount(0, -1000, 1000, sqrtPriceX96, liquidity);

    const result = ClService.calculateMaxAmountsForSlippage(
      liquidity,
      tickLower,
      tickUpper,
      currentTick,
      sqrtPriceX96,
      slippagePercent,
    );

    expect(result.amount0Max).toBe(expectedAmount0AtDrop > current0 ? expectedAmount0AtDrop : current0);
    expect(result.amount1Max).toBe(expectedAmount1AtRise > current1 ? expectedAmount1AtRise : current1);
  });

  it('preserves precision for large sqrtPriceX96 values that overflow JS Number', () => {
    // sqrtPriceX96 at a high tick is far beyond Number.MAX_SAFE_INTEGER (~2^53).
    const highTick = 200000n;
    const largeSqrtPrice = sqrtPriceAtTick(Number(highTick));
    expect(largeSqrtPrice).toBeGreaterThan(BigInt(Number.MAX_SAFE_INTEGER));

    const result = ClService.calculateMaxAmountsForSlippage(
      liquidity,
      highTick - 100n,
      highTick + 100n,
      highTick,
      largeSqrtPrice,
      0.5,
    );

    expect(result.amount0Max).toBeGreaterThan(0n);
    expect(result.amount1Max).toBeGreaterThan(0n);
  });
});

function bigIntSqrt(n: bigint): bigint {
  if (n < 0n) throw new Error('bigIntSqrt: negative');
  if (n < 2n) return n;
  let x = 1n << ((BigInt(n.toString(2).length) + 1n) / 2n);
  while (true) {
    const next = (x + n / x) / 2n;
    if (next >= x) return x;
    x = next;
  }
}
