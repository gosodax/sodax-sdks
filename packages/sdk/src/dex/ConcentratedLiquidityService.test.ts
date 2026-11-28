/**
 * Tests for the public API of `ClService` (concentrated-liquidity DEX service).
 *
 * A single real `Sodax` instance backs every test. The file stays in the module-mocking project:
 * it replaces pancakeswap's calldata encoders and viem's `parseEventLogs`, whose ESM namespaces
 * cannot be spied. Static helpers are covered with pure-math assertions — no mocks needed.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PositionMath, TickMath } from '@pancakeswap/v3-sdk';
import { Token } from '@pancakeswap/swap-sdk-core';
import { ChainKeys, type Address, type PoolKey, type SpokeChainKey } from '@sodax/types';
import type { PublicClient, TransactionReceipt } from 'viem';
import { Sodax } from '../shared/entities/Sodax.js';
import type {
  ClSupplyAction,
  ClLiquidityIncreaseLiquidityAction,
  ClLiquidityDecreaseLiquidityAction,
  ClLiquidityClaimRewardsAction,
} from './ConcentratedLiquidityService.js';
import { ClService } from './ConcentratedLiquidityService.js';
import { expectErr, expectOk } from '../test-utils/result.js';
import { mockEvmWalletProvider } from '../test-utils/walletProviders.js';

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

// `ClService` only forwards the provider through the stubbed `SpokeService.sendMessage`.
const mockEvmProvider = mockEvmWalletProvider();

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
    // Only `readContract` is called; a real PublicClient carries transport and chain state the reads never touch.
  } as unknown as PublicClient;
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

  it('refuses every execute action from Tron without resolving the hub wallet or sending', async () => {
    const send = vi.spyOn(sodax.spoke, 'sendMessage');
    const runs = [
      () => cl.executeSupplyLiquidity({ params: supplyParams(TRON), raw: true }),
      () => cl.executeIncreaseLiquidity({ params: increaseParams(TRON), raw: true }),
      () => cl.executeDecreaseLiquidity({ params: decreaseParams(TRON), raw: true }),
      () => cl.executeClaimRewards({ params: claimParams(TRON), raw: true }),
    ];

    for (const run of runs) {
      expect(expectErr(await run(), 'VALIDATION_FAILED').feature).toBe('dex');
    }
    expect(send).not.toHaveBeenCalled();
    expect(mocks.getUserHubWalletAddress).not.toHaveBeenCalled();
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
  it('throws when token0 or token1 cannot be resolved', () => {
    vi.spyOn(sodax.config, 'getOriginalAssetAddressFromStakedATokenAddress').mockReturnValue('0xT0');
    const find = vi.spyOn(sodax.config, 'findTokenByOriginalAddress').mockReturnValueOnce(undefined);

    expect(() => cl.getAssetsForPool(ChainKeys.BSC_MAINNET, plainPoolKey)).toThrow(/Token0 .* not found/);

    find.mockReturnValueOnce({ symbol: 'T0' } as never).mockReturnValueOnce(undefined);

    expect(() => cl.getAssetsForPool(ChainKeys.BSC_MAINNET, plainPoolKey)).toThrow(/Token1 .* not found/);
  });
});

// =========================================================================
// execute* methods — encode + delegate to SpokeService.sendMessage
// =========================================================================

const lastSendArg = () => vi.mocked(sodax.spoke.sendMessage).mock.calls.at(-1)?.[0];

/** Asserts a failed Result is SodaxError(INTENT_CREATION_FAILED, dex) carrying `cause`. */
function expectIntentCreationFailed(result: Parameters<typeof expectErr>[0], cause: unknown) {
  const error = expectErr(result, 'INTENT_CREATION_FAILED');
  expect(error.feature).toBe('dex');
  expect(error.cause).toBe(cause);
}

