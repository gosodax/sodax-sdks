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
import { decodeAbiParameters, decodeFunctionData, parseAbi, type Address, type Hex } from 'viem';
import { leverageYieldConfig } from '@sodax/types';
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
  EvmSolverService: { constructCreateIntentData: mocks.constructCreateIntentData },
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
  it('listVaults returns the @sodax/types registry entries', () => {
    const vaults = sodax.leverageYield.listVaults();
    expect(vaults.length).toBeGreaterThan(0);
    expect(vaults[0]).toMatchObject({ name: 'lsodaWEETH', vault: VAULT, asset: SODA_ASSET });
  });

  it('getVault by name returns the matching entry, or undefined for an unknown name', () => {
    expect(sodax.leverageYield.getVault('lsodaWEETH')?.vault).toBe(VAULT);
    expect(sodax.leverageYield.getVault('nonexistent-vault')).toBeUndefined();
  });

  it('getVaultByAddress is case-insensitive and returns undefined for unknown addresses', () => {
    expect(sodax.leverageYield.getVaultByAddress(VAULT.toLowerCase() as Address)?.name).toBe('lsodaWEETH');
    expect(sodax.leverageYield.getVaultByAddress(VAULT.toUpperCase() as Address)?.name).toBe('lsodaWEETH');
    expect(
      sodax.leverageYield.getVaultByAddress('0x0000000000000000000000000000000000000000' as Address),
    ).toBeUndefined();
  });
});

// ─── Swap-intent builders ─────────────────────────────────────────────────

