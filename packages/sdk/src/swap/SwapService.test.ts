/**
 * Tests for the strongly-typed SwapService public API.
 *
 * Covers BOTH runtime behavior and type-level correctness. The goal of the refactor is:
 *
 *   1. `srcChainKey: K extends SpokeChainKey` is the generic anchor — it lives at the top
 *      level of every method's params, replacing the old nested `params.srcChain`.
 *   2. `walletProvider` is narrowed via `GetWalletProviderType<K>` so passing an EVM chain
 *      key requires an EVM wallet provider (mismatches fail at compile time).
 *   3. `raw: R` is a required boolean discriminant on swap actions: when `raw: true`, `walletProvider`
 *      is forbidden (`never`); when `raw: false`, `walletProvider` is required.
 *   4. `cancelIntent` takes an explicit `srcChainKey` alongside `intent`; we assert at runtime
 *      that `getIntentRelayChainId(srcChainKey) === intent.srcChain` and throw on mismatch.
 */
import { IndeterminateOutcomeError } from '../errors/IndeterminateOutcomeError.js';
import { afterEach, beforeEach, describe, expect, expectTypeOf, it, vi } from 'vitest';
import {
  ChainKeys,
  MpcRelayChainMap,
  arbitrumSupportedTokens,
  cardanoSupportedTokens,
  monadSupportedTokens,
  tonSupportedTokens,
  zcashSupportedTokens,
  type MpcRelayChainKey,
  getIntentRelayChainId,
  spokeChainConfig,
  type AnalyticsEvent,
  type EvmAtomicBatchSupport,
  type EvmBatchResult,
  type EvmRawTransaction,
  type IBitcoinWalletProvider,
  type IEvmWalletProvider,
  type ISolanaWalletProvider,
  type IStellarWalletProvider,
  type ITronWalletProvider,
  type IWalletProvider,
  type PartnerFee,
  DEFAULT_BACKEND_API_TIMEOUT,
  DEFAULT_RELAY_TX_TIMEOUT,
  SolverIntentErrorCode,
  SolverIntentStatusCode,
  type Result,
  type SolverIntentStatusResponse,
  type SpokeChainKey,
  type SubmitTxStatusDataV2,
  tronSupportedTokens,
  xrpSupportedTokens,
} from '@sodax/types';
import {
  ATOMIC_BATCH_UNCONFIRMED,
  DETAILED_STATUS_NOT_DELIVERED,
  SPEED_TIER_SECONDS,
  SwapService,
  type IntentResponse,
  type SodaxOptions,
  type SwapsClientOptions,
  type SwapServiceConstructorParams,
  type SpokeIsAllowanceValidParamsEvmSpoke,
  type SpokeIsAllowanceValidParamsHub,
  type WalletProviderSlot,
} from '../index.js';
import { AtomicityNotSupportedError, keccak256, stringToBytes, TransactionExecutionError } from 'viem';
import { Sodax } from '../shared/entities/Sodax.js';
import { isSodaxError, SodaxError } from '../errors/SodaxError.js';
import { isAuthFailure } from '../errors/guards.js';
import { invariant } from '../shared/utils/tiny-invariant.js';
import { adjustAmountByFee, encodeAddress } from '../shared/utils/shared-utils.js';
import { HttpRelayError, RELAY_FALLBACK_FLOOR_MS } from '../shared/services/intentRelay/IntentRelayApiService.js';

// SwapService imports SonicSpokeService, EvmSolverService, etc. via the SDK barrel
// (`../index.js`). Under Vitest's module graph the barrel's re-export ordering makes a direct
// `vi.spyOn(Foo, ...)` unreliable — the SwapService-internal reference ends up as a different
// module instance than the test-side import. We mock the modules at their source paths so the
// SwapService sees our test doubles. `vi.hoisted` lets the mock factories reference top-level
// bindings safely despite `vi.mock` being hoisted to the file top. `getUserHubWalletAddress` is
// now an instance method on `sodax.hubProvider`; we keep a vi.fn stub here and bind it via
// `vi.spyOn` in `beforeEach` so the existing per-test `.mockResolvedValueOnce(...)` calls work.
const mocks = vi.hoisted(() => ({
  sonicCreateSwapIntent: vi.fn(),
  constructCreateIntentData: vi.fn(),
  reconstructCreateIntentData: vi.fn(),
  encodeCancelIntent: vi.fn().mockReturnValue({
    address: '0x0000000000000000000000000000000000000000',
    value: 0n,
    data: '0x',
  }),
  encodeCreateIntent: vi.fn().mockReturnValue({
    address: '0x0000000000000000000000000000000000000000',
    value: 0n,
    data: '0x',
  }),
  getIntent: vi.fn(),
  getFilledIntent: vi.fn(),
  getIntentHash: vi.fn(),
  getUserHubWalletAddress: vi.fn(),
  // IntentRelayApiService functions — mocked so the relay-facing methods never hit the network.
  submitTransaction: vi.fn(),
  waitUntilIntentExecuted: vi.fn(),
  relayTxAndWaitPacket: vi.fn(),
  getTransactionPackets: vi.fn(),
  // SolverApiService static methods — same reasoning for getQuote / getStatus / postExecution.
  solverGetQuote: vi.fn(),
  solverGetStatus: vi.fn(),
  solverPostExecution: vi.fn(),
}));
// SonicSpokeService is instantiated by EvmHubProvider + SpokeService (`new SonicSpokeService(config)`)
// AND accessed statically by SwapService (`SonicSpokeService.createSwapIntent(...)`). The mock must
// therefore be a class with the static method attached — a plain object breaks `new`.
vi.mock('../shared/services/spoke/SonicSpokeService.js', () => {
  class SonicSpokeService {
    static createSwapIntent = mocks.sonicCreateSwapIntent;
  }
  return { SonicSpokeService };
});
vi.mock('./EvmSolverService.js', () => ({
  EvmSolverService: {
    constructCreateIntentData: mocks.constructCreateIntentData,
    reconstructCreateIntentData: mocks.reconstructCreateIntentData,
    encodeCancelIntent: mocks.encodeCancelIntent,
    encodeCreateIntent: mocks.encodeCreateIntent,
    getIntent: mocks.getIntent,
    getFilledIntent: mocks.getFilledIntent,
    getIntentHash: mocks.getIntentHash,
  },
}));
// IntentRelayApiService exports a mix of functions and types. We use vi.importActual so the
// type exports survive; only the three network-touching functions are replaced with mocks.
vi.mock('../shared/services/intentRelay/IntentRelayApiService.js', async () => {
  const actual = await vi.importActual<object>('../shared/services/intentRelay/IntentRelayApiService.js');
  return {
    ...actual,
    submitTransaction: mocks.submitTransaction,
    waitUntilIntentExecuted: mocks.waitUntilIntentExecuted,
    relayTxAndWaitPacket: mocks.relayTxAndWaitPacket,
    getTransactionPackets: mocks.getTransactionPackets,
  };
});
vi.mock('./SolverApiService.js', () => ({
  SolverApiService: {
    getQuote: mocks.solverGetQuote,
    getStatus: mocks.solverGetStatus,
    postExecution: mocks.solverPostExecution,
  },
}));
import type { CancelIntentActionParams, CreateIntentParams, Intent, SwapActionParams } from './SwapService.js';
import { TRON_TEST_ADDRESS } from '../shared/services/spoke/tron-test-fixtures.js';
import type { XrpDestinationReadiness } from '../shared/services/spoke/XrpSpokeService.js';

// --- test fixtures --------------------------------------------------------
//
// A single real Sodax instance backs every test in this file. Opt out of backend submit-tx
// so the bulk of suites exercise the client-side relay path; Batch 7 uses a separate
// instance with the default (ON). `new Sodax(...)` wires up the full graph (EvmHubProvider,
// SpokeService, ConfigService, SwapService, ...) using the default sodaxConfig — we then
// stub behavior per-test via `vi.spyOn(sodax.config, ...)` and `vi.spyOn(sodax.spoke, ...)`.
// Module-level `vi.mock` above still intercepts SonicSpokeService / EvmSolverService because
// those are static imports inside SwapService.ts that can't be reached through the instance.
// `getUserHubWalletAddress` is an instance method on `sodax.hubProvider` and is rebound via
// `vi.spyOn` in `beforeEach`.

const testSolver = { solverApiEndpoint: 'https://api.example.com/v1/intent' } as const;
const sodax = new Sodax({
  solver: testSolver,
  swaps: { useBackendSubmitTx: false },
});

// Wallet provider fakes — only used by the type-level tests to prove walletProvider
// narrowing via expectTypeOf / @ts-expect-error. The bodies never execute at runtime.
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
// Typed handle kept beside the interface cast so tests can drive the optional members (getPublicKey).
const bitcoinProviderMocks = {
  chainType: 'BITCOIN',
  getWalletAddress: vi.fn(),
  signMessage: vi.fn(),
  signBip322Message: vi.fn(),
  signEcdsaMessage: vi.fn(),
  getPublicKey: vi.fn(),
};
const mockBitcoinProvider = bitcoinProviderMocks as unknown as IBitcoinWalletProvider;
const mockStellarProvider = {
  chainType: 'STELLAR',
  getWalletAddress: vi.fn(),
  signTransaction: vi.fn(),
} as unknown as IStellarWalletProvider;

const mockTronProvider: ITronWalletProvider = {
  chainType: 'TRON',
  getWalletAddress: vi.fn(),
  signTransaction: vi.fn(),
  signMessage: vi.fn(),
  waitForTransactionReceipt: vi.fn(),
};

// Base user-facing intent params parameterized by source chain. Returning a generic
// `CreateIntentParams<K>` lets the test call sites pass a literal ChainKey and have K
// inferred all the way through to walletProvider narrowing.
const intentInput = <K extends SpokeChainKey>(srcChainKey: K): CreateIntentParams<K> => ({
  inputToken: '0x2170Ed0880ac9A755fd29B2688956BD959F933F8',
  outputToken: '0x2f2a2543B76A4166549F7aaB2e75Bef0aefC5B0f',
  inputAmount: 1_000_000n,
  minOutputAmount: 900_000n,
  deadline: 0n,
  allowPartialFill: false,
  srcChainKey,
  dstChainKey: ChainKeys.ARBITRUM_MAINNET,
  srcAddress: '0x1111111111111111111111111111111111111111',
  dstAddress: '0x2222222222222222222222222222222222222222',
  solver: '0x0000000000000000000000000000000000000000',
  data: '0x',
});

// Compatible Intent fixture for cancelIntent.
function makeIntent(srcChainKey: Parameters<typeof getIntentRelayChainId>[0] = ChainKeys.BSC_MAINNET): Intent {
  return {
    intentId: 1n,
    creator: '0x3333333333333333333333333333333333333333',
    inputToken: '0x4444444444444444444444444444444444444444',
    outputToken: '0x5555555555555555555555555555555555555555',
    inputAmount: 1_000_000n,
    minOutputAmount: 900_000n,
    deadline: 0n,
    allowPartialFill: false,
    srcChain: getIntentRelayChainId(srcChainKey),
    dstChain: getIntentRelayChainId(ChainKeys.ARBITRUM_MAINNET),
    srcAddress: '0x1111111111111111111111111111111111111111',
    dstAddress: '0x2222222222222222222222222222222222222222',
    solver: '0x0000000000000000000000000000000000000000',
    data: '0x',
  };
}

// Compile-time narrowing: `expectTypeOf` on the param types, and call sites wrapped in `if (false as boolean)`
// so they never run; a regression (the compiler accepting a mismatched provider) surfaces as an unused
// `@ts-expect-error`. K is inferred from `params.srcChainKey` (or `srcChainKey` for cancelIntent).
describe('SwapService types — walletProvider narrowing', () => {
  const svc = sodax.swaps;

  it('narrows walletProvider per chain family and on raw, on the param types and every public method call site', () => {
    // WalletProviderSlot is the spoke-layer helper still used by DepositParams / SendMessageParams.
    expectTypeOf<WalletProviderSlot<'0x38.bsc', true>>().toEqualTypeOf<{ raw: true; walletProvider?: never }>();
    expectTypeOf<WalletProviderSlot<'0x38.bsc'>>().toEqualTypeOf<{
      raw?: false;
      walletProvider: IEvmWalletProvider;
    }>();
    expectTypeOf<WalletProviderSlot<'ethereum'>>().toEqualTypeOf<{
      raw?: false;
      walletProvider: IEvmWalletProvider;
    }>();
    expectTypeOf<WalletProviderSlot<'sonic'>>().toEqualTypeOf<{
      raw?: false;
      walletProvider: IEvmWalletProvider;
    }>();
    expectTypeOf<WalletProviderSlot<'solana'>>().toEqualTypeOf<{
      raw?: false;
      walletProvider: ISolanaWalletProvider;
    }>();
    expectTypeOf<WalletProviderSlot<'stellar'>>().toEqualTypeOf<{
      raw?: false;
      walletProvider: IStellarWalletProvider;
    }>();
    expectTypeOf<WalletProviderSlot<'bitcoin'>>().toEqualTypeOf<{
      raw?: false;
      walletProvider: IBitcoinWalletProvider;
    }>();

    expectTypeOf<SwapActionParams<'0x38.bsc'>['walletProvider']>().toEqualTypeOf<IEvmWalletProvider>();
    expectTypeOf<SwapActionParams<'ethereum'>['walletProvider']>().toEqualTypeOf<IEvmWalletProvider>();
    expectTypeOf<SwapActionParams<'sonic'>['walletProvider']>().toEqualTypeOf<IEvmWalletProvider>();
    expectTypeOf<SwapActionParams<'solana'>['walletProvider']>().toEqualTypeOf<ISolanaWalletProvider>();
    expectTypeOf<SwapActionParams<'stellar'>['walletProvider']>().toEqualTypeOf<IStellarWalletProvider>();
    expectTypeOf<SwapActionParams<'bitcoin'>['walletProvider']>().toEqualTypeOf<IBitcoinWalletProvider>();
    expectTypeOf<SwapActionParams<'0x38.bsc', true>>().toHaveProperty('walletProvider').toEqualTypeOf<undefined>();
    expectTypeOf<SwapActionParams<'bitcoin', true>>().toHaveProperty('walletProvider').toEqualTypeOf<undefined>();
    expectTypeOf<SwapActionParams<SpokeChainKey, false>['walletProvider']>().toEqualTypeOf<IWalletProvider>();
    // cancelIntent keeps the explicit srcChainKey because Intent.srcChain is an
    // IntentRelayChainId (bigint) that can't narrow to a literal ChainKey at the type level.
    expectTypeOf<CancelIntentActionParams<'0x38.bsc', false>>()
      .toHaveProperty('walletProvider')
      .toEqualTypeOf<IEvmWalletProvider>();
    expectTypeOf<CancelIntentActionParams<'solana', false>>()
      .toHaveProperty('walletProvider')
      .toEqualTypeOf<ISolanaWalletProvider>();
    expectTypeOf<CreateIntentParams>().toHaveProperty('srcChainKey');
    expectTypeOf<CreateIntentParams<'0x38.bsc'>['srcChainKey']>().toEqualTypeOf<'0x38.bsc'>();

    if (false as boolean) {
      void svc.createIntent({
        params: intentInput(ChainKeys.ETHEREUM_MAINNET),
        walletProvider: mockEvmProvider,
      });
      void svc.createIntent({
        params: intentInput(ChainKeys.ETHEREUM_MAINNET),
        // @ts-expect-error — IEvmWalletProvider required, not ISolanaWalletProvider.
        walletProvider: mockSolanaProvider,
      });
      void svc.createIntent({
        params: intentInput(ChainKeys.ETHEREUM_MAINNET),
        // @ts-expect-error — IEvmWalletProvider required, not IStellarWalletProvider.
        walletProvider: mockStellarProvider,
      });
      void svc.createIntent({
        params: intentInput(ChainKeys.SOLANA_MAINNET),
        walletProvider: mockSolanaProvider,
      });
      void svc.createIntent({
        params: intentInput(ChainKeys.SOLANA_MAINNET),
        // @ts-expect-error — ISolanaWalletProvider required, not IEvmWalletProvider.
        walletProvider: mockEvmProvider,
      });
      void svc.createIntent({
        params: intentInput(ChainKeys.STELLAR_MAINNET),
        walletProvider: mockStellarProvider,
      });
      void svc.createIntent({
        params: intentInput(ChainKeys.STELLAR_MAINNET),
        // @ts-expect-error — IStellarWalletProvider required, not IEvmWalletProvider.
        walletProvider: mockEvmProvider,
      });
      void svc.createIntent({
        params: intentInput(ChainKeys.BITCOIN_MAINNET),
        walletProvider: mockBitcoinProvider,
      });
      void svc.createIntent({
        params: intentInput(ChainKeys.BITCOIN_MAINNET),
        // @ts-expect-error — IBitcoinWalletProvider required, not IEvmWalletProvider.
        walletProvider: mockEvmProvider,
      });
    }

    if (false as boolean) {
      void svc.createIntent({ params: intentInput(ChainKeys.BSC_MAINNET), raw: true });
      void svc.createIntent({ params: intentInput(ChainKeys.SOLANA_MAINNET), raw: true });
      void svc.createIntent({ params: intentInput(ChainKeys.STELLAR_MAINNET), raw: true });
      // @ts-expect-error — walletProvider is required by SwapActionParams.
      void svc.createIntent({ params: intentInput(ChainKeys.BSC_MAINNET) });
      // @ts-expect-error — walletProvider is forbidden when raw is true.
      void svc.createIntent({
        params: intentInput(ChainKeys.BSC_MAINNET),
        raw: true,
        walletProvider: mockEvmProvider,
      });

      const params: CreateIntentParams<SpokeChainKey> = intentInput(ChainKeys.BSC_MAINNET);
      // @ts-expect-error — walletProvider required on exec even with broad K.
      void svc.createIntent<SpokeChainKey>({ params });
      void svc.createIntent({ params, raw: true });
      // Broad K falls back to IWalletProvider union; all chain providers are accepted.
      void svc.createIntent<SpokeChainKey, false>({ params, walletProvider: mockEvmProvider });
      void svc.createIntent<SpokeChainKey, false>({ params, walletProvider: mockSolanaProvider });
      void svc.createIntent<SpokeChainKey, false>({ params, walletProvider: mockStellarProvider });
    }

    if (false as boolean) {
      void svc.createIntent({
        params: intentInput(ChainKeys.STACKS_MAINNET),
        extras: { srcPublicKey: '02ab' },
        raw: true,
      });
      void svc.createIntent({
        params: intentInput(ChainKeys.BSC_MAINNET),
        extras: { partnerFee: { address: '0x00000000000000000000000000000000feec0b02', percentage: 100 } },
        raw: true,
      });
      void svc.createIntent({
        params: intentInput(ChainKeys.BSC_MAINNET),
        // @ts-expect-error — srcPublicKey is `never` for non-Stacks chains (EVM here).
        extras: { srcPublicKey: '02ab' },
        raw: true,
      });
      void svc.createIntent({
        params: intentInput(ChainKeys.BITCOIN_MAINNET),
        extras: { bound: { accessToken: 'bound-token' } },
        raw: true,
      });
      void svc.createIntent({
        params: intentInput(ChainKeys.BSC_MAINNET),
        // @ts-expect-error — bound is `never` for non-Bitcoin chains (EVM here).
        extras: { bound: { accessToken: 'bound-token' } },
        raw: true,
      });
    }

    if (false as boolean) {
      void svc.swap({ params: intentInput(ChainKeys.BSC_MAINNET), walletProvider: mockEvmProvider });
      // @ts-expect-error — Solana provider mismatched.
      void svc.swap({ params: intentInput(ChainKeys.BSC_MAINNET), walletProvider: mockSolanaProvider });
      void svc.swap({ params: intentInput(ChainKeys.SOLANA_MAINNET), walletProvider: mockSolanaProvider });
      // @ts-expect-error — EVM provider mismatched.
      void svc.swap({ params: intentInput(ChainKeys.SOLANA_MAINNET), walletProvider: mockEvmProvider });
      // @ts-expect-error — swap always executes; walletProvider is required.
      void svc.swap({ params: intentInput(ChainKeys.BSC_MAINNET) });

      void svc.approve({ params: intentInput(ChainKeys.BSC_MAINNET), walletProvider: mockEvmProvider });
      // @ts-expect-error — Stellar provider mismatched.
      void svc.approve({ params: intentInput(ChainKeys.BSC_MAINNET), walletProvider: mockStellarProvider });
      void svc.approve({ params: intentInput(ChainKeys.STELLAR_MAINNET), walletProvider: mockStellarProvider });
      // @ts-expect-error — EVM provider mismatched.
      void svc.approve({ params: intentInput(ChainKeys.STELLAR_MAINNET), walletProvider: mockEvmProvider });
      void svc.approve({ params: intentInput(ChainKeys.BSC_MAINNET), raw: true });
      // @ts-expect-error — walletProvider is forbidden when raw is true.
      void svc.approve({ params: intentInput(ChainKeys.BSC_MAINNET), raw: true, walletProvider: mockEvmProvider });

      void svc.isAllowanceValid({ params: intentInput(ChainKeys.BSC_MAINNET), walletProvider: mockEvmProvider });
      // @ts-expect-error — Solana provider mismatched.
      void svc.isAllowanceValid({ params: intentInput(ChainKeys.BSC_MAINNET), walletProvider: mockSolanaProvider });
      void svc.isAllowanceValid({
        params: intentInput(ChainKeys.BITCOIN_MAINNET),
        walletProvider: mockBitcoinProvider,
      });
      void svc.isAllowanceValid({
        params: intentInput(ChainKeys.BITCOIN_MAINNET),
        // @ts-expect-error — Stellar provider mismatched.
        walletProvider: mockStellarProvider,
      });
      // @ts-expect-error — walletProvider is required.
      void svc.isAllowanceValid({ params: intentInput(ChainKeys.BSC_MAINNET) });

      void svc.createLimitOrder({ params: intentInput(ChainKeys.BSC_MAINNET), walletProvider: mockEvmProvider });
      // @ts-expect-error — Solana provider mismatched.
      void svc.createLimitOrder({ params: intentInput(ChainKeys.BSC_MAINNET), walletProvider: mockSolanaProvider });
      void svc.createLimitOrderIntent({
        params: intentInput(ChainKeys.SOLANA_MAINNET),
        walletProvider: mockSolanaProvider,
      });
      void svc.createLimitOrderIntent({
        params: intentInput(ChainKeys.SOLANA_MAINNET),
        // @ts-expect-error — EVM provider mismatched.
        walletProvider: mockEvmProvider,
      });
      void svc.createLimitOrderIntent({ params: intentInput(ChainKeys.BSC_MAINNET), raw: true });
      // @ts-expect-error — walletProvider is forbidden when raw is true.
      void svc.createLimitOrderIntent({
        params: intentInput(ChainKeys.BSC_MAINNET),
        raw: true,
        walletProvider: mockEvmProvider,
      });
    }

    if (false as boolean) {
      void svc.cancelIntent({
        params: { srcChainKey: ChainKeys.BSC_MAINNET, intent: makeIntent() },
        walletProvider: mockEvmProvider,
      });
      void svc.cancelIntent({
        params: { srcChainKey: ChainKeys.BSC_MAINNET, intent: makeIntent() },
        // @ts-expect-error — Stellar provider mismatched.
        walletProvider: mockStellarProvider,
      });
      void svc.cancelIntent({
        params: { srcChainKey: ChainKeys.SOLANA_MAINNET, intent: makeIntent() },
        walletProvider: mockSolanaProvider,
      });
      void svc.cancelIntent({
        params: { srcChainKey: ChainKeys.SOLANA_MAINNET, intent: makeIntent() },
        // @ts-expect-error — EVM provider mismatched.
        walletProvider: mockEvmProvider,
      });
    }
  });
});

