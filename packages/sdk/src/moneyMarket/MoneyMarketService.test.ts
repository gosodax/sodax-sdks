/**
 * Tests for the strongly-typed MoneyMarketService public API.
 *
 * Mirrors the shape of SwapService.test.ts:
 *
 *   1. `srcChainKey: K extends SpokeChainKey` is the generic anchor on every params object —
 *      it narrows the associated `walletProvider` via `GetWalletProviderType<K>`.
 *   2. `walletProvider` is required on exec methods (`supply`, `borrow`, `withdraw`, `repay`,
 *      `create*Intent`, `approve`). Use `{ raw: true }` for raw transaction payloads (no walletProvider); `{ raw: false, walletProvider }` for exec.
 *   3. Every test runs against a single module-scope `new Sodax()`. Static collaborators
 *      (IntentRelayApiService) are mocked at their source paths via `vi.mock`; instance methods
 *      on the real `sodax.hubProvider`, `sodax.spoke`, and `sodax.config` are stubbed
 *      per-test with `vi.spyOn(...).mockResolvedValueOnce(...)`.
 */
import { afterEach, beforeEach, describe, expect, expectTypeOf, it, vi } from 'vitest';
import {
  ChainKeys,
  IndeterminateOutcomeError,
  spokeChainConfig,
  type Address,
  type IBitcoinWalletProvider,
  type IEvmWalletProvider,
  type ISolanaWalletProvider,
  type IStellarWalletProvider,
  type Result,
  type SpokeChainKey,
  tronSupportedTokens,
  type XToken,
} from '@sodax/types';
import type { XrpDestinationReadiness } from '../shared/services/spoke/XrpSpokeService.js';
import { Sodax } from '../shared/entities/Sodax.js';
import type { MpcWithdrawalSettlement, TxHashPair } from '../shared/types/types.js';
import { SodaxError } from '../errors/SodaxError.js';
import { decodeFunctionData, keccak256, stringToBytes } from 'viem';
import { poolAbi } from '../shared/abis/pool.abi.js';
import { EvmVaultTokenService } from '../shared/services/hub/EvmVaultTokenService.js';

// MoneyMarketService now calls `getUserHubWalletAddress` / `getUserRouter` as instance methods on
// `sodax.hubProvider`. We keep `vi.fn()` stubs in `vi.hoisted` so per-test
// `.mockResolvedValueOnce(...)` and `.mockReset()` calls keep working, and bind them via
// `vi.spyOn` in `beforeEach`. `relayTxAndWaitPacket` is still a static import — mocked at source.
const mocks = vi.hoisted(() => ({
  getUserHubWalletAddress: vi.fn(),
  getUserRouter: vi.fn(),
  relayTxAndWaitPacket: vi.fn(),
}));
// Partial mock — IntentRelayApiService also exports types we want to keep intact.
vi.mock('../shared/services/intentRelay/IntentRelayApiService.js', async () => {
  const actual = await vi.importActual<object>('../shared/services/intentRelay/IntentRelayApiService.js');
  return {
    ...actual,
    relayTxAndWaitPacket: mocks.relayTxAndWaitPacket,
  };
});

import {
  MoneyMarketService,
  type MoneyMarketBorrowActionParams,
  type MoneyMarketBorrowParams,
  type MoneyMarketRepayActionParams,
  type MoneyMarketRepayParams,
  type MoneyMarketSupplyActionParams,
  type MoneyMarketSupplyParams,
  type MoneyMarketWithdrawActionParams,
  type MoneyMarketWithdrawParams,
} from './MoneyMarketService.js';
import { TRON_TEST_ADDRESS, TRON_TEST_RECIPIENT_WORD } from '../shared/services/spoke/tron-test-fixtures.js';
import type { ReserveDataLegacy } from './MoneyMarketTypes.js';

// --- test fixtures --------------------------------------------------------
//
// One real Sodax instance backs every test in the file. `new Sodax()` wires up the full
// dependency graph — we never stub the wiring, only the leaves (collaborators reached via
// static imports get vi.mock; instance methods on the real services get vi.spyOn per test).

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
const RESERVE_FROZEN = 1n << 57n;
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

// MPC-relay accounts and the recipient each becomes on the hub. `encodeAddress` yields the bare 20-byte
// identity (what derives the hub wallet); `encodeRecipient` left-pads it to the 32-byte word a non-EVM
// release expects, and leaves an EVM (Monad) recipient as a plain address, which is what its release pays.
const MPC_RECIPIENTS = [
  {
    chainKey: ChainKeys.TRON_MAINNET,
    address: TRON_TEST_ADDRESS,
    word: TRON_TEST_RECIPIENT_WORD,
  },
  {
    chainKey: ChainKeys.XRP_MAINNET,
    address: 'rBTwLga3i2gz3doX6Gva3MgEV8ZCD8jjah',
    word: `0x${'00'.repeat(12)}72a3de6b0973062d5f2fe77383ef02f0c17901ab` as Address,
  },
  {
    chainKey: ChainKeys.MONAD_MAINNET,
    address: '0x6be3a4afbd5983604385bcba71aaa3645918e2e2',
    word: '0x6be3a4afbd5983604385bcba71aaa3645918e2e2' as Address,
  },
] as const;

type XrpRefusal = Extract<XrpDestinationReadiness, { ready: false }>['reason'];

// Every reason an XRPL destination can refuse a release, with the message borrow and withdraw report;
// typed against the reason union so a new reason cannot go unchecked here.
const XRPL_REFUSALS = Object.entries({
  account_not_found: /does not exist/,
  destination_tag_required: /requires a destination tag/,
  deposit_auth: /Deposit Authorization/,
  issuer_frozen: /globally frozen/,
  issuer_transfer_fee: /transfer fee/,
  no_trustline: /no trustline/,
  trustline_unauthorized: /not yet authorized/,
  trustline_frozen: /deep-frozen/,
  trustline_limit: /trustline limit/,
} satisfies Record<XrpRefusal, RegExp>) as [XrpRefusal, RegExp][];

// Wallet provider fakes — shape-only; the bodies are never invoked at runtime because
// every spoke method that would touch them is stubbed.
const mockEvmProvider = {
  chainType: 'EVM',
  sendTransaction: vi.fn(),
  getWalletAddress: vi.fn(),
  waitForTransactionReceipt: vi.fn(),
} as unknown as IEvmWalletProvider;
const mockSolanaProvider = {
  chainType: 'SOLANA',
  sendTransaction: vi.fn(),
  getWalletAddress: vi.fn(),
} as unknown as ISolanaWalletProvider;
const mockStellarProvider = {
  chainType: 'STELLAR',
  getWalletAddress: vi.fn(),
  signTransaction: vi.fn(),
} as unknown as IStellarWalletProvider;
const mockBitcoinProvider = {
  chainType: 'BITCOIN',
  getWalletAddress: vi.fn(),
  signMessage: vi.fn(),
} as unknown as IBitcoinWalletProvider;

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
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

const failureText = (result: Result<unknown, unknown>): string => (result.ok ? 'ok' : String(result.error));

// Shared invalid-input table for the create*Intent invariants (action / token / amount / walletProvider).
// Each row overrides the base params (and optionally the provider) and names the invariant message it must hit.
type InvalidInput = {
  params: { action?: never; token?: string; amount?: bigint };
  walletProvider?: IEvmWalletProvider;
  message: RegExp;
};
const INVALID_INPUTS: InvalidInput[] = [
  { params: { action: 'other' as never }, message: /Invalid action/ },
  { params: { token: '' }, message: /Token is required/ },
  { params: { amount: 0n }, message: /Amount must be greater than 0/ },
  // Defeat the compile-time narrowing to reach the runtime invariant.
  {
    params: {},
    walletProvider: mockSolanaProvider as unknown as IEvmWalletProvider,
    message: /Invalid wallet provider/,
  },
];

