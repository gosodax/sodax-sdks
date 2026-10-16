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
import { afterEach, beforeEach, describe, expect, expectTypeOf, it, vi } from 'vitest';
import {
  ChainKeys,
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
  type IWalletProvider,
  DEFAULT_BACKEND_API_TIMEOUT,
  DEFAULT_RELAY_TX_TIMEOUT,
  SolverIntentErrorCode,
  SolverIntentStatusCode,
  type Result,
  type SpokeChainKey,
  type SubmitTxStatusDataV2,
} from '@sodax/types';
import {
  ACCOUNT_UPGRADE_DECLINED,
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
import {
  AtomicityNotSupportedError,
  AtomicReadyWalletRejectedUpgradeError,
  keccak256,
  stringToBytes,
  TransactionExecutionError,
  UserRejectedRequestError,
} from 'viem';
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

const sodax = new Sodax({ swaps: { useBackendSubmitTx: false } });

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

// =========================================================================
// Type-level tests — these use `expectTypeOf` and `@ts-expect-error` to prove
// that the compiler narrows walletProvider on srcChainKey + raw.
// =========================================================================

describe('SwapService types — walletProvider narrowing', () => {
  // WalletProviderSlot is the spoke-layer helper still used by DepositParams / SendMessageParams.
  // Keep its type-level tests here as a regression safety net.
  it('WalletProviderSlot forbids walletProvider when raw is true', () => {
    expectTypeOf<WalletProviderSlot<'0x38.bsc', true>>().toEqualTypeOf<{ raw: true; walletProvider?: never }>();
  });

  it('WalletProviderSlot requires narrowed EVM walletProvider when raw is false or omitted', () => {
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
  });

  it('WalletProviderSlot narrows walletProvider to Solana / Stellar / Bitcoin for their respective chain keys', () => {
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
  });

  it('SwapActionParams (exec) narrows walletProvider via K inferred from params.srcChain', () => {
    expectTypeOf<SwapActionParams<'0x38.bsc'>['walletProvider']>().toEqualTypeOf<IEvmWalletProvider>();
    expectTypeOf<SwapActionParams<'ethereum'>['walletProvider']>().toEqualTypeOf<IEvmWalletProvider>();
    expectTypeOf<SwapActionParams<'sonic'>['walletProvider']>().toEqualTypeOf<IEvmWalletProvider>();
    expectTypeOf<SwapActionParams<'solana'>['walletProvider']>().toEqualTypeOf<ISolanaWalletProvider>();
    expectTypeOf<SwapActionParams<'stellar'>['walletProvider']>().toEqualTypeOf<IStellarWalletProvider>();
    expectTypeOf<SwapActionParams<'bitcoin'>['walletProvider']>().toEqualTypeOf<IBitcoinWalletProvider>();
  });

  it('SwapActionParams in raw mode narrows walletProvider to never', () => {
    expectTypeOf<SwapActionParams<'0x38.bsc', true>>().toHaveProperty('walletProvider').toEqualTypeOf<undefined>();
    expectTypeOf<SwapActionParams<'bitcoin', true>>().toHaveProperty('walletProvider').toEqualTypeOf<undefined>();
  });

  it('SwapAllowanceParams narrows walletProvider via the K inferred from params.srcChain', () => {
    expectTypeOf<SwapActionParams<'0x38.bsc'>['walletProvider']>().toEqualTypeOf<IEvmWalletProvider>();
    expectTypeOf<SwapActionParams<'solana'>['walletProvider']>().toEqualTypeOf<ISolanaWalletProvider>();
  });

  it('CancelIntentParams narrows walletProvider via the explicit srcChainKey', () => {
    // cancelIntent keeps the explicit srcChainKey because Intent.srcChain is an
    // IntentRelayChainId (bigint) that can't narrow to a literal ChainKey at the type level.
    expectTypeOf<CancelIntentActionParams<'0x38.bsc', false>>()
      .toHaveProperty('walletProvider')
      .toEqualTypeOf<IEvmWalletProvider>();
    expectTypeOf<CancelIntentActionParams<'solana', false>>()
      .toHaveProperty('walletProvider')
      .toEqualTypeOf<ISolanaWalletProvider>();
  });

  it('CreateIntentParams carries srcChainKey (the K generic anchor)', () => {
    expectTypeOf<CreateIntentParams>().toHaveProperty('srcChainKey');
    expectTypeOf<CreateIntentParams<'0x38.bsc'>['srcChainKey']>().toEqualTypeOf<'0x38.bsc'>();
  });

  it('SwapActionParams with unconstrained K falls back to IWalletProvider', () => {
    expectTypeOf<SwapActionParams<SpokeChainKey, false>['walletProvider']>().toEqualTypeOf<IWalletProvider>();
  });
});

describe('SwapService types — method signatures reject mismatched walletProvider', () => {
  // These are compile-time assertions; if they compile, the test passes.
  // The call sites are guarded with @ts-expect-error so a regression (the compiler accepting
  // a mismatched provider) immediately surfaces as a test failure. Wrapping them in an unreachable
  // branch (`if (false)`) keeps the typechecker honest without running the bodies at runtime.

  it('rejects Solana provider when params.srcChain is an EVM literal (createIntent)', () => {
    const svc = sodax.swaps;
    if (false as boolean) {
      void svc.createIntent({
        params: intentInput(ChainKeys.BSC_MAINNET),
        raw: false,
        // @ts-expect-error — ISolanaWalletProvider cannot satisfy IEvmWalletProvider.
        walletProvider: mockSolanaProvider,
      });
    }
  });

  it('requires walletProvider on createIntent (no raw field in new API)', () => {
    const svc = sodax.swaps;
    if (false as boolean) {
      // @ts-expect-error — walletProvider is required by SwapActionParams.
      void svc.createIntent({ params: intentInput(ChainKeys.BSC_MAINNET) });
    }
  });

  it('createIntentRaw rejects walletProvider — the raw twin has no such field', () => {
    const svc = sodax.swaps;
    if (false as boolean) {
      // @ts-expect-error — walletProvider is forbidden when raw is true.
      void svc.createIntent({
        params: intentInput(ChainKeys.BSC_MAINNET),
        raw: true,
        walletProvider: mockEvmProvider,
      });
    }
  });

  it('rejects mismatched provider on cancelIntent', () => {
    const svc = sodax.swaps;
    if (false as boolean) {
      void svc.cancelIntent({
        params: {
          srcChainKey: ChainKeys.BSC_MAINNET,
          intent: makeIntent(),
        },
        intent: makeIntent(),
        // @ts-expect-error — Stellar provider cannot satisfy an EVM srcChainKey.
        walletProvider: mockStellarProvider,
      });
    }
  });
});

// =========================================================================
// Method-invocation type narrowing — proves that K is correctly inferred from
// `params.srcChain` (or `srcChainKey` for cancelIntent) at every public method's
// call site, and that walletProvider is narrowed accordingly. Each `it` block is
// a compile-time test wrapped in `if (false as boolean)` so the body is never
// executed at runtime — vitest still asserts the expectTypeOf checks (which run
// at compile time) and counts the test as passing if the file type-checks.
// =========================================================================

describe('SwapService.createIntent — narrows walletProvider from params.srcChain', () => {
  const svc = sodax.swaps;

  it('EVM literal (ethereum) → walletProvider must be IEvmWalletProvider', () => {
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
    }
  });

  it('Solana literal → walletProvider must be ISolanaWalletProvider', () => {
    if (false as boolean) {
      void svc.createIntent({
        params: intentInput(ChainKeys.SOLANA_MAINNET),
        walletProvider: mockSolanaProvider,
      });
      void svc.createIntent({
        params: intentInput(ChainKeys.SOLANA_MAINNET),
        // @ts-expect-error — ISolanaWalletProvider required, not IEvmWalletProvider.
        walletProvider: mockEvmProvider,
      });
    }
  });

  it('Stellar literal → walletProvider must be IStellarWalletProvider', () => {
    if (false as boolean) {
      void svc.createIntent({
        params: intentInput(ChainKeys.STELLAR_MAINNET),
        walletProvider: mockStellarProvider,
      });
      void svc.createIntent({
        params: intentInput(ChainKeys.STELLAR_MAINNET),
        // @ts-expect-error — IStellarWalletProvider required, not IEvmWalletProvider.
        walletProvider: mockEvmProvider,
      });
    }
  });

  it('Bitcoin literal → walletProvider must be IBitcoinWalletProvider', () => {
    if (false as boolean) {
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
  });

  it('createIntentRaw accepts any chain without walletProvider', () => {
    if (false as boolean) {
      void svc.createIntent({ params: intentInput(ChainKeys.BSC_MAINNET), raw: true });
      void svc.createIntent({ params: intentInput(ChainKeys.SOLANA_MAINNET), raw: true });
      void svc.createIntent({ params: intentInput(ChainKeys.STELLAR_MAINNET), raw: true });
    }
  });

  it('omitting walletProvider on createIntent is rejected', () => {
    if (false as boolean) {
      // @ts-expect-error — walletProvider is required by SwapActionParams.
      void svc.createIntent({ params: intentInput(ChainKeys.BSC_MAINNET) });
    }
  });

  it('explicit <SpokeChainKey> generic still requires walletProvider (exec) and rejects on raw twin', () => {
    if (false as boolean) {
      const params: CreateIntentParams<SpokeChainKey> = intentInput(ChainKeys.BSC_MAINNET);

      // @ts-expect-error — walletProvider required on exec even with broad K.
      void svc.createIntent<SpokeChainKey>({ params });
      void svc.createIntent({ params, raw: true });

      // Broad K falls back to IWalletProvider union; all chain providers are accepted.
      void svc.createIntent<SpokeChainKey, false>({ params, walletProvider: mockEvmProvider });
      void svc.createIntent<SpokeChainKey, false>({ params, walletProvider: mockSolanaProvider });
      void svc.createIntent<SpokeChainKey, false>({ params, walletProvider: mockStellarProvider });
    }
  });

  it('extras.srcPublicKey is keyed off K — typeable for Stacks, rejected elsewhere', () => {
    if (false as boolean) {
      // Stacks: srcPublicKey is part of the extras type.
      void svc.createIntent({
        params: intentInput(ChainKeys.STACKS_MAINNET),
        extras: { srcPublicKey: '02ab' },
        raw: true,
      });
      // partnerFee is chain-agnostic — accepted on any chain.
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
    }
  });

  it('extras.bound is keyed off K — typeable for Bitcoin, rejected elsewhere', () => {
    if (false as boolean) {
      // Bitcoin: the grouped `bound` slot is part of the extras type.
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
  });
});

describe('SwapService.swap — narrows walletProvider (always exec)', () => {
  const svc = sodax.swaps;

  it('EVM literal → walletProvider must be IEvmWalletProvider', () => {
    if (false as boolean) {
      void svc.swap({
        params: intentInput(ChainKeys.BSC_MAINNET),
        walletProvider: mockEvmProvider,
      });
      void svc.swap({
        params: intentInput(ChainKeys.BSC_MAINNET),
        // @ts-expect-error — Solana provider mismatched.
        walletProvider: mockSolanaProvider,
      });
    }
  });

  it('Solana literal → walletProvider must be ISolanaWalletProvider', () => {
    if (false as boolean) {
      void svc.swap({
        params: intentInput(ChainKeys.SOLANA_MAINNET),
        walletProvider: mockSolanaProvider,
      });
      void svc.swap({
        params: intentInput(ChainKeys.SOLANA_MAINNET),
        // @ts-expect-error — EVM provider mismatched.
        walletProvider: mockEvmProvider,
      });
    }
  });

  it('walletProvider is mandatory on swap', () => {
    if (false as boolean) {
      // @ts-expect-error — swap always executes; walletProvider is required.
      void svc.swap({ params: intentInput(ChainKeys.BSC_MAINNET) });
    }
  });
});

describe('SwapService.approve — narrows walletProvider from params.srcChain', () => {
  const svc = sodax.swaps;

  it('EVM literal → walletProvider must be IEvmWalletProvider', () => {
    if (false as boolean) {
      void svc.approve({
        params: intentInput(ChainKeys.BSC_MAINNET),
        walletProvider: mockEvmProvider,
      });
      void svc.approve({
        params: intentInput(ChainKeys.BSC_MAINNET),
        // @ts-expect-error — Stellar provider mismatched.
        walletProvider: mockStellarProvider,
      });
    }
  });

  it('Stellar literal → walletProvider must be IStellarWalletProvider', () => {
    if (false as boolean) {
      void svc.approve({
        params: intentInput(ChainKeys.STELLAR_MAINNET),
        walletProvider: mockStellarProvider,
      });
      void svc.approve({
        params: intentInput(ChainKeys.STELLAR_MAINNET),
        // @ts-expect-error — EVM provider mismatched.
        walletProvider: mockEvmProvider,
      });
    }
  });

  it('approveRaw takes no walletProvider', () => {
    if (false as boolean) {
      void svc.approve({ params: intentInput(ChainKeys.BSC_MAINNET), raw: true });
      // @ts-expect-error — walletProvider is forbidden when raw is true.
      void svc.approve({
        params: intentInput(ChainKeys.BSC_MAINNET),
        raw: true,
        walletProvider: mockEvmProvider,
      });
    }
  });
});

describe('SwapService.isAllowanceValid — narrows walletProvider from params.srcChain', () => {
  const svc = sodax.swaps;

  it('EVM literal → walletProvider must be IEvmWalletProvider', () => {
    if (false as boolean) {
      void svc.isAllowanceValid({
        params: intentInput(ChainKeys.BSC_MAINNET),
        walletProvider: mockEvmProvider,
      });
      void svc.isAllowanceValid({
        params: intentInput(ChainKeys.BSC_MAINNET),
        // @ts-expect-error — Solana provider mismatched.
        walletProvider: mockSolanaProvider,
      });
    }
  });

  it('Bitcoin literal → walletProvider must be IBitcoinWalletProvider', () => {
    if (false as boolean) {
      void svc.isAllowanceValid({
        params: intentInput(ChainKeys.BITCOIN_MAINNET),
        walletProvider: mockBitcoinProvider,
      });
      void svc.isAllowanceValid({
        params: intentInput(ChainKeys.BITCOIN_MAINNET),
        // @ts-expect-error — Stellar provider mismatched.
        walletProvider: mockStellarProvider,
      });
    }
  });

  it('walletProvider is always required', () => {
    if (false as boolean) {
      // @ts-expect-error — walletProvider is required.
      void svc.isAllowanceValid({ params: intentInput(ChainKeys.BSC_MAINNET) });
    }
  });
});

describe('SwapService.createLimitOrder / createLimitOrderIntent — same narrowing as createIntent', () => {
  const svc = sodax.swaps;

  it('createLimitOrder: EVM literal → walletProvider must be IEvmWalletProvider', () => {
    if (false as boolean) {
      void svc.createLimitOrder({
        params: intentInput(ChainKeys.BSC_MAINNET),
        walletProvider: mockEvmProvider,
      });
      void svc.createLimitOrder({
        params: intentInput(ChainKeys.BSC_MAINNET),
        // @ts-expect-error — Solana provider mismatched.
        walletProvider: mockSolanaProvider,
      });
    }
  });

  it('createLimitOrderIntent: Solana literal → walletProvider must be ISolanaWalletProvider', () => {
    if (false as boolean) {
      void svc.createLimitOrderIntent({
        params: intentInput(ChainKeys.SOLANA_MAINNET),
        walletProvider: mockSolanaProvider,
      });
      void svc.createLimitOrderIntent({
        params: intentInput(ChainKeys.SOLANA_MAINNET),
        // @ts-expect-error — EVM provider mismatched.
        walletProvider: mockEvmProvider,
      });
    }
  });

  it('createLimitOrderIntentRaw takes no walletProvider', () => {
    if (false as boolean) {
      void svc.createLimitOrderIntent({ params: intentInput(ChainKeys.BSC_MAINNET), raw: true });
      // @ts-expect-error — walletProvider is forbidden when raw is true.
      void svc.createLimitOrderIntent({
        params: intentInput(ChainKeys.BSC_MAINNET),
        raw: true,
        walletProvider: mockEvmProvider,
      });
    }
  });
});

describe('SwapService.cancelIntent — narrows walletProvider from explicit srcChainKey', () => {
  const svc = sodax.swaps;

  it('EVM srcChainKey → walletProvider must be IEvmWalletProvider', () => {
    if (false as boolean) {
      void svc.cancelIntent({
        params: {
          srcChainKey: ChainKeys.BSC_MAINNET,
          intent: makeIntent(),
        },
        walletProvider: mockEvmProvider,
      });
      void svc.cancelIntent({
        srcChainKey: ChainKeys.BSC_MAINNET,
        params: {
          srcChainKey: ChainKeys.BSC_MAINNET,
          intent: makeIntent(),
        },
        // @ts-expect-error — Stellar provider mismatched.
        walletProvider: mockStellarProvider,
      });
    }
  });

  it('Solana srcChainKey → walletProvider must be ISolanaWalletProvider', () => {
    if (false as boolean) {
      void svc.cancelIntent({
        params: {
          srcChainKey: ChainKeys.SOLANA_MAINNET,
          intent: makeIntent(),
        },
        walletProvider: mockSolanaProvider,
      });
      void svc.cancelIntent({
        params: {
          srcChainKey: ChainKeys.SOLANA_MAINNET,
          intent: makeIntent(),
        },
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
  it('checks ERC20 allowance against the intents contract on the hub (Sonic)', async () => {
    const svc = sodax.swaps;
    vi.spyOn(svc.spoke, 'isAllowanceValid').mockResolvedValueOnce({ ok: true, value: true });

    const result = await svc.isAllowanceValid({
      params: intentInput(ChainKeys.SONIC_MAINNET),
      raw: false,
      walletProvider: mockEvmProvider,
    });

    expect(result).toEqual({ ok: true, value: true });
    expect(svc.spoke.isAllowanceValid).toHaveBeenCalledWith(
      expect.objectContaining({
        srcChainKey: ChainKeys.SONIC_MAINNET,
        spender: intentsContract,
      } satisfies Partial<SpokeIsAllowanceValidParamsHub>),
    );
  });

  it('checks ERC20 allowance against the asset manager on EVM spokes', async () => {
    const svc = sodax.swaps;
    vi.spyOn(svc.spoke, 'isAllowanceValid').mockResolvedValueOnce({ ok: true, value: true });

    const result = await svc.isAllowanceValid({
      params: intentInput(ChainKeys.BSC_MAINNET),
      raw: false,
      walletProvider: mockEvmProvider,
    });

    expect(result).toEqual({ ok: true, value: true });
    expect(svc.spoke.isAllowanceValid).toHaveBeenCalledWith(
      expect.objectContaining({
        srcChainKey: ChainKeys.BSC_MAINNET,
        spender: spokeChainConfig[ChainKeys.BSC_MAINNET].addresses.assetManager,
      } satisfies Partial<SpokeIsAllowanceValidParamsEvmSpoke>),
    );
  });

  it('defers to Stellar trustline check for Stellar params.srcChain', async () => {
    const svc = sodax.swaps;
    const stellarParams = intentInput(ChainKeys.STELLAR_MAINNET);
    vi.spyOn(svc.spoke, 'isAllowanceValid').mockResolvedValueOnce({ ok: true, value: true });
    const result = await svc.isAllowanceValid({
      params: stellarParams,
      raw: false,
      walletProvider: mockStellarProvider,
    });
    expect(result).toEqual({ ok: true, value: true });
    expect(svc.spoke.isAllowanceValid).toHaveBeenCalledWith(
      expect.objectContaining({
        srcChainKey: ChainKeys.STELLAR_MAINNET,
        token: stellarParams.inputToken,
        amount: stellarParams.inputAmount,
        owner: stellarParams.srcAddress,
      }),
    );
  });

  it('short-circuits to true for chains without allowance semantics (e.g. Solana)', async () => {
    const svc = sodax.swaps;
    const isAllowanceValidSpy = vi.spyOn(svc.spoke, 'isAllowanceValid');
    const result = await svc.isAllowanceValid({
      params: intentInput(ChainKeys.SOLANA_MAINNET),
      raw: false,
      walletProvider: mockSolanaProvider,
    });
    expect(result).toEqual({ ok: true, value: true });
    expect(isAllowanceValidSpy).not.toHaveBeenCalled();
  });
});

describe('SwapService.approve', () => {
  it('approves the intents contract on Sonic (raw=false)', async () => {
    const svc = sodax.swaps;
    vi.spyOn(svc.spoke, 'approve').mockResolvedValueOnce({ ok: true, value: '0xapprove-hash' });

    const result = (await svc.approve({
      params: intentInput(ChainKeys.SONIC_MAINNET),
      raw: false,
      walletProvider: mockEvmProvider,
    })) as Result<`0x${string}`>;

    expect(result).toEqual({ ok: true, value: '0xapprove-hash' });
    expect(svc.spoke.approve).toHaveBeenCalledWith(
      expect.objectContaining({
        srcChainKey: ChainKeys.SONIC_MAINNET,
        spender: intentsContract,
        raw: false,
        walletProvider: mockEvmProvider,
      }),
    );
  });

  it('approves the asset manager on EVM spokes (raw=true returns raw tx, no walletProvider)', async () => {
    const svc = sodax.swaps;
    const rawTx = { from: '0x1', to: '0x2', data: '0x', value: 0n };
    vi.spyOn(svc.spoke, 'approve').mockResolvedValueOnce({ ok: true, value: rawTx });

    const result = await svc.approve({
      params: intentInput(ChainKeys.BSC_MAINNET),
      raw: true,
    });

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toBe(rawTx);
    expect(svc.spoke.approve).toHaveBeenCalledWith(expect.objectContaining({ raw: true }));
    // SwapService currently forwards `walletProvider` as `undefined` in raw mode.
    expect((svc.spoke.approve as ReturnType<typeof vi.fn>).mock.calls[0]?.[0].walletProvider).toBeUndefined();
  });

  it('delegates Stellar trustline requests to the Stellar spoke service', async () => {
    const svc = sodax.swaps;
    vi.spyOn(svc.spoke, 'approve').mockResolvedValueOnce({ ok: true, value: '0xtrustline' });
    const result = await svc.approve({
      params: intentInput(ChainKeys.STELLAR_MAINNET),
      raw: false,
      walletProvider: mockStellarProvider,
    });
    expect(result.ok).toBe(true);
    expect(svc.spoke.approve).toHaveBeenCalled();
  });
});

describe('SwapService.createIntent', () => {
  // Happy paths — the five distinct successful execution flows the method supports:
  // Sonic raw, Sonic exec, EVM spoke raw, EVM spoke exec, and the Bitcoin-specific preflight.
  describe('happy paths', () => {
    it('on Sonic, delegates to SonicSpokeService.createRawSwapIntent when raw=true', async () => {
      const svc = sodax.swaps;
      const fakeIntent = makeIntent(ChainKeys.SONIC_MAINNET);
      const rawTx = { from: '0x1', to: '0x2', data: '0x', value: 0n };
      mocks.getUserHubWalletAddress.mockResolvedValueOnce('0xhubwallet');
      mocks.sonicCreateSwapIntent.mockResolvedValueOnce([rawTx, fakeIntent, 123n, '0xdata']);

      const result = await svc.createIntent({
        params: intentInput(ChainKeys.SONIC_MAINNET),
        raw: true,
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toEqual({
          tx: rawTx,
          intent: { ...fakeIntent, feeAmount: 123n },
          relayData: { address: fakeIntent.creator, payload: '0xdata' },
        });
      }
      expect(mocks.sonicCreateSwapIntent).toHaveBeenCalled();
      expect(mocks.sonicCreateSwapIntent.mock.calls[0]?.[0].createIntentParams.srcChainKey).toBe(
        ChainKeys.SONIC_MAINNET,
      );
    });

    it('on Sonic, delegates to SonicSpokeService.createAndExecuteSwapIntent when raw=false', async () => {
      const svc = sodax.swaps;
      const fakeIntent = makeIntent(ChainKeys.SONIC_MAINNET);
      mocks.getUserHubWalletAddress.mockResolvedValueOnce('0xhubwallet');
      mocks.sonicCreateSwapIntent.mockResolvedValueOnce(['0xexec-hash', fakeIntent, 0n, '0xdata']);

      const result = await svc.createIntent({
        params: intentInput(ChainKeys.SONIC_MAINNET),
        raw: false,
        walletProvider: mockEvmProvider,
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toEqual({
          tx: '0xexec-hash',
          intent: { ...fakeIntent, feeAmount: 0n },
          relayData: { address: fakeIntent.creator, payload: '0xdata' },
        });
      }
      expect(mocks.sonicCreateSwapIntent).toHaveBeenCalled();
      const lastCall = mocks.sonicCreateSwapIntent.mock.calls.at(-1)?.[0];
      expect(lastCall?.walletProvider).toBe(mockEvmProvider);
    });

    it('on EVM spokes, builds intent data via EvmSolverService and deposits via SpokeService', async () => {
      const svc = sodax.swaps;
      mocks.getUserHubWalletAddress.mockResolvedValueOnce('0xhubwallet');
      const fakeIntent = makeIntent(ChainKeys.BSC_MAINNET);
      mocks.constructCreateIntentData.mockReturnValueOnce(['0xintentdata', fakeIntent, 42n]);
      vi.spyOn(svc.spoke, 'deposit').mockResolvedValueOnce({ ok: true, value: '0xdeposit-hash' });

      const result = await svc.createIntent({
        params: intentInput(ChainKeys.BSC_MAINNET),
        raw: false,
        walletProvider: mockEvmProvider,
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toEqual({
          tx: '0xdeposit-hash',
          intent: { ...fakeIntent, feeAmount: 42n },
          relayData: { address: fakeIntent.creator, payload: '0xintentdata' },
        });
      }
      expect(svc.spoke.deposit).toHaveBeenCalled();
      const depositCall = (svc.spoke.deposit as ReturnType<typeof vi.fn>).mock.calls[0]?.[0];
      expect(depositCall.srcChainKey).toBe(ChainKeys.BSC_MAINNET);
      expect(depositCall.raw).toBe(false);
      expect(depositCall.walletProvider).toBe(mockEvmProvider);
    });

    it('forwards the raw flag to SpokeService.deposit and does not pass walletProvider when raw=true', async () => {
      const svc = sodax.swaps;
      const params = intentInput(ChainKeys.BSC_MAINNET);
      mocks.getUserHubWalletAddress.mockResolvedValueOnce('0xhubwallet');
      mocks.constructCreateIntentData.mockReturnValueOnce(['0xintentdata', makeIntent(ChainKeys.BSC_MAINNET), 0n]);
      const rawDepositTx = { from: '0x1', to: '0x2', data: '0x', value: 0n };
      vi.spyOn(svc.spoke, 'deposit').mockResolvedValueOnce({ ok: true, value: rawDepositTx });

      const result = await svc.createIntent({ params, raw: true });

      expect(result.ok).toBe(true);
      const depositCall = (svc.spoke.deposit as ReturnType<typeof vi.fn>).mock.calls[0]?.[0];
      expect(depositCall).not.toHaveProperty('walletProvider');
      expect(depositCall.raw).toBe(true);
      expect(depositCall.srcChainKey).toBe(ChainKeys.BSC_MAINNET);
      expect(depositCall.token).toBe(params.inputToken);
      expect(depositCall.amount).toBe(params.inputAmount);
      expect(depositCall.data).toBe('0xintentdata');
      expect(depositCall.to).toBe('0xhubwallet');
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
  // `{ ok: false, error }` where `error` is a SodaxError with code `SWAP_VALIDATION_FAILED`.
  // The original invariant prose lives on `error.message` (the `Invariant failed: ` prefix is
  // stripped); `error.cause` preserves the original tiny-invariant Error.
  describe('rejects on invalid inputs', () => {
    it('rejects when walletProvider chainType does not match srcChain', async () => {
      const result = await sodax.swaps.createIntent({
        params: intentInput(ChainKeys.BSC_MAINNET),
        raw: false,
        // Solana provider on an EVM chain — the chainType mismatch trips the
        // `isUndefinedOrValidWalletProviderForChainKey` invariant. Cast defeats the
        // compile-time narrowing that would otherwise reject the call site.
        walletProvider: mockSolanaProvider as unknown as IEvmWalletProvider,
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        const caughtError = result.error;
        expect(isSodaxError(caughtError)).toBe(true);
        expect(caughtError.code).toBe('VALIDATION_FAILED');
        expect(caughtError.message).toBe('Invalid wallet provider for chain key: 0x38.bsc');
        expect(caughtError.context?.phase).toBe('validate');
      }
    });

    it('rejects when inputToken is not a valid original asset on srcChain', async () => {
      // Fail only the next call — the dstChain check right after must still return true,
      // otherwise we can't tell which invariant actually tripped.
      vi.spyOn(sodax.config, 'isValidOriginalAssetAddress').mockReturnValueOnce(false);

      const result = await sodax.swaps.createIntent({
        params: intentInput(ChainKeys.BSC_MAINNET),
        raw: false,
        walletProvider: mockEvmProvider,
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        const caughtError = result.error;
        expect(isSodaxError(caughtError)).toBe(true);
        expect(caughtError.code).toBe('VALIDATION_FAILED');
        expect(caughtError.message).toContain('Unsupported spoke chain token (srcChainKey)');
      }
    });

    it('rejects when outputToken is not a valid original asset on dstChain', async () => {
      // First call (srcChain check) passes, second call (dstChain check) fails.
      vi.spyOn(sodax.config, 'isValidOriginalAssetAddress').mockReturnValueOnce(true).mockReturnValueOnce(false);

      const result = await sodax.swaps.createIntent({
        params: intentInput(ChainKeys.BSC_MAINNET),
        raw: false,
        walletProvider: mockEvmProvider,
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        const caughtError = result.error;
        expect(isSodaxError(caughtError)).toBe(true);
        expect(caughtError.code).toBe('VALIDATION_FAILED');
        expect(caughtError.message).toContain('Unsupported spoke chain token (params.dstChain)');
      }
    });

    it('rejects when srcChain is not a valid spoke chain key', async () => {
      vi.spyOn(sodax.config, 'isValidSpokeChainKey').mockReturnValueOnce(false);

      const result = await sodax.swaps.createIntent({
        params: intentInput(ChainKeys.BSC_MAINNET),
        raw: false,
        walletProvider: mockEvmProvider,
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        const caughtError = result.error;
        expect(isSodaxError(caughtError)).toBe(true);
        expect(caughtError.code).toBe('VALIDATION_FAILED');
        expect(caughtError.message).toContain('Invalid spoke chain (srcChainKey)');
      }
    });

    it('rejects when dstChain is not a valid spoke chain key', async () => {
      vi.spyOn(sodax.config, 'isValidSpokeChainKey').mockReturnValueOnce(true).mockReturnValueOnce(false);

      const result = await sodax.swaps.createIntent({
        params: intentInput(ChainKeys.BSC_MAINNET),
        raw: false,
        walletProvider: mockEvmProvider,
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        const caughtError = result.error;
        expect(isSodaxError(caughtError)).toBe(true);
        expect(caughtError.code).toBe('VALIDATION_FAILED');
        expect(caughtError.message).toContain('Invalid spoke chain (params.dstChain)');
      }
    });

    it('rejects when dstChain is Bitcoin + outputToken is native BTC and minOutputAmount is below the 546 sat dust limit', async () => {
      // `outputToken` is an original asset address, not a symbol — native BTC on Bitcoin is '0:0'.
      // The guard must resolve the address to its token descriptor, so the real address has to be used.
      const bitcoinDstParams = {
        ...intentInput(ChainKeys.BSC_MAINNET),
        dstChainKey: ChainKeys.BITCOIN_MAINNET,
        outputToken: spokeChainConfig[ChainKeys.BITCOIN_MAINNET].supportedTokens.BTC.address,
        minOutputAmount: 100n,
      };

      const result = await sodax.swaps.createIntent({
        params: bitcoinDstParams,
        raw: false,
        walletProvider: mockEvmProvider,
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        const caughtError = result.error;
        expect(isSodaxError(caughtError)).toBe(true);
        expect(caughtError.code).toBe('VALIDATION_FAILED');
        expect(caughtError.message).toContain('Invalid minOutputAmount');
        expect(caughtError.message).toContain('dust limit');
      }
    });

    it('rejects when srcChain is Bitcoin + inputToken is native BTC and inputAmount is below the 546 sat dust limit', async () => {
      // The dust rule applies to the BTC deposit on a Bitcoin source too. `inputToken` is the native BTC
      // original asset address ('0:0'); the raw path lets the invariant trip before any wallet step.
      const bitcoinSrcParams = {
        ...intentInput(ChainKeys.BITCOIN_MAINNET),
        inputToken: spokeChainConfig[ChainKeys.BITCOIN_MAINNET].supportedTokens.BTC.address,
        inputAmount: 100n,
      };

      const result = await sodax.swaps.createIntent({ params: bitcoinSrcParams, raw: true });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        const caughtError = result.error;
        expect(isSodaxError(caughtError)).toBe(true);
        expect(caughtError.code).toBe('VALIDATION_FAILED');
        expect(caughtError.message).toContain('Invalid inputAmount');
        expect(caughtError.message).toContain('dust limit');
      }
    });
  });

  // Error propagation — failures from collaborators inside the try/catch must be surfaced
  // as `{ok:false, error}`, not as a thrown rejection. Covers each internal call that can
  // fail: hubProvider.getUserHubWalletAddress, SonicSpokeService, EvmSolverService, and SpokeService.deposit.
  describe('propagates internal errors as Result.error', () => {
    // Each of these tests previously asserted `toEqual({ ok: false, error: <rawError> })` against
    // the old pass-through semantics. After the SodaxError refactor, every caught non-SodaxError
    // is wrapped via `classifyCreateIntentError` into `SodaxError('INTENT_CREATION_FAILED',
    // …, { cause: rawError })`. The old assertions silently kept passing because vitest's
    // `toEqual` treats an Error and a SodaxError as equal when they share `name`+`message`
    // (it ignores the new `code`/`context`/`cause` fields). The assertions now pin the real
    // contract: same SodaxError code, same cause, same phase.

    it('wraps a hubProvider.getUserHubWalletAddress rejection as SWAP_INTENT_CREATION_FAILED', async () => {
      const hubError = new Error('HUB_WALLET_LOOKUP_FAILED');
      mocks.getUserHubWalletAddress.mockRejectedValueOnce(hubError);

      const result = await sodax.swaps.createIntent({
        params: intentInput(ChainKeys.BSC_MAINNET),
        raw: false,
        walletProvider: mockEvmProvider,
      });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(isSodaxError(result.error)).toBe(true);
      expect(result.error.code).toBe('INTENT_CREATION_FAILED');
      expect(result.error.cause).toBe(hubError);
      expect(result.error.context?.phase).toBe('intentCreation');
    });

    it('wraps a SonicSpokeService.createSwapIntent rejection as SWAP_INTENT_CREATION_FAILED (Sonic path)', async () => {
      const sonicError = new Error('SONIC_CREATE_FAILED');
      mocks.getUserHubWalletAddress.mockResolvedValueOnce('0xhubwallet');
      mocks.sonicCreateSwapIntent.mockRejectedValueOnce(sonicError);

      const result = await sodax.swaps.createIntent({
        params: intentInput(ChainKeys.SONIC_MAINNET),
        raw: false,
        walletProvider: mockEvmProvider,
      });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe('INTENT_CREATION_FAILED');
      expect(result.error.cause).toBe(sonicError);
    });

    it('wraps an EvmSolverService.constructCreateIntentData throw as SWAP_INTENT_CREATION_FAILED (EVM spoke path)', async () => {
      const constructError = new Error('CONSTRUCT_INTENT_DATA_FAILED');
      mocks.getUserHubWalletAddress.mockResolvedValueOnce('0xhubwallet');
      mocks.constructCreateIntentData.mockImplementationOnce(() => {
        throw constructError;
      });

      const result = await sodax.swaps.createIntent({
        params: intentInput(ChainKeys.BSC_MAINNET),
        raw: false,
        walletProvider: mockEvmProvider,
      });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe('INTENT_CREATION_FAILED');
      expect(result.error.cause).toBe(constructError);
    });

    it('wraps a SpokeService.deposit returned failure as SWAP_INTENT_CREATION_FAILED (early return, then wrap)', async () => {
      const depositError = new Error('DEPOSIT_REJECTED_BY_RPC');
      mocks.getUserHubWalletAddress.mockResolvedValueOnce('0xhubwallet');
      mocks.constructCreateIntentData.mockReturnValueOnce(['0xintentdata', makeIntent(ChainKeys.BSC_MAINNET), 0n]);
      vi.spyOn(sodax.spoke, 'deposit').mockResolvedValueOnce({ ok: false, error: depositError });

      const result = await sodax.swaps.createIntent({
        params: intentInput(ChainKeys.BSC_MAINNET),
        raw: false,
        walletProvider: mockEvmProvider,
      });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe('INTENT_CREATION_FAILED');
      expect(result.error.cause).toBe(depositError);
      expect(result.error.context?.phase).toBe('intentCreation');
    });

    it('wraps a SpokeService.deposit rejection (thrown) as SWAP_INTENT_CREATION_FAILED', async () => {
      const depositThrown = new Error('DEPOSIT_THROWS');
      mocks.getUserHubWalletAddress.mockResolvedValueOnce('0xhubwallet');
      mocks.constructCreateIntentData.mockReturnValueOnce(['0xintentdata', makeIntent(ChainKeys.BSC_MAINNET), 0n]);
      vi.spyOn(sodax.spoke, 'deposit').mockRejectedValueOnce(depositThrown);

      const result = await sodax.swaps.createIntent({
        params: intentInput(ChainKeys.BSC_MAINNET),
        raw: false,
        walletProvider: mockEvmProvider,
      });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe('INTENT_CREATION_FAILED');
      expect(result.error.cause).toBe(depositThrown);
    });
  });
});

describe('SwapService.createLimitOrder and createLimitOrderIntent', () => {
  it('createLimitOrder forces deadline=0n and routes through swap()', async () => {
    const svc = sodax.swaps;
    const baseInput = intentInput(ChainKeys.BSC_MAINNET);
    const fakeIntent = makeIntent(ChainKeys.BSC_MAINNET);
    const swapSpy = vi.spyOn(svc, 'swap').mockResolvedValueOnce({
      ok: true,
      value: {
        solverExecutionResponse: { answer: 'OK', intent_hash: '0xhash' },
        intent: fakeIntent,
        intentDeliveryInfo: {
          srcChainKey: ChainKeys.BSC_MAINNET,
          srcTxHash: '0xsrc',
          srcAddress: baseInput.srcAddress,
          dstChainKey: ChainKeys.ARBITRUM_MAINNET,
          dstTxHash: '0xdst',
          dstAddress: baseInput.dstAddress,
        },
      },
    });

    // Pass a non-zero deadline — the method must override it to 0n.
    await svc.createLimitOrder({
      params: { ...baseInput, deadline: 42n },
      raw: false,
      walletProvider: mockEvmProvider,
    });

    expect(swapSpy).toHaveBeenCalledTimes(1);
    const forwarded = swapSpy.mock.calls[0]?.[0];
    expect((forwarded?.params as CreateIntentParams).deadline).toBe(0n);
    expect(forwarded?.params.srcChainKey).toBe(ChainKeys.BSC_MAINNET);
    expect(forwarded?.walletProvider).toBe(mockEvmProvider);
  });

  it('createLimitOrderIntent delegates to createIntent with deadline=0n, preserving raw/K', async () => {
    const svc = sodax.swaps;
    const baseInput = intentInput(ChainKeys.BSC_MAINNET);
    const fakeIntent = makeIntent(ChainKeys.BSC_MAINNET);
    const createIntentSpy = vi.spyOn(svc, 'createIntent').mockResolvedValueOnce({
      ok: true,
      value: {
        tx: '0xtx' as never,
        intent: { ...fakeIntent, feeAmount: 0n },
        relayData: '0x' as never,
      },
    });

    await svc.createLimitOrderIntent({
      params: { ...baseInput, deadline: 9999n },
      raw: true,
    });

    expect(createIntentSpy).toHaveBeenCalledTimes(1);
    const forwarded = createIntentSpy.mock.calls[0]?.[0];
    expect((forwarded?.params as CreateIntentParams).deadline).toBe(0n);
    expect(forwarded?.params.srcChainKey).toBe(ChainKeys.BSC_MAINNET);
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

describe('SwapService.partnerFee', () => {
  // Read live off ConfigService, not snapshotted in the constructor: a snapshot could diverge from
  // `config.swapPartnerFee` if the config object is ever replaced. Mutating the config here is the
  // only way to distinguish the two — a fresh instance would pass either way.
  it('reflects a config change rather than a constructor snapshot', () => {
    const s = new Sodax();
    expect(s.swaps.partnerFee).toBeUndefined();

    const fee = { address: '0x3333333333333333333333333333333333333333', percentage: 100 } as const;
    vi.spyOn(s.config, 'swapPartnerFee', 'get').mockReturnValue(fee);

    expect(s.swaps.partnerFee).toEqual(fee);
  });

  it('resolves the effective fee, so the global `fee` applies when `swaps.partnerFee` is unset', () => {
    const globalFee = { address: '0x5555555555555555555555555555555555555555', percentage: 25 } as const;
    const s = new Sodax({ fee: globalFee });

    expect(s.swaps.partnerFee).toEqual(globalFee);
  });
});

describe('SwapService.getPartnerFee', () => {
  it('returns 0n when no partnerFee is configured', () => {
    // Default `new Sodax()` has no partnerFee in config, so the early-return branch fires.
    expect(sodax.swaps.getPartnerFee(1_000_000n)).toBe(0n);
  });

  it('returns 0n regardless of the input amount when no partnerFee is set', () => {
    expect(sodax.swaps.getPartnerFee(0n)).toBe(0n);
    expect(sodax.swaps.getPartnerFee(10n ** 30n)).toBe(0n);
  });

  it('routes through calculateFeeAmount when partnerFee is configured', () => {
    // Spin up a separate Sodax instance with a configured partnerFee so we can exercise the
    // branch beyond the early-return. The readonly `partnerFee` field is set in the SwapService
    // constructor, so stubbing it on the shared instance would be hacky — a fresh instance is
    // the cleaner way to test config-dependent behavior. The cast is needed because
    // `SodaxConfig.swaps` intersects with the default `{ partnerFee: undefined }` literal,
    // which narrows the slot away from `PartnerFee` at the type level.
    const sodaxWithFee = new Sodax({
      swaps: { partnerFee: { address: '0x3333333333333333333333333333333333333333', percentage: 100 } },
    });

    const fee = sodaxWithFee.swaps.getPartnerFee(1_000_000n);

    // 100 basis points = 1% → non-zero fee on a non-zero input. Asserting > 0 rather than a
    // specific value because calculateFeeAmount's rounding isn't what this test is about —
    // we're proving the method *routed into* the helper, not replicating the helper's math.
    expect(fee).toBeGreaterThan(0n);
  });

  it('falls back to the global fee when no swap-specific partnerFee is set', () => {
    // Regression: a global `fee` with no per-feature `swaps.partnerFee` must still be charged.
    // The effective swap fee is `swaps.partnerFee ?? fee` (resolved by config.swapPartnerFee), so a
    // global-only fee is no longer silently dropped. `fee` is a typed SodaxOptions slot — no cast needed.
    const sodaxWithGlobalFee = new Sodax({
      fee: { address: '0x3333333333333333333333333333333333333333', percentage: 100 },
    });

    expect(sodaxWithGlobalFee.swaps.getPartnerFee(1_000_000n)).toBeGreaterThan(0n);
  });
});

describe('SwapService.getSolverFee', () => {
  it('returns 0n for 0 input', () => {
    expect(sodax.swaps.getSolverFee(0n)).toBe(0n);
  });

  it('scales proportionally with input amount', () => {
    // calculatePercentageFeeAmount is called with fee=10 basis points (0.1%). We don't want
    // the test to duplicate the helper's math — instead we assert the shape: the result for
    // 2x input is 2x the result for x input.
    const small = sodax.swaps.getSolverFee(1_000_000n);
    const double = sodax.swaps.getSolverFee(2_000_000n);
    expect(double).toBe(small * 2n);
    expect(small).toBeGreaterThan(0n);
  });
});

describe('SwapService.getIntentHash', () => {
  it('delegates to EvmSolverService.getIntentHash and returns its value', () => {
    const fakeHash = '0xdeadbeef' as const;
    mocks.getIntentHash.mockReturnValueOnce(fakeHash);
    const intent = makeIntent(ChainKeys.BSC_MAINNET);

    const hash = sodax.swaps.getIntentHash(intent);

    expect(hash).toBe(fakeHash);
    expect(mocks.getIntentHash).toHaveBeenCalledWith(intent);
  });
});

describe('SwapService.getSupportedSwapTokensByChainId', () => {
  it('forwards the chainId to the ConfigService and returns its result', () => {
    const fakeTokens = [{ symbol: 'BNB' }] as never;
    const spy = vi.spyOn(sodax.config, 'getSupportedSwapTokensByChainId').mockReturnValueOnce(fakeTokens);

    const result = sodax.swaps.getSupportedSwapTokensByChainId(ChainKeys.BSC_MAINNET);

    expect(result).toBe(fakeTokens);
    expect(spy).toHaveBeenCalledWith(ChainKeys.BSC_MAINNET);
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

  it('reports fast for a real user-facing pair whose hubAsset differs from its vault', () => {
    // Regression test for the estimator reading `hubAsset` instead of `vault`: the reserve set is
    // built from vault addresses, so reading hubAsset made 'fast' unreachable for every real pair.
    const srcToken = spokeChainConfig[ChainKeys.SONIC_MAINNET].supportedTokens.SODA;
    const dstToken = spokeChainConfig[ChainKeys.SOLANA_MAINNET].supportedTokens.SOL;
    expect(srcToken.hubAsset.toLowerCase()).not.toBe(srcToken.vault.toLowerCase());
    expect(sodax.config.isMoneyMarketReserveAsset(srcToken.hubAsset)).toBe(false);

    expect(sodax.swaps.getSwapSpeedTier({ srcToken, dstToken })).toEqual({
      tier: 'fast',
      estimatedSeconds: SPEED_TIER_SECONDS.sodaAsset,
    });
  });
});

describe('SwapService.getSupportedSwapTokens', () => {
  it('returns whatever ConfigService.getSupportedSwapTokens returns', () => {
    const fakeAllTokens = { [ChainKeys.BSC_MAINNET]: [] } as never;
    const spy = vi.spyOn(sodax.config, 'getSupportedSwapTokens').mockReturnValueOnce(fakeAllTokens);

    const result = sodax.swaps.getSupportedSwapTokens();

    expect(result).toBe(fakeAllTokens);
    expect(spy).toHaveBeenCalled();
  });
});

describe('SwapService.getSwapDeadline', () => {
  it('returns the hub block timestamp plus the supplied deadline offset', async () => {
    const blockTimestamp = 1_700_000_000n;
    const offset = 300n;
    const getBlockSpy = vi
      .spyOn(sodax.hubProvider.publicClient, 'getBlock')
      .mockResolvedValueOnce({ timestamp: blockTimestamp } as never);

    const result = await sodax.swaps.getSwapDeadline(offset);

    expect(result).toEqual({ ok: true, value: blockTimestamp + offset });
    expect(getBlockSpy).toHaveBeenCalledWith({ includeTransactions: false, blockTag: 'latest' });
  });

  it('returns ok:false when deadline is 0n (invariant fails)', async () => {
    const result = await sodax.swaps.getSwapDeadline(0n);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(String(result.error)).toMatch(/Deadline must be greater than 0/);
    }
  });

  it('returns ok:false when hubProvider.publicClient.getBlock rejects', async () => {
    const rpcError = new Error('RPC_DOWN');
    vi.spyOn(sodax.hubProvider.publicClient, 'getBlock').mockRejectedValueOnce(rpcError);

    const result = await sodax.swaps.getSwapDeadline(60n);

    expect(result).toEqual({ ok: false, error: rpcError });
  });
});

// =========================================================================
// Batch 2: thin wrappers around static helpers / spoke methods.
// =========================================================================

describe('SwapService.estimateGas', () => {
  it('delegates to spoke.estimateGas with the given params and returns its Result', async () => {
    const estimateResult = { ok: true as const, value: { gas: 21_000n } as never };
    const spy = vi.spyOn(sodax.spoke, 'estimateGas').mockResolvedValueOnce(estimateResult);
    const params = { chainKey: ChainKeys.BSC_MAINNET } as never;

    const result = await sodax.swaps.estimateGas(params);

    expect(result).toBe(estimateResult);
    expect(spy).toHaveBeenCalledWith(params);
  });

  it('forwards a failure Result from spoke.estimateGas unchanged', async () => {
    const gasError = new Error('GAS_ESTIMATION_FAILED');
    vi.spyOn(sodax.spoke, 'estimateGas').mockResolvedValueOnce({ ok: false, error: gasError });

    const result = await sodax.swaps.estimateGas({ chainKey: ChainKeys.BSC_MAINNET } as never);

    expect(result).toEqual({ ok: false, error: gasError });
  });
});

describe('SwapService.getIntent', () => {
  it('returns ok:true wrapping the intent EvmSolverService.getIntent resolved with', async () => {
    const fakeIntent = makeIntent(ChainKeys.BSC_MAINNET);
    mocks.getIntent.mockResolvedValueOnce(fakeIntent);

    const result = await sodax.swaps.getIntent('0xtxhash');

    expect(result).toEqual({ ok: true, value: fakeIntent });
    expect(mocks.getIntent).toHaveBeenCalledWith('0xtxhash', sodax.config, sodax.hubProvider.publicClient);
  });

  it('returns ok:false when EvmSolverService.getIntent rejects', async () => {
    const lookupError = new Error('LOOKUP_FAILED');
    mocks.getIntent.mockRejectedValueOnce(lookupError);

    const result = await sodax.swaps.getIntent('0xtxhash');

    expect(result).toEqual({ ok: false, error: lookupError });
  });
});

describe('SwapService.getFilledIntent', () => {
  it('returns ok:true with the IntentState EvmSolverService.getFilledIntent resolved with', async () => {
    const fakeState = { filled: true };
    mocks.getFilledIntent.mockResolvedValueOnce(fakeState);

    const result = await sodax.swaps.getFilledIntent('0xtxhash');

    expect(result).toEqual({ ok: true, value: fakeState });
    expect(mocks.getFilledIntent).toHaveBeenCalledWith('0xtxhash', sodax.swaps.solver, sodax.hubProvider.publicClient);
  });

  it('returns ok:false when EvmSolverService.getFilledIntent rejects', async () => {
    const lookupError = new Error('FILLED_LOOKUP_FAILED');
    mocks.getFilledIntent.mockRejectedValueOnce(lookupError);

    const result = await sodax.swaps.getFilledIntent('0xtxhash');

    expect(result).toEqual({ ok: false, error: lookupError });
  });
});

describe('SwapService.getIntentSubmitTxExtraData', () => {
  it('when given a spoke-source intent directly, reconstructs the relayed multicall payload (isHubSource = false)', async () => {
    const intent = makeIntent(ChainKeys.BSC_MAINNET);
    mocks.reconstructCreateIntentData.mockReturnValueOnce('0xspokepayload');

    const result = await sodax.swaps.getIntentSubmitTxExtraData({ intent });

    expect(result).toEqual({ ok: true, value: { address: intent.creator, payload: '0xspokepayload' } });
    expect(mocks.reconstructCreateIntentData).toHaveBeenCalledWith(intent, intentsContract, false);
    expect(mocks.encodeCreateIntent).not.toHaveBeenCalled();
  });

  it('when given a txHash, fetches the intent first then reconstructs from it', async () => {
    const intent = makeIntent(ChainKeys.BSC_MAINNET);
    mocks.getIntent.mockResolvedValueOnce(intent);
    mocks.reconstructCreateIntentData.mockReturnValueOnce('0xspokepayload2');

    const result = await sodax.swaps.getIntentSubmitTxExtraData({ txHash: '0xtxhash' });

    expect(result).toEqual({ ok: true, value: { address: intent.creator, payload: '0xspokepayload2' } });
    expect(mocks.reconstructCreateIntentData).toHaveBeenCalledWith(intent, intentsContract, false);
  });

  it('when the txHash lookup fails, returns the failure as-is and does NOT reconstruct', async () => {
    const lookupError = new Error('INTENT_NOT_FOUND');
    mocks.getIntent.mockRejectedValueOnce(lookupError);

    const result = await sodax.swaps.getIntentSubmitTxExtraData({ txHash: '0xmissing' });

    expect(result).toEqual({ ok: false, error: lookupError });
    expect(mocks.reconstructCreateIntentData).not.toHaveBeenCalled();
  });

  it('propagates the ok:false Result that reconstructRelayData produces when encoding throws', async () => {
    const encodeError = new Error('ENCODE_FAILED');
    mocks.reconstructCreateIntentData.mockImplementationOnce(() => {
      throw encodeError;
    });

    const result = await sodax.swaps.getIntentSubmitTxExtraData({ intent: makeIntent(ChainKeys.BSC_MAINNET) });

    expect(result).toEqual({ ok: false, error: encodeError });
  });
});

describe('SwapService.reconstructRelayData', () => {
  it('reconstructs relay data for a spoke source (isHubSource = false)', () => {
    const intent = makeIntent(ChainKeys.BSC_MAINNET);
    mocks.reconstructCreateIntentData.mockReturnValueOnce('0xspokepayload');

    const result = sodax.swaps.reconstructRelayData(intent);

    expect(result).toEqual({ ok: true, value: { address: intent.creator, payload: '0xspokepayload' } });
    expect(mocks.reconstructCreateIntentData).toHaveBeenCalledWith(intent, intentsContract, false);
  });

  it('reconstructs relay data for a Sonic-hub source (isHubSource = true)', () => {
    const intent = makeIntent(ChainKeys.SONIC_MAINNET);
    mocks.reconstructCreateIntentData.mockReturnValueOnce('0xhubpayload');

    const result = sodax.swaps.reconstructRelayData(intent);

    expect(result).toEqual({ ok: true, value: { address: intent.creator, payload: '0xhubpayload' } });
    expect(mocks.reconstructCreateIntentData).toHaveBeenCalledWith(intent, intentsContract, true);
  });

  it('returns ok:false when intent.srcChain is not a valid relay chain id', () => {
    vi.spyOn(sodax.config, 'isValidIntentRelayChainId').mockReturnValue(false);

    const result = sodax.swaps.reconstructRelayData(makeIntent(ChainKeys.BSC_MAINNET));

    expect(result.ok).toBe(false);
    expect(mocks.reconstructCreateIntentData).not.toHaveBeenCalled();
  });

  it('returns ok:false when intent.dstChain is not a valid relay chain id', () => {
    // srcChain passes, dstChain fails
    vi.spyOn(sodax.config, 'isValidIntentRelayChainId').mockReturnValueOnce(true).mockReturnValueOnce(false);

    const result = sodax.swaps.reconstructRelayData(makeIntent(ChainKeys.BSC_MAINNET));

    expect(result.ok).toBe(false);
    expect(mocks.reconstructCreateIntentData).not.toHaveBeenCalled();
  });
});

describe('SwapService.getSolvedIntentPacket', () => {
  it('forwards params to waitUntilIntentExecuted and returns its Result on success', async () => {
    const packet = { dst_tx_hash: '0xdstTxHash' };
    mocks.waitUntilIntentExecuted.mockResolvedValueOnce({ ok: true, value: packet });

    const result = await sodax.swaps.getSolvedIntentPacket({
      chainId: ChainKeys.BSC_MAINNET,
      fillTxHash: '0xfillTxHash',
    });

    expect(result).toEqual({ ok: true, value: packet });
    const callArgs = mocks.waitUntilIntentExecuted.mock.calls[0]?.[0];
    expect(callArgs.srcTxHash).toBe('0xfillTxHash');
    expect(callArgs.apiUrl).toBe(sodax.swaps.relayerApiEndpoint);
  });

  it('propagates a failure Result (e.g. RELAY_TIMEOUT) from waitUntilIntentExecuted', async () => {
    const timeoutError = new Error('RELAY_TIMEOUT');
    mocks.waitUntilIntentExecuted.mockResolvedValueOnce({ ok: false, error: timeoutError });

    const result = await sodax.swaps.getSolvedIntentPacket({
      chainId: ChainKeys.BSC_MAINNET,
      fillTxHash: '0xfillTxHash',
    });

    expect(result).toEqual({ ok: false, error: timeoutError });
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

  it('returns a usable solver answer without querying the backend', async () => {
    const statusResult = { ok: true as const, value: { status: 3, intent_hash: '0xhash' } };
    mocks.solverGetStatus.mockResolvedValueOnce(statusResult);
    const backendSpy = vi.spyOn(sodax.swaps.backendApi, 'getIntentByTxHash');

    const result = await sodax.swaps.getStatus(request);

    expect(result).toBe(statusResult);
    // Trailing `undefined` is the point: public `getStatus` is a one-shot read the caller bounds
    // however it likes, so it forwards no budget. Only `getDetailedStatus`, which is polled, does.
    expect(mocks.solverGetStatus).toHaveBeenCalledWith(
      request,
      sodax.swaps.solver,
      sodax.swaps.config.logger,
      undefined,
      sodax.swaps.config.apiKey,
    );
    expect(backendSpy).not.toHaveBeenCalled();
  });

  it('reconciles NOT_FOUND to SOLVED when the backend proves the fill', async () => {
    mocks.solverGetStatus.mockResolvedValueOnce({ ok: true, value: { status: SolverIntentStatusCode.NOT_FOUND } });
    backendReturns([fillEvent]);

    const result = await sodax.swaps.getStatus(request);

    expect(result).toEqual({ ok: true, value: { status: SolverIntentStatusCode.SOLVED, fill_tx_hash: FILL_HASH } });
  });

  it('recovers a solver failure when the backend proves the fill', async () => {
    mocks.solverGetStatus.mockResolvedValueOnce({ ok: false, error: { code: 'BOOM' } });
    backendReturns([fillEvent]);

    const result = await sodax.swaps.getStatus(request);

    expect(result).toEqual({ ok: true, value: { status: SolverIntentStatusCode.SOLVED, fill_tx_hash: FILL_HASH } });
  });

  it('preserves the solver result when the backend has no fill evidence', async () => {
    const notFound = { ok: true as const, value: { status: SolverIntentStatusCode.NOT_FOUND } };
    mocks.solverGetStatus.mockResolvedValueOnce(notFound);
    backendReturns([{ eventType: 'intent-created' }]);

    expect(await sodax.swaps.getStatus(request)).toBe(notFound);
  });

  // allowPartialFill is caller-supplied on CreateIntentParams and passed straight through to the
  // on-chain intent, so a fill event can legitimately leave input unfilled. Claiming SOLVED there
  // would report an unfinished swap as complete and stop useStatus polling for good.
  it('does not claim SOLVED from a partial fill that left input remaining', async () => {
    const notFound = { ok: true as const, value: { status: SolverIntentStatusCode.NOT_FOUND } };
    mocks.solverGetStatus.mockResolvedValueOnce(notFound);
    backendReturns([partialFill('0xpartial', '1000000000000000000')], true);

    expect(await sodax.swaps.getStatus(request)).toBe(notFound);
  });

  it('claims SOLVED from the fill that consumed the remainder, past earlier partial fills', async () => {
    mocks.solverGetStatus.mockResolvedValueOnce({ ok: true, value: { status: SolverIntentStatusCode.NOT_FOUND } });
    backendReturns([partialFill('0xpartial1', '2000'), partialFill('0xpartial2', '1000'), fillEvent], true);

    const result = await sodax.swaps.getStatus(request);

    expect(result).toEqual({ ok: true, value: { status: SolverIntentStatusCode.SOLVED, fill_tx_hash: FILL_HASH } });
  });

  // No `intentState` means no proof of completion — stay with the solver rather than guess.
  it('preserves the solver result when a fill event carries no terminality evidence', async () => {
    const notFound = { ok: true as const, value: { status: SolverIntentStatusCode.NOT_FOUND } };
    mocks.solverGetStatus.mockResolvedValueOnce(notFound);
    backendReturns([{ eventType: 'intent-filled', txHash: '0xfill' }]);

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

  // The solver already failed, so its own error is the better diagnostic — and a failed Result
  // already resets the caller's NOT_FOUND budget, so nothing is gained by substituting ours.
  it('preserves the solver result when the backend lookup fails', async () => {
    const solverError = { ok: false, error: { code: 'INTENT_NOT_FOUND' } };
    mocks.solverGetStatus.mockResolvedValueOnce(solverError);
    vi.spyOn(sodax.swaps.backendApi, 'getIntentByTxHash').mockResolvedValueOnce({
      ok: false,
      error: new Error('down'),
    });

    expect(await sodax.swaps.getStatus(request)).toBe(solverError);
  });

  // A NOT_FOUND the durable record could not confirm is not a definitive miss. Reporting it as one
  // lets a poller spend a budgeted read it never verified; failing instead keeps the read retryable.
  it('fails rather than reporting an unverified NOT_FOUND when the backend is unreachable', async () => {
    mocks.solverGetStatus.mockResolvedValueOnce({ ok: true, value: { status: SolverIntentStatusCode.NOT_FOUND } });
    vi.spyOn(sodax.swaps.backendApi, 'getIntentByTxHash').mockResolvedValueOnce({
      ok: false,
      error: new Error('down'),
    });

    const result = await sodax.swaps.getStatus(request);

    expect(result.ok).toBe(false);
    expect(!result.ok && result.error.detail.code).toBe(SolverIntentErrorCode.UNKNOWN);
    expect(!result.ok && result.error.detail.message).toBe(
      'solver reported NOT_FOUND and the durable intent record could not be read to verify it',
    );
  });

  // A 404 is the backend answering — it has no record, so there is no fill to find. That is as
  // definitive as a 200 with no terminal fill, and must stay budgetable or nothing ever stops.
  it('keeps the solver NOT_FOUND when the backend answers 404', async () => {
    const notFound = { ok: true as const, value: { status: SolverIntentStatusCode.NOT_FOUND } };
    mocks.solverGetStatus.mockResolvedValueOnce(notFound);
    vi.spyOn(sodax.swaps.backendApi, 'getIntentByTxHash').mockResolvedValueOnce({
      ok: false,
      error: new SodaxError('EXTERNAL_API_ERROR', 'not found', {
        feature: 'backend',
        context: { api: 'backend', status: 404 },
      }),
    });

    expect(await sodax.swaps.getStatus(request)).toBe(notFound);
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

  // ── bounding the dependency reads ────────────────────────────────────────

  // This read is polled on a short interval, so neither dependency may hold it open. Without a
  // budget a hung relay or solver leaves the query pending forever, and the outage-recovery polling
  // in `useDetailedStatus` never gets another result to act on. The budget's *effect* is covered in
  // the two client test suites; what matters here is that it is passed at all.
  it('bounds both the relay and the solver read', async () => {
    noRecord();
    packets(delivered);
    solverSays(SolverIntentStatusCode.SOLVED, '0xfill');

    await sodax.swaps.getDetailedStatus(key);

    // The relay takes its own module's per-request budget rather than a tighter one invented here:
    // a budget below what the relay path already tolerates would abort reads that succeed today,
    // and an expired read is untagged, so the caller would poll forever instead of resolving.
    expect(mocks.getTransactionPackets).toHaveBeenCalledWith(expect.anything(), expect.anything(), 15_000);
    expect(mocks.solverGetStatus).toHaveBeenCalledWith(
      { intent_tx_hash: HUB_TX },
      sodax.swaps.solver,
      sodax.swaps.config.logger,
      5_000,
      sodax.swaps.config.apiKey,
    );
  });

  // ── routing to the solver ────────────────────────────────────────────────

  it('routes to the solver when the backend has no record', async () => {
    noRecord();
    packets(delivered);
    solverSays(SolverIntentStatusCode.SOLVED, '0xfill');

    expect(await sodax.swaps.getDetailedStatus(key)).toEqual({
      ok: true,
      value: {
        source: 'solver',
        dstTxHash: HUB_TX,
        data: { status: SolverIntentStatusCode.SOLVED, fill_tx_hash: '0xfill' },
      },
    });
  });

  it('routes to the solver on a success:false envelope instead of trusting its data', async () => {
    recordNotFound({ status: 'posting_execution' });
    packets(delivered);
    solverSays(SolverIntentStatusCode.SOLVED, '0xfill');

    const result = await sodax.swaps.getDetailedStatus(key);

    expect(result.ok && result.value.source).toBe('solver');
  });

  it.each([500, 503])('routes to the solver when the backend fails with %s rather than 404', async status => {
    backendErrors(status);
    packets(delivered);
    solverSays(SolverIntentStatusCode.SOLVED, '0xfill');

    const result = await sodax.swaps.getDetailedStatus(key);

    expect(result.ok && result.value.source).toBe('solver');
    expect(result.ok && result.value.source === 'solver' && result.value.data.status).toBe(
      SolverIntentStatusCode.SOLVED,
    );
  });

  // An abandoned record never self-heals, and the fallback runs exactly when the backend quits —
  // so it has to route like a 404, or a fallback-completed swap reads `failed` forever.
  it.each<[string, Partial<SubmitTxStatusDataV2>]>([
    ['a terminally failed record', { status: 'failed', failureReason: 'relay timed out' }],
    ['a record abandoned mid-flight', { status: 'relaying', abandonedAt: '2026-08-14T00:00:00.000Z' }],
  ])('routes to the solver past %s', async (_label, data) => {
    record(data);
    packets(delivered);
    solverSays(SolverIntentStatusCode.SOLVED, '0xfill');

    const result = await sodax.swaps.getDetailedStatus(key);

    expect(result.ok && result.value.source).toBe('solver');
    expect(result.ok && result.value.source === 'solver' && result.value.data.status).toBe(
      SolverIntentStatusCode.SOLVED,
    );
  });

  it('returns a solver NOT_FOUND verbatim rather than reinterpreting it', async () => {
    noRecord();
    packets(delivered);
    solverSays(SolverIntentStatusCode.NOT_FOUND);
    // The durable record answered and showed no terminal fill, so the solver's NOT_FOUND is verified
    // and passes through — this is the miss a caller is meant to budget.
    vi.spyOn(sodax.swaps.backendApi, 'getIntentByTxHash').mockResolvedValueOnce({
      ok: true,
      value: intentResponse([]),
    });

    const result = await sodax.swaps.getDetailedStatus(key);

    expect(result.ok && result.value.source === 'solver' && result.value.data.status).toBe(
      SolverIntentStatusCode.NOT_FOUND,
    );
  });

  // The counterpart: an unverifiable NOT_FOUND must NOT read as a definitive miss. It surfaces
  // untagged, which is what makes `useDetailedStatus` reset its budget and keep polling — otherwise a
  // backend outage spends all 40 reads on a swap that may well have filled.
  it('does not report NOT_FOUND when the durable record could not be read to verify it', async () => {
    noRecord();
    packets(delivered);
    solverSays(SolverIntentStatusCode.NOT_FOUND);
    vi.spyOn(sodax.swaps.backendApi, 'getIntentByTxHash').mockResolvedValueOnce({ ok: false, error: new Error('x') });

    const result = await sodax.swaps.getDetailedStatus(key);

    expect(!result.ok && isSodaxError(result.error) && result.error.code).toBe('LOOKUP_FAILED');
    expect(!result.ok && isSodaxError(result.error) && result.error.context?.reason).toBeUndefined();
  });

  it('uses the source tx as the hub tx for a hub-source swap', async () => {
    noRecord();
    solverSays(SolverIntentStatusCode.SOLVED, '0xfill');

    const result = await sodax.swaps.getDetailedStatus({ srcChainKey: ChainKeys.SONIC_MAINNET, srcTxHash: SRC_TX });

    expect(mocks.getTransactionPackets).not.toHaveBeenCalled();
    expect(result.ok && result.value.source === 'solver' && result.value.dstTxHash).toBe(SRC_TX);
  });

  // ── no hub tx hash yet is a miss, not a lifecycle step ───────────────────

  it.each([
    ['the relay has not delivered the packet', [{ status: 'validating', dst_tx_hash: '' }]],
    ['the relay knows nothing about the tx', []],
  ])('fails with LOOKUP_FAILED when %s', async (_label, data) => {
    noRecord();
    packets(data);

    const result = await sodax.swaps.getDetailedStatus(key);

    expect(!result.ok && isSodaxError(result.error) && result.error.code).toBe('LOOKUP_FAILED');
    expect(mocks.solverGetStatus).not.toHaveBeenCalled();
  });

  // The relay response is untrusted input. A packet for another transaction, another source chain,
  // or with a malformed hash must never supply the hash the solver is then queried with.
  it.each([
    ['a packet for a different source tx', [{ ...delivered[0], src_tx_hash: '0xother' }]],
    ['a packet from a different source chain', [{ ...delivered[0], src_chain_id: 999 }]],
    ['a non-string src_tx_hash', [{ ...delivered[0], src_tx_hash: 42 }]],
    ['a non-string dst_tx_hash', [{ ...delivered[0], dst_tx_hash: 42 }]],
  ])('ignores %s', async (_label, data) => {
    noRecord();
    packets(data);

    const result = await sodax.swaps.getDetailedStatus(key);

    expect(!result.ok && isSodaxError(result.error) && result.error.code).toBe('LOOKUP_FAILED');
    expect(mocks.solverGetStatus).not.toHaveBeenCalled();
  });

  it('fails with LOOKUP_FAILED when the delivered hash is not hex', async () => {
    noRecord();
    packets([{ ...delivered[0], dst_tx_hash: 'not-hex' }]);

    const result = await sodax.swaps.getDetailedStatus(key);

    expect(!result.ok && isSodaxError(result.error) && result.error.code).toBe('LOOKUP_FAILED');
    expect(mocks.solverGetStatus).not.toHaveBeenCalled();
  });

  // Relay responses are not schema-validated, so a 200 whose body lacks a usable packet list must
  // be rejected rather than dereferenced — `.find` on undefined would throw inside the try/catch and
  // be misreported as ordinary in-flight latency.
  it.each([
    ['success is false', { success: false, data: [] }],
    ['data is missing', { success: true }],
    ['data is not an array', { success: true, data: { packets: [] } }],
  ])('fails with LOOKUP_FAILED when the relay envelope is unusable: %s', async (_label, value) => {
    noRecord();
    mocks.getTransactionPackets.mockResolvedValueOnce({ ok: true, value });

    const result = await sodax.swaps.getDetailedStatus(key);

    expect(!result.ok && isSodaxError(result.error) && result.error.code).toBe('LOOKUP_FAILED');
    expect(mocks.solverGetStatus).not.toHaveBeenCalled();
  });

  // A rejected key is a configuration problem, not a source with nothing to say. Degrading to the
  // relay would bury it behind a relay error and leave `useDetailedStatus` polling a request only a
  // corrected key can satisfy — the miss behind an unanswered backend is never budgetable, so no
  // budget would ever stop it. The bridge sibling applies the same rule.
  it.each([401, 403])('treats a rejected API key as terminal instead of degrading (%i)', async status => {
    backendFails('rejected', status);

    const result = await sodax.swaps.getDetailedStatus(key);

    expect(result.ok).toBe(false);
    invariant(!result.ok, 'expected LOOKUP_FAILED');
    expect(result.error.code).toBe('LOOKUP_FAILED');
    // Lifted so `isAuthFailure` recognises the wrapped error — it reads `context.status` only.
    expect(result.error.context?.status).toBe(status);
    expect(isAuthFailure(result.error)).toBe(true);
    expect(result.error.context?.reason).toBeUndefined();
    expect(mocks.getTransactionPackets).not.toHaveBeenCalled();
    expect(mocks.solverGetStatus).not.toHaveBeenCalled();
  });

  // 503 is the transient key-verification failure, which must keep routing on rather than surfacing.
  it('routes a 503 on to the solver rather than treating it as a rejected key', async () => {
    backendErrors(503);
    packets(delivered);
    solverSays(SolverIntentStatusCode.SOLVED, '0xfill');

    const result = await sodax.swaps.getDetailedStatus(key);

    invariant(result.ok, 'expected the solver to answer');
    expect(result.value.source).toBe('solver');
  });

  // dapp-kit reads this tag across the package boundary to tell an ambiguous miss (budget it) from a
  // dependency outage (keep retrying), so which failures carry it is contract, not detail.
  it('tags only the undelivered-packet miss as budgetable, not outages', async () => {
    noRecord();
    packets([]);
    const miss = await sodax.swaps.getDetailedStatus(key);
    expect(!miss.ok && isSodaxError(miss.error) && miss.error.context?.reason).toBe(DETAILED_STATUS_NOT_DELIVERED);

    // The relayer's 404 for an un-indexed tx is the same "no packet for this tx" state as an empty
    // list — live-verified — so it must be budgetable too, or an unrelayable swap polls forever.
    noRecord();
    mocks.getTransactionPackets.mockResolvedValueOnce({
      ok: false,
      error: new HttpRelayError(404, 'Not Found', '{"success": false, "message": "requested packet not found"}'),
    });
    const notIndexed = await sodax.swaps.getDetailedStatus(key);
    expect(!notIndexed.ok && isSodaxError(notIndexed.error) && notIndexed.error.context?.reason).toBe(
      DETAILED_STATUS_NOT_DELIVERED,
    );

    noRecord();
    mocks.getTransactionPackets.mockResolvedValueOnce({
      ok: false,
      error: new HttpRelayError(503, 'Service Unavailable', ''),
    });
    const relayDown = await sodax.swaps.getDetailedStatus(key);
    expect(!relayDown.ok && isSodaxError(relayDown.error) && relayDown.error.context?.reason).toBeUndefined();

    noRecord();
    mocks.getTransactionPackets.mockResolvedValueOnce({ ok: false, error: new Error('socket hang up') });
    const transport = await sodax.swaps.getDetailedStatus(key);
    expect(!transport.ok && isSodaxError(transport.error) && transport.error.context?.reason).toBeUndefined();
  });

  // A relay miss only proves the swap is unresolvable if the backend also had nothing to say. Behind
  // a backend outage the record may be progressing unseen, so budgeting the miss would stop the
  // caller polling a live swap. Both relay miss shapes must stay untagged here.
  it.each([
    [
      'the relay 404s',
      () =>
        mocks.getTransactionPackets.mockResolvedValueOnce({
          ok: false,
          error: new HttpRelayError(404, 'Not Found', ''),
        }),
    ],
    ['the relay has no packet', () => packets([])],
  ])('leaves a relay miss unbudgeted when the backend never answered and %s', async (_label, relay) => {
    backendErrors(503);
    relay();

    const result = await sodax.swaps.getDetailedStatus(key);

    expect(!result.ok && isSodaxError(result.error) && result.error.code).toBe('LOOKUP_FAILED');
    expect(!result.ok && isSodaxError(result.error) && result.error.context?.reason).toBeUndefined();
  });

  it('still budgets a relay miss when the backend definitively had no record', async () => {
    noRecord();
    packets([]);

    const result = await sodax.swaps.getDetailedStatus(key);

    expect(!result.ok && isSodaxError(result.error) && result.error.context?.reason).toBe(
      DETAILED_STATUS_NOT_DELIVERED,
    );

    noRecord();
    packets(delivered);
    mocks.solverGetStatus.mockResolvedValueOnce({ ok: false, error: { detail: { code: -999, message: 'down' } } });
    vi.spyOn(sodax.swaps.backendApi, 'getIntentByTxHash').mockResolvedValueOnce({ ok: false, error: new Error('x') });
    const solverDown = await sodax.swaps.getDetailedStatus(key);
    expect(!solverDown.ok && isSodaxError(solverDown.error) && solverDown.error.context?.reason).toBeUndefined();
  });

  it('fails with LOOKUP_FAILED when the relay read itself fails', async () => {
    noRecord();
    mocks.getTransactionPackets.mockResolvedValueOnce({ ok: false, error: new Error('relay down') });

    const result = await sodax.swaps.getDetailedStatus(key);

    expect(!result.ok && isSodaxError(result.error) && result.error.code).toBe('LOOKUP_FAILED');
  });

  // No falling back to a stale abandoned record — the caller asked for a status, not a guess.
  it('fails with LOOKUP_FAILED when the solver cannot be reached, even if a record exists', async () => {
    record({ status: 'failed', failureReason: 'relay timed out' });
    packets(delivered);
    mocks.solverGetStatus.mockResolvedValueOnce({ ok: false, error: { detail: { code: -999, message: 'down' } } });
    vi.spyOn(sodax.swaps.backendApi, 'getIntentByTxHash').mockResolvedValueOnce({ ok: false, error: new Error('x') });

    const result = await sodax.swaps.getDetailedStatus(key);

    expect(!result.ok && isSodaxError(result.error) && result.error.code).toBe('LOOKUP_FAILED');
  });

  it('returns a Result rather than rejecting when a dependency throws', async () => {
    noRecord();
    mocks.getTransactionPackets.mockRejectedValueOnce(new Error('Invalid input parameters. tx_hash empty'));

    const result = await sodax.swaps.getDetailedStatus({ ...key, srcTxHash: '' });

    expect(!result.ok && isSodaxError(result.error) && result.error.code).toBe('LOOKUP_FAILED');
  });
});

describe('SwapService.postExecution', () => {
  it('delegates to SolverApiService.postExecution and returns the Result on success', async () => {
    const execResult = { ok: true as const, value: { answer: 'OK', intent_hash: '0xhash' } as never };
    mocks.solverPostExecution.mockResolvedValueOnce(execResult);
    const request = { intent_tx_hash: '0xsome' } as never;

    const result = await sodax.swaps.postExecution(request);

    expect(result).toBe(execResult);
    expect(mocks.solverPostExecution).toHaveBeenCalledWith(
      request,
      sodax.swaps.solver,
      sodax.swaps.config.logger,
      sodax.swaps.config.apiKey,
    );
  });

  it('wraps a SolverErrorResponse failure as SWAP_SOLVER_API_ERROR with solver code on context', async () => {
    const detail = { code: -8, message: 'quote not found' };
    mocks.solverPostExecution.mockResolvedValueOnce({ ok: false, error: { detail } });

    const result = await sodax.swaps.postExecution({ intent_tx_hash: '0xsome' } as never);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(isSodaxError(result.error)).toBe(true);
      expect(result.error.code).toBe('EXTERNAL_API_ERROR');
      expect(result.error.message).toBe('quote not found');
      expect(result.error.context?.phase).toBe('postExecution');
      expect(result.error.context?.solverCode).toBe(-8);
      expect(result.error.context?.solverDetail).toEqual(detail);
    }
  });

  it('wraps a thrown exception as SWAP_POST_EXECUTION_FAILED with cause', async () => {
    const thrown = new Error('network down');
    mocks.solverPostExecution.mockRejectedValueOnce(thrown);

    const result = await sodax.swaps.postExecution({ intent_tx_hash: '0xsome' } as never);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('EXECUTION_FAILED');
      expect(result.error.cause).toBe(thrown);
    }
  });

  it('preserves an inner SodaxError thrown from SolverApiService (does not re-wrap)', async () => {
    const inner = new SodaxError('EXTERNAL_API_ERROR', 'pre-wrapped', {
      feature: 'swap',
      context: { phase: 'postExecution', api: 'solver', solverCode: -8 },
    });
    mocks.solverPostExecution.mockRejectedValueOnce(inner);

    const result = await sodax.swaps.postExecution({ intent_tx_hash: '0xsome' } as never);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe(inner);
  });

  it('wraps a SodaxError with an out-of-union code as SWAP_POST_EXECUTION_FAILED (typed contract preserved)', async () => {
    // postExecution's narrow union is { POST_EXECUTION_FAILED, SOLVER_API_ERROR, UNKNOWN }.
    // If a future code path threw a SodaxError with e.g. SWAP_RELAY_TIMEOUT (valid SwapError
    // but NOT a PostExecutionError), the previous `as PostExecutionError` cast would have
    // silently widened the contract. The narrow guard now wraps it as the method's own code.
    const outOfUnion = new SodaxError('RELAY_TIMEOUT', 'unexpected', {
      feature: 'swap',
      context: { phase: 'relay' },
    });
    mocks.solverPostExecution.mockRejectedValueOnce(outOfUnion);

    const result = await sodax.swaps.postExecution({ intent_tx_hash: '0xsome' } as never);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('EXECUTION_FAILED');
      expect(result.error.cause).toBe(outOfUnion);
    }
  });

  it('falls back to a synthetic detail when SolverApiService returns a malformed error', async () => {
    // Simulate an upstream contract violation — error without a `detail` field.
    mocks.solverPostExecution.mockResolvedValueOnce({ ok: false, error: {} });

    const result = await sodax.swaps.postExecution({ intent_tx_hash: '0xsome' } as never);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('EXTERNAL_API_ERROR');
      expect(result.error.message).toBe('Solver returned malformed error response');
      expect(result.error.context?.solverCode).toBe(-999);
    }
  });
});

// The solver transport has no per-request override surface, so the configured instance key is the
// only tier it can carry — asserted on a keyed instance, since the shared `sodax` holds none.
describe('SwapService → solver API key', () => {
  const keyed = new Sodax({ apiKey: 'instance-key', swaps: { useBackendSubmitTx: false }, logger: 'silent' });

  it('forwards the configured key to the solver status read', async () => {
    mocks.solverGetStatus.mockResolvedValueOnce({ ok: true, value: { status: SolverIntentStatusCode.SOLVED } });

    await keyed.swaps.getStatus({ intent_tx_hash: '0xsome' } as never);

    expect(mocks.solverGetStatus.mock.calls[0]?.[4]).toBe('instance-key');
  });

  it('forwards the configured key to the solver execution notice', async () => {
    mocks.solverPostExecution.mockResolvedValueOnce({ ok: true, value: { answer: 'OK' } });

    await keyed.swaps.postExecution({ intent_tx_hash: '0xsome' } as never);

    expect(mocks.solverPostExecution.mock.calls[0]?.[3]).toBe('instance-key');
  });
});

describe('SwapService.submitIntent', () => {
  const submitPayload = {
    action: 'submit',
    params: { chain_id: '0x38.bsc', tx_hash: '0xtx' },
  } as never;

  it('returns ok:true wrapping the submit response when success is true', async () => {
    const relayResponse = { success: true, message: 'accepted' };
    mocks.submitTransaction.mockResolvedValueOnce({ ok: true, value: relayResponse });

    const result = await sodax.swaps.submitIntent(submitPayload);

    expect(result).toEqual({ ok: true, value: relayResponse });
    expect(mocks.submitTransaction).toHaveBeenCalledWith(submitPayload, sodax.swaps.relayerApiEndpoint);
  });

  it('wraps a success:false response as Error("SUBMIT_TX_FAILED") with the relay message on .cause', async () => {
    mocks.submitTransaction.mockResolvedValueOnce({
      ok: false,
      error: new Error('SUBMIT_TX_FAILED', { cause: new Error('relay rejected') }),
    });

    const result = await sodax.swaps.submitIntent(submitPayload);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect((result.error as Error).message).toBe('SUBMIT_TX_FAILED');
      expect(((result.error as Error).cause as Error).message).toBe('relay rejected');
    }
  });

  it('returns ok:false when submitTransaction rejects', async () => {
    const networkError = new Error('NETWORK_DOWN');
    mocks.submitTransaction.mockRejectedValueOnce(networkError);

    const result = await sodax.swaps.submitIntent(submitPayload);
    expect(result).toEqual({ ok: false, error: networkError });
  });
});

// =========================================================================
// Batch 4: quote request — adjusts amount by partner fee before delegating.
// =========================================================================

describe('SwapService.createIntent — extras (partnerFee + srcPublicKey)', () => {
  // Distinct valid addresses so the override is provably different from the configured fee.
  const CONFIGURED_FEE = { address: '0x00000000000000000000000000000000feec0a01', percentage: 50 } as const;
  const OVERRIDE_FEE = { address: '0x00000000000000000000000000000000feec0b02', percentage: 100 } as const;

  // createIntent's fee fallback is `this.partnerFee` — the constructor snapshot of config.swapPartnerFee.
  // Build a Sodax whose configured swap fee IS CONFIGURED_FEE, with createIntent's deps stubbed.
  const makeConfiguredFeeSwaps = () => {
    const s = new Sodax({ swaps: { partnerFee: CONFIGURED_FEE } });
    vi.spyOn(s.config, 'isValidOriginalAssetAddress').mockReturnValue(true);
    vi.spyOn(s.config, 'isValidSpokeChainKey').mockReturnValue(true);
    vi.spyOn(s.hubProvider, 'getUserHubWalletAddress').mockResolvedValue('0xhubwallet');
    vi.spyOn(s.spoke, 'deposit').mockResolvedValue({ ok: true, value: '0xdeposit-hash' });
    return s.swaps;
  };

  it('uses extras.partnerFee, overriding the configured swap fee (this.partnerFee)', async () => {
    const swaps = makeConfiguredFeeSwaps();
    mocks.constructCreateIntentData.mockReturnValueOnce(['0xintentdata', makeIntent(ChainKeys.BSC_MAINNET), 42n]);

    const result = await swaps.createIntent({
      params: intentInput(ChainKeys.BSC_MAINNET),
      extras: { partnerFee: OVERRIDE_FEE },
      raw: false,
      walletProvider: mockEvmProvider,
    });

    expect(result.ok).toBe(true);
    // 4th positional arg to constructCreateIntentData is the effective partner fee — the override wins.
    expect(mocks.constructCreateIntentData.mock.calls.at(-1)?.[3]).toEqual(OVERRIDE_FEE);
  });

  it('falls back to the configured swap fee (this.partnerFee) when extras.partnerFee is omitted', async () => {
    const swaps = makeConfiguredFeeSwaps();
    mocks.constructCreateIntentData.mockReturnValueOnce(['0xintentdata', makeIntent(ChainKeys.BSC_MAINNET), 42n]);

    const result = await swaps.createIntent({
      params: intentInput(ChainKeys.BSC_MAINNET),
      raw: false,
      walletProvider: mockEvmProvider,
    });

    expect(result.ok).toBe(true);
    expect(mocks.constructCreateIntentData.mock.calls.at(-1)?.[3]).toEqual(CONFIGURED_FEE);
  });

  it('forwards extras.partnerFee as the fee on the Sonic (hub) intent path', async () => {
    const svc = sodax.swaps;
    const fakeIntent = makeIntent(ChainKeys.SONIC_MAINNET);
    mocks.getUserHubWalletAddress.mockResolvedValueOnce('0xhubwallet');
    mocks.sonicCreateSwapIntent.mockResolvedValueOnce(['0xexec-hash', fakeIntent, 0n, '0xdata']);

    const result = await svc.createIntent({
      params: intentInput(ChainKeys.SONIC_MAINNET),
      extras: { partnerFee: OVERRIDE_FEE },
      raw: false,
      walletProvider: mockEvmProvider,
    });

    expect(result.ok).toBe(true);
    expect(mocks.sonicCreateSwapIntent.mock.calls.at(-1)?.[0].fee).toEqual(OVERRIDE_FEE);
  });

  it('passes extras.srcPublicKey through to SpokeService.deposit for a Stacks raw intent', async () => {
    const svc = sodax.swaps;
    const srcPublicKey = '025259f813b57dd5c3fcac09776d767a49f6dd77bba5895823b891e31b10a96a5d';
    mocks.getUserHubWalletAddress.mockResolvedValueOnce('SP-hub-wallet');
    mocks.constructCreateIntentData.mockReturnValueOnce(['0xintentdata', makeIntent(), 0n]);
    vi.spyOn(svc.spoke, 'deposit').mockResolvedValueOnce({ ok: true, value: { payload: '0xraw' } });

    const result = await svc.createIntent({
      params: intentInput(ChainKeys.STACKS_MAINNET),
      extras: { srcPublicKey },
      raw: true,
    });

    expect(result.ok).toBe(true);
    const depositCall = (svc.spoke.deposit as ReturnType<typeof vi.fn>).mock.calls.at(-1)?.[0];
    expect(depositCall.srcPublicKey).toBe(srcPublicKey);
  });

  it('rejects a Stacks raw intent when extras.srcPublicKey is missing', async () => {
    const result = await sodax.swaps.createIntent({
      params: intentInput(ChainKeys.STACKS_MAINNET),
      raw: true,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(isSodaxError(result.error)).toBe(true);
      expect(result.error.code).toBe('VALIDATION_FAILED');
      expect(result.error.message).toContain('srcPublicKey');
    }
  });

  it('passes extras.bound.accessToken through to SpokeService.deposit for a Bitcoin raw intent', async () => {
    const svc = sodax.swaps;
    const accessToken = 'bound-access-token-xyz';
    mocks.getUserHubWalletAddress.mockResolvedValueOnce('0xhubwallet');
    mocks.constructCreateIntentData.mockReturnValueOnce(['0xintentdata', makeIntent(ChainKeys.BITCOIN_MAINNET), 0n]);
    vi.spyOn(svc.spoke.bitcoin, 'getEffectiveWalletAddress').mockImplementation(async (a: string) => a);
    vi.spyOn(svc.spoke, 'deposit').mockResolvedValueOnce({ ok: true, value: { payload: '0xraw' } });

    const result = await svc.createIntent({
      params: intentInput(ChainKeys.BITCOIN_MAINNET),
      extras: { bound: { accessToken } },
      raw: true,
    });

    expect(result.ok).toBe(true);
    const depositCall = (svc.spoke.deposit as ReturnType<typeof vi.fn>).mock.calls.at(-1)?.[0];
    expect(depositCall.accessToken).toBe(accessToken);
  });

  it('omits accessToken on the deposit params when extras.bound is absent (BitcoinSpokeService falls back to its radfi instance token)', async () => {
    const svc = sodax.swaps;
    mocks.getUserHubWalletAddress.mockResolvedValueOnce('0xhubwallet');
    mocks.constructCreateIntentData.mockReturnValueOnce(['0xintentdata', makeIntent(ChainKeys.BITCOIN_MAINNET), 0n]);
    vi.spyOn(svc.spoke.bitcoin, 'getEffectiveWalletAddress').mockImplementation(async (a: string) => a);
    vi.spyOn(svc.spoke, 'deposit').mockResolvedValueOnce({ ok: true, value: { payload: '0xraw' } });

    const result = await svc.createIntent({
      params: intentInput(ChainKeys.BITCOIN_MAINNET),
      raw: true,
    });

    expect(result.ok).toBe(true);
    const depositCall = (svc.spoke.deposit as ReturnType<typeof vi.fn>).mock.calls.at(-1)?.[0];
    expect(depositCall.accessToken).toBeUndefined();
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

  it('forwards the payload (after fee adjustment) to SolverApiService.getQuote and returns the Result', async () => {
    const quoteResponse = { ok: true as const, value: { quoted_amount: 900_000n } as never };
    mocks.solverGetQuote.mockResolvedValueOnce(quoteResponse);

    const result = await sodax.swaps.getQuote(baseQuoteRequest);

    expect(result).toBe(quoteResponse);
    // Second arg is the solver config, third is ConfigService instance. We assert shape, not deep equality.
    expect(mocks.solverGetQuote).toHaveBeenCalledWith(
      expect.objectContaining({ amount: expect.any(BigInt) }),
      sodax.swaps.solver,
      sodax.config,
    );
  });

  it('leaves the amount unchanged when no partnerFee is configured', async () => {
    mocks.solverGetQuote.mockResolvedValueOnce({ ok: true, value: {} });

    await sodax.swaps.getQuote(baseQuoteRequest);

    const forwarded = mocks.solverGetQuote.mock.calls.at(-1)?.[0] as { amount: bigint };
    // No partnerFee → adjustAmountByFee returns the input untouched.
    expect(forwarded.amount).toBe(baseQuoteRequest.amount);
  });

  it('forwards a failure Result from SolverApiService.getQuote', async () => {
    const failure = { ok: false, error: { code: 'INSUFFICIENT_LIQUIDITY' } } as never;
    mocks.solverGetQuote.mockResolvedValueOnce(failure);

    const result = await sodax.swaps.getQuote(baseQuoteRequest);

    expect(result).toBe(failure);
  });

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
// Batch 5: expand coverage for approve + isAllowanceValid beyond happy paths.
// =========================================================================

describe('SwapService.isAllowanceValid — error propagation', () => {
  it('returns ok:false when spoke.isAllowanceValid rejects on an EVM spoke', async () => {
    const rpcError = new Error('RPC_DOWN');
    vi.spyOn(sodax.spoke, 'isAllowanceValid').mockRejectedValueOnce(rpcError);

    const result = await sodax.swaps.isAllowanceValid({
      params: intentInput(ChainKeys.BSC_MAINNET),
      raw: false,
      walletProvider: mockEvmProvider,
    });

    expect(result).toEqual({ ok: false, error: rpcError });
  });

  it('forwards a failure Result from spoke.isAllowanceValid unchanged', async () => {
    const spokeError = new Error('ALLOWANCE_CHECK_FAILED');
    vi.spyOn(sodax.spoke, 'isAllowanceValid').mockResolvedValueOnce({ ok: false, error: spokeError });

    const result = await sodax.swaps.isAllowanceValid({
      params: intentInput(ChainKeys.BSC_MAINNET),
      raw: false,
      walletProvider: mockEvmProvider,
    });

    expect(result).toEqual({ ok: false, error: spokeError });
  });
});

describe('SwapService.approve — additional branches', () => {
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

  it('wraps a failure Result from spoke.approve on an EVM spoke as SodaxError(APPROVE_FAILED) with the original error preserved as cause', async () => {
    const approveError = new Error('APPROVE_REJECTED');
    vi.spyOn(sodax.spoke, 'approve').mockResolvedValueOnce({ ok: false, error: approveError });

    const result = await sodax.swaps.approve({
      params: intentInput(ChainKeys.BSC_MAINNET),
      raw: false,
      walletProvider: mockEvmProvider,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(isSodaxError(result.error)).toBe(true);
    expect((result.error as SodaxError).code).toBe('APPROVE_FAILED');
    expect((result.error as SodaxError).feature).toBe('swap');
    expect((result.error as SodaxError).cause).toBe(approveError);
  });

  it('returns ok:false when spoke.approve rejects (thrown)', async () => {
    const thrownError = new Error('APPROVE_THROWS');
    vi.spyOn(sodax.spoke, 'approve').mockRejectedValueOnce(thrownError);

    const result = await sodax.swaps.approve({
      params: intentInput(ChainKeys.BSC_MAINNET),
      raw: false,
      walletProvider: mockEvmProvider,
    });

    expect(result).toEqual({ ok: false, error: thrownError });
  });

  it('returns ok:false when the EVM path receives a non-EVM wallet provider (invariant inside try)', async () => {
    const result = await sodax.swaps.approve({
      params: intentInput(ChainKeys.BSC_MAINNET),
      raw: false,
      // Solana provider cast onto an EVM chain — the isOptionalEvmWalletProviderType
      // invariant inside the try block converts the mismatch into a Result failure.
      walletProvider: mockSolanaProvider as unknown as IEvmWalletProvider,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(String(result.error)).toMatch(/Expected Evm wallet provider/);
    }
  });

  it('returns ok:false when the Stellar path receives a non-Stellar wallet provider', async () => {
    const result = await sodax.swaps.approve({
      params: intentInput(ChainKeys.STELLAR_MAINNET),
      raw: false,
      walletProvider: mockEvmProvider as unknown as IStellarWalletProvider,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(String(result.error)).toMatch(/Expected Stellar wallet provider/);
    }
  });

  it('on Stellar with raw=true, calls spoke.approve without walletProvider', async () => {
    const rawTx = { from: '0x1', to: '0x2', data: '0x', value: 0n };
    const spy = vi.spyOn(sodax.spoke, 'approve').mockResolvedValueOnce({ ok: true, value: rawTx as never });

    const result = await sodax.swaps.approve({
      params: intentInput(ChainKeys.STELLAR_MAINNET),
      raw: true,
    });

    expect(result.ok).toBe(true);
    const callArg = spy.mock.calls[0]?.[0];
    expect(callArg).toMatchObject({ raw: true });
    expect(callArg).not.toHaveProperty('walletProvider');
  });
});

// =========================================================================
// Batch 6: swap — orchestrates createIntent + verify + relay + postExecution.
// =========================================================================

describe('SwapService.swap', () => {
  // Stub createIntent so tests can focus on swap's orchestration logic without re-traversing
  // all of createIntent's internal paths. Return value: [spokeTxHash, intent, data].
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
    // The relay path must NOT have been invoked for hub-chain srcChain.
    expect(mocks.relayTxAndWaitPacket).not.toHaveBeenCalled();
  });

  it('on an EVM spoke srcChain, relays the spoke tx then calls postExecution with the dst tx hash', async () => {
    stubCreateIntentOk(ChainKeys.BSC_MAINNET, '0xbscTx');
    mocks.relayTxAndWaitPacket.mockResolvedValueOnce({ ok: true, value: { dst_tx_hash: '0xdstTx' } });
    mocks.solverPostExecution.mockResolvedValueOnce({ ok: true, value: { answer: 'OK' } });

    const result = await sodax.swaps.swap({
      params: intentInput(ChainKeys.BSC_MAINNET),
      raw: false,
      walletProvider: mockEvmProvider,
    });

    expect(result.ok).toBe(true);
    // callsite always forwards relayData verbatim; the Solana/Bitcoin gate lives inside relayTxAndWaitPacket.
    expect(mocks.relayTxAndWaitPacket.mock.calls[0]?.[0].data).toBeDefined();
    expect(mocks.solverPostExecution).toHaveBeenCalledWith(
      expect.objectContaining({ intent_tx_hash: '0xdstTx' }),
      sodax.swaps.solver,
      sodax.swaps.config.logger,
      sodax.swaps.config.apiKey,
    );
  });

  it('on Solana srcChain, passes extraData (address + payload) to relayTxAndWaitPacket', async () => {
    stubCreateIntentOk(ChainKeys.SOLANA_MAINNET, '0xsolTx');
    mocks.relayTxAndWaitPacket.mockResolvedValueOnce({ ok: true, value: { dst_tx_hash: '0xdstTx' } });
    mocks.solverPostExecution.mockResolvedValueOnce({ ok: true, value: { answer: 'OK' } });

    await sodax.swaps.swap({
      params: intentInput(ChainKeys.SOLANA_MAINNET),
      raw: false,
      walletProvider: mockSolanaProvider,
    });

    const extraData = mocks.relayTxAndWaitPacket.mock.calls[0]?.[0].data;
    expect(extraData).toBeDefined();
    expect(extraData).toHaveProperty('address');
    expect(extraData).toHaveProperty('payload');
  });

  it('returns the failure from createIntent when it fails', async () => {
    const createError = new SodaxError('INTENT_CREATION_FAILED', 'create intent failed', { feature: 'swap' });
    vi.spyOn(sodax.swaps, 'createIntent').mockResolvedValueOnce({ ok: false, error: createError });

    const result = await sodax.swaps.swap({
      params: intentInput(ChainKeys.BSC_MAINNET),
      raw: false,
      walletProvider: mockEvmProvider,
    });

    expect(result).toEqual({ ok: false, error: createError });
    expect(mocks.relayTxAndWaitPacket).not.toHaveBeenCalled();
  });

  it('wraps a verifyTxHash failure in SWAP_VERIFY_FAILED with cause', async () => {
    stubCreateIntentOk(ChainKeys.BSC_MAINNET);
    const verifyError = new Error('VERIFY_FAILED');
    vi.spyOn(sodax.spoke, 'verifyTxHash').mockResolvedValueOnce({ ok: false, error: verifyError });

    const result = await sodax.swaps.swap({
      params: intentInput(ChainKeys.BSC_MAINNET),
      raw: false,
      walletProvider: mockEvmProvider,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('TX_VERIFICATION_FAILED');
      expect(result.error.cause).toBe(verifyError);
      expect(result.error.context?.phase).toBe('verify');
    }
    expect(mocks.relayTxAndWaitPacket).not.toHaveBeenCalled();
  });

  it('wraps a RELAY_TIMEOUT relay failure in SWAP_RELAY_TIMEOUT with relayCode in context', async () => {
    stubCreateIntentOk(ChainKeys.BSC_MAINNET);
    const relayError = new Error('RELAY_TIMEOUT');
    mocks.relayTxAndWaitPacket.mockResolvedValueOnce({ ok: false, error: relayError });

    const result = await sodax.swaps.swap({
      params: intentInput(ChainKeys.BSC_MAINNET),
      raw: false,
      walletProvider: mockEvmProvider,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('RELAY_TIMEOUT');
      expect(result.error.context?.relayCode).toBe('RELAY_TIMEOUT');
      expect(result.error.context?.phase).toBe('relay');
      expect(result.error.cause).toBe(relayError);
    }
    expect(mocks.solverPostExecution).not.toHaveBeenCalled();
  });

  it('wraps a SUBMIT_TX_FAILED relay failure in SWAP_SUBMIT_TX_FAILED', async () => {
    stubCreateIntentOk(ChainKeys.BSC_MAINNET);
    const submitError = new Error('SUBMIT_TX_FAILED');
    mocks.relayTxAndWaitPacket.mockResolvedValueOnce({ ok: false, error: submitError });

    const result = await sodax.swaps.swap({
      params: intentInput(ChainKeys.BSC_MAINNET),
      raw: false,
      walletProvider: mockEvmProvider,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('TX_SUBMIT_FAILED');
      expect(result.error.context?.relayCode).toBe('SUBMIT_TX_FAILED');
      expect(result.error.context?.phase).toBe('submit');
    }
  });

  it('wraps an unknown relay failure in SWAP_RELAY_FAILED with relayCode UNKNOWN', async () => {
    stubCreateIntentOk(ChainKeys.BSC_MAINNET);
    const relayError = new Error('NEW_FUTURE_RELAY_CODE');
    mocks.relayTxAndWaitPacket.mockResolvedValueOnce({ ok: false, error: relayError });

    const result = await sodax.swaps.swap({
      params: intentInput(ChainKeys.BSC_MAINNET),
      raw: false,
      walletProvider: mockEvmProvider,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('RELAY_FAILED');
      expect(result.error.context?.relayCode).toBe('UNKNOWN');
    }
  });

  it('propagates a postExecution SolverErrorResponse as SWAP_SOLVER_API_ERROR through swap', async () => {
    stubCreateIntentOk(ChainKeys.SONIC_MAINNET);
    const detail = { code: -7, message: 'no execution module found' };
    mocks.solverPostExecution.mockResolvedValueOnce({ ok: false, error: { detail } });

    const result = await sodax.swaps.swap({
      params: intentInput(ChainKeys.SONIC_MAINNET),
      raw: false,
      walletProvider: mockEvmProvider,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('EXTERNAL_API_ERROR');
      expect(result.error.context?.solverCode).toBe(-7);
    }
  });

  describe('post-broadcast failures carry the source tx', () => {
    const swapOnBsc = () =>
      sodax.swaps.swap({ params: intentInput(ChainKeys.BSC_MAINNET), raw: false, walletProvider: mockEvmProvider });

    it('on a verifyTxHash failure', async () => {
      stubCreateIntentOk(ChainKeys.BSC_MAINNET, '0xbscTx');
      vi.spyOn(sodax.spoke, 'verifyTxHash').mockResolvedValueOnce({ ok: false, error: new Error('VERIFY_FAILED') });

      const result = await swapOnBsc();

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.context).toMatchObject({ srcChainKey: ChainKeys.BSC_MAINNET, srcTxHash: '0xbscTx' });
      }
    });

    it.each(['RELAY_TIMEOUT', 'SUBMIT_TX_FAILED', 'NEW_FUTURE_RELAY_CODE'])('on a %s relay failure', async message => {
      stubCreateIntentOk(ChainKeys.BSC_MAINNET, '0xbscTx');
      mocks.relayTxAndWaitPacket.mockResolvedValueOnce({ ok: false, error: new Error(message) });

      const result = await swapOnBsc();

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.context).toMatchObject({ srcChainKey: ChainKeys.BSC_MAINNET, srcTxHash: '0xbscTx' });
      }
    });

    it('on a postExecution failure, keeping the solver code', async () => {
      stubCreateIntentOk(ChainKeys.BSC_MAINNET, '0xbscTx');
      mocks.relayTxAndWaitPacket.mockResolvedValueOnce({ ok: true, value: { dst_tx_hash: '0xdstTx' } });
      mocks.solverPostExecution.mockResolvedValueOnce({
        ok: false,
        error: { detail: { code: -7, message: 'no execution module found' } },
      });

      const result = await swapOnBsc();

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('EXTERNAL_API_ERROR');
        expect(result.error.context).toMatchObject({
          solverCode: -7,
          srcChainKey: ChainKeys.BSC_MAINNET,
          srcTxHash: '0xbscTx',
        });
      }
    });

    it('but not on a createIntent failure, where nothing was broadcast', async () => {
      const createError = new SodaxError('INTENT_CREATION_FAILED', 'create intent failed', { feature: 'swap' });
      vi.spyOn(sodax.swaps, 'createIntent').mockResolvedValueOnce({ ok: false, error: createError });

      const result = await swapOnBsc();

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.context?.srcTxHash).toBeUndefined();
      }
    });
  });

  it('wraps a thrown error from createIntent in SWAP_UNKNOWN with cause', async () => {
    const thrownError = new Error('CREATE_THROWS');
    vi.spyOn(sodax.swaps, 'createIntent').mockRejectedValueOnce(thrownError);

    const result = await sodax.swaps.swap({
      params: intentInput(ChainKeys.BSC_MAINNET),
      raw: false,
      walletProvider: mockEvmProvider,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('UNKNOWN');
      expect(result.error.cause).toBe(thrownError);
    }
  });

  it('preserves an inner SodaxError when createIntent throws one (does not re-wrap as SWAP_UNKNOWN)', async () => {
    const inner = new SodaxError('VALIDATION_FAILED', 'my validation', {
      feature: 'swap',
      context: { phase: 'validate' },
    });
    vi.spyOn(sodax.swaps, 'createIntent').mockRejectedValueOnce(inner);

    const result = await sodax.swaps.swap({
      params: intentInput(ChainKeys.BSC_MAINNET),
      raw: false,
      walletProvider: mockEvmProvider,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe(inner);
    }
  });

  it('wraps a SodaxError with a non-swap code as SWAP_UNKNOWN (typed contract preserved)', async () => {
    // The narrow `isSwapError` guard rejects codes outside SwapErrorCode (e.g. an accidental
    // SodaxError with a moneyMarket-prefixed code thrown from inside swap orchestration).
    // The previous `as SwapError` cast would have silently leaked it through. Now wrapped.
    const outOfUnion = new SodaxError('SOMEMODULE_FOO_FAILED' as never, 'unexpected', { feature: 'swap' });
    vi.spyOn(sodax.swaps, 'createIntent').mockRejectedValueOnce(outOfUnion);

    const result = await sodax.swaps.swap({
      params: intentInput(ChainKeys.BSC_MAINNET),
      raw: false,
      walletProvider: mockEvmProvider,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('UNKNOWN');
      expect(result.error.cause).toBe(outOfUnion);
    }
  });

  it('returns the IntentDeliveryInfo tuple with src/dst chain + tx info on success', async () => {
    const params = intentInput(ChainKeys.BSC_MAINNET);
    stubCreateIntentOk(ChainKeys.BSC_MAINNET, '0xbscTx');
    mocks.relayTxAndWaitPacket.mockResolvedValueOnce({ ok: true, value: { dst_tx_hash: '0xdstTx' } });
    mocks.solverPostExecution.mockResolvedValueOnce({ ok: true, value: { answer: 'OK' } });

    const result = await sodax.swaps.swap({ params, raw: false, walletProvider: mockEvmProvider });

    expect(result.ok).toBe(true);
    if (result.ok) {
      const { intentDeliveryInfo } = result.value;
      expect(intentDeliveryInfo).toEqual({
        srcChainKey: ChainKeys.BSC_MAINNET,
        srcTxHash: '0xbscTx',
        srcAddress: params.srcAddress,
        dstChainKey: params.dstChainKey,
        dstTxHash: '0xdstTx',
        dstAddress: params.dstAddress,
      });
    }
  });
});

// =========================================================================
// Batch 7: cancel family — createCancelIntent + cancelIntent expansion + cancelLimitOrder.
// =========================================================================

describe('SwapService.createCancelIntent', () => {
  it('forwards sendMessage params with raw=true and no walletProvider', async () => {
    const intent = makeIntent(ChainKeys.BSC_MAINNET);
    const sendMessageSpy = vi
      .spyOn(sodax.spoke, 'sendMessage')
      .mockResolvedValueOnce({ ok: true, value: { from: '0x1', to: '0x2', data: '0x', value: 0n } });

    const result = await sodax.swaps.createCancelIntent({
      params: {
        srcChainKey: ChainKeys.BSC_MAINNET,
        intent,
      },
      raw: true,
    });

    expect(result.ok).toBe(true);
    const callArg = sendMessageSpy.mock.calls[0]?.[0];
    expect(callArg).toMatchObject({ raw: true });
    expect(callArg).not.toHaveProperty('walletProvider');
  });

  it('forwards sendMessage params with raw=false and walletProvider', async () => {
    const intent = makeIntent(ChainKeys.BSC_MAINNET);
    const sendMessageSpy = vi
      .spyOn(sodax.spoke, 'sendMessage')
      .mockResolvedValueOnce({ ok: true, value: '0xcancel-tx' });

    const result = await sodax.swaps.createCancelIntent({
      params: {
        srcChainKey: ChainKeys.BSC_MAINNET,
        intent,
      },
      raw: false,
      walletProvider: mockEvmProvider,
    });

    expect(result.ok).toBe(true);
    const callArg = sendMessageSpy.mock.calls[0]?.[0];
    expect(callArg).toMatchObject({ raw: false, walletProvider: mockEvmProvider });
  });

  it('returns ok:false when intent.srcChain is not a valid relay chain id', async () => {
    const intent = makeIntent(ChainKeys.BSC_MAINNET);
    // Override the default beforeEach stub: first call (intent.srcChain check) fails.
    vi.spyOn(sodax.config, 'isValidIntentRelayChainId').mockReturnValueOnce(false);

    const result = await sodax.swaps.createCancelIntent({
      params: {
        srcChainKey: ChainKeys.BSC_MAINNET,
        intent,
      },
      raw: false,
      walletProvider: mockEvmProvider,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(String(result.error)).toMatch(/Invalid intent\.srcChain/);
    }
  });

  it('returns ok:false when intent.dstChain is not a valid relay chain id', async () => {
    const intent = makeIntent(ChainKeys.BSC_MAINNET);
    vi.spyOn(sodax.config, 'isValidIntentRelayChainId').mockReturnValueOnce(true).mockReturnValueOnce(false);

    const result = await sodax.swaps.createCancelIntent({
      params: {
        srcChainKey: ChainKeys.BSC_MAINNET,
        intent,
      },
      raw: false,
      walletProvider: mockEvmProvider,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(String(result.error)).toMatch(/Invalid intent\.dstChain/);
    }
  });

  it('wraps a failure Result from spoke.sendMessage as SodaxError(INTENT_CREATION_FAILED) with the original error preserved as cause', async () => {
    const intent = makeIntent(ChainKeys.BSC_MAINNET);
    const sendError = new Error('SEND_REJECTED');
    vi.spyOn(sodax.spoke, 'sendMessage').mockResolvedValueOnce({ ok: false, error: sendError });

    const result = await sodax.swaps.createCancelIntent({
      params: {
        srcChainKey: ChainKeys.BSC_MAINNET,
        intent,
      },
      raw: false,
      walletProvider: mockEvmProvider,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(isSodaxError(result.error)).toBe(true);
    expect((result.error as SodaxError).code).toBe('INTENT_CREATION_FAILED');
    expect((result.error as SodaxError).feature).toBe('swap');
    expect((result.error as SodaxError).cause).toBe(sendError);
  });

  it('wraps a thrown spoke.sendMessage failure as SodaxError(INTENT_CREATION_FAILED, swap) with .cause', async () => {
    const intent = makeIntent(ChainKeys.BSC_MAINNET);
    const thrownError = new Error('SEND_THROWS');
    vi.spyOn(sodax.spoke, 'sendMessage').mockRejectedValueOnce(thrownError);

    const result = await sodax.swaps.createCancelIntent({
      params: {
        srcChainKey: ChainKeys.BSC_MAINNET,
        intent,
      },
      raw: false,
      walletProvider: mockEvmProvider,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(isSodaxError(result.error)).toBe(true);
    expect((result.error as SodaxError).code).toBe('INTENT_CREATION_FAILED');
    expect((result.error as SodaxError).feature).toBe('swap');
    expect((result.error as SodaxError).cause).toBe(thrownError);
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

  it('returns the relay failure Result (submit reject or timeout) unchanged', async () => {
    const intent = makeIntent(ChainKeys.BSC_MAINNET);
    const relayError = new Error('SUBMIT_TX_FAILED', { cause: new Error('relay rejected') });
    vi.spyOn(sodax.spoke, 'sendMessage').mockResolvedValueOnce({ ok: true, value: '0xspokeCancelTx' });
    mocks.relayTxAndWaitPacket.mockResolvedValueOnce({ ok: false, error: relayError });

    const result = await sodax.swaps.cancelIntent({
      params: {
        srcChainKey: ChainKeys.BSC_MAINNET,
        intent,
      },
      walletProvider: mockEvmProvider,
    });

    expect(result).toEqual({ ok: false, error: relayError });
  });

  it('returns the failure from verifyTxHash after a successful spoke cancel', async () => {
    const intent = makeIntent(ChainKeys.BSC_MAINNET);
    const verifyError = new Error('VERIFY_FAILED');
    vi.spyOn(sodax.spoke, 'sendMessage').mockResolvedValueOnce({ ok: true, value: '0xspokeCancelTx' });
    vi.spyOn(sodax.spoke, 'verifyTxHash').mockResolvedValueOnce({ ok: false, error: verifyError });

    const result = await sodax.swaps.cancelIntent({
      params: {
        srcChainKey: ChainKeys.BSC_MAINNET,
        intent,
      },
      walletProvider: mockEvmProvider,
    });

    expect(result).toEqual({ ok: false, error: verifyError });
    expect(mocks.relayTxAndWaitPacket).not.toHaveBeenCalled();
  });
});

describe('SwapService.cancelLimitOrder', () => {
  it('delegates directly to cancelIntent (thin pass-through)', async () => {
    const intent = makeIntent(ChainKeys.SONIC_MAINNET);
    const cancelSpy = vi
      .spyOn(sodax.swaps, 'cancelIntent')
      .mockResolvedValueOnce({ ok: true, value: { srcChainTxHash: '0xspokeTx', dstChainTxHash: '0xdstTx' } });

    const result = await sodax.swaps.cancelLimitOrder({
      params: {
        srcChainKey: ChainKeys.SONIC_MAINNET,
        intent,
      },
      walletProvider: mockEvmProvider,
    });

    expect(result).toEqual({ ok: true, value: { srcChainTxHash: '0xspokeTx', dstChainTxHash: '0xdstTx' } });
    // timeout defaults to DEFAULT_RELAY_TX_TIMEOUT; we don't pin the exact number so the test
    // isn't brittle to constant changes — just assert the pass-through.
    expect(cancelSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        params: {
          srcChainKey: ChainKeys.SONIC_MAINNET,
          intent,
        },
        walletProvider: mockEvmProvider,
      }),
    );
  });

  it('forwards cancelIntent failures as-is', async () => {
    const intent = makeIntent(ChainKeys.SONIC_MAINNET);
    const cancelError = new Error('CANCEL_FAILED');
    vi.spyOn(sodax.swaps, 'cancelIntent').mockResolvedValueOnce({ ok: false, error: cancelError });

    const result = await sodax.swaps.cancelLimitOrder({
      params: {
        srcChainKey: ChainKeys.SONIC_MAINNET,
        intent,
      },
      walletProvider: mockEvmProvider,
    });

    expect(result).toEqual({ ok: false, error: cancelError });
  });
});

// =========================================================================
// Batch 8: limit order family — error propagation + raw path for createLimitOrderIntent.
// =========================================================================

describe('SwapService.createLimitOrder — error propagation', () => {
  it('forwards a failure Result from swap() unchanged', async () => {
    const swapError = new SodaxError('EXECUTION_FAILED', 'swap failed', { feature: 'swap' });
    vi.spyOn(sodax.swaps, 'swap').mockResolvedValueOnce({ ok: false, error: swapError });

    const result = await sodax.swaps.createLimitOrder({
      params: intentInput(ChainKeys.BSC_MAINNET),
      raw: false,
      walletProvider: mockEvmProvider,
    });

    expect(result).toEqual({ ok: false, error: swapError });
  });
});

describe('SwapService.createLimitOrderIntent — additional coverage', () => {
  it('raw=false delegates to createIntent with walletProvider and deadline=0n', async () => {
    const fakeIntent = makeIntent(ChainKeys.BSC_MAINNET);
    const createIntentSpy = vi.spyOn(sodax.swaps, 'createIntent').mockResolvedValueOnce({
      ok: true,
      value: {
        tx: '0xtx' as never,
        intent: { ...fakeIntent, feeAmount: 0n },
        relayData: '0x' as never,
      },
    });

    await sodax.swaps.createLimitOrderIntent({
      params: intentInput(ChainKeys.BSC_MAINNET),
      raw: false,
      walletProvider: mockEvmProvider,
    });

    const forwarded = createIntentSpy.mock.calls[0]?.[0];
    expect((forwarded?.params as CreateIntentParams).deadline).toBe(0n);
    expect(forwarded?.walletProvider).toBe(mockEvmProvider);
  });

  it('forwards a failure Result from createIntent unchanged', async () => {
    const createError = new SodaxError('INTENT_CREATION_FAILED', 'create intent failed', { feature: 'swap' });
    vi.spyOn(sodax.swaps, 'createIntent').mockResolvedValueOnce({ ok: false, error: createError });

    const result = await sodax.swaps.createLimitOrderIntent({
      params: intentInput(ChainKeys.BSC_MAINNET),
      raw: false,
      walletProvider: mockEvmProvider,
    });

    expect(result).toEqual({ ok: false, error: createError });
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

  it('threads extras.apiKey into the backend submit-tx leg as a per-request override', async () => {
    stubCreatedAndVerified(ChainKeys.BSC_MAINNET);
    const submitSpy = vi.spyOn(sodaxBE.api.swaps, 'submitTx').mockResolvedValueOnce({
      ok: true,
      value: { success: true, data: { status: 'inserted', message: 'accepted' } },
    } as never);
    const statusSpy = vi.spyOn(sodaxBE.api.swaps, 'getSubmitTxStatus').mockResolvedValueOnce({
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
    } as never);

    const result = await sodaxBE.swaps.swap({
      params: intentInput(ChainKeys.BSC_MAINNET),
      extras: { apiKey: 'per-action-key' },
      raw: false,
      walletProvider: mockEvmProvider,
    });

    expect(result.ok).toBe(true);
    // Both the POST and the status poll carry the per-action key (as RequestOverrideConfig.apiKey).
    expect(submitSpy.mock.calls[0]?.[1]).toMatchObject({ apiKey: 'per-action-key' });
    expect(statusSpy.mock.calls[0]?.[1]).toMatchObject({ apiKey: 'per-action-key' });
  });

  it('verifies exactly once, on the fallback, when the backend attempt does not complete', async () => {
    const verifySpy = stubCreatedAndVerified(ChainKeys.BSC_MAINNET);
    vi.spyOn(sodaxBE.api.swaps, 'submitTx').mockResolvedValueOnce({
      ok: false,
      error: new SodaxError('EXTERNAL_API_ERROR', 'rejected', { feature: 'backend' }),
    });
    mocks.relayTxAndWaitPacket.mockResolvedValueOnce({ ok: true, value: { dst_tx_hash: '0xFALLBACKDST' } });
    mocks.solverPostExecution.mockResolvedValueOnce({ ok: true, value: { answer: 'OK' } });

    const result = await sodaxBE.swaps.swap({
      params: intentInput(ChainKeys.BSC_MAINNET),
      raw: false,
      walletProvider: mockEvmProvider,
    });

    expect(result.ok).toBe(true);
    expect(mocks.relayTxAndWaitPacket).toHaveBeenCalled();
    // The backend attempt costs nothing in verification; the fallback pays for it once, and only then.
    expect(verifySpy).toHaveBeenCalledOnce();
  });

  it('treats "posted_execution" as non-terminal: keeps polling (never completes on it), then falls back', async () => {
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
    } finally {
      vi.useRealTimers();
    }
  });

  it('falls back to the client-side relay when the backend submit POST is rejected', async () => {
    stubCreatedAndVerified(ChainKeys.BSC_MAINNET);
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
    // A backend that fails fast leaves the fallback the SAME full budget a stalled one does — the two
    // paths never share a deadline. The stalled counterpart is asserted below.
    expect(mocks.relayTxAndWaitPacket.mock.calls.at(-1)?.[0]?.timeout).toBe(30_000);
  });

  it('falls back when the backend reports a terminal "failed" status', async () => {
    stubCreatedAndVerified(ChainKeys.BSC_MAINNET);
    vi.spyOn(sodaxBE.api.swaps, 'submitTx').mockResolvedValueOnce({
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
          status: 'failed',
          processingAttempts: 1,
          failureReason: 'boom',
        },
      },
    });
    mocks.relayTxAndWaitPacket.mockResolvedValueOnce({ ok: true, value: { dst_tx_hash: '0xFALLBACKDST' } });
    mocks.solverPostExecution.mockResolvedValueOnce({ ok: true, value: { answer: 'OK' } });

    const result = await sodaxBE.swaps.swap({
      params: intentInput(ChainKeys.BSC_MAINNET),
      raw: false,
      walletProvider: mockEvmProvider,
    });

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.intentDeliveryInfo.dstTxHash).toBe('0xFALLBACKDST');
    expect(mocks.relayTxAndWaitPacket).toHaveBeenCalledOnce();
  });

  it('does not touch the backend submit API when the flag is off', async () => {
    // The module-level `sodax` opts out via `swaps.useBackendSubmitTx: false` → pure client-side flow.
    const intent = makeIntent(ChainKeys.BSC_MAINNET);
    vi.spyOn(sodax.swaps, 'createIntent').mockResolvedValueOnce({
      ok: true,
      value: {
        tx: '0xspokeTx',
        intent: { ...intent, feeAmount: 0n },
        relayData: { address: intent.creator, payload: '0xpay' },
      },
    });
    const submitSpy = vi.spyOn(sodax.api.swaps, 'submitTx');
    mocks.relayTxAndWaitPacket.mockResolvedValueOnce({ ok: true, value: { dst_tx_hash: '0xdstTx' } });
    mocks.solverPostExecution.mockResolvedValueOnce({ ok: true, value: { answer: 'OK' } });

    const result = await sodax.swaps.swap({
      params: intentInput(ChainKeys.BSC_MAINNET),
      raw: false,
      walletProvider: mockEvmProvider,
    });

    expect(result.ok).toBe(true);
    expect(submitSpy).not.toHaveBeenCalled();
  });

  /** Backend accepts the submission but never reaches `solved`, so the attempt runs to its full budget. */
  const stubStalledBackend = () => {
    vi.spyOn(sodaxBE.api.swaps, 'submitTx').mockResolvedValueOnce({
      ok: true,
      value: { success: true, data: { status: 'inserted', message: 'accepted' } },
    });
    vi.spyOn(sodaxBE.api.swaps, 'getSubmitTxStatus').mockResolvedValue({
      ok: true,
      value: {
        success: true,
        data: { txHash: '0xspokeTx', srcChainKey: ChainKeys.BSC_MAINNET, status: 'pending', processingAttempts: 1 },
      },
    });
  };

  it('gives the fallback a FRESH full timeout after a stalled backend consumed its own', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    try {
      stubCreatedAndVerified(ChainKeys.BSC_MAINNET);
      stubStalledBackend();
      mocks.relayTxAndWaitPacket.mockResolvedValueOnce({ ok: true, value: { dst_tx_hash: '0xFALLBACKDST' } });
      mocks.solverPostExecution.mockResolvedValueOnce({ ok: true, value: { answer: 'OK' } });

      const overallTimeout = 30_000;
      const swapPromise = sodaxBE.swaps.swap({
        params: intentInput(ChainKeys.BSC_MAINNET),
        raw: false,
        walletProvider: mockEvmProvider,
        timeout: overallTimeout,
      });
      // Drive the backend attempt past its own deadline so swap() falls back.
      await vi.advanceTimersByTimeAsync(overallTimeout);
      const result = await swapPromise;

      expect(result.ok).toBe(true);
      // `timeout` is per-attempt: the backend spending all of its own budget must not shorten the relay
      // wait. Sharing one deadline left this at the ~5s floor, which is how a slow chain hit RELAY_TIMEOUT.
      const relayTimeout = mocks.relayTxAndWaitPacket.mock.calls.at(-1)?.[0]?.timeout as number;
      expect(relayTimeout).toBe(overallTimeout);
    } finally {
      vi.useRealTimers();
    }
  });

  it('lets a relay slower than the backend attempt still succeed on the default timeout', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    try {
      stubCreatedAndVerified(ChainKeys.BSC_MAINNET);
      stubStalledBackend();
      // ~40s to deliver the packet: comfortably inside a fresh 120s budget, impossible within the ≤20s
      // a shared deadline used to leave behind.
      mocks.relayTxAndWaitPacket.mockImplementationOnce(
        async ({ timeout }: { timeout: number }) =>
          new Promise(resolve =>
            setTimeout(
              () =>
                resolve(
                  timeout >= 40_000
                    ? { ok: true, value: { dst_tx_hash: '0xFALLBACKDST' } }
                    : { ok: false, error: new Error('RELAY_TIMEOUT') },
                ),
              Math.min(timeout, 40_000),
            ),
          ),
      );
      mocks.solverPostExecution.mockResolvedValueOnce({ ok: true, value: { answer: 'OK' } });

      const swapPromise = sodaxBE.swaps.swap({
        params: intentInput(ChainKeys.BSC_MAINNET),
        raw: false,
        walletProvider: mockEvmProvider,
      });
      await vi.advanceTimersByTimeAsync(DEFAULT_RELAY_TX_TIMEOUT * 2);

      expect((await swapPromise).ok).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('skips the backend POST entirely when the caller leaves no budget', async () => {
    stubCreatedAndVerified(ChainKeys.BSC_MAINNET);
    // Stubbed even though the assertion is that it never runs: an unmocked spy calls through, so a
    // regression in the budget guard would turn this unit test into a real POST to the live backend.
    const submitSpy = vi.spyOn(sodaxBE.api.swaps, 'submitTx').mockResolvedValue({
      ok: false,
      error: new SodaxError('EXTERNAL_API_ERROR', 'unreachable', { feature: 'backend' }),
    });
    mocks.relayTxAndWaitPacket.mockResolvedValueOnce({ ok: true, value: { dst_tx_hash: '0xFALLBACKDST' } });
    mocks.solverPostExecution.mockResolvedValueOnce({ ok: true, value: { answer: 'OK' } });

    const result = await sodaxBE.swaps.swap({
      params: intentInput(ChainKeys.BSC_MAINNET),
      raw: false,
      walletProvider: mockEvmProvider,
      timeout: 0,
    });

    expect(result.ok).toBe(true);
    // Firing the POST would only arm an abort at 0ms; the relay still runs on its floor because the
    // intent tx has already landed on-chain.
    expect(submitSpy).not.toHaveBeenCalled();
    expect(mocks.relayTxAndWaitPacket.mock.calls.at(-1)?.[0]?.timeout).toBe(RELAY_FALLBACK_FLOOR_MS);
  });

  it('treats a non-finite caller timeout as the default rather than stranding the broadcast tx', async () => {
    stubCreatedAndVerified(ChainKeys.BSC_MAINNET);
    const submitSpy = vi.spyOn(sodaxBE.api.swaps, 'submitTx').mockResolvedValueOnce({
      ok: false,
      error: new SodaxError('EXTERNAL_API_ERROR', 'rejected', { feature: 'backend' }),
    });
    mocks.relayTxAndWaitPacket.mockResolvedValueOnce({ ok: true, value: { dst_tx_hash: '0xFALLBACKDST' } });
    mocks.solverPostExecution.mockResolvedValueOnce({ ok: true, value: { answer: 'OK' } });

    // `Number(process.env.SWAP_TIMEOUT)` with the var unset. `?? DEFAULT` does not catch NaN, and an
    // unresolved NaN would skip the POST entirely and hand the relay `Math.max(NaN, floor)` = NaN,
    // which `waitUntilIntentExecuted` reads as an already-expired budget: RELAY_TIMEOUT in
    // milliseconds on an intent tx that is live on-chain.
    const result = await sodaxBE.swaps.swap({
      params: intentInput(ChainKeys.BSC_MAINNET),
      raw: false,
      walletProvider: mockEvmProvider,
      timeout: Number.NaN,
    });

    expect(result.ok).toBe(true);
    expect(submitSpy).toHaveBeenCalledOnce();
    expect(submitSpy.mock.calls[0]?.[1]).toEqual({ timeout: DEFAULT_BACKEND_API_TIMEOUT });
    expect(mocks.relayTxAndWaitPacket.mock.calls.at(-1)?.[0]?.timeout).toBe(DEFAULT_RELAY_TX_TIMEOUT);
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

  const runKeyedSwap = async (extras?: { apiKey?: string }) => {
    stubKeyedCreated();
    const args = {
      params: intentInput(ChainKeys.BSC_MAINNET),
      raw: false as const,
      walletProvider: mockEvmProvider,
    };
    const result = await sodaxKeyed.swaps.swap(extras ? { ...args, extras } : args);
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

  it('sends the instance key on both requests when extras is omitted', async () => {
    await runKeyedSwap();
    expect(keySentTo('/v1/swaps/submit-tx', 'POST')).toBe('instance-key');
    expect(keySentTo('/v1/swaps/submit-tx/status', 'GET')).toBe('instance-key');
  });

  it('treats an empty extras.apiKey as unset: the instance key still rides both requests', async () => {
    await runKeyedSwap({ apiKey: '' });
    expect(keySentTo('/v1/swaps/submit-tx', 'POST')).toBe('instance-key');
    expect(keySentTo('/v1/swaps/submit-tx/status', 'GET')).toBe('instance-key');
  });
});

// =========================================================================
// buildApproveTxs: the unsigned entry point the swaps API calls. The only logic this layer owns
// is resolving the spender, so that is what is asserted — the ordering of the plan itself is
// covered in SpokeService.test.ts.
// =========================================================================

describe('SwapService.buildApproveTxs', () => {
  const rawTx = { from: '0x1111111111111111111111111111111111111111', to: '0x0', value: 0n, data: '0x' };

  it('approves the intents contract on the hub (Sonic)', async () => {
    const svc = sodax.swaps;
    vi.spyOn(svc.spoke, 'buildApproveTxs').mockResolvedValueOnce({ ok: true, value: { approveTx: rawTx } });

    const result = await svc.buildApproveTxs({ params: intentInput(ChainKeys.SONIC_MAINNET), raw: true });

    expect(result).toEqual({ ok: true, value: { approveTx: rawTx } });
    expect(svc.spoke.buildApproveTxs).toHaveBeenCalledWith(
      expect.objectContaining({ srcChainKey: ChainKeys.SONIC_MAINNET, spender: intentsContract, raw: true }),
    );
  });

  it('approves the asset manager on an EVM spoke', async () => {
    const svc = sodax.swaps;
    vi.spyOn(svc.spoke, 'buildApproveTxs').mockResolvedValueOnce({ ok: true, value: { approveTx: rawTx } });

    const result = await svc.buildApproveTxs({ params: intentInput(ChainKeys.BSC_MAINNET), raw: true });

    expect(result).toEqual({ ok: true, value: { approveTx: rawTx } });
    expect(svc.spoke.buildApproveTxs).toHaveBeenCalledWith(
      expect.objectContaining({
        srcChainKey: ChainKeys.BSC_MAINNET,
        spender: spokeChainConfig[ChainKeys.BSC_MAINNET].addresses.assetManager,
        raw: true,
      }),
    );
  });

  it('passes the intent amount and token through as the approval target', async () => {
    const svc = sodax.swaps;
    const params = intentInput(ChainKeys.BSC_MAINNET);
    vi.spyOn(svc.spoke, 'buildApproveTxs').mockResolvedValueOnce({ ok: true, value: { approveTx: rawTx } });

    await svc.buildApproveTxs({ params, raw: true });

    expect(svc.spoke.buildApproveTxs).toHaveBeenCalledWith(
      expect.objectContaining({ token: params.inputToken, amount: params.inputAmount, owner: params.srcAddress }),
    );
  });

  it('surfaces the reset under its own name when the plan needs one', async () => {
    const svc = sodax.swaps;
    const resetTx = { ...(rawTx as object), data: '0xreset' };
    vi.spyOn(svc.spoke, 'buildApproveTxs').mockResolvedValueOnce({ ok: true, value: { resetTx, approveTx: rawTx } });

    const result = await svc.buildApproveTxs({ params: intentInput(ChainKeys.BSC_MAINNET), raw: true });

    // Named, not ordered: no consumer has to know which index is which.
    expect(result).toEqual({ ok: true, value: { resetTx, approveTx: rawTx } });
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
    it('needs no approval when the allowance already suffices, without asking the wallet', async () => {
      allowance(true);
      const wallet = makeBatchProvider();

      const result = await sodax.swaps.getApprovalStrategy({
        params: intentInput(ChainKeys.BSC_MAINNET),
        walletProvider: wallet,
      });

      expect(result).toEqual({ ok: true, value: 'not-required' });
      expect(wallet.getAtomicBatchSupport).not.toHaveBeenCalled();
    });

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

    it.each(['supported', 'ready'] as const)('batches on an EVM spoke when the wallet reports %s', async support => {
      allowance(false);
      const wallet = makeBatchProvider(support);

      const result = await sodax.swaps.getApprovalStrategy({
        params: intentInput(ChainKeys.BSC_MAINNET),
        walletProvider: wallet,
      });

      expect(result).toEqual({ ok: true, value: 'atomic-batch' });
      expect(wallet.getAtomicBatchSupport).toHaveBeenCalledWith(56);
    });

    it.each([
      ['ready', 'sequential'],
      ['supported', 'atomic-batch'],
    ] as const)('with allowAccountUpgrade: false, a %s wallet gets %s', async (support, expected) => {
      allowance(false);
      const result = await sodax.swaps.getApprovalStrategy({
        params: intentInput(ChainKeys.BSC_MAINNET),
        walletProvider: makeBatchProvider(support),
        allowAccountUpgrade: false,
      });
      expect(result).toEqual({ ok: true, value: expected });
    });

    it('goes sequential when the wallet reports unsupported', async () => {
      allowance(false);
      const result = await sodax.swaps.getApprovalStrategy({
        params: intentInput(ChainKeys.BSC_MAINNET),
        walletProvider: makeBatchProvider('unsupported'),
      });
      expect(result).toEqual({ ok: true, value: 'sequential' });
    });

    it('goes sequential for a provider without the EIP-5792 methods', async () => {
      allowance(false);
      const result = await sodax.swaps.getApprovalStrategy({
        params: intentInput(ChainKeys.BSC_MAINNET),
        walletProvider: mockEvmProvider,
      });
      expect(result).toEqual({ ok: true, value: 'sequential' });
    });

    it('goes sequential when the capability read throws', async () => {
      allowance(false);
      const wallet = makeBatchProvider();
      wallet.getAtomicBatchSupport.mockRejectedValueOnce(new Error('Method not found'));

      const result = await sodax.swaps.getApprovalStrategy({
        params: intentInput(ChainKeys.BSC_MAINNET),
        walletProvider: wallet,
      });

      expect(result).toEqual({ ok: true, value: 'sequential' });
    });

    it('keeps the Sonic hub sequential even for a batch-capable wallet', async () => {
      allowance(false);
      const wallet = makeBatchProvider('supported');

      const result = await sodax.swaps.getApprovalStrategy({
        params: intentInput(ChainKeys.SONIC_MAINNET),
        walletProvider: wallet,
      });

      expect(result).toEqual({ ok: true, value: 'sequential' });
      expect(wallet.getAtomicBatchSupport).not.toHaveBeenCalled();
    });

    it('needs no approval for a non-EVM source without an allowance, like Solana', async () => {
      const result = await sodax.swaps.getApprovalStrategy({
        params: intentInput(ChainKeys.SOLANA_MAINNET),
        walletProvider: mockSolanaProvider,
      });
      expect(result).toEqual({ ok: true, value: 'not-required' });
    });

    it('goes sequential for a Stellar source that needs a trustline', async () => {
      allowance(false);
      const result = await sodax.swaps.getApprovalStrategy({
        params: intentInput(ChainKeys.STELLAR_MAINNET),
        walletProvider: mockStellarProvider,
      });
      expect(result).toEqual({ ok: true, value: 'sequential' });
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

    it.each([
      ['a rejected batch', new UserRejectedRequestError(new Error('User rejected the request.')), undefined],
      [
        'a declined account upgrade (5750)',
        new AtomicReadyWalletRejectedUpgradeError(new Error('declined')),
        ACCOUNT_UPGRADE_DECLINED,
      ],
    ])('returns USER_REJECTED for %s and never falls back to separate transactions', async (_label, rejection, reason) => {
      allowance(false);
      const wallet = makeBatchProvider();
      wallet.sendAtomicBatch.mockRejectedValueOnce(rejection);
      vi.spyOn(sodax.swaps, 'buildApproveTxs').mockResolvedValueOnce({ ok: true, value: { approveTx: RAW_APPROVE } });
      vi.spyOn(sodax.swaps, 'createIntent').mockResolvedValueOnce(intentResult(RAW_DEPOSIT));
      const approveSpy = vi.spyOn(sodax.swaps, 'approve');

      const result = await swapWithBatch(wallet);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('USER_REJECTED');
        expect(result.error.context?.reason).toBe(reason);
      }
      expect(approveSpy).not.toHaveBeenCalled();
      expect(wallet.sendTransaction).not.toHaveBeenCalled();
      expect(mocks.relayTxAndWaitPacket).not.toHaveBeenCalled();
    });

    it('reports a batch that did not succeed as INTENT_CREATION_FAILED with the batch id', async () => {
      allowance(false);
      const wallet = makeBatchProvider();
      wallet.waitForBatch.mockResolvedValueOnce({ status: 'failure', statusCode: 500, atomic: true, receipts: [] });
      vi.spyOn(sodax.swaps, 'buildApproveTxs').mockResolvedValueOnce({ ok: true, value: { approveTx: RAW_APPROVE } });
      vi.spyOn(sodax.swaps, 'createIntent').mockResolvedValueOnce(intentResult(RAW_DEPOSIT));

      const result = await swapWithBatch(wallet);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('INTENT_CREATION_FAILED');
        expect(result.error.context).toMatchObject({
          reason: 'atomic-batch-failed',
          batchId: 'batch-1',
          statusCode: 500,
          approvalStrategy: 'atomic-batch',
        });
      }
      expect(mocks.relayTxAndWaitPacket).not.toHaveBeenCalled();
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

    it('treats a successful batch without a deposit receipt as unconfirmed', async () => {
      allowance(false);
      const wallet = makeBatchProvider();
      wallet.waitForBatch.mockResolvedValueOnce({ status: 'success', statusCode: 200, atomic: true, receipts: [] });
      vi.spyOn(sodax.swaps, 'buildApproveTxs').mockResolvedValueOnce({ ok: true, value: { approveTx: RAW_APPROVE } });
      vi.spyOn(sodax.swaps, 'createIntent').mockResolvedValueOnce(intentResult(RAW_DEPOSIT));

      const result = await swapWithBatch(wallet);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('TX_VERIFICATION_FAILED');
        expect(result.error.context?.reason).toBe(ATOMIC_BATCH_UNCONFIRMED);
      }
    });

    it("gives the wait the caller's timeout when it is above the default", async () => {
      allowance(false);
      const wallet = makeBatchProvider();
      vi.spyOn(sodax.swaps, 'buildApproveTxs').mockResolvedValueOnce({ ok: true, value: { approveTx: RAW_APPROVE } });
      vi.spyOn(sodax.swaps, 'createIntent').mockResolvedValueOnce(intentResult(RAW_DEPOSIT));
      stubRelayAndSolver();

      await sodax.swaps.swapWithApproval({
        params: intentInput(ChainKeys.BSC_MAINNET),
        walletProvider: wallet,
        timeout: 300_000,
      });

      expect(wallet.waitForBatch).toHaveBeenCalledWith('batch-1', { timeout: 300_000 });
    });

    const stubBatchLegs = () => {
      vi.spyOn(sodax.swaps, 'buildApproveTxs').mockResolvedValueOnce({ ok: true, value: { approveTx: RAW_APPROVE } });
      vi.spyOn(sodax.swaps, 'createIntent').mockResolvedValueOnce(intentResult(RAW_DEPOSIT));
    };

    // A short relay timeout must not cut the batch wait short: that reports a landing batch as unconfirmed.
    it('never waits less than the default for the batch, even on a zero timeout', async () => {
      allowance(false);
      const wallet = makeBatchProvider();
      stubBatchLegs();
      stubRelayAndSolver();

      await sodax.swaps.swapWithApproval({
        params: intentInput(ChainKeys.BSC_MAINNET),
        walletProvider: wallet,
        timeout: 0,
      });

      expect(wallet.waitForBatch).toHaveBeenCalledWith('batch-1', { timeout: DEFAULT_RELAY_TX_TIMEOUT });
    });

    it.each([
      ['a partial revert (600)', { status: 'failure', statusCode: 600, atomic: true, receipts: [] }],
      [
        'a confirmed batch whose deposit receipt reverted',
        { ...confirmedBatch, receipts: [{ transactionHash: '0xbatchTx', status: 'reverted' }] },
      ],
      [
        'receipts that match neither one tx nor one per call',
        {
          ...confirmedBatch,
          receipts: [
            { transactionHash: '0xa', status: 'success' },
            { transactionHash: '0xb', status: 'success' },
            { transactionHash: '0xc', status: 'success' },
          ],
        },
      ],
    ] satisfies [
      string,
      EvmBatchResult,
    ][])('reports %s as unconfirmed, never as nothing sent', async (_label, batch) => {
      allowance(false);
      const wallet = makeBatchProvider();
      wallet.waitForBatch.mockResolvedValueOnce(batch);
      stubBatchLegs();

      const result = await swapWithBatch(wallet);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('TX_VERIFICATION_FAILED');
        expect(result.error.context).toMatchObject({ reason: ATOMIC_BATCH_UNCONFIRMED, batchId: 'batch-1' });
      }
      expect(mocks.relayTxAndWaitPacket).not.toHaveBeenCalled();
    });

    it('relays the deposit receipt when the wallet returns one receipt per call', async () => {
      allowance(false);
      const wallet = makeBatchProvider();
      wallet.waitForBatch.mockResolvedValueOnce({
        ...confirmedBatch,
        receipts: [
          { transactionHash: '0xapproveTx', status: 'success' },
          { transactionHash: '0xdepositTx', status: 'success' },
        ],
      });
      stubBatchLegs();
      stubRelayAndSolver();

      const result = await swapWithBatch(wallet);

      expect(result.ok).toBe(true);
      expect(mocks.relayTxAndWaitPacket.mock.calls[0]?.[0].srcTxHash).toBe('0xdepositTx');
    });

    it('relays a batch whose receipts are all one tx, even with a call the wallet added', async () => {
      allowance(false);
      const wallet = makeBatchProvider();
      wallet.waitForBatch.mockResolvedValueOnce({
        ...confirmedBatch,
        receipts: [
          { transactionHash: '0xbatchTx', status: 'success' },
          { transactionHash: '0xbatchTx', status: 'success' },
          { transactionHash: '0xbatchTx', status: 'success' },
        ],
      });
      stubBatchLegs();
      stubRelayAndSolver();

      const result = await swapWithBatch(wallet);

      expect(result.ok).toBe(true);
      expect(mocks.relayTxAndWaitPacket.mock.calls[0]?.[0].srcTxHash).toBe('0xbatchTx');
    });

    it.each([
      ['a generic RPC error', { code: -32603, message: 'Internal error' }],
      ['a plain error', new Error('connection lost')],
      [
        'a rejection that also carries a refusal code in its cause',
        Object.assign(new Error('User rejected the request.'), { code: 4001, cause: { code: 5760 } }),
      ],
    ])('never approves separately after %s from the batch', async (_label, error) => {
      allowance(false);
      const wallet = makeBatchProvider('supported');
      wallet.sendAtomicBatch.mockRejectedValueOnce(error);
      stubBatchLegs();
      const approveSpy = vi.spyOn(sodax.swaps, 'approve');

      const result = await swapWithBatch(wallet);

      expect(result.ok).toBe(false);
      expect(approveSpy).not.toHaveBeenCalled();
      expect(wallet.sendTransaction).not.toHaveBeenCalled();
      expect(mocks.relayTxAndWaitPacket).not.toHaveBeenCalled();
    });

    it.each([
      4200, -32601, 5700, 5710, 5740, 5760,
    ])('approves separately when a ready wallet refuses the batch with %i', async code => {
      allowance(false);
      const wallet = makeBatchProvider('ready');
      wallet.sendAtomicBatch.mockRejectedValueOnce({ code, message: 'refused' });
      stubBatchLegs();
      const approveSpy = vi.spyOn(sodax.swaps, 'approve').mockResolvedValueOnce({ ok: true, value: '0xapproveTx' });
      vi.spyOn(sodax.spoke, 'waitForTxReceipt').mockResolvedValueOnce({
        ok: true,
        value: { status: 'success', receipt: {} as never },
      });
      vi.spyOn(sodax.swaps, 'createIntent').mockResolvedValueOnce(intentResult('0xspokeTx'));
      stubRelayAndSolver();

      const result = await swapWithBatch(wallet);

      expect(result.ok).toBe(true);
      if (result.ok) expect(result.value.approvalStrategy).toBe('sequential');
      expect(approveSpy).toHaveBeenCalledOnce();
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
    const resume = (wallet: ReturnType<typeof makeBatchProvider>, resumeBatchCallCount?: number) =>
      sodax.swaps.swapWithApproval({
        params: intentInput(ChainKeys.BSC_MAINNET),
        walletProvider: wallet,
        resumeBatchId: 'batch-1',
        resumeBatchCallCount,
      });
    const perCallReceipts: EvmBatchResult = {
      ...confirmedBatch,
      receipts: [
        { transactionHash: '0xapproveTx', status: 'success' },
        { transactionHash: '0xdepositTx', status: 'success' },
      ],
    };

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

    it('skips the approval strategy and the submit-tx backend', async () => {
      const wallet = makeBatchProvider();
      const backendOn = new Sodax({ logger: 'silent', swaps: { useBackendSubmitTx: true } });
      const allowanceSpy = vi.spyOn(backendOn.swaps, 'isAllowanceValid');
      const submitSpy = vi.spyOn(backendOn.api.swaps, 'submitTx');
      mocks.getIntent.mockResolvedValueOnce(makeIntent(ChainKeys.BSC_MAINNET));
      stubResumeRelay();

      const result = await backendOn.swaps.swapWithApproval({
        params: intentInput(ChainKeys.BSC_MAINNET),
        walletProvider: wallet,
        resumeBatchId: 'batch-1',
      });

      expect(result.ok).toBe(true);
      expect(allowanceSpy).not.toHaveBeenCalled();
      expect(wallet.getAtomicBatchSupport).not.toHaveBeenCalled();
      expect(submitSpy).not.toHaveBeenCalled();
    });

    it('stays unconfirmed while the batch is still pending, keeping the call count for the next try', async () => {
      const wallet = makeBatchProvider();
      wallet.waitForBatch.mockRejectedValueOnce(new Error('Timed out while waiting for call bundle'));

      const result = await resume(wallet, 2);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('TX_VERIFICATION_FAILED');
        expect(result.error.context).toMatchObject({
          reason: ATOMIC_BATCH_UNCONFIRMED,
          batchId: 'batch-1',
          callCount: 2,
        });
      }
      expect(wallet.sendAtomicBatch).not.toHaveBeenCalled();
      expect(mocks.relayTxAndWaitPacket).not.toHaveBeenCalled();
    });

    it('relays the deposit of a late batch confirmed as one tx per call, given the call count', async () => {
      const wallet = makeBatchProvider();
      wallet.waitForBatch.mockResolvedValueOnce(perCallReceipts);
      mocks.getIntent.mockResolvedValueOnce(makeIntent(ChainKeys.BSC_MAINNET));
      stubResumeRelay();

      const result = await resume(wallet, 2);

      expect(result.ok).toBe(true);
      expect(mocks.relayTxAndWaitPacket.mock.calls[0]?.[0]).toMatchObject({ srcTxHash: '0xdepositTx' });
    });

    it('keeps a batch confirmed as one tx per call unconfirmed without the call count', async () => {
      const wallet = makeBatchProvider();
      wallet.waitForBatch.mockResolvedValueOnce(perCallReceipts);

      const result = await resume(wallet);

      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.context?.reason).toBe(ATOMIC_BATCH_UNCONFIRMED);
      expect(mocks.relayTxAndWaitPacket).not.toHaveBeenCalled();
    });

    it('never waits less than the default for the batch, even on a zero timeout', async () => {
      const wallet = makeBatchProvider();
      wallet.waitForBatch.mockRejectedValueOnce(new Error('Timed out while waiting for call bundle'));

      await sodax.swaps.swapWithApproval({
        params: intentInput(ChainKeys.BSC_MAINNET),
        walletProvider: wallet,
        resumeBatchId: 'batch-1',
        timeout: 0,
      });

      expect(wallet.waitForBatch).toHaveBeenCalledWith('batch-1', { timeout: DEFAULT_RELAY_TX_TIMEOUT });
    });

    it('reports a batch that never landed as atomic-batch-failed', async () => {
      const wallet = makeBatchProvider();
      wallet.waitForBatch.mockResolvedValueOnce({ status: 'failure', statusCode: 400, atomic: true, receipts: [] });

      const result = await resume(wallet);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('INTENT_CREATION_FAILED');
        expect(result.error.context).toMatchObject({ reason: 'atomic-batch-failed', batchId: 'batch-1' });
      }
      expect(mocks.relayTxAndWaitPacket).not.toHaveBeenCalled();
    });

    it('keeps the deposit tx on a relay failure, so its status can still be read', async () => {
      const wallet = makeBatchProvider();
      mocks.relayTxAndWaitPacket.mockResolvedValueOnce({ ok: false, error: new Error('RELAY_TIMEOUT') });

      const result = await resume(wallet);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('RELAY_TIMEOUT');
        expect(result.error.context?.srcTxHash).toBe('0xbatchTx');
      }
      expect(mocks.solverPostExecution).not.toHaveBeenCalled();
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
    it('approves separately on a ready wallet when allowAccountUpgrade is false', async () => {
      allowance(false);
      const wallet = makeBatchProvider('ready');
      vi.spyOn(sodax.swaps, 'approve').mockResolvedValueOnce({ ok: true, value: '0xapproveTx' });
      vi.spyOn(sodax.spoke, 'waitForTxReceipt').mockResolvedValueOnce({
        ok: true,
        value: { status: 'success', receipt: {} as never },
      });
      vi.spyOn(sodax.swaps, 'createIntent')
        .mockResolvedValueOnce(intentResult(RAW_DEPOSIT))
        .mockResolvedValueOnce(intentResult('0xspokeTx'));
      stubRelayAndSolver();

      const result = await sodax.swaps.swapWithApproval({
        params: intentInput(ChainKeys.BSC_MAINNET),
        walletProvider: wallet,
        allowAccountUpgrade: false,
      });

      expect(result.ok).toBe(true);
      if (result.ok) expect(result.value.approvalStrategy).toBe('sequential');
      expect(wallet.sendAtomicBatch).not.toHaveBeenCalled();
    });

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

    it('stops at a rejected approval', async () => {
      allowance(false);
      vi.spyOn(sodax.swaps, 'approve').mockResolvedValueOnce({
        ok: false,
        error: new SodaxError('USER_REJECTED', 'User rejected the request', { feature: 'swap' }),
      });
      const createSpy = vi.spyOn(sodax.swaps, 'createIntent').mockResolvedValueOnce(intentResult(RAW_DEPOSIT));

      const result = await sodax.swaps.swapWithApproval({
        params: intentInput(ChainKeys.BSC_MAINNET),
        walletProvider: mockEvmProvider,
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('USER_REJECTED');
        expect(result.error.context).toMatchObject({ action: 'swapWithApproval', approvalStrategy: 'sequential' });
      }
      // Only the unsigned preflight build ran; nothing was sent after the rejected approval.
      expect(createSpy).toHaveBeenCalledOnce();
      expect(createSpy).toHaveBeenCalledWith(expect.objectContaining({ raw: true }));
    });

    it('stops at an approval that did not confirm', async () => {
      allowance(false);
      vi.spyOn(sodax.swaps, 'approve').mockResolvedValueOnce({ ok: true, value: '0xapproveTx' });
      vi.spyOn(sodax.spoke, 'waitForTxReceipt').mockResolvedValueOnce({
        ok: true,
        value: { status: 'failure', error: new Error('reverted') },
      });
      const createSpy = vi.spyOn(sodax.swaps, 'createIntent').mockResolvedValueOnce(intentResult(RAW_DEPOSIT));

      const result = await sodax.swaps.swapWithApproval({
        params: intentInput(ChainKeys.BSC_MAINNET),
        walletProvider: mockEvmProvider,
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('APPROVE_FAILED');
        expect(result.error.context).toMatchObject({ reason: 'approve-not-confirmed', approveTxHash: '0xapproveTx' });
      }
      expect(createSpy).toHaveBeenCalledOnce();
      expect(createSpy).toHaveBeenCalledWith(expect.objectContaining({ raw: true }));
    });

    it('creates the intent directly when no approval is needed', async () => {
      allowance(true);
      const approveSpy = vi.spyOn(sodax.swaps, 'approve');
      const createSpy = vi.spyOn(sodax.swaps, 'createIntent').mockResolvedValueOnce(intentResult('0xspokeTx'));
      stubRelayAndSolver();

      const result = await sodax.swaps.swapWithApproval({
        params: intentInput(ChainKeys.BSC_MAINNET),
        walletProvider: mockEvmProvider,
      });

      expect(result.ok).toBe(true);
      if (result.ok) expect(result.value.approvalStrategy).toBe('not-required');
      expect(approveSpy).not.toHaveBeenCalled();
      expect(createSpy).toHaveBeenCalledWith(expect.objectContaining({ walletProvider: mockEvmProvider }));
    });

    it('leaves swap() alone: it never reads or sends batches', async () => {
      const wallet = makeBatchProvider('supported');
      vi.spyOn(sodax.swaps, 'createIntent').mockResolvedValueOnce(intentResult('0xspokeTx'));
      stubRelayAndSolver();

      await sodax.swaps.swap({ params: intentInput(ChainKeys.BSC_MAINNET), walletProvider: wallet });

      expect(wallet.getAtomicBatchSupport).not.toHaveBeenCalled();
      expect(wallet.sendAtomicBatch).not.toHaveBeenCalled();
    });
  });

  it('tracks swapWithApproval as its own action, with the strategy that ran', async () => {
    const events: AnalyticsEvent[] = [];
    const tracked = new Sodax({
      logger: 'silent',
      swaps: { useBackendSubmitTx: false },
      analytics: { tracker: event => void events.push(event) },
    });
    vi.spyOn(tracked.swaps, 'isAllowanceValid').mockResolvedValue({ ok: true, value: true });
    vi.spyOn(tracked.swaps, 'createIntent').mockResolvedValueOnce(intentResult('0xspokeTx'));
    vi.spyOn(tracked.spoke, 'verifyTxHash').mockResolvedValue({ ok: true, value: true });
    stubRelayAndSolver();

    await tracked.swaps.swapWithApproval({
      params: intentInput(ChainKeys.BSC_MAINNET),
      walletProvider: mockEvmProvider,
    });

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
  it('routes swap() to the client-side relay for a legacy swapsOptions opt-out', async () => {
    const legacy = new Sodax({ logger: 'silent', swapsOptions: { useBackendSubmitTx: false } });
    const intent = makeIntent(ChainKeys.BSC_MAINNET);
    vi.spyOn(legacy.swaps, 'createIntent').mockResolvedValueOnce({
      ok: true,
      value: {
        tx: '0xspokeTx',
        intent: { ...intent, feeAmount: 0n },
        relayData: { address: intent.creator, payload: '0xpay' },
      },
    });
    vi.spyOn(legacy.spoke, 'verifyTxHash').mockResolvedValue({ ok: true, value: true });
    const submitSpy = vi.spyOn(legacy.api.swaps, 'submitTx');
    mocks.relayTxAndWaitPacket.mockResolvedValueOnce({ ok: true, value: { dst_tx_hash: '0xdstTx' } });
    mocks.solverPostExecution.mockResolvedValueOnce({ ok: true, value: { answer: 'OK' } });

    const result = await legacy.swaps.swap({
      params: intentInput(ChainKeys.BSC_MAINNET),
      raw: false,
      walletProvider: mockEvmProvider,
    });

    expect(result.ok).toBe(true);
    expect(submitSpy).not.toHaveBeenCalled();
    expect(mocks.relayTxAndWaitPacket).toHaveBeenCalledOnce();
  });

  it('gives swaps.useBackendSubmitTx precedence over swapsOptions in both directions', () => {
    expect(
      new Sodax({ swaps: { useBackendSubmitTx: false }, swapsOptions: { useBackendSubmitTx: true } }).swaps
        .useBackendSubmitTx,
    ).toBe(false);
    expect(
      new Sodax({ swaps: { useBackendSubmitTx: true }, swapsOptions: { useBackendSubmitTx: false } }).swaps
        .useBackendSubmitTx,
    ).toBe(true);
  });

  it('honours the deprecated constructor flag over the configured value', () => {
    const configured = new Sodax();
    const deps = {
      config: configured.config,
      spoke: configured.spoke,
      hubProvider: configured.hubProvider,
      backendApi: configured.swaps.backendApi,
    };

    expect(new SwapService({ ...deps, useBackendSubmitTx: false }).useBackendSubmitTx).toBe(false);
    expect(new SwapService(deps).useBackendSubmitTx).toBe(true);
  });

  it('keeps the deprecated types assignable', () => {
    expectTypeOf<SwapsClientOptions>().toEqualTypeOf<NonNullable<SodaxOptions['swapsOptions']>>();
    expectTypeOf<SwapServiceConstructorParams['useBackendSubmitTx']>().toEqualTypeOf<boolean | undefined>();
  });
});