describe('ClService.executeSupplyLiquidity', () => {
  it('forwards walletProvider when raw=false and omits it when raw=true, addressed to the hub wallet', async () => {
    const rawTx = { from: '0x1', to: '0x2', data: '0x', value: 0n };
    vi.spyOn(sodax.spoke, 'sendMessage')
      .mockResolvedValueOnce({ ok: true, value: '0xspokeTx' })
      .mockResolvedValueOnce({ ok: true, value: rawTx as never });

    const result = await cl.executeSupplyLiquidity({
      params: supplyParams(ChainKeys.BSC_MAINNET),
      raw: false,
      walletProvider: mockEvmProvider,
    } satisfies ClSupplyAction<'0x38.bsc', false>);

    const value = expectOk(result);
    expect(value.tx).toBe('0xspokeTx');
    expect(value.relayData).toEqual({ address: HUB_WALLET, payload: expect.any(String) });
    const sendArg = lastSendArg();
    expect(sendArg?.raw).toBe(false);
    expect(sendArg?.walletProvider).toBe(mockEvmProvider);
    expect(sendArg?.srcChainKey).toBe(ChainKeys.BSC_MAINNET);
    expect(sendArg?.dstAddress).toBe(HUB_WALLET);
    expect(mocks.encodeMintCalldata).toHaveBeenCalledTimes(1);

    const raw = await cl.executeSupplyLiquidity({
      params: supplyParams(ChainKeys.BSC_MAINNET),
      raw: true,
    } satisfies ClSupplyAction<'0x38.bsc', true>);

    expectOk(raw);
    expect(lastSendArg()?.raw).toBe(true);
    expect(lastSendArg()).not.toHaveProperty('walletProvider');
  });
});

describe('ClService.executeIncreaseLiquidity', () => {
  it('encodes increase calldata, forwarding walletProvider when raw=false and omitting it when raw=true', async () => {
    vi.spyOn(sodax.spoke, 'sendMessage')
      .mockResolvedValueOnce({ ok: true, value: '0xspokeTx' })
      .mockResolvedValueOnce({ ok: true, value: '0xrawTx' as never });

    const result = await cl.executeIncreaseLiquidity({
      params: increaseParams(ChainKeys.BSC_MAINNET),
      raw: false,
      walletProvider: mockEvmProvider,
    } satisfies ClLiquidityIncreaseLiquidityAction<'0x38.bsc', false>);

    expect(expectOk(result).tx).toBe('0xspokeTx');
    expect(mocks.encodeIncreaseCalldata).toHaveBeenCalledTimes(1);

    await cl.executeIncreaseLiquidity({
      params: increaseParams(ChainKeys.BSC_MAINNET),
      raw: true,
    } satisfies ClLiquidityIncreaseLiquidityAction<'0x38.bsc', true>);

    expect(lastSendArg()?.raw).toBe(true);
    expect(lastSendArg()).not.toHaveProperty('walletProvider');
  });
});

describe('ClService.executeDecreaseLiquidity', () => {
  it('encodes the decrease amounts, forwarding walletProvider when raw=false and omitting it when raw=true', async () => {
    vi.spyOn(sodax.spoke, 'sendMessage')
      .mockResolvedValueOnce({ ok: true, value: '0xspokeTx' })
      .mockResolvedValueOnce({ ok: true, value: '0xrawTx' as never });

    const result = await cl.executeDecreaseLiquidity({
      params: decreaseParams(ChainKeys.BSC_MAINNET),
      raw: false,
      walletProvider: mockEvmProvider,
    } satisfies ClLiquidityDecreaseLiquidityAction<'0x38.bsc', false>);

    expect(expectOk(result).tx).toBe('0xspokeTx');
    const decodeArgs = mocks.encodeDecreaseCalldata.mock.calls[0]?.[0];
    expect(decodeArgs.tokenId).toBe(7n);
    expect(decodeArgs.liquidity).toBe(500n);
    expect(decodeArgs.amount0Min).toBe(1n);
    expect(decodeArgs.amount1Min).toBe(2n);

    await cl.executeDecreaseLiquidity({
      params: decreaseParams(ChainKeys.BSC_MAINNET),
      raw: true,
    } satisfies ClLiquidityDecreaseLiquidityAction<'0x38.bsc', true>);

    expect(lastSendArg()?.raw).toBe(true);
    expect(lastSendArg()).not.toHaveProperty('walletProvider');
  });
});