// =========================================================================
// Runtime tests — validate each method delegates correctly.
// =========================================================================

// Real config doesn't know about our synthetic test token/address pairs, so every
// runtime test needs the three validity predicates stubbed to `true`. Mocks are
// restored between tests so a `vi.spyOn(svc.spoke, ...)` in one test doesn't leak
// into the next. Note that `vi.resetAllMocks()` also strips the default return
// value off our hoisted `vi.fn()` mocks — we re-apply those defaults here each run.
beforeEach(() => {
  vi.spyOn(sodax.config, 'isValidOriginalAssetAddress').mockReturnValue(true);
  vi.spyOn(sodax.config, 'isValidSpokeChainKey').mockReturnValue(true);
  vi.spyOn(sodax.config, 'isValidIntentRelayChainId').mockReturnValue(true);
  vi.spyOn(sodax.spoke, 'verifyTxHash').mockResolvedValue({ ok: true, value: true });
  // Bind the hoisted vi.fn stub to the live EvmHubProvider instance method so per-test
  // `.mockResolvedValueOnce(...)` calls on `mocks.getUserHubWalletAddress` keep working.
  vi.spyOn(sodax.hubProvider, 'getUserHubWalletAddress').mockImplementation(mocks.getUserHubWalletAddress);

  const emptyContractCall = {
    address: '0x0000000000000000000000000000000000000000' as const,
    value: 0n,
    data: '0x' as const,
  };
  mocks.encodeCancelIntent.mockReturnValue(emptyContractCall);
  mocks.encodeCreateIntent.mockReturnValue(emptyContractCall);
});
afterEach(() => {
  // vitest 4: restoreAllMocks only restores `vi.spyOn` spies, so the hoisted `vi.fn()`
  // mocks need resetAllMocks to clear their call history and default impls.
  vi.resetAllMocks();
  vi.restoreAllMocks();
});

// The real intents contract address from the default sodaxConfig — used in spender
// assertions for the Sonic / hub-chain allowance & approve paths.
const intentsContract = sodax.swaps.solver.intentsContract;

describe('SwapService.isAllowanceValid', () => {
  it('checks ERC20 allowance against the intents contract on the hub and the asset manager on EVM spokes', async () => {
    const svc = sodax.swaps;
    const spy = vi.spyOn(svc.spoke, 'isAllowanceValid').mockResolvedValue({ ok: true, value: true });

    const onHub = await svc.isAllowanceValid({
      params: intentInput(ChainKeys.SONIC_MAINNET),
      raw: false,
      walletProvider: mockEvmProvider,
    });
    const onSpoke = await svc.isAllowanceValid({
      params: intentInput(ChainKeys.BSC_MAINNET),
      raw: false,
      walletProvider: mockEvmProvider,
    });

    expect(onHub).toEqual({ ok: true, value: true });
    expect(onSpoke).toEqual({ ok: true, value: true });
    expect(spy).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        srcChainKey: ChainKeys.SONIC_MAINNET,
        spender: intentsContract,
      } satisfies Partial<SpokeIsAllowanceValidParamsHub>),
    );
    expect(spy).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        srcChainKey: ChainKeys.BSC_MAINNET,
        spender: spokeChainConfig[ChainKeys.BSC_MAINNET].addresses.assetManager,
      } satisfies Partial<SpokeIsAllowanceValidParamsEvmSpoke>),
    );
  });

  it('defers Stellar to its trustline check and short-circuits to true for chains without allowance semantics (Solana)', async () => {
    const svc = sodax.swaps;
    const stellarParams = intentInput(ChainKeys.STELLAR_MAINNET);
    const spy = vi.spyOn(svc.spoke, 'isAllowanceValid').mockResolvedValueOnce({ ok: true, value: true });

    const stellar = await svc.isAllowanceValid({
      params: stellarParams,
      raw: false,
      walletProvider: mockStellarProvider,
    });
    const solana = await svc.isAllowanceValid({
      params: intentInput(ChainKeys.SOLANA_MAINNET),
      raw: false,
      walletProvider: mockSolanaProvider,
    });

    expect(stellar).toEqual({ ok: true, value: true });
    expect(solana).toEqual({ ok: true, value: true });
    expect(spy).toHaveBeenCalledOnce();
    expect(spy).toHaveBeenCalledWith(
      expect.objectContaining({
        srcChainKey: ChainKeys.STELLAR_MAINNET,
        token: stellarParams.inputToken,
        amount: stellarParams.inputAmount,
        owner: stellarParams.srcAddress,
      }),
    );
  });
});

