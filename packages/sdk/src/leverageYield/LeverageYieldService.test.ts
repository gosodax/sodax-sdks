/**
 * Tests for LeverageYieldService.
 *
 * Two layers of coverage:
 *  - Pure / builder surface: the static vault registry, and the `deposit` / `withdraw`
 *    intent builders that produce a `LeverageYieldSwapPayload`.
 *  - Orchestration + reads (mocked collaborators): `createVaultIntent`'s three branches
 *    (hub-wallet sendMessage, Sonic-direct, EVM-spoke deposit), the `vaultSwap` lifecycle
 *    (verify → relay → notify-solver, plus error mapping), `approve` / `isAllowanceValid`,
 *    the steady-state APR math (`getApr` / `getEffectiveApr` / `getLsdApr`, including the
 *    inverted-spread case and the `targetLTV < 100%` basis-points invariant), and the
 *    `getMaxWithdrawForUser` dust-buffer clamp.
 *
 * Collaborator mocking mirrors `src/swap/SwapService.test.ts`: instance methods on the live
 * `new Sodax()` graph are stubbed with `vi.spyOn`; static / module-level collaborators are
 * replaced via `vi.hoisted` + `vi.mock` of their source leaf modules.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  AtomicityNotSupportedError,
  decodeAbiParameters,
  decodeFunctionData,
  parseAbi,
  type Address,
  type Hex,
} from 'viem';
import { tronSupportedTokens, xrpSupportedTokens } from '@sodax/types';
// Import the barrel by relative path, not as `@sodax/sdk`. A self-referential package import
// resolves through `package.json#exports` into `dist/`, which makes this unit test depend on a
// build artifact — it then fails to resolve whenever `dist/` is absent or half-written, and turbo
// can cache that state. Every other test in this package imports `../index.js`; keep it that way.
import {
  ChainKeys,
  DEFAULT_BACKEND_API_TIMEOUT,
  DEFAULT_RELAY_TX_TIMEOUT,
  getIntentRelayChainId,
  type IBitcoinWalletProvider,
  type IEvmWalletProvider,
  type IntentResponse,
  type EvmAtomicBatchSupport,
  type EvmBatchResult,
  type EvmRawTransaction,
  ATOMIC_BATCH_UNCONFIRMED,
  isAuthFailure,
  isSodaxError,
  MAX_POSITION_FEE_BPS,
  SolverIntentStatusCode,
  type PartnerFee,
  DETAILED_STATUS_NOT_DELIVERED,
  RELAY_FALLBACK_FLOOR_MS,
  type Result,
  type SodaxOptions,
  type SpokeChainKey,
  type SubmitTxStatusDataV2,
  type SubmitTxStatusResponseV2,
} from '../index.js';
import type { CreateIntentParams, Intent } from '../shared/types/intent-types.js';
import { SodaxError } from '../errors/SodaxError.js';

// ── Module mocks for static / module-level collaborators (mirrors SwapService.test.ts) ──
// LeverageYieldService reaches these as static imports — via the `../shared/index.js` barrel
// (SonicSpokeService, relayTxAndWaitPacket, Erc20Service, Erc4626Service) or directly
// (`../swap/*`). A direct `vi.spyOn(Foo, ...)` through the barrel is unreliable, so we mock
// the *source* leaf modules; vitest hoists `vi.mock`, and the barrel re-exports resolve to
// the mocked modules.
const mocks = vi.hoisted(() => ({
  getUserHubWalletAddress: vi.fn(),
  constructCreateIntentData: vi.fn(),
  sonicCreateSwapIntent: vi.fn(),
  relayTxAndWaitPacket: vi.fn(),
  submitTransaction: vi.fn(),
  waitUntilIntentExecuted: vi.fn(),
  getIntent: vi.fn(),
  solverPostExecution: vi.fn(),
  solverGetQuote: vi.fn(),
  solverGetStatus: vi.fn(),
  getTransactionPackets: vi.fn(),
  erc20Approve: vi.fn(),
  erc20PlanApproval: vi.fn(),
  erc4626GetMaxWithdraw: vi.fn(),
  erc4626GetTotalAssets: vi.fn(),
  erc4626PreviewDeposit: vi.fn(),
  erc4626PreviewWithdraw: vi.fn(),
  erc4626PreviewRedeem: vi.fn(),
}));
// SonicSpokeService is instantiated by EvmHubProvider AND used statically — mock as a class.
vi.mock('../shared/services/spoke/SonicSpokeService.js', () => {
  class SonicSpokeService {
    static createSwapIntent = mocks.sonicCreateSwapIntent;
  }
  return { SonicSpokeService };
});
vi.mock('../swap/EvmSolverService.js', () => ({
  EvmSolverService: { constructCreateIntentData: mocks.constructCreateIntentData, getIntent: mocks.getIntent },
}));
vi.mock('../swap/SolverApiService.js', () => ({
  SolverApiService: {
    postExecution: mocks.solverPostExecution,
    getQuote: mocks.solverGetQuote,
    getStatus: mocks.solverGetStatus,
  },
}));
vi.mock('../shared/services/intentRelay/IntentRelayApiService.js', async () => {
  const actual = await vi.importActual<object>('../shared/services/intentRelay/IntentRelayApiService.js');
  // `HttpRelayError` stays real — `resolveDeliveredPacket` classifies a relay 404 with `instanceof`.
  return {
    ...actual,
    relayTxAndWaitPacket: mocks.relayTxAndWaitPacket,
    getTransactionPackets: mocks.getTransactionPackets,
    submitTransaction: mocks.submitTransaction,
    waitUntilIntentExecuted: mocks.waitUntilIntentExecuted,
  };
});
vi.mock('../shared/services/erc-20/Erc20Service.js', async () => {
  const actual = await vi.importActual<typeof import('../shared/services/erc-20/Erc20Service.js')>(
    '../shared/services/erc-20/Erc20Service.js',
  );
  return {
    ...actual,
    Erc20Service: {
      approve: mocks.erc20Approve,
      planApproval: mocks.erc20PlanApproval,
      // Left real: the position payload builders encode approvals and the funding transfer into the
      // batch the hub wallet executes, and asserting that batch's shape is the point of those tests.
      encodeApprove: actual.Erc20Service.encodeApprove,
      encodeTransfer: actual.Erc20Service.encodeTransfer,
    },
  };
});
vi.mock('../shared/services/Erc4626Service.js', async () => {
  const actual = await vi.importActual<object>('../shared/services/Erc4626Service.js');
  return {
    ...actual,
    Erc4626Service: {
      getMaxWithdraw: mocks.erc4626GetMaxWithdraw,
      getTotalAssets: mocks.erc4626GetTotalAssets,
      previewDeposit: mocks.erc4626PreviewDeposit,
      previewWithdraw: mocks.erc4626PreviewWithdraw,
      previewRedeem: mocks.erc4626PreviewRedeem,
    },
  };
});
import { Sodax } from '../shared/entities/Sodax.js';
import { TRON_TEST_ADDRESS } from '../shared/services/spoke/tron-test-fixtures.js';

// Pins the CLIENT-SIDE path for every test below that does not opt in explicitly — the shipped
// default is the backend one. Same pattern as `SwapService.test.ts`; without it the client-side
// assertions would be testing a path the SDK no longer takes by default.
const sodax = new Sodax({ leverageYield: { useBackendSubmitTx: false } });
/** Nothing configured at all — what a consumer calling `new Sodax()` actually gets. */
const sodaxDefaults = new Sodax();
const HUB = sodax.hubProvider.chainConfig.chain.key;

const ARBITRUM = ChainKeys.ARBITRUM_MAINNET satisfies SpokeChainKey;
const SONIC = ChainKeys.SONIC_MAINNET satisfies SpokeChainKey;
const SAMPLE_USER = '0x4444444444444444444444444444444444444444' as Address;
const HUB_WALLET = '0x1111111111111111111111111111111111111111' as Address;
const VAULT = '0xD09de2f5070699A909c0FD32fb5A909d3886701D' as Address;
const SODA_ASSET = '0xCb6B152D3a943f25157381aFcA7fEFCD2ef5a357' as Address; // sodaWEETH
const SPOKE_TOKEN = '0x35751007a407ca6FEFfE80b3cB397736D2cf4dbe' as Address; // arb weETH
const POOL = '0x9999999999999999999999999999999999999999' as Address;
const BORROW_TOKEN = '0x8888888888888888888888888888888888888888' as Address; // sodaETH stand-in
const ANY_SOLVER = '0x0000000000000000000000000000000000000000' as Address;
/** Fixed hub block timestamp returned by the `getBlock` stub, so the default deadline is deterministic. */
const HUB_BLOCK_TIMESTAMP = 1_700_000_000n;
/** Mirrors `INTENT_DEADLINE_BUFFER_SECONDS` (5 min) in LeverageYieldService — the default deadline offset. */
const DEADLINE_BUFFER_SECONDS = 5n * 60n;

const RAY = 10n ** 27n;
const WAD = 10n ** 18n;
/** `n` percent expressed in RAY (1e27 = 100%). `pctRay(3)` → `3e25`. */
const pctRay = (n: number): bigint => (BigInt(Math.round(n * 1e9)) * RAY) / 1_000_000_000n / 100n;

// EVM wallet provider fake — exec-mode (raw: false) createVaultIntent / vaultSwap / approve
// need a chain-matched provider; `getWalletAddress` is resolved in beforeEach.
const mockEvmProvider = {
  chainType: 'EVM',
  getWalletAddress: vi.fn(),
  sendTransaction: vi.fn(),
  waitForTransactionReceipt: vi.fn(),
} as unknown as IEvmWalletProvider;

// Bitcoin wallet provider fake — passes the `isBitcoinWalletProviderType` guard (chainType
// discriminator) for the hub-wallet-swap (withdraw) trading-wallet path.
const mockBitcoinProvider = {
  chainType: 'BITCOIN',
  getWalletAddress: vi.fn(),
  signMessage: vi.fn(),
} as unknown as IBitcoinWalletProvider;

/** Intent fixture compatible with createVaultIntent's `{ ...intent, feeAmount }` shape. */
function makeIntent(
  srcChainKey: Parameters<typeof getIntentRelayChainId>[0] = ARBITRUM,
  overrides: Partial<Intent> = {},
): Intent {
  return {
    intentId: 1n,
    creator: HUB_WALLET,
    inputToken: SODA_ASSET,
    outputToken: VAULT,
    inputAmount: 1_000n,
    minOutputAmount: 900n,
    deadline: 0n,
    allowPartialFill: false,
    srcChain: getIntentRelayChainId(srcChainKey),
    dstChain: getIntentRelayChainId(HUB),
    srcAddress: '0x1111111111111111111111111111111111111111',
    dstAddress: '0x2222222222222222222222222222222222222222',
    solver: ANY_SOLVER,
    data: '0x',
    ...overrides,
  };
}

/** Base `CreateIntentParams` for a deposit (any token → lsoda* on the hub). */
const vaultIntentParams = <K extends SpokeChainKey>(
  srcChainKey: K,
  overrides: Partial<CreateIntentParams<K>> = {},
): CreateIntentParams<K> => ({
  inputToken: SPOKE_TOKEN,
  outputToken: VAULT,
  inputAmount: 1_000n,
  minOutputAmount: 900n,
  deadline: 0n,
  allowPartialFill: false,
  srcChainKey,
  dstChainKey: HUB as SpokeChainKey,
  srcAddress: SAMPLE_USER,
  dstAddress: HUB_WALLET,
  solver: ANY_SOLVER,
  data: '0x',
  ...overrides,
});

/**
 * Installs a `publicClient.readContract` dispatcher keyed on `functionName` (and, for the
 * two `getReserveData` reads in `getApr`, on `args[0]` = asset vs borrowToken). Only the
 * fields a given test exercises need to be supplied.
 */
type ReadContractStub = {
  asset?: Address;
  borrowToken?: Address;
  pool?: Address;
  targetLtvBps?: bigint;
  supplyAprRay?: bigint;
  borrowAprRay?: bigint;
  position?: readonly [bigint, bigint, bigint, bigint, bigint];
  balance?: bigint;
  allowance?: bigint;
};
function stubReadContract(cfg: ReadContractStub): void {
  const asset = cfg.asset ?? SODA_ASSET;
  vi.spyOn(sodax.hubProvider.publicClient, 'readContract').mockImplementation(
    async (call: { functionName: string; args?: readonly unknown[] }) => {
      switch (call.functionName) {
        case 'pool':
          return cfg.pool ?? POOL;
        case 'asset':
          return asset;
        case 'borrowToken':
          return cfg.borrowToken ?? BORROW_TOKEN;
        case 'targetLTV':
          return cfg.targetLtvBps;
        case 'getReserveData':
          return call.args?.[0] === asset
            ? { currentLiquidityRate: cfg.supplyAprRay ?? 0n, currentVariableBorrowRate: 0n }
            : { currentLiquidityRate: 0n, currentVariableBorrowRate: cfg.borrowAprRay ?? 0n };
        case 'getPositionDetails':
          return cfg.position;
        case 'balanceOf':
          return cfg.balance;
        case 'allowance':
          return cfg.allowance;
        default:
          throw new Error(`unexpected readContract: ${call.functionName}`);
      }
    },
  );
}

beforeEach(() => {
  // Real config doesn't know our synthetic token/address pairs — stub the validity predicates.
  vi.spyOn(sodax.config, 'isValidOriginalAssetAddress').mockReturnValue(true);
  vi.spyOn(sodax.config, 'isValidSpokeChainKey').mockReturnValue(true);
  vi.spyOn(sodax.spoke, 'verifyTxHash').mockResolvedValue({ ok: true, value: true });
  // The hub branch now WAITS for its own receipt — `verifyTxHash` does not on EVM — so this has to
  // be stubbed or every hub-side position test reaches for a real RPC.
  vi.spyOn(sodax.hubProvider.publicClient, 'waitForTransactionReceipt').mockResolvedValue({
    status: 'success',
  } as never);
  // Bind the hoisted hub-wallet stub to the live instance method, with a sane default.
  vi.spyOn(sodax.hubProvider, 'getUserHubWalletAddress').mockImplementation(mocks.getUserHubWalletAddress);
  mocks.getUserHubWalletAddress.mockResolvedValue(HUB_WALLET);
  (mockEvmProvider.getWalletAddress as ReturnType<typeof vi.fn>).mockResolvedValue(SAMPLE_USER);
  // approve() now routes through SpokeService, which plans the approval first. Default to the
  // ordinary single-transaction plan; the reset case is asserted explicitly.
  mocks.erc20PlanApproval.mockImplementation(async ({ amount }: { amount: bigint }) => ({
    approveAmount: amount,
    reason: 'zero-allowance',
  }));
  // deposit/withdraw default the intent deadline to the hub block timestamp (not the client
  // clock) — stub getBlock so the default resolves deterministically.
  vi.spyOn(sodax.hubProvider.publicClient, 'getBlock').mockResolvedValue({ timestamp: HUB_BLOCK_TIMESTAMP } as never);
});
afterEach(() => {
  // vitest 4: restoreAllMocks only restores `vi.spyOn` spies, so resetAllMocks is what strips
  // the call history and default impls off the hoisted vi.fn()s — both re-applied above.
  vi.resetAllMocks();
  vi.restoreAllMocks();
  // getLsdApr / getEffectiveApr tests stub global `fetch`; clear it so it can't leak.
  vi.unstubAllGlobals();
  // The DefiLlama fallback tests run on fake timers to skip the retry back-off — reset here.
  vi.useRealTimers();
});

// ─── Registry lookups ─────────────────────────────────────────────────────

describe('LeverageYieldService — registry', () => {
  it('lists the @sodax/types registry and looks vaults up by name or case-insensitive address', () => {
    const vaults = sodax.leverageYield.listVaults();
    expect(vaults.length).toBeGreaterThan(0);
    expect(vaults[0]).toMatchObject({ name: 'lsodaWEETH', vault: VAULT, asset: SODA_ASSET });
    expect(sodax.leverageYield.getVault('lsodaWEETH')?.vault).toBe(VAULT);
    expect(sodax.leverageYield.getVault('nonexistent-vault')).toBeUndefined();
    expect(sodax.leverageYield.getVaultByAddress(VAULT.toLowerCase() as Address)?.name).toBe('lsodaWEETH');
    expect(sodax.leverageYield.getVaultByAddress(VAULT.toUpperCase() as Address)?.name).toBe('lsodaWEETH');
    expect(
      sodax.leverageYield.getVaultByAddress('0x0000000000000000000000000000000000000000' as Address),
    ).toBeUndefined();
  });
});

// ─── Swap-intent builders ─────────────────────────────────────────────────