describe('ClService.executeClaimRewards', () => {
  it('encodes a 0-liquidity decrease call (the harvest trick), omitting walletProvider when raw=true', async () => {
    vi.spyOn(sodax.spoke, 'sendMessage')
      .mockResolvedValueOnce({ ok: true, value: '0xspokeTx' })
      .mockResolvedValueOnce({ ok: true, value: '0xrawTx' as never });

    const result = await cl.executeClaimRewards({
      params: claimParams(ChainKeys.BSC_MAINNET),
      raw: false,
      walletProvider: mockEvmProvider,
    } satisfies ClLiquidityClaimRewardsAction<'0x38.bsc', false>);

    expectOk(result);
    const decodeArgs = mocks.encodeDecreaseCalldata.mock.calls[0]?.[0];
    expect(decodeArgs.liquidity).toBe(0n);
    expect(decodeArgs.amount0Min).toBe(0n);
    expect(decodeArgs.amount1Min).toBe(0n);

    await cl.executeClaimRewards({
      params: claimParams(ChainKeys.BSC_MAINNET),
      raw: true,
    } satisfies ClLiquidityClaimRewardsAction<'0x38.bsc', true>);

    expect(lastSendArg()?.raw).toBe(true);
    expect(lastSendArg()).not.toHaveProperty('walletProvider');
  });
});

describe('ClService execute* failures', () => {
  it('wraps a sendMessage failure Result or a hub-wallet lookup rejection as INTENT_CREATION_FAILED for every action', async () => {
    const runs = [
      () =>
        cl.executeSupplyLiquidity({
          params: supplyParams(ChainKeys.BSC_MAINNET),
          raw: false,
          walletProvider: mockEvmProvider,
        }),
      () =>
        cl.executeIncreaseLiquidity({
          params: increaseParams(ChainKeys.BSC_MAINNET),
          raw: false,
          walletProvider: mockEvmProvider,
        }),
      () =>
        cl.executeDecreaseLiquidity({
          params: decreaseParams(ChainKeys.BSC_MAINNET),
          raw: false,
          walletProvider: mockEvmProvider,
        }),
      () =>
        cl.executeClaimRewards({
          params: claimParams(ChainKeys.BSC_MAINNET),
          raw: false,
          walletProvider: mockEvmProvider,
        }),
    ];
    for (const run of runs) {
      const sendError = new Error('SEND_REJECTED');
      vi.spyOn(sodax.spoke, 'sendMessage').mockResolvedValueOnce({ ok: false, error: sendError });

      expectIntentCreationFailed(await run(), sendError);

      const hubError = new Error('HUB_LOOKUP_FAILED');
      mocks.getUserHubWalletAddress.mockRejectedValueOnce(hubError);

      expectIntentCreationFailed(await run(), hubError);
    }
  });
});

// =========================================================================
// Lifecycle methods — execute*() + relay
// =========================================================================