describe('SwapService.approve', () => {
  it('approves the intents contract on Sonic, and the asset manager on EVM spokes (raw=true returns raw tx, no walletProvider)', async () => {
    const svc = sodax.swaps;
    const rawTx = { from: '0x1', to: '0x2', data: '0x', value: 0n };
    const spy = vi
      .spyOn(svc.spoke, 'approve')
      .mockResolvedValueOnce({ ok: true, value: '0xapprove-hash' })
      .mockResolvedValueOnce({ ok: true, value: rawTx });

    const onHub = await svc.approve({
      params: intentInput(ChainKeys.SONIC_MAINNET),
      raw: false,
      walletProvider: mockEvmProvider,
    });
    const onSpoke = await svc.approve({ params: intentInput(ChainKeys.BSC_MAINNET), raw: true });

    expect(onHub).toEqual({ ok: true, value: '0xapprove-hash' });
    expect(spy.mock.calls[0]?.[0]).toMatchObject({
      srcChainKey: ChainKeys.SONIC_MAINNET,
      spender: intentsContract,
      raw: false,
      walletProvider: mockEvmProvider,
    });
    expect(onSpoke.ok && onSpoke.value).toBe(rawTx);
    expect(spy.mock.calls[1]?.[0]).toMatchObject({
      srcChainKey: ChainKeys.BSC_MAINNET,
      spender: spokeChainConfig[ChainKeys.BSC_MAINNET].addresses.assetManager,
      raw: true,
    });
    // SwapService currently forwards `walletProvider` as `undefined` in raw mode.
    expect(spy.mock.calls[1]?.[0].walletProvider).toBeUndefined();
  });

  it('delegates Stellar trustline requests to the Stellar spoke service, without walletProvider when raw', async () => {
    const svc = sodax.swaps;
    const rawTx = { from: '0x1', to: '0x2', data: '0x', value: 0n };
    const spy = vi
      .spyOn(svc.spoke, 'approve')
      .mockResolvedValueOnce({ ok: true, value: '0xtrustline' })
      .mockResolvedValueOnce({ ok: true, value: rawTx as never });

    const exec = await svc.approve({
      params: intentInput(ChainKeys.STELLAR_MAINNET),
      raw: false,
      walletProvider: mockStellarProvider,
    });
    const raw = await svc.approve({ params: intentInput(ChainKeys.STELLAR_MAINNET), raw: true });

    expect(exec.ok).toBe(true);
    expect(raw.ok).toBe(true);
    expect(spy.mock.calls[0]?.[0]).toMatchObject({ srcChainKey: ChainKeys.STELLAR_MAINNET, raw: false });
    expect(spy.mock.calls[1]?.[0]).toMatchObject({ raw: true });
    expect(spy.mock.calls[1]?.[0]).not.toHaveProperty('walletProvider');
  });

  it('returns ok:false with explanatory error for unsupported chains (Solana)', async () => {
    const result = await sodax.swaps.approve({
      params: intentInput(ChainKeys.SOLANA_MAINNET),
      raw: false,
      walletProvider: mockSolanaProvider,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(String(result.error)).toMatch(/Approve only supported/);
    }
  });

  it('wraps a spoke.approve failure Result as SodaxError(APPROVE_FAILED) with the cause, and returns a rejection as-is', async () => {
    const approveError = new Error('APPROVE_REJECTED');
    const thrownError = new Error('APPROVE_THROWS');
    vi.spyOn(sodax.spoke, 'approve')
      .mockResolvedValueOnce({ ok: false, error: approveError })
      .mockRejectedValueOnce(thrownError);
    const approveOnBsc = () =>
      sodax.swaps.approve({ params: intentInput(ChainKeys.BSC_MAINNET), raw: false, walletProvider: mockEvmProvider });

    const failed = await approveOnBsc();
    invariant(!failed.ok, 'expected an approve failure');
    expect(isSodaxError(failed.error)).toBe(true);
    expect((failed.error as SodaxError).code).toBe('APPROVE_FAILED');
    expect((failed.error as SodaxError).feature).toBe('swap');
    expect((failed.error as SodaxError).cause).toBe(approveError);

    expect(await approveOnBsc()).toEqual({ ok: false, error: thrownError });
  });

  it('returns ok:false when the EVM or Stellar path receives a wallet provider of another family', async () => {
    const onEvm = await sodax.swaps.approve({
      params: intentInput(ChainKeys.BSC_MAINNET),
      raw: false,
      // Solana provider cast onto an EVM chain — the isOptionalEvmWalletProviderType
      // invariant inside the try block converts the mismatch into a Result failure.
      walletProvider: mockSolanaProvider as unknown as IEvmWalletProvider,
    });
    const onStellar = await sodax.swaps.approve({
      params: intentInput(ChainKeys.STELLAR_MAINNET),
      raw: false,
      walletProvider: mockEvmProvider as unknown as IStellarWalletProvider,
    });

    expect(!onEvm.ok && String(onEvm.error)).toMatch(/Expected Evm wallet provider/);
    expect(!onStellar.ok && String(onStellar.error)).toMatch(/Expected Stellar wallet provider/);
  });
});

describe('SwapService.createIntent', () => {
  describe('happy paths', () => {
    it('on Sonic, delegates to SonicSpokeService.createSwapIntent for both raw and exec', async () => {
      const svc = sodax.swaps;
      const fakeIntent = makeIntent(ChainKeys.SONIC_MAINNET);
      const rawTx = { from: '0x1', to: '0x2', data: '0x', value: 0n };
      mocks.getUserHubWalletAddress.mockResolvedValue('0xhubwallet');
      mocks.sonicCreateSwapIntent
        .mockResolvedValueOnce([rawTx, fakeIntent, 123n, '0xdata'])
        .mockResolvedValueOnce(['0xexec-hash', fakeIntent, 0n, '0xdata']);

      const raw = await svc.createIntent({ params: intentInput(ChainKeys.SONIC_MAINNET), raw: true });
      const exec = await svc.createIntent({
        params: intentInput(ChainKeys.SONIC_MAINNET),
        raw: false,
        walletProvider: mockEvmProvider,
      });

      expect(raw).toEqual({
        ok: true,
        value: {
          tx: rawTx,
          intent: { ...fakeIntent, feeAmount: 123n },
          relayData: { address: fakeIntent.creator, payload: '0xdata' },
        },
      });
      expect(exec).toEqual({
        ok: true,
        value: {
          tx: '0xexec-hash',
          intent: { ...fakeIntent, feeAmount: 0n },
          relayData: { address: fakeIntent.creator, payload: '0xdata' },
        },
      });
      expect(mocks.sonicCreateSwapIntent.mock.calls[0]?.[0].createIntentParams.srcChainKey).toBe(
        ChainKeys.SONIC_MAINNET,
      );
      expect(mocks.sonicCreateSwapIntent.mock.calls[1]?.[0].walletProvider).toBe(mockEvmProvider);
    });

    it('on EVM spokes, builds intent data via EvmSolverService and deposits via SpokeService, raw without walletProvider', async () => {
      const svc = sodax.swaps;
      const params = intentInput(ChainKeys.BSC_MAINNET);
      mocks.getUserHubWalletAddress.mockResolvedValue('0xhubwallet');
      const fakeIntent = makeIntent(ChainKeys.BSC_MAINNET);
      mocks.constructCreateIntentData
        .mockReturnValueOnce(['0xintentdata', fakeIntent, 42n])
        .mockReturnValueOnce(['0xintentdata', fakeIntent, 0n]);
      const rawDepositTx = { from: '0x1', to: '0x2', data: '0x', value: 0n };
      const deposit = vi
        .spyOn(svc.spoke, 'deposit')
        .mockResolvedValueOnce({ ok: true, value: '0xdeposit-hash' })
        .mockResolvedValueOnce({ ok: true, value: rawDepositTx });

      const exec = await svc.createIntent({ params, raw: false, walletProvider: mockEvmProvider });
      const raw = await svc.createIntent({ params, raw: true });

      expect(exec).toEqual({
        ok: true,
        value: {
          tx: '0xdeposit-hash',
          intent: { ...fakeIntent, feeAmount: 42n },
          relayData: { address: fakeIntent.creator, payload: '0xintentdata' },
        },
      });
      expect(deposit.mock.calls[0]?.[0]).toMatchObject({
        srcChainKey: ChainKeys.BSC_MAINNET,
        raw: false,
        walletProvider: mockEvmProvider,
      });

      expect(raw.ok && raw.value.tx).toBe(rawDepositTx);
      const rawDepositCall = deposit.mock.calls[1]?.[0];
      expect(rawDepositCall).not.toHaveProperty('walletProvider');
      expect(rawDepositCall).toMatchObject({
        raw: true,
        srcChainKey: ChainKeys.BSC_MAINNET,
        token: params.inputToken,
        amount: params.inputAmount,
        data: '0xintentdata',
        to: '0xhubwallet',
      });
    });

    it('invokes Bound Exchange access-token setup with the Bitcoin wallet provider when params.srcChain is Bitcoin and raw=false', async () => {
      const svc = sodax.swaps;
      mocks.getUserHubWalletAddress.mockResolvedValueOnce('0xhubwallet');
      mocks.constructCreateIntentData.mockReturnValueOnce(['0xintentdata', makeIntent(ChainKeys.BITCOIN_MAINNET), 0n]);
      vi.spyOn(svc.spoke, 'deposit').mockResolvedValueOnce({ ok: true, value: '0xdeposit-hash' });
      const effectiveAddressSpy = vi
        .spyOn(svc.spoke.bitcoin, 'getEffectiveWalletAddress')
        .mockImplementation(async (a: string) => a);
      const ensureRadfiSpy = vi.spyOn(svc.spoke.bitcoin.radfi, 'ensureRadfiAccessToken').mockResolvedValue(undefined);

      await svc.createIntent({
        params: { ...intentInput(ChainKeys.BITCOIN_MAINNET), srcAddress: 'bc1qusersource' },
        raw: false,
        walletProvider: mockBitcoinProvider,
      });

      expect(effectiveAddressSpy).toHaveBeenCalledWith('bc1qusersource');
      expect(ensureRadfiSpy).toHaveBeenCalledWith(mockBitcoinProvider);
    });

    it('on Bitcoin raw=true, derives the trading address, skips Bound auth, and threads extras.bound.accessToken to deposit', async () => {
      const svc = sodax.swaps;
      mocks.getUserHubWalletAddress.mockResolvedValueOnce('0xhubwallet');
      mocks.constructCreateIntentData.mockReturnValueOnce(['0xintentdata', makeIntent(ChainKeys.BITCOIN_MAINNET), 0n]);
      const rawDepositTx = { from: '0x1', to: '0x2', data: '0x', value: 0n };
      vi.spyOn(svc.spoke, 'deposit').mockResolvedValueOnce({ ok: true, value: rawDepositTx });
      // Trading-address derivation still runs on the raw path — it resolves the wallet via Bound.
      const effectiveAddressSpy = vi
        .spyOn(svc.spoke.bitcoin, 'getEffectiveWalletAddress')
        .mockResolvedValueOnce('bc1qtradingwallet');
      // Bound auth (ensureRadfiAccessToken) is a non-raw concern; raw must never trigger the sign-in.
      const ensureRadfiSpy = vi.spyOn(svc.spoke.bitcoin.radfi, 'ensureRadfiAccessToken').mockResolvedValue(undefined);

      const result = await svc.createIntent({
        params: { ...intentInput(ChainKeys.BITCOIN_MAINNET), srcAddress: 'bc1qusersource' },
        extras: { bound: { accessToken: 'bound-token' } },
        raw: true,
      });

      expect(result.ok).toBe(true);
      if (result.ok) expect(result.value.tx).toBe(rawDepositTx);

      expect(effectiveAddressSpy).toHaveBeenCalledWith('bc1qusersource');
      expect(ensureRadfiSpy).not.toHaveBeenCalled();

      const depositCall = (svc.spoke.deposit as ReturnType<typeof vi.fn>).mock.calls[0]?.[0];
      expect(depositCall.raw).toBe(true);
      expect(depositCall).not.toHaveProperty('walletProvider');
      expect(depositCall.srcChainKey).toBe(ChainKeys.BITCOIN_MAINNET);
      // Deposit originates from the derived trading address, not the user's personal address.
      expect(depositCall.srcAddress).toBe('bc1qtradingwallet');
      // extras.bound.accessToken threads through to DepositParams.accessToken.
      expect(depositCall.accessToken).toBe('bound-token');
    });
  });

  // Preflight `invariant()` checks run inside `createIntent`'s try/catch; failures resolve to
  // `{ ok: false, error }` where `error` is a SodaxError with code `VALIDATION_FAILED`.
  describe('rejects on invalid inputs', () => {
    const createOnBsc = (params = intentInput(ChainKeys.BSC_MAINNET)) =>
      sodax.swaps.createIntent({ params, raw: false, walletProvider: mockEvmProvider });
    const expectValidationFailure = (result: Result<unknown, SodaxError>, message: string) => {
      invariant(!result.ok, 'expected a validation failure');
      expect(isSodaxError(result.error)).toBe(true);
      expect(result.error.code).toBe('VALIDATION_FAILED');
      expect(result.error.message).toContain(message);
    };

    it('rejects when walletProvider chainType does not match srcChain', async () => {
      const result = await sodax.swaps.createIntent({
        params: intentInput(ChainKeys.BSC_MAINNET),
        raw: false,
        // Solana provider on an EVM chain — the chainType mismatch trips the
        // `isUndefinedOrValidWalletProviderForChainKey` invariant. Cast defeats the
        // compile-time narrowing that would otherwise reject the call site.
        walletProvider: mockSolanaProvider as unknown as IEvmWalletProvider,
      });

      expectValidationFailure(result, 'Invalid wallet provider for chain key: 0x38.bsc');
      expect(!result.ok && result.error.context?.phase).toBe('validate');
    });

    it('rejects an input or output token that is not a valid original asset on its chain', async () => {
      // Fail only the targeted call, so the result names which side tripped.
      vi.spyOn(sodax.config, 'isValidOriginalAssetAddress').mockReturnValueOnce(false);
      expectValidationFailure(await createOnBsc(), 'Unsupported spoke chain token (srcChainKey)');

      vi.spyOn(sodax.config, 'isValidOriginalAssetAddress').mockReturnValueOnce(true).mockReturnValueOnce(false);
      expectValidationFailure(await createOnBsc(), 'Unsupported spoke chain token (params.dstChain)');
    });

    it('rejects a srcChain or dstChain that is not a valid spoke chain key', async () => {
      vi.spyOn(sodax.config, 'isValidSpokeChainKey').mockReturnValueOnce(false);
      expectValidationFailure(await createOnBsc(), 'Invalid spoke chain (srcChainKey)');

      vi.spyOn(sodax.config, 'isValidSpokeChainKey').mockReturnValueOnce(true).mockReturnValueOnce(false);
      expectValidationFailure(await createOnBsc(), 'Invalid spoke chain (params.dstChain)');
    });

    it('rejects native BTC amounts below the 546 sat dust limit on either side', async () => {
      // `outputToken` / `inputToken` are original asset addresses, not symbols — native BTC on Bitcoin is '0:0'.
      // The guard must resolve the address to its token descriptor, so the real address has to be used.
      const btc = spokeChainConfig[ChainKeys.BITCOIN_MAINNET].supportedTokens.BTC.address;
      const toBitcoin = await createOnBsc({
        ...intentInput(ChainKeys.BSC_MAINNET),
        dstChainKey: ChainKeys.BITCOIN_MAINNET,
        outputToken: btc,
        minOutputAmount: 100n,
      });
      expectValidationFailure(toBitcoin, 'Invalid minOutputAmount');
      expect(!toBitcoin.ok && toBitcoin.error.message).toContain('dust limit');

      // The raw path lets the source-side invariant trip before any wallet step.
      const fromBitcoin = await sodax.swaps.createIntent({
        params: { ...intentInput(ChainKeys.BITCOIN_MAINNET), inputToken: btc, inputAmount: 100n },
        raw: true,
      });
      expectValidationFailure(fromBitcoin, 'Invalid inputAmount');
      expect(!fromBitcoin.ok && fromBitcoin.error.message).toContain('dust limit');
    });
  });

  // Failures from collaborators inside the try/catch are surfaced as `{ok:false, error}`, wrapped via
  // `classifyCreateIntentError` into `SodaxError('INTENT_CREATION_FAILED', …, { cause: rawError })`.
  describe('propagates internal errors as Result.error', () => {
    it('wraps a thrown collaborator error (hub wallet lookup) or a returned deposit failure as INTENT_CREATION_FAILED', async () => {
      const hubError = new Error('HUB_WALLET_LOOKUP_FAILED');
      const depositError = new Error('DEPOSIT_REJECTED_BY_RPC');
      mocks.getUserHubWalletAddress.mockRejectedValueOnce(hubError).mockResolvedValueOnce('0xhubwallet');
      mocks.constructCreateIntentData.mockReturnValueOnce(['0xintentdata', makeIntent(ChainKeys.BSC_MAINNET), 0n]);
      vi.spyOn(sodax.spoke, 'deposit').mockResolvedValueOnce({ ok: false, error: depositError });

      for (const cause of [hubError, depositError]) {
        const result = await sodax.swaps.createIntent({
          params: intentInput(ChainKeys.BSC_MAINNET),
          raw: false,
          walletProvider: mockEvmProvider,
        });
        invariant(!result.ok, 'expected an intent creation failure');
        expect(isSodaxError(result.error)).toBe(true);
        expect(result.error.code).toBe('INTENT_CREATION_FAILED');
        expect(result.error.cause).toBe(cause);
        expect(result.error.context?.phase).toBe('intentCreation');
      }
    });
  });
});

describe('SwapService.createLimitOrder and createLimitOrderIntent', () => {
  it('createLimitOrder forces deadline=0n, routes through swap() and returns its Result', async () => {
    const svc = sodax.swaps;
    const baseInput = intentInput(ChainKeys.BSC_MAINNET);
    const swapError = new SodaxError('EXECUTION_FAILED', 'swap failed', { feature: 'swap' });
    const swapSpy = vi.spyOn(svc, 'swap').mockResolvedValueOnce({ ok: false, error: swapError });

    // Pass a non-zero deadline — the method must override it to 0n.
    const result = await svc.createLimitOrder({
      params: { ...baseInput, deadline: 42n },
      raw: false,
      walletProvider: mockEvmProvider,
    });

    expect(result).toEqual({ ok: false, error: swapError });
    expect(swapSpy).toHaveBeenCalledTimes(1);
    const forwarded = swapSpy.mock.calls[0]?.[0];
    expect((forwarded?.params as CreateIntentParams).deadline).toBe(0n);
    expect(forwarded?.params.srcChainKey).toBe(ChainKeys.BSC_MAINNET);
    expect(forwarded?.walletProvider).toBe(mockEvmProvider);
  });

  it('createLimitOrderIntent delegates to createIntent with deadline=0n, preserving raw/K and the walletProvider', async () => {
    const svc = sodax.swaps;
    const baseInput = intentInput(ChainKeys.BSC_MAINNET);
    const fakeIntent = makeIntent(ChainKeys.BSC_MAINNET);
    const createError = new SodaxError('INTENT_CREATION_FAILED', 'create intent failed', { feature: 'swap' });
    const createIntentSpy = vi
      .spyOn(svc, 'createIntent')
      .mockResolvedValueOnce({
        ok: true,
        value: {
          tx: '0xtx' as never,
          intent: { ...fakeIntent, feeAmount: 0n },
          relayData: '0x' as never,
        },
      })
      .mockResolvedValueOnce({ ok: false, error: createError });

    await svc.createLimitOrderIntent({ params: { ...baseInput, deadline: 9999n }, raw: true });
    const failed = await svc.createLimitOrderIntent({ params: baseInput, raw: false, walletProvider: mockEvmProvider });

    expect(createIntentSpy).toHaveBeenCalledTimes(2);
    const [rawCall, execCall] = createIntentSpy.mock.calls.map(call => call[0]);
    expect((rawCall?.params as CreateIntentParams).deadline).toBe(0n);
    expect(rawCall?.params.srcChainKey).toBe(ChainKeys.BSC_MAINNET);
    expect((execCall?.params as CreateIntentParams).deadline).toBe(0n);
    expect(execCall?.walletProvider).toBe(mockEvmProvider);
    expect(failed).toEqual({ ok: false, error: createError });
  });
});

describe('SwapService.cancelIntent', () => {
  it('sends a cancel message via SpokeService.sendMessage with the resolved srcChainKey', async () => {
    const svc = sodax.swaps;
    // Use hub-chain flow (Sonic) so cancelIntent doesn't need relayer submit + wait.
    const intent = makeIntent(ChainKeys.SONIC_MAINNET);
    vi.spyOn(svc.spoke, 'sendMessage').mockResolvedValueOnce({ ok: true, value: '0xcancel-hash' });

    const result = await svc.cancelIntent({
      params: {
        srcChainKey: ChainKeys.SONIC_MAINNET,
        intent,
      },
      walletProvider: mockEvmProvider,
    });

    expect(result).toEqual({ ok: true, value: { srcChainTxHash: '0xcancel-hash', dstChainTxHash: '0xcancel-hash' } });
    const sendCall = (svc.spoke.sendMessage as ReturnType<typeof vi.fn>).mock.calls[0]?.[0];
    expect(sendCall.srcChainKey).toBe(ChainKeys.SONIC_MAINNET);
    expect(sendCall.walletProvider).toBe(mockEvmProvider);
    expect(sendCall.raw).toBe(false);
  });

  // Note: SwapService.cancelIntent is exec-only by design — the raw twin lives at
  // createCancelIntent<K, true>. Runtime coverage for the raw path belongs there.

  it('fails when srcChainKey disagrees with intent.srcChain', async () => {
    const svc = sodax.swaps;
    const sendMessageSpy = vi.spyOn(svc.spoke, 'sendMessage');
    // Intent says BSC, but we pass Arbitrum as srcChainKey — should fail the runtime assert.
    const intent = makeIntent(ChainKeys.BSC_MAINNET);

    const result = await svc.cancelIntent({
      params: {
        srcChainKey: ChainKeys.ARBITRUM_MAINNET,
        intent,
      },
      walletProvider: mockEvmProvider,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(String(result.error)).toMatch(/does not match intent\.srcChain/);
    }
    // sendMessage must NOT have been called because the assert fires before it.
    expect(sendMessageSpy).not.toHaveBeenCalled();
  });
});

// =========================================================================
// Batch 1: simple getters — pure/thin wrappers with little-to-no I/O.
// =========================================================================

describe('SwapService.getPartnerFee', () => {
  it('returns 0n regardless of the input amount when no partnerFee is configured', () => {
    // Default `new Sodax()` has no partnerFee in config, so the early-return branch fires.
    expect(sodax.swaps.getPartnerFee(1_000_000n)).toBe(0n);
    expect(sodax.swaps.getPartnerFee(0n)).toBe(0n);
    expect(sodax.swaps.getPartnerFee(10n ** 30n)).toBe(0n);
  });

  it('charges the swap partnerFee, falling back to the global fee when no swap-specific one is set', () => {
    // 100 basis points = 1% → non-zero fee on a non-zero input. Asserting > 0 rather than a
    // specific value because calculateFeeAmount's rounding isn't what this test is about.
    const sodaxWithFee = new Sodax({
      swaps: { partnerFee: { address: '0x3333333333333333333333333333333333333333', percentage: 100 } },
    });
    expect(sodaxWithFee.swaps.getPartnerFee(1_000_000n)).toBeGreaterThan(0n);

    // Regression: the effective swap fee is `swaps.partnerFee ?? fee`, so a global-only fee is charged too.
    const globalFee = { address: '0x5555555555555555555555555555555555555555', percentage: 25 } as const;
    const sodaxWithGlobalFee = new Sodax({ fee: globalFee });
    expect(sodaxWithGlobalFee.swaps.partnerFee).toEqual(globalFee);
    expect(sodaxWithGlobalFee.swaps.getPartnerFee(1_000_000n)).toBeGreaterThan(0n);
  });
});

describe('SwapService.getSwapSpeedTier', () => {
  it('recognizes a real packaged reserve asset despite its mixed-case checksummed config address', () => {
    // Regression test for a case-sensitivity bug: packaged reserve addresses (from SodaTokens) are
    // EIP-55 checksummed mixed-case, but ConfigService.isMoneyMarketReserveAsset lowercases its
    // query — so the Set backing it must be normalized too, or every checksummed entry silently
    // misses and every sodaAsset pair reports the slow default tier instead of the fast one.
    const reserveHubAsset = sodax.config
      .getMoneyMarketReserveAssets()
      .find(address => address !== address.toLowerCase());
    if (!reserveHubAsset) {
      throw new Error('no mixed-case packaged reserve asset found — this test needs one to exercise the bug it guards');
    }

    const result = sodax.swaps.getSwapSpeedTier({
      srcToken: {
        symbol: 'RESERVE',
        name: 'Reserve',
        decimals: 18,
        address: reserveHubAsset,
        chainKey: ChainKeys.BSC_MAINNET,
        hubAsset: reserveHubAsset,
        vault: reserveHubAsset,
      },
      dstToken: {
        symbol: 'PLAIN',
        name: 'Plain',
        decimals: 18,
        address: '0x2222222222222222222222222222222222222222',
        chainKey: ChainKeys.BSC_MAINNET,
        hubAsset: '0x2222222222222222222222222222222222222222',
        vault: '0x2222222222222222222222222222222222222222',
      },
    });

    expect(result).toEqual({ tier: 'fast', estimatedSeconds: SPEED_TIER_SECONDS.sodaAsset });
  });

  it('does not count a stock vault as a sodaAsset even when it is a money-market reserve', () => {
    const robinhood = spokeChainConfig[ChainKeys.ROBINHOOD_MAINNET].supportedTokens;
    expect(sodax.config.isMoneyMarketReserveAsset(robinhood.AAPL.vault)).toBe(true);

    expect(sodax.swaps.getSwapSpeedTier({ srcToken: robinhood.AAPL, dstToken: robinhood.GME })).toEqual({
      tier: 'slow',
      estimatedSeconds: SPEED_TIER_SECONDS.default,
    });
    // The stablecoin side is still a sodaAsset, so the common route keeps its fast tier.
    expect(sodax.swaps.getSwapSpeedTier({ srcToken: robinhood.USDG, dstToken: robinhood.AAPL })).toEqual({
      tier: 'fast',
      estimatedSeconds: SPEED_TIER_SECONDS.sodaAsset,
    });
  });
});

describe('SwapService.getSwapDeadline', () => {
  it('returns the hub block timestamp plus the deadline offset, or ok:false for a zero deadline or a failed block read', async () => {
    const blockTimestamp = 1_700_000_000n;
    const rpcError = new Error('RPC_DOWN');
    const getBlockSpy = vi
      .spyOn(sodax.hubProvider.publicClient, 'getBlock')
      .mockResolvedValueOnce({ timestamp: blockTimestamp } as never)
      .mockRejectedValueOnce(rpcError);

    expect(await sodax.swaps.getSwapDeadline(300n)).toEqual({ ok: true, value: blockTimestamp + 300n });
    expect(getBlockSpy).toHaveBeenCalledWith({ includeTransactions: false, blockTag: 'latest' });

    const zero = await sodax.swaps.getSwapDeadline(0n);
    expect(!zero.ok && String(zero.error)).toMatch(/Deadline must be greater than 0/);
    expect(await sodax.swaps.getSwapDeadline(60n)).toEqual({ ok: false, error: rpcError });
  });
});

// =========================================================================
// Batch 2: thin wrappers around static helpers / spoke methods.
// =========================================================================

describe('SwapService.getIntentSubmitTxExtraData', () => {
  it('when given a txHash, fetches the intent first then reconstructs from it — or returns the lookup or encoding failure as-is', async () => {
    const intent = makeIntent(ChainKeys.BSC_MAINNET);
    const lookupError = new Error('INTENT_NOT_FOUND');
    const encodeError = new Error('ENCODE_FAILED');
    mocks.getIntent.mockResolvedValueOnce(intent).mockRejectedValueOnce(lookupError);
    mocks.reconstructCreateIntentData.mockReturnValueOnce('0xspokepayload2').mockImplementationOnce(() => {
      throw encodeError;
    });

    const found = await sodax.swaps.getIntentSubmitTxExtraData({ txHash: '0xtxhash' });
    expect(found).toEqual({ ok: true, value: { address: intent.creator, payload: '0xspokepayload2' } });
    expect(mocks.reconstructCreateIntentData).toHaveBeenCalledWith(intent, intentsContract, false);
    expect(mocks.encodeCreateIntent).not.toHaveBeenCalled();

    const missing = await sodax.swaps.getIntentSubmitTxExtraData({ txHash: '0xmissing' });
    expect(missing).toEqual({ ok: false, error: lookupError });
    expect(mocks.reconstructCreateIntentData).toHaveBeenCalledTimes(1);

    // An intent passed directly skips the lookup; reconstructRelayData's ok:false Result propagates.
    expect(await sodax.swaps.getIntentSubmitTxExtraData({ intent })).toEqual({ ok: false, error: encodeError });
  });
});

describe('SwapService.reconstructRelayData', () => {
  it('reconstructs relay data with isHubSource set by the source chain (spoke vs Sonic hub)', () => {
    const spokeIntent = makeIntent(ChainKeys.BSC_MAINNET);
    const hubIntent = makeIntent(ChainKeys.SONIC_MAINNET);
    mocks.reconstructCreateIntentData.mockReturnValueOnce('0xspokepayload').mockReturnValueOnce('0xhubpayload');

    expect(sodax.swaps.reconstructRelayData(spokeIntent)).toEqual({
      ok: true,
      value: { address: spokeIntent.creator, payload: '0xspokepayload' },
    });
    expect(sodax.swaps.reconstructRelayData(hubIntent)).toEqual({
      ok: true,
      value: { address: hubIntent.creator, payload: '0xhubpayload' },
    });
    expect(mocks.reconstructCreateIntentData).toHaveBeenNthCalledWith(1, spokeIntent, intentsContract, false);
    expect(mocks.reconstructCreateIntentData).toHaveBeenNthCalledWith(2, hubIntent, intentsContract, true);
  });

  it('returns ok:false when intent.srcChain or intent.dstChain is not a valid relay chain id', () => {
    vi.spyOn(sodax.config, 'isValidIntentRelayChainId').mockReturnValueOnce(false);
    expect(sodax.swaps.reconstructRelayData(makeIntent(ChainKeys.BSC_MAINNET)).ok).toBe(false);

    vi.spyOn(sodax.config, 'isValidIntentRelayChainId').mockReturnValueOnce(true).mockReturnValueOnce(false);
    expect(sodax.swaps.reconstructRelayData(makeIntent(ChainKeys.BSC_MAINNET)).ok).toBe(false);

    expect(mocks.reconstructCreateIntentData).not.toHaveBeenCalled();
  });
});

describe('SwapService.getSolvedIntentPacket', () => {
  // The intent relay never delivers to an MPC-relay chain, so asking it could only time out.
  it('fails for an MPC-relay destination without asking the relayer or inventing a packet', async () => {
    const release = vi.spyOn(sodax.spoke, 'submitHubRelease');

    const result = await sodax.swaps.getSolvedIntentPacket({ chainId: ChainKeys.TRON_MAINNET, fillTxHash: '0xfill' });

    invariant(!result.ok, 'expected a refusal');
    expect(String(result.error)).toContain('waitForIntentDelivery');
    expect(mocks.waitUntilIntentExecuted).not.toHaveBeenCalled();
    expect(release).not.toHaveBeenCalled();
  });
});

describe('SwapService.waitForIntentDelivery', () => {
  const RELEASE = { dstChainKey: ChainKeys.TRON_MAINNET, hubChainId: '146', hubTxHash: '0xfill', logIndex: 3 };

  it('returns a hub fill without asking the relay packet API, and refuses a reverted one', async () => {
    const error = new Error('reverted');
    vi.spyOn(sodax.spoke, 'waitForTxReceipt')
      .mockResolvedValueOnce({ ok: true, value: { status: 'success', receipt: {} } })
      .mockResolvedValueOnce({ ok: true, value: { status: 'failure', error } });
    const read = () => sodax.swaps.waitForIntentDelivery({ chainId: ChainKeys.SONIC_MAINNET, fillTxHash: '0xfill' });

    expect(await read()).toEqual({ ok: true, value: { source: 'hub', dstTxHash: '0xfill' } });
    expect(await read()).toEqual({ ok: false, error });
    expect(mocks.waitUntilIntentExecuted).not.toHaveBeenCalled();
  });

  it('returns the relay packet and its destination tx for an intent-relay destination', async () => {
    const packet = { dst_tx_hash: '0xdstTxHash' };
    mocks.waitUntilIntentExecuted.mockResolvedValueOnce({ ok: true, value: packet });

    const result = await sodax.swaps.waitForIntentDelivery({ chainId: ChainKeys.BSC_MAINNET, fillTxHash: '0xfill' });

    expect(result).toEqual({ ok: true, value: { source: 'relay', dstTxHash: '0xdstTxHash', packet } });
  });

  it('submits the fill as a release to an MPC-relay destination, waits on that same release, and surfaces its failure itself', async () => {
    const timeoutError = new Error('RELAY_TIMEOUT');
    const submit = vi.spyOn(sodax.spoke, 'submitHubRelease').mockResolvedValue({ ok: true, value: RELEASE });
    const wait = vi
      .spyOn(sodax.spoke, 'waitForHubRelease')
      .mockResolvedValueOnce({ ok: true, value: { srcChainTxHash: '0xfill', dstChainTxHash: 'tronPayout' } })
      .mockResolvedValueOnce({ ok: false, error: { phase: 'relay', cause: timeoutError } });
    const deliver = () =>
      sodax.swaps.waitForIntentDelivery({ chainId: ChainKeys.TRON_MAINNET, fillTxHash: '0xfill', timeout: 5_000 });

    expect(await deliver()).toEqual({
      ok: true,
      value: { source: 'mpcRelay', dstTxHash: 'tronPayout', release: RELEASE },
    });
    expect(submit).toHaveBeenCalledWith({ hubTxHash: '0xfill', dstChainKey: ChainKeys.TRON_MAINNET });
    expect(wait).toHaveBeenCalledWith({ release: RELEASE, timeout: 5_000 });
    expect(mocks.waitUntilIntentExecuted).not.toHaveBeenCalled();
    // The relay failure itself, so RELAY_TIMEOUT stays readable on `error.message`.
    expect(await deliver()).toEqual({ ok: false, error: timeoutError });
  });
});

// =========================================================================
// Batch 3: relayer / solver API facade methods.
// =========================================================================

// Typed against `IntentResponse` rather than cast through `as never`, so a change to the wire
// shape breaks these fixtures at compile time. `allowPartialFill` is spelled out because it is
// what makes a partial fill a legitimate state rather than a malformed record. Module-scoped
// because the durable-record reconcile is reachable from both `getStatus` and `getDetailedStatus`.
const intentResponse = (events: unknown[], allowPartialFill = false): IntentResponse => ({
  intentHash: '0xintent',
  txHash: '0xhub',
  logIndex: 0,
  chainId: 146,
  blockNumber: 1,
  open: allowPartialFill,
  intent: {
    intentId: '1',
    creator: '0xcreator',
    inputToken: '0xin',
    outputToken: '0xout',
    inputAmount: '1000',
    minOutputAmount: '900',
    deadline: '0',
    allowPartialFill,
    srcChain: 1,
    dstChain: 146,
    srcAddress: '0xsrc',
    dstAddress: '0xdst',
    solver: '0xsolver',
    data: '0x',
  },
  events,
});
const cancelEvent = { eventType: 'intent-cancelled', txHash: '0xcancel' };

describe('SwapService.getStatus', () => {
  const request = { intent_tx_hash: '0xsome' } as const;
  const FILL_HASH = '0xfill';
  // `remainingInput: '0'` is what makes a fill terminal; a partial fill leaves a remainder.
  const fillEvent = { eventType: 'intent-filled', txHash: FILL_HASH, intentState: { remainingInput: '0' } };
  const partialFill = (txHash: string, remainingInput: string) => ({
    eventType: 'intent-filled',
    txHash,
    intentState: { remainingInput },
  });

  const backendReturns = (events: unknown[], allowPartialFill = false) =>
    vi
      .spyOn(sodax.swaps.backendApi, 'getIntentByTxHash')
      .mockResolvedValueOnce({ ok: true, value: intentResponse(events, allowPartialFill) });

  // Reading a journal cancel as FAILED is `getDetailedStatus`'s; this one keeps the solver's answers.
  it('returns a usable or in-flight solver answer without querying the backend', async () => {
    const statusResult = { ok: true as const, value: { status: 3, intent_hash: '0xhash' } };
    const inFlight = { ok: true as const, value: { status: SolverIntentStatusCode.STARTED_NOT_FINISHED } };
    mocks.solverGetStatus.mockResolvedValueOnce(statusResult).mockResolvedValueOnce(inFlight);
    const backendSpy = vi.spyOn(sodax.swaps.backendApi, 'getIntentByTxHash');

    expect(await sodax.swaps.getStatus(request)).toBe(statusResult);
    // Trailing `undefined` is the point: public `getStatus` is a one-shot read the caller bounds
    // however it likes, so it forwards no budget. Only `getDetailedStatus`, which is polled, does.
    expect(mocks.solverGetStatus).toHaveBeenCalledWith(
      request,
      sodax.swaps.solver,
      sodax.swaps.config.logger,
      undefined,
      sodax.swaps.config.apiKey,
    );
    expect(await sodax.swaps.getStatus(request)).toBe(inFlight);
    expect(backendSpy).not.toHaveBeenCalled();
  });

  it('reconciles a NOT_FOUND or a failed solver read to SOLVED from the fill that consumed the remainder', async () => {
    const solved = { ok: true, value: { status: SolverIntentStatusCode.SOLVED, fill_tx_hash: FILL_HASH } };
    mocks.solverGetStatus.mockResolvedValueOnce({ ok: true, value: { status: SolverIntentStatusCode.NOT_FOUND } });
    backendReturns([fillEvent]);
    expect(await sodax.swaps.getStatus(request)).toEqual(solved);

    mocks.solverGetStatus.mockResolvedValueOnce({ ok: false, error: { code: 'BOOM' } });
    backendReturns([fillEvent]);
    expect(await sodax.swaps.getStatus(request)).toEqual(solved);

    mocks.solverGetStatus.mockResolvedValueOnce({ ok: true, value: { status: SolverIntentStatusCode.NOT_FOUND } });
    backendReturns([partialFill('0xpartial1', '2000'), partialFill('0xpartial2', '1000'), fillEvent], true);
    expect(await sodax.swaps.getStatus(request)).toEqual(solved);
  });

  // Which journals prove a fill is readIntentJournalOutcome's to test; a cancel must not read as FAILED here.
  it('keeps the solver NOT_FOUND when the journal shows a cancel', async () => {
    const notFound = { ok: true as const, value: { status: SolverIntentStatusCode.NOT_FOUND } };
    mocks.solverGetStatus.mockResolvedValueOnce(notFound);
    backendReturns([cancelEvent]);

    expect(await sodax.swaps.getStatus(request)).toBe(notFound);
  });

  // A per-call `timeout` REPLACES the configured one rather than capping it, so a fixed override
  // would lengthen the reconcile for a consumer who configured something stricter than the ceiling.
  it.each([
    ['clamps to a stricter configured backend timeout', 1_000, 1_000],
    ['keeps its own ceiling under the default backend timeout', undefined, 5_000],
  ])('%s', async (_label, configured, expected) => {
    const s = configured === undefined ? new Sodax() : new Sodax({ api: { timeout: configured } });
    mocks.solverGetStatus.mockResolvedValueOnce({ ok: true, value: { status: SolverIntentStatusCode.NOT_FOUND } });
    const lookup = vi
      .spyOn(s.backendApi, 'getIntentByTxHash')
      .mockResolvedValueOnce({ ok: false, error: new Error('down') });

    await s.swaps.getStatus(request);

    expect(lookup).toHaveBeenCalledWith(request.intent_tx_hash, { timeout: expected });
  });

  // A solver error is the better diagnostic; a NOT_FOUND is definitive only when the backend's 404 confirms
  // it has no record, otherwise it fails so a poller keeps retrying.
  it('after an unreadable journal, keeps a solver error and a NOT_FOUND the backend 404 confirms, and fails an unverified NOT_FOUND', async () => {
    const solverError = { ok: false, error: { code: 'INTENT_NOT_FOUND' } };
    const notFound = { ok: true as const, value: { status: SolverIntentStatusCode.NOT_FOUND } };
    mocks.solverGetStatus
      .mockResolvedValueOnce(solverError)
      .mockResolvedValueOnce(notFound)
      .mockResolvedValueOnce(notFound);
    vi.spyOn(sodax.swaps.backendApi, 'getIntentByTxHash')
      .mockResolvedValueOnce({ ok: false, error: new Error('down') })
      .mockResolvedValueOnce({
        ok: false,
        error: new SodaxError('EXTERNAL_API_ERROR', 'not found', {
          feature: 'backend',
          context: { api: 'backend', status: 404 },
        }),
      })
      .mockResolvedValueOnce({ ok: false, error: new Error('down') });

    expect(await sodax.swaps.getStatus(request)).toBe(solverError);
    expect(await sodax.swaps.getStatus(request)).toBe(notFound);
    const unverified = await sodax.swaps.getStatus(request);
    invariant(!unverified.ok, 'expected an unverified NOT_FOUND to fail');
    expect(unverified.error.detail.code).toBe(SolverIntentErrorCode.UNKNOWN);
    expect(unverified.error.detail.message).toBe(
      'solver reported NOT_FOUND and the durable intent record could not be read to verify it',
    );
  });
});

describe('SwapService.getDetailedStatus', () => {
  const SRC_CHAIN = ChainKeys.ARBITRUM_MAINNET;
  // Real hex: the hub hash is validated before it reaches the solver, so a placeholder like
  // '0xsrc' would be rejected as malformed rather than exercising the path under test.
  const SRC_TX = '0xabc123';
  const HUB_TX = '0xdef456';
  const key = { srcChainKey: SRC_CHAIN, srcTxHash: SRC_TX } as const;

  // Typed against the wire contract rather than cast through `as never`, so a change to
  // `SubmitTxStatusDataV2` breaks these fixtures at compile time instead of silently drifting.
  const submitTxData = (data: Partial<SubmitTxStatusDataV2>): SubmitTxStatusDataV2 => ({
    txHash: SRC_TX,
    srcChainKey: SRC_CHAIN,
    status: 'relaying',
    processingAttempts: 1,
    ...data,
  });
  const record = (data: Partial<SubmitTxStatusDataV2>) =>
    vi
      .spyOn(sodax.swaps.backendApi.swaps, 'getSubmitTxStatus')
      .mockResolvedValueOnce({ ok: true, value: { success: true, data: submitTxData(data) } });

  // Schema-valid, but the wire contract's `success: false` means no record was found — `data` is
  // not authoritative status however healthy it looks.
  const recordNotFound = (data: Partial<SubmitTxStatusDataV2>) =>
    vi
      .spyOn(sodax.swaps.backendApi.swaps, 'getSubmitTxStatus')
      .mockResolvedValueOnce({ ok: true, value: { success: false, data: submitTxData(data) } });

  const backendFails = (message: string, status: number) =>
    vi.spyOn(sodax.swaps.backendApi.swaps, 'getSubmitTxStatus').mockResolvedValueOnce({
      ok: false,
      error: new SodaxError('EXTERNAL_API_ERROR', message, {
        feature: 'backend',
        context: { api: 'swaps', status },
      }),
    });

  const noRecord = () => backendFails('not found', 404);
  // Routing keys off "can the backend answer", not off the status code, so a non-404 failure has to
  // fall through too — a transient 500 must not fail a swap the solver can still report on.
  const backendErrors = (status: number) => backendFails('backend unavailable', status);

  const packets = (data: unknown[]) =>
    mocks.getTransactionPackets.mockResolvedValueOnce({ ok: true, value: { success: true, data } });
  // Carries the identity fields the attribution guard matches on, so the happy paths exercise it.
  const delivered = [
    {
      status: 'executed',
      dst_tx_hash: HUB_TX,
      src_tx_hash: SRC_TX,
      src_chain_id: Number(getIntentRelayChainId(SRC_CHAIN)),
    },
  ];
  const solverSays = (status: SolverIntentStatusCode, fill_tx_hash?: string) =>
    mocks.solverGetStatus.mockResolvedValueOnce({ ok: true, value: { status, fill_tx_hash } });
  const solverDown = () =>
    mocks.solverGetStatus.mockResolvedValueOnce({ ok: false, error: { detail: { code: -999, message: 'down' } } });
  const journalReturns = (intent: IntentResponse) =>
    vi.spyOn(sodax.swaps.backendApi, 'getIntentByTxHash').mockResolvedValueOnce({ ok: true, value: intent });
  const journalFails = (error: Error = new Error('x')) =>
    vi.spyOn(sodax.swaps.backendApi, 'getIntentByTxHash').mockResolvedValueOnce({ ok: false, error });
  const solverArm = (data: SolverIntentStatusResponse) => ({
    ok: true,
    value: { source: 'solver', dstTxHash: HUB_TX, data },
  });
  const lookupFailure = (result: Awaited<ReturnType<typeof sodax.swaps.getDetailedStatus>>) => {
    invariant(!result.ok && isSodaxError(result.error), 'expected LOOKUP_FAILED');
    expect(result.error.code).toBe('LOOKUP_FAILED');
    return result.error;
  };

  // ── the backend record, while it is still in play ────────────────────────

  it('returns the unmodified submit-tx record without touching the relay or the solver', async () => {
    record({ status: 'posting_execution', userMessage: 'almost there', result: { dstIntentTxHash: HUB_TX } });

    expect(await sodax.swaps.getDetailedStatus(key)).toEqual({
      ok: true,
      value: {
        source: 'backend',
        data: submitTxData({
          status: 'posting_execution',
          userMessage: 'almost there',
          result: { dstIntentTxHash: HUB_TX },
        }),
      },
    });
    expect(mocks.getTransactionPackets).not.toHaveBeenCalled();
    expect(mocks.solverGetStatus).not.toHaveBeenCalled();
  });

  // ── routing to the solver ────────────────────────────────────────────────

  // This read is polled on a short interval, so neither dependency may hold it open: a hung relay or
  // solver would leave `useDetailedStatus` without another result to act on. The budget's *effect* is
  // covered in the two client test suites; what matters here is that it is passed at all.
  it('routes to the solver when the backend has no record, bounding both the relay and the solver read', async () => {
    noRecord();
    packets(delivered);
    solverSays(SolverIntentStatusCode.SOLVED, '0xfill');
    const journalSpy = vi.spyOn(sodax.swaps.backendApi, 'getIntentByTxHash');

    expect(await sodax.swaps.getDetailedStatus(key)).toEqual(
      solverArm({ status: SolverIntentStatusCode.SOLVED, fill_tx_hash: '0xfill' }),
    );
    // The relay takes its own module's per-request budget rather than a tighter one invented here:
    // a budget below what the relay path already tolerates would abort reads that succeed today.
    expect(mocks.getTransactionPackets).toHaveBeenCalledWith(expect.anything(), expect.anything(), 15_000);
    expect(mocks.solverGetStatus).toHaveBeenCalledWith(
      { intent_tx_hash: HUB_TX },
      sodax.swaps.solver,
      sodax.swaps.config.logger,
      5_000,
      sodax.swaps.config.apiKey,
    );
    // A final solver answer is not reconciled against the journal.
    expect(journalSpy).not.toHaveBeenCalled();
  });

  // An abandoned record never self-heals, and the fallback runs exactly when the backend quits —
  // so it has to route like a 404, or a fallback-completed swap reads `failed` forever.
  it('routes to the solver past a success:false envelope or an abandoned record instead of trusting its data', async () => {
    recordNotFound({ status: 'posting_execution' });
    packets(delivered);
    solverSays(SolverIntentStatusCode.SOLVED, '0xfill');
    const envelope = await sodax.swaps.getDetailedStatus(key);
    expect(envelope.ok && envelope.value.source).toBe('solver');

    record({ status: 'relaying', abandonedAt: '2026-08-14T00:00:00.000Z' });
    packets(delivered);
    solverSays(SolverIntentStatusCode.SOLVED, '0xfill');
    const abandoned = await sodax.swaps.getDetailedStatus(key);
    expect(abandoned.ok && abandoned.value.source === 'solver' && abandoned.value.data.status).toBe(
      SolverIntentStatusCode.SOLVED,
    );
  });

  // A verified NOT_FOUND passes through — the miss a caller is meant to budget. An unverifiable one surfaces
  // untagged, so `useDetailedStatus` resets its budget instead of spending all 40 reads during a backend outage.
  it('passes a NOT_FOUND the durable record verified, but fails one it could not read to verify', async () => {
    noRecord();
    packets(delivered);
    solverSays(SolverIntentStatusCode.NOT_FOUND);
    journalReturns(intentResponse([]));
    const verified = await sodax.swaps.getDetailedStatus(key);
    expect(verified.ok && verified.value.source === 'solver' && verified.value.data.status).toBe(
      SolverIntentStatusCode.NOT_FOUND,
    );

    noRecord();
    packets(delivered);
    solverSays(SolverIntentStatusCode.NOT_FOUND);
    journalFails();
    expect(lookupFailure(await sodax.swaps.getDetailedStatus(key)).context?.reason).toBeUndefined();
  });

  // ── reconciling a non-final solver answer ────────────────────────────────

  // The solver can keep reporting a keeper-cancelled intent in flight, which polls forever.
  it('reads a cancelled intent as FAILED past a failed record while the solver reports it in flight, or when its request failed', async () => {
    record({ status: 'failed', failureReason: 'Intent deadline expired', abandonedAt: '2026-10-14T07:48:07.869Z' });
    packets(delivered);
    solverSays(SolverIntentStatusCode.STARTED_NOT_FINISHED);
    journalReturns(intentResponse([cancelEvent]));
    expect(await sodax.swaps.getDetailedStatus(key)).toEqual(solverArm({ status: SolverIntentStatusCode.FAILED }));

    noRecord();
    packets(delivered);
    mocks.solverGetStatus.mockResolvedValueOnce({
      ok: false,
      error: { detail: { code: SolverIntentErrorCode.UNKNOWN, message: 'solver down' } },
    });
    journalReturns(intentResponse([cancelEvent]));
    expect(await sodax.swaps.getDetailedStatus(key)).toEqual(solverArm({ status: SolverIntentStatusCode.FAILED }));
  });

  // Unlike an unverified NOT_FOUND, an in-flight answer spends no budget, so an unreadable journal leaves it a plain read.
  it('leaves an in-flight answer standing when the journal read fails', async () => {
    noRecord();
    packets(delivered);
    solverSays(SolverIntentStatusCode.STARTED_NOT_FINISHED);
    journalFails(new Error('down'));

    expect(await sodax.swaps.getDetailedStatus(key)).toEqual(
      solverArm({ status: SolverIntentStatusCode.STARTED_NOT_FINISHED }),
    );
  });

  it('uses the source tx as the hub tx for a hub-source swap', async () => {
    noRecord();
    solverSays(SolverIntentStatusCode.SOLVED, '0xfill');

    const result = await sodax.swaps.getDetailedStatus({ srcChainKey: ChainKeys.SONIC_MAINNET, srcTxHash: SRC_TX });

    expect(mocks.getTransactionPackets).not.toHaveBeenCalled();
    expect(result.ok && result.value.source === 'solver' && result.value.dstTxHash).toBe(SRC_TX);
  });

  // ── no usable hub tx hash yet is a miss, not a lifecycle step ────────────

  // The relay response is untrusted input and not schema-validated: an unusable envelope must be rejected
  // rather than dereferenced, and a packet that is undelivered, for another transaction or source chain, or
  // malformed must never supply the hash the solver is then queried with.
  it.each<[string, () => void]>([
    [
      'the relay envelope data is not an array',
      () =>
        mocks.getTransactionPackets.mockResolvedValueOnce({
          ok: true,
          value: { success: true, data: { packets: [] } },
        }),
    ],
    [
      'no packet attributes to this delivered tx',
      () =>
        packets([
          { status: 'validating', dst_tx_hash: '' },
          { ...delivered[0], src_tx_hash: '0xother' },
          { ...delivered[0], src_chain_id: 999 },
          { ...delivered[0], src_tx_hash: 42 },
          { ...delivered[0], dst_tx_hash: 42 },
        ]),
    ],
    ['the delivered hash is not hex', () => packets([{ ...delivered[0], dst_tx_hash: 'not-hex' }])],
  ])('fails with LOOKUP_FAILED without asking the solver when %s', async (_label, relay) => {
    noRecord();
    relay();

    lookupFailure(await sodax.swaps.getDetailedStatus(key));
    expect(mocks.solverGetStatus).not.toHaveBeenCalled();
  });

  // A rejected key is a configuration problem, not a source with nothing to say. Degrading to the
  // relay would bury it behind a relay error and leave `useDetailedStatus` polling a request only a
  // corrected key can satisfy. The bridge sibling applies the same rule.
  it('treats a rejected API key as terminal instead of degrading', async () => {
    backendFails('rejected', 401);

    const error = lookupFailure(await sodax.swaps.getDetailedStatus(key));

    // Lifted so `isAuthFailure` recognises the wrapped error — it reads `context.status` only.
    expect(error.context?.status).toBe(401);
    expect(isAuthFailure(error)).toBe(true);
    expect(error.context?.reason).toBeUndefined();
    expect(mocks.getTransactionPackets).not.toHaveBeenCalled();
    expect(mocks.solverGetStatus).not.toHaveBeenCalled();
  });

  it('tags only the undelivered-packet miss as budgetable, not outages', async () => {
    noRecord();
    packets([]);
    const miss = await sodax.swaps.getDetailedStatus(key);
    expect(lookupFailure(miss).context?.reason).toBe(DETAILED_STATUS_NOT_DELIVERED);

    // The relayer's 404 for an un-indexed tx is the same "no packet for this tx" state as an empty
    // list — live-verified — so it must be budgetable too, or an unrelayable swap polls forever.
    noRecord();
    mocks.getTransactionPackets.mockResolvedValueOnce({
      ok: false,
      error: new HttpRelayError(404, 'Not Found', '{"success": false, "message": "requested packet not found"}'),
    });
    const notIndexed = await sodax.swaps.getDetailedStatus(key);
    expect(lookupFailure(notIndexed).context?.reason).toBe(DETAILED_STATUS_NOT_DELIVERED);

    noRecord();
    mocks.getTransactionPackets.mockResolvedValueOnce({
      ok: false,
      error: new HttpRelayError(503, 'Service Unavailable', ''),
    });
    const relayDown = await sodax.swaps.getDetailedStatus(key);
    expect(lookupFailure(relayDown).context?.reason).toBeUndefined();

    noRecord();
    mocks.getTransactionPackets.mockResolvedValueOnce({ ok: false, error: new Error('socket hang up') });
    const transport = await sodax.swaps.getDetailedStatus(key);
    expect(lookupFailure(transport).context?.reason).toBeUndefined();

    // A relay miss only proves the swap is unresolvable if the backend also had nothing to say. Behind a
    // backend outage the record may be progressing unseen, so both relay miss shapes stay untagged there.
    backendErrors(503);
    mocks.getTransactionPackets.mockResolvedValueOnce({ ok: false, error: new HttpRelayError(404, 'Not Found', '') });
    expect(lookupFailure(await sodax.swaps.getDetailedStatus(key)).context?.reason).toBeUndefined();

    backendErrors(503);
    packets([]);
    expect(lookupFailure(await sodax.swaps.getDetailedStatus(key)).context?.reason).toBeUndefined();
  });

  // No falling back to a stale abandoned record — the caller asked for a status, not a guess.
  it('fails with an untagged LOOKUP_FAILED when the solver cannot be reached even if a record exists, and when a dependency throws', async () => {
    record({ status: 'failed', failureReason: 'relay timed out' });
    packets(delivered);
    solverDown();
    journalFails();
    expect(lookupFailure(await sodax.swaps.getDetailedStatus(key)).context?.reason).toBeUndefined();

    // The relay client asserts on empty identifiers rather than returning a Result.
    noRecord();
    mocks.getTransactionPackets.mockRejectedValueOnce(new Error('Invalid input parameters. tx_hash empty'));
    lookupFailure(await sodax.swaps.getDetailedStatus({ ...key, srcTxHash: '' }));
  });
});

describe('SwapService.postExecution', () => {
  it('wraps a SolverErrorResponse failure as EXTERNAL_API_ERROR with the solver code on context, synthesising a malformed one', async () => {
    const detail = { code: -8, message: 'quote not found' };
    // The second response simulates an upstream contract violation — an error without a `detail` field.
    mocks.solverPostExecution.mockResolvedValueOnce({ ok: false, error: { detail } }).mockResolvedValueOnce({
      ok: false,
      error: {},
    });

    const result = await sodax.swaps.postExecution({ intent_tx_hash: '0xsome' } as never);
    invariant(!result.ok, 'expected a solver error');
    expect(isSodaxError(result.error)).toBe(true);
    expect(result.error.code).toBe('EXTERNAL_API_ERROR');
    expect(result.error.message).toBe('quote not found');
    expect(result.error.context?.phase).toBe('postExecution');
    expect(result.error.context?.solverCode).toBe(-8);
    expect(result.error.context?.solverDetail).toEqual(detail);

    const malformed = await sodax.swaps.postExecution({ intent_tx_hash: '0xsome' } as never);
    invariant(!malformed.ok, 'expected a solver error');
    expect(malformed.error.code).toBe('EXTERNAL_API_ERROR');
    expect(malformed.error.message).toBe('Solver returned malformed error response');
    expect(malformed.error.context?.solverCode).toBe(-999);
  });

  it('wraps a thrown exception, or a SodaxError with an out-of-union code, as EXECUTION_FAILED but preserves an in-union one', async () => {
    const thrown = new Error('network down');
    const outOfUnion = new SodaxError('RELAY_TIMEOUT', 'unexpected', {
      feature: 'swap',
      context: { phase: 'relay' },
    });
    const inner = new SodaxError('EXTERNAL_API_ERROR', 'pre-wrapped', {
      feature: 'swap',
      context: { phase: 'postExecution', api: 'solver', solverCode: -8 },
    });
    mocks.solverPostExecution
      .mockRejectedValueOnce(thrown)
      .mockRejectedValueOnce(outOfUnion)
      .mockRejectedValueOnce(inner);

    for (const cause of [thrown, outOfUnion]) {
      const result = await sodax.swaps.postExecution({ intent_tx_hash: '0xsome' } as never);
      invariant(!result.ok, 'expected a failure');
      expect(result.error.code).toBe('EXECUTION_FAILED');
      expect(result.error.cause).toBe(cause);
    }
    const preserved = await sodax.swaps.postExecution({ intent_tx_hash: '0xsome' } as never);
    expect(!preserved.ok && preserved.error).toBe(inner);
  });
});

// =========================================================================
// Batch 4: quote request — adjusts amount by partner fee before delegating.
// =========================================================================

describe('SwapService.createIntent — extras (partnerFee + srcPublicKey)', () => {
  // Distinct valid addresses so the override is provably different from the configured fee.
  const CONFIGURED_FEE = { address: '0x00000000000000000000000000000000feec0a01', percentage: 50 } as const;
  const OVERRIDE_FEE = { address: '0x00000000000000000000000000000000feec0b02', percentage: 100 } as const;

  // Build a Sodax whose configured swap fee IS CONFIGURED_FEE, with createIntent's deps stubbed.
  const makeConfiguredFeeSwaps = () => {
    const s = new Sodax({ swaps: { partnerFee: CONFIGURED_FEE } });
    vi.spyOn(s.config, 'isValidOriginalAssetAddress').mockReturnValue(true);
    vi.spyOn(s.config, 'isValidSpokeChainKey').mockReturnValue(true);
    vi.spyOn(s.hubProvider, 'getUserHubWalletAddress').mockResolvedValue('0xhubwallet');
    vi.spyOn(s.spoke, 'deposit').mockResolvedValue({ ok: true, value: '0xdeposit-hash' });
    return s.swaps;
  };

  it('uses extras.partnerFee over the configured swap fee on the spoke and hub paths, falling back to the configured one', async () => {
    const swaps = makeConfiguredFeeSwaps();
    mocks.constructCreateIntentData.mockReturnValue(['0xintentdata', makeIntent(ChainKeys.BSC_MAINNET), 42n]);
    mocks.sonicCreateSwapIntent.mockResolvedValueOnce([
      '0xexec-hash',
      makeIntent(ChainKeys.SONIC_MAINNET),
      0n,
      '0xdata',
    ]);

    const overridden = await swaps.createIntent({
      params: intentInput(ChainKeys.BSC_MAINNET),
      extras: { partnerFee: OVERRIDE_FEE },
      raw: false,
      walletProvider: mockEvmProvider,
    });
    const configured = await swaps.createIntent({
      params: intentInput(ChainKeys.BSC_MAINNET),
      raw: false,
      walletProvider: mockEvmProvider,
    });
    const onHub = await swaps.createIntent({
      params: intentInput(ChainKeys.SONIC_MAINNET),
      extras: { partnerFee: OVERRIDE_FEE },
      raw: false,
      walletProvider: mockEvmProvider,
    });

    expect(overridden.ok).toBe(true);
    expect(configured.ok).toBe(true);
    expect(onHub.ok).toBe(true);
    // 4th positional arg to constructCreateIntentData is the effective partner fee.
    expect(mocks.constructCreateIntentData.mock.calls[0]?.[3]).toEqual(OVERRIDE_FEE);
    expect(mocks.constructCreateIntentData.mock.calls[1]?.[3]).toEqual(CONFIGURED_FEE);
    expect(mocks.sonicCreateSwapIntent.mock.calls[0]?.[0].fee).toEqual(OVERRIDE_FEE);
  });

  it('requires extras.srcPublicKey for a Stacks raw intent and passes it through to SpokeService.deposit', async () => {
    const svc = sodax.swaps;
    const missing = await svc.createIntent({ params: intentInput(ChainKeys.STACKS_MAINNET), raw: true });
    invariant(!missing.ok, 'expected a validation failure');
    expect(isSodaxError(missing.error)).toBe(true);
    expect(missing.error.code).toBe('VALIDATION_FAILED');
    expect(missing.error.message).toContain('srcPublicKey');

    const srcPublicKey = '025259f813b57dd5c3fcac09776d767a49f6dd77bba5895823b891e31b10a96a5d';
    mocks.getUserHubWalletAddress.mockResolvedValueOnce('SP-hub-wallet');
    mocks.constructCreateIntentData.mockReturnValueOnce(['0xintentdata', makeIntent(), 0n]);
    const deposit = vi.spyOn(svc.spoke, 'deposit').mockResolvedValueOnce({ ok: true, value: { payload: '0xraw' } });

    const result = await svc.createIntent({
      params: intentInput(ChainKeys.STACKS_MAINNET),
      extras: { srcPublicKey },
      raw: true,
    });

    expect(result.ok).toBe(true);
    expect(deposit.mock.calls.at(-1)?.[0]).toMatchObject({ srcPublicKey });
  });

  it('carries a known deposit hash through an intent failure for recovery', async () => {
    const svc = sodax.swaps;
    const chainKey = ChainKeys.BITCOIN_MAINNET;
    const txHash = 'ab'.repeat(32);
    const cause = Object.freeze(new Error('wallet response lost'));
    const error = new IndeterminateOutcomeError('Deposit submission outcome is unknown', { cause, txHash });
    mocks.getUserHubWalletAddress.mockResolvedValueOnce('0xhubwallet');
    mocks.constructCreateIntentData.mockReturnValueOnce(['0xintentdata', makeIntent(chainKey), 0n]);
    vi.spyOn(svc.spoke.bitcoin, 'getEffectiveWalletAddress').mockImplementation(async address => address);
    const deposit = vi.spyOn(svc.spoke, 'deposit').mockResolvedValueOnce({ ok: false, error });

    const result = await svc.createIntent({ params: intentInput(chainKey), raw: true });

    expect(result).toMatchObject({
      ok: false,
      error: { code: 'INTENT_CREATION_FAILED', context: { srcTxHash: txHash } },
    });
    invariant(!result.ok, 'expected a failed intent');
    expect(result.error.cause).toBe(error);
    expect(error.cause).toBe(cause);
    expect(cause).not.toHaveProperty('txHash');

    const status = {
      txHash,
      srcChainKey: chainKey,
      status: 'solved',
      processingAttempts: 1,
      result: { dstIntentTxHash: '0xDST', intent_hash: '0xHASH' },
    } as const;
    const read = vi.spyOn(svc.backendApi.swaps, 'getSubmitTxStatus').mockResolvedValueOnce({
      ok: true,
      value: { success: true, data: status },
    });
    const srcTxHash = result.error.context?.srcTxHash;
    if (typeof srcTxHash !== 'string') throw new Error('missing recovery hash');
    expect(await svc.getDetailedStatus({ srcChainKey: chainKey, srcTxHash })).toEqual({
      ok: true,
      value: { source: 'backend', data: status },
    });
    expect(read).toHaveBeenCalledExactlyOnceWith({ srcChainKey: chainKey, txHash });
    expect(deposit).toHaveBeenCalledOnce();
  });
});

// The relay takes its release fee from a payout to Tron and releases nothing once it reaches the amount.
describe('SwapService.createIntent — payouts through the MPC relay', () => {
  const TRON_USDT = tronSupportedTokens.USDT.address;
  const fromTron = (
    inputAmount: bigint,
    allowPartialFill = false,
  ): CreateIntentParams<typeof ChainKeys.TRON_MAINNET> => ({
    ...intentInput(ChainKeys.TRON_MAINNET),
    inputToken: TRON_USDT,
    outputToken: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',
    inputAmount,
    allowPartialFill,
    srcAddress: TRON_TEST_ADDRESS,
    deadline: 1_700_000_000n,
  });
  const toTron = (minOutputAmount: bigint): CreateIntentParams<typeof ChainKeys.BSC_MAINNET> => ({
    ...intentInput(ChainKeys.BSC_MAINNET),
    dstChainKey: ChainKeys.TRON_MAINNET,
    outputToken: TRON_USDT,
    minOutputAmount,
    dstAddress: TRON_TEST_ADDRESS,
  });

  const run = async (params: CreateIntentParams<SpokeChainKey>, partnerFee?: PartnerFee) => {
    const s = new Sodax({ logger: 'silent', solver: testSolver });
    const pastValidation = vi
      .spyOn(s.hubProvider, 'getUserHubWalletAddress')
      .mockRejectedValue(new Error('past validation'));
    const result = await s.swaps.createIntent({ params, raw: true, extras: partnerFee ? { partnerFee } : undefined });
    return { result, pastValidation };
  };
  const expectRefused = async (outcome: ReturnType<typeof run>, field: string) => {
    const { result, pastValidation } = await outcome;
    invariant(!result.ok, 'expected a refusal');
    expect(result.error.code).toBe('VALIDATION_FAILED');
    expect(result.error.context?.field).toBe(field);
    expect(pastValidation).not.toHaveBeenCalled();
  };

  it('refuses a Tron-source intent whose refund, after the partner fee, would not clear the minimum; passes one unit above', async () => {
    await expectRefused(run(fromTron(3_000_000n)), 'inputAmount');
    expect((await run(fromTron(3_000_001n))).pastValidation).toHaveBeenCalled();
    await expectRefused(
      run(fromTron(3_100_000n), { address: '0x00000000000000000000000000000000feec0a01', percentage: 500 }),
      'inputAmount',
    );
  });

  it('refuses a minOutputAmount to Tron at the minimum, and passes one unit above it', async () => {
    await expectRefused(run(toTron(3_000_000n)), 'minOutputAmount');
    expect((await run(toTron(3_000_001n))).pastValidation).toHaveBeenCalled();
  });

  // One MPC-relay leg is enough: the partial-fill rule does not depend on the leg's direction.
  it('refuses a partial fill from Tron', async () => {
    await expectRefused(run(fromTron(10_000_000n, true)), 'allowPartialFill');
  });

  it('refuses a Tron-source intent with no deadline, which nothing could cancel', async () => {
    await expectRefused(run({ ...fromTron(10_000_000n), deadline: 0n }), 'deadline');
  });

  // An XRPL account can refuse a release outright, and a cancelled intent refunds its source.
  describe('to or from XRPL', () => {
    const XRPL_ADDRESS = 'rBTwLga3i2gz3doX6Gva3MgEV8ZCD8jjah';
    const XRPL_USDC = xrpSupportedTokens.USDC.address;
    const toXrpl: CreateIntentParams<typeof ChainKeys.BSC_MAINNET> = {
      ...intentInput(ChainKeys.BSC_MAINNET),
      dstChainKey: ChainKeys.XRP_MAINNET,
      outputToken: XRPL_USDC,
      minOutputAmount: 5_000_000n,
      dstAddress: XRPL_ADDRESS,
    };
    const fromXrpl: CreateIntentParams<typeof ChainKeys.XRP_MAINNET> = {
      ...intentInput(ChainKeys.XRP_MAINNET),
      inputToken: XRPL_USDC,
      outputToken: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',
      inputAmount: 5_000_000n,
      srcAddress: XRPL_ADDRESS,
      deadline: 1_700_000_000n,
    };

    it('checks solved payout headroom before signing: refuses a minimum the trustline cannot take, passes one it can', async () => {
      const s = new Sodax({ logger: 'silent' });
      vi.spyOn(s.swaps, 'getQuote').mockResolvedValue({ ok: true, value: { quoted_amount: 100_000_000n } });
      vi.spyOn(s.spoke.xrp, 'checkDestination').mockImplementation(async ({ amount, maxAmount = amount }) =>
        maxAmount > 100_000_000n ? { ready: false, reason: 'trustline_limit' } : { ready: true },
      );
      const signing = vi.spyOn(s.spoke, 'deposit');
      const pastValidation = vi
        .spyOn(s.hubProvider, 'getUserHubWalletAddress')
        .mockRejectedValue(new Error('past validation'));

      const refused = await s.swaps.createIntent({ params: { ...toXrpl, minOutputAmount: 99_000_000n }, raw: true });
      invariant(!refused.ok, 'expected refusal');
      expect(refused.error.context).toMatchObject({ reason: 'xrpl-trustline_limit' });
      expect(pastValidation).not.toHaveBeenCalled();
      expect(signing).not.toHaveBeenCalled();

      await s.swaps.createIntent({ params: { ...toXrpl, minOutputAmount: 50_000_000n }, raw: true });
      expect(pastValidation).toHaveBeenCalled();
    });

    it('refuses a minimum one unit below half the current quote before checking the trustline or signing', async () => {
      const s = new Sodax({ logger: 'silent' });
      const quote = vi
        .spyOn(s.swaps, 'getQuote')
        .mockResolvedValue({ ok: true, value: { quoted_amount: 10_000_001n } });
      const check = vi.spyOn(s.spoke.xrp, 'checkDestination');
      const deposit = vi.spyOn(s.spoke, 'deposit');

      const result = await s.swaps.createIntent({ params: toXrpl, raw: true });

      invariant(!result.ok, 'expected quote bound rejection');
      expect(result.error.context?.field).toBe('minOutputAmount');
      expect(result.error.message).toContain('at least half');
      expect(quote).toHaveBeenCalledWith(
        expect.objectContaining({
          token_dst: XRPL_USDC,
          amount: toXrpl.inputAmount,
          quote_type: 'exact_input',
        }),
      );
      expect(check).not.toHaveBeenCalled();
      expect(deposit).not.toHaveBeenCalled();
    });

    const runXrpl = async (params: CreateIntentParams<SpokeChainKey>, readiness: XrpDestinationReadiness) => {
      const s = new Sodax({ logger: 'silent' });
      vi.spyOn(s.swaps, 'getQuote').mockResolvedValue({ ok: true, value: { quoted_amount: 10_000_000n } });
      const checkSpy = vi.spyOn(s.spoke.xrp, 'checkDestination').mockResolvedValue(readiness);
      const pastValidation = vi
        .spyOn(s.hubProvider, 'getUserHubWalletAddress')
        .mockRejectedValue(new Error('past validation'));
      const result = await s.swaps.createIntent({ params, raw: true });
      return { result, pastValidation, checkSpy };
    };

    // A payout needs room for the most a fill can pay; a refund lands on the line the deposit just drew down,
    // so it is checked for no extra room.
    it.each([
      ['to', toXrpl, 'dstAddress', 5_000_000n, 10_000_000n],
      ['from', fromXrpl, 'srcAddress', 0n, undefined],
    ] as const)('refuses a swap %s an XRPL account that cannot receive its release', async (_, params, field, amount, maxAmount) => {
      const outcome = runXrpl(params, { ready: false, reason: 'no_trustline' });
      await expectRefused(outcome, field);
      expect((await outcome).checkSpy).toHaveBeenCalledWith({
        address: XRPL_ADDRESS,
        token: XRPL_USDC,
        amount,
        maxAmount,
      });
    });
  });
});

describe('SwapService.getQuote', () => {
  // Deliberate cast: a partial wire-shape fixture — annotating as the real quote-request type
  // would demand every field, and the tests only exercise amount/fee adjustment.
  const baseQuoteRequest = {
    token_src: '0x2170Ed0880ac9A755fd29B2688956BD959F933F8',
    token_dst: '0x2f2a2543B76A4166549F7aaB2e75Bef0aefC5B0f',
    token_src_blockchain_id: ChainKeys.BSC_MAINNET,
    token_dst_blockchain_id: ChainKeys.ARBITRUM_MAINNET,
    amount: 1_000_000n,
    quote_type: 'exact_input',
  } as unknown as Parameters<typeof sodax.swaps.getQuote>[0];

  it('adjusts the amount by a per-call partnerFee override when supplied', async () => {
    mocks.solverGetQuote.mockResolvedValueOnce({ ok: true, value: {} });
    const overrideFee = { address: '0x00000000000000000000000000000000feec0b02', percentage: 100 } as const;

    await sodax.swaps.getQuote({ ...baseQuoteRequest, partnerFee: overrideFee } as never);

    const forwarded = mocks.solverGetQuote.mock.calls.at(-1)?.[0] as { amount: bigint };
    const baseAmount = baseQuoteRequest.amount;
    // Override beats the (unconfigured) default fee, so the forwarded amount is fee-adjusted.
    expect(forwarded.amount).toBe(adjustAmountByFee(baseAmount, overrideFee, 'exact_input'));
    expect(forwarded.amount).not.toBe(baseAmount);
  });
});

// =========================================================================
// Batch 6: swap — orchestrates createIntent + verify + relay + postExecution.
// =========================================================================

describe('SwapService.swap', () => {
  // Stub createIntent so tests can focus on swap's orchestration logic without re-traversing
  // all of createIntent's internal paths.
  const stubCreateIntentOk = (srcChain: SpokeChainKey, spokeTxHash = '0xspokeTx') => {
    const intent = makeIntent(srcChain as Parameters<typeof getIntentRelayChainId>[0]);
    return vi.spyOn(sodax.swaps, 'createIntent').mockResolvedValueOnce({
      ok: true,
      value: {
        tx: spokeTxHash,
        intent: { ...intent, feeAmount: 0n },
        relayData: { address: intent.creator, payload: '0xdata' },
      },
    });
  };
  const swapOnBsc = () =>
    sodax.swaps.swap({ params: intentInput(ChainKeys.BSC_MAINNET), raw: false, walletProvider: mockEvmProvider });

  it('on hub-chain srcChain (Sonic), skips relay and calls postExecution with the spoke tx hash', async () => {
    stubCreateIntentOk(ChainKeys.SONIC_MAINNET, '0xsonicTx');
    mocks.solverPostExecution.mockResolvedValueOnce({
      ok: true,
      value: { answer: 'OK', intent_hash: '0xhash' },
    });

    const result = await sodax.swaps.swap({
      params: intentInput(ChainKeys.SONIC_MAINNET),
      walletProvider: mockEvmProvider,
    });

    expect(result.ok).toBe(true);
    // postExecution should receive the spoke tx hash as intent_tx_hash — no relay step between them.
    expect(mocks.solverPostExecution).toHaveBeenCalledWith(
      expect.objectContaining({ intent_tx_hash: '0xsonicTx' }),
      sodax.swaps.solver,
      sodax.swaps.config.logger,
      sodax.swaps.config.apiKey,
    );
    expect(mocks.relayTxAndWaitPacket).not.toHaveBeenCalled();
  });

  it('on a spoke srcChain, relays the spoke tx with its relay data, then calls postExecution with the dst tx hash', async () => {
    const params = intentInput(ChainKeys.BSC_MAINNET);
    stubCreateIntentOk(ChainKeys.BSC_MAINNET, '0xbscTx');
    mocks.relayTxAndWaitPacket.mockResolvedValueOnce({ ok: true, value: { dst_tx_hash: '0xdstTx' } });
    mocks.solverPostExecution.mockResolvedValueOnce({ ok: true, value: { answer: 'OK' } });

    const result = await sodax.swaps.swap({ params, raw: false, walletProvider: mockEvmProvider });

    // The callsite always forwards relayData verbatim; the Solana/Bitcoin gate lives inside relayTxAndWaitPacket.
    expect(mocks.relayTxAndWaitPacket.mock.calls[0]?.[0].data).toEqual({
      address: makeIntent(ChainKeys.BSC_MAINNET).creator,
      payload: '0xdata',
    });
    expect(mocks.solverPostExecution).toHaveBeenCalledWith(
      expect.objectContaining({ intent_tx_hash: '0xdstTx' }),
      sodax.swaps.solver,
      sodax.swaps.config.logger,
      sodax.swaps.config.apiKey,
    );
    invariant(result.ok, 'expected a completed swap');
    expect(result.value.intentDeliveryInfo).toEqual({
      srcChainKey: ChainKeys.BSC_MAINNET,
      srcTxHash: '0xbscTx',
      srcAddress: params.srcAddress,
      dstChainKey: params.dstChainKey,
      dstTxHash: '0xdstTx',
      dstAddress: params.dstAddress,
    });
  });

  it('returns the failure from createIntent as-is, without a source tx since nothing was broadcast', async () => {
    const createError = new SodaxError('INTENT_CREATION_FAILED', 'create intent failed', { feature: 'swap' });
    vi.spyOn(sodax.swaps, 'createIntent').mockResolvedValueOnce({ ok: false, error: createError });

    const result = await swapOnBsc();

    expect(result).toEqual({ ok: false, error: createError });
    expect(!result.ok && result.error.context?.srcTxHash).toBeUndefined();
    expect(mocks.relayTxAndWaitPacket).not.toHaveBeenCalled();
  });

  // Every failure after the broadcast carries the source tx, so its status can still be read.
  it('wraps a verifyTxHash failure in TX_VERIFICATION_FAILED with cause and the source tx', async () => {
    stubCreateIntentOk(ChainKeys.BSC_MAINNET, '0xbscTx');
    const verifyError = new Error('VERIFY_FAILED');
    vi.spyOn(sodax.spoke, 'verifyTxHash').mockResolvedValueOnce({ ok: false, error: verifyError });

    const result = await swapOnBsc();

    invariant(!result.ok, 'expected a verification failure');
    expect(result.error.code).toBe('TX_VERIFICATION_FAILED');
    expect(result.error.cause).toBe(verifyError);
    expect(result.error.context).toMatchObject({
      phase: 'verify',
      srcChainKey: ChainKeys.BSC_MAINNET,
      srcTxHash: '0xbscTx',
    });
    expect(mocks.relayTxAndWaitPacket).not.toHaveBeenCalled();
  });

  // Each relay code's mapping is relay-error-mapping's to test; this pins that swap() applies it with the source tx.
  it('maps a RELAY_TIMEOUT relay failure to RELAY_TIMEOUT with the relay code and the source tx', async () => {
    stubCreateIntentOk(ChainKeys.BSC_MAINNET, '0xbscTx');
    const relayError = new Error('RELAY_TIMEOUT');
    mocks.relayTxAndWaitPacket.mockResolvedValueOnce({ ok: false, error: relayError });

    const result = await swapOnBsc();

    invariant(!result.ok, 'expected a relay failure');
    expect(result.error.code).toBe('RELAY_TIMEOUT');
    expect(result.error.cause).toBe(relayError);
    expect(result.error.context).toMatchObject({
      relayCode: 'RELAY_TIMEOUT',
      phase: 'relay',
      srcChainKey: ChainKeys.BSC_MAINNET,
      srcTxHash: '0xbscTx',
    });
    expect(mocks.solverPostExecution).not.toHaveBeenCalled();
  });

  it('propagates a postExecution SolverErrorResponse as EXTERNAL_API_ERROR, keeping the hub tx to notify again', async () => {
    stubCreateIntentOk(ChainKeys.BSC_MAINNET, '0xbscTx');
    mocks.relayTxAndWaitPacket.mockResolvedValueOnce({ ok: true, value: { dst_tx_hash: '0xdstTx' } });
    mocks.solverPostExecution.mockResolvedValueOnce({
      ok: false,
      error: { detail: { code: -7, message: 'no execution module found' } },
    });

    const result = await swapOnBsc();

    invariant(!result.ok, 'expected a solver failure');
    expect(result.error.code).toBe('EXTERNAL_API_ERROR');
    expect(result.error.context).toMatchObject({
      solverCode: -7,
      srcChainKey: ChainKeys.BSC_MAINNET,
      srcTxHash: '0xbscTx',
      dstTxHash: '0xdstTx',
    });
  });

  it('wraps a thrown error, or a SodaxError with a non-swap code, from createIntent as UNKNOWN but preserves a swap one', async () => {
    const thrownError = new Error('CREATE_THROWS');
    const outOfUnion = new SodaxError('SOMEMODULE_FOO_FAILED' as never, 'unexpected', { feature: 'swap' });
    const inner = new SodaxError('VALIDATION_FAILED', 'my validation', {
      feature: 'swap',
      context: { phase: 'validate' },
    });
    vi.spyOn(sodax.swaps, 'createIntent')
      .mockRejectedValueOnce(thrownError)
      .mockRejectedValueOnce(outOfUnion)
      .mockRejectedValueOnce(inner);

    for (const cause of [thrownError, outOfUnion]) {
      const result = await swapOnBsc();
      invariant(!result.ok, 'expected a failure');
      expect(result.error.code).toBe('UNKNOWN');
      expect(result.error.cause).toBe(cause);
    }
    const preserved = await swapOnBsc();
    expect(!preserved.ok && preserved.error).toBe(inner);
  });
});

// =========================================================================
// Batch 7: cancel family — createCancelIntent + cancelIntent expansion + cancelLimitOrder.
// =========================================================================

describe('SwapService.createCancelIntent', () => {
  const cancelOnBsc = (intent = makeIntent(ChainKeys.BSC_MAINNET)) =>
    sodax.swaps.createCancelIntent({
      params: { srcChainKey: ChainKeys.BSC_MAINNET, intent },
      raw: false,
      walletProvider: mockEvmProvider,
    });

  it('refuses an intent from an MPC-relay source before signing: its refund would pay an identity', async () => {
    const sendMessageSpy = vi.spyOn(sodax.spoke, 'sendMessage');

    const result = await sodax.swaps.createCancelIntent({
      params: { srcChainKey: ChainKeys.TRON_MAINNET, intent: makeIntent(ChainKeys.TRON_MAINNET) },
      raw: false,
      walletProvider: mockTronProvider,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatchObject({ code: 'VALIDATION_FAILED', context: { field: 'srcChainKey' } });
    expect(sendMessageSpy).not.toHaveBeenCalled();
  });

  it('returns ok:false when intent.srcChain or intent.dstChain is not a valid relay chain id', async () => {
    // Override the default beforeEach stub: the first call checks intent.srcChain, the second intent.dstChain.
    vi.spyOn(sodax.config, 'isValidIntentRelayChainId').mockReturnValueOnce(false);
    const badSrc = await cancelOnBsc();
    expect(!badSrc.ok && String(badSrc.error)).toMatch(/Invalid intent\.srcChain/);

    vi.spyOn(sodax.config, 'isValidIntentRelayChainId').mockReturnValueOnce(true).mockReturnValueOnce(false);
    const badDst = await cancelOnBsc();
    expect(!badDst.ok && String(badDst.error)).toMatch(/Invalid intent\.dstChain/);
  });

  it('wraps a sendMessage failure, returned or thrown, as SodaxError(INTENT_CREATION_FAILED, swap) with .cause', async () => {
    const sendError = new Error('SEND_REJECTED');
    const thrownError = new Error('SEND_THROWS');
    vi.spyOn(sodax.spoke, 'sendMessage')
      .mockResolvedValueOnce({ ok: false, error: sendError })
      .mockRejectedValueOnce(thrownError);

    for (const cause of [sendError, thrownError]) {
      const result = await cancelOnBsc();
      invariant(!result.ok, 'expected a failure');
      expect(isSodaxError(result.error)).toBe(true);
      expect((result.error as SodaxError).code).toBe('INTENT_CREATION_FAILED');
      expect((result.error as SodaxError).feature).toBe('swap');
      expect((result.error as SodaxError).cause).toBe(cause);
    }
  });
});

describe('SwapService.cancelIntent — non-hub (relay) path', () => {
  // Solana addresses are 32 bytes; Bitcoin addresses are utf8-encoded. `makeIntent` carries a 20-byte
  // EVM srcAddress, which `reverseEncodeAddress` rejects for both.
  const solanaIntent = (): Intent => ({
    ...makeIntent(ChainKeys.SOLANA_MAINNET),
    srcAddress: `0x${'11'.repeat(32)}`,
  });
  // A TRADING-mode Bitcoin intent stores the trading address; the personal wallet (bc1q → P2WPKH) signs.
  const BTC_PERSONAL = 'bc1q5q3xczsl9zlt0gjys5khjknfp40zfdmkme9ene';
  const BTC_TRADING = 'bc1p5cyxnuxmeuwuvkwfem96lqzszd02n6xdcjrs20cac6yqjjwudpxqkedrcr';
  const bitcoinIntent = (): Intent => ({
    ...makeIntent(ChainKeys.BITCOIN_MAINNET),
    srcAddress: encodeAddress(ChainKeys.BITCOIN_MAINNET, BTC_TRADING),
  });

  it('on an EVM spoke, relays the cancel tx by its hash and waits for the dst tx hash', async () => {
    const intent = makeIntent(ChainKeys.BSC_MAINNET);
    const verifyTxHashSpy = vi.spyOn(sodax.spoke, 'verifyTxHash').mockResolvedValueOnce({ ok: true, value: true });
    const sendMessageSpy = vi
      .spyOn(sodax.spoke, 'sendMessage')
      .mockResolvedValueOnce({ ok: true, value: '0xspokeCancelTx' });
    mocks.relayTxAndWaitPacket.mockResolvedValueOnce({ ok: true, value: { dst_tx_hash: '0xdstCancelTx' } });

    const result = await sodax.swaps.cancelIntent({
      params: {
        srcChainKey: ChainKeys.BSC_MAINNET,
        intent,
      },
      walletProvider: mockEvmProvider,
      timeout: 45_000,
    });

    expect(result).toEqual({ ok: true, value: { srcChainTxHash: '0xspokeCancelTx', dstChainTxHash: '0xdstCancelTx' } });
    // Non-Bitcoin cancels sign from the address stored on the intent.
    expect(sendMessageSpy.mock.calls[0]?.[0]?.srcAddress).toBe(intent.srcAddress);

    expect(verifyTxHashSpy).toHaveBeenCalledWith({
      txHash: '0xspokeCancelTx',
      chainKey: ChainKeys.BSC_MAINNET,
    });

    expect(mocks.relayTxAndWaitPacket).toHaveBeenCalledTimes(1);
    expect(mocks.relayTxAndWaitPacket.mock.calls[0]?.[0]).toMatchObject({
      srcTxHash: '0xspokeCancelTx',
      pollTxHash: undefined,
      chainKey: ChainKeys.BSC_MAINNET,
      relayerApiEndpoint: sodax.swaps.relayerApiEndpoint,
      timeout: 45_000,
    });
  });

  it('on Solana, submits the cancel payload the spoke tx only hashes as relay extra data', async () => {
    const intent = solanaIntent();
    const sendMessageSpy = vi
      .spyOn(sodax.spoke, 'sendMessage')
      .mockResolvedValueOnce({ ok: true, value: 'SolanaCancelSignature' });
    mocks.relayTxAndWaitPacket.mockResolvedValueOnce({ ok: true, value: { dst_tx_hash: '0xdstCancelTx' } });

    const result = await sodax.swaps.cancelIntent({
      params: {
        srcChainKey: ChainKeys.SOLANA_MAINNET,
        intent,
      },
      walletProvider: mockSolanaProvider,
    });

    expect(result).toEqual({
      ok: true,
      value: { srcChainTxHash: 'SolanaCancelSignature', dstChainTxHash: '0xdstCancelTx' },
    });

    // The relayer must receive the exact hub wallet + payload the spoke tx committed to.
    const sendCall = sendMessageSpy.mock.calls[0]?.[0];
    expect(sendCall?.dstAddress).toBe(intent.creator);
    expect(sendCall?.payload).toMatch(/^0x[0-9a-f]+$/);
    expect(mocks.relayTxAndWaitPacket).toHaveBeenCalledTimes(1);
    expect(mocks.relayTxAndWaitPacket.mock.calls[0]?.[0]).toMatchObject({
      srcTxHash: 'SolanaCancelSignature',
      pollTxHash: undefined,
      chainKey: ChainKeys.SOLANA_MAINNET,
      data: { address: intent.creator, payload: sendCall?.payload },
    });
    // Manual-relay callers rebuild the same extra data from the intent alone.
    expect(sodax.swaps.getCancelIntentRelayData(intent)).toEqual({
      ok: true,
      value: { address: intent.creator, payload: sendCall?.payload },
    });
  });

  it('getCancelIntentRelayData rejects an intent whose srcChain is not a relay chain id', () => {
    vi.spyOn(sodax.config, 'isValidIntentRelayChainId').mockReturnValueOnce(false);
    const result = sodax.swaps.getCancelIntentRelayData(makeIntent(ChainKeys.BSC_MAINNET));
    expect(result.ok).toBe(false);
    if (!result.ok) expect((result.error as Error).message).toMatch(/Invalid intent\.srcChain/);
  });

  it('on Bitcoin (TRADING), signs the on-demand cancel from the personal wallet and relays it under "withdraw"', async () => {
    // Runs the real SpokeService.sendMessage → BitcoinSpokeService.encodeWithdrawalData path; only the
    // Bound lookup and the wallet's signing calls are stubbed.
    const intent = bitcoinIntent();
    expect(sodax.spoke.bitcoin.walletMode).toBe('TRADING');
    const getTradingWalletSpy = vi
      .spyOn(sodax.spoke.bitcoin.radfi, 'getTradingWallet')
      .mockResolvedValue({ tradingAddress: BTC_TRADING } as never);
    bitcoinProviderMocks.getWalletAddress.mockResolvedValueOnce(BTC_PERSONAL);
    bitcoinProviderMocks.signBip322Message.mockResolvedValueOnce('EjQ=');
    bitcoinProviderMocks.getPublicKey.mockResolvedValueOnce('02abcdef');
    mocks.relayTxAndWaitPacket.mockResolvedValueOnce({ ok: true, value: { dst_tx_hash: '0xdstCancelTx' } });

    const result = await sodax.swaps.cancelIntent({
      params: {
        srcChainKey: ChainKeys.BITCOIN_MAINNET,
        intent,
        skipSimulation: true,
      },
      walletProvider: mockBitcoinProvider,
    });

    // The trading wallet is derived from the personal address, never from the intent's trading address.
    expect(getTradingWalletSpy).toHaveBeenCalled();
    for (const call of getTradingWalletSpy.mock.calls) expect(call[0]).toBe(BTC_PERSONAL);
    // P2WPKH personal wallet → BIP322; the trading address would have picked the wrong scheme.
    expect(bitcoinProviderMocks.signBip322Message).toHaveBeenCalledTimes(1);
    expect(bitcoinProviderMocks.signEcdsaMessage).not.toHaveBeenCalled();

    expect(mocks.relayTxAndWaitPacket).toHaveBeenCalledTimes(1);
    const relayArg = mocks.relayTxAndWaitPacket.mock.calls[0]?.[0];
    expect(relayArg).toMatchObject({ srcTxHash: 'withdraw', chainKey: ChainKeys.BITCOIN_MAINNET });
    const signed = relayArg?.data as { payload_hex: string; signature?: string; public_key?: string };
    expect(signed.signature).toBe('EjQ=');
    expect(signed.public_key).toBe('02abcdef');
    const btcPayload = JSON.parse(Buffer.from(signed.payload_hex, 'hex').toString('utf8'));
    expect(btcPayload).toMatchObject({
      src_address: BTC_TRADING,
      address_type: 'P2WPKH',
      wallet_used: 'TRADING',
      dst_chain_id: Number(getIntentRelayChainId(ChainKeys.SONIC_MAINNET)),
    });
    expect(btcPayload.data).toMatch(/^0x[0-9a-f]+$/);

    const pollId = `od:${keccak256(stringToBytes(signed.payload_hex)).slice(2)}`;
    expect(relayArg?.pollTxHash).toBe(pollId);
    expect(result).toEqual({ ok: true, value: { srcChainTxHash: pollId, dstChainTxHash: '0xdstCancelTx' } });
  });

  it('on Bitcoin (TRADING), a raw cancel needs params.srcAddress and sends from it', async () => {
    const intent = bitcoinIntent();
    const sendMessageSpy = vi.spyOn(sodax.spoke, 'sendMessage');

    const missing = await sodax.swaps.createCancelIntent({
      params: { srcChainKey: ChainKeys.BITCOIN_MAINNET, intent, skipSimulation: true },
      raw: true,
    });
    expect(missing.ok).toBe(false);
    if (!missing.ok)
      expect(String((missing.error as { cause?: unknown }).cause ?? missing.error)).toMatch(/srcAddress/);
    expect(sendMessageSpy).not.toHaveBeenCalled();

    sendMessageSpy.mockResolvedValueOnce({ ok: true, value: JSON.stringify({ payload_hex: '00' }) });
    const provided = await sodax.swaps.createCancelIntent({
      params: { srcChainKey: ChainKeys.BITCOIN_MAINNET, intent, srcAddress: BTC_PERSONAL, skipSimulation: true },
      raw: true,
    });
    expect(provided.ok).toBe(true);
    expect(sendMessageSpy.mock.calls[0]?.[0]).toMatchObject({
      srcAddress: BTC_PERSONAL,
      dstAddress: intent.creator,
      raw: true,
    });
  });

  it('returns a verifyTxHash failure, or the relay failure Result, unchanged after a successful spoke cancel', async () => {
    const verifyError = new Error('VERIFY_FAILED');
    const relayError = new Error('SUBMIT_TX_FAILED', { cause: new Error('relay rejected') });
    vi.spyOn(sodax.spoke, 'sendMessage').mockResolvedValue({ ok: true, value: '0xspokeCancelTx' });
    vi.spyOn(sodax.spoke, 'verifyTxHash').mockResolvedValueOnce({ ok: false, error: verifyError });
    mocks.relayTxAndWaitPacket.mockResolvedValueOnce({ ok: false, error: relayError });
    const cancel = () =>
      sodax.swaps.cancelIntent({
        params: { srcChainKey: ChainKeys.BSC_MAINNET, intent: makeIntent(ChainKeys.BSC_MAINNET) },
        walletProvider: mockEvmProvider,
      });

    expect(await cancel()).toEqual({ ok: false, error: verifyError });
    expect(mocks.relayTxAndWaitPacket).not.toHaveBeenCalled();
    expect(await cancel()).toEqual({ ok: false, error: relayError });
  });
});

// =========================================================================
// Batch 7: swap — backend 2-step submit-tx flow (swaps.useBackendSubmitTx, default ON).
// =========================================================================

describe('SwapService.swap — backend 2-step (useBackendSubmitTx)', () => {
  // A separate Sodax instance with backend submit-tx ON (the default). Per-test we stub createIntent + verifyTxHash
  // on this instance and the backend swaps API it calls (submitTx / getSubmitTxStatus); the
  // module-level `mocks.relayTxAndWaitPacket` / `mocks.solverPostExecution` cover the fallback path.
  const sodaxBE = new Sodax({ logger: 'silent' });

  // createIntent (broadcast) + on-chain verify both succeed, so swap() reaches the submit/fallback branch.
  const stubCreatedAndVerified = (srcChain: SpokeChainKey) => {
    const intent = makeIntent(srcChain as Parameters<typeof getIntentRelayChainId>[0]);
    vi.spyOn(sodaxBE.swaps, 'createIntent').mockResolvedValueOnce({
      ok: true,
      value: {
        tx: '0xspokeTx',
        intent: { ...intent, feeAmount: 0n },
        relayData: { address: intent.creator, payload: '0xpay' },
      },
    });
    // Returned so a test can assert WHETHER it ran: on-chain verification belongs to the client-side
    // path only, so the backend happy path must never reach it (see SWAPS.md § Backend 2-step submit).
    return vi.spyOn(sodaxBE.spoke, 'verifyTxHash').mockResolvedValue({ ok: true, value: true });
  };

  it('settles an MPC-relay source client-side without trying the backend, keeping the source hash on a malformed hub hash', async () => {
    const submitSpy = vi.spyOn(sodaxBE.api.swaps, 'submitTx');
    const settleSpy = vi
      .spyOn(sodaxBE.spoke, 'settle')
      .mockResolvedValueOnce({ ok: true, value: { srcChainTxHash: '0xspokeTx', dstChainTxHash: '0xbeef' } })
      .mockResolvedValueOnce({ ok: true, value: { srcChainTxHash: '0xspokeTx', dstChainTxHash: 'not-a-hash' } });
    mocks.solverPostExecution.mockResolvedValueOnce({ ok: true, value: { answer: 'OK' } });
    const swapFromTron = () => {
      stubCreatedAndVerified(ChainKeys.TRON_MAINNET);
      return sodaxBE.swaps.swap({
        params: intentInput(ChainKeys.TRON_MAINNET),
        raw: false,
        walletProvider: mockTronProvider,
      });
    };

    expect((await swapFromTron()).ok).toBe(true);
    expect(submitSpy).not.toHaveBeenCalled();
    expect(settleSpy).toHaveBeenCalledWith(expect.objectContaining({ chainKey: ChainKeys.TRON_MAINNET }));

    expect(await swapFromTron()).toMatchObject({
      ok: false,
      error: { code: 'RELAY_FAILED', context: { srcTxHash: '0xspokeTx' } },
    });
    expect(mocks.solverPostExecution).toHaveBeenCalledOnce();
  });

  it('on backend "solved", returns a SwapResponse reconstructed from the backend (no client-side relay)', async () => {
    const verifySpy = stubCreatedAndVerified(ChainKeys.BSC_MAINNET);
    const submitSpy = vi.spyOn(sodaxBE.api.swaps, 'submitTx').mockResolvedValueOnce({
      ok: true,
      value: { success: true, data: { status: 'inserted', message: 'accepted' } },
    });
    vi.spyOn(sodaxBE.api.swaps, 'getSubmitTxStatus').mockResolvedValueOnce({
      ok: true,
      value: {
        success: true,
        data: {
          txHash: '0xspokeTx',
          srcChainKey: ChainKeys.BSC_MAINNET,
          status: 'solved',
          processingAttempts: 1,
          result: { dstIntentTxHash: '0xDST', intent_hash: '0xHASH' },
        },
      },
    });

    const result = await sodaxBE.swaps.swap({
      params: intentInput(ChainKeys.BSC_MAINNET),
      raw: false,
      walletProvider: mockEvmProvider,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.intentDeliveryInfo.dstTxHash).toBe('0xDST');
      expect(result.value.solverExecutionResponse.intent_hash).toBe('0xHASH');
    }
    expect(submitSpy).toHaveBeenCalledOnce();
    // The backend owns relay + post-execution — the client-side relay/postExecution must NOT run.
    expect(mocks.relayTxAndWaitPacket).not.toHaveBeenCalled();
    expect(mocks.solverPostExecution).not.toHaveBeenCalled();
    // Nor does the SDK verify the tx on-chain before handing it over: `createIntent` broadcasts and
    // `submitTx` goes out immediately. Verifying first would delay every backend success by the source
    // chain's confirmation wait (up to its full `maxTimeoutMs`) and could fail a swap the backend's own
    // infrastructure would have completed. Keeps the documented ordering from silently drifting.
    expect(verifySpy).not.toHaveBeenCalled();
  });

  // `timeout` is per-attempt: the backend spending all of its own budget must not shorten the relay wait.
  // Sharing one deadline left the relay at the ~5s floor, which is how a slow chain hit RELAY_TIMEOUT.
  it('treats "posted_execution" as non-terminal: keeps polling, then falls back with a FRESH full timeout', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    try {
      stubCreatedAndVerified(ChainKeys.BSC_MAINNET);
      vi.spyOn(sodaxBE.api.swaps, 'submitTx').mockResolvedValueOnce({
        ok: true,
        value: { success: true, data: { status: 'inserted', message: 'accepted' } },
      });
      // `posted_execution` is a mid-lifecycle state, not the `solved` terminal. Even with the result
      // fields already populated, the success gate keys off `status === 'solved'` — so submitTx must
      // keep polling until its reserved cutoff and fall back, never reconstructing a SwapResponse here.
      vi.spyOn(sodaxBE.api.swaps, 'getSubmitTxStatus').mockResolvedValue({
        ok: true,
        value: {
          success: true,
          data: {
            txHash: '0xspokeTx',
            srcChainKey: ChainKeys.BSC_MAINNET,
            status: 'posted_execution',
            processingAttempts: 1,
            result: { dstIntentTxHash: '0xDST', intent_hash: '0xHASH' },
          },
        },
      });
      mocks.relayTxAndWaitPacket.mockResolvedValueOnce({ ok: true, value: { dst_tx_hash: '0xFALLBACKDST' } });
      mocks.solverPostExecution.mockResolvedValueOnce({ ok: true, value: { answer: 'OK' } });

      const overallTimeout = 30_000;
      const swapPromise = sodaxBE.swaps.swap({
        params: intentInput(ChainKeys.BSC_MAINNET),
        raw: false,
        walletProvider: mockEvmProvider,
        timeout: overallTimeout,
      });
      await vi.advanceTimersByTimeAsync(overallTimeout);
      const result = await swapPromise;

      expect(result.ok).toBe(true);
      // Fell back to the client-side relay (0xFALLBACKDST, not the backend's 0xDST) — proving
      // `posted_execution` did NOT satisfy the terminal-success gate.
      expect(mocks.relayTxAndWaitPacket).toHaveBeenCalled();
      if (result.ok) expect(result.value.intentDeliveryInfo.dstTxHash).toBe('0xFALLBACKDST');
      expect(mocks.relayTxAndWaitPacket.mock.calls.at(-1)?.[0]?.timeout).toBe(overallTimeout);
    } finally {
      vi.useRealTimers();
    }
  });

  it('falls back to the client-side relay when the backend submit POST is rejected, verifying exactly once', async () => {
    const verifySpy = stubCreatedAndVerified(ChainKeys.BSC_MAINNET);
    vi.spyOn(sodaxBE.api.swaps, 'submitTx').mockResolvedValueOnce({
      ok: false,
      error: new SodaxError('EXTERNAL_API_ERROR', 'backend down', { feature: 'backend' }),
    });
    const statusSpy = vi.spyOn(sodaxBE.api.swaps, 'getSubmitTxStatus');
    mocks.relayTxAndWaitPacket.mockResolvedValueOnce({ ok: true, value: { dst_tx_hash: '0xFALLBACKDST' } });
    mocks.solverPostExecution.mockResolvedValueOnce({
      ok: true,
      value: { answer: 'OK', intent_hash: '0xFBHASH' },
    });

    const result = await sodaxBE.swaps.swap({
      params: intentInput(ChainKeys.BSC_MAINNET),
      raw: false,
      walletProvider: mockEvmProvider,
      timeout: 30_000,
    });

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.intentDeliveryInfo.dstTxHash).toBe('0xFALLBACKDST');
    expect(statusSpy).not.toHaveBeenCalled(); // POST failed before any status polling
    expect(mocks.relayTxAndWaitPacket).toHaveBeenCalledOnce();
    expect(mocks.solverPostExecution).toHaveBeenCalledOnce();
    // The backend attempt costs nothing in verification; the fallback pays for it once, and only then.
    expect(verifySpy).toHaveBeenCalledOnce();
    // A backend that fails fast leaves the fallback the SAME full budget a stalled one does — the two
    // paths never share a deadline.
    expect(mocks.relayTxAndWaitPacket.mock.calls.at(-1)?.[0]?.timeout).toBe(30_000);
  });

  it('skips the backend POST when the caller leaves no budget, and treats a non-finite timeout as the default', async () => {
    // Stubbed even though the first swap must never call it: an unmocked spy calls through, so a regression
    // in the budget guard would turn this unit test into a real POST to the live backend.
    const submitSpy = vi.spyOn(sodaxBE.api.swaps, 'submitTx').mockResolvedValue({
      ok: false,
      error: new SodaxError('EXTERNAL_API_ERROR', 'unreachable', { feature: 'backend' }),
    });
    const swapWithin = async (timeout: number) => {
      stubCreatedAndVerified(ChainKeys.BSC_MAINNET);
      mocks.relayTxAndWaitPacket.mockResolvedValueOnce({ ok: true, value: { dst_tx_hash: '0xFALLBACKDST' } });
      mocks.solverPostExecution.mockResolvedValueOnce({ ok: true, value: { answer: 'OK' } });
      const result = await sodaxBE.swaps.swap({
        params: intentInput(ChainKeys.BSC_MAINNET),
        raw: false,
        walletProvider: mockEvmProvider,
        timeout,
      });
      expect(result.ok).toBe(true);
      return mocks.relayTxAndWaitPacket.mock.calls.at(-1)?.[0]?.timeout;
    };

    // Firing the POST would only arm an abort at 0ms; the relay still runs on its floor because the
    // intent tx has already landed on-chain.
    expect(await swapWithin(0)).toBe(RELAY_FALLBACK_FLOOR_MS);
    expect(submitSpy).not.toHaveBeenCalled();

    // `Number(process.env.SWAP_TIMEOUT)` with the var unset. `?? DEFAULT` does not catch NaN, and an
    // unresolved NaN would skip the POST and hand the relay `Math.max(NaN, floor)` = NaN, which
    // `waitUntilIntentExecuted` reads as an already-expired budget on an intent tx live on-chain.
    expect(await swapWithin(Number.NaN)).toBe(DEFAULT_RELAY_TX_TIMEOUT);
    expect(submitSpy).toHaveBeenCalledOnce();
    expect(submitSpy.mock.calls[0]?.[1]).toEqual({ timeout: DEFAULT_BACKEND_API_TIMEOUT });
  });
});

// =========================================================================
// Batch 7 call-through: extras.apiKey on the wire. Same 2-step flow as above, but the real
// SwapsApiService transport runs against a test-local global fetch stub, so the `x-api-key`
// asserted is the header actually sent — not an argument recorded on a stubbed method.
// =========================================================================

describe('SwapService.swap — backend 2-step extras.apiKey on the wire (call-through)', () => {
  const sodaxKeyed = new Sodax({ apiKey: 'instance-key', logger: 'silent' });

  // The same payloads the spied specs above return — they satisfy the real swaps-api validators.
  const SUBMIT_TX_BODY = { success: true, data: { status: 'inserted', message: 'accepted' } };
  const SOLVED_STATUS_BODY = {
    success: true,
    data: {
      txHash: '0xspokeTx',
      srcChainKey: ChainKeys.BSC_MAINNET,
      status: 'solved',
      processingAttempts: 1,
      result: { dstIntentTxHash: '0xDST', intent_hash: '0xHASH' },
    },
  };

  const wireFetch = vi.fn();

  beforeEach(() => {
    wireFetch.mockReset();
    // Only the two submit-tx legs may reach fetch; anything else fails the test loudly.
    wireFetch.mockImplementation(async (url: unknown, init?: { method?: string }) => {
      const { pathname } = new URL(String(url));
      if (pathname === '/v1/swaps/submit-tx' && init?.method === 'POST') {
        return { ok: true, status: 200, json: async () => SUBMIT_TX_BODY };
      }
      if (pathname === '/v1/swaps/submit-tx/status' && (init?.method ?? 'GET') === 'GET') {
        return { ok: true, status: 200, json: async () => SOLVED_STATUS_BODY };
      }
      throw new Error(`unexpected fetch: ${init?.method ?? 'GET'} ${String(url)}`);
    });
    vi.stubGlobal('fetch', wireFetch);
  });

  afterEach(() => {
    // Scoped to this batch — no other suite in this file stubs fetch.
    vi.unstubAllGlobals();
  });

  const stubKeyedCreated = () => {
    const intent = makeIntent(ChainKeys.BSC_MAINNET);
    vi.spyOn(sodaxKeyed.swaps, 'createIntent').mockResolvedValueOnce({
      ok: true,
      value: {
        tx: '0xspokeTx' as never,
        intent: { ...intent, feeAmount: 0n },
        relayData: { address: intent.creator, payload: '0xpay' } as never,
      } as never,
    });
    vi.spyOn(sodaxKeyed.spoke, 'verifyTxHash').mockResolvedValue({ ok: true, value: true });
  };

  /** The `x-api-key` actually sent to (pathname, method), read through `Headers` so any casing counts. */
  const keySentTo = (pathname: string, method: string): string | null => {
    const matches = wireFetch.mock.calls.filter(
      call => new URL(String(call[0])).pathname === pathname && (call[1]?.method ?? 'GET') === method,
    );
    expect(matches).toHaveLength(1);
    return new Headers(matches[0]?.[1]?.headers).get('x-api-key');
  };

  const runKeyedSwap = async (extras: { apiKey: string }) => {
    stubKeyedCreated();
    const result = await sodaxKeyed.swaps.swap({
      params: intentInput(ChainKeys.BSC_MAINNET),
      raw: false,
      walletProvider: mockEvmProvider,
      extras,
    });
    expect(result.ok).toBe(true);
    // The value round-tripped through the real transport + validators, not a stubbed method.
    if (result.ok) expect(result.value.intentDeliveryInfo.dstTxHash).toBe('0xDST');
    expect(wireFetch).toHaveBeenCalledTimes(2);
  };

  it('sends extras.apiKey over the instance key on both the submit POST and the status poll', async () => {
    await runKeyedSwap({ apiKey: 'action-key' });
    expect(keySentTo('/v1/swaps/submit-tx', 'POST')).toBe('action-key');
    expect(keySentTo('/v1/swaps/submit-tx/status', 'GET')).toBe('action-key');
  });
});

// =========================================================================
// buildApproveTxs: the unsigned entry point the swaps API calls. The only logic this layer owns
// is resolving the spender, so that is what is asserted — the ordering of the plan itself is
// covered in SpokeService.test.ts.
// =========================================================================

describe('SwapService.buildApproveTxs', () => {
  const rawTx = { from: '0x1111111111111111111111111111111111111111', to: '0x0', value: 0n, data: '0x' };

  it('approves the intents contract on the hub and the asset manager on an EVM spoke, for the intent token and amount', async () => {
    const svc = sodax.swaps;
    const params = intentInput(ChainKeys.BSC_MAINNET);
    const spy = vi.spyOn(svc.spoke, 'buildApproveTxs').mockResolvedValue({ ok: true, value: { approveTx: rawTx } });

    const onHub = await svc.buildApproveTxs({ params: intentInput(ChainKeys.SONIC_MAINNET), raw: true });
    const onSpoke = await svc.buildApproveTxs({ params, raw: true });

    expect(onHub).toEqual({ ok: true, value: { approveTx: rawTx } });
    expect(onSpoke).toEqual({ ok: true, value: { approveTx: rawTx } });
    expect(spy).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ srcChainKey: ChainKeys.SONIC_MAINNET, spender: intentsContract, raw: true }),
    );
    expect(spy).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        srcChainKey: ChainKeys.BSC_MAINNET,
        spender: spokeChainConfig[ChainKeys.BSC_MAINNET].addresses.assetManager,
        raw: true,
        token: params.inputToken,
        amount: params.inputAmount,
        owner: params.srcAddress,
      }),
    );
  });

  it('routes Stellar to the trustline branch without a spender', async () => {
    const svc = sodax.swaps;
    vi.spyOn(svc.spoke, 'buildApproveTxs').mockResolvedValueOnce({ ok: true, value: { approveTx: rawTx } });

    await svc.buildApproveTxs({ params: intentInput(ChainKeys.STELLAR_MAINNET), raw: true });

    expect(svc.spoke.buildApproveTxs).toHaveBeenCalledWith(expect.not.objectContaining({ spender: expect.anything() }));
  });

  it('wraps a spoke failure as SodaxError(APPROVE_FAILED) with the cause preserved', async () => {
    const svc = sodax.swaps;
    const spokeError = new Error('BUILD_FAILED');
    vi.spyOn(svc.spoke, 'buildApproveTxs').mockResolvedValueOnce({ ok: false, error: spokeError });

    const result = await svc.buildApproveTxs({ params: intentInput(ChainKeys.BSC_MAINNET), raw: true });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(isSodaxError(result.error)).toBe(true);
    expect((result.error as SodaxError).code).toBe('APPROVE_FAILED');
    expect((result.error as SodaxError).feature).toBe('swap');
    expect((result.error as SodaxError).cause).toBe(spokeError);
  });

  it('returns ok:false with an explanatory error for unsupported chains (Solana)', async () => {
    const result = await sodax.swaps.buildApproveTxs({ params: intentInput(ChainKeys.SOLANA_MAINNET), raw: true });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(String(result.error)).toMatch(/Approve only supported/);
    }
  });
});

