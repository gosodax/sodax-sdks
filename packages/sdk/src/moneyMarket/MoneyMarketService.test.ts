/**
 * Tests for the strongly-typed MoneyMarketService public API.
 *
 * Mirrors the shape of SwapService.test.ts:
 *
 *   1. `srcChainKey: K extends SpokeChainKey` is the generic anchor on every params object —
 *      it narrows the associated `walletProvider` via `GetWalletProviderType<K>`.
 *   2. `walletProvider` is required on exec methods (`supply`, `borrow`, `withdraw`, `repay`,
 *      `create*Intent`, `approve`). Use `{ raw: true }` for raw transaction payloads (no walletProvider); `{ raw: false, walletProvider }` for exec.
 *   3. Every test runs against a single module-scope `new Sodax()`. The statically imported
 *      `relayTxAndWaitPacket` is spied on its module namespace; instance methods on the real
 *      `sodax.hubProvider`, `sodax.spoke`, and `sodax.config` are stubbed per-test with `vi.spyOn`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ChainKeys,
  IndeterminateOutcomeError,
  spokeChainConfig,
  type Address,
  type IBitcoinWalletProvider,
  type IEvmWalletProvider,
  type Result,
  type SpokeChainKey,
  tronSupportedTokens,
  type XToken,
} from '@sodax/types';
import { Sodax } from '../shared/entities/Sodax.js';
import { SodaxError } from '../errors/SodaxError.js';
import { decodeFunctionData } from 'viem';
import { poolAbi } from '../shared/abis/pool.abi.js';
import { EvmVaultTokenService } from '../shared/services/hub/EvmVaultTokenService.js';
import * as IntentRelayApiService from '../shared/services/intentRelay/IntentRelayApiService.js';
import { expectErr, expectOk } from '../test-utils/result.js';
import {
  mockBitcoinWalletProvider,
  mockEvmWalletProvider,
  mockSolanaWalletProvider,
  mockStellarWalletProvider,
} from '../test-utils/walletProviders.js';

// Standalone stubs bound in `beforeEach` via `vi.spyOn`, so tests can queue `.mockResolvedValueOnce(...)`.
const mocks = {
  getUserHubWalletAddress: vi.fn(),
  getUserRouter: vi.fn(),
  relayTxAndWaitPacket: vi.fn(),
};

import {
  MoneyMarketService,
  type MoneyMarketBorrowParams,
  type MoneyMarketRepayParams,
  type MoneyMarketSupplyParams,
  type MoneyMarketWithdrawParams,
} from './MoneyMarketService.js';
import { TRON_TEST_ADDRESS } from '../shared/services/spoke/tron-test-fixtures.js';
import type { ReserveDataLegacy } from './MoneyMarketTypes.js';

// --- test fixtures --------------------------------------------------------
//
// One real Sodax instance backs every test in the file. `new Sodax()` wires up the full
// dependency graph — we never stub the wiring, only the leaves via vi.spyOn per test.

const sodax = new Sodax();

// Hub-chain wallet address returned by hubProvider.getUserHubWalletAddress in most happy-path tests.
const HUB_WALLET = '0x1111111111111111111111111111111111111111' as Address;
const TO_HUB_WALLET = '0x2222222222222222222222222222222222222222' as Address;
const USER_ROUTER = '0x3333333333333333333333333333333333333333' as Address;

// Sample valid EVM token address (cast from a real BSC ETHB-style address).
const SAMPLE_EVM_TOKEN = '0x2170Ed0880ac9A755fd29B2688956BD959F933F8' as Address;
const SAMPLE_USER_ADDRESS = '0x4444444444444444444444444444444444444444' as Address;
const SAMPLE_DST_ADDRESS = '0x5555555555555555555555555555555555555555' as Address;
const SAMPLE_BORROW_VAULT = '0x6666666666666666666666666666666666666666' as Address;

// Aave v3 ReserveConfiguration flag bits.
const RESERVE_ACTIVE = 1n << 56n;
const RESERVE_BORROWING_ENABLED = 1n << 58n;
const RESERVE_PAUSED = 1n << 60n;
const BORROWABLE_RESERVE = RESERVE_ACTIVE | RESERVE_BORROWING_ENABLED;

const reserveData = (configuration: bigint): ReserveDataLegacy => ({
  configuration,
  liquidityIndex: 0n,
  currentLiquidityRate: 0n,
  variableBorrowIndex: 0n,
  currentVariableBorrowRate: 0n,
  currentStableBorrowRate: 0n,
  lastUpdateTimestamp: 0,
  id: 0,
  aTokenAddress: SAMPLE_DST_ADDRESS,
  stableDebtTokenAddress: SAMPLE_DST_ADDRESS,
  variableDebtTokenAddress: SAMPLE_DST_ADDRESS,
  interestRateStrategyAddress: SAMPLE_DST_ADDRESS,
  accruedToTreasury: 0n,
  unbacked: 0n,
  isolationModeTotalDebt: 0n,
});

const BORROW_DST_TOKEN = {
  symbol: 'TKN',
  name: 'Token',
  decimals: 18,
  address: '0xaaaa000000000000000000000000000000000000',
  chainKey: ChainKeys.BSC_MAINNET,
  hubAsset: SAMPLE_BORROW_VAULT,
  vault: SAMPLE_BORROW_VAULT,
} satisfies XToken;

// Borrow's invariants need a known dst token whose reserve the pool can lend.
const stubBorrowableDstToken = (): void => {
  vi.spyOn(sodax.config, 'getMoneyMarketToken').mockReturnValue(BORROW_DST_TOKEN);
  vi.spyOn(sodax.moneyMarket.data, 'getReserveData').mockResolvedValue(reserveData(BORROWABLE_RESERVE));
};

// MPC-relay accounts and the recipient each becomes on the hub. `encodeRecipient` left-pads a non-EVM
// (XRPL) identity to the 32-byte word its release expects, and leaves an EVM (Monad) recipient a plain address.
const XRPL_RECIPIENT = {
  chainKey: ChainKeys.XRP_MAINNET,
  address: 'rBTwLga3i2gz3doX6Gva3MgEV8ZCD8jjah',
  word: `0x${'00'.repeat(12)}72a3de6b0973062d5f2fe77383ef02f0c17901ab` as Address,
} as const;
const MONAD_RECIPIENT = {
  chainKey: ChainKeys.MONAD_MAINNET,
  address: '0x6be3a4afbd5983604385bcba71aaa3645918e2e2',
  word: '0x6be3a4afbd5983604385bcba71aaa3645918e2e2' as Address,
} as const;

const mockEvmProvider = mockEvmWalletProvider();
const mockSolanaProvider = mockSolanaWalletProvider();
const mockStellarProvider = mockStellarWalletProvider();
const mockBitcoinProvider = mockBitcoinWalletProvider();

// Per-action params factories. Keeping K generic lets test call sites pass a literal ChainKey
// and have it inferred all the way to walletProvider narrowing.
const supplyParams = <K extends SpokeChainKey>(srcChainKey: K): MoneyMarketSupplyParams<K> => ({
  srcChainKey,
  srcAddress: SAMPLE_USER_ADDRESS,
  token: SAMPLE_EVM_TOKEN,
  amount: 1_000_000n,
  action: 'supply',
});

const borrowParams = <K extends SpokeChainKey>(srcChainKey: K): MoneyMarketBorrowParams<K> => ({
  srcChainKey,
  srcAddress: SAMPLE_USER_ADDRESS,
  token: SAMPLE_EVM_TOKEN,
  amount: 1_000_000n,
  action: 'borrow',
});

const withdrawParams = <K extends SpokeChainKey>(srcChainKey: K): MoneyMarketWithdrawParams<K> => ({
  srcChainKey,
  srcAddress: SAMPLE_USER_ADDRESS,
  token: SAMPLE_EVM_TOKEN,
  amount: 1_000_000n,
  action: 'withdraw',
});

const repayParams = <K extends SpokeChainKey>(srcChainKey: K): MoneyMarketRepayParams<K> => ({
  srcChainKey,
  srcAddress: SAMPLE_USER_ADDRESS,
  token: SAMPLE_EVM_TOKEN,
  amount: 1_000_000n,
  action: 'repay',
});

beforeEach(() => {
  // Default: `isMoneyMarketSupportedToken` returns true so happy-path tests don't have to
  // re-stub it. Tests that exercise the unsupported-token invariant override it explicitly.
  vi.spyOn(sodax.config, 'isMoneyMarketSupportedToken').mockReturnValue(true);
  // Default hub-wallet responses — exec/raw create*Intent paths call this for src + dst wallets
  // via Promise.all, so we configure the mock to always resolve. Per-test calls override.
  mocks.getUserHubWalletAddress.mockResolvedValue(HUB_WALLET);
  mocks.getUserRouter.mockResolvedValue(USER_ROUTER);
  // Bind the hoisted vi.fn stubs to the live EvmHubProvider instance so `.mockResolvedValueOnce`
  // / `.mockReset` calls in tests keep working unchanged. Spying replaces the method (and its
  // internal hubAddressMap cache) so each test sees the configured response.
  vi.spyOn(sodax.hubProvider, 'getUserHubWalletAddress').mockImplementation(mocks.getUserHubWalletAddress);
  vi.spyOn(sodax.hubProvider, 'getUserRouter').mockImplementation(mocks.getUserRouter);
  vi.spyOn(IntentRelayApiService, 'relayTxAndWaitPacket').mockImplementation(mocks.relayTxAndWaitPacket);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

// Shared invalid-input table for the create*Intent invariants (action / token / amount / walletProvider).
// Each row overrides the base params (and optionally the provider) and names the invariant message it must hit.
type InvalidInput = {
  label: string;
  params: { action?: never; token?: string; amount?: bigint };
  walletProvider?: IEvmWalletProvider;
  message: RegExp;
};
const INVALID_INPUTS: InvalidInput[] = [
  { label: 'wrong action', params: { action: 'other' as never }, message: /Invalid action/ },
  { label: 'empty token', params: { token: '' }, message: /Token is required/ },
  { label: 'zero amount', params: { amount: 0n }, message: /Amount must be greater than 0/ },
  {
    label: 'mismatched walletProvider',
    params: {},
    // Defeat the compile-time narrowing to reach the runtime invariant.
    walletProvider: mockSolanaProvider as unknown as IEvmWalletProvider,
    message: /Invalid wallet provider/,
  },
];

// Asserts a failed Result whose message matches `message`, labelled for table-driven refusals.
const expectRefusal = (result: Result<unknown, unknown>, message: RegExp, label: string): void => {
  expect(expectErr(result, undefined, undefined, label).message, label).toMatch(message);
};

// =========================================================================
// estimateGas — thin wrapper around SpokeService.estimateGas.
// =========================================================================

describe('MoneyMarketService.estimateGas', () => {
  it('wraps a failure Result as MM_GAS_ESTIMATION_FAILED with cause', async () => {
    const inner = new Error('GAS_FAILED');
    vi.spyOn(sodax.spoke, 'estimateGas').mockResolvedValueOnce({ ok: false, error: inner });

    const result = await sodax.moneyMarket.estimateGas({ chainKey: ChainKeys.BSC_MAINNET } as never);

    const error = expectErr(result, 'GAS_ESTIMATION_FAILED', { phase: 'gasEstimation' });
    expect(error.cause).toBe(inner);
  });
});

// =========================================================================
// Static encoders — pure functions over poolAbi.
// =========================================================================

describe('MoneyMarketService static encoders', () => {
  const lendingPool = '0x6666666666666666666666666666666666666666' as Address;
  const asset = '0x7777777777777777777777777777777777777777' as Address;
  const onBehalfOf = '0x8888888888888888888888888888888888888888' as Address;
  const to = '0x9999999999999999999999999999999999999999' as Address;

  it('each pool encoder targets the lendingPool and encodes its selector with forwarded args', () => {
    const cases = [
      {
        call: MoneyMarketService.encodeSupply({ asset, amount: 100n, onBehalfOf, referralCode: 7 }, lendingPool),
        functionName: 'supply',
        args: [asset, 100n, onBehalfOf, 7],
      },
      {
        call: MoneyMarketService.encodeWithdraw({ asset, amount: 1n, to }, lendingPool),
        functionName: 'withdraw',
        args: [asset, 1n, to],
      },
      {
        call: MoneyMarketService.encodeBorrow(
          { asset, amount: 2n, interestRateMode: 2n, referralCode: 0, onBehalfOf },
          lendingPool,
        ),
        functionName: 'borrow',
        args: [asset, 2n, 2n, 0, onBehalfOf],
      },
      {
        call: MoneyMarketService.encodeRepay({ asset, amount: 3n, interestRateMode: 2n, onBehalfOf }, lendingPool),
        functionName: 'repay',
        args: [asset, 3n, 2n, onBehalfOf],
      },
      {
        call: MoneyMarketService.encodeRepayWithATokens({ asset, amount: 4n, interestRateMode: 2n }, lendingPool),
        functionName: 'repayWithATokens',
        args: [asset, 4n, 2n],
      },
      {
        call: MoneyMarketService.encodeSetUserUseReserveAsCollateral(asset, true, lendingPool),
        functionName: 'setUserUseReserveAsCollateral',
        args: [asset, true],
      },
    ] as const;

    for (const { call, functionName, args } of cases) {
      expect(call.address).toBe(lendingPool);
      expect(call.value).toBe(0n);
      const decoded = decodeFunctionData({ abi: poolAbi, data: call.data });
      expect(decoded.functionName).toBe(functionName);
      expect(decoded.args).toEqual(args);
    }
    const selectors = new Set(cases.map(c => c.call.data.slice(0, 10)));
    expect(selectors.size).toBe(cases.length);
  });

  it('calculateATokenAmount applies the RAY-precision formula', () => {
    // Formula: (amount * 1e27) / normalizedIncome + 1
    const amount = 1_000_000n;
    const normalizedIncome = 10n ** 27n; // 1.0 in RAY → result is amount + 1
    expect(MoneyMarketService.calculateATokenAmount(amount, normalizedIncome)).toBe(amount + 1n);

    const halfRay = 5n * 10n ** 26n; // 0.5 in RAY → result is 2x amount + 1
    expect(MoneyMarketService.calculateATokenAmount(amount, halfRay)).toBe(2n * amount + 1n);
  });
});

// =========================================================================
// isAllowanceValid — branchy. Hub / EVM-spoke / Stellar (src and dst) /
// Solana short-circuit / withdraw + borrow short-circuit.
// =========================================================================

describe('MoneyMarketService.isAllowanceValid', () => {
  describe('happy paths', () => {
    it('on hub (Sonic) supply: looks up the user router and delegates to spoke.isAllowanceValid', async () => {
      mocks.getUserRouter.mockResolvedValueOnce(USER_ROUTER);
      const spy = vi.spyOn(sodax.spoke, 'isAllowanceValid').mockResolvedValueOnce({ ok: true, value: true });

      const result = await sodax.moneyMarket.isAllowanceValid({
        params: supplyParams(ChainKeys.SONIC_MAINNET),
      });

      expect(result).toEqual({ ok: true, value: true });
      expect(mocks.getUserRouter).toHaveBeenCalledWith(SAMPLE_USER_ADDRESS);
      expect(spy).toHaveBeenCalledWith(
        expect.objectContaining({
          srcChainKey: ChainKeys.SONIC_MAINNET,
          owner: SAMPLE_USER_ADDRESS,
          spender: USER_ROUTER,
          token: SAMPLE_EVM_TOKEN,
          amount: 1_000_000n,
        }),
      );
    });

    it('on EVM spoke (BSC) supply and repay: delegates with the spoke assetManager as spender', async () => {
      const spy = vi.spyOn(sodax.spoke, 'isAllowanceValid').mockResolvedValue({ ok: true, value: true });

      const result = await sodax.moneyMarket.isAllowanceValid({ params: supplyParams(ChainKeys.BSC_MAINNET) });
      await sodax.moneyMarket.isAllowanceValid({ params: repayParams(ChainKeys.BSC_MAINNET) });

      expect(result).toEqual({ ok: true, value: true });
      expect(spy).toHaveBeenCalledTimes(2);
      for (const [call] of spy.mock.calls) {
        expect(call).toMatchObject({
          srcChainKey: ChainKeys.BSC_MAINNET,
          spender: spokeChainConfig[ChainKeys.BSC_MAINNET].addresses.assetManager,
        });
      }
    });

    it('withdraw and borrow: short-circuit to true with no spoke call AND validate the token on dstChainKey', async () => {
      const spy = vi.spyOn(sodax.spoke, 'isAllowanceValid');
      const supportedTokenSpy = vi.spyOn(sodax.config, 'isMoneyMarketSupportedToken');

      for (const params of [withdrawParams(ChainKeys.BSC_MAINNET), borrowParams(ChainKeys.BSC_MAINNET)]) {
        supportedTokenSpy.mockClear();
        // A distinct dstChainKey: if the action discriminant flips, the else branch validates on src (BSC) instead.
        const result = await sodax.moneyMarket.isAllowanceValid({
          params: { ...params, dstChainKey: ChainKeys.SONIC_MAINNET },
        });

        expect(result).toEqual({ ok: true, value: true });
        expect(supportedTokenSpy).toHaveBeenCalledWith(ChainKeys.SONIC_MAINNET, SAMPLE_EVM_TOKEN);
      }
      expect(spy).not.toHaveBeenCalled();
    });

    it('Solana supply: short-circuits to true (no allowance concept) without calling spoke', async () => {
      const spy = vi.spyOn(sodax.spoke, 'isAllowanceValid');

      const result = await sodax.moneyMarket.isAllowanceValid({
        params: supplyParams(ChainKeys.SOLANA_MAINNET),
      });

      expect(result).toEqual({ ok: true, value: true });
      expect(spy).not.toHaveBeenCalled();
    });

    it('Stellar src: delegates Stellar trustline check with srcAddress as owner', async () => {
      const spy = vi.spyOn(sodax.spoke, 'isAllowanceValid').mockResolvedValueOnce({ ok: true, value: true });

      const result = await sodax.moneyMarket.isAllowanceValid({
        params: supplyParams(ChainKeys.STELLAR_MAINNET),
      });

      expect(result).toEqual({ ok: true, value: true });
      expect(spy).toHaveBeenCalledWith(
        expect.objectContaining({
          srcChainKey: ChainKeys.STELLAR_MAINNET,
          owner: SAMPLE_USER_ADDRESS,
        }),
      );
    });

    it('Stellar dst (non-Stellar src): checks recipient trustline only', async () => {
      const spy = vi.spyOn(sodax.spoke, 'isAllowanceValid').mockResolvedValueOnce({ ok: true, value: true });

      const result = await sodax.moneyMarket.isAllowanceValid({
        params: {
          ...supplyParams(ChainKeys.BSC_MAINNET),
          dstChainKey: ChainKeys.STELLAR_MAINNET,
          dstAddress: SAMPLE_DST_ADDRESS,
        },
      });

      expect(result).toEqual({ ok: true, value: true });
      expect(spy).toHaveBeenCalledTimes(1);
      expect(spy).toHaveBeenCalledWith(
        expect.objectContaining({
          srcChainKey: ChainKeys.STELLAR_MAINNET,
          owner: SAMPLE_DST_ADDRESS,
        }),
      );
    });

    it('Stellar src + Stellar dst: ANDs both trustline checks', async () => {
      const spy = vi
        .spyOn(sodax.spoke, 'isAllowanceValid')
        .mockResolvedValueOnce({ ok: true, value: true })
        .mockResolvedValueOnce({ ok: true, value: true })
        .mockResolvedValueOnce({ ok: true, value: true })
        .mockResolvedValueOnce({ ok: true, value: false });
      const params = {
        ...supplyParams(ChainKeys.STELLAR_MAINNET),
        dstChainKey: ChainKeys.STELLAR_MAINNET,
        dstAddress: SAMPLE_DST_ADDRESS,
      };

      expect(await sodax.moneyMarket.isAllowanceValid({ params })).toEqual({ ok: true, value: true });
      expect(spy).toHaveBeenCalledTimes(2);
      // One insufficient trustline makes the whole check false.
      expect(await sodax.moneyMarket.isAllowanceValid({ params })).toEqual({ ok: true, value: false });
    });
  });

  it('refuses a zero amount, an empty token, or a token unsupported on the validated chain', async () => {
    const zero = await sodax.moneyMarket.isAllowanceValid({
      params: { ...supplyParams(ChainKeys.BSC_MAINNET), amount: 0n },
    });
    const noToken = await sodax.moneyMarket.isAllowanceValid({
      params: { ...supplyParams(ChainKeys.BSC_MAINNET), token: '' },
    });
    // Supply validates on srcChain; withdraw validates on dstChainKey (default = srcChain).
    vi.spyOn(sodax.config, 'isMoneyMarketSupportedToken').mockReturnValue(false);
    const supply = await sodax.moneyMarket.isAllowanceValid({ params: supplyParams(ChainKeys.BSC_MAINNET) });
    const withdraw = await sodax.moneyMarket.isAllowanceValid({ params: withdrawParams(ChainKeys.BSC_MAINNET) });

    expectRefusal(zero, /Amount must be greater than 0/, 'zero amount');
    expectRefusal(noToken, /Token is required/, 'empty token');
    expectRefusal(supply, /Unsupported spoke chain/, 'unsupported on src (supply)');
    expectRefusal(withdraw, /Unsupported spoke chain/, 'unsupported on dst (withdraw)');
  });

  it('returns ok:false when the router lookup rejects, the spoke check throws, or a trustline lookup fails', async () => {
    const routerError = new Error('ROUTER_LOOKUP_FAILED');
    const rpcError = new Error('RPC_DOWN');
    const trustlineError = new Error('TRUSTLINE_FAILED');
    mocks.getUserRouter.mockRejectedValueOnce(routerError);
    vi.spyOn(sodax.spoke, 'isAllowanceValid')
      .mockRejectedValueOnce(rpcError)
      .mockResolvedValueOnce({ ok: true, value: true })
      .mockResolvedValueOnce({ ok: false, error: trustlineError });

    const hub = await sodax.moneyMarket.isAllowanceValid({ params: supplyParams(ChainKeys.SONIC_MAINNET) });
    const spoke = await sodax.moneyMarket.isAllowanceValid({ params: supplyParams(ChainKeys.BSC_MAINNET) });
    // Stellar src + dst: the second trustline lookup's failure Result is forwarded.
    const stellar = await sodax.moneyMarket.isAllowanceValid({
      params: {
        ...supplyParams(ChainKeys.STELLAR_MAINNET),
        dstChainKey: ChainKeys.STELLAR_MAINNET,
        dstAddress: SAMPLE_DST_ADDRESS,
      },
    });

    expect(hub).toMatchObject({ ok: false, error: expect.objectContaining({ message: routerError.message }) });
    expect(spoke).toMatchObject({ ok: false, error: expect.objectContaining({ message: rpcError.message }) });
    expect(stellar).toMatchObject({ ok: false, error: expect.objectContaining({ message: trustlineError.message }) });
  });
});

// =========================================================================
// approve — three chain branches (hub, EVM spoke, Stellar) plus invariant
// rejections and error propagation. Raw and exec share every path except Stellar's.
// =========================================================================

describe('MoneyMarketService.approve', () => {
  const rawTx = { from: SAMPLE_USER_ADDRESS, to: SAMPLE_EVM_TOKEN, data: '0x', value: 0n };

  it('on hub (Sonic) supply: resolves the user router and delegates to spoke.approve, raw or exec', async () => {
    const spy = vi
      .spyOn(sodax.spoke, 'approve')
      .mockResolvedValueOnce({ ok: true, value: '0xapprove-hash' })
      .mockResolvedValueOnce({ ok: true, value: rawTx });

    const result = await sodax.moneyMarket.approve({
      raw: false,
      params: supplyParams(ChainKeys.SONIC_MAINNET),
      walletProvider: mockEvmProvider,
    });
    const rawResult = await sodax.moneyMarket.approve({ raw: true, params: supplyParams(ChainKeys.SONIC_MAINNET) });

    expect(result).toEqual({ ok: true, value: '0xapprove-hash' });
    expect(spy).toHaveBeenCalledWith(
      expect.objectContaining({
        srcChainKey: ChainKeys.SONIC_MAINNET,
        spender: USER_ROUTER,
        raw: false,
        walletProvider: mockEvmProvider,
      }),
    );
    expect(rawResult).toEqual({ ok: true, value: rawTx });
    expect(spy.mock.calls[1]?.[0].raw).toBe(true);
  });

  it('on EVM spoke supply: delegates with the spoke assetManager as spender, raw or exec', async () => {
    const spy = vi
      .spyOn(sodax.spoke, 'approve')
      .mockResolvedValueOnce({ ok: true, value: '0xapprove-hash' })
      .mockResolvedValueOnce({ ok: true, value: rawTx });

    const result = await sodax.moneyMarket.approve({
      raw: false,
      params: supplyParams(ChainKeys.BSC_MAINNET),
      walletProvider: mockEvmProvider,
    });
    const rawResult = await sodax.moneyMarket.approve({ raw: true, params: supplyParams(ChainKeys.BSC_MAINNET) });

    expectOk(result, 'exec');
    expectOk(rawResult, 'raw');
    expect(spy).toHaveBeenCalledWith(
      expect.objectContaining({
        srcChainKey: ChainKeys.BSC_MAINNET,
        spender: spokeChainConfig[ChainKeys.BSC_MAINNET].addresses.assetManager,
        raw: false,
      }),
    );
  });

  it('on Stellar: delegates a trustline approval for any action, raw or exec', async () => {
    const spy = vi
      .spyOn(sodax.spoke, 'approve')
      .mockResolvedValueOnce({ ok: true, value: '0xtrustline' })
      .mockResolvedValueOnce({ ok: true, value: '0xtrustline-raw' });

    // Stellar's branch sits before the action invariant: a trustline enables incoming and outgoing transfers.
    await sodax.moneyMarket.approve({
      raw: false,
      params: withdrawParams(ChainKeys.STELLAR_MAINNET),
      walletProvider: mockStellarProvider,
    });
    const rawResult = await sodax.moneyMarket.approve({ raw: true, params: withdrawParams(ChainKeys.STELLAR_MAINNET) });

    expect(spy).toHaveBeenCalledTimes(2);
    expect(spy.mock.calls[0]?.[0]?.srcChainKey).toBe(ChainKeys.STELLAR_MAINNET);
    expectOk(rawResult);
  });

  it('refuses invalid amount, token, walletProvider, action or chain type', async () => {
    const cases: [
      string,
      MoneyMarketSupplyParams<typeof ChainKeys.SONIC_MAINNET | typeof ChainKeys.BSC_MAINNET>,
      RegExp,
    ][] = [
      ['zero amount', { ...supplyParams(ChainKeys.BSC_MAINNET), amount: 0n }, /Amount must be greater than 0/],
      ['empty token', { ...supplyParams(ChainKeys.BSC_MAINNET), token: '' }, /Token is required/],
      [
        'non-address token on the hub path',
        { ...supplyParams(ChainKeys.SONIC_MAINNET), token: 'not-an-address' },
        /Invalid token address/,
      ],
    ];
    for (const [label, params, message] of cases) {
      const result = await sodax.moneyMarket.approve({ raw: false, params, walletProvider: mockEvmProvider });
      expectRefusal(result, message, label);
    }

    const wrongProvider = await sodax.moneyMarket.approve({
      raw: false,
      params: supplyParams(ChainKeys.BSC_MAINNET),
      // Defeat the compile-time narrowing to reach the runtime invariant.
      walletProvider: mockSolanaProvider as unknown as IEvmWalletProvider,
    });
    expectRefusal(wrongProvider, /Invalid wallet provider for chain key/, 'walletProvider chainType mismatch');
    // Only supply / repay require approval on EVM.
    const evmWithdraw = await sodax.moneyMarket.approve({
      raw: false,
      params: withdrawParams(ChainKeys.BSC_MAINNET),
      walletProvider: mockEvmProvider,
    });
    expectRefusal(evmWithdraw, /Invalid action/, 'withdraw on EVM');
    const solana = await sodax.moneyMarket.approve({
      raw: false,
      params: supplyParams(ChainKeys.SOLANA_MAINNET),
      walletProvider: mockSolanaProvider,
    });
    expectRefusal(solana, /Approve only supported/, 'unsupported chain type (Solana)');
  });

  it('returns ok:false when the router lookup rejects, or spoke.approve throws or fails', async () => {
    const routerError = new Error('ROUTER_LOOKUP_FAILED');
    const thrown = new Error('APPROVE_THREW');
    const approveError = new Error('APPROVE_REJECTED');
    mocks.getUserRouter.mockRejectedValueOnce(routerError);
    vi.spyOn(sodax.spoke, 'approve')
      .mockRejectedValueOnce(thrown)
      .mockResolvedValue({ ok: false, error: approveError });
    const exec = (srcChainKey: typeof ChainKeys.SONIC_MAINNET | typeof ChainKeys.BSC_MAINNET) =>
      sodax.moneyMarket.approve({ raw: false, params: supplyParams(srcChainKey), walletProvider: mockEvmProvider });

    expect(await exec(ChainKeys.SONIC_MAINNET)).toMatchObject({
      ok: false,
      error: expect.objectContaining({ message: routerError.message }),
    });
    expect(await exec(ChainKeys.BSC_MAINNET)).toMatchObject({
      ok: false,
      error: expect.objectContaining({ message: thrown.message }),
    });
    // A failure Result from spoke.approve is forwarded on the hub (raw) and EVM-spoke paths.
    const hub = await sodax.moneyMarket.approve({ raw: true, params: supplyParams(ChainKeys.SONIC_MAINNET) });
    for (const result of [hub, await exec(ChainKeys.BSC_MAINNET)]) {
      expect(result).toMatchObject({ ok: false, error: expect.objectContaining({ message: approveError.message }) });
    }
  });
});

// =========================================================================
// supply / createSupplyIntent
// =========================================================================
//
// `createSupplyIntent` is the workhorse — it builds the transaction data and calls
// SpokeService.deposit. To keep tests isolated from the `buildSupplyData` internals
// (which depend on real config wiring), we stub `buildSupplyData` directly per-test.
// `supply` wraps `createSupplyIntent` then verifies the tx hash and (off-hub) relays
// the packet.

const hubIntent = { ok: true, value: { tx: '0xhub-tx', relayData: { address: HUB_WALLET, payload: '0x' } } } as const;
const spokeIntent = {
  ok: true,
  value: { tx: '0xspoke-tx', relayData: { address: HUB_WALLET, payload: '0x' } },
} as const;

describe('MoneyMarketService.createSupplyIntent', () => {
  describe('happy paths', () => {
    it('on hub (Sonic): builds data, deposits, returns tx hash + extra data', async () => {
      vi.spyOn(sodax.moneyMarket, 'buildSupplyData').mockReturnValueOnce('0xsupply-data');
      const depositSpy = vi.spyOn(sodax.spoke, 'deposit').mockResolvedValueOnce({ ok: true, value: '0xdeposit-hash' });

      const result = await sodax.moneyMarket.createSupplyIntent({
        raw: false,
        params: supplyParams(ChainKeys.SONIC_MAINNET),
        walletProvider: mockEvmProvider,
      });

      const { tx, relayData } = expectOk(result);
      expect(tx).toBe('0xdeposit-hash');
      expect(relayData).toEqual({ address: HUB_WALLET, payload: '0xsupply-data' });
      const call = depositSpy.mock.calls[0]?.[0];
      expect(call?.srcChainKey).toBe(ChainKeys.SONIC_MAINNET);
      expect(call?.raw).toBe(false);
      expect(call?.walletProvider).toBe(mockEvmProvider);
      expect(call?.to).toBe(HUB_WALLET);
      expect(call?.data).toBe('0xsupply-data');
      expect(call?.amount).toBe(1_000_000n);
    });

    it('on EVM spoke (raw: true): returns the raw transaction without walletProvider', async () => {
      vi.spyOn(sodax.moneyMarket, 'buildSupplyData').mockReturnValueOnce('0xsupply-data');
      const rawTx = { from: SAMPLE_USER_ADDRESS, to: HUB_WALLET, data: '0xsupply-data', value: 0n };
      const depositSpy = vi.spyOn(sodax.spoke, 'deposit').mockResolvedValueOnce({ ok: true, value: rawTx });

      const result = await sodax.moneyMarket.createSupplyIntent({
        raw: true,
        params: supplyParams(ChainKeys.BSC_MAINNET),
      });

      const { tx, relayData } = expectOk(result);
      expect(tx).toBe(rawTx);
      expect(relayData).toEqual({ address: HUB_WALLET, payload: '0xsupply-data' });
      const depositCall = depositSpy.mock.calls[0]?.[0];
      expect(depositCall?.raw).toBe(true);
      expect(depositCall).not.toHaveProperty('walletProvider');
    });

    it('uses dstAddress + dstChainKey when supplied (separate hub-wallet for recipient)', async () => {
      mocks.getUserHubWalletAddress
        .mockResolvedValueOnce(HUB_WALLET) // src lookup
        .mockResolvedValueOnce(TO_HUB_WALLET); // dst lookup
      const buildSpy = vi.spyOn(sodax.moneyMarket, 'buildSupplyData').mockReturnValueOnce('0xsupply-data');
      vi.spyOn(sodax.spoke, 'deposit').mockResolvedValueOnce({ ok: true, value: '0xdep' });

      await sodax.moneyMarket.createSupplyIntent({
        raw: false,
        params: {
          ...supplyParams(ChainKeys.BSC_MAINNET),
          dstChainKey: ChainKeys.SONIC_MAINNET,
          dstAddress: SAMPLE_DST_ADDRESS,
        },
        walletProvider: mockEvmProvider,
      });

      // buildSupplyData receives toHubWallet (the dst lookup result), not the src hub wallet.
      expect(buildSpy).toHaveBeenCalledWith(ChainKeys.BSC_MAINNET, SAMPLE_EVM_TOKEN, 1_000_000n, TO_HUB_WALLET);
    });

    it('on Bitcoin: derives the hub wallet from the Bound Exchange trading address, not the personal address', async () => {
      const TRADING_ADDRESS = 'bc1p-trading-wallet';
      const getEffSpy = vi.spyOn(sodax.spoke.bitcoin, 'getEffectiveWalletAddress').mockResolvedValue(TRADING_ADDRESS);
      const ensureSpy = vi.spyOn(sodax.spoke.bitcoin.radfi, 'ensureRadfiAccessToken').mockResolvedValue(undefined);
      vi.spyOn(sodax.moneyMarket, 'buildSupplyData').mockReturnValueOnce('0xsupply-data');
      const depositSpy = vi.spyOn(sodax.spoke, 'deposit').mockResolvedValueOnce({ ok: true, value: '0xdeposit-hash' });

      const result = await sodax.moneyMarket.createSupplyIntent({
        raw: false,
        params: supplyParams(ChainKeys.BITCOIN_MAINNET),
        walletProvider: mockBitcoinProvider,
      });

      expectOk(result);
      // personal srcAddress is resolved to the trading wallet before hub-wallet derivation
      expect(getEffSpy).toHaveBeenCalledWith(SAMPLE_USER_ADDRESS);
      expect(ensureSpy).toHaveBeenCalledWith(mockBitcoinProvider);
      // hub wallet is derived from the trading address (matches what the relay credits), never the personal one
      expect(mocks.getUserHubWalletAddress).toHaveBeenCalledWith(TRADING_ADDRESS, ChainKeys.BITCOIN_MAINNET);
      expect(mocks.getUserHubWalletAddress).not.toHaveBeenCalledWith(SAMPLE_USER_ADDRESS, ChainKeys.BITCOIN_MAINNET);
      // the spoke deposit must also use the trading address, or the hub executes through a wallet with no BTC
      expect(depositSpy.mock.calls[0]?.[0]?.srcAddress).toBe(TRADING_ADDRESS);
    });
  });

  it('refuses invalid input before building any tx', async () => {
    // Collaborators are no-op mocks so a guard regression can never reach a real deposit/tx (which costs money).
    const getEffSpy = vi.spyOn(sodax.spoke.bitcoin, 'getEffectiveWalletAddress').mockResolvedValue('bc1p-trading');
    const depositSpy = vi.spyOn(sodax.spoke, 'deposit').mockResolvedValue({ ok: true, value: '0xunused' });
    for (const { label, params, walletProvider, message } of INVALID_INPUTS) {
      const result = await sodax.moneyMarket.createSupplyIntent({
        raw: false,
        params: { ...supplyParams(ChainKeys.BSC_MAINNET), ...params },
        walletProvider: walletProvider ?? mockEvmProvider,
      });
      expectRefusal(result, message, label);
    }

    // A non-raw Bitcoin deposit MUST sign via a Bitcoin wallet provider; `undefined` slips past the generic
    // walletProvider check, so this guard fails it fast, before resolving the trading address.
    const noBitcoinProvider = await sodax.moneyMarket.createSupplyIntent({
      raw: false,
      params: supplyParams(ChainKeys.BITCOIN_MAINNET),
      // Deliberate cast: the guard under test is exactly the missing-provider case.
      walletProvider: undefined as unknown as IBitcoinWalletProvider,
    });
    const error = expectErr(noBitcoinProvider, 'VALIDATION_FAILED', { field: 'walletProvider' }, 'Bitcoin');
    expect(String(error)).toMatch(/Expected bitcoin wallet provider/);
    expect(getEffSpy).not.toHaveBeenCalled();

    vi.spyOn(sodax.config, 'isMoneyMarketSupportedToken').mockReturnValueOnce(false);
    const unsupported = await sodax.moneyMarket.createSupplyIntent({
      raw: false,
      params: supplyParams(ChainKeys.BSC_MAINNET),
      walletProvider: mockEvmProvider,
    });
    expectRefusal(unsupported, /Unsupported spoke chain/, 'unsupported token on srcChain');
    expect(depositSpy).not.toHaveBeenCalled();
  });

  it('returns ok:false when the hub-wallet lookup rejects, or spoke.deposit throws or fails', async () => {
    vi.spyOn(sodax.moneyMarket, 'buildSupplyData').mockReturnValue('0xsupply-data');
    const hubError = new Error('HUB_LOOKUP_FAILED');
    const thrown = new Error('DEPOSIT_THREW');
    const depositError = new Error('DEPOSIT_REJECTED');
    mocks.getUserHubWalletAddress.mockReset();
    mocks.getUserHubWalletAddress.mockRejectedValueOnce(hubError).mockResolvedValue(HUB_WALLET);
    vi.spyOn(sodax.spoke, 'deposit')
      .mockRejectedValueOnce(thrown)
      .mockResolvedValueOnce({ ok: false, error: depositError });
    const run = () =>
      sodax.moneyMarket.createSupplyIntent({
        raw: false,
        params: supplyParams(ChainKeys.BSC_MAINNET),
        walletProvider: mockEvmProvider,
      });

    for (const { message } of [hubError, thrown, depositError]) {
      expect(await run(), message).toMatchObject({ ok: false, error: expect.objectContaining({ message }) });
    }
  });
});

describe('MoneyMarketService.supply', () => {
  const run = (srcChainKey: typeof ChainKeys.SONIC_MAINNET | typeof ChainKeys.BSC_MAINNET = ChainKeys.BSC_MAINNET) =>
    sodax.moneyMarket.supply({ raw: false, params: supplyParams(srcChainKey), walletProvider: mockEvmProvider });

  describe('happy paths', () => {
    it('on hub (Sonic): skips relay and returns { srcChainTxHash, dstChainTxHash }', async () => {
      vi.spyOn(sodax.moneyMarket, 'createSupplyIntent').mockResolvedValueOnce(hubIntent);
      vi.spyOn(sodax.spoke, 'verifyTxHash').mockResolvedValueOnce({ ok: true, value: true });

      const result = await run(ChainKeys.SONIC_MAINNET);

      expect(result).toEqual({ ok: true, value: { srcChainTxHash: '0xhub-tx', dstChainTxHash: '0xhub-tx' } });
      expect(mocks.relayTxAndWaitPacket).not.toHaveBeenCalled();
    });

    it('on EVM spoke: relays the packet and returns { srcChainTxHash, dstChainTxHash }', async () => {
      vi.spyOn(sodax.moneyMarket, 'createSupplyIntent').mockResolvedValueOnce(spokeIntent);
      const verifySpy = vi.spyOn(sodax.spoke, 'verifyTxHash').mockResolvedValueOnce({ ok: true, value: true });
      mocks.relayTxAndWaitPacket.mockResolvedValueOnce({ ok: true, value: { dst_tx_hash: '0xdst-tx' } });

      const result = await run();

      expect(result).toEqual({ ok: true, value: { srcChainTxHash: '0xspoke-tx', dstChainTxHash: '0xdst-tx' } });
      expect(verifySpy).toHaveBeenCalledWith({ txHash: '0xspoke-tx', chainKey: ChainKeys.BSC_MAINNET });
      // The callsite forwards relayData verbatim; the Solana/Bitcoin gate lives inside relayTxAndWaitPacket.
      expect(mocks.relayTxAndWaitPacket).toHaveBeenCalledTimes(1);
      expect(mocks.relayTxAndWaitPacket).toHaveBeenCalledWith(
        expect.objectContaining({
          srcTxHash: '0xspoke-tx',
          data: { address: HUB_WALLET, payload: '0x' },
          chainKey: ChainKeys.BSC_MAINNET,
          relayerApiEndpoint: sodax.moneyMarket.relayerApiEndpoint,
        }),
      );
    });
  });

  it('forwards an intent failure, maps a verify failure, and wraps a foreign SodaxError', async () => {
    const intentError = new SodaxError('INTENT_CREATION_FAILED', 'create intent failed', { feature: 'moneyMarket' });
    const verifyError = new Error('VERIFY_FAILED');
    // The narrow `isMoneyMarketOrchestrationError` guard rejects codes outside SupplyErrorCode, so a
    // wrong-coded SodaxError thrown inside the orchestration is wrapped with the original on cause.
    const outOfUnion = new SodaxError('SWAP_RELAY_TIMEOUT' as never, 'foreign code', { feature: 'moneyMarket' });
    vi.spyOn(sodax.moneyMarket, 'createSupplyIntent')
      .mockResolvedValueOnce({ ok: false, error: intentError })
      .mockResolvedValueOnce(spokeIntent)
      .mockRejectedValueOnce(outOfUnion);
    vi.spyOn(sodax.spoke, 'verifyTxHash').mockResolvedValueOnce({ ok: false, error: verifyError });

    expect(await run()).toEqual({ ok: false, error: intentError });
    const verifyFailure = expectErr(await run(), 'TX_VERIFICATION_FAILED', { phase: 'verify', action: 'supply' });
    expect(verifyFailure.cause).toBe(verifyError);
    expect(await run()).toMatchObject({
      ok: false,
      error: { code: 'EXECUTION_FAILED', cause: outOfUnion, context: { action: 'supply' } },
    });
  });
});

// =========================================================================
// borrow / createBorrowIntent
// =========================================================================
//
// Borrow uses `spoke.sendMessage` (not deposit). It also has a richer set of
// optional params (dstChainKey / dstAddress) and a unique
// `needsRelay` calculation: relay is only skipped when both src AND target are the hub.

describe('MoneyMarketService.createBorrowIntent', () => {
  beforeEach(stubBorrowableDstToken);

  describe('happy paths', () => {
    it('on EVM spoke (BSC): builds borrow data and sends message to the hub, without an XRPL destination check', async () => {
      const checkSpy = vi.spyOn(sodax.spoke.xrp, 'checkDestination');
      vi.spyOn(sodax.moneyMarket, 'buildBorrowData').mockReturnValueOnce('0xborrow-data');
      const sendSpy = vi.spyOn(sodax.spoke, 'sendMessage').mockResolvedValueOnce({ ok: true, value: '0xsend-hash' });

      const result = await sodax.moneyMarket.createBorrowIntent({
        raw: false,
        params: borrowParams(ChainKeys.BSC_MAINNET),
        walletProvider: mockEvmProvider,
      });

      expect(result).toEqual({
        ok: true,
        value: { tx: '0xsend-hash', relayData: { address: HUB_WALLET, payload: '0xborrow-data' } },
      });
      const call = sendSpy.mock.calls[0]?.[0];
      expect(call?.srcChainKey).toBe(ChainKeys.BSC_MAINNET);
      expect(call?.dstAddress).toBe(HUB_WALLET);
      expect(call?.payload).toBe('0xborrow-data');
      expect(call?.raw).toBe(false);
      expect(call?.walletProvider).toBe(mockEvmProvider);
      expect(checkSpy).not.toHaveBeenCalled();
    });

    it('on an XRPL destination: encodes the recipient the asset-manager release expects', async () => {
      const { chainKey, address, word } = XRPL_RECIPIENT;
      vi.spyOn(sodax.spoke.xrp, 'checkDestination').mockResolvedValue({ ready: true });
      const buildSpy = vi.spyOn(sodax.moneyMarket, 'buildBorrowData').mockReturnValueOnce('0xborrow-data');
      vi.spyOn(sodax.spoke, 'sendMessage').mockResolvedValueOnce({ ok: true, value: '0xsend-hash' });

      const result = await sodax.moneyMarket.createBorrowIntent({
        raw: false,
        params: { ...borrowParams(ChainKeys.BSC_MAINNET), dstChainKey: chainKey, dstAddress: address },
        walletProvider: mockEvmProvider,
      });

      expectOk(result);
      // The bare identity is still accepted on-chain, so the unpadded form delivers to a dead address.
      expect(buildSpy.mock.calls[0]?.[1]).toBe(word);
    });

    it('refuses an XRPL destination that cannot receive the release before sending anything', async () => {
      vi.spyOn(sodax.spoke.xrp, 'checkDestination').mockResolvedValue({ ready: false, reason: 'account_not_found' });
      const sendSpy = vi.spyOn(sodax.spoke, 'sendMessage');

      const result = await sodax.moneyMarket.createBorrowIntent({
        raw: false,
        params: {
          ...borrowParams(ChainKeys.BSC_MAINNET),
          dstChainKey: ChainKeys.XRP_MAINNET,
          dstAddress: XRPL_RECIPIENT.address,
        },
        walletProvider: mockEvmProvider,
      });

      // The relay fails these terminally after the hub has burned the funds, so nothing may be sent.
      expect(result).toMatchObject({ ok: false, error: { code: 'VALIDATION_FAILED', message: /does not exist/ } });
      expect(sendSpy).not.toHaveBeenCalled();
    });

    it('on Bitcoin source: derives the hub wallet from the trading address but passes the personal srcAddress', async () => {
      const TRADING = 'bc1p-trading-wallet';
      const getEffSpy = vi.spyOn(sodax.spoke.bitcoin, 'getEffectiveWalletAddress').mockResolvedValue(TRADING);
      vi.spyOn(sodax.moneyMarket, 'buildBorrowData').mockReturnValueOnce('0xborrow-data');
      const sendSpy = vi.spyOn(sodax.spoke, 'sendMessage').mockResolvedValueOnce({ ok: true, value: '0xsend-hash' });

      const result = await sodax.moneyMarket.createBorrowIntent({
        raw: false,
        params: {
          ...borrowParams(ChainKeys.BITCOIN_MAINNET),
          dstChainKey: ChainKeys.BSC_MAINNET,
          dstAddress: SAMPLE_DST_ADDRESS,
        },
        walletProvider: mockBitcoinProvider,
      });

      expectOk(result);
      expect(getEffSpy).toHaveBeenCalledWith(SAMPLE_USER_ADDRESS);
      // hub wallet is derived from the trading address (where collateral/debt live)
      expect(mocks.getUserHubWalletAddress).toHaveBeenCalledWith(TRADING, ChainKeys.BITCOIN_MAINNET);
      expect(mocks.getUserHubWalletAddress).not.toHaveBeenCalledWith(SAMPLE_USER_ADDRESS, ChainKeys.BITCOIN_MAINNET);
      // srcAddress stays personal: spoke.sendMessage re-resolves the trading address itself.
      expect(sendSpy.mock.calls[0]?.[0]?.srcAddress).toBe(SAMPLE_USER_ADDRESS);
    });
  });

  const borrowOnBsc = () =>
    sodax.moneyMarket.createBorrowIntent({
      raw: false,
      params: borrowParams(ChainKeys.BSC_MAINNET),
      walletProvider: mockEvmProvider,
    });

  it('refuses invalid input or an unknown dst money-market token', async () => {
    for (const { label, params, walletProvider, message } of INVALID_INPUTS) {
      const result = await sodax.moneyMarket.createBorrowIntent({
        raw: false,
        params: { ...borrowParams(ChainKeys.BSC_MAINNET), ...params },
        walletProvider: walletProvider ?? mockEvmProvider,
      });
      expectRefusal(result, message, label);
    }

    vi.spyOn(sodax.config, 'getMoneyMarketToken').mockReturnValueOnce(undefined);
    expectRefusal(await borrowOnBsc(), /Money market token not found/, 'unknown dst token');
  });

  it('decodes the reserve configuration and refuses a reserve that cannot lend before sending anything', async () => {
    const cases = [
      { label: 'paused', configuration: BORROWABLE_RESERVE | RESERVE_PAUSED, borrowable: false },
      { label: 'not a pool reserve', configuration: 0n, borrowable: false },
      // Configuration words read from the Sonic lending pool, independent of the bit constants above.
      {
        label: 'AAPL (borrowing off)',
        configuration: 7237005577332262213973186568751985011659028938317238155654854946153592264560n,
        borrowable: false,
      },
      {
        label: 'LL (frozen)',
        configuration: 7237005577332262213973186568751985260883462776716331137789786111811354361856n,
        borrowable: false,
      },
      {
        label: 'sodaUSDC',
        configuration: 7237005577332262213973186568751985094729963303420508151871565085374345649484n,
        borrowable: true,
      },
    ];
    const reserveSpy = vi.spyOn(sodax.moneyMarket.data, 'getReserveData');
    vi.spyOn(sodax.moneyMarket, 'buildBorrowData').mockReturnValue('0xborrow-data');
    const sendSpy = vi.spyOn(sodax.spoke, 'sendMessage').mockResolvedValue({ ok: true, value: '0xsend-hash' });

    for (const { label, configuration, borrowable } of cases) {
      reserveSpy.mockResolvedValueOnce(reserveData(configuration));
      sendSpy.mockClear();

      const result = await borrowOnBsc();

      expect(result.ok, label).toBe(borrowable);
      expect(sendSpy, label).toHaveBeenCalledTimes(borrowable ? 1 : 0);
      if (!borrowable) {
        expectErr(result, 'VALIDATION_FAILED', undefined, label);
        expect(result, label).toMatchObject({
          error: {
            message:
              'TKN cannot be borrowed: its money-market reserve is inactive, frozen, paused or has borrowing disabled',
          },
        });
      }
    }
  });

  it('checks the token vault reserve, and the bnUSD debt reserve rather than the bnUSD vault reserve', async () => {
    // The bnUSD vault reserve has borrowing off, so checking it would refuse every bnUSD borrow.
    const cases = [
      { label: 'token vault', vault: SAMPLE_BORROW_VAULT, reserve: SAMPLE_BORROW_VAULT },
      { label: 'bnUSD', vault: sodax.config.moneyMarket.bnUSDVault, reserve: sodax.config.moneyMarket.bnUSD },
    ];
    const reserveSpy = vi.spyOn(sodax.moneyMarket.data, 'getReserveData');
    vi.spyOn(sodax.moneyMarket, 'buildBorrowData').mockReturnValue('0xborrow-data');
    vi.spyOn(sodax.spoke, 'sendMessage').mockResolvedValue({ ok: true, value: '0xsend-hash' });

    for (const { label, vault, reserve } of cases) {
      vi.spyOn(sodax.config, 'getMoneyMarketToken').mockReturnValueOnce({ ...BORROW_DST_TOKEN, vault });
      reserveSpy.mockClear();

      expectOk(await borrowOnBsc(), label);
      expect(reserveSpy, label).toHaveBeenCalledWith(reserve);
    }
  });

  it('returns ok:false when the hub-wallet lookup rejects or spoke.sendMessage throws or fails', async () => {
    vi.spyOn(sodax.moneyMarket, 'buildBorrowData').mockReturnValue('0xborrow-data');
    const hubError = new Error('HUB_LOOKUP_FAILED');
    const thrown = new Error('SEND_THREW');
    const sendError = new IndeterminateOutcomeError('SEND_FAILED', {
      cause: new Error('lost reply'),
      trackingId: '0xoriginal',
    });
    mocks.getUserHubWalletAddress.mockReset();
    mocks.getUserHubWalletAddress.mockRejectedValueOnce(hubError).mockResolvedValue(HUB_WALLET);
    vi.spyOn(sodax.spoke, 'sendMessage')
      .mockRejectedValueOnce(thrown)
      .mockResolvedValueOnce({ ok: false, error: sendError });

    expect(await borrowOnBsc()).toMatchObject({
      ok: false,
      error: expect.objectContaining({ message: hubError.message }),
    });
    expect(await borrowOnBsc()).toMatchObject({
      ok: false,
      error: expect.objectContaining({ message: thrown.message }),
    });
    // A failure Result from sendMessage keeps its tracking id and the relay data.
    expect(await borrowOnBsc()).toMatchObject({
      ok: false,
      error: {
        code: 'INTENT_CREATION_FAILED',
        context: {
          trackingId: '0xoriginal',
          dstChainKey: ChainKeys.BSC_MAINNET,
          relayData: { address: expect.any(String), payload: '0xborrow-data' },
        },
      },
    });
  });
});

describe('MoneyMarketService.borrow', () => {
  describe('happy paths', () => {
    it('on hub with default target (also hub): skips relay and returns { srcChainTxHash, dstChainTxHash }', async () => {
      vi.spyOn(sodax.moneyMarket, 'createBorrowIntent').mockResolvedValueOnce(hubIntent);
      vi.spyOn(sodax.spoke, 'verifyTxHash').mockResolvedValueOnce({ ok: true, value: true });

      const result = await sodax.moneyMarket.borrow({
        raw: false,
        params: borrowParams(ChainKeys.SONIC_MAINNET),
        walletProvider: mockEvmProvider,
      });

      expect(result).toEqual({ ok: true, value: { srcChainTxHash: '0xhub-tx', dstChainTxHash: '0xhub-tx' } });
      expect(mocks.relayTxAndWaitPacket).not.toHaveBeenCalled();
    });

    it('on hub with non-hub target: relays the packet (cross-chain delivery)', async () => {
      vi.spyOn(sodax.moneyMarket, 'createBorrowIntent').mockResolvedValueOnce(hubIntent);
      vi.spyOn(sodax.spoke, 'verifyTxHash').mockResolvedValueOnce({ ok: true, value: true });
      mocks.relayTxAndWaitPacket.mockResolvedValueOnce({ ok: true, value: { dst_tx_hash: '0xdst' } });

      const result = await sodax.moneyMarket.borrow({
        raw: false,
        params: {
          ...borrowParams(ChainKeys.SONIC_MAINNET),
          dstChainKey: ChainKeys.BSC_MAINNET,
          dstAddress: SAMPLE_DST_ADDRESS,
        },
        walletProvider: mockEvmProvider,
      });

      expect(result).toEqual({ ok: true, value: { srcChainTxHash: '0xhub-tx', dstChainTxHash: '0xdst' } });
      expect(mocks.relayTxAndWaitPacket).toHaveBeenCalledTimes(1);
    });
  });

  it('forwards an intent failure, maps a relay failure, and wraps a foreign SodaxError', async () => {
    const intentError = new SodaxError('INTENT_CREATION_FAILED', 'create intent failed', { feature: 'moneyMarket' });
    const relayError = new Error('RELAY_TIMEOUT');
    const outOfUnion = new SodaxError('SWAP_VALIDATION_FAILED' as never, 'foreign code', { feature: 'moneyMarket' });
    vi.spyOn(sodax.moneyMarket, 'createBorrowIntent')
      .mockResolvedValueOnce({ ok: false, error: intentError })
      .mockResolvedValueOnce(spokeIntent)
      .mockRejectedValueOnce(outOfUnion);
    vi.spyOn(sodax.spoke, 'verifyTxHash').mockResolvedValueOnce({ ok: true, value: true });
    mocks.relayTxAndWaitPacket.mockResolvedValueOnce({ ok: false, error: relayError });
    const run = () =>
      sodax.moneyMarket.borrow({
        raw: false,
        params: borrowParams(ChainKeys.BSC_MAINNET),
        walletProvider: mockEvmProvider,
      });

    expect(await run()).toEqual({ ok: false, error: intentError });
    expect(await run()).toMatchObject({
      ok: false,
      error: { code: 'RELAY_TIMEOUT', cause: relayError, context: { action: 'borrow' } },
    });
    expect(await run()).toMatchObject({
      ok: false,
      error: { code: 'EXECUTION_FAILED', cause: outOfUnion, context: { action: 'borrow' } },
    });
  });
});

// =========================================================================
// withdraw / createWithdrawIntent
// =========================================================================
//
// Withdraw also uses `sendMessage` and validates the token on `dstChainKey`. The
// `needsRelay` calculation has the walletRouter exemption: skip relay only when src is
// hub AND target is hub AND target ≠ walletRouter.

describe('MoneyMarketService.createWithdrawIntent', () => {
  describe('happy paths', () => {
    it('on EVM spoke: builds withdraw data and sends message to the hub, without an XRPL destination check', async () => {
      const checkSpy = vi.spyOn(sodax.spoke.xrp, 'checkDestination');
      vi.spyOn(sodax.moneyMarket, 'buildWithdrawData').mockReturnValueOnce('0xwithdraw-data');
      const sendSpy = vi.spyOn(sodax.spoke, 'sendMessage').mockResolvedValueOnce({ ok: true, value: '0xsend-hash' });

      const result = await sodax.moneyMarket.createWithdrawIntent({
        raw: false,
        params: withdrawParams(ChainKeys.BSC_MAINNET),
        walletProvider: mockEvmProvider,
      });

      expect(result).toEqual({
        ok: true,
        value: { tx: '0xsend-hash', relayData: { address: HUB_WALLET, payload: '0xwithdraw-data' } },
      });
      const call = sendSpy.mock.calls[0]?.[0];
      expect(call?.payload).toBe('0xwithdraw-data');
      expect(call?.raw).toBe(false);
      expect(checkSpy).not.toHaveBeenCalled();
    });

    // Borrow covers a non-EVM (padded) recipient; withdraw covers an EVM one.
    it('on a Monad destination: encodes the recipient the asset-manager release expects', async () => {
      const { chainKey, address, word } = MONAD_RECIPIENT;
      const buildSpy = vi.spyOn(sodax.moneyMarket, 'buildWithdrawData').mockReturnValueOnce('0xwithdraw-data');
      vi.spyOn(sodax.spoke, 'sendMessage').mockResolvedValueOnce({ ok: true, value: '0xsend-hash' });

      const result = await sodax.moneyMarket.createWithdrawIntent({
        raw: false,
        params: { ...withdrawParams(ChainKeys.BSC_MAINNET), dstChainKey: chainKey, dstAddress: address },
        walletProvider: mockEvmProvider,
      });

      expectOk(result);
      // The bare identity is still accepted on-chain, so the unpadded form delivers to a dead address.
      expect(buildSpy.mock.calls[0]?.[1]).toBe(word);
    });

    it('refuses an XRPL destination that cannot receive the release before sending anything', async () => {
      vi.spyOn(sodax.spoke.xrp, 'checkDestination').mockResolvedValue({ ready: false, reason: 'no_trustline' });
      const sendSpy = vi.spyOn(sodax.spoke, 'sendMessage');

      const result = await sodax.moneyMarket.createWithdrawIntent({
        raw: false,
        params: {
          ...withdrawParams(ChainKeys.BSC_MAINNET),
          dstChainKey: ChainKeys.XRP_MAINNET,
          dstAddress: XRPL_RECIPIENT.address,
        },
        walletProvider: mockEvmProvider,
      });

      expect(result).toMatchObject({ ok: false, error: { code: 'VALIDATION_FAILED', message: /no trustline/ } });
      expect(sendSpy).not.toHaveBeenCalled();
    });

    it('on Bitcoin source: derives the hub wallet from the trading address but passes the personal srcAddress', async () => {
      const TRADING = 'bc1p-trading-wallet';
      const getEffSpy = vi.spyOn(sodax.spoke.bitcoin, 'getEffectiveWalletAddress').mockResolvedValue(TRADING);
      vi.spyOn(sodax.moneyMarket, 'buildWithdrawData').mockReturnValueOnce('0xwithdraw-data');
      const sendSpy = vi.spyOn(sodax.spoke, 'sendMessage').mockResolvedValueOnce({ ok: true, value: '0xsend-hash' });

      const result = await sodax.moneyMarket.createWithdrawIntent({
        raw: false,
        params: {
          ...withdrawParams(ChainKeys.BITCOIN_MAINNET),
          dstChainKey: ChainKeys.BSC_MAINNET,
          dstAddress: SAMPLE_DST_ADDRESS,
        },
        walletProvider: mockBitcoinProvider,
      });

      expectOk(result);
      expect(getEffSpy).toHaveBeenCalledWith(SAMPLE_USER_ADDRESS);
      // hub wallet is derived from the trading address (where collateral/debt live)
      expect(mocks.getUserHubWalletAddress).toHaveBeenCalledWith(TRADING, ChainKeys.BITCOIN_MAINNET);
      // srcAddress stays personal: spoke.sendMessage re-resolves the trading address itself.
      expect(sendSpy.mock.calls[0]?.[0]?.srcAddress).toBe(SAMPLE_USER_ADDRESS);
    });
  });

  const withdrawOnBsc = () =>
    sodax.moneyMarket.createWithdrawIntent({
      raw: false,
      params: withdrawParams(ChainKeys.BSC_MAINNET),
      walletProvider: mockEvmProvider,
    });

  it('refuses invalid input or a token unsupported on dstChainKey (default = srcChain)', async () => {
    for (const { label, params, walletProvider, message } of INVALID_INPUTS) {
      const result = await sodax.moneyMarket.createWithdrawIntent({
        raw: false,
        params: { ...withdrawParams(ChainKeys.BSC_MAINNET), ...params },
        walletProvider: walletProvider ?? mockEvmProvider,
      });
      expectRefusal(result, message, label);
    }

    vi.spyOn(sodax.config, 'isMoneyMarketSupportedToken').mockReturnValueOnce(false);
    expectRefusal(await withdrawOnBsc(), /Unsupported spoke chain/, 'unsupported token');
  });

  it('returns ok:false when spoke.sendMessage fails or throws', async () => {
    vi.spyOn(sodax.moneyMarket, 'buildWithdrawData').mockReturnValue('0xwithdraw-data');
    const sendError = new IndeterminateOutcomeError('SEND_FAILED', {
      cause: new Error('lost reply'),
      trackingId: '0xoriginal',
    });
    const thrown = new Error('SEND_THREW');
    vi.spyOn(sodax.spoke, 'sendMessage')
      .mockResolvedValueOnce({ ok: false, error: sendError })
      .mockRejectedValueOnce(thrown);

    // A failure Result keeps its tracking id and the relay data.
    expect(await withdrawOnBsc()).toMatchObject({
      ok: false,
      error: {
        code: 'INTENT_CREATION_FAILED',
        context: {
          trackingId: '0xoriginal',
          dstChainKey: ChainKeys.BSC_MAINNET,
          relayData: { address: expect.any(String), payload: '0xwithdraw-data' },
        },
      },
    });
    expect(await withdrawOnBsc()).toMatchObject({
      ok: false,
      error: expect.objectContaining({ message: thrown.message }),
    });
  });
});

describe('MoneyMarketService.withdraw', () => {
  describe('happy paths', () => {
    it('on hub, skips relay for the default target and for target = walletRouter (walletRouter exemption)', async () => {
      const walletRouter = sodax.hubProvider.chainConfig.addresses.walletRouter;
      vi.spyOn(sodax.moneyMarket, 'createWithdrawIntent').mockResolvedValue(hubIntent);
      vi.spyOn(sodax.spoke, 'verifyTxHash').mockResolvedValue({ ok: true, value: true });

      const defaultTarget = await sodax.moneyMarket.withdraw({
        raw: false,
        params: withdrawParams(ChainKeys.SONIC_MAINNET),
        walletProvider: mockEvmProvider,
      });
      const routerTarget = await sodax.moneyMarket.withdraw({
        raw: false,
        params: {
          ...withdrawParams(ChainKeys.SONIC_MAINNET),
          dstChainKey: ChainKeys.SONIC_MAINNET,
          dstAddress: walletRouter,
        },
        walletProvider: mockEvmProvider,
      });

      for (const result of [defaultTarget, routerTarget]) {
        expect(result).toEqual({ ok: true, value: { srcChainTxHash: '0xhub-tx', dstChainTxHash: '0xhub-tx' } });
      }
      expect(mocks.relayTxAndWaitPacket).not.toHaveBeenCalled();
    });

    it('on hub with non-hub target: relays', async () => {
      vi.spyOn(sodax.moneyMarket, 'createWithdrawIntent').mockResolvedValueOnce(hubIntent);
      vi.spyOn(sodax.spoke, 'verifyTxHash').mockResolvedValueOnce({ ok: true, value: true });
      mocks.relayTxAndWaitPacket.mockResolvedValueOnce({ ok: true, value: { dst_tx_hash: '0xdst' } });

      const result = await sodax.moneyMarket.withdraw({
        raw: false,
        params: {
          ...withdrawParams(ChainKeys.SONIC_MAINNET),
          dstChainKey: ChainKeys.BSC_MAINNET,
          dstAddress: SAMPLE_DST_ADDRESS,
        },
        walletProvider: mockEvmProvider,
      });

      expect(result).toEqual({ ok: true, value: { srcChainTxHash: '0xhub-tx', dstChainTxHash: '0xdst' } });
    });
  });

  it('forwards an intent failure, maps a relay failure, and wraps an out-of-union SodaxError', async () => {
    // APPROVE_FAILED is a valid moneyMarket code but outside the withdraw orchestration union.
    const intentError = new SodaxError('INTENT_CREATION_FAILED', 'create withdraw intent failed', {
      feature: 'moneyMarket',
    });
    const relayError = new Error('RELAY_TIMEOUT');
    const outOfUnion = new SodaxError('APPROVE_FAILED', 'wrong-phase code', { feature: 'moneyMarket' });
    vi.spyOn(sodax.moneyMarket, 'createWithdrawIntent')
      .mockResolvedValueOnce({ ok: false, error: intentError })
      .mockResolvedValueOnce(spokeIntent)
      .mockRejectedValueOnce(outOfUnion);
    vi.spyOn(sodax.spoke, 'verifyTxHash').mockResolvedValueOnce({ ok: true, value: true });
    mocks.relayTxAndWaitPacket.mockResolvedValueOnce({ ok: false, error: relayError });
    const run = () =>
      sodax.moneyMarket.withdraw({
        raw: false,
        params: withdrawParams(ChainKeys.BSC_MAINNET),
        walletProvider: mockEvmProvider,
      });

    expect(await run()).toEqual({ ok: false, error: intentError });
    expect(await run()).toMatchObject({
      ok: false,
      error: { code: 'RELAY_TIMEOUT', cause: relayError, context: { action: 'withdraw' } },
    });
    expect(await run()).toMatchObject({
      ok: false,
      error: { code: 'EXECUTION_FAILED', cause: outOfUnion, context: { action: 'withdraw' } },
    });
  });
});

// =========================================================================
// repay / createRepayIntent
// =========================================================================
//
// Repay mirrors supply: uses spoke.deposit, builds via buildRepayData, and the
// top-level method skips the relay only when src is the hub.

describe('MoneyMarketService.createRepayIntent', () => {
  describe('happy paths', () => {
    it('on EVM spoke: builds repay data and deposits to the hub wallet, with walletProvider only when raw=false', async () => {
      vi.spyOn(sodax.moneyMarket, 'buildRepayData').mockReturnValue('0xrepay-data');
      const rawTx = { from: SAMPLE_USER_ADDRESS, to: HUB_WALLET, data: '0x', value: 0n };
      const depositSpy = vi
        .spyOn(sodax.spoke, 'deposit')
        .mockResolvedValueOnce({ ok: true, value: '0xdeposit-hash' })
        .mockResolvedValueOnce({ ok: true, value: rawTx });

      const result = await sodax.moneyMarket.createRepayIntent({
        raw: false,
        params: repayParams(ChainKeys.BSC_MAINNET),
        walletProvider: mockEvmProvider,
      });
      const rawResult = await sodax.moneyMarket.createRepayIntent({
        raw: true,
        params: repayParams(ChainKeys.BSC_MAINNET),
      });

      expect(result).toEqual({
        ok: true,
        value: { tx: '0xdeposit-hash', relayData: { address: HUB_WALLET, payload: '0xrepay-data' } },
      });
      expect(depositSpy.mock.calls[0]?.[0]?.data).toBe('0xrepay-data');
      expect(depositSpy.mock.calls[0]?.[0]?.raw).toBe(false);
      expect(rawResult).toEqual({
        ok: true,
        value: { tx: rawTx, relayData: { address: HUB_WALLET, payload: '0xrepay-data' } },
      });
      expect(depositSpy.mock.calls[1]?.[0].raw).toBe(true);
    });

    it('on Bitcoin source: deposits from the Bound Exchange trading address and ensures the session token', async () => {
      const TRADING = 'bc1p-trading-wallet';
      const getEffSpy = vi.spyOn(sodax.spoke.bitcoin, 'getEffectiveWalletAddress').mockResolvedValue(TRADING);
      const ensureSpy = vi.spyOn(sodax.spoke.bitcoin.radfi, 'ensureRadfiAccessToken').mockResolvedValue(undefined);
      vi.spyOn(sodax.moneyMarket, 'buildRepayData').mockReturnValueOnce('0xrepay-data');
      const depositSpy = vi.spyOn(sodax.spoke, 'deposit').mockResolvedValueOnce({ ok: true, value: '0xdeposit-hash' });

      const result = await sodax.moneyMarket.createRepayIntent({
        raw: false,
        params: repayParams(ChainKeys.BITCOIN_MAINNET),
        walletProvider: mockBitcoinProvider,
      });

      expectOk(result);
      expect(getEffSpy).toHaveBeenCalledWith(SAMPLE_USER_ADDRESS);
      expect(ensureSpy).toHaveBeenCalledWith(mockBitcoinProvider);
      expect(mocks.getUserHubWalletAddress).toHaveBeenCalledWith(TRADING, ChainKeys.BITCOIN_MAINNET);
      expect(depositSpy.mock.calls[0]?.[0]?.srcAddress).toBe(TRADING);
    });
  });

  const repayOnBsc = () =>
    sodax.moneyMarket.createRepayIntent({
      raw: false,
      params: repayParams(ChainKeys.BSC_MAINNET),
      walletProvider: mockEvmProvider,
    });

  it('refuses invalid input before building any tx', async () => {
    // Same fail-fast guards as supply; collaborators are no-op mocks so a regression can never build a real tx.
    const getEffSpy = vi.spyOn(sodax.spoke.bitcoin, 'getEffectiveWalletAddress').mockResolvedValue('bc1p-trading');
    const depositSpy = vi.spyOn(sodax.spoke, 'deposit').mockResolvedValue({ ok: true, value: '0xunused' });
    for (const { label, params, walletProvider, message } of INVALID_INPUTS) {
      const result = await sodax.moneyMarket.createRepayIntent({
        raw: false,
        params: { ...repayParams(ChainKeys.BSC_MAINNET), ...params },
        walletProvider: walletProvider ?? mockEvmProvider,
      });
      expectRefusal(result, message, label);
    }

    const noBitcoinProvider = await sodax.moneyMarket.createRepayIntent({
      raw: false,
      params: repayParams(ChainKeys.BITCOIN_MAINNET),
      // Deliberate cast: the guard under test is exactly the missing-provider case.
      walletProvider: undefined as unknown as IBitcoinWalletProvider,
    });
    const error = expectErr(noBitcoinProvider, 'VALIDATION_FAILED', { field: 'walletProvider' }, 'Bitcoin');
    expect(String(error)).toMatch(/Expected bitcoin wallet provider/);
    expect(getEffSpy).not.toHaveBeenCalled();

    vi.spyOn(sodax.config, 'isMoneyMarketSupportedToken').mockReturnValueOnce(false);
    expectRefusal(await repayOnBsc(), /Unsupported spoke chain/, 'unsupported token on srcChain');
    expect(depositSpy).not.toHaveBeenCalled();
  });

  it('returns ok:false when spoke.deposit fails or throws', async () => {
    vi.spyOn(sodax.moneyMarket, 'buildRepayData').mockReturnValue('0xrepay-data');
    const depositError = new Error('DEPOSIT_FAILED');
    const thrown = new Error('DEPOSIT_THREW');
    vi.spyOn(sodax.spoke, 'deposit')
      .mockResolvedValueOnce({ ok: false, error: depositError })
      .mockRejectedValueOnce(thrown);

    for (const { message } of [depositError, thrown]) {
      expect(await repayOnBsc(), message).toMatchObject({ ok: false, error: expect.objectContaining({ message }) });
    }
  });
});

describe('MoneyMarketService.repay', () => {
  describe('happy paths', () => {
    it('on hub: skips relay and returns { srcChainTxHash, dstChainTxHash }', async () => {
      vi.spyOn(sodax.moneyMarket, 'createRepayIntent').mockResolvedValueOnce(hubIntent);
      vi.spyOn(sodax.spoke, 'verifyTxHash').mockResolvedValueOnce({ ok: true, value: true });

      const result = await sodax.moneyMarket.repay({
        raw: false,
        params: repayParams(ChainKeys.SONIC_MAINNET),
        walletProvider: mockEvmProvider,
      });

      expect(result).toEqual({ ok: true, value: { srcChainTxHash: '0xhub-tx', dstChainTxHash: '0xhub-tx' } });
      expect(mocks.relayTxAndWaitPacket).not.toHaveBeenCalled();
    });

    it('on EVM spoke: relays the packet', async () => {
      vi.spyOn(sodax.moneyMarket, 'createRepayIntent').mockResolvedValueOnce(spokeIntent);
      const verifySpy = vi.spyOn(sodax.spoke, 'verifyTxHash').mockResolvedValueOnce({ ok: true, value: true });
      mocks.relayTxAndWaitPacket.mockResolvedValueOnce({ ok: true, value: { dst_tx_hash: '0xdst' } });

      const result = await sodax.moneyMarket.repay({
        raw: false,
        params: repayParams(ChainKeys.BSC_MAINNET),
        walletProvider: mockEvmProvider,
      });

      expect(result).toEqual({ ok: true, value: { srcChainTxHash: '0xspoke-tx', dstChainTxHash: '0xdst' } });
      expect(verifySpy).toHaveBeenCalledWith({ txHash: '0xspoke-tx', chainKey: ChainKeys.BSC_MAINNET });
      expect(mocks.relayTxAndWaitPacket).toHaveBeenCalledWith(
        expect.objectContaining({
          srcTxHash: '0xspoke-tx',
          data: { address: HUB_WALLET, payload: '0x' },
          chainKey: ChainKeys.BSC_MAINNET,
          relayerApiEndpoint: sodax.moneyMarket.relayerApiEndpoint,
        }),
      );
    });
  });

  it('forwards an intent failure, maps a relay failure, and wraps a foreign SodaxError', async () => {
    const intentError = new SodaxError('INTENT_CREATION_FAILED', 'create intent failed', { feature: 'moneyMarket' });
    const relayError = new Error('RELAY_TIMEOUT');
    const outOfUnion = new SodaxError('SOMEMODULE_FOO' as never, 'foreign code', { feature: 'moneyMarket' });
    vi.spyOn(sodax.moneyMarket, 'createRepayIntent')
      .mockResolvedValueOnce({ ok: false, error: intentError })
      .mockResolvedValueOnce(spokeIntent)
      .mockRejectedValueOnce(outOfUnion);
    vi.spyOn(sodax.spoke, 'verifyTxHash').mockResolvedValueOnce({ ok: true, value: true });
    mocks.relayTxAndWaitPacket.mockResolvedValueOnce({ ok: false, error: relayError });
    const run = () =>
      sodax.moneyMarket.repay({
        raw: false,
        params: repayParams(ChainKeys.BSC_MAINNET),
        walletProvider: mockEvmProvider,
      });

    expect(await run()).toEqual({ ok: false, error: intentError });
    expect(await run()).toMatchObject({
      ok: false,
      error: {
        code: 'RELAY_TIMEOUT',
        cause: relayError,
        context: { action: 'repay', srcTxHash: '0xspoke-tx' },
      },
    });
    expect(await run()).toMatchObject({
      ok: false,
      error: { code: 'EXECUTION_FAILED', cause: outOfUnion, context: { action: 'repay' } },
    });
  });
});

// =========================================================================
// build<Action>Data — pure helpers over ConfigService. We stub the config getters
// the helpers depend on and assert call-site shape rather than reproducing the
// EVM-encoding math (which is exercised by the static encoder tests above).
// Each success test walks one call per calldata branch, since they share one assertion.
// =========================================================================

type FakeHubAsset = { hubAsset: Address; vault: Address; decimals: number };
const fakeMoneyMarketToken = { address: '0xb000000000000000000000000000000000000003' as Address, decimals: 18 };
const wrappedSonic = sodax.config.spokeChainConfig[ChainKeys.SONIC_MAINNET].addresses.wrappedSonic as Address;

describe('MoneyMarketService.buildSupplyData', () => {
  const fakeHubAsset: FakeHubAsset = {
    hubAsset: '0xa000000000000000000000000000000000000001',
    vault: '0xa000000000000000000000000000000000000002',
    decimals: 18,
  };

  it('returns hex calldata whether or not the hub asset is itself a vault', () => {
    vi.spyOn(sodax.config, 'getSpokeTokenFromOriginalAssetAddress').mockReturnValue(fakeHubAsset as never);
    // Non-vault hub asset → extra approve+deposit calls; vault hub asset → no extra deposit step.
    vi.spyOn(sodax.config, 'isSodaVaultHubAsset').mockReturnValueOnce(false).mockReturnValueOnce(true);

    for (let i = 0; i < 2; i++) {
      const data = sodax.moneyMarket.buildSupplyData(ChainKeys.BSC_MAINNET, SAMPLE_EVM_TOKEN, 1_000_000n, HUB_WALLET);
      expect(data).toMatch(/^0x[0-9a-f]+$/i);
    }
  });

  it('throws (caught upstream) when the hub asset cannot be resolved', () => {
    vi.spyOn(sodax.config, 'getSpokeTokenFromOriginalAssetAddress').mockReturnValueOnce(undefined);

    expect(() => sodax.moneyMarket.buildSupplyData(ChainKeys.BSC_MAINNET, SAMPLE_EVM_TOKEN, 1n, HUB_WALLET)).toThrow(
      /hub asset not found/,
    );
  });
});

describe('MoneyMarketService.buildBorrowData', () => {
  const hubAsset = '0xb000000000000000000000000000000000000001' as Address;
  const vault = '0xb000000000000000000000000000000000000002' as Address;
  // A separate Sodax instance with a configured partnerFee reaches the fee-transfer branches.
  const sodaxWithFee = new Sodax({
    moneyMarket: {
      partnerFee: { address: '0x9999999999999999999999999999999999999999' as Address, percentage: 100 },
    },
  });

  it('returns hex calldata for every target / vault / partner-fee branch', () => {
    const cases: { service: Sodax; asset: FakeHubAsset; target: SpokeChainKey; vaultAsset: boolean }[] = [
      // hub target + wrappedSonic → withdrawTo path
      {
        service: sodax,
        asset: { hubAsset: wrappedSonic, vault, decimals: 18 },
        target: ChainKeys.SONIC_MAINNET,
        vaultAsset: false,
      },
      // hub target + other asset → Erc20 transfer branch
      { service: sodax, asset: { hubAsset, vault, decimals: 18 }, target: ChainKeys.SONIC_MAINNET, vaultAsset: false },
      // non-hub target → asset-manager transfer path
      { service: sodax, asset: { hubAsset, vault, decimals: 18 }, target: ChainKeys.BSC_MAINNET, vaultAsset: false },
      // bnUSD vault → bnUSD-specific path
      {
        service: sodax,
        asset: { hubAsset, vault: sodax.config.moneyMarket.bnUSDVault, decimals: 18 },
        target: ChainKeys.BSC_MAINNET,
        vaultAsset: false,
      },
      // toToken is itself a recognized vault → hub-asset decimals for the outgoing translation
      { service: sodax, asset: { hubAsset, vault, decimals: 18 }, target: ChainKeys.BSC_MAINNET, vaultAsset: true },
      // partner fee on the bnUSD-vault and the non-bnUSD-vault paths
      {
        service: sodaxWithFee,
        asset: { hubAsset, vault: sodaxWithFee.config.moneyMarket.bnUSDVault, decimals: 18 },
        target: ChainKeys.BSC_MAINNET,
        vaultAsset: false,
      },
      {
        service: sodaxWithFee,
        asset: { hubAsset, vault, decimals: 18 },
        target: ChainKeys.BSC_MAINNET,
        vaultAsset: false,
      },
    ];

    for (const { service, asset, target, vaultAsset } of cases) {
      vi.spyOn(service.config, 'getSpokeTokenFromOriginalAssetAddress').mockReturnValueOnce(asset as never);
      vi.spyOn(service.config, 'getMoneyMarketToken').mockReturnValueOnce(fakeMoneyMarketToken as never);
      vi.spyOn(service.config, 'isSodaVaultHubAsset').mockReturnValue(vaultAsset);

      const data = service.moneyMarket.buildBorrowData(
        HUB_WALLET,
        SAMPLE_DST_ADDRESS,
        SAMPLE_EVM_TOKEN,
        1_000_000n,
        target,
      );

      expect(data).toMatch(/^0x[0-9a-f]+$/i);
    }
  });

  it('throws when the target hub asset or the dst money-market token cannot be resolved', () => {
    const asset: FakeHubAsset = { hubAsset, vault, decimals: 18 };
    vi.spyOn(sodax.config, 'getSpokeTokenFromOriginalAssetAddress')
      .mockReturnValueOnce(undefined)
      .mockReturnValueOnce(asset as never);
    vi.spyOn(sodax.config, 'getMoneyMarketToken')
      .mockReturnValueOnce(fakeMoneyMarketToken as never)
      .mockReturnValueOnce(undefined);
    const build = () =>
      sodax.moneyMarket.buildBorrowData(HUB_WALLET, SAMPLE_DST_ADDRESS, SAMPLE_EVM_TOKEN, 1n, ChainKeys.BSC_MAINNET);

    expect(build).toThrow(/hub asset not found/);
    expect(build).toThrow(/Money market token not found/);
  });
});

describe('MoneyMarketService.buildWithdrawData', () => {
  const hubAsset = '0xc000000000000000000000000000000000000001' as Address;
  const vault = '0xc000000000000000000000000000000000000002' as Address;

  it('returns hex calldata for non-hub, hub (wrappedSonic and Erc20) and vault-token targets', () => {
    const cases: { asset: FakeHubAsset; target: SpokeChainKey; vaultAsset: boolean }[] = [
      { asset: { hubAsset, vault, decimals: 18 }, target: ChainKeys.BSC_MAINNET, vaultAsset: false },
      // hub target + wrappedSonic → withdrawTo branch
      { asset: { hubAsset: wrappedSonic, vault, decimals: 18 }, target: ChainKeys.SONIC_MAINNET, vaultAsset: false },
      // hub target + other asset → Erc20 transfer branch
      { asset: { hubAsset, vault, decimals: 18 }, target: ChainKeys.SONIC_MAINNET, vaultAsset: false },
      // target token is itself a recognized vault → skip-vault-withdraw branch
      { asset: { hubAsset, vault, decimals: 18 }, target: ChainKeys.BSC_MAINNET, vaultAsset: true },
    ];

    for (const { asset, target, vaultAsset } of cases) {
      vi.spyOn(sodax.config, 'getSpokeTokenFromOriginalAssetAddress').mockReturnValueOnce(asset as never);
      vi.spyOn(sodax.config, 'getMoneyMarketToken').mockReturnValueOnce(fakeMoneyMarketToken as never);
      vi.spyOn(sodax.config, 'isSodaVaultHubAsset').mockReturnValue(vaultAsset);

      const data = sodax.moneyMarket.buildWithdrawData(
        HUB_WALLET,
        SAMPLE_DST_ADDRESS,
        SAMPLE_EVM_TOKEN,
        1_000_000n,
        target,
      );

      expect(data).toMatch(/^0x[0-9a-f]+$/i);
    }
  });

  it('throws when the target hub asset cannot be resolved', () => {
    vi.spyOn(sodax.config, 'getSpokeTokenFromOriginalAssetAddress').mockReturnValueOnce(undefined);
    vi.spyOn(sodax.config, 'getMoneyMarketToken').mockReturnValueOnce(fakeMoneyMarketToken as never);

    expect(() =>
      sodax.moneyMarket.buildWithdrawData(HUB_WALLET, SAMPLE_DST_ADDRESS, SAMPLE_EVM_TOKEN, 1n, ChainKeys.BSC_MAINNET),
    ).toThrow(/hub asset not found/);
  });
});

describe('MoneyMarketService.buildRepayData', () => {
  const hubAsset = '0xd000000000000000000000000000000000000001' as Address;
  const vault = '0xd000000000000000000000000000000000000002' as Address;

  it('returns hex calldata for non-vault, vault and bnUSD-vault (incl. bnUSD vault as asset) hub assets', () => {
    const bnUSDVault = sodax.config.moneyMarket.bnUSDVault;
    const cases: { asset: FakeHubAsset; vaultAsset: boolean }[] = [
      // non-vault hub asset → extra approve+deposit calls
      { asset: { hubAsset, vault, decimals: 18 }, vaultAsset: false },
      // hub asset itself a recognized vault → skip the inner approve+deposit pair
      { asset: { hubAsset, vault, decimals: 18 }, vaultAsset: true },
      // bnUSD-debt repay path, then the bnUSD vault as the asset itself (no extra deposit step)
      { asset: { hubAsset, vault: bnUSDVault, decimals: 18 }, vaultAsset: false },
      { asset: { hubAsset: bnUSDVault, vault: bnUSDVault, decimals: 18 }, vaultAsset: false },
    ];

    for (const { asset, vaultAsset } of cases) {
      vi.spyOn(sodax.config, 'getSpokeTokenFromOriginalAssetAddress').mockReturnValueOnce(asset as never);
      vi.spyOn(sodax.config, 'isSodaVaultHubAsset').mockReturnValue(vaultAsset);

      const data = sodax.moneyMarket.buildRepayData(ChainKeys.BSC_MAINNET, SAMPLE_EVM_TOKEN, 1_000_000n, HUB_WALLET);

      expect(data).toMatch(/^0x[0-9a-f]+$/i);
    }
  });

  it('throws when the source hub asset cannot be resolved', () => {
    vi.spyOn(sodax.config, 'getSpokeTokenFromOriginalAssetAddress').mockReturnValueOnce(undefined);

    expect(() => sodax.moneyMarket.buildRepayData(ChainKeys.BSC_MAINNET, SAMPLE_EVM_TOKEN, 1n, HUB_WALLET)).toThrow(
      /hub asset not found/,
    );
  });
});

// =========================================================================
// Regression: SODA-on-Base spoke/hub address collision.
//
// Bug shape (pre-fix): buildBorrowData / buildWithdrawData called
//   isValidVault(toToken)
// where `toToken` is the user-facing SPOKE chain address. The predicate
// checks against the HUB-chain vault set, so for almost every token it
// returned false by coincidence. When a spoke address collided with a
// hub vault address (SODA on Base), it flipped to true and the
// vault-withdraw step was silently skipped → wrong hub calldata.
//
// Pinned invariant: the predicate is evaluated against the hub asset
// (toHubAsset.hubAsset), never against the spoke `toToken`. We assert
// this directly via an argument-capturing mock, plus the observable
// downstream effect (EvmVaultTokenService.encodeWithdraw was called
// with hub-side addresses — which under the bug would have been skipped).
// =========================================================================

describe('buildBorrowData / buildWithdrawData — spoke/hub address collision regression', () => {
  // A spoke-chain token address that, in the SODA-on-Base bug, also exists
  // in the hub vault set.
  const COLLIDING_SPOKE_TOKEN = '0xcafe0000000000000000000000000000000cafe1' as Address;
  // Hub-side addresses distinct from the colliding spoke address.
  const NON_VAULT_HUB_ASSET = '0xa110ca7ed0000000000000000000000000000001' as Address;
  const HUB_VAULT = '0xa110ca7ed0000000000000000000000000000002' as Address;

  const fakeHubAsset = {
    hubAsset: NON_VAULT_HUB_ASSET,
    vault: HUB_VAULT,
    decimals: 18,
  };
  const collisionMoneyMarketToken = {
    address: '0xa110ca7ed0000000000000000000000000000003' as Address,
    decimals: 18,
  };

  // isSodaVaultHubAsset returns true ONLY for the colliding spoke address.
  // With the fix: predicate is called with the hub asset → false → vault-withdraw emitted.
  // With the bug: predicate would be called with the spoke token → true → vault-withdraw skipped.
  it('the vault predicate checks the hub asset, never the spoke token, so vault-withdraw is emitted', () => {
    const predicateSpy = vi
      .spyOn(sodax.config, 'isSodaVaultHubAsset')
      .mockImplementation((addr: Address) => addr.toLowerCase() === COLLIDING_SPOKE_TOKEN.toLowerCase());
    const encodeWithdrawSpy = vi.spyOn(EvmVaultTokenService, 'encodeWithdraw');

    for (const method of ['buildBorrowData', 'buildWithdrawData'] as const) {
      vi.spyOn(sodax.config, 'getSpokeTokenFromOriginalAssetAddress').mockReturnValueOnce(fakeHubAsset as never);
      vi.spyOn(sodax.config, 'getMoneyMarketToken').mockReturnValueOnce(collisionMoneyMarketToken as never);
      predicateSpy.mockClear();
      encodeWithdrawSpy.mockClear();

      sodax.moneyMarket[method](
        HUB_WALLET,
        SAMPLE_DST_ADDRESS,
        COLLIDING_SPOKE_TOKEN,
        1_000_000n,
        ChainKeys.BSC_MAINNET,
      );

      expect(predicateSpy, method).toHaveBeenCalled();
      for (const [arg] of predicateSpy.mock.calls) {
        expect(arg.toLowerCase(), method).toBe(NON_VAULT_HUB_ASSET.toLowerCase());
      }
      expect(encodeWithdrawSpy, method).toHaveBeenCalledWith(HUB_VAULT, NON_VAULT_HUB_ASSET, expect.any(BigInt));
    }
  });
});

// =========================================================================
// hub-only actions still verify the source tx (they return before `settle`, which verifies spokes)
// =========================================================================

describe('MoneyMarketService — hub-only actions verify the source tx', () => {
  const HUB = ChainKeys.SONIC_MAINNET;
  const intent = {
    ok: true as const,
    value: { tx: '0xhub-tx', relayData: { address: HUB_WALLET, payload: '0x' as const } },
  };

  const cases = [
    {
      action: 'supply',
      stub: () => vi.spyOn(sodax.moneyMarket, 'createSupplyIntent').mockResolvedValueOnce(intent),
      run: () => sodax.moneyMarket.supply({ raw: false, params: supplyParams(HUB), walletProvider: mockEvmProvider }),
    },
    {
      action: 'borrow',
      stub: () => vi.spyOn(sodax.moneyMarket, 'createBorrowIntent').mockResolvedValueOnce(intent),
      run: () => sodax.moneyMarket.borrow({ raw: false, params: borrowParams(HUB), walletProvider: mockEvmProvider }),
    },
    {
      action: 'withdraw',
      stub: () => vi.spyOn(sodax.moneyMarket, 'createWithdrawIntent').mockResolvedValueOnce(intent),
      run: () =>
        sodax.moneyMarket.withdraw({ raw: false, params: withdrawParams(HUB), walletProvider: mockEvmProvider }),
    },
    {
      action: 'repay',
      stub: () => vi.spyOn(sodax.moneyMarket, 'createRepayIntent').mockResolvedValueOnce(intent),
      run: () => sodax.moneyMarket.repay({ raw: false, params: repayParams(HUB), walletProvider: mockEvmProvider }),
    },
  ];

  it('supply, borrow, withdraw and repay verify the hub tx and surface a verification failure', async () => {
    const verifyError = new Error('VERIFY_FAILED');
    const verifySpy = vi.spyOn(sodax.spoke, 'verifyTxHash').mockResolvedValue({ ok: false, error: verifyError });

    for (const { action, stub, run } of cases) {
      stub();
      verifySpy.mockClear();

      const result = await run();

      expect(verifySpy, action).toHaveBeenCalledWith({ txHash: '0xhub-tx', chainKey: HUB });
      const error = expectErr(result, 'TX_VERIFICATION_FAILED', { action }, action);
      expect(error.cause, action).toBe(verifyError);
    }
    expect(mocks.relayTxAndWaitPacket).not.toHaveBeenCalled();
  });
});

describe('MoneyMarketService — outbound result by source chain', () => {
  const relayData = { address: HUB_WALLET, payload: '0x01' } as const;
  const walletProvider = {} as never;
  const runOutbound = (action: 'borrow' | 'withdraw', chainKey: SpokeChainKey, tx: string) => {
    vi.spyOn(
      sodax.moneyMarket,
      action === 'borrow' ? 'createBorrowIntent' : 'createWithdrawIntent',
    ).mockResolvedValueOnce({ ok: true, value: { tx, relayData } });
    return action === 'borrow'
      ? sodax.moneyMarket.borrow({ raw: false, params: borrowParams(chainKey), walletProvider })
      : sodax.moneyMarket.withdraw({ raw: false, params: withdrawParams(chainKey), walletProvider });
  };

  it('a settlement timeout keeps only the Bitcoin relay ID, or the MPC-relay original tracking ID', async () => {
    const cause = new Error('RELAY_TIMEOUT');
    vi.spyOn(sodax.spoke, 'settle').mockResolvedValue({ ok: false, error: { phase: 'relay', cause } });

    const signature = 'private-authorization-fixture';
    const bitcoinTx = JSON.stringify({ payload_hex: '0x1234', signature });
    for (const action of ['borrow', 'withdraw'] as const) {
      const result = await runOutbound(action, ChainKeys.BITCOIN_MAINNET, bitcoinTx);

      expect(result, action).toMatchObject({
        ok: false,
        error: { code: 'RELAY_TIMEOUT', context: { srcTxHash: expect.stringMatching(/^od:[a-f0-9]{64}$/) } },
      });
      const serialized = JSON.stringify(result);
      expect(serialized, action).not.toContain(signature);
      expect(serialized, action).not.toContain('payload_hex');
    }

    const trackingId = '0xoriginal';
    const mpcCases = [
      ['borrow', ChainKeys.TRON_MAINNET],
      ['withdraw', ChainKeys.XRP_MAINNET],
    ] as const;
    for (const [action, chainKey] of mpcCases) {
      const label = `${action} on ${chainKey}`;
      const error = expectErr(await runOutbound(action, chainKey, trackingId), 'RELAY_TIMEOUT', undefined, label);

      expect(error, label).toMatchObject({ cause, context: { trackingId, srcChainKey: chainKey, relayData } });
      expect(error.context, label).not.toHaveProperty('srcTxHash');
    }
  });
});

describe('MoneyMarketService — small payout to an MPC-relay chain', () => {
  const usdt = {
    address: tronSupportedTokens.USDT.address,
    chainKey: ChainKeys.TRON_MAINNET,
    symbol: 'USDT',
    decimals: 6,
    vault: tronSupportedTokens.USDT.vault,
  };

  const setup = () => {
    vi.spyOn(sodax.config, 'getMoneyMarketToken').mockReturnValue(usdt as never);
    vi.spyOn(sodax.moneyMarket.data, 'getReserveData').mockResolvedValue(reserveData(BORROWABLE_RESERVE));
    vi.spyOn(sodax.config, 'isMoneyMarketSupportedToken').mockReturnValue(true);
    vi.spyOn(sodax.moneyMarket, 'buildWithdrawData').mockReturnValue('0xwithdraw-data');
    return vi.spyOn(sodax.spoke, 'sendMessage').mockResolvedValue({ ok: true, value: '0xsend-hash' });
  };
  const run = (method: 'createBorrowIntent' | 'createWithdrawIntent', amount: bigint, raw: boolean) =>
    sodax.moneyMarket[method]({
      raw,
      ...(raw ? {} : { walletProvider: mockEvmProvider }),
      params: {
        ...borrowParams(ChainKeys.BSC_MAINNET),
        action: method === 'createBorrowIntent' ? 'borrow' : 'withdraw',
        token: usdt.address,
        amount,
        dstChainKey: ChainKeys.TRON_MAINNET,
        dstAddress: TRON_TEST_ADDRESS,
      },
    } as never);
  // The floor check runs before the raw/exec split, so each method needs one raw mode.
  const cases = [
    ['createBorrowIntent', false],
    ['createWithdrawIntent', true],
  ] as const;

  it('refuses the minimum (before signing) and accepts above it, on direct builds and both intents', async () => {
    const service = new Sodax({ logger: 'silent' }).moneyMarket;
    const build = (amount: bigint) =>
      service.buildWithdrawData(HUB_WALLET, SAMPLE_DST_ADDRESS, usdt.address, amount, ChainKeys.TRON_MAINNET);
    expect(() => build(3_000_000n)).toThrow(/must be greater than 3 USDT/);
    expect(build(3_000_001n)).toMatch(/^0x[0-9a-f]+$/i);

    const send = setup();
    for (const [method, raw] of cases) {
      const label = `${method} (raw: ${raw})`;
      send.mockClear();

      const error = expectErr(
        await run(method, 3_000_000n, raw),
        'VALIDATION_FAILED',
        { reason: 'mpc-payout-below-minimum' },
        label,
      );

      expect(error.message, label).toContain('must be greater than 3 USDT');
      expect(send, label).not.toHaveBeenCalled();
      expectOk(await run(method, 3_000_001n, raw), label);
      expect(send, label).toHaveBeenCalledTimes(1);
    }
  });

  it('checks a borrow on what it pays out after the partner fee', async () => {
    const send = setup();
    vi.spyOn(sodax.moneyMarket, 'partnerFee', 'get').mockReturnValue({
      address: '0x9999999999999999999999999999999999999999',
      percentage: 1_000,
    });

    // 10% off 3.1 USDT leaves 2.79, under the 3 USDT floor; off 3.4 USDT it leaves 3.06.
    expectErr(await run('createBorrowIntent', 3_100_000n, true), undefined, { reason: 'mpc-payout-below-minimum' });
    expectOk(await run('createBorrowIntent', 3_400_000n, true));
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('checks an XRPL borrow recipient on what arrives after the partner fee', async () => {
    vi.spyOn(sodax.moneyMarket, 'partnerFee', 'get').mockReturnValue({
      address: '0x9999999999999999999999999999999999999999',
      percentage: 1_000,
    });
    const check = vi
      .spyOn(sodax.spoke.xrp, 'checkDestination')
      .mockResolvedValue({ ready: false, reason: 'account_not_found' });

    await sodax.moneyMarket.createBorrowIntent({
      raw: true,
      params: {
        ...borrowParams(ChainKeys.BSC_MAINNET),
        token: spokeChainConfig[ChainKeys.XRP_MAINNET].supportedTokens.XRP.address,
        dstChainKey: ChainKeys.XRP_MAINNET,
        dstAddress: XRPL_RECIPIENT.address,
      },
    });

    // 10% off 1 XRP: a missing account would be sent 0.9 XRP, which is what must clear its reserve.
    expect(check).toHaveBeenCalledWith(expect.objectContaining({ amount: 900_000n }));
  });
});