describe('ClService lifecycle methods (supply / increase / decrease / claim)', () => {
  type LifecycleChain = typeof ChainKeys.BSC_MAINNET | typeof ChainKeys.SONIC_MAINNET;
  const lifecycle = [
    (k: LifecycleChain) => cl.supplyLiquidity({ params: supplyParams(k), raw: false, walletProvider: mockEvmProvider }),
    (k: LifecycleChain) =>
      cl.increaseLiquidity({ params: increaseParams(k), raw: false, walletProvider: mockEvmProvider }),
    (k: LifecycleChain) =>
      cl.decreaseLiquidity({ params: decreaseParams(k), raw: false, walletProvider: mockEvmProvider }),
    (k: LifecycleChain) => cl.claimRewards({ params: claimParams(k), raw: false, walletProvider: mockEvmProvider }),
  ];

  it('relays a spoke tx and returns both hashes, but skips the relay on the hub chain (Sonic)', async () => {
    for (const [i, run] of lifecycle.entries()) {
      vi.spyOn(sodax.spoke, 'sendMessage')
        .mockResolvedValueOnce({ ok: true, value: '0xspokeTx' })
        .mockResolvedValueOnce({ ok: true, value: '0xsonicTx' });
      mocks.relayTxAndWaitPacket.mockResolvedValueOnce({ ok: true, value: { dst_tx_hash: '0xhubTx' } });

      expect(await run(ChainKeys.BSC_MAINNET)).toEqual({
        ok: true,
        value: { srcChainTxHash: '0xspokeTx', dstChainTxHash: '0xhubTx' },
      });
      expect(await run(ChainKeys.SONIC_MAINNET)).toEqual({
        ok: true,
        value: { srcChainTxHash: '0xsonicTx', dstChainTxHash: '0xsonicTx' },
      });
      expect(mocks.relayTxAndWaitPacket).toHaveBeenCalledTimes(i + 1);
    }
  });

  it('wraps a failed or thrown send as INTENT_CREATION_FAILED, and returns a relay failure unchanged', async () => {
    for (const run of lifecycle) {
      const sendError = new Error('SEND_REJECTED');
      const thrown = new Error('SEND_THREW');
      const relayError = new Error('RELAY_TIMEOUT');
      vi.spyOn(sodax.spoke, 'sendMessage')
        .mockResolvedValueOnce({ ok: false, error: sendError })
        .mockRejectedValueOnce(thrown)
        .mockResolvedValueOnce({ ok: true, value: '0xspokeTx' });
      mocks.relayTxAndWaitPacket.mockResolvedValueOnce({ ok: false, error: relayError });

      expectIntentCreationFailed(await run(ChainKeys.BSC_MAINNET), sendError);
      expectIntentCreationFailed(await run(ChainKeys.BSC_MAINNET), thrown);
      expect(await run(ChainKeys.BSC_MAINNET)).toEqual({ ok: false, error: relayError });
    }
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
      // Only `logs` is read; a full receipt carries block data the test has no use for.
    } as unknown as TransactionReceipt);
    mocks.parseEventLogs.mockReturnValueOnce([{ args: { tokenId: 42n } }]);

    const result = await cl.getMintPositionEvent(hubTxHash);

    expect(result).toEqual({ ok: true, value: { tokenId: 42n } });
  });

  it('returns ok:false when no MintPosition log is present or it carries no tokenId, and wraps a throw as LOOKUP_FAILED', async () => {
    vi.spyOn(sodax.hubProvider.publicClient, 'waitForTransactionReceipt').mockResolvedValue({
      logs: [],
      // Only `logs` is read; a full receipt carries block data the test has no use for.
    } as unknown as TransactionReceipt);
    mocks.parseEventLogs.mockReturnValueOnce([]).mockReturnValueOnce([{ args: {} }]);

    expect(expectErr(await cl.getMintPositionEvent(hubTxHash)).message).toMatch(/No mint position event found/);
    expect(expectErr(await cl.getMintPositionEvent(hubTxHash)).message).toMatch(/No tokenId found/);

    const rpcError = new Error('RPC_DOWN');
    vi.spyOn(sodax.hubProvider.publicClient, 'waitForTransactionReceipt').mockRejectedValueOnce(rpcError);

    expect(expectErr(await cl.getMintPositionEvent(hubTxHash), 'LOOKUP_FAILED').cause).toBe(rpcError);
  });
});