// =========================================================================
// getApprovalStrategy / swapWithApproval — approve folded into the swap, one EIP-5792 batch when the
// wallet can execute atomically.
// =========================================================================

describe('SwapService approval strategy and swapWithApproval', () => {
  const RAW_APPROVE: EvmRawTransaction = {
    from: '0x1111111111111111111111111111111111111111',
    to: '0x2170Ed0880ac9A755fd29B2688956BD959F933F8',
    value: 0n,
    data: '0x095ea7b3',
  };
  const RAW_RESET: EvmRawTransaction = { ...RAW_APPROVE, data: '0x095ea7b30000' };
  const RAW_DEPOSIT: EvmRawTransaction = {
    from: '0x1111111111111111111111111111111111111111',
    to: '0x6666666666666666666666666666666666666666',
    value: 0n,
    data: '0xdeadbeef',
  };
  const confirmedBatch: EvmBatchResult = {
    status: 'success',
    statusCode: 200,
    atomic: true,
    receipts: [{ transactionHash: '0xbatchTx', status: 'success' }],
  };

  const makeBatchProvider = (support: EvmAtomicBatchSupport = 'ready') => ({
    chainType: 'EVM' as const,
    getWalletAddress: vi.fn<IEvmWalletProvider['getWalletAddress']>(),
    sendTransaction: vi.fn<IEvmWalletProvider['sendTransaction']>(),
    waitForTransactionReceipt: vi.fn<IEvmWalletProvider['waitForTransactionReceipt']>(),
    getAtomicBatchSupport: vi.fn(async (_chainId: number) => support),
    sendAtomicBatch: vi.fn(
      async (_txs: readonly EvmRawTransaction[], _options: { expectedChainId: number }) => 'batch-1',
    ),
    waitForBatch: vi.fn(async (_batchId: string) => confirmedBatch),
  });

  const intentResult = (tx: string | EvmRawTransaction) => {
    const intent = makeIntent(ChainKeys.BSC_MAINNET);
    return {
      ok: true as const,
      value: {
        tx,
        intent: { ...intent, feeAmount: 0n },
        relayData: { address: intent.creator, payload: '0xdata' as const },
      },
    };
  };
  const stubRelayAndSolver = () => {
    mocks.relayTxAndWaitPacket.mockResolvedValueOnce({ ok: true, value: { dst_tx_hash: '0xdstTx' } });
    mocks.solverPostExecution.mockResolvedValueOnce({ ok: true, value: { answer: 'OK', intent_hash: '0xhash' } });
  };
  const allowance = (valid: boolean) =>
    vi.spyOn(sodax.swaps, 'isAllowanceValid').mockResolvedValue({ ok: true, value: valid });

  describe('getApprovalStrategy', () => {
    it('surfaces a failed allowance read as ALLOWANCE_CHECK_FAILED', async () => {
      vi.spyOn(sodax.swaps, 'isAllowanceValid').mockResolvedValueOnce({ ok: false, error: new Error('rpc down') });

      const result = await sodax.swaps.getApprovalStrategy({
        params: intentInput(ChainKeys.BSC_MAINNET),
        walletProvider: makeBatchProvider(),
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('ALLOWANCE_CHECK_FAILED');
        expect(result.error.context?.action).toBe('swapWithApproval');
      }
    });

    // The support × allowAccountUpgrade matrix is resolveApprovalStrategy's to test; this pins the default.
    it('on an EVM spoke, gives a ready wallet an atomic batch when allowAccountUpgrade is left unset', async () => {
      allowance(false);
      const wallet = makeBatchProvider('ready');

      const result = await sodax.swaps.getApprovalStrategy({
        params: intentInput(ChainKeys.BSC_MAINNET),
        walletProvider: wallet,
      });

      expect(result).toEqual({ ok: true, value: 'atomic-batch' });
      expect(wallet.getAtomicBatchSupport).toHaveBeenCalledWith(56);
    });
  });

  describe('swapWithApproval — atomic batch', () => {
    const swapWithBatch = (wallet: ReturnType<typeof makeBatchProvider>) =>
      sodax.swaps.swapWithApproval({ params: intentInput(ChainKeys.BSC_MAINNET), walletProvider: wallet });

    it('sends [approve, deposit] as one batch and relays the batch tx', async () => {
      allowance(false);
      const wallet = makeBatchProvider();
      vi.spyOn(sodax.swaps, 'buildApproveTxs').mockResolvedValueOnce({ ok: true, value: { approveTx: RAW_APPROVE } });
      const createSpy = vi.spyOn(sodax.swaps, 'createIntent').mockResolvedValueOnce(intentResult(RAW_DEPOSIT));
      const approveSpy = vi.spyOn(sodax.swaps, 'approve');
      stubRelayAndSolver();

      const result = await swapWithBatch(wallet);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.approvalStrategy).toBe('atomic-batch');
        expect(result.value.intentDeliveryInfo.srcTxHash).toBe('0xbatchTx');
      }
      expect(wallet.sendAtomicBatch).toHaveBeenCalledWith([RAW_APPROVE, RAW_DEPOSIT], { expectedChainId: 56 });
      expect(wallet.waitForBatch).toHaveBeenCalledWith('batch-1', { timeout: DEFAULT_RELAY_TX_TIMEOUT });
      // The deposit is built unsigned — the wallet signs it inside the batch.
      expect(createSpy).toHaveBeenCalledWith(expect.objectContaining({ raw: true }));
      expect(createSpy.mock.calls[0]?.[0]).not.toHaveProperty('walletProvider');
      expect(approveSpy).not.toHaveBeenCalled();
      expect(wallet.sendTransaction).not.toHaveBeenCalled();
      expect(mocks.relayTxAndWaitPacket.mock.calls[0]?.[0].srcTxHash).toBe('0xbatchTx');
    });

    it('puts the stale-allowance reset first when the token needs one', async () => {
      allowance(false);
      const wallet = makeBatchProvider();
      vi.spyOn(sodax.swaps, 'buildApproveTxs').mockResolvedValueOnce({
        ok: true,
        value: { resetTx: RAW_RESET, approveTx: RAW_APPROVE },
      });
      vi.spyOn(sodax.swaps, 'createIntent').mockResolvedValueOnce(intentResult(RAW_DEPOSIT));
      stubRelayAndSolver();

      await swapWithBatch(wallet);

      expect(wallet.sendAtomicBatch).toHaveBeenCalledWith([RAW_RESET, RAW_APPROVE, RAW_DEPOSIT], {
        expectedChainId: 56,
      });
    });

    it('reports a batch that was sent but not confirmed in time as unconfirmed, not as nothing sent', async () => {
      allowance(false);
      const wallet = makeBatchProvider();
      wallet.waitForBatch.mockRejectedValueOnce(new Error('Timed out while waiting for call bundle'));
      vi.spyOn(sodax.swaps, 'buildApproveTxs').mockResolvedValueOnce({ ok: true, value: { approveTx: RAW_APPROVE } });
      vi.spyOn(sodax.swaps, 'createIntent').mockResolvedValueOnce(intentResult(RAW_DEPOSIT));
      const approveSpy = vi.spyOn(sodax.swaps, 'approve');

      const result = await swapWithBatch(wallet);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('TX_VERIFICATION_FAILED');
        expect(result.error.context).toMatchObject({
          reason: ATOMIC_BATCH_UNCONFIRMED,
          batchId: 'batch-1',
          callCount: 2,
        });
      }
      // It may still land: no second attempt of any kind.
      expect(approveSpy).not.toHaveBeenCalled();
      expect(mocks.relayTxAndWaitPacket).not.toHaveBeenCalled();
    });

    const stubBatchLegs = () => {
      vi.spyOn(sodax.swaps, 'buildApproveTxs').mockResolvedValueOnce({ ok: true, value: { approveTx: RAW_APPROVE } });
      vi.spyOn(sodax.swaps, 'createIntent').mockResolvedValueOnce(intentResult(RAW_DEPOSIT));
    };

    // A short relay timeout must not cut the batch wait short: that reports a landing batch as unconfirmed.
    it("gives the batch wait the caller's timeout when above the default, and never less than the default", async () => {
      allowance(false);
      const wallet = makeBatchProvider();
      for (const timeout of [300_000, 0]) {
        stubBatchLegs();
        stubRelayAndSolver();
        await sodax.swaps.swapWithApproval({
          params: intentInput(ChainKeys.BSC_MAINNET),
          walletProvider: wallet,
          timeout,
        });
      }

      expect(wallet.waitForBatch).toHaveBeenNthCalledWith(1, 'batch-1', { timeout: 300_000 });
      expect(wallet.waitForBatch).toHaveBeenNthCalledWith(2, 'batch-1', { timeout: DEFAULT_RELAY_TX_TIMEOUT });
    });

    it('falls back to approving separately when the wallet refuses the batch before signing', async () => {
      allowance(false);
      const wallet = makeBatchProvider('supported');
      wallet.sendAtomicBatch.mockRejectedValueOnce(
        new TransactionExecutionError(new AtomicityNotSupportedError(new Error('no atomicity')), { account: null }),
      );
      vi.spyOn(sodax.swaps, 'buildApproveTxs').mockResolvedValueOnce({ ok: true, value: { approveTx: RAW_APPROVE } });
      const createSpy = vi
        .spyOn(sodax.swaps, 'createIntent')
        .mockResolvedValueOnce(intentResult(RAW_DEPOSIT))
        .mockResolvedValueOnce(intentResult('0xspokeTx'));
      const approveSpy = vi.spyOn(sodax.swaps, 'approve').mockResolvedValueOnce({ ok: true, value: '0xapproveTx' });
      vi.spyOn(sodax.spoke, 'waitForTxReceipt').mockResolvedValueOnce({
        ok: true,
        value: { status: 'success', receipt: {} as never },
      });
      stubRelayAndSolver();

      const result = await swapWithBatch(wallet);

      expect(result.ok).toBe(true);
      if (result.ok) expect(result.value.approvalStrategy).toBe('sequential');
      expect(approveSpy).toHaveBeenCalledOnce();
      // The batch path already built (and so validated) the intent: no second unsigned build.
      expect(createSpy).toHaveBeenCalledTimes(2);
      expect(createSpy).toHaveBeenLastCalledWith(expect.objectContaining({ walletProvider: wallet }));
      expect(mocks.relayTxAndWaitPacket.mock.calls[0]?.[0].srcTxHash).toBe('0xspokeTx');
    });
  });

  describe('swapWithApproval — resuming an unconfirmed batch', () => {
    const stubResumeRelay = () => {
      mocks.relayTxAndWaitPacket.mockResolvedValueOnce({ ok: true, value: { dst_tx_hash: '0xdstTx' } });
      mocks.solverPostExecution.mockResolvedValueOnce({ ok: true, value: { answer: 'OK', intent_hash: '0xhash' } });
    };
    const resume = (wallet: ReturnType<typeof makeBatchProvider>) =>
      sodax.swaps.swapWithApproval({
        params: intentInput(ChainKeys.BSC_MAINNET),
        walletProvider: wallet,
        resumeBatchId: 'batch-1',
      });

    it('finishes a batch that confirms after the first wait, without sending anything again', async () => {
      allowance(false);
      const wallet = makeBatchProvider();
      wallet.waitForBatch.mockRejectedValueOnce(new Error('Timed out while waiting for call bundle'));
      vi.spyOn(sodax.swaps, 'buildApproveTxs').mockResolvedValueOnce({ ok: true, value: { approveTx: RAW_APPROVE } });
      const createSpy = vi.spyOn(sodax.swaps, 'createIntent').mockResolvedValueOnce(intentResult(RAW_DEPOSIT));
      const approveSpy = vi.spyOn(sodax.swaps, 'approve');

      const first = await sodax.swaps.swapWithApproval({
        params: intentInput(ChainKeys.BSC_MAINNET),
        walletProvider: wallet,
      });
      expect(first.ok).toBe(false);
      if (first.ok) return;
      expect(first.error.context).toMatchObject({ reason: ATOMIC_BATCH_UNCONFIRMED, batchId: 'batch-1', callCount: 2 });

      const hubIntent = makeIntent(ChainKeys.BSC_MAINNET);
      mocks.getIntent.mockResolvedValueOnce(hubIntent);
      stubResumeRelay();

      const result = await resume(wallet);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.approvalStrategy).toBe('atomic-batch');
        expect(result.value.intent).toBe(hubIntent);
        expect(result.value.intentDeliveryInfo).toMatchObject({ srcTxHash: '0xbatchTx', dstTxHash: '0xdstTx' });
      }
      expect(wallet.sendAtomicBatch).toHaveBeenCalledOnce();
      expect(createSpy).toHaveBeenCalledOnce();
      expect(approveSpy).not.toHaveBeenCalled();
      expect(wallet.waitForBatch).toHaveBeenLastCalledWith('batch-1', { timeout: DEFAULT_RELAY_TX_TIMEOUT });
      // The relay takes an EVM tx by hash; the intent comes back from the hub tx it delivered.
      expect(mocks.relayTxAndWaitPacket).toHaveBeenCalledOnce();
      expect(mocks.relayTxAndWaitPacket.mock.calls[0]?.[0]).toEqual({
        srcTxHash: '0xbatchTx',
        chainKey: ChainKeys.BSC_MAINNET,
        relayerApiEndpoint: sodax.swaps.relayerApiEndpoint,
        timeout: DEFAULT_RELAY_TX_TIMEOUT,
      });
      expect(mocks.getIntent.mock.calls[0]?.[0]).toBe('0xdstTx');
      expect(mocks.solverPostExecution).toHaveBeenCalledOnce();
    });

    it('keeps the deposit tx on a relay failure, and the hub tx on a postExecution failure, so either can be retried', async () => {
      const wallet = makeBatchProvider();
      mocks.relayTxAndWaitPacket
        .mockResolvedValueOnce({ ok: false, error: new Error('RELAY_TIMEOUT') })
        .mockResolvedValueOnce({ ok: true, value: { dst_tx_hash: '0xdstTx' } });
      mocks.solverPostExecution.mockResolvedValueOnce({ ok: false, error: { detail: { code: -7, message: 'down' } } });

      const relayFailed = await resume(wallet);
      invariant(!relayFailed.ok, 'expected a relay failure');
      expect(relayFailed.error.code).toBe('RELAY_TIMEOUT');
      expect(relayFailed.error.context?.srcTxHash).toBe('0xbatchTx');
      expect(mocks.solverPostExecution).not.toHaveBeenCalled();

      const solverFailed = await resume(wallet);
      invariant(!solverFailed.ok, 'expected a solver failure');
      expect(solverFailed.error.context).toMatchObject({ srcTxHash: '0xbatchTx', dstTxHash: '0xdstTx' });
    });

    it('rejects resuming with a wallet that cannot batch', async () => {
      const result = await sodax.swaps.swapWithApproval({
        params: intentInput(ChainKeys.BSC_MAINNET),
        walletProvider: mockEvmProvider,
        resumeBatchId: 'batch-1',
      });

      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe('VALIDATION_FAILED');
      expect(mocks.relayTxAndWaitPacket).not.toHaveBeenCalled();
    });
  });

  describe('swapWithApproval — sequential and not-required', () => {
    it('builds the intent, then approves and waits for it, then sends the intent', async () => {
      allowance(false);
      const approveSpy = vi.spyOn(sodax.swaps, 'approve').mockResolvedValueOnce({ ok: true, value: '0xapproveTx' });
      const receiptSpy = vi
        .spyOn(sodax.spoke, 'waitForTxReceipt')
        .mockResolvedValueOnce({ ok: true, value: { status: 'success', receipt: {} as never } });
      const createSpy = vi
        .spyOn(sodax.swaps, 'createIntent')
        .mockResolvedValueOnce(intentResult(RAW_DEPOSIT))
        .mockResolvedValueOnce(intentResult('0xspokeTx'));
      stubRelayAndSolver();

      const result = await sodax.swaps.swapWithApproval({
        params: intentInput(ChainKeys.BSC_MAINNET),
        walletProvider: mockEvmProvider,
      });

      expect(result.ok).toBe(true);
      if (result.ok) expect(result.value.approvalStrategy).toBe('sequential');
      expect(receiptSpy).toHaveBeenCalledWith({ txHash: '0xapproveTx', chainKey: ChainKeys.BSC_MAINNET });
      expect(createSpy.mock.calls[0]?.[0]).toMatchObject({ raw: true });
      expect(createSpy.mock.calls[1]?.[0]).toMatchObject({ walletProvider: mockEvmProvider });
      const [preflightOrder, createOrder] = createSpy.mock.invocationCallOrder;
      const [approveOrder] = approveSpy.mock.invocationCallOrder;
      const [receiptOrder] = receiptSpy.mock.invocationCallOrder;
      expect(preflightOrder).toBeLessThan(approveOrder ?? 0);
      expect(approveOrder).toBeLessThan(receiptOrder ?? 0);
      expect(receiptOrder).toBeLessThan(createOrder ?? 0);
    });

    it('asks for no approval when the intent cannot be built', async () => {
      allowance(false);
      const invalid = new SodaxError('VALIDATION_FAILED', 'Unsupported spoke chain token', { feature: 'swap' });
      vi.spyOn(sodax.swaps, 'createIntent').mockResolvedValueOnce({ ok: false, error: invalid });
      const approveSpy = vi.spyOn(sodax.swaps, 'approve');

      const result = await sodax.swaps.swapWithApproval({
        params: intentInput(ChainKeys.BSC_MAINNET),
        walletProvider: mockEvmProvider,
      });

      expect(!result.ok && result.error).toBe(invalid);
      expect(approveSpy).not.toHaveBeenCalled();
    });

    it('stops at a rejected approval, and at one that did not confirm, after only the unsigned preflight build', async () => {
      allowance(false);
      vi.spyOn(sodax.swaps, 'approve')
        .mockResolvedValueOnce({
          ok: false,
          error: new SodaxError('USER_REJECTED', 'User rejected the request', { feature: 'swap' }),
        })
        .mockResolvedValueOnce({ ok: true, value: '0xapproveTx' });
      vi.spyOn(sodax.spoke, 'waitForTxReceipt').mockResolvedValueOnce({
        ok: true,
        value: { status: 'failure', error: new Error('reverted') },
      });
      const createSpy = vi.spyOn(sodax.swaps, 'createIntent').mockResolvedValue(intentResult(RAW_DEPOSIT));
      const swapSequentially = () =>
        sodax.swaps.swapWithApproval({ params: intentInput(ChainKeys.BSC_MAINNET), walletProvider: mockEvmProvider });

      const rejected = await swapSequentially();
      invariant(!rejected.ok, 'expected a rejected approval');
      expect(rejected.error.code).toBe('USER_REJECTED');
      expect(rejected.error.context).toMatchObject({ action: 'swapWithApproval', approvalStrategy: 'sequential' });

      const unconfirmed = await swapSequentially();
      invariant(!unconfirmed.ok, 'expected an unconfirmed approval');
      expect(unconfirmed.error.code).toBe('APPROVE_FAILED');
      expect(unconfirmed.error.context).toMatchObject({
        reason: 'approve-not-confirmed',
        approveTxHash: '0xapproveTx',
      });

      // Only the unsigned preflight builds ran; nothing was sent after either approval.
      expect(createSpy).toHaveBeenCalledTimes(2);
      for (const call of createSpy.mock.calls) expect(call[0]).toMatchObject({ raw: true });
    });
  });

  it('creates the intent directly when no approval is needed, tracked as its own action with the strategy that ran', async () => {
    const events: AnalyticsEvent[] = [];
    const tracked = new Sodax({
      logger: 'silent',
      swaps: { useBackendSubmitTx: false },
      analytics: { tracker: event => void events.push(event) },
    });
    vi.spyOn(tracked.swaps, 'isAllowanceValid').mockResolvedValue({ ok: true, value: true });
    const approveSpy = vi.spyOn(tracked.swaps, 'approve');
    const createSpy = vi.spyOn(tracked.swaps, 'createIntent').mockResolvedValueOnce(intentResult('0xspokeTx'));
    vi.spyOn(tracked.spoke, 'verifyTxHash').mockResolvedValue({ ok: true, value: true });
    stubRelayAndSolver();

    const result = await tracked.swaps.swapWithApproval({
      params: intentInput(ChainKeys.BSC_MAINNET),
      walletProvider: mockEvmProvider,
    });

    expect(result.ok && result.value.approvalStrategy).toBe('not-required');
    expect(approveSpy).not.toHaveBeenCalled();
    expect(createSpy).toHaveBeenCalledWith(expect.objectContaining({ walletProvider: mockEvmProvider }));
    expect(events.map(event => [event.action, event.phase])).toEqual([
      ['swapWithApproval', 'start'],
      ['swapWithApproval', 'success'],
    ]);
    expect(events[1]?.data).toMatchObject({ approvalStrategy: 'not-required', srcTxHash: '0xspokeTx' });
  });
});