// =========================================================================
// Type-level tests — verified at compile time. The test passes if it type-checks.
// Wrapping the call sites in `if (false as boolean)` ensures the bodies never execute.
// =========================================================================

describe('MoneyMarketService types', () => {
  it('action params narrow walletProvider via K, raw twins drop it, and each carries its `action` literal', () => {
    expectTypeOf<
      MoneyMarketSupplyActionParams<'0x38.bsc', false>['walletProvider']
    >().toEqualTypeOf<IEvmWalletProvider>();
    expectTypeOf<MoneyMarketSupplyActionParams<'sonic', false>['walletProvider']>().toEqualTypeOf<IEvmWalletProvider>();
    expectTypeOf<
      MoneyMarketSupplyActionParams<'solana', false>['walletProvider']
    >().toEqualTypeOf<ISolanaWalletProvider>();
    expectTypeOf<
      MoneyMarketSupplyActionParams<'stellar', false>['walletProvider']
    >().toEqualTypeOf<IStellarWalletProvider>();
    expectTypeOf<
      MoneyMarketSupplyActionParams<'bitcoin', false>['walletProvider']
    >().toEqualTypeOf<IBitcoinWalletProvider>();
    expectTypeOf<
      MoneyMarketBorrowActionParams<'0x38.bsc', false>['walletProvider']
    >().toEqualTypeOf<IEvmWalletProvider>();
    expectTypeOf<
      MoneyMarketWithdrawActionParams<'solana', false>['walletProvider']
    >().toEqualTypeOf<ISolanaWalletProvider>();
    expectTypeOf<
      MoneyMarketRepayActionParams<'stellar', false>['walletProvider']
    >().toEqualTypeOf<IStellarWalletProvider>();

    expectTypeOf<MoneyMarketSupplyActionParams<'0x38.bsc', true>>()
      .toHaveProperty('walletProvider')
      .toEqualTypeOf<undefined>();
    expectTypeOf<MoneyMarketBorrowActionParams<'solana', true>>()
      .toHaveProperty('walletProvider')
      .toEqualTypeOf<undefined>();
    expectTypeOf<MoneyMarketWithdrawActionParams<'stellar', true>>()
      .toHaveProperty('walletProvider')
      .toEqualTypeOf<undefined>();
    expectTypeOf<MoneyMarketRepayActionParams<'bitcoin', true>>()
      .toHaveProperty('walletProvider')
      .toEqualTypeOf<undefined>();

    expectTypeOf<MoneyMarketSupplyParams['action']>().toEqualTypeOf<'supply'>();
    expectTypeOf<MoneyMarketBorrowParams['action']>().toEqualTypeOf<'borrow'>();
    expectTypeOf<MoneyMarketWithdrawParams['action']>().toEqualTypeOf<'withdraw'>();
    expectTypeOf<MoneyMarketRepayParams['action']>().toEqualTypeOf<'repay'>();
  });

  it('method call sites require the chain-matching walletProvider on exec and forbid it on raw', () => {
    const mm = sodax.moneyMarket;
    if (false as boolean) {
      void mm.supply({ raw: false, params: supplyParams(ChainKeys.BSC_MAINNET), walletProvider: mockEvmProvider });
      void mm.supply({
        raw: false,
        params: supplyParams(ChainKeys.BSC_MAINNET),
        // @ts-expect-error — Solana provider mismatched on EVM chain.
        walletProvider: mockSolanaProvider,
      });
      void mm.borrow({
        raw: false,
        params: borrowParams(ChainKeys.SOLANA_MAINNET),
        walletProvider: mockSolanaProvider,
      });
      void mm.borrow({
        raw: false,
        params: borrowParams(ChainKeys.SOLANA_MAINNET),
        // @ts-expect-error — EVM provider mismatched on Solana chain.
        walletProvider: mockEvmProvider,
      });
      void mm.withdraw({
        raw: false,
        params: withdrawParams(ChainKeys.STELLAR_MAINNET),
        walletProvider: mockStellarProvider,
      });
      void mm.withdraw({
        raw: false,
        params: withdrawParams(ChainKeys.STELLAR_MAINNET),
        // @ts-expect-error — EVM provider mismatched on Stellar chain.
        walletProvider: mockEvmProvider,
      });
      void mm.repay({
        raw: false,
        params: repayParams(ChainKeys.BITCOIN_MAINNET),
        walletProvider: mockBitcoinProvider,
      });
      void mm.repay({
        raw: false,
        params: repayParams(ChainKeys.BITCOIN_MAINNET),
        // @ts-expect-error — EVM provider mismatched on Bitcoin chain.
        walletProvider: mockEvmProvider,
      });
      void mm.createSupplyIntent({ raw: true, params: supplyParams(ChainKeys.BSC_MAINNET) });
      void mm.approve({ raw: true, params: supplyParams(ChainKeys.BSC_MAINNET) });
      // @ts-expect-error — walletProvider required on exec.
      void mm.supply({ raw: false, params: supplyParams(ChainKeys.BSC_MAINNET) });
      // @ts-expect-error — walletProvider required on exec.
      void mm.createBorrowIntent({ raw: false, params: borrowParams(ChainKeys.SOLANA_MAINNET) });
    }
  });
});

// =========================================================================
// Info getters — pure delegations to ConfigService.
// =========================================================================

describe('MoneyMarketService info getters', () => {
  it('delegate getSupportedTokensByChainId / getSupportedTokens / getSupportedReserves to ConfigService', () => {
    const fakeTokens = [{ symbol: 'USDC' }] as never;
    const fakeAll = { [ChainKeys.BSC_MAINNET]: [] } as never;
    const fakeReserves = ['0xa', '0xb'] as never;
    const byChainSpy = vi.spyOn(sodax.config, 'getSupportedMoneyMarketTokensByChainId').mockReturnValueOnce(fakeTokens);
    const allSpy = vi.spyOn(sodax.config, 'getSupportedMoneyMarketTokens').mockReturnValueOnce(fakeAll);
    const reservesSpy = vi.spyOn(sodax.config, 'getMoneyMarketReserveAssets').mockReturnValueOnce(fakeReserves);

    expect(sodax.moneyMarket.getSupportedTokensByChainId(ChainKeys.BSC_MAINNET)).toBe(fakeTokens);
    expect(byChainSpy).toHaveBeenCalledWith(ChainKeys.BSC_MAINNET);
    expect(sodax.moneyMarket.getSupportedTokens()).toBe(fakeAll);
    expect(allSpy).toHaveBeenCalled();
    expect(sodax.moneyMarket.getSupportedReserves()).toBe(fakeReserves);
    expect(reservesSpy).toHaveBeenCalled();
  });
});

// =========================================================================
// estimateGas — thin wrapper around SpokeService.estimateGas.
// =========================================================================