describe('LeverageYieldService.deposit — intent builder', () => {
  it('builds a swap into the vault lsoda* token, delivered to the hub wallet, with no partnerFee key', async () => {
    vi.spyOn(sodax.hubProvider, 'getUserHubWalletAddress').mockResolvedValueOnce(HUB_WALLET);

    const result = await sodax.leverageYield.deposit({
      vault: VAULT,
      srcChainKey: ARBITRUM,
      srcAddress: SAMPLE_USER,
      inputToken: SPOKE_TOKEN,
      inputAmount: 1_000n,
      minOutputAmount: 900n,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.params).toMatchObject({
      inputToken: SPOKE_TOKEN,
      outputToken: VAULT, // the vault address doubles as the lsoda* token
      inputAmount: 1_000n,
      minOutputAmount: 900n,
      srcChainKey: ARBITRUM,
      dstChainKey: sodax.hubProvider.chainConfig.chain.key, // lsoda* lands on the hub
      srcAddress: SAMPLE_USER,
      dstAddress: HUB_WALLET, // delivered to the hub wallet so `withdraw` can spend it
    });
    // Default deadline is derived from the hub block timestamp, not the client clock.
    expect(result.value.params.deadline).toBe(HUB_BLOCK_TIMESTAMP + DEADLINE_BUFFER_SECONDS);
    expect(result.value.hubWalletSwap).toBeUndefined();
    expect('partnerFee' in result.value).toBe(false);
  });

  it('rejects a non-positive inputAmount', async () => {
    const result = await sodax.leverageYield.deposit({
      vault: VAULT,
      srcChainKey: ARBITRUM,
      srcAddress: SAMPLE_USER,
      inputToken: SPOKE_TOKEN,
      inputAmount: 0n,
      minOutputAmount: 0n,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('VALIDATION_FAILED');
    expect(result.error.context?.field).toBe('inputAmount');
  });

  // An MPC-relay vault exit could never settle, so that way in is refused too.
  it('refuses a Bitcoin or MPC-relay source before deriving the hub wallet', async () => {
    const getUserHubWalletAddress = vi.spyOn(sodax.hubProvider, 'getUserHubWalletAddress');

    const bitcoin = await sodax.leverageYield.deposit({
      vault: VAULT,
      srcChainKey: ChainKeys.BITCOIN_MAINNET,
      srcAddress: 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4',
      inputToken: '0:0',
      inputAmount: 1_000n,
      minOutputAmount: 900n,
    });
    const tron = await sodax.leverageYield.deposit({
      vault: VAULT,
      srcChainKey: ChainKeys.TRON_MAINNET,
      srcAddress: TRON_TEST_ADDRESS,
      inputToken: tronSupportedTokens.USDT.address,
      inputAmount: 1_000n,
      minOutputAmount: 900n,
    });

    expect(bitcoin.ok || tron.ok).toBe(false);
    if (bitcoin.ok || tron.ok) return;
    expect(bitcoin.error.code).toBe('VALIDATION_FAILED');
    expect(bitcoin.error.context?.field).toBe('srcChainKey');
    expect(tron.error.code).toBe('VALIDATION_FAILED');
    expect(tron.error.message).toContain('MPC-relay');
    expect(getUserHubWalletAddress).not.toHaveBeenCalled();
  });

  it('surfaces a getBlock RPC failure during default-deadline resolution as LOOKUP_FAILED (method=resolveDeadline), not INTENT_CREATION_FAILED', async () => {
    vi.spyOn(sodax.hubProvider, 'getUserHubWalletAddress').mockResolvedValueOnce(HUB_WALLET);
    vi.spyOn(sodax.hubProvider.publicClient, 'getBlock').mockRejectedValueOnce(new Error('rpc down'));

    const result = await sodax.leverageYield.deposit({
      vault: VAULT,
      srcChainKey: ARBITRUM,
      srcAddress: SAMPLE_USER,
      inputToken: SPOKE_TOKEN,
      inputAmount: 1_000n,
      minOutputAmount: 900n,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('LOOKUP_FAILED');
    expect(result.error.context?.method).toBe('resolveDeadline');
    expect(result.error.context?.srcChainKey).toBe(ARBITRUM);
  });
});

describe('LeverageYieldService.withdraw — intent builder', () => {
  const withdrawParams = {
    vault: VAULT,
    srcChainKey: ARBITRUM,
    srcAddress: SAMPLE_USER,
    dstChainKey: ARBITRUM,
    outputToken: SPOKE_TOKEN,
    inputAmount: 1_000n,
    minOutputAmount: 900n,
  } as const;

  // Backward compatibility: callers that pass no partnerFee must leave the key absent, so
  // `createVaultIntent`'s default keeps resolving the configured leverage-yield fee.
  it('builds a hub-wallet swap of lsoda* into the chosen output token, with no partnerFee key', async () => {
    const result = await sodax.leverageYield.withdraw(withdrawParams);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.params).toMatchObject({
      inputToken: VAULT, // lsoda* shares are the swap input
      outputToken: SPOKE_TOKEN,
      inputAmount: 1_000n,
      minOutputAmount: 900n,
      srcChainKey: ARBITRUM,
      dstChainKey: ARBITRUM,
      srcAddress: SAMPLE_USER,
      dstAddress: SAMPLE_USER, // recipient defaults to srcAddress
    });
    // Default deadline is derived from the hub block timestamp, not the client clock.
    expect(result.value.params.deadline).toBe(HUB_BLOCK_TIMESTAMP + DEADLINE_BUFFER_SECONDS);
    expect(result.value.hubWalletSwap).toBe(true); // routes vaultSwap() through the hub-wallet sendMessage path
    expect('partnerFee' in result.value).toBe(false);
  });

  it('honours an explicit recipient and deadline without reading the hub block', async () => {
    const getBlock = vi.spyOn(sodax.hubProvider.publicClient, 'getBlock');
    const explicitDeadline = 9_999_999_999n;

    const result = await sodax.leverageYield.withdraw({
      ...withdrawParams,
      recipient: HUB_WALLET,
      deadline: explicitDeadline,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.params.dstAddress).toBe(HUB_WALLET);
    expect(result.value.params.deadline).toBe(explicitDeadline);
    expect(getBlock).not.toHaveBeenCalled();
  });

  it('rejects an empty vault address', async () => {
    const result = await sodax.leverageYield.withdraw({ ...withdrawParams, vault: '' as Address });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('VALIDATION_FAILED');
    expect(result.error.context?.field).toBe('vault');
  });

  it('refuses a Bitcoin source, an MPC-relay source, and a Bitcoin destination before reading the hub block', async () => {
    const getBlock = vi.spyOn(sodax.hubProvider.publicClient, 'getBlock');

    const bitcoinSrc = await sodax.leverageYield.withdraw({
      ...withdrawParams,
      srcChainKey: ChainKeys.BITCOIN_MAINNET,
      srcAddress: 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4',
    });
    const tronSrc = await sodax.leverageYield.withdraw({
      ...withdrawParams,
      srcChainKey: ChainKeys.TRON_MAINNET,
      srcAddress: TRON_TEST_ADDRESS,
    });
    const bitcoinDst = await sodax.leverageYield.withdraw({
      ...withdrawParams,
      dstChainKey: ChainKeys.BITCOIN_MAINNET,
      outputToken: '0:0',
      recipient: 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4',
    });

    if (bitcoinSrc.ok || tronSrc.ok || bitcoinDst.ok) throw new Error('expected every withdraw to be refused');
    expect(bitcoinSrc.error.code).toBe('VALIDATION_FAILED');
    expect(bitcoinSrc.error.context?.field).toBe('srcChainKey');
    expect(tronSrc.error.code).toBe('VALIDATION_FAILED');
    expect(tronSrc.error.message).toContain('MPC-relay');
    expect(bitcoinDst.error.code).toBe('VALIDATION_FAILED');
    expect(bitcoinDst.error.context?.field).toBe('dstChainKey');
    expect(getBlock).not.toHaveBeenCalled();
  });

  it('surfaces a getBlock RPC failure during default-deadline resolution as LOOKUP_FAILED (method=resolveDeadline)', async () => {
    vi.spyOn(sodax.hubProvider.publicClient, 'getBlock').mockRejectedValueOnce(new Error('rpc down'));

    const result = await sodax.leverageYield.withdraw(withdrawParams);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('LOOKUP_FAILED');
    expect(result.error.context?.method).toBe('resolveDeadline');
    expect(result.error.context?.srcChainKey).toBe(ARBITRUM);
  });
});

// ─── getApr — steady-state leverage APR (pins the basis-points targetLTV scale) ──

describe('LeverageYieldService.getApr', () => {
  it('computes supply/borrow/leverage/net APR at the vault targetLTV, going negative on an inverted spread', async () => {
    const supplyAprRay = pctRay(3); // 3%
    const borrowAprRay = pctRay(2); // 2%
    stubReadContract({
      pool: POOL,
      asset: SODA_ASSET,
      borrowToken: BORROW_TOKEN,
      targetLtvBps: 8000n,
      supplyAprRay,
      borrowAprRay,
    });

    const result = await sodax.leverageYield.getApr(VAULT);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // leverage = 0.8 / (1 - 0.8) = 4x ; net = supply + 4 × (supply − borrow) = 3% + 4 × 1% = 7%
    expect(result.value).toEqual({
      supplyAprRay,
      borrowAprRay,
      targetLtvBps: 8000n,
      leverageMultiplierWad: 4n * WAD,
      netAprRay: pctRay(7),
    });

    // Inverted spread: net = 2% + 4 × (2% − 3%) = −2%.
    stubReadContract({ targetLtvBps: 8000n, supplyAprRay: pctRay(2), borrowAprRay: pctRay(3) });
    const inverted = await sodax.leverageYield.getApr(VAULT);
    expect(inverted.ok && inverted.value.netAprRay).toBe(-pctRay(2));
  });

  it('rejects targetLTV ≥ 100% (10_000 bps) — the basis-points invariant trips', async () => {
    stubReadContract({
      pool: POOL,
      asset: SODA_ASSET,
      borrowToken: BORROW_TOKEN,
      targetLtvBps: 10_000n,
      supplyAprRay: pctRay(3),
      borrowAprRay: pctRay(2),
    });

    const result = await sodax.leverageYield.getApr(VAULT);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    // LookupErrorCode includes VALIDATION_FAILED, so getApr surfaces the targetLTV<100%
    // (basis-points) invariant directly rather than re-wrapping it as LOOKUP_FAILED.
    expect(result.error.code).toBe('VALIDATION_FAILED');
    expect(result.error.context?.method).toBe('getApr');
    expect(result.error.context?.field).toBe('targetLtvBps');
    expect(result.error.message).toContain('10_000 bps');
  });

  it('wraps a readContract failure as LOOKUP_FAILED with method=getApr', async () => {
    const boom = new Error('rpc down');
    vi.spyOn(sodax.hubProvider.publicClient, 'readContract').mockRejectedValue(boom);

    const result = await sodax.leverageYield.getApr(VAULT);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('LOOKUP_FAILED');
    expect(result.error.context?.method).toBe('getApr');
    expect(result.error.cause).toBe(boom);
  });
});

// ─── getLsdApr / getEffectiveApr — off-chain LSD yield + folded effective APR ──

describe('LeverageYieldService.getLsdApr / getEffectiveApr', () => {
  it('returns a zero, stale snapshot with no LSD source, and the live DefiLlama apy (not stale) otherwise', async () => {
    const none = await sodax.leverageYield.getLsdApr('0x000000000000000000000000000000000000dEaD' as Address);
    expect(none).toEqual({ ok: true, value: { aprRay: 0n, label: 'no LSD source', stale: true } });

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ data: [{ apy: 2.4 }] }) }));
    const live = await sodax.leverageYield.getLsdApr(VAULT);
    expect(live).toEqual({ ok: true, value: { aprRay: pctRay(2.4), label: 'EtherFi (weETH)', stale: false } });
  });

  it('folds the registry-fallback LSD yield (logged, stale) into the supply side and re-applies leverage', async () => {
    // Fake timers skip the shared retry helper's back-off on the failing DefiLlama fetch.
    vi.useFakeTimers();
    const warn = vi.spyOn(sodax.config.logger, 'warn').mockImplementation(() => {});
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network'))); // → fallbackAprPct 3.0
    stubReadContract({
      pool: POOL,
      asset: SODA_ASSET,
      borrowToken: BORROW_TOKEN,
      targetLtvBps: 8000n,
      supplyAprRay: pctRay(3),
      borrowAprRay: pctRay(2),
    });

    const promise = sodax.leverageYield.getEffectiveApr(VAULT);
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // effectiveSupply = 3% + 3% = 6% ; effectiveNet = 6% + 4 × (6% − 2%) = 6% + 16% = 22%
    expect(result.value.effectiveSupplyAprRay).toBe(pctRay(6));
    expect(result.value.effectiveNetAprRay).toBe(pctRay(22));
    expect(result.value.netAprRay).toBe(pctRay(7)); // AAVE-only headline preserved
    expect(result.value.lsdApr).toEqual({ aprRay: pctRay(3), label: 'EtherFi (weETH) (fallback)', stale: true });
    // The fallback is logged, not silently swallowed.
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('DefiLlama APR fetch failed'), expect.any(Object));
  });
});

// ─── createVaultIntent — the three creation branches + fee override + errors ──