// =========================================================================
// swaps.useBackendSubmitTx — the deprecated forms stay honoured (type-wise and at runtime).
// =========================================================================

describe('SwapService.useBackendSubmitTx — deprecated forms', () => {
  it('gives swaps.useBackendSubmitTx precedence over swapsOptions, honours the deprecated constructor flag, and keeps the deprecated types assignable', () => {
    expect(
      new Sodax({ swaps: { useBackendSubmitTx: false }, swapsOptions: { useBackendSubmitTx: true } }).swaps
        .useBackendSubmitTx,
    ).toBe(false);
    expect(
      new Sodax({ swaps: { useBackendSubmitTx: true }, swapsOptions: { useBackendSubmitTx: false } }).swaps
        .useBackendSubmitTx,
    ).toBe(true);

    const configured = new Sodax();
    const deps = {
      config: configured.config,
      spoke: configured.spoke,
      hubProvider: configured.hubProvider,
      backendApi: configured.swaps.backendApi,
    };
    expect(new SwapService({ ...deps, useBackendSubmitTx: false }).useBackendSubmitTx).toBe(false);
    expect(new SwapService(deps).useBackendSubmitTx).toBe(true);

    expectTypeOf<SwapsClientOptions>().toEqualTypeOf<NonNullable<SodaxOptions['swapsOptions']>>();
    expectTypeOf<SwapServiceConstructorParams['useBackendSubmitTx']>().toEqualTypeOf<boolean | undefined>();
  });
});