describe('ClService.getPoolRewardConfig', () => {
  it('returns ok:false for a pool with no hook, and wraps a thrown read as LOOKUP_FAILED with .cause', async () => {
    const noHook = await cl.getPoolRewardConfig({ ...plainPoolKey, hooks: ZERO_ADDRESS }, createMockClient({}));

    expect(expectErr(noHook).message).toMatch(/Pool has no hook configured/);

    const client = createMockClient({
      poolRewardConfigs: () => {
        throw new Error('REVERT');
      },
    });

    const result = await cl.getPoolRewardConfig(plainPoolKey, client);

    expect(expectErr(result, 'LOOKUP_FAILED').cause).toEqual(new Error('REVERT'));
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

    const value = expectOk(result);
    expect(value.poolId).toBe('0xpoolid');
    expect(value.totalLiquidity).toBe(1_000_000n);
    expect(value.isActive).toBe(true);
    expect(value.rewardConfig).toEqual({
      rewardCurrency: '0xRewardToken',
      rewardRatePerSecond: 7n,
      lastActionTimestamp: 1_700_000_000n,
    });
    // Plain (non-StatA) currencies → enrichment short-circuits.
    expect(value.token0IsStatAToken).toBe(false);
    expect(value.token1IsStatAToken).toBe(false);
  });

  it('omits rewardConfig when the pool has no hook or the hook reports a zero reward rate', async () => {
    const noHook = await cl.getPoolData({ ...plainPoolKey, hooks: ZERO_ADDRESS }, makeHappyClient());

    expect(expectOk(noHook).rewardConfig).toBeUndefined();

    const zeroRate = await cl.getPoolData(
      plainPoolKey,
      makeHappyClient({ poolRewardConfigs: () => ['0xRewardToken', 0n, 0n] }),
    );

    expect(expectOk(zeroRate).rewardConfig).toBeUndefined();
  });

  it('wraps thrown errors as SodaxError(LOOKUP_FAILED, dex) with .cause', async () => {
    const client = createMockClient({
      getSlot0: () => {
        throw new Error('REVERT');
      },
    });

    const result = await cl.getPoolData(plainPoolKey, client);

    expect(expectErr(result, 'LOOKUP_FAILED').cause).toEqual(new Error('REVERT'));
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

  it('returns position info whether the current tick is inside, below or above the position range', async () => {
    const result = await cl.getPositionInfo(7n, buildClient(0, -1000, 1000));

    const value = expectOk(result, 'in range');
    expect(value.tickLower).toBe(-1000);
    expect(value.tickUpper).toBe(1000);
    expect(value.liquidity).toBe(1_000n);
    // Plain currencies → no underlying conversion.
    expect(value.amount0Underlying).toBeUndefined();
    expect(value.amount1Underlying).toBeUndefined();

    expectOk(await cl.getPositionInfo(7n, buildClient(-2000, -1000, 1000)), 'below range');
    expectOk(await cl.getPositionInfo(7n, buildClient(2000, -1000, 1000)), 'above range');
  });

  it('forwards a getPoolData failure, and wraps a thrown position read as LOOKUP_FAILED with .cause', async () => {
    const client = createMockClient({
      positions: () => ['0xencoded' as never, -1000, 1000, 1_000n, 0n, 0n, ZERO_ADDRESS],
      // getSlot0 reverts → getPoolData returns ok:false → getPositionInfo forwards as-is.
      getSlot0: () => {
        throw new Error('REVERT');
      },
    });

    expectErr(await cl.getPositionInfo(7n, client), 'LOOKUP_FAILED');

    const throwing = createMockClient({
      positions: () => {
        throw new Error('REVERT');
      },
    });

    const thrown = await cl.getPositionInfo(7n, throwing);

    expect(expectErr(thrown, 'LOOKUP_FAILED').cause).toEqual(new Error('REVERT'));
  });
});

// =========================================================================
// Static helpers — pure math, no fixtures or mocks needed.
// =========================================================================

describe('ClService.calculateLiquidityFromAmounts', () => {
  const tickLower = -1000n;
  const tickUpper = 1000n;
  const currentTick = 0n;

  it('returns 0 for no amounts, falls back to single-sided math for one, and is positive with both', () => {
    expect(ClService.calculateLiquidityFromAmounts(0n, 0n, tickLower, tickUpper, currentTick)).toBe(0n);
    // amount0 === 0 path inside the helper uses `maxLiquidityForAmount0Precise`.
    expect(
      ClService.calculateLiquidityFromAmounts(0n, 1_000_000n, tickLower, tickUpper, currentTick),
    ).toBeGreaterThanOrEqual(0n);
    expect(
      ClService.calculateLiquidityFromAmounts(1_000_000n, 0n, tickLower, tickUpper, currentTick),
    ).toBeGreaterThanOrEqual(0n);
    expect(
      ClService.calculateLiquidityFromAmounts(1_000_000n, 1_000_000n, tickLower, tickUpper, currentTick),
    ).toBeGreaterThan(0n);
  });
});

describe('ClService.calculateAmount1FromAmount0 / calculateAmount0FromAmount1', () => {
  const tickLower = -1000n;
  const tickUpper = 1000n;
  const currentTick = 0n;
  const sqrtPriceX96 = sqrtPriceAtTick(0);

  it('returns 0 for a zero input amount and a positive counterpart for a positive one in range, both ways', () => {
    expect(ClService.calculateAmount1FromAmount0(0n, tickLower, tickUpper, currentTick, sqrtPriceX96)).toBe(0n);
    expect(
      ClService.calculateAmount1FromAmount0(1_000_000n, tickLower, tickUpper, currentTick, sqrtPriceX96),
    ).toBeGreaterThan(0n);

    expect(ClService.calculateAmount0FromAmount1(0n, tickLower, tickUpper, currentTick, sqrtPriceX96)).toBe(0n);
    expect(
      ClService.calculateAmount0FromAmount1(1_000_000n, tickLower, tickUpper, currentTick, sqrtPriceX96),
    ).toBeGreaterThan(0n);
  });
});

describe('ClService.priceToTick', () => {
  // Fake tokens for the Price object — addresses don't matter, only `decimals`.
  const token0 = new Token(146, '0x0000000000000000000000000000000000000001', 18, 'T0', 'Token0');
  const token1 = new Token(146, '0x0000000000000000000000000000000000000002', 18, 'T1', 'Token1');

  it('returns 0 at parity, a negative tick below 1 and a positive tick above 1, rounded to tickSpacing', () => {
    expect(ClService.priceToTick(1, token0, token1, 1)).toBe(0n);
    expect(ClService.priceToTick(0.5, token0, token1, 1)).toBeLessThan(0n);
    expect(ClService.priceToTick(2, token0, token1, 1)).toBeGreaterThan(0n);

    // The result rounds to a multiple of tickSpacing.
    const tick = ClService.priceToTick(1.5, token0, token1, 60);
    expect(Number(tick) % 60).toBe(0);
  });
});

// =========================================================================
// Static: calculateMaxAmountsForSlippage
// =========================================================================

describe('ClService.calculateMaxAmountsForSlippage', () => {
  const tickLower = -1000n;
  const tickUpper = 1000n;
  const currentTick = 0n;
  const sqrtPriceX96 = sqrtPriceAtTick(0);
  const liquidity = 10n ** 18n;
  const maxAmounts = (slippage: number) =>
    ClService.calculateMaxAmountsForSlippage(liquidity, tickLower, tickUpper, currentTick, sqrtPriceX96, slippage);

  it('returns the current amounts at zero slippage, never less for a positive one, and grows strictly with the percent', () => {
    const current0 = PositionMath.getToken0Amount(0, -1000, 1000, sqrtPriceX96, liquidity);
    const current1 = PositionMath.getToken1Amount(0, -1000, 1000, sqrtPriceX96, liquidity);

    const exact = maxAmounts(0);
    expect(exact.amount0Max).toBe(current0);
    expect(exact.amount1Max).toBe(current1);

    for (const slippage of [1, 0.1]) {
      const result = maxAmounts(slippage);
      expect(result.amount0Max, `${slippage}%`).toBeGreaterThanOrEqual(current0);
      expect(result.amount1Max, `${slippage}%`).toBeGreaterThanOrEqual(current1);
    }

    // slippagePercent is read as a percent, so 10 must exceed 1 for an in-range position.
    const onePercent = maxAmounts(1);
    const tenPercent = maxAmounts(10);

    expect(tenPercent.amount0Max).toBeGreaterThan(onePercent.amount0Max);
    expect(tenPercent.amount1Max).toBeGreaterThan(onePercent.amount1Max);
  });

  it('puts the whole position in one token at a range boundary or outside the range', () => {
    // At the lower boundary the position is entirely token0; at the upper, entirely token1.
    const atLower = sqrtPriceAtTick(Number(tickLower));
    expect(PositionMath.getToken1Amount(Number(tickLower), -1000, 1000, atLower, liquidity)).toBe(0n);
    expect(
      ClService.calculateMaxAmountsForSlippage(liquidity, tickLower, tickUpper, tickLower, atLower, 1).amount0Max,
    ).toBeGreaterThan(0n);

    const atUpper = sqrtPriceAtTick(Number(tickUpper));
    expect(PositionMath.getToken0Amount(Number(tickUpper), -1000, 1000, atUpper, liquidity)).toBe(0n);
    expect(
      ClService.calculateMaxAmountsForSlippage(liquidity, tickLower, tickUpper, tickUpper, atUpper, 1).amount1Max,
    ).toBeGreaterThan(0n);

    const below = ClService.calculateMaxAmountsForSlippage(
      liquidity,
      tickLower,
      tickUpper,
      -2000n,
      sqrtPriceAtTick(-2000),
      1,
    );
    expect(below.amount0Max).toBeGreaterThan(0n);
    expect(below.amount1Max).toBe(0n);

    const above = ClService.calculateMaxAmountsForSlippage(
      liquidity,
      tickLower,
      tickUpper,
      2000n,
      sqrtPriceAtTick(2000),
      1,
    );
    expect(above.amount0Max).toBe(0n);
    expect(above.amount1Max).toBeGreaterThan(0n);
  });

  it('handles narrow and wide ranges, large liquidity and sqrtPriceX96 beyond JS Number precision', () => {
    // sqrtPriceX96 at a high tick is far beyond Number.MAX_SAFE_INTEGER (~2^53).
    const highTick = 200000n;
    const largeSqrtPrice = sqrtPriceAtTick(Number(highTick));
    expect(largeSqrtPrice).toBeGreaterThan(BigInt(Number.MAX_SAFE_INTEGER));

    const cases = [
      ClService.calculateMaxAmountsForSlippage(liquidity, -10n, 10n, currentTick, sqrtPriceX96, 1),
      ClService.calculateMaxAmountsForSlippage(liquidity, -100000n, 100000n, currentTick, sqrtPriceX96, 0.5),
      ClService.calculateMaxAmountsForSlippage(10n ** 24n, tickLower, tickUpper, currentTick, sqrtPriceX96, 0.5),
      ClService.calculateMaxAmountsForSlippage(
        liquidity,
        highTick - 100n,
        highTick + 100n,
        highTick,
        largeSqrtPrice,
        0.5,
      ),
    ];
    for (const result of cases) {
      expect(result.amount0Max).toBeGreaterThan(0n);
      expect(result.amount1Max).toBeGreaterThan(0n);
    }
  });
});