describe('LeverageYieldService.deposit — intent builder', () => {
  it('builds a swap into the vault lsoda* token, delivered to the hub wallet', async () => {
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
  });

  it('forwards a caller-supplied partnerFee on the payload (per-intent override)', async () => {
    vi.spyOn(sodax.hubProvider, 'getUserHubWalletAddress').mockResolvedValueOnce(HUB_WALLET);
    const partnerFee = { address: SAMPLE_USER, percentage: 100 } as const;

    const result = await sodax.leverageYield.deposit({
      vault: VAULT,
      srcChainKey: ARBITRUM,
      srcAddress: SAMPLE_USER,
      inputToken: SPOKE_TOKEN,
      inputAmount: 1_000n,
      minOutputAmount: 900n,
      partnerFee,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.partnerFee).toEqual(partnerFee);
  });

  it('omits partnerFee from the payload when the caller does not supply one', async () => {
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
  it('builds a hub-wallet swap of lsoda* into the chosen output token', async () => {
    const result = await sodax.leverageYield.withdraw({
      vault: VAULT,
      srcChainKey: ARBITRUM,
      srcAddress: SAMPLE_USER,
      dstChainKey: ARBITRUM,
      outputToken: SPOKE_TOKEN,
      inputAmount: 1_000n,
      minOutputAmount: 900n,
    });

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
  });

  it('forwards a caller-supplied partnerFee on the payload (per-intent override)', async () => {
    const partnerFee = { address: SAMPLE_USER, percentage: 100 } as const;

    const result = await sodax.leverageYield.withdraw({
      vault: VAULT,
      srcChainKey: ARBITRUM,
      srcAddress: SAMPLE_USER,
      dstChainKey: ARBITRUM,
      outputToken: SPOKE_TOKEN,
      inputAmount: 1_000n,
      minOutputAmount: 900n,
      partnerFee,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.partnerFee).toEqual(partnerFee);
  });

  // Backward compatibility: pre-existing callers pass no partnerFee, so the key must stay absent
  // and `createVaultIntent`'s default must keep resolving the configured leverage-yield fee.
  it('omits partnerFee from the payload when the caller does not supply one', async () => {
    const result = await sodax.leverageYield.withdraw({
      vault: VAULT,
      srcChainKey: ARBITRUM,
      srcAddress: SAMPLE_USER,
      dstChainKey: ARBITRUM,
      outputToken: SPOKE_TOKEN,
      inputAmount: 1_000n,
      minOutputAmount: 900n,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect('partnerFee' in result.value).toBe(false);
  });

  it('honours an explicit recipient', async () => {
    const result = await sodax.leverageYield.withdraw({
      vault: VAULT,
      srcChainKey: ARBITRUM,
      srcAddress: SAMPLE_USER,
      dstChainKey: ARBITRUM,
      outputToken: SPOKE_TOKEN,
      inputAmount: 1_000n,
      minOutputAmount: 900n,
      recipient: HUB_WALLET,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.params.dstAddress).toBe(HUB_WALLET);
  });

  it('honours an explicit deadline without reading the hub block', async () => {
    const getBlock = vi.spyOn(sodax.hubProvider.publicClient, 'getBlock');
    const explicitDeadline = 9_999_999_999n;

    const result = await sodax.leverageYield.withdraw({
      vault: VAULT,
      srcChainKey: ARBITRUM,
      srcAddress: SAMPLE_USER,
      dstChainKey: ARBITRUM,
      outputToken: SPOKE_TOKEN,
      inputAmount: 1_000n,
      minOutputAmount: 900n,
      deadline: explicitDeadline,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.params.deadline).toBe(explicitDeadline);
    expect(getBlock).not.toHaveBeenCalled();
  });

  it('rejects an empty vault address', async () => {
    const result = await sodax.leverageYield.withdraw({
      vault: '' as Address,
      srcChainKey: ARBITRUM,
      srcAddress: SAMPLE_USER,
      dstChainKey: ARBITRUM,
      outputToken: SPOKE_TOKEN,
      inputAmount: 1_000n,
      minOutputAmount: 900n,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('VALIDATION_FAILED');
    expect(result.error.context?.field).toBe('vault');
  });

  it('surfaces a getBlock RPC failure during default-deadline resolution as LOOKUP_FAILED (method=resolveDeadline)', async () => {
    vi.spyOn(sodax.hubProvider.publicClient, 'getBlock').mockRejectedValueOnce(new Error('rpc down'));

    const result = await sodax.leverageYield.withdraw({
      vault: VAULT,
      srcChainKey: ARBITRUM,
      srcAddress: SAMPLE_USER,
      dstChainKey: ARBITRUM,
      outputToken: SPOKE_TOKEN,
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

// ─── getApr — steady-state leverage APR (pins the basis-points targetLTV scale) ──

describe('LeverageYieldService.getApr', () => {
  it('computes supply/borrow/leverage/net APR from the AAVE rates at the vault targetLTV', async () => {
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
  });

  it('returns a negative netAprRay when the borrow rate exceeds the supply rate (inverted spread)', async () => {
    stubReadContract({
      pool: POOL,
      asset: SODA_ASSET,
      borrowToken: BORROW_TOKEN,
      targetLtvBps: 8000n,
      supplyAprRay: pctRay(2),
      borrowAprRay: pctRay(3),
    });

    const result = await sodax.leverageYield.getApr(VAULT);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // net = 2% + 4 × (2% − 3%) = 2% − 4% = −2%
    expect(result.value.netAprRay).toBe(-pctRay(2));
    expect(result.value.netAprRay < 0n).toBe(true);
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

describe('LeverageYieldService.getLsdApr', () => {
  it('returns a zero, stale snapshot for a vault with no configured LSD source', async () => {
    const result = await sodax.leverageYield.getLsdApr('0x000000000000000000000000000000000000dEaD' as Address);
    expect(result).toEqual({ ok: true, value: { aprRay: 0n, label: 'no LSD source', stale: true } });
  });

  it('falls back to the registry fallbackAprPct (stale) when the DefiLlama fetch fails', async () => {
    // Fake timers skip the shared retry helper's back-off so the test doesn't wait on it.
    vi.useFakeTimers();
    const warn = vi.spyOn(sodax.config.logger, 'warn').mockImplementation(() => {});
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network')));
    const promise = sodax.leverageYield.getLsdApr(VAULT); // lsodaWEETH, fallbackAprPct 3.0
    await vi.runAllTimersAsync();
    const result = await promise;
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toEqual({ aprRay: pctRay(3), label: 'EtherFi (weETH) (fallback)', stale: true });
    // The fallback is logged, not silently swallowed.
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('DefiLlama APR fetch failed'), expect.any(Object));
  });

  it('uses the live DefiLlama apy (not stale) when the fetch succeeds', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ data: [{ apy: 2.4 }] }) }));
    const result = await sodax.leverageYield.getLsdApr(VAULT);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toEqual({ aprRay: pctRay(2.4), label: 'EtherFi (weETH)', stale: false });
  });
});

describe('LeverageYieldService.getEffectiveApr', () => {
  it('folds the LSD staking yield into the supply side and re-applies leverage', async () => {
    // Fake timers skip the shared retry helper's back-off on the failing DefiLlama fetch.
    vi.useFakeTimers();
    vi.spyOn(sodax.config.logger, 'warn').mockImplementation(() => {});
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network'))); // → fallback lsd = 3%
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
  });
});

// ─── createVaultIntent — the three creation branches + fee override + errors ──

describe('LeverageYieldService.createVaultIntent', () => {
  it('on an EVM spoke, builds intent data and deposits via SpokeService', async () => {
    const intent = makeIntent(ARBITRUM);
    mocks.constructCreateIntentData.mockReturnValueOnce(['0xdata', intent, 5n]);
    vi.spyOn(sodax.spoke, 'deposit').mockResolvedValueOnce({ ok: true, value: '0xspokeTx' });

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

  it('on a Bitcoin hub-wallet swap (withdraw), derives the hub wallet from the trading address but passes the personal srcAddress to sendMessage', async () => {
    // Regression: passing the already-resolved trading address into sendMessage would double-resolve
    // it (SpokeService.sendMessage re-resolves personal→trading internally), so the personal address
    // must flow into sendMessage while only the hub-wallet derivation uses the trading address.
    const TRADING_ADDRESS = 'bc1p-trading-wallet';
    const intent = makeIntent(ChainKeys.BITCOIN_MAINNET);
    const getEffSpy = vi.spyOn(sodax.spoke.bitcoin, 'getEffectiveWalletAddress').mockResolvedValueOnce(TRADING_ADDRESS);
    const ensureSpy = vi.spyOn(sodax.spoke.bitcoin.radfi, 'ensureRadfiAccessToken').mockResolvedValueOnce(undefined);
    mocks.constructCreateIntentData.mockReturnValueOnce(['0xhubdata', intent, 0n]);
    const sendSpy = vi.spyOn(sodax.spoke, 'sendMessage').mockResolvedValueOnce({ ok: true, value: '0xmsgTx' });

    const result = await sodax.leverageYield.createVaultIntent({
      params: vaultIntentParams(ChainKeys.BITCOIN_MAINNET, {
        inputToken: VAULT, // lsoda* shares are the swap input
        outputToken: SPOKE_TOKEN,
        dstChainKey: ARBITRUM as SpokeChainKey,
        dstAddress: SAMPLE_USER,
      }),
      walletProvider: mockBitcoinProvider,
      raw: false,
      hubWalletSwap: true,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Personal address is resolved to the trading wallet, and the radfi session is ensured.
    expect(getEffSpy).toHaveBeenCalledWith(SAMPLE_USER);
    expect(ensureSpy).toHaveBeenCalledWith(mockBitcoinProvider);
    // Hub wallet is derived from the trading address (matches what the relay credits).
    expect(mocks.getUserHubWalletAddress).toHaveBeenCalledWith(TRADING_ADDRESS, ChainKeys.BITCOIN_MAINNET);
    // srcAddress stays personal: sendMessage re-resolves the trading address itself, so pre-resolving
    // here would double-resolve (getTradingWallet(tradingAddress) → "Trading wallet not found").
    expect(sendSpy.mock.calls[0]?.[0]?.srcAddress).toBe(SAMPLE_USER);
    expect(result.value.relayData).toEqual({ address: HUB_WALLET, payload: '0xhubdata' });
  });

  it('returns raw tx data without a wallet provider when raw=true', async () => {
    const intent = makeIntent(ARBITRUM);
    mocks.constructCreateIntentData.mockReturnValueOnce(['0xdata', intent, 0n]);
    vi.spyOn(sodax.spoke, 'deposit').mockResolvedValueOnce({ ok: true, value: '0xrawtx' });

    const result = await sodax.leverageYield.createVaultIntent({ params: vaultIntentParams(ARBITRUM), raw: true });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.tx).toBe('0xrawtx');
    expect((sodax.spoke.deposit as ReturnType<typeof vi.fn>).mock.calls[0]?.[0].raw).toBe(true);
  });

  it('forwards a per-intent partnerFee override to intent construction', async () => {
    const partnerFee = { address: SAMPLE_USER, percentage: 100 } as const;
    mocks.constructCreateIntentData.mockReturnValueOnce(['0xdata', makeIntent(ARBITRUM), 0n]);
    vi.spyOn(sodax.spoke, 'deposit').mockResolvedValueOnce({ ok: true, value: '0xspokeTx' });

    await sodax.leverageYield.createVaultIntent({
      params: vaultIntentParams(ARBITRUM),
      walletProvider: mockEvmProvider,
      raw: false,
      partnerFee,
    });

    expect(mocks.constructCreateIntentData.mock.calls[0]?.[3]).toEqual(partnerFee);
  });

  it('rejects an unsupported input token with VALIDATION_FAILED (field=inputToken)', async () => {
    vi.spyOn(sodax.config, 'isValidOriginalAssetAddress').mockReturnValue(false);

    const result = await sodax.leverageYield.createVaultIntent({
      params: vaultIntentParams(ARBITRUM),
      walletProvider: mockEvmProvider,
      raw: false,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('VALIDATION_FAILED');
    expect(result.error.context?.field).toBe('inputToken');
  });

  it('rejects an invalid spoke chain with VALIDATION_FAILED (field=srcChainKey)', async () => {
    vi.spyOn(sodax.config, 'isValidSpokeChainKey').mockReturnValue(false);

    const result = await sodax.leverageYield.createVaultIntent({
      params: vaultIntentParams(ARBITRUM),
      walletProvider: mockEvmProvider,
      raw: false,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('VALIDATION_FAILED');
    expect(result.error.context?.field).toBe('srcChainKey');
  });

  it('wraps a non-typed spoke.deposit failure as INTENT_CREATION_FAILED', async () => {
    const depositError = new Error('deposit reverted');
    mocks.constructCreateIntentData.mockReturnValueOnce(['0xdata', makeIntent(ARBITRUM), 0n]);
    vi.spyOn(sodax.spoke, 'deposit').mockResolvedValueOnce({ ok: false, error: depositError });

    const result = await sodax.leverageYield.createVaultIntent({
      params: vaultIntentParams(ARBITRUM),
      walletProvider: mockEvmProvider,
      raw: false,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('INTENT_CREATION_FAILED');
    expect(result.error.cause).toBe(depositError);
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
  const LY_FEE = { address: SAMPLE_USER, percentage: 100 } as const satisfies PartnerFee;
  const SWAP_FEE = { address: HUB_WALLET, percentage: 50 } as const satisfies PartnerFee;
  const GLOBAL_FEE = { address: POOL, percentage: 25 } as const satisfies PartnerFee;

  // Each precedence case needs its own instance: the fee is resolved from config at call time.
  // Re-applies the stubs `beforeEach` installs on the module-level `sodax`.
  const makeSodax = (options: SodaxOptions): Sodax => {
    const s = new Sodax(options);
    vi.spyOn(s.config, 'isValidOriginalAssetAddress').mockReturnValue(true);
    vi.spyOn(s.config, 'isValidSpokeChainKey').mockReturnValue(true);
    vi.spyOn(s.hubProvider, 'getUserHubWalletAddress').mockResolvedValue(HUB_WALLET);
    return s;
  };

  /** Runs the EVM-spoke deposit branch and returns the fee handed to intent construction. */
  const feeForDeposit = async (s: Sodax, overrides: { partnerFee?: PartnerFee } = {}) => {
    mocks.constructCreateIntentData.mockReturnValueOnce(['0xdata', makeIntent(ARBITRUM), 0n]);
    vi.spyOn(s.spoke, 'deposit').mockResolvedValueOnce({ ok: true, value: '0xspokeTx' });
    await s.leverageYield.createVaultIntent({
      params: vaultIntentParams(ARBITRUM),
      walletProvider: mockEvmProvider,
      raw: false,
      ...overrides,
    });
    return mocks.constructCreateIntentData.mock.calls[0]?.[3];
  };

  it('applies the configured leverageYield.partnerFee', async () => {
    expect(await feeForDeposit(makeSodax({ leverageYield: { partnerFee: LY_FEE } }))).toEqual(LY_FEE);
  });

  it('ignores swaps.partnerFee — the swap fee never applies to vault intents', async () => {
    expect(await feeForDeposit(makeSodax({ swaps: { partnerFee: SWAP_FEE } }))).toBeUndefined();
    // `calls[0]?.[3]` is also undefined when the mock was never called, so an early bail-out in
    // createVaultIntent would pass the assertion above vacuously. Pin that the branch was reached.
    expect(mocks.constructCreateIntentData).toHaveBeenCalledTimes(1);
  });

  it('leverageYield.partnerFee wins over swaps.partnerFee when both are set', async () => {
    const s = makeSodax({ swaps: { partnerFee: SWAP_FEE }, leverageYield: { partnerFee: LY_FEE } });
    expect(await feeForDeposit(s)).toEqual(LY_FEE);
  });

  it('falls back to the global fee when leverageYield.partnerFee is unset', async () => {
    expect(await feeForDeposit(makeSodax({ fee: GLOBAL_FEE }))).toEqual(GLOBAL_FEE);
  });

  it('leverageYield.partnerFee beats the global fee', async () => {
    expect(await feeForDeposit(makeSodax({ fee: GLOBAL_FEE, leverageYield: { partnerFee: LY_FEE } }))).toEqual(LY_FEE);
  });

  it('a per-intent partnerFee beats the configured leverageYield.partnerFee', async () => {
    const perIntent = { address: HUB_WALLET, percentage: 10 } as const satisfies PartnerFee;
    const s = makeSodax({ leverageYield: { partnerFee: LY_FEE } });
    expect(await feeForDeposit(s, { partnerFee: perIntent })).toEqual(perIntent);
  });

  it('applies the leverage-yield fee on the Sonic-source branch', async () => {
    const s = makeSodax({ swaps: { partnerFee: SWAP_FEE }, leverageYield: { partnerFee: LY_FEE } });
    mocks.sonicCreateSwapIntent.mockResolvedValueOnce(['0xsonicTx', makeIntent(SONIC), 0n, '0xdata']);

    await s.leverageYield.createVaultIntent({
      params: vaultIntentParams(SONIC),
      walletProvider: mockEvmProvider,
      raw: false,
    });

    expect(mocks.sonicCreateSwapIntent.mock.calls[0]?.[0].fee).toEqual(LY_FEE);
  });

  it('applies the leverage-yield fee on the hub-wallet-swap (withdraw) branch', async () => {
    const s = makeSodax({ swaps: { partnerFee: SWAP_FEE }, leverageYield: { partnerFee: LY_FEE } });
    mocks.constructCreateIntentData.mockReturnValueOnce(['0xhubdata', makeIntent(ARBITRUM), 0n]);
    vi.spyOn(s.spoke, 'sendMessage').mockResolvedValueOnce({ ok: true, value: '0xmsgTx' });

    await s.leverageYield.createVaultIntent({
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

    expect(mocks.constructCreateIntentData.mock.calls[0]?.[3]).toEqual(LY_FEE);
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
    mocks.solverGetQuote.mockResolvedValueOnce({ ok: true, value: { quoted_amount: 1n } });
    await s.leverageYield.getQuote({ ...quoteParams, ...overrides });
    expect(mocks.solverGetQuote).toHaveBeenCalledTimes(1);
    return mocks.solverGetQuote.mock.calls[0]?.[0].amount;
  };

  it('deducts the configured leverageYield.partnerFee before quoting', async () => {
    const amount = await quotedAmount(new Sodax({ leverageYield: { partnerFee: LY_FEE } }));
    expect(amount).toBe(990_000n); // 1% of 1_000_000
  });

  it('deducts nothing when no leverage-yield or global fee is configured', async () => {
    expect(await quotedAmount(new Sodax())).toBe(1_000_000n);
  });

  it('ignores swaps.partnerFee — matches what the vault intent will charge, not the swap fee', async () => {
    expect(await quotedAmount(new Sodax({ swaps: { partnerFee: SWAP_FEE } }))).toBe(1_000_000n);
  });

  it('honours a per-call partnerFee override', async () => {
    const s = new Sodax({ leverageYield: { partnerFee: LY_FEE } });
    const amount = await quotedAmount(s, { partnerFee: { address: HUB_WALLET, percentage: 10 } });
    expect(amount).toBe(999_000n); // 0.1% of 1_000_000
  });

  it('forwards the request fields unchanged and returns the solver response', async () => {
    const s = new Sodax();
    mocks.solverGetQuote.mockResolvedValueOnce({ ok: true, value: { quoted_amount: 4_242n } });
    const result = await s.leverageYield.getQuote(quoteParams);

    expect(result).toEqual({ ok: true, value: { quoted_amount: 4_242n } });
    const [forwarded, solverConfig] = mocks.solverGetQuote.mock.calls[0] ?? [];
    // partnerFee is stripped; every other field reaches the solver verbatim.
    expect(forwarded).toEqual({ ...quoteParams });
    expect(forwarded).not.toHaveProperty('partnerFee');
    // The instance under test, not the module-level `sodax`: deepMerge happens to share the
    // `solver` sub-object across instances, so asserting the other one would pass vacuously.
    expect(solverConfig).toBe(s.config.solver);
  });

  it('propagates a solver error Result instead of throwing', async () => {
    const error = { detail: { code: -4, message: 'no path' } };
    mocks.solverGetQuote.mockResolvedValueOnce({ ok: false, error });

    const result = await new Sodax().leverageYield.getQuote(quoteParams);

    expect(result).toEqual({ ok: false, error });
  });

  // The other LY methods return a Result for bad input; getQuote must not be the one that throws.
  it('returns VALIDATION_FAILED for a non-positive amount rather than rejecting', async () => {
    const result = await new Sodax().leverageYield.getQuote({ ...quoteParams, amount: 0n });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(isSodaxError(result.error) && result.error.code).toBe('VALIDATION_FAILED');
    expect(mocks.solverGetQuote).not.toHaveBeenCalled();
  });

  // A fee that leaves nothing to quote is an input/config problem, not a lookup failure — the
  // underlying fee arithmetic throws a bare invariant, which would otherwise be wrapped as
  // LOOKUP_FAILED and rendered as a retryable network-ish error.
  it('returns VALIDATION_FAILED when a fixed partner fee exceeds the quote amount', async () => {
    const s = new Sodax({ leverageYield: { partnerFee: { address: SAMPLE_USER, amount: 2_000_000n } } });

    const result = await s.leverageYield.getQuote(quoteParams); // amount is 1_000_000n

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(isSodaxError(result.error) && result.error.code).toBe('VALIDATION_FAILED');
    expect(mocks.solverGetQuote).not.toHaveBeenCalled();
  });

  it('returns VALIDATION_FAILED when a fixed partner fee equals the quote amount', async () => {
    const s = new Sodax({ leverageYield: { partnerFee: { address: SAMPLE_USER, amount: 1_000_000n } } });

    const result = await s.leverageYield.getQuote(quoteParams);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(isSodaxError(result.error) && result.error.code).toBe('VALIDATION_FAILED');
    expect(mocks.solverGetQuote).not.toHaveBeenCalled();
  });

  it.each([
    ['above the 10_000 bp scale', 20_000],
    ['negative', -5],
    // Fractional passes calculateFeeAmount's bounds check, then BigInt(0.5) throws a RangeError.
    ['fractional', 0.5],
  ])('returns VALIDATION_FAILED for a %s percentage fee', async (_label, percentage) => {
    const s = new Sodax({ leverageYield: { partnerFee: { address: SAMPLE_USER, percentage } } });

    const result = await s.leverageYield.getQuote(quoteParams);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(isSodaxError(result.error) && result.error.code).toBe('VALIDATION_FAILED');
    expect(mocks.solverGetQuote).not.toHaveBeenCalled();
  });

  it('returns VALIDATION_FAILED when a 100% percentage fee consumes the whole amount', async () => {
    const s = new Sodax({ leverageYield: { partnerFee: { address: SAMPLE_USER, percentage: 10_000 } } });

    const result = await s.leverageYield.getQuote(quoteParams);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(isSodaxError(result.error) && result.error.code).toBe('VALIDATION_FAILED');
    expect(mocks.solverGetQuote).not.toHaveBeenCalled();
  });

  it('tags error context with token-side chain keys, not srcChainKey/dstChainKey', async () => {
    const result = await new Sodax().leverageYield.getQuote({ ...quoteParams, amount: 0n });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    if (!isSodaxError(result.error)) throw new Error('expected a SodaxError');
    // A withdraw quote's token_src lives on the hub, so `srcChainKey` would misreport the chain
    // the user signs on. Neutral names keep the field meanings intact across both directions.
    expect(result.error.context).toMatchObject({
      method: 'getQuote',
      tokenSrcChainKey: ARBITRUM,
      tokenDstChainKey: HUB,
    });
    expect(result.error.context).not.toHaveProperty('srcChainKey');
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
    expect(mocks.solverPostExecution).not.toHaveBeenCalled();
  });

  it('propagates a solver postExecution error as EXTERNAL_API_ERROR with solverCode', async () => {
    stubCreateVaultIntentOk(SONIC);
    const detail = { code: -7, message: 'no execution module found' };
    mocks.solverPostExecution.mockResolvedValueOnce({ ok: false, error: { detail } });

    const result = await sodax.leverageYield.vaultSwap({
      params: vaultIntentParams(SONIC),
      walletProvider: mockEvmProvider,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('EXTERNAL_API_ERROR');
    expect(result.error.context?.solverCode).toBe(-7);
    expect(result.error.context?.phase).toBe('postExecution');
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

  it('on backend "solved", returns the VaultSwapResponse from the backend (no client-side relay)', async () => {
    stubCreatedAndVerified();
    const submitSpy = stubAcceptedSubmit();
    vi.spyOn(sodaxBE.api.leverageYield, 'getSubmitTxStatus').mockResolvedValueOnce(
      statusEnvelope({ status: 'solved', result: { dstIntentTxHash: '0xDST', intent_hash: '0xhash' } }),
    );

    const result = await sodaxBE.leverageYield.vaultSwap(vaultSwapInput());

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.solverExecutionResponse).toEqual({ answer: 'OK', intent_hash: '0xhash' });
    expect(result.value.intentDeliveryInfo.srcTxHash).toBe('0xspokeTx');
    expect(result.value.intentDeliveryInfo.dstTxHash).toBe('0xDST');
    // The backend owns relay + post-execution — neither client-side leg may run.
    expect(submitSpy).toHaveBeenCalledOnce();
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

  it('does not verify on-chain before handing the intent to the backend', async () => {
    const verifySpy = stubCreatedAndVerified();
    stubAcceptedSubmit();
    vi.spyOn(sodaxBE.api.leverageYield, 'getSubmitTxStatus').mockResolvedValueOnce(
      statusEnvelope({ status: 'solved', result: { dstIntentTxHash: '0xDST', intent_hash: '0xhash' } }),
    );

    expect((await sodaxBE.leverageYield.vaultSwap(vaultSwapInput())).ok).toBe(true);
    // Backend success costs nothing in verification — verifying first would delay it by the source
    // chain's confirmation wait and could fail a vault swap the backend would have completed.
    expect(verifySpy).not.toHaveBeenCalled();
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

  it('falls back on a 200 that reports success:false instead of polling a row that will never exist', async () => {
    stubCreatedAndVerified();
    const submitSpy = vi.spyOn(sodaxBE.api.leverageYield, 'submitTx').mockResolvedValueOnce({
      ok: true,
      value: { success: false, data: { status: 'inserted', message: 'not queued' } },
    });
    const statusSpy = vi.spyOn(sodaxBE.api.leverageYield, 'getSubmitTxStatus');
    mocks.relayTxAndWaitPacket.mockResolvedValueOnce({ ok: true, value: { dst_tx_hash: '0xFALLBACKDST' } });
    mocks.solverPostExecution.mockResolvedValueOnce({ ok: true, value: { answer: 'OK', intent_hash: '0xfb' } });

    const result = await sodaxBE.leverageYield.vaultSwap(vaultSwapInput(30_000));

    expect(result.ok).toBe(true);
    expect(submitSpy).toHaveBeenCalledOnce();
    // `ok` is transport-level only: a 200 carrying success:false means the backend did NOT queue the
    // submission, so there is nothing to watch for.
    expect(statusSpy).not.toHaveBeenCalled();
    expect(mocks.relayTxAndWaitPacket).toHaveBeenCalledOnce();
  });

  it('falls back when the backend reports a terminal "failed" status', async () => {
    stubCreatedAndVerified();
    stubAcceptedSubmit();
    vi.spyOn(sodaxBE.api.leverageYield, 'getSubmitTxStatus').mockResolvedValueOnce(
      statusEnvelope({ status: 'failed', failureReason: 'boom' }),
    );
    mocks.relayTxAndWaitPacket.mockResolvedValueOnce({ ok: true, value: { dst_tx_hash: '0xFALLBACKDST' } });
    mocks.solverPostExecution.mockResolvedValueOnce({ ok: true, value: { answer: 'OK', intent_hash: '0xfb' } });

    const result = await sodaxBE.leverageYield.vaultSwap(vaultSwapInput());

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.intentDeliveryInfo.dstTxHash).toBe('0xFALLBACKDST');
    expect(mocks.relayTxAndWaitPacket).toHaveBeenCalledOnce();
  });

  it('stops polling once the backend rejects the API key, rather than burning the attempt', async () => {
    stubCreatedAndVerified();
    stubAcceptedSubmit();
    const statusSpy = vi.spyOn(sodaxBE.api.leverageYield, 'getSubmitTxStatus').mockResolvedValue({
      ok: false,
      error: new SodaxError('EXTERNAL_API_ERROR', 'Unauthorized', {
        feature: 'backend',
        context: { api: 'leverageYield', endpoint: '/leverage-yield/submit-tx/status', status: 401 },
      }),
    });
    mocks.relayTxAndWaitPacket.mockResolvedValueOnce({ ok: true, value: { dst_tx_hash: '0xFALLBACKDST' } });
    mocks.solverPostExecution.mockResolvedValueOnce({ ok: true, value: { answer: 'OK', intent_hash: '0xfb' } });

    const result = await sodaxBE.leverageYield.vaultSwap(vaultSwapInput(30_000));

    expect(result.ok).toBe(true);
    // A rejected key cannot become success by waiting; retrying it would spend the whole attempt the
    // client-side fallback is waiting on.
    expect(statusSpy).toHaveBeenCalledOnce();
    expect(mocks.relayTxAndWaitPacket).toHaveBeenCalledOnce();
  });

  it('clamps each backend request by the service timeout, not the caller budget alone', async () => {
    stubCreatedAndVerified();
    const submitSpy = stubAcceptedSubmit();
    vi.spyOn(sodaxBE.api.leverageYield, 'getSubmitTxStatus').mockResolvedValueOnce(
      statusEnvelope({ status: 'solved', result: { dstIntentTxHash: '0xDST', intent_hash: '0xhash' } }),
    );

    // A caller budget far above the service timeout must not RAISE the per-request bound: an override
    // REPLACES `config.timeout` rather than lowering it.
    await sodaxBE.leverageYield.vaultSwap(vaultSwapInput(600_000));

    expect(submitSpy.mock.calls[0]?.[1]).toEqual({ timeout: DEFAULT_BACKEND_API_TIMEOUT });
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

  it('skips the backend POST entirely when the caller leaves no budget', async () => {
    stubCreatedAndVerified();
    // Stubbed even though the assertion is that it never runs: an unmocked spy calls through, so a
    // regression in the budget guard would turn this unit test into a real POST to the live backend.
    const submitSpy = vi.spyOn(sodaxBE.api.leverageYield, 'submitTx').mockResolvedValue({
      ok: false,
      error: new SodaxError('EXTERNAL_API_ERROR', 'unreachable', { feature: 'backend' }),
    });
    mocks.relayTxAndWaitPacket.mockResolvedValueOnce({ ok: true, value: { dst_tx_hash: '0xFALLBACKDST' } });
    mocks.solverPostExecution.mockResolvedValueOnce({ ok: true, value: { answer: 'OK', intent_hash: '0xfb' } });

    const result = await sodaxBE.leverageYield.vaultSwap(vaultSwapInput(0));

    expect(result.ok).toBe(true);
    // Firing the POST would only arm an abort at 0ms; the relay still runs on its floor because the
    // intent has already landed on-chain.
    expect(submitSpy).not.toHaveBeenCalled();
    expect(mocks.relayTxAndWaitPacket.mock.calls.at(-1)?.[0]?.timeout).toBe(RELAY_FALLBACK_FLOOR_MS);
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

  it('does not touch the backend submit API when the flag is explicitly off', async () => {
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
    });

    expect(result.ok).toBe(true);
    expect(submitSpy).not.toHaveBeenCalled();
    expect(sodax.leverageYield.useBackendSubmitTx).toBe(false);
    expect(sodaxBE.leverageYield.useBackendSubmitTx).toBe(true);
  });

  it('raises a sub-floor caller timeout to the relay floor on the client-side path', async () => {
    const intent = makeIntent(ARBITRUM);
    vi.spyOn(sodax.leverageYield, 'createVaultIntent').mockResolvedValueOnce({
      ok: true,
      value: {
        tx: '0xspokeTx',
        intent: { ...intent, feeAmount: 0n },
        relayData: { address: intent.creator, payload: '0xdata' },
      },
    });
    mocks.relayTxAndWaitPacket.mockResolvedValueOnce({ ok: true, value: { dst_tx_hash: '0xdstTx' } });
    mocks.solverPostExecution.mockResolvedValueOnce({ ok: true, value: { answer: 'OK', intent_hash: '0xhash' } });

    const result = await sodax.leverageYield.vaultSwap({
      params: vaultIntentParams(ARBITRUM, { dstChainKey: ARBITRUM as SpokeChainKey, dstAddress: SAMPLE_USER }),
      walletProvider: mockEvmProvider,
      timeout: 2_000,
    });

    expect(result.ok).toBe(true);
    // The floor deliberately outranks a sub-floor caller `timeout` (matching SwapService): the intent
    // has already landed, and `relayTxAndWaitPacket` submits before `timeout` bounds the wait.
    expect(mocks.relayTxAndWaitPacket.mock.calls.at(-1)?.[0]?.timeout).toBe(RELAY_FALLBACK_FLOOR_MS);
  });

  it('threads extras.apiKey into the backend submit-tx leg as a per-request override', async () => {
    stubCreatedAndVerified();
    const submitSpy = stubAcceptedSubmit();
    const statusSpy = vi
      .spyOn(sodaxBE.api.leverageYield, 'getSubmitTxStatus')
      .mockResolvedValueOnce(
        statusEnvelope({ status: 'solved', result: { dstIntentTxHash: '0xDST', intent_hash: '0xhash' } }),
      );

    const result = await sodaxBE.leverageYield.vaultSwap({
      ...vaultSwapInput(),
      extras: { apiKey: 'per-action-key' },
    });

    expect(result.ok).toBe(true);
    // Both the POST and the status poll carry the per-action key (as RequestOverrideConfig.apiKey).
    expect(submitSpy.mock.calls[0]?.[1]).toMatchObject({ apiKey: 'per-action-key' });
    expect(statusSpy.mock.calls[0]?.[1]).toMatchObject({ apiKey: 'per-action-key' });
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

  /** The `x-api-key` actually sent to (pathname, method), read through `Headers` so any casing counts. */
  const keySentTo = (pathname: string, method: string): string | null => {
    const matches = wireFetch.mock.calls.filter(
      call => new URL(String(call[0])).pathname === pathname && (call[1]?.method ?? 'GET') === method,
    );
    expect(matches).toHaveLength(1);
    return new Headers(matches[0]?.[1]?.headers).get('x-api-key');
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

  it('sends extras.apiKey over the instance key on both the submit POST and the status poll', async () => {
    await runKeyedVaultSwap({ apiKey: 'action-key' });
    expect(keySentTo('/v1/leverage-yield/submit-tx', 'POST')).toBe('action-key');
    expect(keySentTo('/v1/leverage-yield/submit-tx/status', 'GET')).toBe('action-key');
  });

  it('sends the instance key on both requests when extras is omitted', async () => {
    await runKeyedVaultSwap();
    expect(keySentTo('/v1/leverage-yield/submit-tx', 'POST')).toBe('instance-key');
    expect(keySentTo('/v1/leverage-yield/submit-tx/status', 'GET')).toBe('instance-key');
  });

  it('treats an empty extras.apiKey as unset: the instance key still rides both requests', async () => {
    await runKeyedVaultSwap({ apiKey: '' });
    expect(keySentTo('/v1/leverage-yield/submit-tx', 'POST')).toBe('instance-key');
    expect(keySentTo('/v1/leverage-yield/submit-tx/status', 'GET')).toBe('instance-key');
  });

  it('keys each action on its own — a per-action key does not leak into the next', async () => {
    // The case the option exists for: several keys through ONE instance, which used to mean one
    // `Sodax` per key. The override is per call, so it must neither persist nor overwrite the
    // instance key.
    await runKeyedVaultSwap({ apiKey: 'tenant-A' });
    await runKeyedVaultSwap({ apiKey: 'tenant-B' });
    await runKeyedVaultSwap();
    await runKeyedVaultSwap({ apiKey: 'tenant-A' });

    const submitPosts = wireFetch.mock.calls.filter(
      call => new URL(String(call[0])).pathname === '/v1/leverage-yield/submit-tx' && call[1]?.method === 'POST',
    );
    expect(submitPosts.map(call => new Headers(call[1]?.headers).get('x-api-key'))).toEqual([
      'tenant-A',
      'tenant-B',
      'instance-key',
      'tenant-A',
    ]);
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
    record({ status: 'relaying' });

    const result = await sodaxDS.leverageYield.getDetailedStatus(key);

    expect(result.ok).toBe(true);
    if (!result.ok || result.value.source !== 'backend') throw new Error('expected a backend answer');
    expect(result.value.data.status).toBe('relaying');
    expect(mocks.getTransactionPackets).not.toHaveBeenCalled();
    expect(mocks.solverGetStatus).not.toHaveBeenCalled();
  });

  it('passes a per-request override to the backend read', async () => {
    const statusSpy = record({ status: 'relaying' });

    await sodaxDS.leverageYield.getDetailedStatus(key, { apiKey: 'per-action-key' });

    expect(statusSpy).toHaveBeenCalledWith({ txHash: SRC_TX, srcChainKey: ARBITRUM }, { apiKey: 'per-action-key' });
  });

  it.each([
    ['no record exists', () => backendFails('not found', 404)],
    ['the record reports a success:false envelope', () => recordNotFound()],
    ['the backend gave up terminally', () => record({ status: 'failed' })],
    ['the backend abandoned the record mid-flight', () => record({ status: 'relayed', abandonedAt: 'now' })],
    ['the backend is unreachable', () => backendFails('backend unavailable', 503)],
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

  it('never hands the solver a packet that is not a delivered match for this tx', async () => {
    backendFails('not found', 404);
    packets([
      { status: 'executed', dst_tx_hash: HUB_TX, src_tx_hash: '0xsomeoneelse', src_chain_id: RELAY_CHAIN_ID },
      { status: 'validating', dst_tx_hash: '', src_tx_hash: SRC_TX, src_chain_id: RELAY_CHAIN_ID },
    ]);

    const result = await sodaxDS.leverageYield.getDetailedStatus(key);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('LOOKUP_FAILED');
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

  it('fails rather than casting when the relay packet carries a malformed hub hash', async () => {
    backendFails('not found', 404);
    packets([{ status: 'executed', dst_tx_hash: 'not-hex', src_tx_hash: SRC_TX, src_chain_id: RELAY_CHAIN_ID }]);

    const result = await sodaxDS.leverageYield.getDetailedStatus(key);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('LOOKUP_FAILED');
    expect(result.error.context?.reason).toBeUndefined();
    expect(mocks.solverGetStatus).not.toHaveBeenCalled();
  });

  it('reconciles a solver NOT_FOUND against the durable intent record', async () => {
    backendFails('not found', 404);
    packets(delivered);
    solverSays(SolverIntentStatusCode.NOT_FOUND);
    // A vault intent reaches the same journal as a swap's — it is created on the same hub Intents
    // contract — so a restarted solver's amnesia is recoverable from the record.
    vi.spyOn(sodaxDS.api, 'getIntentByTxHash').mockResolvedValueOnce({
      ok: true,
      value: {
        events: [{ eventType: 'intent-filled', txHash: '0xfillTx', intentState: { remainingInput: '0' } }],
      },
    } as never);

    const result = await sodaxDS.leverageYield.getDetailedStatus(key);

    expect(result.ok).toBe(true);
    if (!result.ok || result.value.source !== 'solver') throw new Error('expected the solver arm');
    expect(result.value.data.status).toBe(SolverIntentStatusCode.SOLVED);
    expect(result.value.data.fill_tx_hash).toBe('0xfillTx');
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

  it('sends the per-request key to the solver leg too, not just the backend read', async () => {
    // One override should key the whole call; a caller passing a key for the record read and
    // silently getting the instance key on the solver read is the surprise this guards.
    backendFails('not found', 404);
    packets(delivered);
    solverSays(SolverIntentStatusCode.SOLVED, '0xfill');

    await sodaxDS.leverageYield.getDetailedStatus(key, { apiKey: 'per-action-key' });

    // SolverApiService.getStatus takes the api key as its 5th argument.
    expect(mocks.solverGetStatus.mock.calls[0]?.[4]).toBe('per-action-key');
  });

  it('sends the per-request key to the durable-record read behind a solver NOT_FOUND', async () => {
    // The reconcile is a third request, and on another service — a key that is not also the instance
    // key would silently drop off the one leg that can prove a forgotten intent was filled.
    backendFails('not found', 404);
    packets(delivered);
    solverSays(SolverIntentStatusCode.NOT_FOUND);
    const intentSpy = vi
      .spyOn(sodaxDS.api, 'getIntentByTxHash')
      .mockResolvedValueOnce({ ok: true, value: { events: [] } } as never);

    await sodaxDS.leverageYield.getDetailedStatus(key, { apiKey: 'per-action-key' });

    // The clamped reconcile timeout still rides along; the key is additional, not a replacement.
    expect(intentSpy.mock.calls[0]?.[1]).toMatchObject({ apiKey: 'per-action-key', timeout: expect.any(Number) });
  });

  it.each([401, 403])('treats a rejected API key as terminal instead of degrading (%i)', async status => {
    backendFails('rejected', status);

    const result = await sodaxDS.leverageYield.getDetailedStatus(key);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    // Lifted so `isAuthFailure` recognises the wrapped error — it reads `context.status` only.
    expect(result.error.context?.status).toBe(status);
    expect(isAuthFailure(result.error)).toBe(true);
    expect(result.error.context?.reason).toBeUndefined();
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
  it('returns the solver acknowledgement on success (manual create → relay → notify path)', async () => {
    mocks.solverPostExecution.mockResolvedValueOnce({ ok: true, value: { answer: 'OK', intent_hash: '0xhash' } });

    const result = await sodax.leverageYield.notifySolver({ intent_tx_hash: '0xhubIntentTx' });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toEqual({ answer: 'OK', intent_hash: '0xhash' });
    expect(mocks.solverPostExecution.mock.calls[0]?.[0]).toEqual({ intent_tx_hash: '0xhubIntentTx' });
  });

  it('maps a solver error response to EXTERNAL_API_ERROR with solverCode', async () => {
    mocks.solverPostExecution.mockResolvedValueOnce({ ok: false, error: { detail: { code: -7, message: 'boom' } } });

    const result = await sodax.leverageYield.notifySolver({ intent_tx_hash: '0xhubIntentTx' });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('EXTERNAL_API_ERROR');
    expect(result.error.context?.solverCode).toBe(-7);
    expect(result.error.context?.phase).toBe('postExecution');
  });

  it('forwards the configured backend API key to the solver', async () => {
    const keyed = new Sodax({ apiKey: 'instance-key', logger: 'silent' });
    mocks.solverPostExecution.mockResolvedValueOnce({ ok: true, value: { answer: 'OK', intent_hash: '0xhash' } });

    await keyed.leverageYield.notifySolver({ intent_tx_hash: '0xhubIntentTx' });

    expect(mocks.solverPostExecution.mock.calls[0]?.[3]).toBe('instance-key');
  });
});

// ─── approve / isAllowanceValid — Sonic-direct underlying-asset allowance ──

describe('LeverageYieldService.approve', () => {
  it('resolves the vault asset and approves it to the vault (non-raw)', async () => {
    stubReadContract({ asset: SODA_ASSET });
    mocks.erc20Approve.mockResolvedValueOnce('0xapproveTx');

    const result = await sodax.leverageYield.approve({ vault: VAULT, amount: 100n, walletProvider: mockEvmProvider });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toBe('0xapproveTx');
    expect(mocks.erc20Approve.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({ token: SODA_ASSET, spender: VAULT, from: SAMPLE_USER, amount: 100n, raw: false }),
    );
  });

  it('clears a stale allowance first when the vault asset needs it', async () => {
    stubReadContract({ asset: SODA_ASSET });
    mocks.erc20PlanApproval.mockResolvedValueOnce({ resetAmount: 0n, approveAmount: 100n, reason: 'reset-required' });
    mocks.erc20Approve.mockResolvedValueOnce('0xresetTx').mockResolvedValueOnce('0xapproveTx');
    vi.spyOn(sodax.spoke, 'waitForTxReceipt').mockResolvedValue({
      ok: true,
      value: { status: 'success', receipt: {} },
    });

    const result = await sodax.leverageYield.approve({ vault: VAULT, amount: 100n, walletProvider: mockEvmProvider });

    // Routing through SpokeService is what buys this — a direct Erc20Service.approve would
    // dead-end on a USDT-class asset.
    expect(result).toEqual({ ok: true, value: '0xapproveTx' });
    expect(mocks.erc20Approve).toHaveBeenCalledTimes(2);
    expect(mocks.erc20Approve.mock.calls[0]?.[0]).toEqual(expect.objectContaining({ amount: 0n }));
  });

  it('returns raw approve tx data when raw=true', async () => {
    stubReadContract({ asset: SODA_ASSET });
    mocks.erc20Approve.mockResolvedValueOnce('0xrawApprove');

    const result = await sodax.leverageYield.approve({
      vault: VAULT,
      amount: 100n,
      walletProvider: mockEvmProvider,
      raw: true,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toBe('0xrawApprove');
    expect(mocks.erc20Approve.mock.calls[0]?.[0]).toEqual(expect.objectContaining({ raw: true }));
  });

  it('rejects a non-positive amount with VALIDATION_FAILED (field=amount)', async () => {
    const result = await sodax.leverageYield.approve({ vault: VAULT, amount: 0n, walletProvider: mockEvmProvider });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('VALIDATION_FAILED');
    expect(result.error.context?.field).toBe('amount');
    expect(mocks.erc20Approve).not.toHaveBeenCalled();
  });

  it('wraps a getAsset failure as APPROVE_FAILED', async () => {
    vi.spyOn(sodax.hubProvider.publicClient, 'readContract').mockRejectedValue(new Error('asset read failed'));

    const result = await sodax.leverageYield.approve({ vault: VAULT, amount: 100n, walletProvider: mockEvmProvider });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('APPROVE_FAILED');
    expect(mocks.erc20Approve).not.toHaveBeenCalled();
  });
});

describe('LeverageYieldService.isAllowanceValid', () => {
  it('returns true when the on-chain allowance covers the amount', async () => {
    stubReadContract({ asset: SODA_ASSET, allowance: 100n });
    const result = await sodax.leverageYield.isAllowanceValid({ vault: VAULT, amount: 50n, owner: SAMPLE_USER });
    expect(result).toEqual({ ok: true, value: true });
  });

  it('returns false when the on-chain allowance is short', async () => {
    stubReadContract({ asset: SODA_ASSET, allowance: 100n });
    const result = await sodax.leverageYield.isAllowanceValid({ vault: VAULT, amount: 150n, owner: SAMPLE_USER });
    expect(result).toEqual({ ok: true, value: false });
  });

  it('rejects a non-positive amount with VALIDATION_FAILED (action=allowanceCheck)', async () => {
    const result = await sodax.leverageYield.isAllowanceValid({ vault: VAULT, amount: 0n, owner: SAMPLE_USER });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('VALIDATION_FAILED');
    expect(result.error.context?.action).toBe('allowanceCheck');
  });

  it('wraps a getAsset failure as ALLOWANCE_CHECK_FAILED', async () => {
    vi.spyOn(sodax.hubProvider.publicClient, 'readContract').mockRejectedValue(new Error('asset read failed'));
    const result = await sodax.leverageYield.isAllowanceValid({ vault: VAULT, amount: 50n, owner: SAMPLE_USER });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('ALLOWANCE_CHECK_FAILED');
  });
});

// ─── getMaxWithdrawForUser — hub-wallet resolution + dust-buffer clamp ──

describe('LeverageYieldService.getMaxWithdrawForUser', () => {
  it('trims MAX_WITHDRAW_DUST_BUFFER (1000) from the on-chain maxWithdraw', async () => {
    mocks.erc4626GetMaxWithdraw.mockResolvedValueOnce({ ok: true, value: 10_000n });
    const result = await sodax.leverageYield.getMaxWithdrawForUser(VAULT, ARBITRUM, SAMPLE_USER);
    expect(result).toEqual({ ok: true, value: 9_000n });
    expect(mocks.erc4626GetMaxWithdraw.mock.calls[0]?.slice(0, 2)).toEqual([VAULT, HUB_WALLET]);
  });

  it('clamps to 0 when maxWithdraw is below the dust buffer (no underflow)', async () => {
    mocks.erc4626GetMaxWithdraw.mockResolvedValueOnce({ ok: true, value: 500n });
    const result = await sodax.leverageYield.getMaxWithdrawForUser(VAULT, ARBITRUM, SAMPLE_USER);
    expect(result).toEqual({ ok: true, value: 0n });
  });

  it('propagates the inner getMaxWithdraw LOOKUP_FAILED (method=getMaxWithdraw)', async () => {
    mocks.erc4626GetMaxWithdraw.mockResolvedValueOnce({ ok: false, error: new Error('maxWithdraw revert') });
    const result = await sodax.leverageYield.getMaxWithdrawForUser(VAULT, ARBITRUM, SAMPLE_USER);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('LOOKUP_FAILED');
    expect(result.error.context?.method).toBe('getMaxWithdraw');
  });

  it('wraps a hub-wallet resolution failure as LOOKUP_FAILED (method=getMaxWithdrawForUser, with srcChainKey)', async () => {
    mocks.getUserHubWalletAddress.mockReset();
    mocks.getUserHubWalletAddress.mockRejectedValueOnce(new Error('hub wallet derivation failed'));
    const result = await sodax.leverageYield.getMaxWithdrawForUser(VAULT, ARBITRUM, SAMPLE_USER);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('LOOKUP_FAILED');
    expect(result.error.context?.method).toBe('getMaxWithdrawForUser');
    expect(result.error.context?.srcChainKey).toBe(ARBITRUM);
  });
});

// ─── Representative reads — tuple decode, balanceOf, Erc4626 delegation ──

describe('LeverageYieldService reads', () => {
  it('getPosition decodes the getPositionDetails tuple into named fields', async () => {
    stubReadContract({ position: [1n, 2n, 3n, 4n, 5n] });
    const result = await sodax.leverageYield.getPosition(VAULT);
    expect(result).toEqual({ ok: true, value: { collateral: 1n, debt: 2n, ltv: 3n, healthFactor: 4n, idleAsset: 5n } });
  });

  it('getShareBalance reads balanceOf(owner)', async () => {
    stubReadContract({ balance: 777n });
    const result = await sodax.leverageYield.getShareBalance(VAULT, SAMPLE_USER);
    expect(result).toEqual({ ok: true, value: 777n });
  });

  it('getShareBalanceForUser resolves the hub wallet then reads its balance', async () => {
    stubReadContract({ balance: 888n });
    const result = await sodax.leverageYield.getShareBalanceForUser(VAULT, ARBITRUM, SAMPLE_USER);
    expect(result).toEqual({ ok: true, value: 888n });
  });

  it('getTotalAssets delegates to Erc4626Service and forwards the value', async () => {
    mocks.erc4626GetTotalAssets.mockResolvedValueOnce({ ok: true, value: 5_000n });
    const result = await sodax.leverageYield.getTotalAssets(VAULT);
    expect(result).toEqual({ ok: true, value: 5_000n });
  });

  it('getTotalAssets maps an Erc4626 failure to LOOKUP_FAILED (method=getTotalAssets)', async () => {
    mocks.erc4626GetTotalAssets.mockResolvedValueOnce({ ok: false, error: new Error('totalAssets revert') });
    const result = await sodax.leverageYield.getTotalAssets(VAULT);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('LOOKUP_FAILED');
    expect(result.error.context?.method).toBe('getTotalAssets');
  });

  it('previewDeposit / previewWithdraw / previewRedeem forward the Erc4626 value', async () => {
    mocks.erc4626PreviewDeposit.mockResolvedValueOnce({ ok: true, value: 11n });
    mocks.erc4626PreviewWithdraw.mockResolvedValueOnce({ ok: true, value: 22n });
    mocks.erc4626PreviewRedeem.mockResolvedValueOnce({ ok: true, value: 33n });

    expect(await sodax.leverageYield.previewDeposit(VAULT, 100n)).toEqual({ ok: true, value: 11n });
    expect(await sodax.leverageYield.previewWithdraw(VAULT, 100n)).toEqual({ ok: true, value: 22n });
    expect(await sodax.leverageYield.previewRedeem(VAULT, 100n)).toEqual({ ok: true, value: 33n });
  });

  it('previewRedeem maps an Erc4626 failure to LOOKUP_FAILED (method=previewRedeem)', async () => {
    mocks.erc4626PreviewRedeem.mockResolvedValueOnce({ ok: false, error: new Error('previewRedeem revert') });
    const result = await sodax.leverageYield.previewRedeem(VAULT, 100n);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('LOOKUP_FAILED');
    expect(result.error.context?.method).toBe('previewRedeem');
  });
});

// ─── Additional error-path coverage ──────────────────────────────────────

describe('LeverageYieldService — additional error paths', () => {
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

  it('createVaultIntent wraps a hub-wallet sendMessage failure as INTENT_CREATION_FAILED', async () => {
    const sendError = new Error('sendMessage reverted');
    mocks.constructCreateIntentData.mockReturnValueOnce(['0xhubdata', makeIntent(ARBITRUM), 0n]);
    vi.spyOn(sodax.spoke, 'sendMessage').mockResolvedValueOnce({ ok: false, error: sendError });

    const result = await sodax.leverageYield.createVaultIntent({
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

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('INTENT_CREATION_FAILED');
    expect(result.error.cause).toBe(sendError);
  });

  it('vaultSwap surfaces a malformed solver response as EXTERNAL_API_ERROR with a synthetic solverCode', async () => {
    const intent = makeIntent(SONIC);
    vi.spyOn(sodax.leverageYield, 'createVaultIntent').mockResolvedValueOnce({
      ok: true,
      value: {
        tx: '0xsonicTx',
        intent: { ...intent, feeAmount: 0n },
        relayData: { address: intent.creator, payload: '0xdata' },
      },
    });
    // postExecution returns a failure with no `detail` — notifySolver substitutes a synthetic one.
    mocks.solverPostExecution.mockResolvedValueOnce({ ok: false, error: {} });

    const result = await sodax.leverageYield.vaultSwap({
      params: vaultIntentParams(SONIC),
      walletProvider: mockEvmProvider,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('EXTERNAL_API_ERROR');
    expect(result.error.context?.solverCode).toBe(-999);
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

  for (const [name, run] of [
    ['deposit', runDeposit],
    ['withdraw', runWithdraw],
  ] as const) {
    it(`${name}: 1) param fee wins over feature + global + swaps`, async () => {
      expect(
        await run({ fee: GLOBAL, swaps: { partnerFee: SWAPS }, leverageYield: { partnerFee: FEATURE } }, PARAM),
      ).toEqual(PARAM);
    });
    it(`${name}: 2) feature fee wins over global + swaps`, async () => {
      expect(await run({ fee: GLOBAL, swaps: { partnerFee: SWAPS }, leverageYield: { partnerFee: FEATURE } })).toEqual(
        FEATURE,
      );
    });
    it(`${name}: 3) global fee applies when feature unset`, async () => {
      expect(await run({ fee: GLOBAL, swaps: { partnerFee: SWAPS } })).toEqual(GLOBAL);
    });
    it(`${name}: 4) no fee when nothing configured`, async () => {
      expect(await run({ swaps: { partnerFee: SWAPS } })).toBeUndefined();
    });
  }
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

describe('LeverageYieldService — position partner fee', () => {
  const PARTNER = '0x9999999999999999999999999999999999999999' as Address;

  function build(sodaxInstance: Sodax, partnerFee?: { address: Address; percentage: number } | { amount: bigint }) {
    return sodaxInstance.leverageYield.buildCreatePositionAndLeverage({
      from: POSITION_OWNER,
      owner: POSITION_OWNER,
      collateral: POS_COLLATERAL,
      borrowToken: POS_BORROW_TOKEN,
      eModeCategory: 3,
      origin: { chainKey: 'sonic', address: POSITION_OWNER },
      initialAssets: 10n ** 18n,
      borrowAmount: 10n ** 18n,
      minCollateralOut: 1n,
      ...(partnerFee ? { partnerFee: partnerFee as never } : {}),
    });
  }

  /**
   * Decoded rather than read by word offset: `PositionConfig` is a DYNAMIC tuple (it carries
   * `bytes originAddress`), so its head is offsets, not values, and hand-indexing words silently
   * reads the wrong field — which is exactly what the first version of this test did.
   */
  const CFG_ABI = parseAbi([
    'function createPositionAndLeverage((address owner, address collateral, address borrowToken, uint8 eModeCategory, uint256 originChainId, bytes originAddress, address originAsset, address feeReceiver, uint16 feeBps) cfg, uint256 initialAssets, uint256 borrowAmount, uint256 minCollateralOut) returns (address)',
  ]);
  function feeOf(data: Hex): { receiver: string; bps: number } {
    const { args } = decodeFunctionData({ abi: CFG_ABI, data });
    const cfg = args[0] as { feeReceiver: string; feeBps: number };
    return { receiver: cfg.feeReceiver, bps: cfg.feeBps };
  }

  it('bakes a percentage fee into PositionConfig', () => {
    const result = build(sodax, { address: PARTNER, percentage: 50 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const { receiver, bps } = feeOf(result.value.data);
    expect(receiver.toLowerCase()).toBe(PARTNER.toLowerCase());
    expect(bps).toBe(50);
  });

  it('encodes no fee when none is configured, so an unpartnered position is unchanged', () => {
    const result = build(sodax);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const { receiver, bps } = feeOf(result.value.data);
    expect(BigInt(receiver)).toBe(0n);
    expect(bps).toBe(0);
  });

  /**
   * `PositionConfig` stores basis points and the contract derives the amount per operation, so a
   * fixed-amount fee has nowhere to go. Rejected rather than silently dropped — dropping it would
   * hand a partner a position that quietly earns them nothing.
   */
  it('rejects the fixed-amount fee variant', () => {
    const result = build(sodax, { amount: 1_000n });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('LOOKUP_FAILED');
  });

  it('takes the fee from the Sodax config when the call does not override it', () => {
    const configured = new Sodax({ leverageYield: { partnerFee: { address: PARTNER, percentage: 25 } } });
    const result = build(configured);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(feeOf(result.value.data).bps).toBe(25);
  });

  /**
   * A position's fee is fixed at creation, so an out-of-range value is not one mispriced intent — it
   * is every operation the position will ever run. `50_000` is the case that motivated this: 500%,
   * but it fits a `uint16`, so nothing downstream rejected it and the batch encoded cleanly.
   */
  it('rejects a fee percentage that is fractional, negative, or above MAX_POSITION_FEE_BPS', () => {
    for (const percentage of [0.5, -100, 101, 10_000, 50_000]) {
      const result = build(sodax, { address: PARTNER, percentage });
      expect(result.ok).toBe(false);
      if (result.ok) continue;
      expect(result.error.code).toBe('LOOKUP_FAILED');
    }
  });

  /** The ceiling itself stays valid — this asserts the guard rejects, and does not move the bound. */
  it('accepts the MAX_POSITION_FEE_BPS boundary unchanged', () => {
    const result = build(sodax, { address: PARTNER, percentage: MAX_POSITION_FEE_BPS });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(feeOf(result.value.data).bps).toBe(MAX_POSITION_FEE_BPS);
  });
});

describe('LeverageYieldService — the funding spender per source chain', () => {
  const ARB_ASSET_MANAGER = sodax.config.getChainConfig(ARBITRUM).addresses.assetManager;

  it('approves the user hub wallet on the hub', async () => {
    const approve = vi.spyOn(sodax.spoke, 'approve').mockResolvedValue({ ok: true, value: '0xapproveTx' } as never);
    (mockEvmProvider.waitForTransactionReceipt as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      status: 'success',
    } as never);

    await sodax.leverageYield.approvePositionFunding({
      srcChainKey: 'sonic',
      srcAddress: SAMPLE_USER,
      token: POS_COLLATERAL,
      amount: 100n,
      walletProvider: mockEvmProvider as never,
    });

    expect(approve.mock.calls[0]?.[0]).toEqual(expect.objectContaining({ spender: HUB_WALLET }));
  });

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

  it('fails a chain with no approval concept as APPROVE_FAILED, without reaching the spoke', async () => {
    const approve = vi.spyOn(sodax.spoke, 'approve');

    const result = await sodax.leverageYield.approvePositionFunding({
      srcChainKey: ChainKeys.SOLANA_MAINNET,
      srcAddress: SAMPLE_USER,
      token: POS_COLLATERAL,
      amount: 100n,
      walletProvider: mockBitcoinProvider as never,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('APPROVE_FAILED');
    expect(approve).not.toHaveBeenCalled();
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

  it('reports a chain with no allowance concept as allowed, with no spender asked for', async () => {
    const isAllowanceValid = vi.spyOn(sodax.spoke, 'isAllowanceValid');

    const result = await sodax.leverageYield.isPositionFundingAllowanceValid({
      srcChainKey: ChainKeys.SOLANA_MAINNET,
      srcAddress: SAMPLE_USER,
      token: POS_COLLATERAL,
      amount: 100n,
    });

    expect(result).toEqual({ ok: true, value: true });
    expect(isAllowanceValid.mock.calls[0]?.[0]).not.toHaveProperty('spender');
  });

  it('rejects a non-positive amount before resolving any spender', async () => {
    const isAllowanceValid = vi.spyOn(sodax.spoke, 'isAllowanceValid');
    const result = await sodax.leverageYield.isPositionFundingAllowanceValid({
      srcChainKey: ARBITRUM,
      srcAddress: SAMPLE_USER,
      token: POS_COLLATERAL,
      amount: 0n,
    });
    expect(result.ok).toBe(false);
    expect(isAllowanceValid).not.toHaveBeenCalled();
  });
});

describe('LeverageYieldService.approvePositionFunding — waiting for the approve to land', () => {
  /**
   * The whole point of this method over a bare `spoke.approve`. `spoke.verifyTxHash` returns
   * `{ ok: true }` for EVM WITHOUT waiting, so relying on it left the caller's next allowance read
   * seeing the pre-approval value — the live symptom was being asked to approve twice.
   */
  it('waits on the EVM provider receipt, not on verifyTxHash', async () => {
    vi.spyOn(sodax.spoke, 'approve').mockResolvedValue({ ok: true, value: '0xapproveTx' } as never);
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

  it('rejects a non-positive amount before touching the wallet', async () => {
    const approve = vi.spyOn(sodax.spoke, 'approve');
    const result = await sodax.leverageYield.approvePositionFunding({
      srcChainKey: 'sonic',
      srcAddress: SAMPLE_USER,
      token: POS_COLLATERAL,
      amount: 0n,
      walletProvider: mockEvmProvider as never,
    });
    expect(result.ok).toBe(false);
    expect(approve).not.toHaveBeenCalled();
  });
});

describe('LeverageYieldService — positions, factory misconfigured', () => {
  it('uses the deployed factory straight from the default config, with nothing supplied', () => {
    const result = new Sodax().leverageYield.buildCreatePositionAndLeverage({
      from: POSITION_OWNER,
      owner: POSITION_OWNER,
      collateral: POS_COLLATERAL,
      borrowToken: POS_BORROW_TOKEN,
      eModeCategory: 3,
      origin: { chainKey: 'sonic', address: POSITION_OWNER },
      initialAssets: 1n,
      borrowAmount: 1n,
      minCollateralOut: 1n,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.to).toBe(leverageYieldConfig.positionFactory);
  });

  it('still honours an explicit override, for a fork or a staging deployment', () => {
    const result = sodaxWithFactory().leverageYield.buildCreatePositionAndLeverage({
      from: POSITION_OWNER,
      owner: POSITION_OWNER,
      collateral: POS_COLLATERAL,
      borrowToken: POS_BORROW_TOKEN,
      eModeCategory: 3,
      origin: { chainKey: 'sonic', address: POSITION_OWNER },
      initialAssets: 1n,
      borrowAmount: 1n,
      minCollateralOut: 1n,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.to).toBe(POSITION_FACTORY);
    expect(result.value.to).not.toBe(leverageYieldConfig.positionFactory);
  });

  it('listPositions fails closed rather than using a placeholder address', async () => {
    const result = await sodaxWithoutFactory().leverageYield.listPositions(POSITION_OWNER);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('LOOKUP_FAILED');
  });

  it('predictPosition fails closed', async () => {
    const result = await sodaxWithoutFactory().leverageYield.predictPosition(POSITION_OWNER, POSITION_OWNER);
    expect(result.ok).toBe(false);
  });

  it('maps the origin chain key to its SODAX relay id, not the EVM one', () => {
    const configured = sodaxWithFactory();
    const result = configured.leverageYield.buildCreatePositionAndLeverage({
      from: POSITION_OWNER,
      owner: POSITION_OWNER,
      collateral: POS_COLLATERAL,
      borrowToken: POS_BORROW_TOKEN,
      eModeCategory: 0,
      // Arbitrum is 23 in the relay id space; 42161 would route a refund nowhere.
      origin: { chainKey: '0xa4b1.arbitrum', address: POSITION_OWNER, asset: POS_BORROW_TOKEN },
      initialAssets: 10n ** 18n,
      borrowAmount: 1_000n,
      minCollateralOut: 1n,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // 23 padded into the calldata word for originChainId.
    expect(result.value.data).toContain((23).toString(16).padStart(64, '0'));
    expect(result.value.data).not.toContain((42161).toString(16).padStart(64, '0'));
  });

  it('refuses a spoke origin with no refund asset', () => {
    const configured = sodaxWithFactory();
    const result = configured.leverageYield.buildCreatePositionAndLeverage({
      from: POSITION_OWNER,
      owner: POSITION_OWNER,
      collateral: POS_COLLATERAL,
      borrowToken: POS_BORROW_TOKEN,
      eModeCategory: 0,
      // Off-hub with nothing to unwrap into: the AssetManager moves only its own registered assets,
      // so this would be a position whose refund could never be paid.
      origin: { chainKey: '0xa4b1.arbitrum', address: POSITION_OWNER },
      initialAssets: 10n ** 18n,
      borrowAmount: 1_000n,
      minCollateralOut: 1n,
    });
    expect(result.ok).toBe(false);
  });

  it('buildCreatePositionAndLeverage fails closed', () => {
    const result = sodaxWithoutFactory().leverageYield.buildCreatePositionAndLeverage({
      from: POSITION_OWNER,
      owner: POSITION_OWNER,
      collateral: POS_COLLATERAL,
      borrowToken: POS_BORROW_TOKEN,
      eModeCategory: 3,
      origin: { chainKey: 'sonic', address: POSITION_OWNER },
      initialAssets: 1n,
      borrowAmount: 1n,
      minCollateralOut: 1n,
    });
    expect(result.ok).toBe(false);
  });

  it('position-only reads do not need the factory', async () => {
    // `sodax` has no factory configured, but this read targets the position directly, so it
    // must still resolve — only factory-backed methods are gated.
    vi.spyOn(sodax.hubProvider.publicClient, 'readContract').mockResolvedValue(true as never);
    const result = await sodax.leverageYield.getPositionPendingState(POSITION);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.isLive).toBe(true);
  });

  it('flags a resolved-but-unswept slot as needing settlement', async () => {
    // The state that strands funds: an operation is recorded but its intent is gone, so the grant
    // is still open and any debt-side contribution is still sitting in the position.
    vi.spyOn(sodax.hubProvider.publicClient, 'readContract').mockImplementation((async ({
      functionName,
    }: {
      functionName: string;
    }) => (functionName === 'hasPendingOperation' ? false : 3)) as never);

    const result = await sodax.leverageYield.getPositionPendingState(POSITION);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toEqual({ kind: 3, isLive: false, needsSettle: true });
  });
});

describe('LeverageYieldService — position reads', () => {
  it('listPositions returns the owner clones in creation order', async () => {
    const configured = sodaxWithFactory();
    const positions = [POSITION, '0x4444444444444444444444444444444444444444'] as const;
    vi.spyOn(configured.hubProvider.publicClient, 'readContract').mockResolvedValue(positions as never);

    const result = await configured.leverageYield.listPositions(POSITION_OWNER);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toEqual(positions);
  });

  it('getPositionInfo assembles the static descriptor', async () => {
    const configured = sodaxWithFactory();
    vi.spyOn(configured.hubProvider.publicClient, 'readContract').mockImplementation((async (call: {
      functionName: string;
    }) => {
      switch (call.functionName) {
        case 'owner':
          return POSITION_OWNER;
        case 'collateral':
          return POS_COLLATERAL;
        case 'borrowToken':
          return POS_BORROW_TOKEN;
        case 'eModeCategory':
          return 3;
        case 'feeBps':
          return 50;
        case 'feeReceiver':
          return POSITION_OWNER;
        default:
          throw new Error(`unexpected read: ${call.functionName}`);
      }
    }) as never);

    const result = await configured.leverageYield.getPositionInfo(POSITION);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toEqual({
      address: POSITION,
      owner: POSITION_OWNER,
      collateral: POS_COLLATERAL,
      borrowToken: POS_BORROW_TOKEN,
      eModeCategory: 3,
      // Read from the position, not from config — it is fixed at creation.
      feeBps: 50,
      feeReceiver: POSITION_OWNER,
    });
  });

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

  it('wraps a read failure as LOOKUP_FAILED', async () => {
    const configured = sodaxWithFactory();
    vi.spyOn(configured.hubProvider.publicClient, 'readContract').mockRejectedValue(new Error('rpc down'));
    const result = await configured.leverageYield.getPositionInfo(POSITION);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('LOOKUP_FAILED');
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

  it('wraps a collateral-balance read failure as LOOKUP_FAILED', async () => {
    const configured = sodaxWithFactory();
    vi.spyOn(configured.hubProvider.publicClient, 'readContract').mockRejectedValue(new Error('rpc down'));
    const result = await configured.leverageYield.getPositionCollateralBalance(POSITION, POS_COLLATERAL);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('LOOKUP_FAILED');
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
  it('leverage builders target the position itself', () => {
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
    expect(add.to).toBe(POSITION);
    expect(dec.to).toBe(POSITION);
    // Distinct selectors — guards against wiring both builders to the same function.
    expect(add.data.slice(0, 10)).not.toBe(dec.data.slice(0, 10));
  });

  it('withdraw and cancel encode against the position', () => {
    const configured = sodaxWithFactory();
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
    expect(withdraw.to).toBe(POSITION);
    expect(cancel.to).toBe(POSITION);
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

  it('fails closed on a blanked-out factory override', () => {
    const result = sodaxWithoutFactory().leverageYield.buildCreatePositionAndLeverage({
      from: POSITION_OWNER,
      owner: POSITION_OWNER,
      collateral: POS_COLLATERAL,
      borrowToken: POS_BORROW_TOKEN,
      eModeCategory: 0,
      origin: { chainKey: 'sonic', address: POSITION_OWNER },
      initialAssets: 1n,
      borrowAmount: 1n,
      minCollateralOut: 1n,
    });
    expect(result.ok).toBe(false);
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

  /** The four builders that encode a create call, each reduced to `(partnerFee) => create calldata`. */
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
    [
      'buildOpenPositionFromDebtTokenData',
      async percentage => {
        const configured = sodaxWithFactory();
        stubFactoryPrediction(configured, 0n, PREDICTED_POSITION);
        const result = await configured.leverageYield.buildOpenPositionFromDebtTokenData({
          srcChainKey: ARBITRUM,
          srcAddress: SAMPLE_USER,
          token: SPOKE_TOKEN,
          amount: 10n ** 18n,
          owner: HUB_WALLET,
          collateral: POS_COLLATERAL,
          totalInput: 2n * 10n ** 18n,
          minCollateralOut: 1n,
          partnerFee: { address: PARTNER, percentage },
        });
        return result.ok ? { ok: true, value: decodeBatchCalls(result.value).at(-1)?.data as Hex } : result;
      },
    ],
  ];

  it.each(paths)('%s rejects one basis point over the cap', async (_name, build) => {
    const result = await build(MAX_POSITION_FEE_BPS + 1);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('LOOKUP_FAILED');
  });

  it.each(paths)('%s encodes the cap itself', async (_name, build) => {
    const result = await build(MAX_POSITION_FEE_BPS);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(feeBpsOf(result.value)).toBe(MAX_POSITION_FEE_BPS);
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

  it('encodes wrap → transfer to the predicted position → create, and never approves the factory', async () => {
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

  it('records the funding chain and address as the position origin, so a failed intent refunds to the user', async () => {
    const configured = sodaxWithFactory();
    stubPrediction(configured);
    const result = await configured.leverageYield.buildOpenPositionData({
      srcChainKey: ARBITRUM,
      srcAddress: SAMPLE_USER,
      token: SPOKE_TOKEN,
      amount: 10n ** 18n,
      owner: HUB_WALLET,
      borrowToken: POS_BORROW_TOKEN,
      borrowAmount: 1n,
      minCollateralOut: 1n,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const create = decodeCalls(result.value).at(-1);
    // The SODAX relay id for Arbitrum (23), not the EVM chain id — a refund keyed on 42161 goes nowhere.
    const relayId = getIntentRelayChainId(ARBITRUM);
    expect(create?.data.toLowerCase()).toContain(relayId?.toString(16).padStart(64, '0'));
    // …and the user's own address, not the hub wallet's and not the position's.
    expect(create?.data.toLowerCase()).toContain(SAMPLE_USER.slice(2).toLowerCase());
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

  it('deposits to the hub wallet and waits for the relayed hub transaction', async () => {
    const configured = sodaxWithFactory();
    vi.spyOn(configured.hubProvider, 'getUserHubWalletAddress').mockResolvedValue(HUB_WALLET);
    vi.spyOn(configured.spoke, 'verifyTxHash').mockResolvedValue({ ok: true, value: true });
    stubPrediction(configured);
    vi.spyOn(configured.spoke, 'deposit').mockResolvedValueOnce({ ok: true, value: '0xspokeTx' });
    mocks.relayTxAndWaitPacket.mockResolvedValueOnce({ ok: true, value: { dst_tx_hash: '0xhubTx' } });

    const result = await configured.leverageYield.openPosition({
      params: {
        srcChainKey: ARBITRUM,
        srcAddress: SAMPLE_USER,
        token: SPOKE_TOKEN,
        amount: 10n ** 18n,
        borrowToken: POS_BORROW_TOKEN,
        borrowAmount: 1n,
        minCollateralOut: 1n,
      },
      walletProvider: mockEvmProvider,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Both hashes matter: the spoke one is what the user sees, the hub one is where the intent
    // actually exists and so is what notifySolver has to be told about.
    expect(result.value).toEqual({ srcChainTxHash: '0xspokeTx', dstChainTxHash: '0xhubTx' });
    const deposit = vi.mocked(configured.spoke.deposit).mock.calls[0]?.[0];
    // Funds land in the hub wallet, which is what the batch then spends.
    expect(deposit?.to).toBe(HUB_WALLET);
    expect(deposit?.amount).toBe(10n ** 18n);
  });

  it('on the hub there is nothing to relay, so both hashes are the one transaction', async () => {
    const configured = sodaxWithFactory();
    vi.spyOn(configured.hubProvider, 'getUserHubWalletAddress').mockResolvedValue(HUB_WALLET);
    vi.spyOn(configured.spoke, 'verifyTxHash').mockResolvedValue({ ok: true, value: true });
    stubPrediction(configured);
    vi.spyOn(configured.spoke, 'deposit').mockResolvedValueOnce({ ok: true, value: '0xsonicTx' });
    mocks.relayTxAndWaitPacket.mockClear();

    const result = await configured.leverageYield.openPosition({
      params: {
        srcChainKey: SONIC,
        srcAddress: SAMPLE_USER,
        token: SODA_ASSET,
        amount: 10n ** 18n,
        borrowToken: POS_BORROW_TOKEN,
        borrowAmount: 1n,
        minCollateralOut: 1n,
      },
      walletProvider: mockEvmProvider,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toEqual({ srcChainTxHash: '0xsonicTx', dstChainTxHash: '0xsonicTx' });
    expect(mocks.relayTxAndWaitPacket).not.toHaveBeenCalled();
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
  it('refuses a Bitcoin source before any funds move', async () => {
    const configured = sodaxWithFactory();
    const deposit = vi.spyOn(configured.spoke, 'deposit');

    const result = await configured.leverageYield.openPosition({
      params: {
        srcChainKey: 'bitcoin',
        srcAddress: 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4',
        token: '0:0',
        amount: 10n ** 6n,
        borrowToken: POS_BORROW_TOKEN,
        borrowAmount: 1n,
        minCollateralOut: 1n,
      },
    } as never);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('VALIDATION_FAILED');
    expect(result.error.context?.field).toBe('srcChainKey');
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

  it('refuses a Bitcoin source before signing anything', async () => {
    const configured = sodaxWithFactory();
    const sendMessage = vi.spyOn(configured.spoke, 'sendMessage');

    const result = await configured.leverageYield.operatePosition({
      params: {
        srcChainKey: 'bitcoin',
        srcAddress: 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4',
        calls: [{ from: HUB_WALLET, to: POSITION, value: 0n, data: '0x' }],
      },
    } as never);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('VALIDATION_FAILED');
    expect(result.error.context?.field).toBe('srcChainKey');
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