describe('Production solver routing', () => {
  // `satisfies Record<MpcRelayChainKey, …>` forces a row for every MPC-relay chain added later.
  const unsupportedTokens = {
    [ChainKeys.TRON_MAINNET]: tronSupportedTokens.USDT.address,
    [ChainKeys.XRP_MAINNET]: 'unlisted-xrp-token',
    [ChainKeys.MONAD_MAINNET]: monadSupportedTokens.USDC.address,
    [ChainKeys.TON_MAINNET]: tonSupportedTokens.TON.address,
    [ChainKeys.ZCASH_MAINNET]: zcashSupportedTokens.ZEC.address,
    [ChainKeys.CARDANO_MAINNET]: cardanoSupportedTokens.ADA.address,
  } satisfies Record<MpcRelayChainKey, string>;

  it.each(
    Object.keys(MpcRelayChainMap).filter((key): key is MpcRelayChainKey => Object.hasOwn(unsupportedTokens, key)),
  )('refuses unsupported %s routes before signing', async chainKey => {
    const unsupported = unsupportedTokens[chainKey];
    const production = new Sodax();
    vi.spyOn(production.config, 'isValidOriginalAssetAddress').mockReturnValue(true);
    const deposit = vi.spyOn(production.spoke, 'deposit');
    const supported = arbitrumSupportedTokens.WBTC.address;
    const routes = [
      {
        srcChainKey: chainKey,
        inputToken: unsupported,
        dstChainKey: ChainKeys.ARBITRUM_MAINNET,
        outputToken: supported,
      },
      {
        srcChainKey: ChainKeys.ARBITRUM_MAINNET,
        inputToken: supported,
        dstChainKey: chainKey,
        outputToken: unsupported,
      },
    ];

    for (const route of routes) {
      const result = await production.swaps.createIntent({
        params: { ...intentInput(route.srcChainKey), ...route },
        raw: true,
      });
      expect(result).toMatchObject({
        ok: false,
        error: { code: 'VALIDATION_FAILED', message: expect.stringContaining('production solver') },
      });
    }
    expect(deposit).not.toHaveBeenCalled();
  });

  it('leaves production routes between non-MPC chains to the solver', async () => {
    const production = new Sodax({ logger: 'silent' });
    const pastValidation = vi
      .spyOn(production.hubProvider, 'getUserHubWalletAddress')
      .mockRejectedValue(new Error('past validation'));
    const result = await production.swaps.createIntent({
      params: {
        ...intentInput(ChainKeys.ETHEREUM_MAINNET),
        inputToken: spokeChainConfig[ChainKeys.ETHEREUM_MAINNET].supportedTokens.WBTC.address,
        outputToken: arbitrumSupportedTokens.WBTC.address,
      },
      raw: true,
    });
    expect(result).toMatchObject({ ok: false, error: { message: expect.not.stringContaining('production solver') } });
    expect(pastValidation).toHaveBeenCalled();
  });
});