describe('LeverageYieldService.createVaultIntent', () => {
  it('on an EVM spoke, builds intent data and deposits via SpokeService (signed, or raw without a wallet)', async () => {
    const intent = makeIntent(ARBITRUM);
    mocks.constructCreateIntentData
      .mockReturnValueOnce(['0xdata', intent, 5n])
      .mockReturnValueOnce(['0xdata', intent, 0n]);
    vi.spyOn(sodax.spoke, 'deposit')
      .mockResolvedValueOnce({ ok: true, value: '0xspokeTx' })
      .mockResolvedValueOnce({ ok: true, value: '0xrawtx' });

    const result = await sodax.leverageYield.createVaultIntent({
      params: vaultIntentParams(ARBITRUM),
      walletProvider: mockEvmProvider,
      raw: false,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.tx).toBe('0xspokeTx');
    expect(result.value.intent.feeAmount).toBe(5n);
    expect(result.value.relayData).toEqual({ address: intent.creator, payload: '0xdata' });
    expect(sodax.spoke.deposit).toHaveBeenCalledTimes(1);

    const raw = await sodax.leverageYield.createVaultIntent({ params: vaultIntentParams(ARBITRUM), raw: true });
    expect(raw.ok && raw.value.tx).toBe('0xrawtx');
    expect((sodax.spoke.deposit as ReturnType<typeof vi.fn>).mock.calls[1]?.[0].raw).toBe(true);
  });

  it('on Sonic (hub) source, creates the intent directly via SonicSpokeService.createSwapIntent', async () => {
    const intent = makeIntent(SONIC);
    mocks.sonicCreateSwapIntent.mockResolvedValueOnce(['0xsonicTx', intent, 0n, '0xdata']);

    const result = await sodax.leverageYield.createVaultIntent({
      params: vaultIntentParams(SONIC),
      walletProvider: mockEvmProvider,
      raw: false,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.tx).toBe('0xsonicTx');
    expect(result.value.relayData).toEqual({ address: intent.creator, payload: '0xdata' });
    expect(mocks.sonicCreateSwapIntent).toHaveBeenCalledTimes(1);
  });

  it('on a hub-wallet swap (withdraw), validates inputToken against the hub and authorises via sendMessage', async () => {
    const intent = makeIntent(ARBITRUM);
    mocks.constructCreateIntentData.mockReturnValueOnce(['0xhubdata', intent, 7n]);
    vi.spyOn(sodax.spoke, 'sendMessage').mockResolvedValueOnce({ ok: true, value: '0xmsgTx' });

    const result = await sodax.leverageYield.createVaultIntent({
      params: vaultIntentParams(ARBITRUM, {
        inputToken: VAULT, // lsoda* shares are the swap input
        outputToken: SPOKE_TOKEN,
        dstChainKey: ARBITRUM as SpokeChainKey,
        dstAddress: SAMPLE_USER,
      }),
      walletProvider: mockEvmProvider,
      raw: false,
      hubWalletSwap: true,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.tx).toBe('0xmsgTx');
    expect(result.value.intent.feeAmount).toBe(7n);
    // hub-wallet swap routes through sendMessage, and relayData targets the hub wallet.
    expect(sodax.spoke.sendMessage).toHaveBeenCalledTimes(1);
    expect(result.value.relayData).toEqual({ address: HUB_WALLET, payload: '0xhubdata' });
    // the input token is validated against the hub chain, not srcChainKey.
    expect(sodax.config.isValidOriginalAssetAddress).toHaveBeenNthCalledWith(1, HUB, VAULT);
  });

  it('refuses a Bitcoin source or destination before signing anything', async () => {
    const sendMessage = vi.spyOn(sodax.spoke, 'sendMessage');

    const source = await sodax.leverageYield.createVaultIntent({
      params: vaultIntentParams(ChainKeys.BITCOIN_MAINNET, {
        inputToken: VAULT,
        outputToken: SPOKE_TOKEN,
        dstChainKey: ARBITRUM as SpokeChainKey,
        dstAddress: SAMPLE_USER,
      }),
      walletProvider: mockBitcoinProvider,
      raw: false,
      hubWalletSwap: true,
    });
    const destination = await sodax.leverageYield.createVaultIntent({
      params: vaultIntentParams(ARBITRUM, {
        inputToken: VAULT,
        outputToken: '0:0',
        dstChainKey: ChainKeys.BITCOIN_MAINNET as SpokeChainKey,
        dstAddress: 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4',
      }),
      raw: true,
      hubWalletSwap: true,
    });

    if (source.ok || destination.ok) throw new Error('expected both intents to be refused');
    expect(source.error.code).toBe('VALIDATION_FAILED');
    expect(source.error.context?.field).toBe('srcChainKey');
    expect(destination.error.code).toBe('VALIDATION_FAILED');
    expect(destination.error.context?.field).toBe('dstChainKey');
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it('refuses an MPC-relay source before signing, as a deposit or a hub-wallet swap', async () => {
    const deposit = vi.spyOn(sodax.spoke, 'deposit');
    const sendMessage = vi.spyOn(sodax.spoke, 'sendMessage');

    for (const hubWalletSwap of [false, true]) {
      const result = await sodax.leverageYield.createVaultIntent({
        params: vaultIntentParams(ChainKeys.TRON_MAINNET, {
          srcAddress: TRON_TEST_ADDRESS,
          inputToken: tronSupportedTokens.USDT.address,
        }),
        raw: true,
        hubWalletSwap,
      });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe('VALIDATION_FAILED');
      expect(result.error.message).toContain('MPC-relay');
    }
    expect(deposit).not.toHaveBeenCalled();
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it('refuses a Tron payout at the relay minimum, or a partial fill above the payout floor, before signing', async () => {
    const send = vi.spyOn(sodax.spoke, 'sendMessage');
    const deposit = vi.spyOn(sodax.spoke, 'deposit');
    const tronPayout = (overrides: Partial<CreateIntentParams<SpokeChainKey>>) =>
      sodax.leverageYield.createVaultIntent({
        params: vaultIntentParams(ARBITRUM, {
          inputToken: VAULT,
          outputToken: tronSupportedTokens.USDT.address,
          dstChainKey: ChainKeys.TRON_MAINNET,
          dstAddress: TRON_TEST_ADDRESS,
          ...overrides,
        }),
        raw: true,
        hubWalletSwap: true,
      });

    const atMinimum = await tronPayout({ minOutputAmount: 3_000_000n });
    const partial = await tronPayout({ minOutputAmount: 3_000_001n, allowPartialFill: true });

    if (atMinimum.ok || partial.ok) throw new Error('expected both payouts to be refused');
    expect(atMinimum.error.code).toBe('VALIDATION_FAILED');
    expect(atMinimum.error.context?.field).toBe('minOutputAmount');
    expect(partial.error.code).toBe('VALIDATION_FAILED');
    expect(partial.error.context?.field).toBe('allowPartialFill');
    expect(send).not.toHaveBeenCalled();
    expect(deposit).not.toHaveBeenCalled();
  });

  it.each([
    99_000_000n,
    50_000_000n,
    49_999_999n,
  ])('checks vault solved payout headroom for minimum %s before signing', async minOutputAmount => {
    vi.spyOn(sodax.leverageYield, 'getQuote').mockResolvedValue({ ok: true, value: { quoted_amount: 100_000_000n } });
    vi.spyOn(sodax.spoke.xrp, 'checkDestination').mockImplementation(async ({ amount, maxAmount = amount }) =>
      maxAmount > 100_000_000n ? { ready: false, reason: 'trustline_limit' } : { ready: true },
    );
    const signing = vi.spyOn(sodax.spoke, 'sendMessage');
    const pastValidation = vi
      .spyOn(sodax.hubProvider, 'getUserHubWalletAddress')
      .mockRejectedValue(new Error('past validation'));
    const result = await sodax.leverageYield.createVaultIntent({
      params: vaultIntentParams(ARBITRUM, {
        inputToken: VAULT,
        outputToken: xrpSupportedTokens.USDC.address,
        minOutputAmount,
        dstChainKey: ChainKeys.XRP_MAINNET,
        dstAddress: 'rBTwLga3i2gz3doX6Gva3MgEV8ZCD8jjah',
      }),
      raw: true,
      hubWalletSwap: true,
    });
    if (minOutputAmount === 99_000_000n) {
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.context).toMatchObject({ reason: 'xrpl-trustline_limit' });
      expect(pastValidation).not.toHaveBeenCalled();
      expect(signing).not.toHaveBeenCalled();
    } else if (minOutputAmount < 50_000_000n) {
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.context?.field).toBe('minOutputAmount');
      expect(pastValidation).not.toHaveBeenCalled();
      expect(signing).not.toHaveBeenCalled();
    } else expect(pastValidation).toHaveBeenCalled();
  });

  it('refuses a payout to an XRPL account that cannot receive it before signing anything', async () => {
    const sendMessage = vi.spyOn(sodax.spoke, 'sendMessage');
    const xrplAddress = 'rBTwLga3i2gz3doX6Gva3MgEV8ZCD8jjah';
    vi.spyOn(sodax.leverageYield, 'getQuote').mockResolvedValue({ ok: true, value: { quoted_amount: 10_000_000n } });
    const checkSpy = vi
      .spyOn(sodax.spoke.xrp, 'checkDestination')
      .mockResolvedValue({ ready: false, reason: 'account_not_found' });

    const result = await sodax.leverageYield.createVaultIntent({
      params: vaultIntentParams(ARBITRUM, {
        inputToken: VAULT,
        outputToken: xrpSupportedTokens.USDC.address,
        minOutputAmount: 5_000_000n,
        dstChainKey: ChainKeys.XRP_MAINNET as SpokeChainKey,
        dstAddress: xrplAddress,
      }),
      raw: true,
      hubWalletSwap: true,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('VALIDATION_FAILED');
    expect(result.error.context).toMatchObject({ field: 'dstAddress', reason: 'xrpl-account_not_found' });
    expect(checkSpy).toHaveBeenCalledWith({
      address: xrplAddress,
      token: xrpSupportedTokens.USDC.address,
      amount: 5_000_000n,
      maxAmount: 10_000_000n,
    });
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it('rejects an unsupported input token or spoke chain with VALIDATION_FAILED on that field', async () => {
    const input = { params: vaultIntentParams(ARBITRUM), walletProvider: mockEvmProvider, raw: false } as const;

    vi.spyOn(sodax.config, 'isValidOriginalAssetAddress').mockReturnValueOnce(false);
    const badToken = await sodax.leverageYield.createVaultIntent(input);
    vi.spyOn(sodax.config, 'isValidSpokeChainKey').mockReturnValueOnce(false);
    const badChain = await sodax.leverageYield.createVaultIntent(input);

    if (badToken.ok || badChain.ok) throw new Error('expected both intents to be rejected');
    expect(badToken.error.code).toBe('VALIDATION_FAILED');
    expect(badToken.error.context?.field).toBe('inputToken');
    expect(badChain.error.code).toBe('VALIDATION_FAILED');
    expect(badChain.error.context?.field).toBe('srcChainKey');
  });

  it('wraps a non-typed spoke.deposit or hub-wallet sendMessage failure as INTENT_CREATION_FAILED', async () => {
    const depositError = new Error('deposit reverted');
    const sendError = new Error('sendMessage reverted');
    mocks.constructCreateIntentData
      .mockReturnValueOnce(['0xdata', makeIntent(ARBITRUM), 0n])
      .mockReturnValueOnce(['0xhubdata', makeIntent(ARBITRUM), 0n]);
    vi.spyOn(sodax.spoke, 'deposit').mockResolvedValueOnce({ ok: false, error: depositError });
    vi.spyOn(sodax.spoke, 'sendMessage').mockResolvedValueOnce({ ok: false, error: sendError });

    const viaDeposit = await sodax.leverageYield.createVaultIntent({
      params: vaultIntentParams(ARBITRUM),
      walletProvider: mockEvmProvider,
      raw: false,
    });
    const viaHubWallet = await sodax.leverageYield.createVaultIntent({
      params: vaultIntentParams(ARBITRUM, {
        inputToken: VAULT,
        outputToken: SPOKE_TOKEN,
        dstChainKey: ARBITRUM as SpokeChainKey,
        dstAddress: SAMPLE_USER,
      }),
      walletProvider: mockEvmProvider,
      raw: false,
      hubWalletSwap: true,
    });

    if (viaDeposit.ok || viaHubWallet.ok) throw new Error('expected both intents to fail');
    expect(viaDeposit.error.code).toBe('INTENT_CREATION_FAILED');
    expect(viaDeposit.error.cause).toBe(depositError);
    expect(viaHubWallet.error.code).toBe('INTENT_CREATION_FAILED');
    expect(viaHubWallet.error.cause).toBe(sendError);
  });
});

// ─── Partner-fee precedence ───────────────────────────────────────────────

/**
 * Vault intents are priced off the effective **leverage-yield** fee
 * (`leverageYield.partnerFee ?? fee`), never the swap fee. Regression cover for the period
 * when `createVaultIntent` read `config.swapPartnerFee`, which silently applied `swaps.partnerFee`
 * to vault flows and made `leverageYield.partnerFee` a no-op.
 */
describe('LeverageYieldService — partner-fee precedence', () => {
  // The EVM-spoke (deposit) and hub-wallet (withdraw) branches are driven end to end below.
  it('applies the leverage-yield fee, not swaps.partnerFee, on the Sonic-source branch', async () => {
    const LY_FEE = { address: SAMPLE_USER, percentage: 100 } as const satisfies PartnerFee;
    const s = new Sodax({
      swaps: { partnerFee: { address: HUB_WALLET, percentage: 50 } },
      leverageYield: { partnerFee: LY_FEE },
    });
    vi.spyOn(s.config, 'isValidOriginalAssetAddress').mockReturnValue(true);
    vi.spyOn(s.config, 'isValidSpokeChainKey').mockReturnValue(true);
    vi.spyOn(s.hubProvider, 'getUserHubWalletAddress').mockResolvedValue(HUB_WALLET);
    mocks.sonicCreateSwapIntent.mockResolvedValueOnce(['0xsonicTx', makeIntent(SONIC), 0n, '0xdata']);

    await s.leverageYield.createVaultIntent({
      params: vaultIntentParams(SONIC),
      walletProvider: mockEvmProvider,
      raw: false,
    });

    expect(mocks.sonicCreateSwapIntent.mock.calls[0]?.[0].fee).toEqual(LY_FEE);
  });
});

// ─── getQuote — vault-fee-aware solver quote ──────────────────────────────

describe('LeverageYieldService.getQuote', () => {
  const LY_FEE = { address: SAMPLE_USER, percentage: 100 } as const satisfies PartnerFee; // 1%
  const SWAP_FEE = { address: HUB_WALLET, percentage: 50 } as const satisfies PartnerFee;

  const quoteParams = {
    token_src: SPOKE_TOKEN,
    token_src_blockchain_id: ARBITRUM,
    token_dst: VAULT,
    token_dst_blockchain_id: HUB as SpokeChainKey,
    amount: 1_000_000n,
    quote_type: 'exact_input',
  } as const;

  /** Amount actually forwarded to the solver, i.e. gross minus the fee applied by getQuote. */
  const quotedAmount = async (s: Sodax, overrides: { partnerFee?: PartnerFee } = {}) => {
    mocks.solverGetQuote.mockClear();
    mocks.solverGetQuote.mockResolvedValueOnce({ ok: true, value: { quoted_amount: 1n } });
    await s.leverageYield.getQuote({ ...quoteParams, ...overrides });
    expect(mocks.solverGetQuote).toHaveBeenCalledTimes(1);
    return mocks.solverGetQuote.mock.calls[0]?.[0].amount;
  };

  it('deducts the vault fee the intent will charge (per-call ?? leverageYield ?? none), never swaps.partnerFee', async () => {
    const lyConfigured = new Sodax({ leverageYield: { partnerFee: LY_FEE } });
    expect(await quotedAmount(lyConfigured)).toBe(990_000n); // 1% of 1_000_000
    expect(await quotedAmount(new Sodax())).toBe(1_000_000n);
    expect(await quotedAmount(new Sodax({ swaps: { partnerFee: SWAP_FEE } }))).toBe(1_000_000n);
    // 0.1% per-call override beats the configured 1%.
    expect(await quotedAmount(lyConfigured, { partnerFee: { address: HUB_WALLET, percentage: 10 } })).toBe(999_000n);
  });

  // The other LY methods return a Result for bad input; getQuote must not be the one that throws.
  it('returns VALIDATION_FAILED for a non-positive amount, tagged with token-side chain keys', async () => {
    const result = await new Sodax().leverageYield.getQuote({ ...quoteParams, amount: 0n });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    if (!isSodaxError(result.error)) throw new Error('expected a SodaxError');
    expect(result.error.code).toBe('VALIDATION_FAILED');
    expect(mocks.solverGetQuote).not.toHaveBeenCalled();
    // A withdraw quote's token_src lives on the hub, so `srcChainKey` would misreport the chain
    // the user signs on. Neutral names keep the field meanings intact across both directions.
    expect(result.error.context).toMatchObject({
      method: 'getQuote',
      tokenSrcChainKey: ARBITRUM,
      tokenDstChainKey: HUB,
    });
    expect(result.error.context).not.toHaveProperty('srcChainKey');
  });

  // A fee that leaves nothing to quote, or cannot be applied, is an input/config problem — the fee
  // arithmetic throws a bare invariant that would otherwise be wrapped as a retryable LOOKUP_FAILED.
  it.each([
    ['a fixed fee equal to the amount', { amount: 1_000_000n }],
    ['a 100% percentage fee', { percentage: 10_000 }],
    ['a percentage above the 10_000 bp scale', { percentage: 20_000 }],
    // Fractional passes calculateFeeAmount's bounds check, then BigInt(0.5) throws a RangeError.
    ['a fractional percentage', { percentage: 0.5 }],
  ] as const)('returns VALIDATION_FAILED for %s', async (_label, fee) => {
    const s = new Sodax({ leverageYield: { partnerFee: { address: SAMPLE_USER, ...fee } } });

    const result = await s.leverageYield.getQuote(quoteParams); // amount is 1_000_000n

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(isSodaxError(result.error) && result.error.code).toBe('VALIDATION_FAILED');
    expect(mocks.solverGetQuote).not.toHaveBeenCalled();
  });

  it('returns LOOKUP_FAILED when the solver call rejects (unsupported token)', async () => {
    // SolverApiService asserts its own preconditions as a rejection — it must not escape getQuote.
    mocks.solverGetQuote.mockRejectedValueOnce(new Error('unsupported token_src for src chain'));

    const result = await new Sodax().leverageYield.getQuote(quoteParams);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(isSodaxError(result.error) && result.error.code).toBe('LOOKUP_FAILED');
  });
});

// ─── vaultSwap — full create → verify → relay → notify-solver orchestration ──

describe('LeverageYieldService.vaultSwap', () => {
  // Stub createVaultIntent so these tests isolate vaultSwap's orchestration.
  const stubCreateVaultIntentOk = (srcChainKey: SpokeChainKey, spokeTxHash = '0xspokeTx') => {
    const intent = makeIntent(srcChainKey as Parameters<typeof getIntentRelayChainId>[0]);
    return vi.spyOn(sodax.leverageYield, 'createVaultIntent').mockResolvedValueOnce({
      ok: true,
      value: {
        tx: spokeTxHash,
        intent: { ...intent, feeAmount: 0n },
        relayData: { address: intent.creator, payload: '0xdata' },
      },
    });
  };

  it('on an EVM spoke source: create → verify → relay → notify-solver, returning delivery info', async () => {
    stubCreateVaultIntentOk(ARBITRUM, '0xspokeTx');
    mocks.relayTxAndWaitPacket.mockResolvedValueOnce({ ok: true, value: { dst_tx_hash: '0xdstTx' } });
    mocks.solverPostExecution.mockResolvedValueOnce({ ok: true, value: { answer: 'OK', intent_hash: '0xhash' } });

    const result = await sodax.leverageYield.vaultSwap({
      params: vaultIntentParams(ARBITRUM, { dstChainKey: ARBITRUM as SpokeChainKey, dstAddress: SAMPLE_USER }),
      walletProvider: mockEvmProvider,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.solverExecutionResponse).toEqual({ answer: 'OK', intent_hash: '0xhash' });
    expect(result.value.intentDeliveryInfo).toEqual({
      srcChainKey: ARBITRUM,
      srcTxHash: '0xspokeTx',
      srcAddress: SAMPLE_USER,
      dstChainKey: ARBITRUM,
      dstTxHash: '0xdstTx',
      dstAddress: SAMPLE_USER,
    });
    expect(mocks.solverPostExecution.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({ intent_tx_hash: '0xdstTx' }),
    );
  });

  it('on a Sonic (hub) source: skips relay and notifies the solver with the spoke tx hash', async () => {
    stubCreateVaultIntentOk(SONIC, '0xsonicTx');
    mocks.solverPostExecution.mockResolvedValueOnce({ ok: true, value: { answer: 'OK', intent_hash: '0xhash' } });

    const result = await sodax.leverageYield.vaultSwap({
      params: vaultIntentParams(SONIC, { dstChainKey: ARBITRUM as SpokeChainKey, dstAddress: SAMPLE_USER }),
      walletProvider: mockEvmProvider,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(mocks.relayTxAndWaitPacket).not.toHaveBeenCalled();
    expect(result.value.intentDeliveryInfo.dstTxHash).toBe('0xsonicTx');
    expect(mocks.solverPostExecution.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({ intent_tx_hash: '0xsonicTx' }),
    );
  });

  it('forwards a createVaultIntent failure unchanged', async () => {
    const createError = new SodaxError('INTENT_CREATION_FAILED', 'boom', { feature: 'leverageYield' });
    vi.spyOn(sodax.leverageYield, 'createVaultIntent').mockResolvedValueOnce({ ok: false, error: createError });

    const result = await sodax.leverageYield.vaultSwap({
      params: vaultIntentParams(ARBITRUM),
      walletProvider: mockEvmProvider,
    });

    expect(result).toEqual({ ok: false, error: createError });
    expect(mocks.relayTxAndWaitPacket).not.toHaveBeenCalled();
  });

  it('wraps a verifyTxHash failure as TX_VERIFICATION_FAILED (action=vaultSwap)', async () => {
    stubCreateVaultIntentOk(ARBITRUM);
    const verifyError = new Error('verify failed');
    vi.spyOn(sodax.spoke, 'verifyTxHash').mockResolvedValueOnce({ ok: false, error: verifyError });

    const result = await sodax.leverageYield.vaultSwap({
      params: vaultIntentParams(ARBITRUM),
      walletProvider: mockEvmProvider,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('TX_VERIFICATION_FAILED');
    expect(result.error.context?.action).toBe('vaultSwap');
    expect(result.error.context).toMatchObject({ srcChainKey: ARBITRUM, srcTxHash: '0xspokeTx' });
    expect(result.error.cause).toBe(verifyError);
    expect(mocks.relayTxAndWaitPacket).not.toHaveBeenCalled();
  });

  it('maps a RELAY_TIMEOUT relay failure to RELAY_TIMEOUT (action=vaultSwap)', async () => {
    stubCreateVaultIntentOk(ARBITRUM);
    mocks.relayTxAndWaitPacket.mockResolvedValueOnce({ ok: false, error: new Error('RELAY_TIMEOUT') });

    const result = await sodax.leverageYield.vaultSwap({
      params: vaultIntentParams(ARBITRUM),
      walletProvider: mockEvmProvider,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('RELAY_TIMEOUT');
    expect(result.error.context?.relayCode).toBe('RELAY_TIMEOUT');
    expect(result.error.context?.action).toBe('vaultSwap');
    expect(result.error.context).toMatchObject({ srcChainKey: ARBITRUM, srcTxHash: '0xspokeTx' });
    expect(mocks.solverPostExecution).not.toHaveBeenCalled();
  });

  it('maps a solver postExecution error to EXTERNAL_API_ERROR carrying the hub tx, so notifySolver can be retried', async () => {
    const detail = { code: -7, message: 'no execution module found' };
    stubCreateVaultIntentOk(SONIC);
    stubCreateVaultIntentOk(ARBITRUM);
    mocks.relayTxAndWaitPacket.mockResolvedValueOnce({ ok: true, value: { dst_tx_hash: '0xhubTx' } });
    mocks.solverPostExecution
      .mockResolvedValueOnce({ ok: false, error: { detail } })
      .mockResolvedValueOnce({ ok: false, error: { detail } });

    const hubSource = await sodax.leverageYield.vaultSwap({
      params: vaultIntentParams(SONIC),
      walletProvider: mockEvmProvider,
    });
    const relayed = await sodax.leverageYield.vaultSwap({
      params: vaultIntentParams(ARBITRUM),
      walletProvider: mockEvmProvider,
    });

    if (hubSource.ok || relayed.ok) throw new Error('expected both swaps to fail');
    expect(hubSource.error.code).toBe('EXTERNAL_API_ERROR');
    expect(hubSource.error.context?.solverCode).toBe(-7);
    // A hub-sourced intent tx is already the hub tx.
    expect(hubSource.error.context).toMatchObject({
      phase: 'postExecution',
      srcChainKey: SONIC,
      srcTxHash: '0xspokeTx',
      dstTxHash: '0xspokeTx',
    });
    expect(relayed.error.context).toMatchObject({
      phase: 'postExecution',
      srcChainKey: ARBITRUM,
      srcTxHash: '0xspokeTx',
      dstTxHash: '0xhubTx',
    });
  });
});

// ─── vaultSwap — backend submit-tx path (leverageYield.useBackendSubmitTx) ─

describe('LeverageYieldService.vaultSwap — backend submit-tx (useBackendSubmitTx)', () => {
  // A separate Sodax instance with the flag set ON explicitly. It matches the shipped default, but
  // is spelled out so these tests keep testing the backend path even if the default moves again; the
  // module-level `sodax` is the one pinned to the opt-out. Per test we stub createVaultIntent +
  // verifyTxHash on this instance and the backend leverage-yield API it calls; the module-level
  // `mocks.relayTxAndWaitPacket` covers the fallback.
  const sodaxBE = new Sodax({ leverageYield: { useBackendSubmitTx: true }, logger: 'silent' });

  /** Deposit params on an EVM spoke, with the wallet-provider wrapper `vaultSwap` takes. */
  const vaultSwapInput = (timeout?: number) => ({
    params: vaultIntentParams(ARBITRUM, { dstChainKey: ARBITRUM as SpokeChainKey, dstAddress: SAMPLE_USER }),
    walletProvider: mockEvmProvider,
    ...(timeout === undefined ? {} : { timeout }),
  });

  /**
   * createVaultIntent (broadcast) succeeds; `verifyTxHash` is only consumed on the fallback path, so
   * it is returned for the tests that assert whether it ran at all.
   */
  const stubCreatedAndVerified = () => {
    const intent = makeIntent(ARBITRUM);
    vi.spyOn(sodaxBE.leverageYield, 'createVaultIntent').mockResolvedValueOnce({
      ok: true,
      value: {
        tx: '0xspokeTx',
        intent: { ...intent, feeAmount: 0n },
        relayData: { address: intent.creator, payload: '0xdata' },
      },
    });
    return vi.spyOn(sodaxBE.spoke, 'verifyTxHash').mockResolvedValue({ ok: true, value: true });
  };

  const stubAcceptedSubmit = () =>
    vi.spyOn(sodaxBE.api.leverageYield, 'submitTx').mockResolvedValueOnce({
      ok: true,
      value: { success: true, data: { status: 'inserted', message: 'accepted' } },
    });

  /** A `getSubmitTxStatus` success Result; only the fields a given test exercises need supplying. */
  const statusEnvelope = (
    data: Partial<SubmitTxStatusDataV2> & Pick<SubmitTxStatusDataV2, 'status'>,
  ): Result<SubmitTxStatusResponseV2> => ({
    ok: true,
    value: {
      success: true,
      data: { txHash: '0xspokeTx', srcChainKey: ARBITRUM, processingAttempts: 1, ...data },
    },
  });

  it('on backend "solved", returns the backend VaultSwapResponse with no verify, relay or solver leg', async () => {
    const verifySpy = stubCreatedAndVerified();
    const submitSpy = stubAcceptedSubmit();
    vi.spyOn(sodaxBE.api.leverageYield, 'getSubmitTxStatus').mockResolvedValueOnce(
      statusEnvelope({ status: 'solved', result: { dstIntentTxHash: '0xDST', intent_hash: '0xhash' } }),
    );

    // A caller budget far above the service timeout must not RAISE the per-request bound: an override
    // REPLACES `config.timeout` rather than lowering it.
    const result = await sodaxBE.leverageYield.vaultSwap(vaultSwapInput(600_000));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.solverExecutionResponse).toEqual({ answer: 'OK', intent_hash: '0xhash' });
    expect(result.value.intentDeliveryInfo.srcTxHash).toBe('0xspokeTx');
    expect(result.value.intentDeliveryInfo.dstTxHash).toBe('0xDST');
    expect(submitSpy).toHaveBeenCalledOnce();
    expect(submitSpy.mock.calls[0]?.[1]).toEqual({ timeout: DEFAULT_BACKEND_API_TIMEOUT });
    // The backend owns relay + post-execution — neither client-side leg may run. Verifying first
    // would delay it by the source chain's confirmation wait for nothing.
    expect(verifySpy).not.toHaveBeenCalled();
    expect(mocks.relayTxAndWaitPacket).not.toHaveBeenCalled();
    expect(mocks.solverPostExecution).not.toHaveBeenCalled();
  });

  it('sends the operation discriminator: "deposit" by default, "withdraw" for a hub-wallet swap', async () => {
    for (const [hubWalletSwap, operation] of [
      [undefined, 'deposit'],
      [true, 'withdraw'],
    ] as const) {
      vi.clearAllMocks();
      stubCreatedAndVerified();
      const submitSpy = stubAcceptedSubmit();
      vi.spyOn(sodaxBE.api.leverageYield, 'getSubmitTxStatus').mockResolvedValueOnce(
        statusEnvelope({ status: 'solved', result: { dstIntentTxHash: '0xDST', intent_hash: '0xhash' } }),
      );

      const result = await sodaxBE.leverageYield.vaultSwap({
        ...vaultSwapInput(),
        ...(hubWalletSwap === undefined ? {} : { hubWalletSwap }),
      });

      expect(result.ok).toBe(true);
      // The backend records the queued row as leverage_deposit / leverage_withdraw off this field.
      expect(submitSpy.mock.calls[0]?.[0]).toMatchObject({ operation });
    }
  });

  it('falls back to the client-side relay when the backend submit POST is rejected', async () => {
    const verifySpy = stubCreatedAndVerified();
    vi.spyOn(sodaxBE.api.leverageYield, 'submitTx').mockResolvedValueOnce({
      ok: false,
      error: new SodaxError('EXTERNAL_API_ERROR', 'backend down', { feature: 'backend' }),
    });
    const statusSpy = vi.spyOn(sodaxBE.api.leverageYield, 'getSubmitTxStatus');
    mocks.relayTxAndWaitPacket.mockResolvedValueOnce({ ok: true, value: { dst_tx_hash: '0xFALLBACKDST' } });
    mocks.solverPostExecution.mockResolvedValueOnce({ ok: true, value: { answer: 'OK', intent_hash: '0xfb' } });

    const result = await sodaxBE.leverageYield.vaultSwap(vaultSwapInput(30_000));

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.intentDeliveryInfo.dstTxHash).toBe('0xFALLBACKDST');
    expect(statusSpy).not.toHaveBeenCalled(); // POST failed before any status polling
    // The fallback pays for verification once, and only then.
    expect(verifySpy).toHaveBeenCalledOnce();
    // A backend that fails fast leaves the fallback the SAME full budget a stalled one does — the two
    // paths never share a deadline.
    expect(mocks.relayTxAndWaitPacket.mock.calls.at(-1)?.[0]?.timeout).toBe(30_000);
  });

  it('treats a non-finite caller timeout as the default rather than stranding the broadcast intent', async () => {
    stubCreatedAndVerified();
    const submitSpy = vi.spyOn(sodaxBE.api.leverageYield, 'submitTx').mockResolvedValueOnce({
      ok: false,
      error: new SodaxError('EXTERNAL_API_ERROR', 'backend down', { feature: 'backend' }),
    });
    mocks.relayTxAndWaitPacket.mockResolvedValueOnce({ ok: true, value: { dst_tx_hash: '0xFALLBACKDST' } });
    mocks.solverPostExecution.mockResolvedValueOnce({ ok: true, value: { answer: 'OK', intent_hash: '0xfb' } });

    // `?? DEFAULT` does not catch NaN; unresolved it would skip the POST and hand the relay
    // `Math.max(NaN, floor)` = NaN, which reads as an already-expired budget — RELAY_TIMEOUT in
    // milliseconds on an intent that is live on-chain.
    const result = await sodaxBE.leverageYield.vaultSwap(vaultSwapInput(Number.NaN));

    expect(result.ok).toBe(true);
    expect(submitSpy).toHaveBeenCalledOnce();
    expect(submitSpy.mock.calls[0]?.[1]).toEqual({ timeout: DEFAULT_BACKEND_API_TIMEOUT });
    expect(mocks.relayTxAndWaitPacket.mock.calls.at(-1)?.[0]?.timeout).toBe(DEFAULT_RELAY_TX_TIMEOUT);
  });

  it('gives the fallback a FRESH full timeout after a stalled backend consumed its own', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    try {
      stubCreatedAndVerified();
      stubAcceptedSubmit();
      vi.spyOn(sodaxBE.api.leverageYield, 'getSubmitTxStatus').mockResolvedValue(statusEnvelope({ status: 'pending' }));
      mocks.relayTxAndWaitPacket.mockResolvedValueOnce({ ok: true, value: { dst_tx_hash: '0xFALLBACKDST' } });
      mocks.solverPostExecution.mockResolvedValueOnce({ ok: true, value: { answer: 'OK', intent_hash: '0xfb' } });

      const overallTimeout = 30_000;
      const swapPromise = sodaxBE.leverageYield.vaultSwap(vaultSwapInput(overallTimeout));
      // Drive the backend attempt past its own deadline so vaultSwap() falls back.
      await vi.advanceTimersByTimeAsync(overallTimeout);
      const result = await swapPromise;

      expect(result.ok).toBe(true);
      // `timeout` is per-attempt: the backend spending all of its own budget must not shorten the relay
      // wait. Sharing one deadline left this at the ~5s floor, which is how a slow chain hit RELAY_TIMEOUT.
      expect(mocks.relayTxAndWaitPacket.mock.calls.at(-1)?.[0]?.timeout).toBe(overallTimeout);
    } finally {
      vi.useRealTimers();
    }
  });

  it('defaults the backend submit-tx path ON, like swaps and bridge', () => {
    // `new Sodax()` with nothing configured. The three features resolve independently, so a caller
    // opting one out must not move the others.
    expect(sodaxDefaults.config.leverageYieldUseBackendSubmitTx).toBe(true);
    expect(sodaxDefaults.leverageYield.useBackendSubmitTx).toBe(true);

    const lyOff = new Sodax({ leverageYield: { useBackendSubmitTx: false } });
    expect(lyOff.config.leverageYieldUseBackendSubmitTx).toBe(false);
    expect(lyOff.config.swapUseBackendSubmitTx).toBe(true);
    expect(lyOff.config.bridgeUseBackendSubmitTx).toBe(true);

    const swapOff = new Sodax({ swaps: { useBackendSubmitTx: false } });
    expect(swapOff.config.leverageYieldUseBackendSubmitTx).toBe(true);

    const bridgeOff = new Sodax({ bridge: { useBackendSubmitTx: false } });
    expect(bridgeOff.config.leverageYieldUseBackendSubmitTx).toBe(true);
  });

  it('with the flag explicitly off, never touches the backend and raises a sub-floor timeout to the relay floor', async () => {
    // The module-level `sodax` sets `leverageYield.useBackendSubmitTx: false` → pure client-side flow.
    const intent = makeIntent(ARBITRUM);
    vi.spyOn(sodax.leverageYield, 'createVaultIntent').mockResolvedValueOnce({
      ok: true,
      value: {
        tx: '0xspokeTx',
        intent: { ...intent, feeAmount: 0n },
        relayData: { address: intent.creator, payload: '0xdata' },
      },
    });
    const submitSpy = vi.spyOn(sodax.api.leverageYield, 'submitTx');
    mocks.relayTxAndWaitPacket.mockResolvedValueOnce({ ok: true, value: { dst_tx_hash: '0xdstTx' } });
    mocks.solverPostExecution.mockResolvedValueOnce({ ok: true, value: { answer: 'OK', intent_hash: '0xhash' } });

    const result = await sodax.leverageYield.vaultSwap({
      params: vaultIntentParams(ARBITRUM, { dstChainKey: ARBITRUM as SpokeChainKey, dstAddress: SAMPLE_USER }),
      walletProvider: mockEvmProvider,
      timeout: 2_000,
    });

    expect(result.ok).toBe(true);
    expect(submitSpy).not.toHaveBeenCalled();
    expect(sodax.leverageYield.useBackendSubmitTx).toBe(false);
    expect(sodaxBE.leverageYield.useBackendSubmitTx).toBe(true);
    // The floor deliberately outranks a sub-floor caller `timeout` (matching SwapService): the intent
    // has already landed, and `relayTxAndWaitPacket` submits before `timeout` bounds the wait.
    expect(mocks.relayTxAndWaitPacket.mock.calls.at(-1)?.[0]?.timeout).toBe(RELAY_FALLBACK_FLOOR_MS);
  });
});

// =========================================================================
// Backend submit-tx call-through: extras.apiKey on the wire. Same 2-step flow as above, but the
// real LeverageYieldApiService transport runs against a test-local global fetch stub, so the
// `x-api-key` asserted is the header actually sent — not an argument recorded on a stubbed method.
// =========================================================================

describe('LeverageYieldService.vaultSwap — backend submit-tx extras.apiKey on the wire (call-through)', () => {
  // Backend path spelled out rather than inherited, like `sodaxBE` above: these tests are about the
  // key on the wire, and they should keep exercising the backend legs whatever the default is.
  const sodaxKeyed = new Sodax({
    apiKey: 'instance-key',
    leverageYield: { useBackendSubmitTx: true },
    logger: 'silent',
  });

  // The same payloads the spied specs above return — they satisfy the real leverage-yield schemas.
  const SUBMIT_TX_BODY = { success: true, data: { status: 'inserted', message: 'accepted' } };
  const SOLVED_STATUS_BODY = {
    success: true,
    data: {
      txHash: '0xspokeTx',
      srcChainKey: ARBITRUM,
      status: 'solved',
      processingAttempts: 1,
      result: { dstIntentTxHash: '0xDST', intent_hash: '0xhash' },
    },
  };

  const wireFetch = vi.fn();

  beforeEach(() => {
    wireFetch.mockReset();
    // Only the two submit-tx legs may reach fetch; anything else fails the test loudly. The
    // file-level afterEach calls `vi.unstubAllGlobals()`, so this does not leak.
    wireFetch.mockImplementation(async (url: unknown, init?: { method?: string }) => {
      const { pathname } = new URL(String(url));
      if (pathname === '/v1/leverage-yield/submit-tx' && init?.method === 'POST') {
        return { ok: true, status: 200, json: async () => SUBMIT_TX_BODY };
      }
      if (pathname === '/v1/leverage-yield/submit-tx/status' && (init?.method ?? 'GET') === 'GET') {
        return { ok: true, status: 200, json: async () => SOLVED_STATUS_BODY };
      }
      throw new Error(`unexpected fetch: ${init?.method ?? 'GET'} ${String(url)}`);
    });
    vi.stubGlobal('fetch', wireFetch);
  });

  const stubKeyedCreated = () => {
    const intent = makeIntent(ARBITRUM);
    vi.spyOn(sodaxKeyed.leverageYield, 'createVaultIntent').mockResolvedValueOnce({
      ok: true,
      value: {
        tx: '0xspokeTx',
        intent: { ...intent, feeAmount: 0n },
        relayData: { address: intent.creator, payload: '0xdata' },
      },
    });
    vi.spyOn(sodaxKeyed.spoke, 'verifyTxHash').mockResolvedValue({ ok: true, value: true });
  };

  const runKeyedVaultSwap = async (extras?: { apiKey?: string }) => {
    const before = wireFetch.mock.calls.length;
    stubKeyedCreated();
    const args = {
      params: vaultIntentParams(ARBITRUM, { dstChainKey: ARBITRUM as SpokeChainKey, dstAddress: SAMPLE_USER }),
      walletProvider: mockEvmProvider,
    };
    const result = await sodaxKeyed.leverageYield.vaultSwap(extras ? { ...args, extras } : args);
    expect(result.ok).toBe(true);
    // The value round-tripped through the real transport + schemas, not a stubbed method.
    if (result.ok) expect(result.value.intentDeliveryInfo.dstTxHash).toBe('0xDST');
    // Two legs per run — counted as a delta so a test can run several swaps in sequence.
    expect(wireFetch.mock.calls.length - before).toBe(2);
  };

  /** The `x-api-key` sent on every call to (pathname, method), read through `Headers` so any casing counts. */
  const keysSentTo = (pathname: string, method: string): (string | null)[] =>
    wireFetch.mock.calls
      .filter(call => new URL(String(call[0])).pathname === pathname && (call[1]?.method ?? 'GET') === method)
      .map(call => new Headers(call[1]?.headers).get('x-api-key'));

  it('sends extras.apiKey over the instance key on both legs, per action, falling back when omitted or empty', async () => {
    // The case the option exists for: several keys through ONE instance, which used to mean one
    // `Sodax` per key. The override is per call, so it must neither persist nor overwrite the
    // instance key.
    await runKeyedVaultSwap({ apiKey: 'tenant-A' });
    await runKeyedVaultSwap({ apiKey: 'tenant-B' });
    await runKeyedVaultSwap();
    await runKeyedVaultSwap({ apiKey: '' });
    await runKeyedVaultSwap({ apiKey: 'tenant-A' });

    const expected = ['tenant-A', 'tenant-B', 'instance-key', 'instance-key', 'tenant-A'];
    expect(keysSentTo('/v1/leverage-yield/submit-tx', 'POST')).toEqual(expected);
    expect(keysSentTo('/v1/leverage-yield/submit-tx/status', 'GET')).toEqual(expected);
  });
});

// =========================================================================
// getDetailedStatus — the source-tx status router (backend record | solver)
// =========================================================================

describe('LeverageYieldService.getDetailedStatus', () => {
  const sodaxDS = new Sodax({ logger: 'silent' });
  const SRC_TX = '0xabc123';
  const HUB_TX = '0x00000000000000000000000000000000000000000000000000000000000000ff';
  const key = { srcChainKey: ARBITRUM, srcTxHash: SRC_TX } as const;

  const statusData = (data: Record<string, unknown>) => ({
    txHash: SRC_TX,
    srcChainKey: ARBITRUM,
    status: 'relaying',
    processingAttempts: 1,
    ...data,
  });

  const record = (data: Record<string, unknown>) =>
    vi
      .spyOn(sodaxDS.api.leverageYield, 'getSubmitTxStatus')
      .mockResolvedValueOnce({ ok: true, value: { success: true, data: statusData(data) } } as never);

  const recordNotFound = () =>
    vi
      .spyOn(sodaxDS.api.leverageYield, 'getSubmitTxStatus')
      .mockResolvedValueOnce({ ok: true, value: { success: false, data: statusData({}) } } as never);

  const backendFails = (message: string, status: number) =>
    vi.spyOn(sodaxDS.api.leverageYield, 'getSubmitTxStatus').mockResolvedValueOnce({
      ok: false,
      error: new SodaxError('EXTERNAL_API_ERROR', message, {
        feature: 'backend',
        context: { api: 'leverageYield', endpoint: '/leverage-yield/submit-tx/status', status },
      }),
    } as never);

  const packets = (data: unknown[]) =>
    mocks.getTransactionPackets.mockResolvedValueOnce({ ok: true, value: { success: true, data } });

  // The relay has its own chain numbering, so derive it rather than hardcoding a chain id. These
  // identity fields are what the attribution guard inside `resolveDeliveredPacket` matches on.
  const RELAY_CHAIN_ID = Number(getIntentRelayChainId(ARBITRUM));
  const delivered = [{ status: 'executed', dst_tx_hash: HUB_TX, src_tx_hash: SRC_TX, src_chain_id: RELAY_CHAIN_ID }];

  const solverSays = (status: SolverIntentStatusCode, fill_tx_hash?: string) =>
    mocks.solverGetStatus.mockResolvedValueOnce({
      ok: true,
      value: { status, ...(fill_tx_hash ? { fill_tx_hash } : {}) },
    });

  beforeEach(() => {
    vi.restoreAllMocks();
    mocks.getTransactionPackets.mockReset();
    mocks.solverGetStatus.mockReset();
  });

  it('returns the unmodified submit-tx record without touching the relay or the solver', async () => {
    const statusSpy = record({ status: 'relaying' });

    const result = await sodaxDS.leverageYield.getDetailedStatus(key, { apiKey: 'per-action-key' });

    expect(statusSpy).toHaveBeenCalledWith({ txHash: SRC_TX, srcChainKey: ARBITRUM }, { apiKey: 'per-action-key' });

    expect(result.ok).toBe(true);
    if (!result.ok || result.value.source !== 'backend') throw new Error('expected a backend answer');
    expect(result.value.data.status).toBe('relaying');
    expect(mocks.getTransactionPackets).not.toHaveBeenCalled();
    expect(mocks.solverGetStatus).not.toHaveBeenCalled();
  });

  it.each([
    ['the record reports a success:false envelope', () => recordNotFound()],
    ['the backend abandoned the record mid-flight', () => record({ status: 'relayed', abandonedAt: 'now' })],
  ])('routes relay → hub hash → solver when %s', async (_case, arrange) => {
    arrange();
    packets(delivered);
    solverSays(SolverIntentStatusCode.SOLVED, '0xfill');

    const result = await sodaxDS.leverageYield.getDetailedStatus(key);

    expect(result.ok).toBe(true);
    if (!result.ok || result.value.source !== 'solver') throw new Error('expected the solver to answer');
    expect(result.value.dstTxHash).toBe(HUB_TX);
    expect(result.value.data.status).toBe(SolverIntentStatusCode.SOLVED);
    // The hash handed to the solver is the one the relay packet carried.
    expect(mocks.solverGetStatus.mock.calls[0]?.[0]).toEqual({ intent_tx_hash: HUB_TX });
  });

  it('skips the relay for a hub-source vault swap — the source tx IS the hub tx', async () => {
    backendFails('not found', 404);
    solverSays(SolverIntentStatusCode.SOLVED, '0xfill');

    const result = await sodaxDS.leverageYield.getDetailedStatus({ srcChainKey: SONIC, srcTxHash: HUB_TX });

    expect(result.ok).toBe(true);
    expect(mocks.getTransactionPackets).not.toHaveBeenCalled();
    expect(mocks.solverGetStatus.mock.calls[0]?.[0]).toEqual({ intent_tx_hash: HUB_TX });
  });

  it('never hands the solver a packet that is not a delivered match, or that carries a malformed hub hash', async () => {
    backendFails('not found', 404);
    packets([
      { status: 'executed', dst_tx_hash: HUB_TX, src_tx_hash: '0xsomeoneelse', src_chain_id: RELAY_CHAIN_ID },
      { status: 'validating', dst_tx_hash: '', src_tx_hash: SRC_TX, src_chain_id: RELAY_CHAIN_ID },
    ]);
    const unmatched = await sodaxDS.leverageYield.getDetailedStatus(key);

    // Fails rather than casting a non-hex hash.
    backendFails('not found', 404);
    packets([{ status: 'executed', dst_tx_hash: 'not-hex', src_tx_hash: SRC_TX, src_chain_id: RELAY_CHAIN_ID }]);
    const malformed = await sodaxDS.leverageYield.getDetailedStatus(key);

    if (unmatched.ok || malformed.ok) throw new Error('expected both lookups to fail');
    expect(unmatched.error.code).toBe('LOOKUP_FAILED');
    expect(malformed.error.code).toBe('LOOKUP_FAILED');
    expect(malformed.error.context?.reason).toBeUndefined();
    expect(mocks.solverGetStatus).not.toHaveBeenCalled();
  });

  it('tags only the undelivered-packet miss as budgetable, not an outage', async () => {
    backendFails('not found', 404);
    packets([]);
    const budgetable = await sodaxDS.leverageYield.getDetailedStatus(key);

    backendFails('backend unavailable', 503);
    packets([]);
    const unprovable = await sodaxDS.leverageYield.getDetailedStatus(key);

    expect(budgetable.ok).toBe(false);
    expect(unprovable.ok).toBe(false);
    if (budgetable.ok || unprovable.ok) return;
    // A relay miss behind a backend outage proves nothing, so it must not consume a caller's budget.
    expect(budgetable.error.context?.reason).toBe(DETAILED_STATUS_NOT_DELIVERED);
    expect(unprovable.error.context?.reason).toBeUndefined();
  });

  it('reconciles a solver NOT_FOUND against the durable intent record, keying every leg with the per-request key', async () => {
    backendFails('not found', 404);
    packets(delivered);
    solverSays(SolverIntentStatusCode.NOT_FOUND);
    // A vault intent reaches the same journal as a swap's — it is created on the same hub Intents
    // contract — so a restarted solver's amnesia is recoverable from the record.
    const intentSpy = vi.spyOn(sodaxDS.api, 'getIntentByTxHash').mockResolvedValueOnce({
      ok: true,
      value: {
        events: [{ eventType: 'intent-filled', txHash: '0xfillTx', intentState: { remainingInput: '0' } }],
      },
    } as never);

    const result = await sodaxDS.leverageYield.getDetailedStatus(key, { apiKey: 'per-action-key' });

    expect(result.ok).toBe(true);
    if (!result.ok || result.value.source !== 'solver') throw new Error('expected the solver arm');
    expect(result.value.data.status).toBe(SolverIntentStatusCode.SOLVED);
    expect(result.value.data.fill_tx_hash).toBe('0xfillTx');
    // One override keys the whole call. SolverApiService.getStatus takes the api key as its 5th
    // argument; the reconcile read keeps its clamped timeout alongside the key.
    expect(mocks.solverGetStatus.mock.calls[0]?.[4]).toBe('per-action-key');
    expect(intentSpy.mock.calls[0]?.[1]).toMatchObject({ apiKey: 'per-action-key', timeout: expect.any(Number) });
  });

  it('leaves a solver NOT_FOUND standing when the durable record answers with no terminal fill', async () => {
    backendFails('not found', 404);
    packets(delivered);
    solverSays(SolverIntentStatusCode.NOT_FOUND);
    // A partial fill does not settle the intent; only `remainingInput === '0'` does.
    vi.spyOn(sodaxDS.api, 'getIntentByTxHash').mockResolvedValueOnce({
      ok: true,
      value: {
        events: [{ eventType: 'intent-filled', txHash: '0xpartial', intentState: { remainingInput: '5' } }],
      },
    } as never);

    const result = await sodaxDS.leverageYield.getDetailedStatus(key);

    expect(result.ok).toBe(true);
    if (!result.ok || result.value.source !== 'solver') throw new Error('expected the solver arm');
    expect(result.value.data.status).toBe(SolverIntentStatusCode.NOT_FOUND);
  });

  // ── reconciling a non-final solver answer ──────────────────────────────

  const journal = (open: boolean, events: unknown[]): IntentResponse => ({
    intentHash: '0xintent',
    txHash: HUB_TX,
    logIndex: 0,
    chainId: 146,
    blockNumber: 1,
    open,
    intent: {
      intentId: '1',
      creator: '0xcreator',
      inputToken: '0xin',
      outputToken: '0xout',
      inputAmount: '1000',
      minOutputAmount: '900',
      deadline: '1791963740',
      allowPartialFill: false,
      srcChain: 1,
      dstChain: 146,
      srcAddress: '0xsrc',
      dstAddress: '0xdst',
      solver: '0xsolver',
      data: '0x',
    },
    events,
  });
  const cancelled = journal(false, [{ eventType: 'intent-cancelled', txHash: '0xcancel' }]);
  const journalReturns = (intent: IntentResponse) =>
    vi.spyOn(sodaxDS.api, 'getIntentByTxHash').mockResolvedValueOnce({ ok: true, value: intent });
  const solverStatusOf = (result: Awaited<ReturnType<typeof sodaxDS.leverageYield.getDetailedStatus>>) =>
    result.ok && result.value.source === 'solver' ? result.value.data : undefined;

  // The solver can keep reporting a keeper-cancelled vault intent in flight, which polls forever.
  it('reads a cancelled intent past a failed record as FAILED while the solver answers in flight', async () => {
    record({ status: 'failed', failureReason: 'Intent deadline expired', abandonedAt: '2026-10-14T07:48:07.869Z' });
    packets(delivered);
    solverSays(SolverIntentStatusCode.STARTED_NOT_FINISHED);
    journalReturns(cancelled);

    expect(solverStatusOf(await sodaxDS.leverageYield.getDetailedStatus(key))).toEqual({
      status: SolverIntentStatusCode.FAILED,
    });
  });

  it('leaves the solver answer standing when the intent is open, the journal unreadable, or the answer final', async () => {
    backendFails('not found', 404);
    packets(delivered);
    solverSays(SolverIntentStatusCode.STARTED_NOT_FINISHED);
    journalReturns(journal(true, []));
    expect(solverStatusOf(await sodaxDS.leverageYield.getDetailedStatus(key))?.status).toBe(
      SolverIntentStatusCode.STARTED_NOT_FINISHED,
    );

    backendFails('not found', 404);
    packets(delivered);
    solverSays(SolverIntentStatusCode.STARTED_NOT_FINISHED);
    vi.spyOn(sodaxDS.api, 'getIntentByTxHash').mockResolvedValueOnce({ ok: false, error: new Error('down') });
    expect(solverStatusOf(await sodaxDS.leverageYield.getDetailedStatus(key))?.status).toBe(
      SolverIntentStatusCode.STARTED_NOT_FINISHED,
    );

    // A final answer is not reconciled at all.
    backendFails('not found', 404);
    packets(delivered);
    solverSays(SolverIntentStatusCode.FAILED);
    const intentSpy = vi.spyOn(sodaxDS.api, 'getIntentByTxHash');
    intentSpy.mockClear();
    expect(solverStatusOf(await sodaxDS.leverageYield.getDetailedStatus(key))?.status).toBe(
      SolverIntentStatusCode.FAILED,
    );
    expect(intentSpy).not.toHaveBeenCalled();
  });

  it('treats a rejected API key (401 or 403) as terminal instead of degrading', async () => {
    for (const status of [401, 403]) {
      backendFails('rejected', status);

      const result = await sodaxDS.leverageYield.getDetailedStatus(key);

      expect(result.ok).toBe(false);
      if (result.ok) return;
      // Lifted so `isAuthFailure` recognises the wrapped error — it reads `context.status` only.
      expect(result.error.context?.status).toBe(status);
      expect(isAuthFailure(result.error)).toBe(true);
      expect(result.error.context?.reason).toBeUndefined();
    }
    // Routing on would bury the 401 behind a relay or solver error.
    expect(mocks.getTransactionPackets).not.toHaveBeenCalled();
    expect(mocks.solverGetStatus).not.toHaveBeenCalled();
  });

  it('leaves getIntentStatus unreconciled — one solver call, no durable-record lookup', async () => {
    // The reconcile belongs to the polled read. Folding it in here would add a round trip to every
    // NOT_FOUND and turn a NOT_FOUND behind an unreadable backend into an error for callers that
    // already ship against this contract.
    mocks.solverGetStatus.mockResolvedValueOnce({ ok: true, value: { status: SolverIntentStatusCode.NOT_FOUND } });
    const intentSpy = vi.spyOn(sodaxDS.api, 'getIntentByTxHash');

    const result = await sodaxDS.leverageYield.getIntentStatus({ intent_tx_hash: HUB_TX });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.status).toBe(SolverIntentStatusCode.NOT_FOUND);
    expect(intentSpy).not.toHaveBeenCalled();
    expect(mocks.solverGetStatus).toHaveBeenCalledTimes(1);
  });

  it('returns a Result rather than rejecting when a dependency throws', async () => {
    vi.spyOn(sodaxDS.api.leverageYield, 'getSubmitTxStatus').mockRejectedValueOnce(new Error('boom'));

    const result = await sodaxDS.leverageYield.getDetailedStatus(key);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('LOOKUP_FAILED');
  });
});

// ─── notifySolver — public manual-orchestration notify step ────────────────

describe('LeverageYieldService.notifySolver', () => {
  it('maps a solver error to EXTERNAL_API_ERROR with its solverCode, or a synthetic one when malformed', async () => {
    mocks.solverPostExecution
      .mockResolvedValueOnce({ ok: false, error: { detail: { code: -7, message: 'boom' } } })
      .mockResolvedValueOnce({ ok: false, error: {} });

    const detailed = await sodax.leverageYield.notifySolver({ intent_tx_hash: '0xhubIntentTx' });
    const malformed = await sodax.leverageYield.notifySolver({ intent_tx_hash: '0xhubIntentTx' });

    if (detailed.ok || malformed.ok) throw new Error('expected both notifications to fail');
    expect(detailed.error.code).toBe('EXTERNAL_API_ERROR');
    expect(detailed.error.context?.solverCode).toBe(-7);
    expect(detailed.error.context?.phase).toBe('postExecution');
    expect(malformed.error.code).toBe('EXTERNAL_API_ERROR');
    expect(malformed.error.context?.solverCode).toBe(-999);
  });
});

// ─── approve / isAllowanceValid — Sonic-direct underlying-asset allowance ──

describe('LeverageYieldService.approve', () => {
  it('resolves the vault asset and approves it to the vault, signed or raw', async () => {
    stubReadContract({ asset: SODA_ASSET });
    mocks.erc20Approve.mockResolvedValueOnce('0xapproveTx').mockResolvedValueOnce('0xrawApprove');

    const signed = await sodax.leverageYield.approve({ vault: VAULT, amount: 100n, walletProvider: mockEvmProvider });
    const raw = await sodax.leverageYield.approve({
      vault: VAULT,
      amount: 100n,
      walletProvider: mockEvmProvider,
      raw: true,
    });

    expect(signed).toEqual({ ok: true, value: '0xapproveTx' });
    expect(mocks.erc20Approve.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({ token: SODA_ASSET, spender: VAULT, from: SAMPLE_USER, amount: 100n, raw: false }),
    );
    expect(raw).toEqual({ ok: true, value: '0xrawApprove' });
    expect(mocks.erc20Approve.mock.calls[1]?.[0]).toEqual(expect.objectContaining({ raw: true }));
  });

  it('rejects a non-positive amount (VALIDATION_FAILED, field=amount) and wraps a getAsset failure as APPROVE_FAILED', async () => {
    const zero = await sodax.leverageYield.approve({ vault: VAULT, amount: 0n, walletProvider: mockEvmProvider });
    vi.spyOn(sodax.hubProvider.publicClient, 'readContract').mockRejectedValue(new Error('asset read failed'));
    const unreadable = await sodax.leverageYield.approve({
      vault: VAULT,
      amount: 100n,
      walletProvider: mockEvmProvider,
    });

    if (zero.ok || unreadable.ok) throw new Error('expected both approvals to fail');
    expect(zero.error.code).toBe('VALIDATION_FAILED');
    expect(zero.error.context?.field).toBe('amount');
    expect(unreadable.error.code).toBe('APPROVE_FAILED');
    expect(mocks.erc20Approve).not.toHaveBeenCalled();
  });
});

describe('LeverageYieldService.isAllowanceValid', () => {
  it('compares the on-chain allowance against the amount', async () => {
    stubReadContract({ asset: SODA_ASSET, allowance: 100n });
    expect(await sodax.leverageYield.isAllowanceValid({ vault: VAULT, amount: 50n, owner: SAMPLE_USER })).toEqual({
      ok: true,
      value: true,
    });
    expect(await sodax.leverageYield.isAllowanceValid({ vault: VAULT, amount: 150n, owner: SAMPLE_USER })).toEqual({
      ok: true,
      value: false,
    });
  });

  it('rejects a non-positive amount (action=allowanceCheck) and wraps a getAsset failure as ALLOWANCE_CHECK_FAILED', async () => {
    const zero = await sodax.leverageYield.isAllowanceValid({ vault: VAULT, amount: 0n, owner: SAMPLE_USER });
    vi.spyOn(sodax.hubProvider.publicClient, 'readContract').mockRejectedValue(new Error('asset read failed'));
    const unreadable = await sodax.leverageYield.isAllowanceValid({ vault: VAULT, amount: 50n, owner: SAMPLE_USER });

    if (zero.ok || unreadable.ok) throw new Error('expected both checks to fail');
    expect(zero.error.code).toBe('VALIDATION_FAILED');
    expect(zero.error.context?.action).toBe('allowanceCheck');
    expect(unreadable.error.code).toBe('ALLOWANCE_CHECK_FAILED');
  });
});

// ─── getMaxWithdrawForUser — hub-wallet resolution + dust-buffer clamp ──

describe('LeverageYieldService.getMaxWithdrawForUser', () => {
  it('trims MAX_WITHDRAW_DUST_BUFFER (1000) from the on-chain maxWithdraw, clamping to 0 below it', async () => {
    mocks.erc4626GetMaxWithdraw
      .mockResolvedValueOnce({ ok: true, value: 10_000n })
      .mockResolvedValueOnce({ ok: true, value: 500n });
    expect(await sodax.leverageYield.getMaxWithdrawForUser(VAULT, ARBITRUM, SAMPLE_USER)).toEqual({
      ok: true,
      value: 9_000n,
    });
    expect(mocks.erc4626GetMaxWithdraw.mock.calls[0]?.slice(0, 2)).toEqual([VAULT, HUB_WALLET]);
    // No underflow below the buffer.
    expect(await sodax.leverageYield.getMaxWithdrawForUser(VAULT, ARBITRUM, SAMPLE_USER)).toEqual({
      ok: true,
      value: 0n,
    });
  });

  it('propagates the inner getMaxWithdraw LOOKUP_FAILED, and wraps a hub-wallet failure with srcChainKey', async () => {
    mocks.erc4626GetMaxWithdraw.mockResolvedValueOnce({ ok: false, error: new Error('maxWithdraw revert') });
    const inner = await sodax.leverageYield.getMaxWithdrawForUser(VAULT, ARBITRUM, SAMPLE_USER);
    mocks.getUserHubWalletAddress.mockReset();
    mocks.getUserHubWalletAddress.mockRejectedValueOnce(new Error('hub wallet derivation failed'));
    const hubWallet = await sodax.leverageYield.getMaxWithdrawForUser(VAULT, ARBITRUM, SAMPLE_USER);

    if (inner.ok || hubWallet.ok) throw new Error('expected both lookups to fail');
    expect(inner.error.code).toBe('LOOKUP_FAILED');
    expect(inner.error.context?.method).toBe('getMaxWithdraw');
    expect(hubWallet.error.code).toBe('LOOKUP_FAILED');
    expect(hubWallet.error.context?.method).toBe('getMaxWithdrawForUser');
    expect(hubWallet.error.context?.srcChainKey).toBe(ARBITRUM);
  });
});

// ─── Representative reads — tuple decode, balanceOf, Erc4626 delegation ──

describe('LeverageYieldService reads', () => {
  it('getPosition decodes the getPositionDetails tuple into named fields', async () => {
    stubReadContract({ position: [1n, 2n, 3n, 4n, 5n] });
    const result = await sodax.leverageYield.getPosition(VAULT);
    expect(result).toEqual({ ok: true, value: { collateral: 1n, debt: 2n, ltv: 3n, healthFactor: 4n, idleAsset: 5n } });
  });

  it('getTotalAssets / previewDeposit / previewWithdraw / previewRedeem forward the Erc4626 value', async () => {
    mocks.erc4626GetTotalAssets.mockResolvedValueOnce({ ok: true, value: 5_000n });
    mocks.erc4626PreviewDeposit.mockResolvedValueOnce({ ok: true, value: 11n });
    mocks.erc4626PreviewWithdraw.mockResolvedValueOnce({ ok: true, value: 22n });
    mocks.erc4626PreviewRedeem.mockResolvedValueOnce({ ok: true, value: 33n });

    expect(await sodax.leverageYield.getTotalAssets(VAULT)).toEqual({ ok: true, value: 5_000n });
    expect(await sodax.leverageYield.previewDeposit(VAULT, 100n)).toEqual({ ok: true, value: 11n });
    expect(await sodax.leverageYield.previewWithdraw(VAULT, 100n)).toEqual({ ok: true, value: 22n });
    expect(await sodax.leverageYield.previewRedeem(VAULT, 100n)).toEqual({ ok: true, value: 33n });
  });

  it('maps an Erc4626 failure to LOOKUP_FAILED tagged with the calling method', async () => {
    mocks.erc4626GetTotalAssets.mockResolvedValueOnce({ ok: false, error: new Error('totalAssets revert') });
    mocks.erc4626PreviewRedeem.mockResolvedValueOnce({ ok: false, error: new Error('previewRedeem revert') });

    const totalAssets = await sodax.leverageYield.getTotalAssets(VAULT);
    const previewRedeem = await sodax.leverageYield.previewRedeem(VAULT, 100n);

    if (totalAssets.ok || previewRedeem.ok) throw new Error('expected both reads to fail');
    expect(totalAssets.error.code).toBe('LOOKUP_FAILED');
    expect(totalAssets.error.context?.method).toBe('getTotalAssets');
    expect(previewRedeem.error.code).toBe('LOOKUP_FAILED');
    expect(previewRedeem.error.context?.method).toBe('previewRedeem');
  });

  it('getEffectiveApr propagates a getApr failure (LOOKUP_FAILED, method=getApr)', async () => {
    // getEffectiveApr awaits getApr + getLsdApr together; the failing fetch hits the retry
    // back-off, so fake timers keep the test fast.
    vi.useFakeTimers();
    vi.spyOn(sodax.config.logger, 'warn').mockImplementation(() => {});
    vi.spyOn(sodax.hubProvider.publicClient, 'readContract').mockRejectedValue(new Error('rpc down'));
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network'))); // getLsdApr falls back (ok)

    const promise = sodax.leverageYield.getEffectiveApr(VAULT);
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('LOOKUP_FAILED');
    expect(result.error.context?.method).toBe('getApr');
  });
});

// ─── Partner-fee precedence, end to end through both builders ─────────────

/**
 * The precedence chain is `per-intent ?? leverageYield.partnerFee ?? global fee ?? none`, resolved
 * at a single point in `createVaultIntent`. These cases drive it through the **builders** —
 * `deposit()` and `withdraw()` — because that hop is what differs per flow: each must forward a
 * caller fee onto the payload and leave the key absent otherwise. Every case also sets
 * `swaps.partnerFee` to a distinct value it must never pick up.
 */
describe('LeverageYieldService — partner-fee precedence end to end', () => {
  const PARAM = { address: SAMPLE_USER, percentage: 10 } as const satisfies PartnerFee;
  const FEATURE = { address: HUB_WALLET, percentage: 100 } as const satisfies PartnerFee;
  const GLOBAL = { address: POOL, percentage: 25 } as const satisfies PartnerFee;
  const SWAPS = { address: BORROW_TOKEN, percentage: 77 } as const satisfies PartnerFee;

  const mk = (o: SodaxOptions) => {
    const s = new Sodax(o);
    vi.spyOn(s.config, 'isValidOriginalAssetAddress').mockReturnValue(true);
    vi.spyOn(s.config, 'isValidSpokeChainKey').mockReturnValue(true);
    vi.spyOn(s.hubProvider, 'getUserHubWalletAddress').mockResolvedValue(HUB_WALLET);
    vi.spyOn(s.hubProvider.publicClient, 'getBlock').mockResolvedValue({ timestamp: 1n } as never);
    return s;
  };

  const runDeposit = async (o: SodaxOptions, partnerFee?: PartnerFee) => {
    const s = mk(o);
    mocks.constructCreateIntentData.mockClear();
    mocks.constructCreateIntentData.mockReturnValueOnce(['0xd', makeIntent(ARBITRUM), 0n]);
    vi.spyOn(s.spoke, 'deposit').mockResolvedValueOnce({ ok: true, value: '0xtx' });
    const built = await s.leverageYield.deposit({
      vault: VAULT,
      srcChainKey: ARBITRUM,
      srcAddress: SAMPLE_USER,
      inputToken: SPOKE_TOKEN,
      inputAmount: 1_000n,
      minOutputAmount: 900n,
      ...(partnerFee && { partnerFee }),
    });
    if (!built.ok) throw new Error('deposit build failed');
    await s.leverageYield.createVaultIntent({ ...built.value, walletProvider: mockEvmProvider, raw: false });
    expect(mocks.constructCreateIntentData).toHaveBeenCalledTimes(1);
    return mocks.constructCreateIntentData.mock.calls[0]?.[3];
  };

  const runWithdraw = async (o: SodaxOptions, partnerFee?: PartnerFee) => {
    const s = mk(o);
    mocks.constructCreateIntentData.mockClear();
    mocks.constructCreateIntentData.mockReturnValueOnce(['0xd', makeIntent(ARBITRUM), 0n]);
    vi.spyOn(s.spoke, 'sendMessage').mockResolvedValueOnce({ ok: true, value: '0xmsg' });
    const built = await s.leverageYield.withdraw({
      vault: VAULT,
      srcChainKey: ARBITRUM,
      srcAddress: SAMPLE_USER,
      dstChainKey: ARBITRUM,
      outputToken: SPOKE_TOKEN,
      inputAmount: 1_000n,
      minOutputAmount: 900n,
      ...(partnerFee && { partnerFee }),
    });
    if (!built.ok) throw new Error('withdraw build failed');
    await s.leverageYield.createVaultIntent({ ...built.value, walletProvider: mockEvmProvider, raw: false });
    expect(mocks.constructCreateIntentData).toHaveBeenCalledTimes(1);
    return mocks.constructCreateIntentData.mock.calls[0]?.[3];
  };

  it.each([
    ['deposit', runDeposit],
    ['withdraw', runWithdraw],
  ] as const)('%s: param fee > feature fee > global fee > none, never swaps.partnerFee', async (_name, run) => {
    const all = { fee: GLOBAL, swaps: { partnerFee: SWAPS }, leverageYield: { partnerFee: FEATURE } };
    expect(await run(all, PARAM)).toEqual(PARAM);
    expect(await run(all)).toEqual(FEATURE);
    expect(await run({ fee: GLOBAL, swaps: { partnerFee: SWAPS } })).toEqual(GLOBAL);
    expect(await run({ swaps: { partnerFee: SWAPS } })).toBeUndefined();
  });
});

// ── Leverage positions ────────────────────────────────────────────────────────
//
// Positions are the unpooled counterpart to the vaults above. The deployed factory ships as a
// packaged default, so the tests cover both halves of that: the default resolving with nothing
// configured, and a blanked-out override still failing closed rather than reaching for a
// placeholder.

const POSITION = '0x1111111111111111111111111111111111111111' as Address;
const POSITION_OWNER = '0x2222222222222222222222222222222222222222' as Address;
const POSITION_FACTORY = '0x3333333333333333333333333333333333333333' as Address;
const POS_COLLATERAL = '0x243b0c26c8b38793908d7C64e8510f21B19B4613' as Address;
const POS_BORROW_TOKEN = '0xb780e09576C2667ba9F5B80FbAb2e6b8A0a21e37' as Address;

/** A Sodax instance with the position factory configured, for the happy paths. */
function sodaxWithFactory(): Sodax {
  const instance = new Sodax({ leverageYield: { positionFactory: POSITION_FACTORY } });
  // Fresh instance, fresh public client — the `beforeEach` stub is on the shared `sodax`, so without
  // this every hub-side test here waits on a real RPC and times out.
  vi.spyOn(instance.hubProvider.publicClient, 'waitForTransactionReceipt').mockResolvedValue({
    status: 'success',
  } as never);
  return instance;
}

/**
 * The factory now ships in `leverageYieldConfig`, so "not configured" is only reachable by
 * overriding it with an empty value — which is exactly what a bad env var produces.
 */
function sodaxWithoutFactory(): Sodax {
  return new Sodax({ leverageYield: { positionFactory: '' as Address } });
}

describe('LeverageYieldService — hub operations wait for the transaction', () => {
  it('fails when the hub transaction reverted, rather than reporting the broadcast as success', async () => {
    const configured = sodaxWithFactory();
    vi.spyOn(configured.hubProvider, 'getUserHubWalletAddress').mockResolvedValue(HUB_WALLET);
    vi.spyOn(configured.spoke, 'verifyTxHash').mockResolvedValue({ ok: true, value: true });
    vi.spyOn(configured.spoke, 'sendMessage').mockResolvedValueOnce({ ok: true, value: '0xhubTx' } as never);
    // `verifyTxHash` says fine because on EVM it does not wait; the receipt is what tells the truth.
    vi.spyOn(configured.hubProvider.publicClient, 'waitForTransactionReceipt').mockResolvedValue({
      status: 'reverted',
    } as never);

    const result = await configured.leverageYield.operatePosition({
      params: {
        srcChainKey: 'sonic',
        srcAddress: SAMPLE_USER,
        calls: [{ from: HUB_WALLET, to: POSITION, value: 0n, data: '0x1234' }],
      },
      walletProvider: mockEvmProvider as never,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('TX_VERIFICATION_FAILED');
  });
});

describe('LeverageYieldService — the funding spender per source chain', () => {
  const ARB_ASSET_MANAGER = sodax.config.getChainConfig(ARBITRUM).addresses.assetManager;

  /**
   * The regression: the spoke asset manager was left to a default that only the allowance-read side
   * has, so the approval was encoded with no spender at all and threw before reaching the wallet.
   * Deliberately does NOT stub `spoke.approve` — the assertion is on what the ERC-20 layer receives.
   */
  it('approves the spoke asset manager on an EVM spoke, all the way down to the ERC-20 call', async () => {
    mocks.erc20Approve.mockResolvedValueOnce('0xapproveTx');
    (mockEvmProvider.waitForTransactionReceipt as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      status: 'success',
    } as never);

    const result = await sodax.leverageYield.approvePositionFunding({
      srcChainKey: ARBITRUM,
      srcAddress: SAMPLE_USER,
      token: POS_COLLATERAL,
      amount: 100n,
      walletProvider: mockEvmProvider as never,
    });

    expect(result).toEqual({ ok: true, value: '0xapproveTx' });
    expect(mocks.erc20Approve.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({ spender: ARB_ASSET_MANAGER, token: POS_COLLATERAL, amount: 100n }),
    );
  });

  it('asks for no spender on Stellar, where the approval is a trustline', async () => {
    const approve = vi.spyOn(sodax.spoke, 'approve').mockResolvedValue({ ok: true, value: '0xtrustline' } as never);

    await sodax.leverageYield.approvePositionFunding({
      srcChainKey: ChainKeys.STELLAR_MAINNET,
      srcAddress: SAMPLE_USER,
      token: POS_COLLATERAL,
      amount: 100n,
      walletProvider: mockBitcoinProvider as never,
    });

    expect(approve.mock.calls[0]?.[0]).not.toHaveProperty('spender');
  });

  it('fails a chain with no approval concept as APPROVE_FAILED, and reports its allowance as valid, without a spender', async () => {
    const approve = vi.spyOn(sodax.spoke, 'approve');
    const isAllowanceValid = vi.spyOn(sodax.spoke, 'isAllowanceValid');
    const solana = {
      srcChainKey: ChainKeys.SOLANA_MAINNET,
      srcAddress: SAMPLE_USER,
      token: POS_COLLATERAL,
      amount: 100n,
    };

    const approval = await sodax.leverageYield.approvePositionFunding({
      ...solana,
      walletProvider: mockBitcoinProvider as never,
    });
    const allowance = await sodax.leverageYield.isPositionFundingAllowanceValid(solana);

    expect(approval.ok).toBe(false);
    if (approval.ok) return;
    expect(approval.error.code).toBe('APPROVE_FAILED');
    expect(approve).not.toHaveBeenCalled();
    expect(allowance).toEqual({ ok: true, value: true });
    expect(isAllowanceValid.mock.calls[0]?.[0]).not.toHaveProperty('spender');
  });

  it('reads the allowance against the same spender the approval uses', async () => {
    const isAllowanceValid = vi.spyOn(sodax.spoke, 'isAllowanceValid').mockResolvedValue({ ok: true, value: true });

    await sodax.leverageYield.isPositionFundingAllowanceValid({
      srcChainKey: 'sonic',
      srcAddress: SAMPLE_USER,
      token: POS_COLLATERAL,
      amount: 100n,
    });
    await sodax.leverageYield.isPositionFundingAllowanceValid({
      srcChainKey: ARBITRUM,
      srcAddress: SAMPLE_USER,
      token: POS_COLLATERAL,
      amount: 100n,
    });

    expect(isAllowanceValid.mock.calls[0]?.[0]).toEqual(expect.objectContaining({ spender: HUB_WALLET }));
    expect(isAllowanceValid.mock.calls[1]?.[0]).toEqual(expect.objectContaining({ spender: ARB_ASSET_MANAGER }));
  });

  it('rejects a non-positive amount before resolving any spender or touching the wallet', async () => {
    const isAllowanceValid = vi.spyOn(sodax.spoke, 'isAllowanceValid');
    const approve = vi.spyOn(sodax.spoke, 'approve');
    const zero = { srcAddress: SAMPLE_USER, token: POS_COLLATERAL, amount: 0n } as const;

    const allowance = await sodax.leverageYield.isPositionFundingAllowanceValid({ ...zero, srcChainKey: ARBITRUM });
    const approval = await sodax.leverageYield.approvePositionFunding({
      ...zero,
      srcChainKey: 'sonic',
      walletProvider: mockEvmProvider as never,
    });

    expect(allowance.ok).toBe(false);
    expect(approval.ok).toBe(false);
    expect(isAllowanceValid).not.toHaveBeenCalled();
    expect(approve).not.toHaveBeenCalled();
  });
});

describe('LeverageYieldService.approvePositionFunding — waiting for the approve to land', () => {
  /**
   * The whole point of this method over a bare `spoke.approve`. `spoke.verifyTxHash` returns
   * `{ ok: true }` for EVM WITHOUT waiting, so relying on it left the caller's next allowance read
   * seeing the pre-approval value — the live symptom was being asked to approve twice.
   */
  it('approves the user hub wallet on the hub and waits on the EVM provider receipt, not on verifyTxHash', async () => {
    const approve = vi.spyOn(sodax.spoke, 'approve').mockResolvedValue({ ok: true, value: '0xapproveTx' } as never);
    const verify = vi.spyOn(sodax.spoke, 'verifyTxHash').mockResolvedValue({ ok: true, value: true });
    const wait = mockEvmProvider.waitForTransactionReceipt as ReturnType<typeof vi.fn>;
    wait.mockResolvedValueOnce({ status: 'success' } as never);

    const result = await sodax.leverageYield.approvePositionFunding({
      srcChainKey: 'sonic',
      srcAddress: SAMPLE_USER,
      token: POS_COLLATERAL,
      amount: 100n,
      walletProvider: mockEvmProvider as never,
    });

    expect(result).toEqual({ ok: true, value: '0xapproveTx' });
    expect(approve.mock.calls[0]?.[0]).toEqual(expect.objectContaining({ spender: HUB_WALLET }));
    expect(wait).toHaveBeenCalledWith('0xapproveTx');
    // The non-waiting path must NOT be what gates the return on EVM.
    expect(verify).not.toHaveBeenCalled();
  });

  it('falls back to verifyTxHash for a non-EVM provider, and fails closed when it reports failure', async () => {
    vi.spyOn(sodax.spoke, 'approve').mockResolvedValue({ ok: true, value: '0xapproveTx' } as never);
    vi.spyOn(sodax.spoke, 'verifyTxHash').mockResolvedValue({
      ok: false,
      error: new Error('reverted'),
    } as never);

    const result = await sodax.leverageYield.approvePositionFunding({
      srcChainKey: 'sonic',
      srcAddress: SAMPLE_USER,
      token: POS_COLLATERAL,
      amount: 100n,
      walletProvider: mockBitcoinProvider as never,
    });

    expect(result.ok).toBe(false);
  });
});

describe('LeverageYieldService — positions, factory misconfigured', () => {
  const createParams = {
    from: POSITION_OWNER,
    owner: POSITION_OWNER,
    collateral: POS_COLLATERAL,
    borrowToken: POS_BORROW_TOKEN,
    eModeCategory: 3,
    origin: { chainKey: 'sonic', address: POSITION_OWNER },
    initialAssets: 1n,
    borrowAmount: 1n,
    minCollateralOut: 1n,
  } as const;

  it('fails every factory-backed method closed on a blanked-out factory, rather than using a placeholder', async () => {
    const blank = sodaxWithoutFactory();
    const list = await blank.leverageYield.listPositions(POSITION_OWNER);
    expect(list.ok).toBe(false);
    if (!list.ok) expect(list.error.code).toBe('LOOKUP_FAILED');
    expect((await blank.leverageYield.predictPosition(POSITION_OWNER, POSITION_OWNER)).ok).toBe(false);
    expect(blank.leverageYield.buildCreatePositionAndLeverage(createParams).ok).toBe(false);
  });

  it('refuses an origin a refund could never reach: a spoke with no refund asset, or an MPC-relay origin', () => {
    const configured = sodaxWithFactory();
    const base = {
      from: POSITION_OWNER,
      owner: POSITION_OWNER,
      collateral: POS_COLLATERAL,
      borrowToken: POS_BORROW_TOKEN,
      eModeCategory: 0,
      initialAssets: 10n ** 18n,
      borrowAmount: 1_000n,
      minCollateralOut: 1n,
    } as const;
    // Off-hub with nothing to unwrap into: the AssetManager moves only its own registered assets.
    const noAsset = configured.leverageYield.buildCreatePositionAndLeverage({
      ...base,
      origin: { chainKey: '0xa4b1.arbitrum', address: POSITION_OWNER },
    });
    const mpc = configured.leverageYield.buildCreatePositionAndLeverage({
      ...base,
      origin: { chainKey: ChainKeys.TRON_MAINNET, address: TRON_TEST_ADDRESS, asset: POS_COLLATERAL },
    });

    expect(noAsset.ok).toBe(false);
    expect(mpc).toMatchObject({ ok: false, error: { code: 'LOOKUP_FAILED' } });
  });

  it('reads pending state off the position without a factory, flagging a resolved-but-unswept slot', async () => {
    // `sodax` has no factory configured, but this read targets the position directly.
    vi.spyOn(sodax.hubProvider.publicClient, 'readContract').mockResolvedValue(true as never);
    const live = await sodax.leverageYield.getPositionPendingState(POSITION);
    expect(live.ok && live.value.isLive).toBe(true);

    // The state that strands funds: an operation is recorded but its intent is gone, so the grant
    // is still open and any debt-side contribution is still sitting in the position.
    vi.spyOn(sodax.hubProvider.publicClient, 'readContract').mockImplementation((async ({
      functionName,
    }: {
      functionName: string;
    }) => (functionName === 'hasPendingOperation' ? false : 3)) as never);
    const stranded = await sodax.leverageYield.getPositionPendingState(POSITION);
    expect(stranded).toEqual({ ok: true, value: { kind: 3, isLive: false, needsSettle: true } });
  });
});

describe('LeverageYieldService — position reads', () => {
  it('getPositionAccount reads getUserAccountData against the configured lending pool', async () => {
    const configured = sodaxWithFactory();
    const accountData = [1000n, 400n, 200n, 9700n, 9100n, 1_066_000_000_000_000_000n] as const;
    const calls: { functionName: string; address: Address }[] = [];
    vi.spyOn(configured.hubProvider.publicClient, 'readContract').mockImplementation((async (call: {
      functionName: string;
      address: Address;
    }) => {
      calls.push({ functionName: call.functionName, address: call.address });
      if (call.functionName === 'getUserAccountData') return accountData;
      throw new Error(`unexpected read: ${call.functionName}`);
    }) as never);

    const result = await configured.leverageYield.getPositionAccount(POSITION);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // One round trip, against the pool from config — not the position's own pool() getter.
    expect(calls).toEqual([
      { functionName: 'getUserAccountData', address: configured.config.sodaxConfig.moneyMarket.lendingPool },
    ]);
    expect(result.value.healthFactor).toBe(1_066_000_000_000_000_000n);
    expect(result.value.currentLiquidationThreshold).toBe(9700n);
  });

  it('getPositionCollateralBalance reads the aToken balance, taking the reserve from the configured pool', async () => {
    const configured = sodaxWithFactory();
    const aToken = '0x00000000000000000000000000000000000000a1' as Address;
    const calls: { functionName: string; address: Address; args?: readonly unknown[] }[] = [];
    vi.spyOn(configured.hubProvider.publicClient, 'readContract').mockImplementation((async (call: {
      functionName: string;
      address: Address;
      args?: readonly unknown[];
    }) => {
      calls.push({ functionName: call.functionName, address: call.address, args: call.args });
      if (call.functionName === 'getReserveData') return { aTokenAddress: aToken };
      if (call.functionName === 'balanceOf') return 4_200n;
      throw new Error(`unexpected read: ${call.functionName}`);
    }) as never);

    const result = await configured.leverageYield.getPositionCollateralBalance(POSITION, POS_COLLATERAL);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toEqual({ aToken, balance: 4_200n });
    // The reserve lookup goes to the pool from config; the balance is read off the aToken it names,
    // for the position — not for the owner, which holds none of it.
    expect(calls).toEqual([
      {
        functionName: 'getReserveData',
        address: configured.config.sodaxConfig.moneyMarket.lendingPool,
        args: [POS_COLLATERAL],
      },
      { functionName: 'balanceOf', address: aToken, args: [POSITION] },
    ]);
  });

  it('getPositionCollateralBalance resolves the collateral off the position when not given one', async () => {
    const configured = sodaxWithFactory();
    const seen: string[] = [];
    vi.spyOn(configured.hubProvider.publicClient, 'readContract').mockImplementation((async (call: {
      functionName: string;
      args?: readonly unknown[];
    }) => {
      seen.push(call.functionName);
      if (call.functionName === 'collateral') return POS_COLLATERAL;
      if (call.functionName === 'getReserveData') {
        expect(call.args).toEqual([POS_COLLATERAL]);
        return { aTokenAddress: POS_COLLATERAL };
      }
      return 1n;
    }) as never);

    const result = await configured.leverageYield.getPositionCollateralBalance(POSITION);
    expect(result.ok).toBe(true);
    expect(seen).toEqual(['collateral', 'getReserveData', 'balanceOf']);
  });

  it('wraps a getPositionInfo or getPositionCollateralBalance read failure as LOOKUP_FAILED', async () => {
    const configured = sodaxWithFactory();
    vi.spyOn(configured.hubProvider.publicClient, 'readContract').mockRejectedValue(new Error('rpc down'));
    const info = await configured.leverageYield.getPositionInfo(POSITION);
    const balance = await configured.leverageYield.getPositionCollateralBalance(POSITION, POS_COLLATERAL);
    if (info.ok || balance.ok) throw new Error('expected both reads to fail');
    expect(info.error.code).toBe('LOOKUP_FAILED');
    expect(balance.error.code).toBe('LOOKUP_FAILED');
  });

  it("predictPosition defaults to the OWNER's next id, not a global counter", async () => {
    const configured = sodaxWithFactory();
    const seen: Record<string, readonly unknown[] | undefined> = {};
    vi.spyOn(configured.hubProvider.publicClient, 'readContract').mockImplementation((async (call: {
      functionName: string;
      args?: readonly unknown[];
    }) => {
      seen[call.functionName] = call.args;
      if (call.functionName === 'nextPositionIdFor') return 7n;
      return POSITION;
    }) as never);

    const result = await configured.leverageYield.predictPosition(POSITION_OWNER, POSITION_OWNER);
    expect(result.ok).toBe(true);
    // Per-owner, so another user creating a position cannot shift the address a funder predicted.
    expect(seen.nextPositionIdFor).toEqual([POSITION_OWNER]);
    expect(seen.predictPosition).toEqual([POSITION_OWNER, POSITION_OWNER, 7n]);
  });
});

describe('LeverageYieldService — position transaction builders', () => {
  it('leverage, withdraw and cancel builders all target the position itself', () => {
    const configured = sodaxWithFactory();
    const add = configured.leverageYield.buildAddLeverage({
      from: POSITION_OWNER,
      position: POSITION,
      borrowAmount: 1_000n,
      minCollateralOut: 1n,
    });
    const dec = configured.leverageYield.buildDecreaseLeverage({
      from: POSITION_OWNER,
      position: POSITION,
      collateralIn: 500n,
      minDebtOut: 1n,
    });
    const withdraw = configured.leverageYield.buildPositionWithdraw({
      from: POSITION_OWNER,
      position: POSITION,
      amount: 1n,
      to: POSITION_OWNER,
    });
    const cancel = configured.leverageYield.buildCancelPositionOperation({
      from: POSITION_OWNER,
      position: POSITION,
    });
    for (const tx of [add, dec, withdraw, cancel]) expect(tx.to).toBe(POSITION);
    // Distinct selectors — guards against wiring both leverage builders to the same function.
    expect(add.data.slice(0, 10)).not.toBe(dec.data.slice(0, 10));
    expect(cancel.data.length).toBe(10); // no args
  });
});

describe('LeverageYieldService — combined create + leverage', () => {
  it('buildCreatePositionAndLeverage targets the factory and is distinct from the debt-side open', () => {
    const configured = sodaxWithFactory();
    const base = {
      from: POSITION_OWNER,
      owner: POSITION_OWNER,
      collateral: POS_COLLATERAL,
      borrowToken: POS_BORROW_TOKEN,
      eModeCategory: 0,
      // Hub origin: a refund is a plain transfer, so no unwrap asset is needed.
      origin: { chainKey: 'sonic', address: POSITION_OWNER },
    } as const;

    const combined = configured.leverageYield.buildCreatePositionAndLeverage({
      ...base,
      initialAssets: 10n ** 18n,
      borrowAmount: 1_000n,
      minCollateralOut: 1n,
    });
    const debtSide = configured.leverageYield.buildCreatePositionFromDebtToken({
      ...base,
      contribution: 10n ** 18n,
      totalInput: 2n * 10n ** 18n,
      minCollateralOut: 1n,
    });

    expect(combined.ok).toBe(true);
    expect(debtSide.ok).toBe(true);
    if (!combined.ok || !debtSide.ok) return;
    expect(combined.value.to).toBe(POSITION_FACTORY);
    expect(combined.value.value).toBe(0n);
    // Distinct selectors — the two opens pull different tokens, so crossing them would take the
    // wrong asset from the caller.
    expect(combined.value.data.slice(0, 10)).not.toBe(debtSide.value.data.slice(0, 10));
  });
});

/** The address a position will be created at — what funding is transferred to. */
const PREDICTED_POSITION = '0x00000000000000000000000000000000000000ff' as Address;

/**
 * Stubs the two factory reads the data builders make to resolve the predicted address.
 *
 * `ids` may be a queue, so a caller can advance `nextPositionIdFor` between builds; `predicted`
 * may be a function of the id, so each id maps to its own address.
 */
function stubFactoryPrediction(
  sodaxInstance: Sodax,
  ids: bigint | bigint[],
  predicted: Address | ((id: bigint) => Address),
): void {
  const queue = Array.isArray(ids) ? [...ids] : null;
  let current = Array.isArray(ids) ? 0n : ids;
  vi.spyOn(sodaxInstance.hubProvider.publicClient, 'readContract').mockImplementation((async (call: {
    functionName: string;
    args: readonly unknown[];
  }) => {
    if (call.functionName === 'nextPositionIdFor') {
      current = queue ? (queue.shift() ?? current) : current;
      return current;
    }
    if (call.functionName === 'predictPosition') {
      const id = call.args[2] as bigint;
      return typeof predicted === 'function' ? predicted(id) : predicted;
    }
    throw new Error(`unexpected read: ${call.functionName}`);
  }) as never);
}

/** Decodes an `encodeContractCalls` payload back into the batch it represents. */
function decodeBatchCalls(payload: Hex): { address: Address; value: bigint; data: Hex }[] {
  const [calls] = decodeAbiParameters(
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
    payload,
  );
  return calls as { address: Address; value: bigint; data: Hex }[];
}

/**
 * The cap has to hold on every path that writes `PositionConfig.feeBps`, not just the one the fee
 * tests drive: a builder that skipped `resolvePositionFee` would bake a permanent fee above 1%.
 */
describe('LeverageYieldService — MAX_POSITION_FEE_BPS on every create path', () => {
  const PARTNER = '0x9999999999999999999999999999999999999999' as Address;
  const FEE_ABI = parseAbi([
    'function createPositionAndLeverage((address owner, address collateral, address borrowToken, uint8 eModeCategory, uint256 originChainId, bytes originAddress, address originAsset, address feeReceiver, uint16 feeBps) cfg, uint256 initialAssets, uint256 borrowAmount, uint256 minCollateralOut) returns (address)',
    'function createPositionFromDebtToken((address owner, address collateral, address borrowToken, uint8 eModeCategory, uint256 originChainId, bytes originAddress, address originAsset, address feeReceiver, uint16 feeBps) cfg, uint256 contribution, uint256 totalInput, uint256 minCollateralOut) returns (address)',
  ]);
  const feeBpsOf = (data: Hex): number => {
    const { args } = decodeFunctionData({ abi: FEE_ABI, data });
    return (args[0] as { feeBps: number }).feeBps;
  };

  /** Each `resolvePositionFee` call site (the two open-data builders share one), as `(partnerFee) => create calldata`. */
  const paths: [string, (percentage: number) => Promise<Result<Hex, { code: string }>>][] = [
    [
      'buildCreatePositionAndLeverage',
      async percentage => {
        const result = sodaxWithFactory().leverageYield.buildCreatePositionAndLeverage({
          from: POSITION_OWNER,
          owner: POSITION_OWNER,
          collateral: POS_COLLATERAL,
          borrowToken: POS_BORROW_TOKEN,
          eModeCategory: 0,
          origin: { chainKey: 'sonic', address: POSITION_OWNER },
          initialAssets: 10n ** 18n,
          borrowAmount: 1_000n,
          minCollateralOut: 1n,
          partnerFee: { address: PARTNER, percentage },
        });
        return result.ok ? { ok: true, value: result.value.data } : result;
      },
    ],
    [
      'buildCreatePositionFromDebtToken',
      async percentage => {
        const result = sodaxWithFactory().leverageYield.buildCreatePositionFromDebtToken({
          from: POSITION_OWNER,
          owner: POSITION_OWNER,
          collateral: POS_COLLATERAL,
          borrowToken: POS_BORROW_TOKEN,
          eModeCategory: 0,
          origin: { chainKey: 'sonic', address: POSITION_OWNER },
          contribution: 10n ** 18n,
          totalInput: 2n * 10n ** 18n,
          minCollateralOut: 1n,
          partnerFee: { address: PARTNER, percentage },
        });
        return result.ok ? { ok: true, value: result.value.data } : result;
      },
    ],
    [
      'buildOpenPositionData',
      async percentage => {
        const configured = sodaxWithFactory();
        stubFactoryPrediction(configured, 0n, PREDICTED_POSITION);
        const result = await configured.leverageYield.buildOpenPositionData({
          srcChainKey: ARBITRUM,
          srcAddress: SAMPLE_USER,
          token: SPOKE_TOKEN,
          amount: 10n ** 18n,
          owner: HUB_WALLET,
          borrowToken: POS_BORROW_TOKEN,
          borrowAmount: 1n,
          minCollateralOut: 1n,
          partnerFee: { address: PARTNER, percentage },
        });
        return result.ok ? { ok: true, value: decodeBatchCalls(result.value).at(-1)?.data as Hex } : result;
      },
    ],
  ];

  it.each(paths)('%s encodes the cap itself and rejects one basis point over it', async (_name, build) => {
    const atCap = await build(MAX_POSITION_FEE_BPS);
    expect(atCap.ok).toBe(true);
    if (!atCap.ok) return;
    expect(feeBpsOf(atCap.value)).toBe(MAX_POSITION_FEE_BPS);

    const over = await build(MAX_POSITION_FEE_BPS + 1);
    expect(over.ok).toBe(false);
    if (over.ok) return;
    expect(over.error.code).toBe('LOOKUP_FAILED');
  });
});

// ─── Positions from any chain: payload shape + transport ───────────────────────────────
//
// The payload is what the hub wallet executes, so these assert the sequence it encodes rather
// than just that a call was made: getting the wrap or the approval wrong produces a batch that
// looks fine and reverts on the hub, after the user has already paid for the deposit.

describe('LeverageYieldService — opening a position from any chain', () => {
  const PREDICTED = PREDICTED_POSITION;
  const decodeCalls = decodeBatchCalls;
  const stubPrediction = (sodaxInstance: Sodax): void => stubFactoryPrediction(sodaxInstance, 0n, PREDICTED_POSITION);

  it('encodes wrap → transfer to the predicted position → create with the user as origin, never approving the factory', async () => {
    const configured = sodaxWithFactory();
    stubPrediction(configured);
    const result = await configured.leverageYield.buildOpenPositionData({
      srcChainKey: ARBITRUM,
      srcAddress: SAMPLE_USER,
      token: SPOKE_TOKEN,
      amount: 10n ** 18n,
      owner: HUB_WALLET,
      borrowToken: POS_BORROW_TOKEN,
      borrowAmount: 5n * 10n ** 17n,
      minCollateralOut: 4n * 10n ** 17n,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const calls = decodeCalls(result.value);
    // weETH is not itself a soda vault token, so it is wrapped: approve the vault, deposit into it,
    // transfer the shares to the address the position will exist at, then create.
    expect(calls).toHaveLength(4);
    expect(calls[3]?.address).toBe(POSITION_FACTORY);
    // The funding leg targets the predicted position and carries a plain ERC-20 transfer selector.
    expect(calls[2]?.address).toBe(SODA_ASSET);
    expect(calls[2]?.data.slice(0, 10)).toBe('0xa9059cbb'); // transfer(address,uint256)
    expect(calls[2]?.data.toLowerCase()).toContain(PREDICTED.slice(2).toLowerCase());
    // No approve(...) to the factory anywhere in the batch — it holds no allowance and pulls nothing.
    expect(
      calls.some(
        c =>
          c.data.slice(0, 10) === '0x095ea7b3' &&
          c.data.toLowerCase().includes(POSITION_FACTORY.slice(2).toLowerCase()),
      ),
    ).toBe(false);
    expect(calls.every(c => c.value === 0n)).toBe(true);
    // The origin is the funding chain's SODAX relay id (23 for Arbitrum, not 42161) and the user's own
    // address — not the hub wallet's nor the position's — so a failed intent refunds to the user.
    const create = calls.at(-1);
    expect(create?.data.toLowerCase()).toContain(getIntentRelayChainId(ARBITRUM)?.toString(16).padStart(64, '0'));
    expect(create?.data.toLowerCase()).toContain(SAMPLE_USER.slice(2).toLowerCase());
  });

  /**
   * The id is read per build, never cached: the owner's own concurrent open is the one thing that can
   * advance it, and a cached prediction would fund an address the second position is not created at.
   */
  it('re-reads the position id on every build, so a second open funds its own address', async () => {
    const configured = sodaxWithFactory();
    const addressForId = (id: bigint): Address =>
      `0x${id.toString(16).padStart(40, '0')}`.replace('0x', '0xaa').slice(0, 42) as Address;
    stubFactoryPrediction(configured, [0n, 1n], addressForId);

    const params = {
      srcChainKey: ARBITRUM,
      srcAddress: SAMPLE_USER,
      token: SPOKE_TOKEN,
      amount: 10n ** 18n,
      owner: HUB_WALLET,
      borrowToken: POS_BORROW_TOKEN,
      borrowAmount: 1n,
      minCollateralOut: 1n,
    } as const;
    const first = await configured.leverageYield.buildOpenPositionData(params);
    const second = await configured.leverageYield.buildOpenPositionData(params);
    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;

    const transferTarget = (payload: Hex): string => {
      const transfer = decodeBatchCalls(payload).find(c => c.data.slice(0, 10) === '0xa9059cbb');
      return `0x${transfer?.data.slice(34, 74)}`.toLowerCase();
    };
    expect(transferTarget(first.value)).toBe(addressForId(0n).toLowerCase());
    expect(transferTarget(second.value)).toBe(addressForId(1n).toLowerCase());
  });

  it('fails closed on a token with no hub asset, rather than encoding a batch that reverts on the hub', async () => {
    const configured = sodaxWithFactory();
    const result = await configured.leverageYield.buildOpenPositionData({
      srcChainKey: ARBITRUM,
      srcAddress: SAMPLE_USER,
      token: '0x000000000000000000000000000000000000dEaD',
      amount: 1n,
      owner: HUB_WALLET,
      borrowToken: POS_BORROW_TOKEN,
      borrowAmount: 1n,
      minCollateralOut: 1n,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('LOOKUP_FAILED');
  });

  it('the debt-side open makes the deposited reserve the borrow token', async () => {
    const configured = sodaxWithFactory();
    stubPrediction(configured);
    const result = await configured.leverageYield.buildOpenPositionFromDebtTokenData({
      srcChainKey: ARBITRUM,
      srcAddress: SAMPLE_USER,
      token: SPOKE_TOKEN,
      amount: 10n ** 18n,
      owner: HUB_WALLET,
      collateral: POS_COLLATERAL,
      totalInput: 2n * 10n ** 18n,
      minCollateralOut: 1n,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const create = decodeCalls(result.value).at(-1);
    expect(create?.address).toBe(POSITION_FACTORY);
    // The collateral the caller asked for is in the config, and the deposited token's own reserve
    // (sodaWEETH) is the borrow side — crossing these two would invert the position.
    expect(create?.data.toLowerCase()).toContain(POS_COLLATERAL.slice(2).toLowerCase());
    expect(create?.data.toLowerCase()).toContain(SODA_ASSET.slice(2).toLowerCase());
  });

  it('deposits to the hub wallet and waits for the relayed hub tx; on the hub both hashes are the one tx', async () => {
    const configured = sodaxWithFactory();
    vi.spyOn(configured.hubProvider, 'getUserHubWalletAddress').mockResolvedValue(HUB_WALLET);
    vi.spyOn(configured.spoke, 'verifyTxHash').mockResolvedValue({ ok: true, value: true });
    stubPrediction(configured);
    vi.spyOn(configured.spoke, 'deposit')
      .mockResolvedValueOnce({ ok: true, value: '0xspokeTx' })
      .mockResolvedValueOnce({ ok: true, value: '0xsonicTx' });
    mocks.relayTxAndWaitPacket.mockResolvedValueOnce({ ok: true, value: { dst_tx_hash: '0xhubTx' } });
    const open = (srcChainKey: SpokeChainKey, token: Address) =>
      configured.leverageYield.openPosition({
        params: {
          srcChainKey,
          srcAddress: SAMPLE_USER,
          token,
          amount: 10n ** 18n,
          borrowToken: POS_BORROW_TOKEN,
          borrowAmount: 1n,
          minCollateralOut: 1n,
        },
        walletProvider: mockEvmProvider,
      });

    // Both hashes matter: the spoke one is what the user sees, the hub one is where the intent
    // actually exists and so is what notifySolver has to be told about.
    expect(await open(ARBITRUM, SPOKE_TOKEN)).toEqual({
      ok: true,
      value: { srcChainTxHash: '0xspokeTx', dstChainTxHash: '0xhubTx' },
    });
    const deposit = vi.mocked(configured.spoke.deposit).mock.calls[0]?.[0];
    // Funds land in the hub wallet, which is what the batch then spends.
    expect(deposit?.to).toBe(HUB_WALLET);
    expect(deposit?.amount).toBe(10n ** 18n);

    expect(await open(SONIC, SODA_ASSET)).toEqual({
      ok: true,
      value: { srcChainTxHash: '0xsonicTx', dstChainTxHash: '0xsonicTx' },
    });
    expect(mocks.relayTxAndWaitPacket).toHaveBeenCalledTimes(1);
  });

  it('rejects a zero amount before asking the user to sign anything', async () => {
    const configured = sodaxWithFactory();
    const deposit = vi.spyOn(configured.spoke, 'deposit');

    const result = await configured.leverageYield.openPosition({
      params: {
        srcChainKey: ARBITRUM,
        srcAddress: SAMPLE_USER,
        token: SPOKE_TOKEN,
        amount: 0n,
        borrowToken: POS_BORROW_TOKEN,
        borrowAmount: 1n,
        minCollateralOut: 1n,
      },
      walletProvider: mockEvmProvider,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('VALIDATION_FAILED');
    expect(deposit).not.toHaveBeenCalled();
  });

  /**
   * Bitcoin reaches this path through the public types like any other spoke, and everything upstream
   * of the deposit succeeds — so without this guard the first sign of trouble is a broadcast deposit
   * funding a hub wallet the batch never names.
   */
  it('refuses a Bitcoin or MPC-relay source before any funds move', async () => {
    const configured = sodaxWithFactory();
    const deposit = vi.spyOn(configured.spoke, 'deposit');
    const leg = { amount: 10n ** 6n, borrowToken: POS_BORROW_TOKEN, borrowAmount: 1n, minCollateralOut: 1n };

    const bitcoin = await configured.leverageYield.openPosition({
      params: {
        srcChainKey: 'bitcoin',
        srcAddress: 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4',
        token: '0:0',
        ...leg,
      },
    } as never);
    const tron = await configured.leverageYield.openPosition({
      params: { srcChainKey: 'tron', srcAddress: TRON_TEST_ADDRESS, token: tronSupportedTokens.USDT.address, ...leg },
    } as never);

    if (bitcoin.ok || tron.ok) throw new Error('expected both opens to be refused');
    expect(bitcoin.error.code).toBe('VALIDATION_FAILED');
    expect(bitcoin.error.context?.field).toBe('srcChainKey');
    expect(tron.error.code).toBe('VALIDATION_FAILED');
    expect(tron.error.message).toContain('MPC-relay');
    expect(deposit).not.toHaveBeenCalled();
  });
});

describe('LeverageYieldService.operatePosition', () => {
  it('relays the position calls as a hub-wallet message, with no deposit', async () => {
    const configured = sodaxWithFactory();
    vi.spyOn(configured.hubProvider, 'getUserHubWalletAddress').mockResolvedValue(HUB_WALLET);
    vi.spyOn(configured.spoke, 'verifyTxHash').mockResolvedValue({ ok: true, value: true });
    vi.spyOn(configured.spoke, 'sendMessage').mockResolvedValueOnce({ ok: true, value: '0xspokeTx' });
    const deposit = vi.spyOn(configured.spoke, 'deposit');
    mocks.relayTxAndWaitPacket.mockResolvedValueOnce({ ok: true, value: { dst_tx_hash: '0xhubTx' } });

    const add = configured.leverageYield.buildAddLeverage({
      from: HUB_WALLET,
      position: POSITION,
      borrowAmount: 10n,
      minCollateralOut: 9n,
    });
    const result = await configured.leverageYield.operatePosition({
      params: { srcChainKey: ARBITRUM, srcAddress: SAMPLE_USER, calls: [add] },
      walletProvider: mockEvmProvider,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toEqual({ srcChainTxHash: '0xspokeTx', dstChainTxHash: '0xhubTx' });
    expect(deposit).not.toHaveBeenCalled();
    const message = vi.mocked(configured.spoke.sendMessage).mock.calls[0]?.[0];
    // Addressed to the hub wallet, because that is what the position's onlyOwner checks.
    expect(message?.dstAddress).toBe(HUB_WALLET);
    expect(message?.payload).toBe(configured.leverageYield.encodePositionCalls([add]));
  });

  it('rejects an empty batch', async () => {
    const configured = sodaxWithFactory();
    const result = await configured.leverageYield.operatePosition({
      params: { srcChainKey: ARBITRUM, srcAddress: SAMPLE_USER, calls: [] },
      walletProvider: mockEvmProvider,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('VALIDATION_FAILED');
  });

  it('refuses a Bitcoin or MPC-relay source before signing anything', async () => {
    const configured = sodaxWithFactory();
    const sendMessage = vi.spyOn(configured.spoke, 'sendMessage');
    const calls = [{ from: HUB_WALLET, to: POSITION, value: 0n, data: '0x' }];

    const bitcoin = await configured.leverageYield.operatePosition({
      params: { srcChainKey: 'bitcoin', srcAddress: 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4', calls },
    } as never);
    const tron = await configured.leverageYield.operatePosition({
      params: { srcChainKey: 'tron', srcAddress: TRON_TEST_ADDRESS, calls },
    } as never);

    if (bitcoin.ok || tron.ok) throw new Error('expected both operations to be refused');
    expect(bitcoin.error.code).toBe('VALIDATION_FAILED');
    expect(bitcoin.error.context?.field).toBe('srcChainKey');
    expect(tron.error.code).toBe('VALIDATION_FAILED');
    expect(tron.error.message).toContain('MPC-relay');
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it('maps a relay timeout rather than reporting the operation as done', async () => {
    const configured = sodaxWithFactory();
    vi.spyOn(configured.hubProvider, 'getUserHubWalletAddress').mockResolvedValue(HUB_WALLET);
    vi.spyOn(configured.spoke, 'verifyTxHash').mockResolvedValue({ ok: true, value: true });
    vi.spyOn(configured.spoke, 'sendMessage').mockResolvedValueOnce({ ok: true, value: '0xspokeTx' });
    mocks.relayTxAndWaitPacket.mockResolvedValueOnce({
      ok: false,
      error: { code: 'TIMEOUT', data: { payload: {} } },
    });

    const result = await configured.leverageYield.operatePosition({
      params: {
        srcChainKey: ARBITRUM,
        srcAddress: SAMPLE_USER,
        calls: [configured.leverageYield.buildSettlePosition({ from: HUB_WALLET, position: POSITION })],
      },
      walletProvider: mockEvmProvider,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(isSodaxError(result.error)).toBe(true);
  });
});

describe('LeverageYieldService.getApprovalStrategy and vaultSwapWithApproval', () => {
  const ARBITRUM_CHAIN_ID = 42161;
  const RAW_APPROVE: EvmRawTransaction = { from: SAMPLE_USER, to: HUB_WALLET, value: 0n, data: '0x095ea7b3' };
  const RAW_DEPOSIT: EvmRawTransaction = { from: SAMPLE_USER, to: HUB_WALLET, value: 0n, data: '0xdeadbeef' };
  const FEE: PartnerFee = { address: SAMPLE_USER, percentage: 10 };
  const confirmedBatch: EvmBatchResult = {
    status: 'success',
    statusCode: 200,
    atomic: true,
    receipts: [{ transactionHash: '0xbatchTx', status: 'success' }],
  };

  const makeBatchProvider = (support: EvmAtomicBatchSupport = 'supported') => ({
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

  const deposit = (walletProvider: IEvmWalletProvider, srcChainKey: SpokeChainKey = ARBITRUM) => ({
    params: vaultIntentParams(srcChainKey),
    walletProvider,
    partnerFee: FEE,
  });
  const allowance = (valid: boolean) =>
    vi.spyOn(sodax.spoke, 'isAllowanceValid').mockResolvedValue({ ok: true, value: valid });
  const stubCreate = () => {
    const intent = makeIntent(ARBITRUM);
    return vi.spyOn(sodax.leverageYield, 'createVaultIntent').mockImplementation(
      async ({ raw }) =>
        ({
          ok: true,
          value: {
            tx: raw ? RAW_DEPOSIT : '0xspokeTx',
            intent: { ...intent, feeAmount: 0n },
            relayData: { address: intent.creator, payload: '0xdata' },
          },
        }) as never,
    );
  };
  const stubCompletion = () => {
    mocks.relayTxAndWaitPacket.mockResolvedValueOnce({ ok: true, value: { dst_tx_hash: '0xdstTx' } });
    mocks.solverPostExecution.mockResolvedValueOnce({ ok: true, value: { answer: 'OK', intent_hash: '0xhash' } });
  };

  describe('getApprovalStrategy', () => {
    it("checks a deposit's allowance against the swap spender: the asset manager on a spoke, the intents contract (sequential) on the hub", async () => {
      const allowanceSpy = allowance(true);
      await expect(sodax.leverageYield.getApprovalStrategy(deposit(makeBatchProvider()))).resolves.toEqual({
        ok: true,
        value: 'not-required',
      });
      expect(allowanceSpy).toHaveBeenLastCalledWith(
        expect.objectContaining({
          srcChainKey: ARBITRUM,
          spender: sodax.config.getChainConfig(ARBITRUM).addresses.assetManager,
        }),
      );

      allowanceSpy.mockResolvedValue({ ok: true, value: false });
      await expect(sodax.leverageYield.getApprovalStrategy(deposit(makeBatchProvider(), SONIC))).resolves.toEqual({
        ok: true,
        value: 'sequential',
      });
      expect(allowanceSpy).toHaveBeenLastCalledWith(
        expect.objectContaining({ spender: sodax.config.solver.intentsContract }),
      );
    });
  });

  describe('vaultSwapWithApproval', () => {
    it('sends approve + deposit as one batch, keeping the per-intent partner fee', async () => {
      allowance(false);
      const buildSpy = vi
        .spyOn(sodax.spoke, 'buildApproveTxs')
        .mockResolvedValueOnce({ ok: true, value: { approveTx: RAW_APPROVE } });
      const createSpy = stubCreate();
      const approveSpy = vi.spyOn(sodax.spoke, 'approve');
      stubCompletion();
      const wallet = makeBatchProvider();

      const result = await sodax.leverageYield.vaultSwapWithApproval(deposit(wallet));

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.approvalStrategy).toBe('atomic-batch');
      expect(result.value.intentDeliveryInfo.srcTxHash).toBe('0xbatchTx');
      expect(wallet.sendAtomicBatch).toHaveBeenCalledWith([RAW_APPROVE, RAW_DEPOSIT], {
        expectedChainId: ARBITRUM_CHAIN_ID,
      });
      expect(buildSpy).toHaveBeenCalledWith(
        expect.objectContaining({ spender: sodax.config.getChainConfig(ARBITRUM).addresses.assetManager, raw: true }),
      );
      expect(createSpy).toHaveBeenCalledWith(expect.objectContaining({ raw: true, partnerFee: FEE }));
      expect(approveSpy).not.toHaveBeenCalled();
    });

    it('approves separately when the wallet refuses the batch before signing', async () => {
      allowance(false);
      vi.spyOn(sodax.spoke, 'buildApproveTxs').mockResolvedValueOnce({ ok: true, value: { approveTx: RAW_APPROVE } });
      const createSpy = stubCreate();
      const approveSpy = vi.spyOn(sodax.spoke, 'approve').mockResolvedValueOnce({ ok: true, value: '0xapproveTx' });
      vi.spyOn(sodax.spoke, 'waitForTxReceipt').mockResolvedValueOnce({
        ok: true,
        value: { status: 'success', receipt: {} as never },
      });
      stubCompletion();
      const wallet = makeBatchProvider();
      wallet.sendAtomicBatch.mockRejectedValueOnce(new AtomicityNotSupportedError(new Error('no atomicity')));

      const result = await sodax.leverageYield.vaultSwapWithApproval(deposit(wallet));

      expect(result.ok && result.value.approvalStrategy).toBe('sequential');
      expect(result.ok && result.value.intentDeliveryInfo.srcTxHash).toBe('0xspokeTx');
      expect(approveSpy).toHaveBeenCalledWith(
        expect.objectContaining({ spender: sodax.config.getChainConfig(ARBITRUM).addresses.assetManager, raw: false }),
      );
      // The batch path already built the deposit, so the fallback skips a second unsigned build.
      expect(createSpy).toHaveBeenCalledTimes(2);
    });

    it("returns vaultSwap()'s own error once the deposit is broadcast", async () => {
      allowance(true);
      stubCreate();
      mocks.relayTxAndWaitPacket.mockResolvedValueOnce({ ok: false, error: new Error('RELAY_TIMEOUT') });

      const result = await sodax.leverageYield.vaultSwapWithApproval(deposit(makeBatchProvider()));

      expect(!result.ok && result.error.code).toBe('RELAY_TIMEOUT');
      expect(!result.ok && result.error.context?.action).toBe('vaultSwap');
      expect(!result.ok && result.error.context?.approvalStrategy).toBeUndefined();
    });

    it('approves a Stellar deposit separately, with no spender, then deposits', async () => {
      const allowanceSpy = allowance(false);
      const createSpy = stubCreate();
      const approveSpy = vi.spyOn(sodax.spoke, 'approve').mockResolvedValueOnce({ ok: true, value: '0xtrustline' });
      vi.spyOn(sodax.spoke, 'waitForTxReceipt').mockResolvedValueOnce({
        ok: true,
        value: { status: 'success', receipt: {} as never },
      });
      stubCompletion();
      const STELLAR = ChainKeys.STELLAR_MAINNET satisfies SpokeChainKey;

      const result = await sodax.leverageYield.vaultSwapWithApproval({
        params: vaultIntentParams(STELLAR),
        walletProvider: { chainType: 'STELLAR' } as never,
      });

      expect(result.ok && result.value.approvalStrategy).toBe('sequential');
      expect(allowanceSpy).toHaveBeenCalledWith(expect.not.objectContaining({ spender: expect.anything() }));
      expect(approveSpy).toHaveBeenCalledWith(expect.objectContaining({ srcChainKey: STELLAR, raw: false }));
      expect(approveSpy).toHaveBeenCalledWith(expect.not.objectContaining({ spender: expect.anything() }));
      // The unsigned build first, then the signed deposit.
      expect(createSpy.mock.calls.map(([call]) => call.raw === true)).toEqual([true, false]);
    });

    it('never relays or resends a batch that was sent but not confirmed, waiting at least the default for it', async () => {
      allowance(false);
      vi.spyOn(sodax.spoke, 'buildApproveTxs').mockResolvedValueOnce({ ok: true, value: { approveTx: RAW_APPROVE } });
      stubCreate();
      const approveSpy = vi.spyOn(sodax.spoke, 'approve');
      const wallet = makeBatchProvider();
      wallet.waitForBatch.mockRejectedValueOnce(new Error('timed out'));

      // A short relay timeout must not cut the batch wait short: that reports a landing batch as unconfirmed.
      const result = await sodax.leverageYield.vaultSwapWithApproval({ ...deposit(wallet), timeout: 0 });

      expect(wallet.waitForBatch).toHaveBeenCalledWith('batch-1', { timeout: DEFAULT_RELAY_TX_TIMEOUT });
      expect(!result.ok && result.error.code).toBe('TX_VERIFICATION_FAILED');
      expect(!result.ok && result.error.context).toMatchObject({
        reason: ATOMIC_BATCH_UNCONFIRMED,
        batchId: 'batch-1',
        action: 'vaultSwapWithApproval',
      });
      expect(approveSpy).not.toHaveBeenCalled();
      expect(mocks.relayTxAndWaitPacket).not.toHaveBeenCalled();
    });

    it('does not deposit over an approval that did not confirm', async () => {
      allowance(false);
      const createSpy = stubCreate();
      vi.spyOn(sodax.spoke, 'approve').mockResolvedValueOnce({ ok: true, value: '0xapproveTx' });
      vi.spyOn(sodax.spoke, 'waitForTxReceipt').mockResolvedValueOnce({
        ok: true,
        value: { status: 'failure', error: new Error('reverted') },
      });

      const result = await sodax.leverageYield.vaultSwapWithApproval(deposit(mockEvmProvider));

      expect(!result.ok && result.error.code).toBe('APPROVE_FAILED');
      expect(!result.ok && result.error.context).toMatchObject({
        reason: 'approve-not-confirmed',
        approveTxHash: '0xapproveTx',
        approvalStrategy: 'sequential',
      });
      // Only the unsigned preflight build ran; no deposit went out over the failed approval.
      expect(createSpy).toHaveBeenCalledOnce();
      expect(createSpy).toHaveBeenCalledWith(expect.objectContaining({ raw: true, partnerFee: FEE }));
    });

    it('asks for no approval when the deposit cannot be built, or the wallet is of the wrong family (VALIDATION_FAILED)', async () => {
      allowance(false);
      const invalid = new SodaxError('VALIDATION_FAILED', 'Unsupported spoke chain token', {
        feature: 'leverageYield',
      });
      vi.spyOn(sodax.leverageYield, 'createVaultIntent').mockResolvedValueOnce({ ok: false, error: invalid });
      const approveSpy = vi.spyOn(sodax.spoke, 'approve');

      const unbuildable = await sodax.leverageYield.vaultSwapWithApproval(deposit(mockEvmProvider));
      stubCreate();
      const wrongFamily = await sodax.leverageYield.vaultSwapWithApproval(deposit(mockBitcoinProvider as never));

      if (unbuildable.ok || wrongFamily.ok) throw new Error('expected both swaps to be refused');
      expect(unbuildable.error.code).toBe('VALIDATION_FAILED');
      // Not reported as a failed approval.
      expect(wrongFamily.error.code).toBe('VALIDATION_FAILED');
      expect(wrongFamily.error.context?.approvalStrategy).toBe('sequential');
      expect(approveSpy).not.toHaveBeenCalled();
    });

    it('runs a withdraw as vaultSwap does, with no approval', async () => {
      const allowanceSpy = vi.spyOn(sodax.spoke, 'isAllowanceValid');
      const createSpy = stubCreate();
      stubCompletion();

      const result = await sodax.leverageYield.vaultSwapWithApproval({
        ...deposit(makeBatchProvider()),
        hubWalletSwap: true,
      });

      expect(result.ok && result.value.approvalStrategy).toBe('not-required');
      expect(allowanceSpy).not.toHaveBeenCalled();
      expect(createSpy).toHaveBeenCalledWith(expect.objectContaining({ hubWalletSwap: true }));
    });
  });
  describe('vaultSwapWithApproval — resuming an unconfirmed batch', () => {
    const stubResumeRelay = () => {
      mocks.relayTxAndWaitPacket.mockResolvedValueOnce({ ok: true, value: { dst_tx_hash: '0xdstTx' } });
    };
    const stubSolver = () =>
      mocks.solverPostExecution.mockResolvedValueOnce({ ok: true, value: { answer: 'OK', intent_hash: '0xhash' } });
    const resume = (wallet: ReturnType<typeof makeBatchProvider>) =>
      sodax.leverageYield.vaultSwapWithApproval({ ...deposit(wallet), resumeBatchId: 'batch-1' });

    it('finishes a batch that confirms after the first wait, without sending anything again', async () => {
      allowance(false);
      vi.spyOn(sodax.spoke, 'buildApproveTxs').mockResolvedValueOnce({ ok: true, value: { approveTx: RAW_APPROVE } });
      const createSpy = stubCreate();
      const approveSpy = vi.spyOn(sodax.spoke, 'approve');
      const wallet = makeBatchProvider();
      wallet.waitForBatch.mockRejectedValueOnce(new Error('Timed out while waiting for call bundle'));

      const first = await sodax.leverageYield.vaultSwapWithApproval(deposit(wallet));
      expect(first.ok).toBe(false);
      if (first.ok) return;
      expect(first.error.context).toMatchObject({ reason: ATOMIC_BATCH_UNCONFIRMED, batchId: 'batch-1', callCount: 2 });

      const hubIntent = makeIntent(ARBITRUM);
      mocks.getIntent.mockResolvedValueOnce(hubIntent);
      stubResumeRelay();
      stubSolver();

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
        chainKey: ARBITRUM,
        relayerApiEndpoint: sodax.config.relay.relayerApiEndpoint,
        timeout: DEFAULT_RELAY_TX_TIMEOUT,
      });
      expect(mocks.getIntent.mock.calls[0]?.[0]).toBe('0xdstTx');
      expect(mocks.solverPostExecution.mock.calls[0]?.[0]).toEqual({ intent_tx_hash: '0xdstTx' });
    });

    it('skips the approval strategy and the submit-tx backend', async () => {
      const wallet = makeBatchProvider();
      const backendOn = new Sodax({ logger: 'silent', leverageYield: { useBackendSubmitTx: true } });
      const allowanceSpy = vi.spyOn(backendOn.spoke, 'isAllowanceValid');
      const submitSpy = vi.spyOn(backendOn.api.leverageYield, 'submitTx');
      mocks.getIntent.mockResolvedValueOnce(makeIntent(ARBITRUM));
      stubResumeRelay();
      stubSolver();

      const result = await backendOn.leverageYield.vaultSwapWithApproval({
        ...deposit(wallet),
        resumeBatchId: 'batch-1',
      });

      expect(result.ok).toBe(true);
      expect(allowanceSpy).not.toHaveBeenCalled();
      expect(wallet.getAtomicBatchSupport).not.toHaveBeenCalled();
      expect(submitSpy).not.toHaveBeenCalled();
    });

    it('reports a batch that never landed as atomic-batch-failed', async () => {
      const wallet = makeBatchProvider();
      wallet.waitForBatch.mockResolvedValueOnce({ status: 'failure', statusCode: 400, atomic: true, receipts: [] });

      const result = await resume(wallet);

      expect(!result.ok && result.error.code).toBe('INTENT_CREATION_FAILED');
      expect(!result.ok && result.error.context).toMatchObject({ reason: 'atomic-batch-failed', batchId: 'batch-1' });
      expect(mocks.relayTxAndWaitPacket).not.toHaveBeenCalled();
    });

    it('keeps the deposit tx on a relay failure, so the vault swap can be resumed or tracked', async () => {
      const wallet = makeBatchProvider();
      mocks.relayTxAndWaitPacket.mockResolvedValueOnce({ ok: false, error: new Error('RELAY_TIMEOUT') });

      const result = await resume(wallet);

      expect(!result.ok && result.error.code).toBe('RELAY_TIMEOUT');
      expect(!result.ok && result.error.context?.srcTxHash).toBe('0xbatchTx');
      expect(mocks.solverPostExecution).not.toHaveBeenCalled();
    });

    it('keeps the hub tx when notifying the solver fails, so the notification can be retried', async () => {
      const wallet = makeBatchProvider();
      mocks.getIntent.mockResolvedValueOnce(makeIntent(ARBITRUM));
      stubResumeRelay();
      mocks.solverPostExecution.mockResolvedValueOnce({
        ok: false,
        error: { detail: { code: -999, message: 'solver down' } },
      });

      const result = await resume(wallet);

      expect(!result.ok && result.error.code).toBe('EXTERNAL_API_ERROR');
      expect(!result.ok && result.error.context).toMatchObject({ srcTxHash: '0xbatchTx', dstTxHash: '0xdstTx' });
    });

    it('does not notify the solver when the intent cannot be read from the hub tx', async () => {
      const wallet = makeBatchProvider();
      mocks.getIntent.mockRejectedValueOnce(new Error('no IntentCreated event'));
      stubResumeRelay();

      const result = await resume(wallet);

      expect(!result.ok && result.error.code).toBe('UNKNOWN');
      expect(!result.ok && result.error.context).toMatchObject({ srcTxHash: '0xbatchTx', dstTxHash: '0xdstTx' });
      expect(mocks.solverPostExecution).not.toHaveBeenCalled();
    });

    it('rejects resuming with a wallet that cannot batch', async () => {
      const result = await sodax.leverageYield.vaultSwapWithApproval({
        ...deposit(mockEvmProvider),
        resumeBatchId: 'batch-1',
      });

      expect(!result.ok && result.error.code).toBe('VALIDATION_FAILED');
      expect(mocks.relayTxAndWaitPacket).not.toHaveBeenCalled();
    });
  });
});