describe('MoneyMarketService.estimateGas', () => {
  it('delegates to spoke.estimateGas and returns the Result', async () => {
    const ok = { ok: true as const, value: { gas: 21_000n } as never };
    const spy = vi.spyOn(sodax.spoke, 'estimateGas').mockResolvedValueOnce(ok);
    const params = { chainKey: ChainKeys.BSC_MAINNET } as never;

    const result = await sodax.moneyMarket.estimateGas(params);

    expect(result).toBe(ok);
    expect(spy).toHaveBeenCalledWith(params);
  });

  it('wraps a failure Result as MM_GAS_ESTIMATION_FAILED with cause', async () => {
    const inner = new Error('GAS_FAILED');
    vi.spyOn(sodax.spoke, 'estimateGas').mockResolvedValueOnce({ ok: false, error: inner });

    const result = await sodax.moneyMarket.estimateGas({ chainKey: ChainKeys.BSC_MAINNET } as never);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('GAS_ESTIMATION_FAILED');
    expect(result.error.cause).toBe(inner);
    expect(result.error.context?.phase).toBe('gasEstimation');
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

  describe('rejects on invalid inputs', () => {
    it('rejects a zero amount and an empty token', async () => {
      const zero = await sodax.moneyMarket.isAllowanceValid({
        params: { ...supplyParams(ChainKeys.BSC_MAINNET), amount: 0n },
      });
      const noToken = await sodax.moneyMarket.isAllowanceValid({
        params: { ...supplyParams(ChainKeys.BSC_MAINNET), token: '' },
      });

      expect(failureText(zero)).toMatch(/Amount must be greater than 0/);
      expect(failureText(noToken)).toMatch(/Token is required/);
    });

    it('rejects a token unsupported on srcChain (supply) or on dstChainKey (withdraw, default = srcChain)', async () => {
      vi.spyOn(sodax.config, 'isMoneyMarketSupportedToken').mockReturnValue(false);

      const supply = await sodax.moneyMarket.isAllowanceValid({ params: supplyParams(ChainKeys.BSC_MAINNET) });
      const withdraw = await sodax.moneyMarket.isAllowanceValid({ params: withdrawParams(ChainKeys.BSC_MAINNET) });

      expect(failureText(supply)).toMatch(/Unsupported spoke chain/);
      expect(failureText(withdraw)).toMatch(/Unsupported spoke chain/);
    });
  });

  describe('propagates internal errors', () => {
    it('returns ok:false when hubProvider.getUserRouter rejects or spoke.isAllowanceValid throws', async () => {
      const routerError = new Error('ROUTER_LOOKUP_FAILED');
      const rpcError = new Error('RPC_DOWN');
      mocks.getUserRouter.mockRejectedValueOnce(routerError);
      vi.spyOn(sodax.spoke, 'isAllowanceValid').mockRejectedValueOnce(rpcError);

      const hub = await sodax.moneyMarket.isAllowanceValid({ params: supplyParams(ChainKeys.SONIC_MAINNET) });
      const spoke = await sodax.moneyMarket.isAllowanceValid({ params: supplyParams(ChainKeys.BSC_MAINNET) });

      expect(hub).toMatchObject({ ok: false, error: expect.objectContaining({ message: routerError.message }) });
      expect(spoke).toMatchObject({ ok: false, error: expect.objectContaining({ message: rpcError.message }) });
    });

    it('forwards a failure Result from spoke.isAllowanceValid (EVM-spoke supply path)', async () => {
      const allowanceError = new Error('ALLOWANCE_CHECK_FAILED');
      vi.spyOn(sodax.spoke, 'isAllowanceValid').mockResolvedValueOnce({
        ok: false,
        error: allowanceError,
      });

      const result = await sodax.moneyMarket.isAllowanceValid({
        params: supplyParams(ChainKeys.BSC_MAINNET),
      });

      expect(result).toMatchObject({ ok: false, error: expect.objectContaining({ message: allowanceError.message }) });
    });

    it('forwards a failure Result from the src trustline lookup (Stellar src+dst path)', async () => {
      const trustlineError = new Error('TRUSTLINE_FAILED');
      vi.spyOn(sodax.spoke, 'isAllowanceValid')
        .mockResolvedValueOnce({ ok: true, value: true })
        .mockResolvedValueOnce({ ok: false, error: trustlineError });

      const result = await sodax.moneyMarket.isAllowanceValid({
        params: {
          ...supplyParams(ChainKeys.STELLAR_MAINNET),
          dstChainKey: ChainKeys.STELLAR_MAINNET,
          dstAddress: SAMPLE_DST_ADDRESS,
        },
      });

      expect(result).toMatchObject({ ok: false, error: expect.objectContaining({ message: trustlineError.message }) });
    });
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

    expect(result.ok).toBe(true);
    expect(rawResult.ok).toBe(true);
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
    expect(rawResult.ok).toBe(true);
  });

  describe('rejects on invalid inputs', () => {
    it('rejects a zero amount, an empty token and a non-address token on the hub path', async () => {
      const cases: [MoneyMarketSupplyParams<typeof ChainKeys.SONIC_MAINNET | typeof ChainKeys.BSC_MAINNET>, RegExp][] =
        [
          [{ ...supplyParams(ChainKeys.BSC_MAINNET), amount: 0n }, /Amount must be greater than 0/],
          [{ ...supplyParams(ChainKeys.BSC_MAINNET), token: '' }, /Token is required/],
          [{ ...supplyParams(ChainKeys.SONIC_MAINNET), token: 'not-an-address' }, /Invalid token address/],
        ];
      for (const [params, message] of cases) {
        const result = await sodax.moneyMarket.approve({ raw: false, params, walletProvider: mockEvmProvider });
        expect(failureText(result)).toMatch(message);
      }
    });

    it('rejects when walletProvider chainType does not match srcChain', async () => {
      const result = await sodax.moneyMarket.approve({
        raw: false,
        params: supplyParams(ChainKeys.BSC_MAINNET),
        // Defeat the compile-time narrowing to reach the runtime invariant.
        walletProvider: mockSolanaProvider as unknown as IEvmWalletProvider,
      });
      expect(failureText(result)).toMatch(/Invalid wallet provider for chain key/);
    });

    it('rejects withdraw on EVM (only supply / repay require approval on EVM)', async () => {
      const result = await sodax.moneyMarket.approve({
        raw: false,
        params: withdrawParams(ChainKeys.BSC_MAINNET),
        walletProvider: mockEvmProvider,
      });
      expect(failureText(result)).toMatch(/Invalid action/);
    });

    it('rejects on a non-supported chain type (e.g. Solana goes to the unsupported-chain error)', async () => {
      const result = await sodax.moneyMarket.approve({
        raw: false,
        params: supplyParams(ChainKeys.SOLANA_MAINNET),
        walletProvider: mockSolanaProvider,
      });
      expect(failureText(result)).toMatch(/Approve only supported/);
    });
  });

  describe('propagates internal errors', () => {
    it('returns ok:false when hubProvider.getUserRouter rejects or spoke.approve throws', async () => {
      const routerError = new Error('ROUTER_LOOKUP_FAILED');
      const thrown = new Error('APPROVE_THREW');
      mocks.getUserRouter.mockRejectedValueOnce(routerError);
      vi.spyOn(sodax.spoke, 'approve').mockRejectedValueOnce(thrown);

      const hub = await sodax.moneyMarket.approve({
        raw: false,
        params: supplyParams(ChainKeys.SONIC_MAINNET),
        walletProvider: mockEvmProvider,
      });
      const spoke = await sodax.moneyMarket.approve({
        raw: false,
        params: supplyParams(ChainKeys.BSC_MAINNET),
        walletProvider: mockEvmProvider,
      });

      expect(hub).toMatchObject({ ok: false, error: expect.objectContaining({ message: routerError.message }) });
      expect(spoke).toMatchObject({ ok: false, error: expect.objectContaining({ message: thrown.message }) });
    });

    it('forwards a failure Result from spoke.approve on the hub and EVM-spoke paths', async () => {
      const approveError = new Error('APPROVE_REJECTED');
      vi.spyOn(sodax.spoke, 'approve').mockResolvedValue({ ok: false, error: approveError });

      const hub = await sodax.moneyMarket.approve({ raw: true, params: supplyParams(ChainKeys.SONIC_MAINNET) });
      const spoke = await sodax.moneyMarket.approve({
        raw: false,
        params: supplyParams(ChainKeys.BSC_MAINNET),
        walletProvider: mockEvmProvider,
      });

      for (const result of [hub, spoke]) {
        expect(result).toMatchObject({ ok: false, error: expect.objectContaining({ message: approveError.message }) });
      }
    });
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

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.tx).toBe('0xdeposit-hash');
        expect(result.value.relayData).toEqual({ address: HUB_WALLET, payload: '0xsupply-data' });
      }
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

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.tx).toBe(rawTx);
        expect(result.value.relayData).toEqual({ address: HUB_WALLET, payload: '0xsupply-data' });
      }
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

      expect(result.ok).toBe(true);
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

  describe('rejects on invalid inputs', () => {
    it('rejects a wrong action, empty token, zero amount or mismatched walletProvider', async () => {
      for (const { params, walletProvider, message } of INVALID_INPUTS) {
        const result = await sodax.moneyMarket.createSupplyIntent({
          raw: false,
          params: { ...supplyParams(ChainKeys.BSC_MAINNET), ...params },
          walletProvider: walletProvider ?? mockEvmProvider,
        });
        expect(failureText(result)).toMatch(message);
      }
    });

    it('on Bitcoin (non-raw): rejects a missing wallet provider before building any tx', async () => {
      // A non-raw Bitcoin deposit MUST sign via a Bitcoin wallet provider; `undefined` slips past the generic
      // walletProvider check, so this guard fails it fast. Collaborators are no-op mocks so a guard regression
      // can never reach a real deposit/tx (which costs money).
      const getEffSpy = vi.spyOn(sodax.spoke.bitcoin, 'getEffectiveWalletAddress').mockResolvedValue('bc1p-trading');
      const depositSpy = vi.spyOn(sodax.spoke, 'deposit').mockResolvedValue({ ok: true, value: '0xunused' });

      const result = await sodax.moneyMarket.createSupplyIntent({
        raw: false,
        params: supplyParams(ChainKeys.BITCOIN_MAINNET),
        // Deliberate cast: the guard under test is exactly the missing-provider case.
        walletProvider: undefined as unknown as IBitcoinWalletProvider,
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('VALIDATION_FAILED');
        expect(result.error.context?.field).toBe('walletProvider');
        expect(String(result.error)).toMatch(/Expected bitcoin wallet provider/);
      }
      // fail-fast: no trading-address resolution, no deposit/tx built
      expect(getEffSpy).not.toHaveBeenCalled();
      expect(depositSpy).not.toHaveBeenCalled();
    });

    it('rejects unsupported token on srcChain', async () => {
      vi.spyOn(sodax.config, 'isMoneyMarketSupportedToken').mockReturnValueOnce(false);

      const result = await sodax.moneyMarket.createSupplyIntent({
        raw: false,
        params: supplyParams(ChainKeys.BSC_MAINNET),
        walletProvider: mockEvmProvider,
      });
      expect(failureText(result)).toMatch(/Unsupported spoke chain/);
    });
  });

  describe('propagates internal errors', () => {
    it('returns ok:false when hubProvider.getUserHubWalletAddress rejects or spoke.deposit throws', async () => {
      vi.spyOn(sodax.moneyMarket, 'buildSupplyData').mockReturnValue('0xsupply-data');
      const hubError = new Error('HUB_LOOKUP_FAILED');
      const thrown = new Error('DEPOSIT_THREW');
      mocks.getUserHubWalletAddress.mockReset();
      mocks.getUserHubWalletAddress.mockRejectedValueOnce(hubError).mockResolvedValue(HUB_WALLET);
      vi.spyOn(sodax.spoke, 'deposit').mockRejectedValueOnce(thrown);
      const run = () =>
        sodax.moneyMarket.createSupplyIntent({
          raw: false,
          params: supplyParams(ChainKeys.BSC_MAINNET),
          walletProvider: mockEvmProvider,
        });

      expect(await run()).toMatchObject({ ok: false, error: expect.objectContaining({ message: hubError.message }) });
      expect(await run()).toMatchObject({ ok: false, error: expect.objectContaining({ message: thrown.message }) });
    });

    it('forwards a failure Result from spoke.deposit', async () => {
      vi.spyOn(sodax.moneyMarket, 'buildSupplyData').mockReturnValueOnce('0xsupply-data');
      const depositError = new Error('DEPOSIT_REJECTED');
      vi.spyOn(sodax.spoke, 'deposit').mockResolvedValueOnce({ ok: false, error: depositError });

      const result = await sodax.moneyMarket.createSupplyIntent({
        raw: false,
        params: supplyParams(ChainKeys.BSC_MAINNET),
        walletProvider: mockEvmProvider,
      });

      expect(result).toMatchObject({ ok: false, error: expect.objectContaining({ message: depositError.message }) });
    });
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

  describe('propagates internal errors', () => {
    it('forwards a failure Result from createSupplyIntent', async () => {
      const intentError = new SodaxError('INTENT_CREATION_FAILED', 'create intent failed', {
        feature: 'moneyMarket',
      });
      vi.spyOn(sodax.moneyMarket, 'createSupplyIntent').mockResolvedValueOnce({ ok: false, error: intentError });

      expect(await run()).toEqual({ ok: false, error: intentError });
    });

    it('wraps a spoke verifyTxHash failure as MM_VERIFY_FAILED with cause', async () => {
      vi.spyOn(sodax.moneyMarket, 'createSupplyIntent').mockResolvedValueOnce(spokeIntent);
      const verifyError = new Error('VERIFY_FAILED');
      vi.spyOn(sodax.spoke, 'verifyTxHash').mockResolvedValueOnce({ ok: false, error: verifyError });

      const result = await run();

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe('TX_VERIFICATION_FAILED');
      expect(result.error.cause).toBe(verifyError);
      expect(result.error.context?.phase).toBe('verify');
      expect(result.error.context?.action).toBe('supply');
    });

    it('wraps a RELAY_TIMEOUT relay failure as MM_RELAY_TIMEOUT with relayCode + action context', async () => {
      vi.spyOn(sodax.moneyMarket, 'createSupplyIntent').mockResolvedValueOnce(spokeIntent);
      vi.spyOn(sodax.spoke, 'verifyTxHash').mockResolvedValueOnce({ ok: true, value: true });
      const relayError = new Error('RELAY_TIMEOUT');
      mocks.relayTxAndWaitPacket.mockResolvedValueOnce({ ok: false, error: relayError });

      const result = await run();

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe('RELAY_TIMEOUT');
      expect(result.error.cause).toBe(relayError);
      expect(result.error.context?.relayCode).toBe('RELAY_TIMEOUT');
      expect(result.error.context?.action).toBe('supply');
      expect(result.error.context?.srcTxHash).toBe('0xspoke-tx');
    });

    it('wraps a thrown SodaxError with a non-supply code as EXECUTION_FAILED (typed contract preserved)', async () => {
      // The narrow `isMoneyMarketOrchestrationError` guard rejects codes outside SupplyErrorCode, so a
      // wrong-coded SodaxError thrown inside the orchestration is wrapped with the original on cause.
      const outOfUnion = new SodaxError('SWAP_RELAY_TIMEOUT' as never, 'foreign code', { feature: 'moneyMarket' });
      vi.spyOn(sodax.moneyMarket, 'createSupplyIntent').mockRejectedValueOnce(outOfUnion);

      expect(await run()).toMatchObject({
        ok: false,
        error: { code: 'EXECUTION_FAILED', cause: outOfUnion, context: { action: 'supply' } },
      });
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

    it('raw: true returns the raw transaction without walletProvider', async () => {
      vi.spyOn(sodax.moneyMarket, 'buildBorrowData').mockReturnValueOnce('0xborrow-data');
      const rawTx = { from: SAMPLE_USER_ADDRESS, to: HUB_WALLET, data: '0xborrow-data', value: 0n };
      const sendSpy = vi.spyOn(sodax.spoke, 'sendMessage').mockResolvedValueOnce({ ok: true, value: rawTx });

      const result = await sodax.moneyMarket.createBorrowIntent({
        raw: true,
        params: borrowParams(ChainKeys.BSC_MAINNET),
      });

      expect(result).toEqual({
        ok: true,
        value: { tx: rawTx, relayData: { address: HUB_WALLET, payload: '0xborrow-data' } },
      });
      const sendCall = sendSpy.mock.calls[0]?.[0];
      expect(sendCall?.raw).toBe(true);
      expect(sendCall).not.toHaveProperty('walletProvider');
    });

    it.each(
      MPC_RECIPIENTS,
    )('on a $chainKey destination: encodes the recipient the asset-manager release expects', async ({
      chainKey,
      address,
      word,
    }) => {
      vi.spyOn(sodax.spoke.xrp, 'checkDestination').mockResolvedValue({ ready: true });
      const buildSpy = vi.spyOn(sodax.moneyMarket, 'buildBorrowData').mockReturnValueOnce('0xborrow-data');
      vi.spyOn(sodax.spoke, 'sendMessage').mockResolvedValueOnce({ ok: true, value: '0xsend-hash' });

      const result = await sodax.moneyMarket.createBorrowIntent({
        raw: false,
        params: { ...borrowParams(ChainKeys.BSC_MAINNET), dstChainKey: chainKey, dstAddress: address },
        walletProvider: mockEvmProvider,
      });

      expect(result.ok).toBe(true);
      // The bare identity is still accepted on-chain, so the unpadded form delivers to a dead address.
      expect(buildSpy.mock.calls[0]?.[1]).toBe(word);
    });

    it('refuses an XRPL destination that cannot receive the release, for every refusal reason', async () => {
      const checkSpy = vi.spyOn(sodax.spoke.xrp, 'checkDestination');
      const sendSpy = vi.spyOn(sodax.spoke, 'sendMessage');

      for (const [reason, message] of XRPL_REFUSALS) {
        checkSpy.mockResolvedValueOnce({ ready: false, reason });
        const result = await sodax.moneyMarket.createBorrowIntent({
          raw: false,
          params: {
            ...borrowParams(ChainKeys.BSC_MAINNET),
            dstChainKey: ChainKeys.XRP_MAINNET,
            dstAddress: MPC_RECIPIENTS[1].address,
          },
          walletProvider: mockEvmProvider,
        });

        // The relay fails these terminally after the hub has burned the funds, so nothing may be sent.
        expect(result).toMatchObject({ ok: false, error: { code: 'VALIDATION_FAILED', message } });
      }
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

      expect(result.ok).toBe(true);
      expect(getEffSpy).toHaveBeenCalledWith(SAMPLE_USER_ADDRESS);
      // hub wallet is derived from the trading address (where collateral/debt live)
      expect(mocks.getUserHubWalletAddress).toHaveBeenCalledWith(TRADING, ChainKeys.BITCOIN_MAINNET);
      expect(mocks.getUserHubWalletAddress).not.toHaveBeenCalledWith(SAMPLE_USER_ADDRESS, ChainKeys.BITCOIN_MAINNET);
      // srcAddress stays personal: spoke.sendMessage re-resolves the trading address itself.
      expect(sendSpy.mock.calls[0]?.[0]?.srcAddress).toBe(SAMPLE_USER_ADDRESS);
    });
  });

  describe('rejects on invalid inputs', () => {
    it('rejects a wrong action, empty token, zero amount or mismatched walletProvider', async () => {
      for (const { params, walletProvider, message } of INVALID_INPUTS) {
        const result = await sodax.moneyMarket.createBorrowIntent({
          raw: false,
          params: { ...borrowParams(ChainKeys.BSC_MAINNET), ...params },
          walletProvider: walletProvider ?? mockEvmProvider,
        });
        expect(failureText(result)).toMatch(message);
      }
    });

    it('rejects when the dst money market token is unknown', async () => {
      vi.spyOn(sodax.config, 'getMoneyMarketToken').mockReturnValueOnce(undefined);

      const result = await sodax.moneyMarket.createBorrowIntent({
        raw: false,
        params: borrowParams(ChainKeys.BSC_MAINNET),
        walletProvider: mockEvmProvider,
      });

      expect(failureText(result)).toMatch(/Money market token not found/);
    });

    it.each([
      ['borrowing disabled', RESERVE_ACTIVE],
      ['frozen', BORROWABLE_RESERVE | RESERVE_FROZEN],
      ['paused', BORROWABLE_RESERVE | RESERVE_PAUSED],
      ['not a pool reserve', 0n],
    ])('rejects before sending anything when the reserve is %s', async (_name, configuration) => {
      vi.spyOn(sodax.moneyMarket.data, 'getReserveData').mockResolvedValueOnce(reserveData(configuration));
      const sendSpy = vi.spyOn(sodax.spoke, 'sendMessage');

      const result = await sodax.moneyMarket.createBorrowIntent({
        raw: false,
        params: borrowParams(ChainKeys.BSC_MAINNET),
        walletProvider: mockEvmProvider,
      });

      expect(result).toMatchObject({
        ok: false,
        error: {
          code: 'VALIDATION_FAILED',
          message:
            'TKN cannot be borrowed: its money-market reserve is inactive, frozen, paused or has borrowing disabled',
        },
      });
      expect(sendSpy).not.toHaveBeenCalled();
    });

    // Configuration words read from the Sonic lending pool, independent of the bit constants above.
    it.each([
      ['AAPL (borrowing off)', 7237005577332262213973186568751985011659028938317238155654854946153592264560n, false],
      ['LL (frozen)', 7237005577332262213973186568751985260883462776716331137789786111811354361856n, false],
      ['sodaUSDC', 7237005577332262213973186568751985094729963303420508151871565085374345649484n, true],
    ])('decodes the live pool configuration of %s', async (_name, configuration, borrowable) => {
      vi.spyOn(sodax.moneyMarket.data, 'getReserveData').mockResolvedValueOnce(reserveData(configuration));
      vi.spyOn(sodax.moneyMarket, 'buildBorrowData').mockReturnValueOnce('0xborrow-data');
      vi.spyOn(sodax.spoke, 'sendMessage').mockResolvedValueOnce({ ok: true, value: '0xsend-hash' });

      const result = await sodax.moneyMarket.createBorrowIntent({
        raw: false,
        params: borrowParams(ChainKeys.BSC_MAINNET),
        walletProvider: mockEvmProvider,
      });

      expect(result.ok).toBe(borrowable);
    });

    it.each([
      ['the token vault reserve', SAMPLE_BORROW_VAULT, SAMPLE_BORROW_VAULT],
      [
        'the bnUSD debt reserve, not the bnUSD vault reserve that has borrowing off',
        sodax.config.moneyMarket.bnUSDVault,
        sodax.config.moneyMarket.bnUSD,
      ],
    ])('checks %s', async (_name, vault, reserve) => {
      vi.spyOn(sodax.config, 'getMoneyMarketToken').mockReturnValueOnce({ ...BORROW_DST_TOKEN, vault });
      const reserveSpy = vi.spyOn(sodax.moneyMarket.data, 'getReserveData');
      vi.spyOn(sodax.moneyMarket, 'buildBorrowData').mockReturnValueOnce('0xborrow-data');
      vi.spyOn(sodax.spoke, 'sendMessage').mockResolvedValueOnce({ ok: true, value: '0xsend-hash' });

      const result = await sodax.moneyMarket.createBorrowIntent({
        raw: false,
        params: borrowParams(ChainKeys.BSC_MAINNET),
        walletProvider: mockEvmProvider,
      });

      expect(result.ok).toBe(true);
      expect(reserveSpy).toHaveBeenCalledWith(reserve);
    });
  });

  describe('propagates internal errors', () => {
    it('returns ok:false when hubProvider.getUserHubWalletAddress rejects or spoke.sendMessage throws', async () => {
      vi.spyOn(sodax.moneyMarket, 'buildBorrowData').mockReturnValue('0xborrow-data');
      const hubError = new Error('HUB_LOOKUP_FAILED');
      const thrown = new Error('SEND_THREW');
      mocks.getUserHubWalletAddress.mockReset();
      mocks.getUserHubWalletAddress.mockRejectedValueOnce(hubError).mockResolvedValue(HUB_WALLET);
      vi.spyOn(sodax.spoke, 'sendMessage').mockRejectedValueOnce(thrown);
      const run = () =>
        sodax.moneyMarket.createBorrowIntent({
          raw: false,
          params: borrowParams(ChainKeys.BSC_MAINNET),
          walletProvider: mockEvmProvider,
        });

      expect(await run()).toMatchObject({ ok: false, error: expect.objectContaining({ message: hubError.message }) });
      expect(await run()).toMatchObject({ ok: false, error: expect.objectContaining({ message: thrown.message }) });
    });

    it('forwards a failure Result from spoke.sendMessage with its tracking id and relay data', async () => {
      vi.spyOn(sodax.moneyMarket, 'buildBorrowData').mockReturnValueOnce('0xborrow-data');
      const sendError = new IndeterminateOutcomeError('SEND_FAILED', {
        cause: new Error('lost reply'),
        trackingId: '0xoriginal',
      });
      vi.spyOn(sodax.spoke, 'sendMessage').mockResolvedValueOnce({ ok: false, error: sendError });

      const result = await sodax.moneyMarket.createBorrowIntent({
        raw: false,
        params: borrowParams(ChainKeys.BSC_MAINNET),
        walletProvider: mockEvmProvider,
      });

      expect(result).toMatchObject({
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

    // The intent relay never delivers to Tron; the MPC relay releases once the hub tx is notified.
    it('on hub with a Tron target: settles the release on the MPC relay, not the intent relay', async () => {
      vi.spyOn(sodax.moneyMarket, 'createBorrowIntent').mockResolvedValueOnce(hubIntent);
      const release = vi
        .spyOn(sodax.spoke, 'settleHubRelease')
        .mockResolvedValueOnce({ ok: true, value: { srcChainTxHash: '0xhub-tx', dstChainTxHash: 'TronPayout' } });

      const result = await sodax.moneyMarket.borrow({
        raw: false,
        params: {
          ...borrowParams(ChainKeys.SONIC_MAINNET),
          dstChainKey: ChainKeys.TRON_MAINNET,
          dstAddress: TRON_TEST_ADDRESS,
        },
        walletProvider: mockEvmProvider,
      });

      expect(release).toHaveBeenCalledWith('0xhub-tx', ChainKeys.TRON_MAINNET, expect.anything());
      expect(mocks.relayTxAndWaitPacket).not.toHaveBeenCalled();
      expect(result).toEqual({ ok: true, value: { srcChainTxHash: '0xhub-tx', dstChainTxHash: 'TronPayout' } });
    });

    it('on EVM spoke: relays the packet', async () => {
      vi.spyOn(sodax.moneyMarket, 'createBorrowIntent').mockResolvedValueOnce(spokeIntent);
      const verifySpy = vi.spyOn(sodax.spoke, 'verifyTxHash').mockResolvedValueOnce({ ok: true, value: true });
      mocks.relayTxAndWaitPacket.mockResolvedValueOnce({ ok: true, value: { dst_tx_hash: '0xdst' } });

      const result = await sodax.moneyMarket.borrow({
        raw: false,
        params: borrowParams(ChainKeys.BSC_MAINNET),
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

    it('raw: true returns the raw transaction without walletProvider', async () => {
      vi.spyOn(sodax.moneyMarket, 'buildWithdrawData').mockReturnValueOnce('0xwithdraw-data');
      const rawTx = { from: SAMPLE_USER_ADDRESS, to: HUB_WALLET, data: '0x', value: 0n };
      const sendSpy = vi.spyOn(sodax.spoke, 'sendMessage').mockResolvedValueOnce({ ok: true, value: rawTx });

      const result = await sodax.moneyMarket.createWithdrawIntent({
        raw: true,
        params: withdrawParams(ChainKeys.BSC_MAINNET),
      });

      expect(result).toEqual({
        ok: true,
        value: { tx: rawTx, relayData: { address: HUB_WALLET, payload: '0xwithdraw-data' } },
      });
      expect(sendSpy.mock.calls[0]?.[0].raw).toBe(true);
    });

    // One non-EVM (left-padded word) and one EVM (plain address) MPC recipient; borrow covers XRPL too.
    it.each([
      MPC_RECIPIENTS[0],
      MPC_RECIPIENTS[2],
    ])('on a $chainKey destination: encodes the recipient the asset-manager release expects', async ({
      chainKey,
      address,
      word,
    }) => {
      const buildSpy = vi.spyOn(sodax.moneyMarket, 'buildWithdrawData').mockReturnValueOnce('0xwithdraw-data');
      vi.spyOn(sodax.spoke, 'sendMessage').mockResolvedValueOnce({ ok: true, value: '0xsend-hash' });

      const result = await sodax.moneyMarket.createWithdrawIntent({
        raw: false,
        params: { ...withdrawParams(ChainKeys.BSC_MAINNET), dstChainKey: chainKey, dstAddress: address },
        walletProvider: mockEvmProvider,
      });

      expect(result.ok).toBe(true);
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
          dstAddress: MPC_RECIPIENTS[1].address,
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

      expect(result.ok).toBe(true);
      expect(getEffSpy).toHaveBeenCalledWith(SAMPLE_USER_ADDRESS);
      // hub wallet is derived from the trading address (where collateral/debt live)
      expect(mocks.getUserHubWalletAddress).toHaveBeenCalledWith(TRADING, ChainKeys.BITCOIN_MAINNET);
      // srcAddress stays personal: spoke.sendMessage re-resolves the trading address itself.
      expect(sendSpy.mock.calls[0]?.[0]?.srcAddress).toBe(SAMPLE_USER_ADDRESS);
    });
  });

  describe('rejects on invalid inputs', () => {
    it('rejects a wrong action, empty token, zero amount or mismatched walletProvider', async () => {
      for (const { params, walletProvider, message } of INVALID_INPUTS) {
        const result = await sodax.moneyMarket.createWithdrawIntent({
          raw: false,
          params: { ...withdrawParams(ChainKeys.BSC_MAINNET), ...params },
          walletProvider: walletProvider ?? mockEvmProvider,
        });
        expect(failureText(result)).toMatch(message);
      }
    });

    it('rejects when token is unsupported on dstChainKey (default = srcChain)', async () => {
      vi.spyOn(sodax.config, 'isMoneyMarketSupportedToken').mockReturnValueOnce(false);

      const result = await sodax.moneyMarket.createWithdrawIntent({
        raw: false,
        params: withdrawParams(ChainKeys.BSC_MAINNET),
        walletProvider: mockEvmProvider,
      });
      expect(failureText(result)).toMatch(/Unsupported spoke chain/);
    });
  });

  describe('propagates internal errors', () => {
    it('forwards a failure Result from spoke.sendMessage with its tracking id and relay data', async () => {
      vi.spyOn(sodax.moneyMarket, 'buildWithdrawData').mockReturnValueOnce('0xwithdraw-data');
      const sendError = new IndeterminateOutcomeError('SEND_FAILED', {
        cause: new Error('lost reply'),
        trackingId: '0xoriginal',
      });
      vi.spyOn(sodax.spoke, 'sendMessage').mockResolvedValueOnce({ ok: false, error: sendError });

      const result = await sodax.moneyMarket.createWithdrawIntent({
        raw: false,
        params: withdrawParams(ChainKeys.BSC_MAINNET),
        walletProvider: mockEvmProvider,
      });

      expect(result).toMatchObject({
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
    });

    it('returns ok:false when spoke.sendMessage throws', async () => {
      vi.spyOn(sodax.moneyMarket, 'buildWithdrawData').mockReturnValueOnce('0xwithdraw-data');
      const thrown = new Error('SEND_THREW');
      vi.spyOn(sodax.spoke, 'sendMessage').mockRejectedValueOnce(thrown);

      const result = await sodax.moneyMarket.createWithdrawIntent({
        raw: false,
        params: withdrawParams(ChainKeys.BSC_MAINNET),
        walletProvider: mockEvmProvider,
      });

      expect(result).toMatchObject({ ok: false, error: expect.objectContaining({ message: thrown.message }) });
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

    it('on EVM spoke: relays', async () => {
      vi.spyOn(sodax.moneyMarket, 'createWithdrawIntent').mockResolvedValueOnce(spokeIntent);
      const verifySpy = vi.spyOn(sodax.spoke, 'verifyTxHash').mockResolvedValueOnce({ ok: true, value: true });
      mocks.relayTxAndWaitPacket.mockResolvedValueOnce({ ok: true, value: { dst_tx_hash: '0xdst' } });

      const result = await sodax.moneyMarket.withdraw({
        raw: false,
        params: withdrawParams(ChainKeys.BSC_MAINNET),
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

      expect(result.ok).toBe(true);
      expect(getEffSpy).toHaveBeenCalledWith(SAMPLE_USER_ADDRESS);
      expect(ensureSpy).toHaveBeenCalledWith(mockBitcoinProvider);
      expect(mocks.getUserHubWalletAddress).toHaveBeenCalledWith(TRADING, ChainKeys.BITCOIN_MAINNET);
      expect(depositSpy.mock.calls[0]?.[0]?.srcAddress).toBe(TRADING);
    });
  });

  describe('rejects on invalid inputs', () => {
    it('rejects a wrong action, empty token, zero amount or mismatched walletProvider', async () => {
      for (const { params, walletProvider, message } of INVALID_INPUTS) {
        const result = await sodax.moneyMarket.createRepayIntent({
          raw: false,
          params: { ...repayParams(ChainKeys.BSC_MAINNET), ...params },
          walletProvider: walletProvider ?? mockEvmProvider,
        });
        expect(failureText(result)).toMatch(message);
      }
    });

    it('on Bitcoin (non-raw): rejects a missing wallet provider before building any tx', async () => {
      // Same fail-fast guard as supply; collaborators are no-op mocks so a regression can never build a real tx.
      const getEffSpy = vi.spyOn(sodax.spoke.bitcoin, 'getEffectiveWalletAddress').mockResolvedValue('bc1p-trading');
      const depositSpy = vi.spyOn(sodax.spoke, 'deposit').mockResolvedValue({ ok: true, value: '0xunused' });

      const result = await sodax.moneyMarket.createRepayIntent({
        raw: false,
        params: repayParams(ChainKeys.BITCOIN_MAINNET),
        // Deliberate cast: the guard under test is exactly the missing-provider case.
        walletProvider: undefined as unknown as IBitcoinWalletProvider,
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('VALIDATION_FAILED');
        expect(result.error.context?.field).toBe('walletProvider');
        expect(String(result.error)).toMatch(/Expected bitcoin wallet provider/);
      }
      expect(getEffSpy).not.toHaveBeenCalled();
      expect(depositSpy).not.toHaveBeenCalled();
    });

    it('rejects unsupported token on srcChain', async () => {
      vi.spyOn(sodax.config, 'isMoneyMarketSupportedToken').mockReturnValueOnce(false);

      const result = await sodax.moneyMarket.createRepayIntent({
        raw: false,
        params: repayParams(ChainKeys.BSC_MAINNET),
        walletProvider: mockEvmProvider,
      });
      expect(failureText(result)).toMatch(/Unsupported spoke chain/);
    });
  });

  describe('propagates internal errors', () => {
    it('forwards a failure Result from spoke.deposit', async () => {
      vi.spyOn(sodax.moneyMarket, 'buildRepayData').mockReturnValueOnce('0xrepay-data');
      const depositError = new Error('DEPOSIT_FAILED');
      vi.spyOn(sodax.spoke, 'deposit').mockResolvedValueOnce({ ok: false, error: depositError });

      const result = await sodax.moneyMarket.createRepayIntent({
        raw: false,
        params: repayParams(ChainKeys.BSC_MAINNET),
        walletProvider: mockEvmProvider,
      });

      expect(result).toMatchObject({ ok: false, error: expect.objectContaining({ message: depositError.message }) });
    });

    it('returns ok:false when spoke.deposit throws', async () => {
      vi.spyOn(sodax.moneyMarket, 'buildRepayData').mockReturnValueOnce('0xrepay-data');
      const thrown = new Error('DEPOSIT_THREW');
      vi.spyOn(sodax.spoke, 'deposit').mockRejectedValueOnce(thrown);

      const result = await sodax.moneyMarket.createRepayIntent({
        raw: false,
        params: repayParams(ChainKeys.BSC_MAINNET),
        walletProvider: mockEvmProvider,
      });

      expect(result).toMatchObject({ ok: false, error: expect.objectContaining({ message: thrown.message }) });
    });
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
  it.each([
    'buildBorrowData',
    'buildWithdrawData',
  ] as const)('%s: predicate checks the hub asset, never the spoke token; vault-withdraw is emitted', method => {
    vi.spyOn(sodax.config, 'getSpokeTokenFromOriginalAssetAddress').mockReturnValueOnce(fakeHubAsset as never);
    vi.spyOn(sodax.config, 'getMoneyMarketToken').mockReturnValueOnce(collisionMoneyMarketToken as never);
    const predicateSpy = vi
      .spyOn(sodax.config, 'isSodaVaultHubAsset')
      .mockImplementation((addr: Address) => addr.toLowerCase() === COLLIDING_SPOKE_TOKEN.toLowerCase());
    const encodeWithdrawSpy = vi.spyOn(EvmVaultTokenService, 'encodeWithdraw');

    sodax.moneyMarket[method](HUB_WALLET, SAMPLE_DST_ADDRESS, COLLIDING_SPOKE_TOKEN, 1_000_000n, ChainKeys.BSC_MAINNET);

    expect(predicateSpy).toHaveBeenCalled();
    for (const [arg] of predicateSpy.mock.calls) {
      expect((arg as string).toLowerCase()).toBe(NON_VAULT_HUB_ASSET.toLowerCase());
    }
    expect(encodeWithdrawSpy).toHaveBeenCalledWith(HUB_VAULT, NON_VAULT_HUB_ASSET, expect.any(BigInt));
  });
});

describe('borrow / withdraw from Bitcoin: on-demand relay identity', () => {
  const signedPayload = { payload_hex: '7b22737263', signature: 'AUBsig' };
  // The relay tracks an on-demand packet under `od:<keccak256 of the ASCII payload_hex>`.
  const pollId = `od:${keccak256(stringToBytes(signedPayload.payload_hex)).slice(2)}`;
  // The signed on-demand payload (JSON string) — there is no broadcast txid.
  const btcIntent = {
    ok: true,
    value: {
      tx: JSON.stringify(signedPayload),
      relayData: { address: HUB_WALLET, payload: '0xbtc-payload' as `0x${string}` },
    },
  } as const;

  beforeEach(() => {
    vi.spyOn(sodax.config, 'getMoneyMarketToken').mockReturnValue({
      address: '0xaaaa000000000000000000000000000000000000' as Address,
      decimals: 18,
    } as never);
    vi.spyOn(sodax.spoke, 'verifyTxHash').mockResolvedValueOnce({ ok: true, value: true });
    mocks.relayTxAndWaitPacket.mockResolvedValueOnce({ ok: true, value: { dst_tx_hash: '0xdst' } });
  });

  it('withdraw relays the signed payload object as `data` under the literal "withdraw" tx_hash', async () => {
    vi.spyOn(sodax.moneyMarket, 'createWithdrawIntent').mockResolvedValueOnce(btcIntent);

    const result = await sodax.moneyMarket.withdraw({
      raw: false,
      params: withdrawParams(ChainKeys.BITCOIN_MAINNET),
      walletProvider: mockBitcoinProvider,
    });

    // The {address,payload} relayData is dropped; polling uses the derived id.
    const relayArg = mocks.relayTxAndWaitPacket.mock.calls[0]?.[0];
    expect(relayArg?.srcTxHash).toBe('withdraw');
    expect(relayArg?.data).toEqual(signedPayload);
    expect(relayArg?.pollTxHash).toBe(pollId);
    // srcChainTxHash is the poll id SodaxScan resolves, not the opaque signed payload.
    expect(result).toEqual({ ok: true, value: { srcChainTxHash: pollId, dstChainTxHash: '0xdst' } });
  });

  it('borrow returns the on-demand poll id (od:<hash>) as srcChainTxHash, not the raw payload', async () => {
    vi.spyOn(sodax.moneyMarket, 'createBorrowIntent').mockResolvedValueOnce(btcIntent);

    const result = await sodax.moneyMarket.borrow({
      raw: false,
      params: borrowParams(ChainKeys.BITCOIN_MAINNET),
      walletProvider: mockBitcoinProvider,
    });

    expect(result).toEqual({ ok: true, value: { srcChainTxHash: pollId, dstChainTxHash: '0xdst' } });
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

  it.each(cases)('$action: verifies the hub tx and surfaces a verification failure', async ({ action, stub, run }) => {
    stub();
    const verifyError = new Error('VERIFY_FAILED');
    const verifySpy = vi.spyOn(sodax.spoke, 'verifyTxHash').mockResolvedValueOnce({ ok: false, error: verifyError });

    const result = await run();

    expect(verifySpy).toHaveBeenCalledWith({ txHash: '0xhub-tx', chainKey: HUB });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('TX_VERIFICATION_FAILED');
    expect(result.error.cause).toBe(verifyError);
    expect(result.error.context?.action).toBe(action);
    expect(mocks.relayTxAndWaitPacket).not.toHaveBeenCalled();
  });
});

describe('MoneyMarketService — outbound result by source chain', () => {
  it.each(['borrow', 'withdraw'] as const)('%s keeps only the Bitcoin relay ID on timeout', async action => {
    const chainKey = ChainKeys.BITCOIN_MAINNET;
    const signature = 'private-authorization-fixture';
    const tx = JSON.stringify({ payload_hex: '0x1234', signature });
    const relayData = { address: HUB_WALLET, payload: '0x01' } as const;
    const intent = { ok: true, value: { tx, relayData } } as const;
    const walletProvider = {} as never;
    vi.spyOn(sodax.spoke, 'settle').mockResolvedValueOnce({
      ok: false,
      error: { phase: 'relay', cause: new Error('RELAY_TIMEOUT') },
    });
    vi.spyOn(
      sodax.moneyMarket,
      action === 'borrow' ? 'createBorrowIntent' : 'createWithdrawIntent',
    ).mockResolvedValueOnce(intent);
    const result =
      action === 'borrow'
        ? await sodax.moneyMarket.borrow({ raw: false, params: borrowParams(chainKey), walletProvider })
        : await sodax.moneyMarket.withdraw({ raw: false, params: withdrawParams(chainKey), walletProvider });
    expect(result).toMatchObject({
      ok: false,
      error: { code: 'RELAY_TIMEOUT', context: { srcTxHash: expect.stringMatching(/^od:[a-f0-9]{64}$/) } },
    });
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain(signature);
    expect(serialized).not.toContain('payload_hex');
  });

  it.each([
    ['borrow', ChainKeys.TRON_MAINNET],
    ['withdraw', ChainKeys.XRP_MAINNET],
    ['borrow', ChainKeys.MONAD_MAINNET],
  ] as const)('%s on %s keeps its original tracking ID on a settlement timeout', async (action, chainKey) => {
    const trackingId = '0xoriginal';
    const relayData = { address: HUB_WALLET, payload: '0x01' } as const;
    const intent = { ok: true, value: { tx: trackingId, relayData } } as const;
    const walletProvider = {} as never;
    const cause = new Error('RELAY_TIMEOUT');
    vi.spyOn(sodax.spoke, 'settle').mockResolvedValueOnce({ ok: false, error: { phase: 'relay', cause } });
    const intentMethod = action === 'borrow' ? 'createBorrowIntent' : 'createWithdrawIntent';
    vi.spyOn(sodax.moneyMarket, intentMethod).mockResolvedValueOnce(intent);
    const result =
      action === 'borrow'
        ? await sodax.moneyMarket.borrow({ raw: false, params: borrowParams(chainKey), walletProvider })
        : await sodax.moneyMarket.withdraw({ raw: false, params: withdrawParams(chainKey), walletProvider });
    expect(result).toMatchObject({
      ok: false,
      error: { code: 'RELAY_TIMEOUT', cause, context: { trackingId, srcChainKey: chainKey, relayData } },
    });
    if (result.ok) throw new Error('expected settlement failure');
    expect(result.error.context).not.toHaveProperty('srcTxHash');
  });

  type Settled<K extends SpokeChainKey> = Extract<
    Awaited<ReturnType<typeof sodax.moneyMarket.borrow<K>>>,
    { ok: true }
  >['value'];

  // A withdraw-auth has no Tron tx, so its tracking id never fills a tx-hash field.
  it('types a borrow from Tron as a withdraw-auth settlement and any other as a tx pair', () => {
    expectTypeOf<Settled<typeof ChainKeys.TRON_MAINNET>>().toEqualTypeOf<MpcWithdrawalSettlement>();
    expectTypeOf<Settled<typeof ChainKeys.ARBITRUM_MAINNET>>().toEqualTypeOf<TxHashPair>();
    expectTypeOf<Settled<SpokeChainKey>>().toEqualTypeOf<TxHashPair | MpcWithdrawalSettlement>();
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

  it.each(['buildBorrowData', 'buildWithdrawData'] as const)('%s checks the floor on direct calls', method => {
    const service = new Sodax({ logger: 'silent' }).moneyMarket;
    const build = (amount: bigint) =>
      service[method](HUB_WALLET, SAMPLE_DST_ADDRESS, usdt.address, amount, ChainKeys.TRON_MAINNET);
    expect(() => build(3_000_000n)).toThrow(/must be greater than 3 USDT/);
    expect(build(3_000_001n)).toMatch(/^0x[0-9a-f]+$/i);
  });

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

  it.each(cases)('%s (raw: %s) refuses the minimum before signing and sends above it', async (method, raw) => {
    const send = setup();

    const result = await run(method, 3_000_000n, raw);

    if (result.ok) throw new Error('expected a refusal');
    expect(result.error.code).toBe('VALIDATION_FAILED');
    expect(result.error.context?.reason).toBe('mpc-payout-below-minimum');
    expect(result.error.message).toContain('must be greater than 3 USDT');
    expect(send).not.toHaveBeenCalled();
    expect((await run(method, 3_000_001n, raw)).ok).toBe(true);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('checks a borrow on what it pays out after the partner fee', async () => {
    const send = setup();
    vi.spyOn(sodax.moneyMarket, 'partnerFee', 'get').mockReturnValue({
      address: '0x9999999999999999999999999999999999999999',
      percentage: 1_000,
    });

    // 10% off 3.1 USDT leaves 2.79, under the 3 USDT floor; off 3.4 USDT it leaves 3.06.
    const refused = await run('createBorrowIntent', 3_100_000n, true);
    if (refused.ok) throw new Error('expected a refusal');
    expect(refused.error.context?.reason).toBe('mpc-payout-below-minimum');
    expect((await run('createBorrowIntent', 3_400_000n, true)).ok).toBe(true);
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
        dstAddress: MPC_RECIPIENTS[1].address,
      },
    });

    // 10% off 1 XRP: a missing account would be sent 0.9 XRP, which is what must clear its reserve.
    expect(check).toHaveBeenCalledWith(expect.objectContaining({ amount: 900_000n }));
  });
});