describe('Monad swap settlement policy', () => {
  it('reopens status from the original Monad hash without sending again', async () => {
    const source = '0x1234';
    const hub = '0xbeef';
    const deposit = vi.spyOn(sodax.spoke, 'deposit');
    vi.spyOn(sodax.api.swaps, 'getSubmitTxStatus').mockResolvedValue({
      ok: false,
      error: new Error('No record'),
    } as never);
    const read = vi.spyOn(sodax.spoke, 'getMpcRelayDeposit').mockResolvedValue({
      ok: true,
      value: {
        depositId: 'test',
        status: 'minted',
        createdAt: null,
        txs: { hubMint: { chain: 'sonic', hash: hub, ts: 0 } },
      },
    });
    mocks.solverGetStatus.mockResolvedValueOnce({ ok: true, value: { status: SolverIntentStatusCode.SOLVED } });
    await expect(
      sodax.swaps.getDetailedStatus({
        srcChainKey: ChainKeys.MONAD_MAINNET,
        srcTxHash: source,
      }),
    ).resolves.toMatchObject({ ok: true, value: { source: 'solver', dstTxHash: hub } });
    expect(read).toHaveBeenCalledWith(ChainKeys.MONAD_MAINNET, source);
    expect(deposit).not.toHaveBeenCalled();
  });
});
